import { Injectable } from '@nestjs/common';
import type { CashierShift, CashierShiftDiscrepancyResolution, Prisma } from '@prisma/client';
import { BusinessCodeService } from '../clinic/business-code.service';

export interface OpenCashierShiftData {
  shiftLabel: string;
  openedAt: Date;
  openingFloatExpected: number | null;
  openingFloatActual: number;
  openingDiscrepancyReason: string | null;
}

export interface CloseCashierShiftData {
  cashInAmount: number;
  cashOutAmount: number;
  nonCashBreakdownJson: unknown;
  expectedCashAmount: number;
  countedCashAmount: number;
  cashDiscrepancyReason: string | null;
  keepForNextAmount: number;
  submittedAmount: number;
  handoverNote: string | null;
  closedAt: Date;
}

export interface ListCashierShiftFilters {
  dateFrom?: Date;
  dateTo?: Date;
  cashierId?: string;
}

export interface EditCashierShiftData {
  countedCashAmount?: number;
  keepForNextAmount?: number;
  submittedAmount?: number;
  cashDiscrepancyReason?: string;
  handoverNote?: string;
  cashInAmount?: number;
  cashOutAmount?: number;
  nonCashBreakdownJson?: unknown;
  expectedCashAmount?: number;
  editedBy: string;
  editedAt: Date;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `cashier_shift` ("Chốt ca", ngoài kế hoạch, mockup duyệt
 * 2026-09-03) — module `cashier-shift` sở hữu.
 */
@Injectable()
export class CashierShiftRepository {
  constructor(private readonly businessCodeService: BusinessCodeService) {}

  async create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: OpenCashierShiftData): Promise<CashierShift> {
    const shiftNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'CASHIER_SHIFT', data.openedAt);
    return tx.cashierShift.create({
      data: {
        tenantId,
        shiftNo,
        cashierId: actorId,
        shiftLabel: data.shiftLabel,
        status: 'OPEN',
        openedAt: data.openedAt,
        openingFloatExpected: data.openingFloatExpected !== null ? BigInt(data.openingFloatExpected) : null,
        openingFloatActual: BigInt(data.openingFloatActual),
        openingDiscrepancyReason: data.openingDiscrepancyReason,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  findOpen(tx: Prisma.TransactionClient, tenantId: string): Promise<CashierShift | null> {
    return tx.cashierShift.findFirst({ where: { tenantId, status: 'OPEN', deletedAt: null } });
  }

  /** Ca CLOSED/APPROVED gần nhất TOÀN TENANT (bất kỳ ai) — nguồn "vốn ca trước để lại" cho lần Mở ca tiếp theo. */
  findLastClosed(tx: Prisma.TransactionClient, tenantId: string): Promise<CashierShift | null> {
    return tx.cashierShift.findFirst({
      where: { tenantId, status: { in: ['CLOSED', 'APPROVED'] }, deletedAt: null },
      orderBy: { closedAt: 'desc' },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<CashierShift | null> {
    return tx.cashierShift.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  list(tx: Prisma.TransactionClient, tenantId: string, filters: ListCashierShiftFilters): Promise<CashierShift[]> {
    const where: Prisma.CashierShiftWhereInput = { tenantId, deletedAt: null, status: { not: 'OPEN' } };
    if (filters.cashierId) {
      where.cashierId = filters.cashierId;
    }
    if (filters.dateFrom || filters.dateTo) {
      where.openedAt = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lt: filters.dateTo } : {}),
      };
    }
    return tx.cashierShift.findMany({ where, orderBy: { openedAt: 'desc' } });
  }

  /** `WHERE version=? AND status='OPEN'` — chống double-submit/race khi 2 request "Chốt ca" gần như đồng thời. */
  close(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, data: CloseCashierShiftData): Promise<number> {
    return tx.cashierShift
      .updateMany({
        where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          closedAt: data.closedAt,
          cashInAmount: BigInt(data.cashInAmount),
          cashOutAmount: BigInt(data.cashOutAmount),
          nonCashBreakdownJson: data.nonCashBreakdownJson as Prisma.InputJsonValue,
          expectedCashAmount: BigInt(data.expectedCashAmount),
          countedCashAmount: BigInt(data.countedCashAmount),
          cashDiscrepancyReason: data.cashDiscrepancyReason,
          keepForNextAmount: BigInt(data.keepForNextAmount),
          submittedAmount: BigInt(data.submittedAmount),
          handoverNote: data.handoverNote,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      })
      .then((r) => r.count);
  }

  resolveDiscrepancy(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    method: CashierShiftDiscrepancyResolution,
    note: string | null,
  ): Promise<number> {
    return tx.cashierShift
      .updateMany({
        where: { tenantId, id, version: expectedVersion, deletedAt: null, status: { not: 'OPEN' } },
        data: {
          resolutionMethod: method,
          resolutionNote: note,
          resolvedBy: actorId,
          resolvedAt: new Date(),
          updatedBy: actorId,
          version: { increment: 1 },
        },
      })
      .then((r) => r.count);
  }

  approve(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    return tx.cashierShift
      .updateMany({
        where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'CLOSED' },
        data: { status: 'APPROVED', approvedBy: actorId, approvedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
      })
      .then((r) => r.count);
  }

  /** "Mở khoá để sửa" — CHỈ áp dụng cho ca đã CLOSED/APPROVED, chỉ field có mặt trong `data` mới bị ghi đè. */
  edit(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, data: EditCashierShiftData): Promise<number> {
    const update: Prisma.CashierShiftUpdateManyMutationInput = {
      updatedBy: actorId,
      version: { increment: 1 },
      editedBy: data.editedBy,
      editedAt: data.editedAt,
    };
    if (data.countedCashAmount !== undefined) update.countedCashAmount = BigInt(data.countedCashAmount);
    if (data.keepForNextAmount !== undefined) update.keepForNextAmount = BigInt(data.keepForNextAmount);
    if (data.submittedAmount !== undefined) update.submittedAmount = BigInt(data.submittedAmount);
    if (data.cashDiscrepancyReason !== undefined) update.cashDiscrepancyReason = data.cashDiscrepancyReason;
    if (data.handoverNote !== undefined) update.handoverNote = data.handoverNote;
    if (data.cashInAmount !== undefined) update.cashInAmount = BigInt(data.cashInAmount);
    if (data.cashOutAmount !== undefined) update.cashOutAmount = BigInt(data.cashOutAmount);
    if (data.nonCashBreakdownJson !== undefined) update.nonCashBreakdownJson = data.nonCashBreakdownJson as Prisma.InputJsonValue;
    if (data.expectedCashAmount !== undefined) update.expectedCashAmount = BigInt(data.expectedCashAmount);

    return tx.cashierShift
      .updateMany({
        where: { tenantId, id, version: expectedVersion, deletedAt: null, status: { not: 'OPEN' } },
        data: update,
      })
      .then((r) => r.count);
  }
}
