import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DOCTOR_DIRECTORY_PORT,
  E_PRESCRIPTION_GATEWAY_PORT,
  INTEROP_NOT_READY_RECHECK_MINUTES,
  INTEROP_SEND_LEASE_MINUTES,
  INTEROP_SUBMISSION_SOURCE_PORT,
  InteropSendDisabledError,
  InteropSubmissionNotSendableError,
  SYSTEM_ACTOR_ID,
  blockingInteropProblems,
  buildGuiDonThuocPayload,
  checkInteropReadiness,
  decideAfterAttempt,
  type DoctorDirectoryPort,
  type EPrescriptionGatewayPort,
  type InteropProblem,
  type InteropSubmissionInput,
  type InteropSubmissionSourcePort,
} from '@nexamed/core';
import type {
  DataScope,
  InteropSubmissionActionResponse,
  InteropSubmissionRow,
  ListInteropSubmissionsQuery,
  ListInteropSubmissionsResponse,
  PrescriptionInteropSettings,
} from '@nexamed/shared';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import type { RequestMeta } from '../../common/request-meta';
import { PrescriptionInteropService } from './prescription-interop.service';
import { PrescriptionSubmissionRepository, type PrescriptionSubmissionRecord, type SubmissionOutcomeData } from './prescription-submission.repository';

type ProcessOutcome = InteropSubmissionActionResponse['outcome'];
interface ProcessResult {
  outcome: ProcessOutcome;
  message: string;
}

/** Số đơn tối đa một lượt chạy nền xử lý cho mỗi công ty (tránh một công ty chiếm cả lượt). */
const DUE_BATCH_SIZE = 20;
const VN_OFFSET = '+07:00';

/** Đầu ngày Việt Nam (UTC) của `YYYY-MM-DD`, cộng `plusDays` ngày. */
function startOfVietnamDayUtc(isoDate: string, plusDays = 0): Date {
  return new Date(new Date(`${isoDate}T00:00:00${VN_OFFSET}`).getTime() + plusDays * 86_400_000);
}

/**
 * Hàng chờ gửi đơn thuốc lên cổng Đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3, mockup 8c): danh sách, "Gửi ngay"/"Gửi lại" và bộ gửi nền. Gửi bằng DANH TÍNH BÁC SĨ KÝ ĐƠN (token bác sĩ của cặp bác sĩ–chi nhánh).
 *
 * - Dữ liệu gói gửi dựng lại MỖI LẦN gửi qua `INTEROP_SUBMISSION_SOURCE_PORT` (module này không import module lượt khám).
 * - KHÔNG gọi cổng bên trong transaction: "thuê" dòng (transaction ngắn) → đọc dữ liệu → gọi cổng → ghi kết quả (transaction ngắn). "Thuê" = `locked_until`, tránh hai tiến trình gửi trùng một đơn.
 * - Lỗi dữ liệu (cổng từ chối) dừng ngay chờ người dùng sửa rồi "Gửi lại"; lỗi mạng thử lại giãn dần (`decideAfterAttempt`). Dữ liệu chưa đủ/thiếu cấu hình thì GIỮ ở "Chờ gửi", hẹn xem lại sau, không tính là lần thử.
 * - Hướng chi nhánh: dòng thuộc chi nhánh của lượt khám; người dùng chỉ thấy/gửi dòng của chi nhánh hiện hành (dòng chi nhánh khác → 404). Bộ gửi nền chạy theo công ty.
 */
@Injectable()
export class PrescriptionSubmissionService {
  private readonly logger = new Logger(PrescriptionSubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: PrescriptionSubmissionRepository,
    private readonly interopService: PrescriptionInteropService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(E_PRESCRIPTION_GATEWAY_PORT) private readonly gateway: EPrescriptionGatewayPort,
    @Inject(INTEROP_SUBMISSION_SOURCE_PORT) private readonly source: InteropSubmissionSourcePort,
  ) {}

  // ---- Danh sách ----

