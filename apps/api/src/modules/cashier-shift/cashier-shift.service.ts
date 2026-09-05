import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CashierShift as CashierShiftRow, CashierShiftDiscrepancyResolution, Prisma } from '@prisma/client';
import {
  CashierShiftAlreadyOpenError,
  CashierShiftDiscrepancyReasonRequiredError,
  CashierShiftNotClosedError,
  CashierShiftNotOpenError,
  CLINIC_CONFIG_READER_PORT,
  computeCashierShiftTotals,
  ConcurrentModificationError,
  deriveShiftLabel,
  DOCTOR_DIRECTORY_PORT,
  REFERENCE_CATALOG_READER_PORT,
  vietnamDayRange,
  type CashierShiftPaymentInput,
  type CashierShiftReaderPort,
  type CashierShiftTotals,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
  type ReferenceCatalogReaderPort,
} from '@nexamed/core';
import type {
  CashierShiftDetail,
  CashierShiftSummary,
  CloseCashierShiftRequest,
  CurrentCashierShiftResponse,
  DataScope,
  EditCashierShiftRequest,
  ListCashierShiftsQuery,
  ListCashierShiftsResponse,
  NonCashBreakdownItem,
  OpenCashierShiftRequest,
  ResolveCashierShiftDiscrepancyRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { PaymentRepository } from '../billing/payment.repository';
import { CashVoucherRepository, type CashVoucherCashierShiftRow } from '../cash-book/cash-voucher.repository';
import { CashierShiftRepository, type EditCashierShiftData } from './cashier-shift.repository';

type PaymentMethodMap = Map<string, { name: string; countsAsCash: boolean }>;

/**
 * Điều phối use case "Chốt ca" (đối soát tiền mặt/két, ngoài kế hoạch, mockup duyệt 2026-09-03).
 * Mặc định (`cashierShiftMultiCashierEnabled=false`): 1 két dùng chung toàn tenant — mọi truy vấn
 * `payment` lọc theo THỜI GIAN mở/đóng ca, KHÔNG theo người thực hiện, bất kỳ ai xử lý thu ngân
 * trong khung giờ ca đang mở đều tính vào ca đó (đúng bản chất tiền vào CÙNG 1 két vật lý). "Đa thu
 * ngân" (2026-09-04, `docs/DECISIONS.md`, TẮT mặc định — giữ nguyên hành vi trên): mỗi thu ngân mở
 * ca RIÊNG, chạy song song — mọi phương thức dưới đây đọc `cashierShiftMultiCashierEnabled` qua
 * `ClinicConfigReaderPort` và rẽ nhánh, KHÔNG đổi code nhánh mặc định.
 */
@Injectable()
export class CashierShiftService implements CashierShiftReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly cashierShiftRepository: CashierShiftRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly cashVoucherRepository: CashVoucherRepository,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  /** `CashierShiftReaderPort` — `billing` gọi để gắn `payment.cashierShiftId` lúc thu/hoàn tiền. */
  async getRelevantOpenShiftId(tenantId: string, actorId: string): Promise<string | null> {
    const multiCashierEnabled = await this.clinicConfigReader.getCashierShiftMultiCashierEnabled(tenantId);
    const row = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      multiCashierEnabled ? this.cashierShiftRepository.findOpenForCashier(tx, tenantId, actorId) : this.cashierShiftRepository.findOpen(tx, tenantId),
    );
    return row?.id ?? null;
  }

  /** `CashierShiftReaderPort` ("Thu chi tại quầy" GĐ1) — `cash-book` gọi để khoá sửa/huỷ phiếu gắn ca đã chốt. */
  async isCashierShiftOpen(tenantId: string, cashierShiftId: string): Promise<boolean> {
    const row = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.cashierShiftRepository.findById(tx, tenantId, cashierShiftId));
    return row?.status === 'OPEN';
  }

  async getCurrent(tenantId: string, actorId: string): Promise<CurrentCashierShiftResponse> {
    const multiCashierEnabled = await this.clinicConfigReader.getCashierShiftMultiCashierEnabled(tenantId);
    const { open, lastClosed } = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const openRow = multiCashierEnabled
        ? await this.cashierShiftRepository.findOpenForCashier(tx, tenantId, actorId)
        : await this.cashierShiftRepository.findOpen(tx, tenantId);
      const lastClosedRow = openRow ? null : await this.cashierShiftRepository.findLastClosed(tx, tenantId, multiCashierEnabled ? actorId : undefined);
      return { open: openRow, lastClosed: lastClosedRow };
    });

    const idsToResolve = new Set<string>();
    if (open) this.collectActorIds(open).forEach((id) => idsToResolve.add(id));
    if (lastClosed) idsToResolve.add(lastClosed.cashierId);
    const names = idsToResolve.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...idsToResolve]) : new Map<string, string>();

    return {
      openShift: open ? this.toDetail(open, names) : null,
      previousClosedShift: lastClosed
        ? {
            shiftNo: lastClosed.shiftNo,
            cashierName: names.get(lastClosed.cashierId) ?? 'Không rõ',
            shiftLabel: lastClosed.shiftLabel,
            closedAt: lastClosed.closedAt!.toISOString(),
            keepForNextAmount: Number(lastClosed.keepForNextAmount ?? 0),
            handoverNote: lastClosed.handoverNote,
          }
        : null,
    };
  }

  async openShift(tenantId: string, actorId: string, dto: OpenCashierShiftRequest, meta: RequestMeta): Promise<CashierShiftDetail> {
    const multiCashierEnabled = await this.clinicConfigReader.getCashierShiftMultiCashierEnabled(tenantId);
    const created = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      // Khoá tay (advisory lock) TRƯỚC bước kiểm tra "đã có ca mở chưa" — bắt buộc phải có, vì
      // partial unique index DB giờ chỉ còn chặn theo TỪNG thu ngân (cashier_shift_one_open_per_
      // cashier), không còn tự chặn "chỉ 1 ca toàn tenant" như trước #116. TẮT "Đa thu ngân": khoá
      // theo `tenantId` — giữ đúng đảm bảo cũ (2 thu ngân khác nhau mở gần như đồng thời → đúng 1
      // thành công), chỉ khác là DB không còn tự lo phần này, phải khoá tay. BẬT: khoá theo
      // `tenantId:actorId` — chỉ chặn CHÍNH người đó mở 2 lần, không tranh chấp người khác.
      const lockKey = multiCashierEnabled ? `${tenantId}:${actorId}` : tenantId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

      const existing = multiCashierEnabled
        ? await this.cashierShiftRepository.findOpenForCashier(tx, tenantId, actorId)
        : await this.cashierShiftRepository.findOpen(tx, tenantId);
      if (existing) {
        throw new CashierShiftAlreadyOpenError();
      }

      const lastClosed = await this.cashierShiftRepository.findLastClosed(tx, tenantId, multiCashierEnabled ? actorId : undefined);
      const openingFloatExpected = lastClosed ? Number(lastClosed.keepForNextAmount ?? 0) : null;
      if (openingFloatExpected !== null && openingFloatExpected !== dto.openingFloatActual && !dto.openingDiscrepancyReason) {
        throw new CashierShiftDiscrepancyReasonRequiredError();
      }

      const openedAt = new Date();
      const row = await this.cashierShiftRepository.create(tx, tenantId, actorId, {
        shiftLabel: deriveShiftLabel(openedAt),
        openedAt,
        openingFloatExpected,
        openingFloatActual: dto.openingFloatActual,
        openingDiscrepancyReason: dto.openingDiscrepancyReason ?? null,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cashier_shift.opened',
        entityType: 'cashier_shift',
        entityId: row.id,
        afterJson: {
          shiftNo: row.shiftNo,
          openingFloatActual: dto.openingFloatActual,
          openingFloatExpected,
          reason: dto.openingDiscrepancyReason ?? null,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return row;
    });

    const names = await this.doctorDirectory.getUserFullNames(tenantId, [actorId]);
    return this.toDetail(created, names);
  }

  /** Dùng chung cho `GET .../summary` (preview SỐNG lúc đang mở ca) lẫn `GET .../resync-preview` (đã chốt). */
  async getSummary(tenantId: string, id: string): Promise<CashierShiftSummary> {
    const methodMap = await this.loadPaymentMethodMap(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const row = await this.cashierShiftRepository.findById(tx, tenantId, id);
      if (!row) {
        throw new NotFoundException();
      }
      const totals = await this.computeTotals(tx, tenantId, row, methodMap);
      return this.toSummaryDto(totals);
    });
  }

  async close(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: CloseCashierShiftRequest, meta: RequestMeta): Promise<CashierShiftDetail> {
    const methodMap = await this.loadPaymentMethodMap(tenantId);
    const closed = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const row = await this.cashierShiftRepository.findById(tx, tenantId, id);
      if (!row) {
        throw new NotFoundException();
      }
      if (row.status !== 'OPEN') {
        throw new CashierShiftNotOpenError();
      }
      // Chỉ đúng người đã mở ca (hoặc Quản lý) mới chốt được — RBAC chỉ gác "được thử", không phân
      // biệt "đúng ca của mình" (đúng khuôn `WorkShiftAssignmentService`, ẩn dạng 404 thay vì 403).
      if (dataScope === 'personal' && row.cashierId !== actorId) {
        throw new NotFoundException();
      }

      const closedAt = new Date();
      const totals = await this.computeTotals(tx, tenantId, row, methodMap, closedAt);
      const diff = dto.countedCashAmount - totals.expectedCashAmount;
      if (diff !== 0 && !dto.cashDiscrepancyReason) {
        throw new CashierShiftDiscrepancyReasonRequiredError();
      }
      const submittedAmount = Math.max(dto.countedCashAmount - dto.keepForNextAmount, 0);

      const count = await this.cashierShiftRepository.close(tx, tenantId, id, dto.version, actorId, {
        cashInAmount: totals.cashInAmount,
        cashOutAmount: totals.cashOutAmount,
        nonCashBreakdownJson: totals.nonCashBreakdown,
        expectedCashAmount: totals.expectedCashAmount,
        countedCashAmount: dto.countedCashAmount,
        cashDiscrepancyReason: diff !== 0 ? (dto.cashDiscrepancyReason ?? null) : null,
        keepForNextAmount: dto.keepForNextAmount,
        submittedAmount,
        handoverNote: dto.handoverNote ?? null,
        closedAt,
        otherCashInAmount: totals.otherCashInAmount,
        otherCashOutAmount: totals.otherCashOutAmount,
      });
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cashier_shift.closed',
        entityType: 'cashier_shift',
        entityId: id,
        afterJson: {
          countedCashAmount: dto.countedCashAmount,
          expectedCashAmount: totals.expectedCashAmount,
          discrepancy: diff,
          keepForNextAmount: dto.keepForNextAmount,
          submittedAmount,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.cashierShiftRepository.findById(tx, tenantId, id);
    });

    const names = await this.doctorDirectory.getUserFullNames(tenantId, this.collectActorIds(closed!));
    return this.toDetail(closed!, names);
  }

  async getDetail(tenantId: string, actorId: string, dataScope: DataScope, id: string): Promise<CashierShiftDetail> {
    const row = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.cashierShiftRepository.findById(tx, tenantId, id));
    if (!row || (dataScope === 'personal' && row.cashierId !== actorId)) {
      throw new NotFoundException();
    }
    const names = await this.doctorDirectory.getUserFullNames(tenantId, this.collectActorIds(row));
    return this.toDetail(row, names);
  }

  async list(tenantId: string, dataScope: DataScope, query: ListCashierShiftsQuery): Promise<ListCashierShiftsResponse> {
    // "Danh sách phiếu chốt ca" là màn Quản lý/Kế toán — scope `personal` (thu ngân) không có gì để
    // duyệt qua đây (chỉ xem ca hiện tại của mình qua `GET .../current`).
    if (dataScope === 'personal') {
      throw new ForbiddenException();
    }

    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.cashierShiftRepository.list(tx, tenantId, {
        dateFrom: query.dateFrom ? vietnamDayRange(query.dateFrom).startUtc : undefined,
        dateTo: query.dateTo ? vietnamDayRange(query.dateTo).endUtc : undefined,
        cashierId: query.cashierId,
      }),
    );

    const cashierIds = [...new Set(rows.map((row) => row.cashierId))];
    const names = cashierIds.length > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, cashierIds) : new Map<string, string>();

    const items = rows.map((row) => {
      const expected = row.expectedCashAmount !== null ? Number(row.expectedCashAmount) : null;
      const counted = row.countedCashAmount !== null ? Number(row.countedCashAmount) : null;
      return {
        id: row.id,
        shiftNo: row.shiftNo,
        cashierName: names.get(row.cashierId) ?? 'Không rõ',
        shiftLabel: row.shiftLabel,
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
        expectedCashAmount: expected,
        countedCashAmount: counted,
        submittedAmount: row.submittedAmount !== null ? Number(row.submittedAmount) : null,
        cashDiscrepancyAmount: counted !== null && expected !== null ? counted - expected : 0,
        status: row.status,
        editedAt: row.editedAt?.toISOString() ?? null,
      };
    });

    const filtered =
      query.status === 'ok'
        ? items.filter((item) => item.cashDiscrepancyAmount === 0)
        : query.status === 'bad'
          ? items.filter((item) => item.cashDiscrepancyAmount !== 0)
          : items;
    const discrepancyItems = items.filter((item) => item.cashDiscrepancyAmount !== 0);

    return {
      items: filtered,
      totalCount: items.length,
      totalSubmittedAmount: items.reduce((sum, item) => sum + (item.submittedAmount ?? 0), 0),
      pendingApprovalCount: rows.filter((row) => row.status === 'CLOSED').length,
      discrepancyCount: discrepancyItems.length,
      discrepancyTotalAmount: discrepancyItems.reduce((sum, item) => sum + item.cashDiscrepancyAmount, 0),
    };
  }

  async resolveDiscrepancy(tenantId: string, actorId: string, id: string, dto: ResolveCashierShiftDiscrepancyRequest, meta: RequestMeta): Promise<CashierShiftDetail> {
    const updated = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const row = await this.cashierShiftRepository.findById(tx, tenantId, id);
      if (!row) {
        throw new NotFoundException();
      }
      if (row.status === 'OPEN') {
        throw new CashierShiftNotClosedError();
      }
      const count = await this.cashierShiftRepository.resolveDiscrepancy(tx, tenantId, id, dto.version, actorId, dto.method as CashierShiftDiscrepancyResolution, dto.note ?? null);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cashier_shift.discrepancy_resolved',
        entityType: 'cashier_shift',
        entityId: id,
        afterJson: { method: dto.method, note: dto.note ?? null },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.cashierShiftRepository.findById(tx, tenantId, id);
    });
    const names = await this.doctorDirectory.getUserFullNames(tenantId, this.collectActorIds(updated!));
    return this.toDetail(updated!, names);
  }

  async approve(tenantId: string, actorId: string, id: string, version: number, meta: RequestMeta): Promise<CashierShiftDetail> {
    const updated = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const row = await this.cashierShiftRepository.findById(tx, tenantId, id);
      if (!row) {
        throw new NotFoundException();
      }
      if (row.status !== 'CLOSED') {
        throw new CashierShiftNotClosedError();
      }
      const count = await this.cashierShiftRepository.approve(tx, tenantId, id, version, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cashier_shift.approved',
        entityType: 'cashier_shift',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.cashierShiftRepository.findById(tx, tenantId, id);
    });
    const names = await this.doctorDirectory.getUserFullNames(tenantId, this.collectActorIds(updated!));
    return this.toDetail(updated!, names);
  }

  /** "Mở khoá để sửa" — CHỈ áp dụng cho ca đã CLOSED/APPROVED, `reason` bắt buộc (ghi audit before/after). */
  async edit(tenantId: string, actorId: string, id: string, dto: EditCashierShiftRequest, meta: RequestMeta): Promise<CashierShiftDetail> {
    const methodMap = dto.resyncSystemTotals ? await this.loadPaymentMethodMap(tenantId) : null;

    const updated = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const before = await this.cashierShiftRepository.findById(tx, tenantId, id);
      if (!before) {
        throw new NotFoundException();
      }
      if (before.status === 'OPEN') {
        throw new CashierShiftNotClosedError();
      }

      const editData: EditCashierShiftData = { editedBy: actorId, editedAt: new Date() };
      if (dto.countedCashAmount !== undefined) editData.countedCashAmount = dto.countedCashAmount;
      if (dto.keepForNextAmount !== undefined) editData.keepForNextAmount = dto.keepForNextAmount;
      if (dto.cashDiscrepancyReason !== undefined) editData.cashDiscrepancyReason = dto.cashDiscrepancyReason;
      if (dto.handoverNote !== undefined) editData.handoverNote = dto.handoverNote;
      if (dto.countedCashAmount !== undefined || dto.keepForNextAmount !== undefined) {
        const nextCounted = dto.countedCashAmount ?? Number(before.countedCashAmount ?? 0);
        const nextKeep = dto.keepForNextAmount ?? Number(before.keepForNextAmount ?? 0);
        editData.submittedAmount = Math.max(nextCounted - nextKeep, 0);
      }
      if (dto.resyncSystemTotals && methodMap) {
        const totals = await this.computeTotals(tx, tenantId, before, methodMap);
        editData.cashInAmount = totals.cashInAmount;
        editData.cashOutAmount = totals.cashOutAmount;
        editData.nonCashBreakdownJson = totals.nonCashBreakdown;
        editData.expectedCashAmount = totals.expectedCashAmount;
        editData.otherCashInAmount = totals.otherCashInAmount;
        editData.otherCashOutAmount = totals.otherCashOutAmount;
      }

      const count = await this.cashierShiftRepository.edit(tx, tenantId, id, dto.version, actorId, editData);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
      const after = await this.cashierShiftRepository.findById(tx, tenantId, id);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cashier_shift.edited',
        entityType: 'cashier_shift',
        entityId: id,
        beforeJson: { ...this.toAuditSnapshot(before), reason: dto.reason },
        afterJson: this.toAuditSnapshot(after!),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return after;
    });

    const names = await this.doctorDirectory.getUserFullNames(tenantId, this.collectActorIds(updated!));
    return this.toDetail(updated!, names);
  }

  // ---------------- helpers ----------------

  private async loadPaymentMethodMap(tenantId: string): Promise<PaymentMethodMap> {
    const rows = await this.referenceCatalogReader.listByCategory(tenantId, 'PAYMENT_METHOD');
    return new Map(rows.map((row) => [row.code, { name: row.name, countsAsCash: row.countsAsCash }]));
  }

  private buildPaymentInputs(rows: Array<{ method: string; type: 'PAYMENT' | 'REFUND'; amount: bigint }>, methodMap: PaymentMethodMap): CashierShiftPaymentInput[] {
    return rows.map((row) => {
      const meta = methodMap.get(row.method);
      return {
        methodCode: row.method,
        methodLabel: meta?.name ?? row.method,
        isCash: meta?.countsAsCash ?? false,
        type: row.type,
        amount: Number(row.amount),
      };
    });
  }

  /** "Thu chi tại quầy" GĐ1 — `direction` INCOME/EXPENSE ánh xạ sang `type` PAYMENT/REFUND đúng
   * chiều tiền (thu vào/chi ra khỏi két), `source:'VOUCHER'` để `computeCashierShiftTotals()` tách
   * riêng được ở `otherCashIn/OutAmount` (vẫn cộng vào tổng gộp `cashIn/OutAmount` như bình thường). */
  private buildVoucherInputs(rows: CashVoucherCashierShiftRow[], methodMap: PaymentMethodMap): CashierShiftPaymentInput[] {
    return rows.map((row) => {
      const meta = methodMap.get(row.paymentMethodCode);
      return {
        methodCode: row.paymentMethodCode,
        methodLabel: meta?.name ?? row.paymentMethodCode,
        isCash: meta?.countsAsCash ?? false,
        type: row.direction === 'INCOME' ? 'PAYMENT' : 'REFUND',
        amount: Number(row.amount),
        source: 'VOUCHER',
      };
    });
  }

  /**
   * "Đa thu ngân" — rẽ nhánh nguồn `payment` theo công tắc HIỆN TẠI (đọc lại mỗi lần gọi, không
   * snapshot theo ca): TẮT dùng `listForWindow()` (theo khoảng thời gian, code KHÔNG đổi so với
   * trước #116 — an toàn cho ca cũ vốn không có `cashierShiftId`); BẬT dùng `listForShift()` (theo
   * FK, chỉ đúng phiếu của người mở ca này).
   */
  private async computeTotals(
    tx: Prisma.TransactionClient,
    tenantId: string,
    row: CashierShiftRow,
    methodMap: PaymentMethodMap,
    endAtOverride?: Date,
  ): Promise<CashierShiftTotals> {
    const multiCashierEnabled = await this.clinicConfigReader.getCashierShiftMultiCashierEnabled(tenantId);
    const endAt = endAtOverride ?? row.closedAt ?? new Date();
    const [paymentRows, voucherRows] = await Promise.all([
      multiCashierEnabled ? this.paymentRepository.listForShift(tx, tenantId, row.id) : this.paymentRepository.listForWindow(tx, tenantId, row.openedAt, endAt),
      multiCashierEnabled ? this.cashVoucherRepository.listPostedForShift(tx, tenantId, row.id) : this.cashVoucherRepository.listPostedForWindow(tx, tenantId, row.openedAt, endAt),
    ]);
    const inputs = [...this.buildPaymentInputs(paymentRows, methodMap), ...this.buildVoucherInputs(voucherRows, methodMap)];
    return computeCashierShiftTotals(Number(row.openingFloatActual), inputs);
  }

  private toSummaryDto(totals: CashierShiftTotals): CashierShiftSummary {
    return {
      cashInAmount: totals.cashInAmount,
      cashInCount: totals.cashInCount,
      cashOutAmount: totals.cashOutAmount,
      cashOutCount: totals.cashOutCount,
      nonCashBreakdown: totals.nonCashBreakdown as NonCashBreakdownItem[],
      expectedCashAmount: totals.expectedCashAmount,
      otherCashInAmount: totals.otherCashInAmount,
      otherCashOutAmount: totals.otherCashOutAmount,
    };
  }

  private collectActorIds(row: CashierShiftRow): string[] {
    return [row.cashierId, row.resolvedBy, row.approvedBy, row.editedBy].filter((v): v is string => v !== null);
  }

  private toAuditSnapshot(row: CashierShiftRow) {
    return {
      countedCashAmount: row.countedCashAmount !== null ? Number(row.countedCashAmount) : null,
      keepForNextAmount: row.keepForNextAmount !== null ? Number(row.keepForNextAmount) : null,
      cashDiscrepancyReason: row.cashDiscrepancyReason,
      handoverNote: row.handoverNote,
      expectedCashAmount: row.expectedCashAmount !== null ? Number(row.expectedCashAmount) : null,
    };
  }

  private toDetail(row: CashierShiftRow, names: Map<string, string>): CashierShiftDetail {
    const nonCashBreakdown = Array.isArray(row.nonCashBreakdownJson) ? (row.nonCashBreakdownJson as unknown as NonCashBreakdownItem[]) : [];
    return {
      id: row.id,
      shiftNo: row.shiftNo,
      cashierId: row.cashierId,
      cashierName: names.get(row.cashierId) ?? 'Không rõ',
      shiftLabel: row.shiftLabel,
      status: row.status,
      openedAt: row.openedAt.toISOString(),
      openingFloatExpected: row.openingFloatExpected !== null ? Number(row.openingFloatExpected) : null,
      openingFloatActual: Number(row.openingFloatActual),
      openingDiscrepancyReason: row.openingDiscrepancyReason,
      closedAt: row.closedAt?.toISOString() ?? null,
      cashInAmount: row.cashInAmount !== null ? Number(row.cashInAmount) : null,
      cashOutAmount: row.cashOutAmount !== null ? Number(row.cashOutAmount) : null,
      nonCashBreakdown,
      expectedCashAmount: row.expectedCashAmount !== null ? Number(row.expectedCashAmount) : null,
      otherCashInAmount: row.otherCashInAmount !== null ? Number(row.otherCashInAmount) : null,
      otherCashOutAmount: row.otherCashOutAmount !== null ? Number(row.otherCashOutAmount) : null,
      countedCashAmount: row.countedCashAmount !== null ? Number(row.countedCashAmount) : null,
      cashDiscrepancyReason: row.cashDiscrepancyReason,
      keepForNextAmount: row.keepForNextAmount !== null ? Number(row.keepForNextAmount) : null,
      submittedAmount: row.submittedAmount !== null ? Number(row.submittedAmount) : null,
      handoverNote: row.handoverNote,
      resolutionMethod: row.resolutionMethod,
      resolutionNote: row.resolutionNote,
      resolvedByName: row.resolvedBy ? (names.get(row.resolvedBy) ?? 'Không rõ') : null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      approvedByName: row.approvedBy ? (names.get(row.approvedBy) ?? 'Không rõ') : null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      editedByName: row.editedBy ? (names.get(row.editedBy) ?? 'Không rõ') : null,
      editedAt: row.editedAt?.toISOString() ?? null,
      version: row.version,
    };
  }
}
