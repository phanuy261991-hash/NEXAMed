import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import {
  BRANCH_DIRECTORY_PORT,
  DOCTOR_DIRECTORY_PORT,
  E_PRESCRIPTION_GATEWAY_PORT,
  InteropPasswordRequiredError,
  computeInteropTokenState,
  interopTokenNeedsRefresh,
  type BranchDirectoryPort,
  type DoctorDirectoryPort,
  type EPrescriptionGatewayEndpoint,
  type EPrescriptionGatewayPort,
  type EPrescriptionGatewayResult,
} from '@nexamed/core';
import type {
  InteropActionResult,
  ListInteropDoctorsResponse,
  ListInteropFacilitiesResponse,
  PrescriptionInteropSettings,
  PrescriptionInteropSettingsResponse,
  PrescriptionInteropStatus,
  SaveInteropCredentialRequest,
  UpdatePrescriptionInteropSettingsRequest,
} from '@nexamed/shared';
import { decryptPii, encryptPii } from '../../infrastructure/crypto/pii-encryption';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import type { RequestMeta } from '../../common/request-meta';
import { PrescriptionInteropRepository } from './prescription-interop.repository';

type GatewayFailure = Exclude<EPrescriptionGatewayResult<never>, { kind: 'ok' }>;
type Ensured<T> = { kind: 'ok'; value: T } | { kind: 'fail'; result: InteropActionResult };

const FACILITY_MISSING = 'Chưa nhập mã và mật khẩu liên thông của cơ sở.';
const DOCTOR_MISSING = 'Chưa nhập mã liên thông của bác sĩ.';

/**
 * Liên thông đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3, mockup 8d): cấu hình + mã/mật khẩu + token + thêm/xoá bác sĩ khỏi cơ sở trên cổng (khung kết nối sẵn, gọi qua `E_PRESCRIPTION_GATEWAY_PORT`).
 *
 * Hướng chi nhánh: công tắc/địa chỉ cổng = CHUNG công ty; mã/mật khẩu/token CƠ SỞ = THEO chi nhánh (chi nhánh lạ → 404); mã/mật khẩu BÁC SĨ = CHUNG công ty nhưng chỉ thao tác cho bác sĩ của chi nhánh
 * hiện hành; token + "đã thêm vào cơ sở" của bác sĩ theo CẶP (bác sĩ, chi nhánh). Mật khẩu và token mã hoá AES-256-GCM, không bao giờ trả về, không vào nhật ký.
 *
 * KHÔNG gọi cổng bên trong transaction (gọi mạng chậm giữ kết nối DB, bài học #242): đọc DB → gọi cổng → ghi DB ở transaction riêng.
 */