  async list(tenantId: string, branchId: string, query: ListInteropSubmissionsQuery): Promise<ListInteropSubmissionsResponse> {
    const settings = await this.interopService.getRawSettings(tenantId);
    const { rows, total } = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.repository.list(tx, tenantId, branchId, {
        status: query.status,
        signedFrom: query.dateFrom ? startOfVietnamDayUtc(query.dateFrom) : undefined,
        signedBefore: query.dateTo ? startOfVietnamDayUtc(query.dateTo, 1) : undefined,
        limit: query.limit,
        offset: query.offset,
      }),
    );
    return { items: await this.toRows(tenantId, rows, settings.maxRetries), total, sendEnabled: settings.enabled && settings.sendEnabled };
  }

  /** Dựng dòng hiển thị: tên bác sĩ + (với dòng chưa gửi) các mục dữ liệu còn thiếu, tính từ dữ liệu HIỆN TẠI của lượt khám. */
  private async toRows(tenantId: string, records: PrescriptionSubmissionRecord[], maxRetries: number): Promise<InteropSubmissionRow[]> {
    const doctorIds = [...new Set(records.map((r) => r.doctorUserId))];
    const names = doctorIds.length > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, doctorIds) : new Map<string, string>();

    const needData = records.filter((r) => r.status === 'PENDING' || r.status === 'FAILED');
    const inputsByEncounter = new Map<string, InteropSubmissionInput[]>();
    for (const encounterId of new Set(needData.map((r) => r.encounterId))) {
      const snapshot = await this.source.loadForEncounter(tenantId, encounterId);
      inputsByEncounter.set(encounterId, snapshot?.inputs ?? []);
    }

    return records.map((r) => {
      let missing: InteropProblem[] = [];
      let missingCount: number | null = null;
      if (r.status === 'PENDING' || r.status === 'FAILED') {
        const input = inputsByEncounter.get(r.encounterId)?.find((i) => i.nationalCode === r.nationalCode);
        missing = input ? checkInteropReadiness(input) : [];
        missingCount = blockingInteropProblems(missing).length;
      }
      return {
        id: r.id,
        encounterId: r.encounterId,
        nationalCode: r.nationalCode,
        kind: r.kind,
        doctorName: names.get(r.doctorUserId) ?? null,
        signedAt: r.signedAt.toISOString(),
        status: r.status,
        attempts: r.attempts,
        maxRetries,
        lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
        nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
        sentAt: r.sentAt?.toISOString() ?? null,
        lastHttpStatus: r.lastHttpStatus,
        errors: r.errors,
        missingCount,
        missing,
      };
    });
  }

  // ---- "Gửi ngay" / "Gửi lại" ----

  async sendNow(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, mode: 'SEND' | 'RETRY', meta: RequestMeta): Promise<InteropSubmissionActionResponse> {
    // Kiểm dòng có thuộc chi nhánh/người dùng TRƯỚC (id lạ → 404 như cô lập chi nhánh), rồi mới tới công tắc gửi.
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const record = await this.repository.findInBranch(tx, tenantId, branchId, id);
      // `data_scope=personal` của quyền ký: chỉ gửi đơn do chính mình ký.
      if (!record || (dataScope === 'personal' && record.doctorUserId !== actorId)) throw new NotFoundException();
    });
    const settings = await this.interopService.getRawSettings(tenantId);
    if (!settings.enabled || !settings.sendEnabled) throw new InteropSendDisabledError();

    const claimed = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const record = await this.repository.findInBranch(tx, tenantId, branchId, id);
      if (!record) throw new NotFoundException();
      if (record.status === 'SENT' || record.status === 'AMENDED') throw new InteropSubmissionNotSendableError('STATE');
      if ((await this.repository.claimOne(tx, tenantId, branchId, id, INTEROP_SEND_LEASE_MINUTES)) === 0) throw new InteropSubmissionNotSendableError('BUSY');
      return record;
    });

    const result = await this.process(tenantId, actorId, claimed, settings, { resetAttempts: mode === 'RETRY' });

    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription_interop.submission_retried',
        entityType: 'prescription_submission',
        entityId: id,
        afterJson: { mode, outcome: result.outcome } as unknown as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
    const [row] = await this.reloadRows(tenantId, branchId, id, settings.maxRetries);
    if (!row) throw new NotFoundException();
    return { row, outcome: result.outcome, message: result.message };
  }

  private async reloadRows(tenantId: string, branchId: string, id: string, maxRetries: number): Promise<InteropSubmissionRow[]> {
    const record = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.findInBranch(tx, tenantId, branchId, id));
    return record ? this.toRows(tenantId, [record], maxRetries) : [];
  }

  // ---- Bộ gửi nền ----

  async runDueForAllTenants(): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
    let processed = 0;
    for (const tenant of tenants) {
      try {
        processed += await this.runDueForTenant(tenant.id);
      } catch (err) {
        // Chỉ ghi loại lỗi + id công ty (UUID) — không ghi nội dung đơn/bệnh nhân.
        this.logger.error(`Bộ gửi đơn thuốc liên thông lỗi ở công ty ${tenant.id}: ${err instanceof Error ? err.name : 'không rõ'}`);
      }
    }
    return processed;
  }

  /** Xử lý các đơn đến hạn của MỘT công ty. Chỉ chạy khi cả "Có liên thông" và "Gửi đơn lên cổng" đang bật. */
  async runDueForTenant(tenantId: string): Promise<number> {
    const settings = await this.interopService.getRawSettings(tenantId);
    if (!settings.enabled || !settings.sendEnabled) return 0;
    const ids = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.claimDue(tx, tenantId, DUE_BATCH_SIZE, INTEROP_SEND_LEASE_MINUTES));
    for (const id of ids) {
      const record = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.findById(tx, tenantId, id));
      if (!record) continue;
      await this.process(tenantId, SYSTEM_ACTOR_ID, record, settings, { resetAttempts: false });
    }
    return ids.length;
  }

  // ---- Xử lý một đơn (đã "thuê") ----

  private async process(
    tenantId: string,
    actorId: string,
    record: PrescriptionSubmissionRecord,
    settings: PrescriptionInteropSettings,
    ctx: { resetAttempts: boolean },
  ): Promise<ProcessResult> {
    try {
      return await this.processUnsafe(tenantId, actorId, record, settings, ctx);
    } catch (err) {
      this.logger.error(`Gửi đơn thuốc liên thông ${record.id} lỗi hệ thống: ${err instanceof Error ? err.name : 'không rõ'}`);
      // Luôn nhả "thuê" để đơn không kẹt; hẹn xem lại sau, không tính là lần thử.
      const message = 'Lỗi hệ thống khi gửi đơn, sẽ thử lại sau.';
      await this.hold(tenantId, actorId, record, ctx.resetAttempts ? 0 : record.attempts, [message]);
      return { outcome: 'NOT_READY', message };
    }
  }

  private async processUnsafe(
    tenantId: string,
    actorId: string,
    record: PrescriptionSubmissionRecord,
    settings: PrescriptionInteropSettings,
    ctx: { resetAttempts: boolean },
  ): Promise<ProcessResult> {
    const baseAttempts = ctx.resetAttempts ? 0 : record.attempts;
    const snapshot = await this.source.loadForEncounter(tenantId, record.encounterId);
    const input = snapshot?.inputs.find((i) => i.nationalCode === record.nationalCode);
    if (!snapshot || !input) {
      const message = 'Không đọc được dữ liệu của đơn (lượt khám hoặc đơn thuốc đã thay đổi).';
      await this.hold(tenantId, actorId, record, baseAttempts, [message]);
      return { outcome: 'NOT_READY', message };
    }

    const blocking = blockingInteropProblems(checkInteropReadiness(input));
    if (blocking.length > 0) {
      await this.hold(tenantId, actorId, record, baseAttempts, []);
      return { outcome: 'NOT_READY', message: `Dữ liệu chưa đủ để gửi: còn thiếu ${blocking.length} mục. Bổ sung ở màn kê đơn rồi gửi lại.` };
    }

    const endpoint = { baseUrl: settings.gatewayUrl, timeoutMs: settings.timeoutSeconds * 1000 };
    let token = await this.interopService.ensureDoctorToken(tenantId, actorId, record.branchId, record.doctorUserId, settings);
    if (token.kind === 'fail') return this.failFromLogin(tenantId, actorId, record, baseAttempts, settings, token.result);

    const payload = buildGuiDonThuocPayload(input) as unknown as Record<string, unknown>;
    let call = await this.gateway.submitPrescription(endpoint, token.value, payload);
    if (call.kind === 'unauthorized') {
      // Token bác sĩ hết hạn/bị thu hồi: đăng nhập lại và thử đúng MỘT lần nữa.
      token = await this.interopService.ensureDoctorToken(tenantId, actorId, record.branchId, record.doctorUserId, settings, true);
      if (token.kind === 'fail') return this.failFromLogin(tenantId, actorId, record, baseAttempts, settings, token.result);
      call = await this.gateway.submitPrescription(endpoint, token.value, payload);
    }

    const attempts = baseAttempts + 1;
    const now = new Date();
    if (call.kind === 'ok') {
      await this.finish(tenantId, actorId, record, { status: 'SENT', attempts, lastAttemptAt: now, nextAttemptAt: null, lastHttpStatus: 200, errors: [], sentAt: now }, 'SENT');
      return { outcome: 'SENT', message: 'Cổng đã nhận đơn thuốc.' };
    }
    if (call.kind === 'unreachable') {
      return this.afterUnreachable(tenantId, actorId, record, attempts, settings, call.message);
    }
    // rejected (422/4xx) hoặc 401 sau khi đã đăng nhập lại: lỗi dữ liệu/quyền → dừng, chờ người dùng.
    const status = call.kind === 'rejected' ? call.status : 401;
    const errors = call.errors.length > 0 ? call.errors : [`Cổng từ chối đơn thuốc (mã ${status}).`];
    await this.finish(tenantId, actorId, record, { status: 'FAILED', attempts, lastAttemptAt: now, nextAttemptAt: null, lastHttpStatus: status, errors, sentAt: null }, 'FAILED');
    return { outcome: 'REJECTED', message: 'Cổng từ chối đơn thuốc. Xem nội dung lỗi, bổ sung dữ liệu rồi bấm "Gửi lại".' };
  }

  /** Không đăng nhập được bác sĩ (hoặc thiếu mã/mật khẩu): thiếu cấu hình → giữ chờ; cổng từ chối → lỗi; mất kết nối → thử lại giãn dần. */
  private async failFromLogin(
    tenantId: string,
    actorId: string,
    record: PrescriptionSubmissionRecord,
    baseAttempts: number,
    settings: PrescriptionInteropSettings,
    result: { outcome: string; message: string; errors: string[] },
  ): Promise<ProcessResult> {
    if (result.outcome === 'NOT_CONFIGURED') {
      await this.hold(tenantId, actorId, record, baseAttempts, [result.message]);
      return { outcome: 'NOT_CONFIGURED', message: result.message };
    }
    const attempts = baseAttempts + 1;
    if (result.outcome === 'UNREACHABLE') return this.afterUnreachable(tenantId, actorId, record, attempts, settings, result.message);
    const now = new Date();
    await this.finish(
      tenantId,
      actorId,
      record,
      { status: 'FAILED', attempts, lastAttemptAt: now, nextAttemptAt: null, lastHttpStatus: null, errors: result.errors.length > 0 ? result.errors : [result.message], sentAt: null },
      'FAILED',
    );
    return { outcome: 'REJECTED', message: result.message };
  }

  private async afterUnreachable(tenantId: string, actorId: string, record: PrescriptionSubmissionRecord, attempts: number, settings: PrescriptionInteropSettings, reason: string): Promise<ProcessResult> {
    const now = new Date();
    const decision = decideAfterAttempt('unreachable', attempts, settings.maxRetries, now);
    const errors = [`Chưa kết nối được cổng: ${reason}.`];
    if (decision.next === 'RETRY') {
      await this.finish(tenantId, actorId, record, { status: 'PENDING', attempts, lastAttemptAt: now, nextAttemptAt: decision.at, lastHttpStatus: null, errors, sentAt: null }, null);
    } else {
      await this.finish(tenantId, actorId, record, { status: 'FAILED', attempts, lastAttemptAt: now, nextAttemptAt: null, lastHttpStatus: null, errors, sentAt: null }, 'FAILED');
    }
    return { outcome: 'UNREACHABLE', message: `Chưa kết nối được cổng đơn thuốc quốc gia: ${reason}.` };
  }

  /** Giữ ở "Chờ gửi", hẹn xem lại sau (không tính là lần thử). `attempts` giữ nguyên (hoặc 0 khi người dùng bấm "Gửi lại"). */
  private async hold(tenantId: string, actorId: string, record: PrescriptionSubmissionRecord, attempts: number, errors: string[]): Promise<void> {
    const now = new Date();
    const outcome: SubmissionOutcomeData = {
      status: 'PENDING',
      attempts,
      lastAttemptAt: record.lastAttemptAt,
      nextAttemptAt: new Date(now.getTime() + INTEROP_NOT_READY_RECHECK_MINUTES * 60_000),
      lastHttpStatus: record.lastHttpStatus,
      errors,
      sentAt: null,
    };
    await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.release(tx, tenantId, actorId, record.id, outcome));
  }

  /** Ghi kết quả và nhả "thuê"; khi kết thúc (đã gửi / dừng ở lỗi) ghi nhật ký — KHÔNG có nội dung đơn hay dữ liệu bệnh nhân. */
  private async finish(tenantId: string, actorId: string, record: PrescriptionSubmissionRecord, outcome: SubmissionOutcomeData, terminal: 'SENT' | 'FAILED' | null): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.repository.release(tx, tenantId, actorId, record.id, outcome);
      if (terminal === 'SENT') {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'prescription_interop.submission_sent',
          entityType: 'prescription_submission',
          entityId: record.id,
          afterJson: { nationalCode: record.nationalCode, attempts: outcome.attempts } as unknown as Prisma.InputJsonValue,
        });
      } else if (terminal === 'FAILED') {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'prescription_interop.submission_failed',
          entityType: 'prescription_submission',
          entityId: record.id,
          afterJson: { nationalCode: record.nationalCode, attempts: outcome.attempts, httpStatus: outcome.lastHttpStatus } as unknown as Prisma.InputJsonValue,
        });
      }
    });
  }
}
