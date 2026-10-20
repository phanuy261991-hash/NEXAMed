import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  BRANCH_DIRECTORY_PORT,
  BusinessCodeModeUnsupportedError,
  BusinessCodeTemplateInvalidError,
  BusinessCodeTemplateStartingValueLockedError,
  PrescriptionFacilityCodeMissingError,
  PrescriptionStandardModeNotReadyError,
  toVietnamDateParts,
  type BranchDirectoryPort,
} from '@nexamed/core';
import {
  BUSINESS_CODE_TOKEN,
  BUSINESS_CODE_TYPE_REGISTRY,
  businessCodeTypeSchema,
  computeBusinessCodePeriodKey,
  businessCodeResetsByDefault,
  defaultBusinessCodeCounterDigits,
  DEFAULT_BUSINESS_CODE_STARTING_VALUE,
  DEFAULT_BUSINESS_CODE_TEMPLATE,
  formatBusinessCode,
  formatPrescriptionNationalCode,
  isValidFacilityCode,
  parseBusinessCodeTemplate,
  PRESCRIPTION_STANDARD_COUNTER_DIGITS,
  PRESCRIPTION_STANDARD_SEQUENCE_PREFIX,
  PRESCRIPTION_STANDARD_TEMPLATE,
  type BusinessCodeTemplateItem,
  type BusinessCodeType,
  type PrescriptionKind,
  type PrescriptionStandardReadinessBranch,
  type PrescriptionStandardReadinessResponse,
  type UpdateBusinessCodeTemplateRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { ClinicSettingsRepository, type BusinessCodeTemplateEntry } from './clinic-settings.repository';
import { ClinicProfileRepository } from './clinic-profile.repository';

/** Bộ đếm 7 chữ số thập phân: tối đa 9.999.999 đơn mỗi cơ sở. */
const PRESCRIPTION_STANDARD_MAX_SEQ = 9_999_999n;

/**
 * Ngữ cảnh tuỳ chọn khi sinh mã — chỉ cần cho khuôn mã đơn thuốc dùng token `[Mã cơ sở KCB]`/`[Loại đơn]` (#242). `facilityCode` do nơi gọi tra TRƯỚC khi mở
 * transaction (`resolveFacilityCodeForBranch`): tra qua port chi nhánh mở một transaction riêng, gọi từ BÊN TRONG transaction khác sẽ giữ 2 kết nối cùng lúc và
 * làm cạn bể kết nối khi nhiều người ký đơn đồng thời ("Unable to start a transaction in the given time").
 */
export interface BusinessCodeContext {
  facilityCode?: string;
  prescriptionKind?: PrescriptionKind;
}

/**
 * "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114, chủ dự án yêu cầu trực tiếp 2026-09-03) —
 * điểm gọi DUY NHẤT cho 7 loại mã nghiệp vụ có tháng-năm (thay `formatDisplayCode` +
 * `CodeSequenceRepository.next()` gọi trực tiếp trước đây ở `patient.service.ts`/
 * `department.service.ts`/`user-account.service.ts`/`appointment.service.ts`/`reception.service.ts`/
 * `invoice.repository.ts`/`cashier-shift.repository.ts`). `generate()` chạy TRONG transaction của
 * caller (nhận `tx`, không tự mở transaction riêng) — đúng khuôn `CodeSequenceRepository.next()`.
 *
 * Tiền tố NỘI BỘ (`BUSINESS_CODE_TYPE_REGISTRY[...].internalPrefix`, vd "BN") CHỈ dùng làm khoá
 * đếm `code_sequence.prefix` — KHÔNG đổi theo chữ tự do admin gõ trong khuôn mẫu hiển thị. Nhờ
 * vậy sửa khuôn không bao giờ làm mất mạch bộ đếm đang chạy.
 *
 * Mã đơn thuốc chuẩn Bộ Y tế (#242) là mã THỨ HAI, riêng với `prescription_no` nội bộ: sinh bằng `generatePrescriptionNationalCode()`, bộ đếm riêng
 * (`code_sequence.prefix='DTQG'`, chu kỳ = mã cơ sở KCB nên mỗi cơ sở một bộ đếm, không đánh số lại).
 */
@Injectable()
export class BusinessCodeService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly clinicSettingsRepository: ClinicSettingsRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    private readonly clinicProfileRepository: ClinicProfileRepository,
    @Inject(BRANCH_DIRECTORY_PORT) private readonly branchDirectory: BranchDirectoryPort,
  ) {}

  /** Sinh mã thật — cấp số atomic, KHÔNG hoàn tác được. Gọi trong transaction đang tạo bản ghi
   * (patient/encounter/invoice...), đúng khuôn `formatDisplayCode` cũ. */
  async generate(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    codeType: BusinessCodeType,
    occurredAtUtc: Date,
    context: BusinessCodeContext = {},
  ): Promise<string> {
    const stored = await this.clinicSettingsRepository.getBusinessCodeTemplatesConfig(tx, tenantId);
    const explicitConfig = stored[codeType];
    const config = explicitConfig ?? this.defaultConfig(codeType);
    // Khuôn mặc định luôn hợp lệ (test tương thích ngược); khuôn tenant tự sửa đã validate lúc
    // lưu (updateTemplate) nên về lý thuyết không bao giờ lỗi tới đây — vẫn kiểm để không âm thầm
    // sinh mã sai nếu có lỗ hổng nào đó lọt qua validate.
    const parseResult = parseBusinessCodeTemplate(config.template, codeType);
    if (!parseResult.ok) {
      throw new BusinessCodeTemplateInvalidError(`Cấu hình mẫu mã hỏng cho ${codeType}: ${parseResult.error}`);
    }

    const dateParts = toVietnamDateParts(occurredAtUtc);
    // BUG THẬT phát hiện 2026-09-03 (mở ca "Chốt ca" crash 500, UNIQUE shift_no) — khuôn MẶC ĐỊNH
    // (`explicitConfig` rỗng, tenant CHƯA từng cấu hình) đã chứa sẵn token [Tháng] chỉ để HIỂN THỊ
    // giống hệt `<prefix><yyMM><seq6>` cũ, nhưng `computeBusinessCodePeriodKey` không phân biệt
    // "token để hiển thị" với "token do tenant chủ động chọn để RESET" — khiến bộ đếm tự tách
    // thành 1 chu kỳ mới bắt đầu lại từ 1 ngay cả khi tenant chưa cấu hình gì, đụng trùng mã cũ đã
    // cấp dưới bộ đếm liên tục (`period_key=''`). Chỉ tính periodKey thật khi tenant ĐÃ chủ động
    // lưu khuôn riêng (`explicitConfig` tồn tại) — đúng lời hứa "tương thích ngược tuyệt đối,
    // CHO TỚI KHI tenant chủ động cấu hình" đã chốt ở docs/DECISIONS.md #114.
    const periodKey = explicitConfig || businessCodeResetsByDefault(codeType) ? computeBusinessCodePeriodKey(parseResult.parsed, dateParts) : '';
    const prefix = BUSINESS_CODE_TYPE_REGISTRY[codeType].internalPrefix;

    // Token riêng của mã đơn thuốc (#242): cần chi nhánh/loại đơn do nơi gọi truyền vào.
    const extras: { facilityCode?: string; prescriptionKind?: PrescriptionKind } = {};
    if (config.template.includes(BUSINESS_CODE_TOKEN.FACILITY_CODE)) {
      if (!isValidFacilityCode(context.facilityCode)) {
        throw new BusinessCodeTemplateInvalidError(`Khuôn mã ${codeType} dùng ${BUSINESS_CODE_TOKEN.FACILITY_CODE} nhưng nơi gọi không truyền mã cơ sở KCB hợp lệ.`);
      }
      extras.facilityCode = context.facilityCode;
    }
    if (config.template.includes(BUSINESS_CODE_TOKEN.PRESCRIPTION_KIND)) {
      extras.prescriptionKind = context.prescriptionKind ?? 'C';
    }

    const seq = await this.codeSequenceRepository.next(tx, tenantId, prefix, actorId, {
      periodKey,
      initialValueIfNeverUsed: BigInt(config.startingValue),
    });

    return formatBusinessCode(config.template, config.counterDigits, dateParts, seq, extras);
  }

  /** Chế độ "Chuẩn Bộ Y tế" của mã đơn thuốc đang bật cho tenant này không (đọc trong transaction của nơi gọi). */
  async isPrescriptionStandardMode(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const stored = await this.clinicSettingsRepository.getBusinessCodeTemplatesConfig(tx, tenantId);
    return stored.PRESCRIPTION?.mode === 'STANDARD';
  }

  /**
   * Mã đơn thuốc chuẩn Bộ Y tế `<5 số KCB><7 số>-<C|N|H|Y>` (docs/DECISIONS.md #242). Bộ đếm chung cả 4 loại đơn của MỘT cơ sở KCB (khoá = mã cơ sở), không
   * đánh số lại. Gọi TRONG transaction ký đơn, với `facilityCode` đã tra trước đó bằng `resolveFacilityCodeForBranch()` (xem `BusinessCodeContext`).
   */
  async generatePrescriptionNationalCode(tx: Prisma.TransactionClient, tenantId: string, actorId: string, facilityCode: string, kind: PrescriptionKind): Promise<string> {
    if (!isValidFacilityCode(facilityCode)) {
      throw new PrescriptionFacilityCodeMissingError();
    }
    const seq = await this.codeSequenceRepository.next(tx, tenantId, PRESCRIPTION_STANDARD_SEQUENCE_PREFIX, actorId, { periodKey: facilityCode });
    if (seq > PRESCRIPTION_STANDARD_MAX_SEQ) {
      throw new BusinessCodeTemplateInvalidError(`Bộ đếm mã đơn thuốc của cơ sở ${facilityCode} đã dùng hết ${PRESCRIPTION_STANDARD_COUNTER_DIGITS} chữ số.`);
    }
    return formatPrescriptionNationalCode(facilityCode, seq, kind);
  }

  /**
   * Mã KCB thực dùng của một chi nhánh: riêng của chi nhánh nếu hợp lệ, không thì của công ty nếu hợp lệ; không có thì `PrescriptionFacilityCodeMissingError`.
   * Tự mở các transaction ngắn của riêng nó nên PHẢI gọi TRƯỚC khi nơi gọi mở transaction ký đơn (không gọi từ bên trong transaction).
   */
  async resolveFacilityCodeForBranch(tenantId: string, branchId: string): Promise<string> {
    const own = await this.branchDirectory.getBranchFacilityCode(tenantId, branchId);
    if (isValidFacilityCode(own)) return own;
    const company = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.companyFacilityCode(tx, tenantId));
    if (isValidFacilityCode(company)) return company;
    throw new PrescriptionFacilityCodeMissingError();
  }

  private async companyFacilityCode(tx: Prisma.TransactionClient, tenantId: string): Promise<string | null> {
    const tenant = await this.clinicProfileRepository.findByTenantId(tx, tenantId);
    const value = tenant?.facilityCode?.trim();
    return value ? value : null;
  }

  /** `GET /clinic-settings/code-templates/prescription-standard-readiness` — chi nhánh nào đã/chưa có mã KCB hợp lệ, kèm mã kế tiếp minh hoạ. */
  async getPrescriptionStandardReadiness(tenantId: string): Promise<PrescriptionStandardReadinessResponse> {
    // Danh sách chi nhánh tra TRƯỚC (port tự mở transaction riêng) rồi mới vào transaction đọc bộ đếm — tránh giữ 2 kết nối lồng nhau.
    const branches = await this.branchDirectory.listActiveBranchFacilityInfo(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.computeReadiness(tx, tenantId, branches));
  }

  private async computeReadiness(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branches: { id: string; name: string; isDefault: boolean; facilityCode: string | null }[],
  ): Promise<PrescriptionStandardReadinessResponse> {
    const companyRaw = await this.companyFacilityCode(tx, tenantId);
    const companyFacilityCode = isValidFacilityCode(companyRaw) ? companyRaw : null;
    const rows: PrescriptionStandardReadinessBranch[] = [];
    for (const b of branches) {
      const own = isValidFacilityCode(b.facilityCode) ? b.facilityCode : null;
      const effective = own ?? companyFacilityCode;
      const source: PrescriptionStandardReadinessBranch['source'] = own ? 'BRANCH' : companyFacilityCode ? 'COMPANY' : 'NONE';
      let exampleNextCode: string | null = null;
      if (effective) {
        const current = await this.codeSequenceRepository.peekCurrentValue(tx, tenantId, PRESCRIPTION_STANDARD_SEQUENCE_PREFIX, effective);
        exampleNextCode = formatPrescriptionNationalCode(effective, current !== null ? current + 1n : 1n, 'C');
      }
      rows.push({
        branchId: b.id,
        name: b.name,
        isDefault: b.isDefault,
        facilityCode: b.facilityCode ?? null,
        effectiveFacilityCode: effective,
        source,
        ready: effective !== null,
        exampleNextCode,
      });
    }
    return {
      ready: rows.length > 0 && rows.every((r) => r.ready),
      companyFacilityCode: companyRaw,
      multiBranch: rows.length > 1,
      branches: rows,
    };
  }

  /** `GET /clinic-settings/code-templates` — 7 dòng, kèm `locked`/`exampleNextCode` tính toán,
   * KHÔNG cấp số/đụng `code_sequence` thật. `branchId` = chi nhánh đang làm việc (chỉ để minh hoạ mã đơn thuốc chuẩn). */
  async listTemplates(tenantId: string, branchId: string | null = null): Promise<BusinessCodeTemplateItem[]> {
    const branches = await this.branchDirectory.listActiveBranchFacilityInfo(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const stored = await this.clinicSettingsRepository.getBusinessCodeTemplatesConfig(tx, tenantId);
      const now = toVietnamDateParts(new Date());
      const items: BusinessCodeTemplateItem[] = [];
      for (const codeType of businessCodeTypeSchema.options) {
        const explicitConfig = stored[codeType];
        const config = explicitConfig ?? this.defaultConfig(codeType);
        items.push(await this.toItem(tx, tenantId, codeType, config, now, explicitConfig !== undefined, branchId, branches));
      }
      return items;
    });
  }

  /** `PATCH /clinic-settings/code-templates/:codeType` — validate cú pháp, chặn sửa `startingValue`
   * khi loại mã đã `locked` (đã phát sinh mã đầu tiên, bất kỳ chu kỳ nào). `mode='STANDARD'` (chỉ PRESCRIPTION) cần mọi chi nhánh đang hoạt động có mã KCB. */
  async updateTemplate(
    tenantId: string,
    actorId: string,
    codeType: BusinessCodeType,
    dto: UpdateBusinessCodeTemplateRequest,
    meta: RequestMeta,
    branchId: string | null = null,
  ): Promise<BusinessCodeTemplateItem> {
    const branches = codeType === 'PRESCRIPTION' ? await this.branchDirectory.listActiveBranchFacilityInfo(tenantId) : [];
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const prefix = BUSINESS_CODE_TYPE_REGISTRY[codeType].internalPrefix;
      const existingStored = await this.clinicSettingsRepository.getBusinessCodeTemplatesConfig(tx, tenantId);
      const existingEntry = existingStored[codeType];
      const targetStandard = dto.mode === undefined ? existingEntry?.mode === 'STANDARD' : dto.mode === 'STANDARD';

      if (targetStandard && codeType !== 'PRESCRIPTION') {
        throw new BusinessCodeModeUnsupportedError();
      }

      let newEntry: BusinessCodeTemplateEntry;
      if (targetStandard) {
        // Chế độ chuẩn: khuôn hiển thị + số chữ số do hệ thống đặt; khuôn nội bộ (`prescription_no`) giữ nguyên, không đụng bộ đếm.
        if (existingEntry?.mode !== 'STANDARD') {
          const readiness = await this.computeReadiness(tx, tenantId, branches);
          if (!readiness.ready) {
            throw new PrescriptionStandardModeNotReadyError(readiness.branches.filter((b) => !b.ready).map((b) => b.name));
          }
        }
        const base = existingEntry ?? this.defaultConfig(codeType);
        newEntry = { template: base.template, counterDigits: base.counterDigits, startingValue: base.startingValue, mode: 'STANDARD' };
      } else {
        const parseResult = parseBusinessCodeTemplate(dto.template, codeType);
        if (!parseResult.ok) {
          throw new BusinessCodeTemplateInvalidError(parseResult.error);
        }
        if (dto.startingValue !== undefined) {
          const locked = await this.codeSequenceRepository.hasEverBeenUsed(tx, tenantId, prefix);
          if (locked) {
            throw new BusinessCodeTemplateStartingValueLockedError();
          }
        }
        newEntry = {
          template: dto.template,
          counterDigits: dto.counterDigits,
          startingValue: dto.startingValue ?? existingEntry?.startingValue ?? DEFAULT_BUSINESS_CODE_STARTING_VALUE,
        };
      }
      await this.clinicSettingsRepository.upsertBusinessCodeTemplateEntry(tx, tenantId, actorId, codeType, newEntry);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'business_code_template.updated',
        entityType: 'tenant_setting',
        entityId: tenantId,
        beforeJson: (existingEntry ?? null) as unknown as Prisma.InputJsonValue,
        afterJson: newEntry as unknown as Prisma.InputJsonObject,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const now = toVietnamDateParts(new Date());
      return this.toItem(tx, tenantId, codeType, newEntry, now, true, branchId, branches);
    });
  }

  private defaultConfig(codeType: BusinessCodeType): BusinessCodeTemplateEntry {
    return {
      template: DEFAULT_BUSINESS_CODE_TEMPLATE[codeType],
      counterDigits: defaultBusinessCodeCounterDigits(codeType),
      startingValue: DEFAULT_BUSINESS_CODE_STARTING_VALUE,
    };
  }

  private async toItem(
    tx: Prisma.TransactionClient,
    tenantId: string,
    codeType: BusinessCodeType,
    config: BusinessCodeTemplateEntry,
    now: { year: number; month: number; day: number },
    /** Khuôn này có phải do tenant CHỦ ĐỘNG lưu không — quyết định periodKey có tính "thật" theo
     * token trong khuôn hay ép về '' (mặc định chưa cấu hình, xem comment ở `generate()`). */
    isExplicit: boolean,
    branchId: string | null,
    branches: { id: string; name: string; isDefault: boolean; facilityCode: string | null }[],
  ): Promise<BusinessCodeTemplateItem> {
    const prefix = BUSINESS_CODE_TYPE_REGISTRY[codeType].internalPrefix;
    const standard = codeType === 'PRESCRIPTION' && config.mode === 'STANDARD';

    if (standard) {
      // Chế độ chuẩn: hiện khuôn chuẩn; mã minh hoạ theo chi nhánh đang làm (không có thì chi nhánh đầu danh sách).
      const readiness = await this.computeReadiness(tx, tenantId, branches);
      const target = readiness.branches.find((b) => b.branchId === branchId) ?? readiness.branches[0];
      return {
        codeType,
        label: BUSINESS_CODE_TYPE_REGISTRY[codeType].label,
        prefix,
        template: PRESCRIPTION_STANDARD_TEMPLATE,
        counterDigits: PRESCRIPTION_STANDARD_COUNTER_DIGITS,
        startingValue: 1,
        locked: true,
        exampleNextCode: target?.exampleNextCode ?? '(chưa có mã cơ sở KCB)',
        mode: 'STANDARD',
        supportsStandardMode: true,
      };
    }

    const locked = await this.codeSequenceRepository.hasEverBeenUsed(tx, tenantId, prefix);
    const parseResult = parseBusinessCodeTemplate(config.template, codeType);
    let exampleNextCode = '(khuôn mẫu lỗi)';
    if (parseResult.ok) {
      const periodKey = isExplicit || businessCodeResetsByDefault(codeType) ? computeBusinessCodePeriodKey(parseResult.parsed, now) : '';
      const current = await this.codeSequenceRepository.peekCurrentValue(tx, tenantId, prefix, periodKey);
      const nextSeq = current !== null ? current + 1n : BigInt(config.startingValue);
      exampleNextCode = formatBusinessCode(config.template, config.counterDigits, now, nextSeq, { facilityCode: '00000', prescriptionKind: 'C' });
    }

    return {
      codeType,
      label: BUSINESS_CODE_TYPE_REGISTRY[codeType].label,
      prefix,
      template: config.template,
      counterDigits: config.counterDigits,
      startingValue: config.startingValue,
      locked,
      exampleNextCode,
      mode: 'CUSTOM',
      supportsStandardMode: codeType === 'PRESCRIPTION',
    };
  }
}