@Injectable()
export class PrescriptionInteropService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: PrescriptionInteropRepository,
    private readonly configService: ConfigService,
    @Inject(BRANCH_DIRECTORY_PORT) private readonly branchDirectory: BranchDirectoryPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(E_PRESCRIPTION_GATEWAY_PORT) private readonly gateway: EPrescriptionGatewayPort,
  ) {}

  private encryptionKey(): string {
    return this.configService.getOrThrow<string>('ENCRYPTION_KEY');
  }

  private endpointOf(settings: PrescriptionInteropSettings): EPrescriptionGatewayEndpoint {
    return { baseUrl: settings.gatewayUrl, timeoutMs: settings.timeoutSeconds * 1000 };
  }

  // ---- Cấu hình ----

  /** Chỉ trạng thái "đã/chưa cài khoá nhà cung cấp" — KHÔNG bao giờ trả giá trị app-name/app-key. */
  private appKeyConfigured(): boolean {
    return Boolean(this.configService.get<string>('INTEROP_APP_NAME') && this.configService.get<string>('INTEROP_APP_KEY'));
  }

  getRawSettings(tenantId: string): Promise<PrescriptionInteropSettings> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.getSettings(tx, tenantId));
  }

  async getSettings(tenantId: string): Promise<PrescriptionInteropSettingsResponse> {
    return { ...(await this.getRawSettings(tenantId)), appKeyConfigured: this.appKeyConfigured() };
  }

  /** Tự-phục vụ: chỉ công tắc tổng. */
  async getStatus(tenantId: string): Promise<PrescriptionInteropStatus> {
    return { enabled: (await this.getRawSettings(tenantId)).enabled };
  }

  async updateSettings(tenantId: string, actorId: string, dto: UpdatePrescriptionInteropSettingsRequest, meta: RequestMeta): Promise<PrescriptionInteropSettingsResponse> {
    const after = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const before = await this.repository.getSettings(tx, tenantId);
      const next: PrescriptionInteropSettings = { ...before, ...dto };
      await this.repository.upsertSettings(tx, tenantId, actorId, next);
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription_interop.settings_updated',
        entityType: 'tenant_setting',
        entityId: tenantId,
        beforeJson: before as unknown as Prisma.InputJsonValue,
        afterJson: next as unknown as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return next;
    });
    return { ...after, appKeyConfigured: this.appKeyConfigured() };
  }

  // ---- Cơ sở (theo chi nhánh) ----

  /** Mọi chi nhánh đang hoạt động kèm mã đã lưu + trạng thái token (cấu hình ở cấp công ty nên liệt kê hết, giống trang Chi nhánh). */
  async listFacilities(tenantId: string): Promise<ListInteropFacilitiesResponse> {
    const branches = await this.branchDirectory.listActiveBranchFacilityInfo(tenantId);
    const saved = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.listFacilityCredentials(tx, tenantId));
    const now = new Date();
    return {
      items: branches.map((b) => ({
        branchId: b.id,
        branchName: b.name,
        isDefault: b.isDefault,
        code: saved.get(b.id)?.code ?? null,
        hasPassword: saved.has(b.id),
        token: computeInteropTokenState(saved.get(b.id)?.tokenIssuedAt, now),
      })),
    };
  }

  private async assertBranchInCompany(tenantId: string, branchId: string): Promise<void> {
    // Chi nhánh phải là của công ty và còn hoạt động; id lạ/của công ty khác → 404 (cùng cô lập chi nhánh/tenant).
    const branches = await this.branchDirectory.listActiveBranchFacilityInfo(tenantId);
    if (!branches.some((b) => b.id === branchId)) throw new NotFoundException();
  }

  async saveFacilityCredential(tenantId: string, actorId: string, branchId: string, dto: SaveInteropCredentialRequest, meta: RequestMeta): Promise<ListInteropFacilitiesResponse> {
    await this.assertBranchInCompany(tenantId, branchId);
    const passwordEnc = dto.password ? encryptPii(dto.password, this.encryptionKey()) : undefined;

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findFacilityCredential(tx, tenantId, branchId);
      if (!existing) {
        if (!passwordEnc) throw new InteropPasswordRequiredError();
        await this.repository.createFacilityCredential(tx, tenantId, actorId, branchId, dto.code, passwordEnc);
      } else {
        const codeChanged = existing.code !== dto.code;
        // Mã hoặc mật khẩu đổi → token cũ không còn đúng. Mã đổi → cơ sở trên cổng có thể là cơ sở khác nên bác sĩ phải được thêm lại.
        await this.repository.updateFacilityCredential(tx, tenantId, actorId, branchId, dto.code, passwordEnc, codeChanged || Boolean(passwordEnc));
        if (codeChanged) await this.repository.resetPairsForBranch(tx, tenantId, actorId, branchId);
      }
      // Nhật ký KHÔNG ghi mật khẩu (kể cả mã hoá), chỉ ghi "có đổi mật khẩu không".
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription_interop.facility_credential_saved',
        entityType: 'interop_facility_credential',
        entityId: branchId,
        beforeJson: { code: existing?.code ?? null },
        afterJson: { code: dto.code, passwordChanged: Boolean(passwordEnc) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.listFacilities(tenantId);
  }

  /** Đổi kết quả gọi cổng KHÔNG thành công thành thông báo hiển thị. */
  private toFailure(failure: GatewayFailure, rejectedMessage: string, endpoint: EPrescriptionGatewayEndpoint): InteropActionResult {
    if (failure.kind === 'unreachable') {
      return {
        outcome: 'UNREACHABLE',
        message: `Không kết nối được tới ${endpoint.baseUrl} (${failure.message}). Kiểm tra mạng của máy chủ rồi thử lại. Đơn đang chờ không bị ảnh hưởng.`,
        errors: [],
      };
    }
    return { outcome: 'REJECTED', message: rejectedMessage, errors: failure.errors };
  }

  /**
   * Lấy token CƠ SỞ còn dùng được: dùng token đã lưu nếu còn hạn (còn từ 1 ngày), ngược lại đăng nhập cơ sở và lưu token mới. `force` = bỏ qua token đã lưu (sau khi cổng trả 401).
   * Token cũ được GIỮ NGUYÊN khi đăng nhập lại thất bại.
   */
  async ensureFacilityToken(tenantId: string, actorId: string, branchId: string, settings: PrescriptionInteropSettings, force = false): Promise<Ensured<string>> {
    const endpoint = this.endpointOf(settings);
    const secret = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.findFacilityCredentialSecret(tx, tenantId, branchId));
    if (!secret) return { kind: 'fail', result: { outcome: 'NOT_CONFIGURED', message: FACILITY_MISSING, errors: [] } };
    const key = this.encryptionKey();
    if (!force && secret.tokenEnc && !interopTokenNeedsRefresh(secret.tokenIssuedAt, new Date())) {
      return { kind: 'ok', value: decryptPii(secret.tokenEnc, key) };
    }
    const login = await this.gateway.loginFacility(endpoint, { facilityCode: secret.code, password: decryptPii(secret.passwordEnc, key) });
    if (login.kind !== 'ok') {
      return {
        kind: 'fail',
        result: this.toFailure(
          login.kind === 'unauthorized' ? { kind: 'rejected', status: 401, errors: login.errors } : login,
          'Cổng từ chối đăng nhập (mã liên thông hoặc mật khẩu của cơ sở không đúng). Sửa ở nút "Sửa mã/mật khẩu" của chi nhánh. Token cũ, nếu còn, được giữ nguyên.',
          endpoint,
        ),
      };
    }
    const issuedAt = new Date();
    await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.setFacilityToken(tx, tenantId, actorId, branchId, encryptPii(login.data.token, key), issuedAt));
    return { kind: 'ok', value: login.data.token };
  }

  /** "Kiểm tra kết nối" / "Đăng nhập lại": luôn đăng nhập cơ sở thật (không dùng token đã lưu) và lưu token mới. Không gửi đơn nào. */
  async loginFacility(tenantId: string, actorId: string, branchId: string, meta: RequestMeta): Promise<InteropActionResult> {
    await this.assertBranchInCompany(tenantId, branchId);
    const settings = await this.getRawSettings(tenantId);
    const ensured = await this.ensureFacilityToken(tenantId, actorId, branchId, settings, true);
    const result: InteropActionResult =
      ensured.kind === 'ok'
        ? { outcome: 'OK', message: 'Đăng nhập cơ sở thành công. Đã lưu token mới, hiệu lực dự kiến 7 ngày.', errors: [] }
        : ensured.result;
    await this.auditAttempt(tenantId, actorId, 'prescription_interop.facility_login', 'interop_facility_credential', branchId, { outcome: result.outcome, branchId }, meta);
    return result;
  }

  // ---- Bác sĩ (chung công ty; thao tác trong phạm vi chi nhánh hiện hành) ----

  async listDoctors(tenantId: string, branchId: string): Promise<ListInteropDoctorsResponse> {
    const doctors = await this.doctorDirectory.listActiveDoctors(tenantId, branchId);
    const ids = doctors.map((d) => d.id);
    const { saved, pairs } = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => ({
      saved: await this.repository.listDoctorCredentials(tx, tenantId, ids),
      pairs: await this.repository.listDoctorFacilityPairs(tx, tenantId, branchId, ids),
    }));
    const now = new Date();
    return {
      items: doctors.map((d) => ({
        userId: d.id,
        fullName: d.displayName ?? d.fullName,
        licenseNo: d.licenseNo,
        code: saved.get(d.id)?.code ?? null,
        hasPassword: saved.has(d.id),
        onGateway: pairs.get(d.id)?.addedAt != null,
        token: computeInteropTokenState(pairs.get(d.id)?.tokenIssuedAt, now),
      })),
    };
  }

  private async assertDoctorInBranch(tenantId: string, branchId: string, userId: string): Promise<void> {
    // Chỉ bác sĩ của chi nhánh đang làm; id lạ/bác sĩ chi nhánh khác/công ty khác → 404.
    const doctors = await this.doctorDirectory.listActiveDoctors(tenantId, branchId);
    if (!doctors.some((d) => d.id === userId)) throw new NotFoundException();
  }

  async saveDoctorCredential(
    tenantId: string,
    actorId: string,
    branchId: string,
    userId: string,
    dto: SaveInteropCredentialRequest,
    meta: RequestMeta,
  ): Promise<ListInteropDoctorsResponse> {
    await this.assertDoctorInBranch(tenantId, branchId, userId);
    const passwordEnc = dto.password ? encryptPii(dto.password, this.encryptionKey()) : undefined;

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findDoctorCredential(tx, tenantId, userId);
      if (!existing) {
        if (!passwordEnc) throw new InteropPasswordRequiredError();
        await this.repository.createDoctorCredential(tx, tenantId, actorId, userId, dto.code, passwordEnc);
      } else {
        const codeChanged = existing.code !== dto.code;
        await this.repository.updateDoctorCredential(tx, tenantId, actorId, userId, dto.code, passwordEnc);
        // Mã đổi → bác sĩ trên cổng là người khác: bỏ "đã thêm" + token ở MỌI chi nhánh; chỉ mật khẩu đổi → chỉ bỏ token.
        if (codeChanged || passwordEnc) await this.repository.resetPairsForDoctor(tx, tenantId, actorId, userId, { codeChanged });
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription_interop.doctor_credential_saved',
        entityType: 'interop_doctor_credential',
        entityId: userId,
        beforeJson: { code: existing?.code ?? null },
        afterJson: { code: dto.code, passwordChanged: Boolean(passwordEnc) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.listDoctors(tenantId, branchId);
  }

  /**
   * Token BÁC SĨ của cặp (bác sĩ, chi nhánh): dùng token đã lưu nếu còn hạn, ngược lại đăng nhập bác sĩ (cần bác sĩ đã được thêm vào cơ sở) và lưu. Dành cho bước gửi đơn (làm sau);
   * hiện dùng ngay sau khi thêm bác sĩ để xác nhận đăng nhập được.
   */
  async ensureDoctorToken(tenantId: string, actorId: string, branchId: string, userId: string, settings: PrescriptionInteropSettings, force = false): Promise<Ensured<string>> {
    const endpoint = this.endpointOf(settings);
    const { facility, doctor, pair } = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => ({
      facility: await this.repository.findFacilityCredential(tx, tenantId, branchId),
      doctor: await this.repository.findDoctorCredentialSecret(tx, tenantId, userId),
      pair: await this.repository.findDoctorFacilityPair(tx, tenantId, userId, branchId),
    }));
    if (!facility) return { kind: 'fail', result: { outcome: 'NOT_CONFIGURED', message: FACILITY_MISSING, errors: [] } };
    if (!doctor) return { kind: 'fail', result: { outcome: 'NOT_CONFIGURED', message: DOCTOR_MISSING, errors: [] } };
    if (!pair?.addedAt) {
      return { kind: 'fail', result: { outcome: 'NOT_CONFIGURED', message: 'Bác sĩ chưa được thêm vào cơ sở trên cổng. Bấm "Thêm vào cơ sở" trước.', errors: [] } };
    }
    const key = this.encryptionKey();
    if (!force && pair.tokenEnc && !interopTokenNeedsRefresh(pair.tokenIssuedAt, new Date())) return { kind: 'ok', value: decryptPii(pair.tokenEnc, key) };

    const login = await this.gateway.loginDoctor(endpoint, { doctorCode: doctor.code, facilityCode: facility.code, password: decryptPii(doctor.passwordEnc, key) });
    if (login.kind !== 'ok') {
      return {
        kind: 'fail',
        result: this.toFailure(
          login.kind === 'unauthorized' ? { kind: 'rejected', status: 401, errors: login.errors } : login,
          'Cổng từ chối đăng nhập bác sĩ (mã hoặc mật khẩu không đúng, hoặc bác sĩ chưa được thêm vào cơ sở).',
          endpoint,
        ),
      };
    }
    const issuedAt = new Date();
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.repository.upsertDoctorFacilityPair(tx, tenantId, actorId, userId, branchId, { addedAt: pair.addedAt, tokenEnc: encryptPii(login.data.token, key), tokenIssuedAt: issuedAt }),
    );
    return { kind: 'ok', value: login.data.token };
  }

  /** Gọi API cần token cơ sở: thiếu/sắp hết hạn thì tự đăng nhập; cổng trả 401 thì đăng nhập lại và thử đúng MỘT lần nữa. */
  private async withFacilityToken<T>(
    tenantId: string,
    actorId: string,
    branchId: string,
    settings: PrescriptionInteropSettings,
    call: (token: string) => Promise<EPrescriptionGatewayResult<T>>,
  ): Promise<{ kind: 'ok'; data: T } | { kind: 'fail'; failure: GatewayFailure } | { kind: 'precondition'; result: InteropActionResult }> {
    let ensured = await this.ensureFacilityToken(tenantId, actorId, branchId, settings);
    if (ensured.kind === 'fail') return { kind: 'precondition', result: ensured.result };
    let result = await call(ensured.value);
    if (result.kind === 'unauthorized') {
      ensured = await this.ensureFacilityToken(tenantId, actorId, branchId, settings, true);
      if (ensured.kind === 'fail') return { kind: 'precondition', result: ensured.result };
      result = await call(ensured.value);
    }
    return result.kind === 'ok' ? { kind: 'ok', data: result.data } : { kind: 'fail', failure: result };
  }

  async addDoctorToFacility(tenantId: string, actorId: string, branchId: string, userId: string, meta: RequestMeta): Promise<InteropActionResult> {
    await this.assertDoctorInBranch(tenantId, branchId, userId);
    const settings = await this.getRawSettings(tenantId);
    const endpoint = this.endpointOf(settings);
    const doctor = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.findDoctorCredentialSecret(tx, tenantId, userId));
    if (!doctor) return { outcome: 'NOT_CONFIGURED', message: DOCTOR_MISSING, errors: [] };

    const outcome = await this.withFacilityToken(tenantId, actorId, branchId, settings, (token) => this.gateway.addDoctorToFacility(endpoint, token, doctor.code));
    let result: InteropActionResult;
    if (outcome.kind === 'precondition') result = outcome.result;
    else if (outcome.kind === 'fail') result = this.toFailure(outcome.failure, 'Cổng từ chối thêm bác sĩ vào cơ sở. Xem nội dung lỗi bên dưới.', endpoint);
    else {
      // Đã thêm: ghi nhận, rồi đăng nhập bác sĩ thử để xác nhận (không làm hỏng kết quả "đã thêm" nếu bước này thất bại).
      await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.upsertDoctorFacilityPair(tx, tenantId, actorId, userId, branchId, { addedAt: new Date(), tokenEnc: null, tokenIssuedAt: null }));
      const doctorLogin = await this.ensureDoctorToken(tenantId, actorId, branchId, userId, settings, true);
      result = {
        outcome: 'OK',
        message: doctorLogin.kind === 'ok' ? 'Đã thêm bác sĩ vào cơ sở trên cổng và đăng nhập bác sĩ thành công.' : 'Đã thêm bác sĩ vào cơ sở trên cổng. Chưa đăng nhập được bác sĩ (xem mã/mật khẩu bác sĩ), token sẽ lấy lại khi cần.',
        errors: doctorLogin.kind === 'ok' ? [] : doctorLogin.result.errors,
      };
    }
    await this.auditAttempt(tenantId, actorId, 'prescription_interop.doctor_added_to_facility', 'interop_doctor_credential', userId, { outcome: result.outcome, branchId }, meta);
    return result;
  }

  async removeDoctorFromFacility(tenantId: string, actorId: string, branchId: string, userId: string, meta: RequestMeta): Promise<InteropActionResult> {
    await this.assertDoctorInBranch(tenantId, branchId, userId);
    const settings = await this.getRawSettings(tenantId);
    const endpoint = this.endpointOf(settings);
    const doctor = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.findDoctorCredentialSecret(tx, tenantId, userId));
    if (!doctor) return { outcome: 'NOT_CONFIGURED', message: DOCTOR_MISSING, errors: [] };

    const outcome = await this.withFacilityToken(tenantId, actorId, branchId, settings, (token) => this.gateway.removeDoctorFromFacility(endpoint, token, doctor.code));
    let result: InteropActionResult;
    if (outcome.kind === 'precondition') result = outcome.result;
    else if (outcome.kind === 'fail') result = this.toFailure(outcome.failure, 'Cổng từ chối xoá bác sĩ khỏi cơ sở. Xem nội dung lỗi bên dưới.', endpoint);
    else {
      await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.upsertDoctorFacilityPair(tx, tenantId, actorId, userId, branchId, { addedAt: null, tokenEnc: null, tokenIssuedAt: null }));
      result = { outcome: 'OK', message: 'Đã xoá bác sĩ khỏi cơ sở trên cổng.', errors: [] };
    }
    await this.auditAttempt(tenantId, actorId, 'prescription_interop.doctor_removed_from_facility', 'interop_doctor_credential', userId, { outcome: result.outcome, branchId }, meta);
    return result;
  }

  /** Ghi nhật ký một lần gọi cổng (thành công hay không). KHÔNG chứa mật khẩu/token/mã liên thông; chỉ kết quả. */
  private auditAttempt(tenantId: string, actorId: string, action: string, entityType: string, entityId: string, afterJson: Prisma.InputJsonValue, meta: RequestMeta) {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => writeAuditLog(tx, tenantId, { actorId, action, entityType, entityId, afterJson, ip: meta.ip, userAgent: meta.userAgent }));
  }
}
