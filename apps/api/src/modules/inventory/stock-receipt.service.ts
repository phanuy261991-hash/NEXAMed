import { Injectable, Inject, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  computeUnitConversion,
  computeWeightedAverageCost,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  StockReceiptNotDraftError,
  StockReceiptVoidNotAllowedError,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  ApproveStockReceiptRequest,
  CreateStockReceiptRequest,
  ListStockReceiptsQuery,
  ListStockReceiptsResponse,
  RejectStockReceiptRequest,
  StockReceiptDetail,
  StockReceiptSummary,
  UpdateStockReceiptRequest,
  VoidStockReceiptRequest,
} from '@nexamed/shared';
import type { Prisma, StockReceipt, StockReceiptType } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { DrugRepository, type DrugWithDetails } from '../drug/drug.repository';
import { WarehouseRepository } from '../drug/warehouse.repository';
import { SupplierRepository } from '../drug/supplier.repository';
import { StockReceiptRepository, type StockReceiptWithLines, type StockReceiptLineData } from './stock-receipt.repository';
import { InventoryBatchRepository } from './inventory-batch.repository';
import { StockLedgerRepository } from './stock-ledger.repository';
import { StockBalanceRepository } from './stock-balance.repository';

/** GĐ2 chỉ có logic thật cho 2/5 giá trị `receiptType` — 3 giá trị còn lại khai sẵn trong enum
 * cho GĐ3/4 (Chuyển kho/Hoàn trả/Cân bằng kiểm kê), chưa có gì để "duyệt" nên chặn tạo mới. */
const SUPPORTED_RECEIPT_TYPES: readonly StockReceiptType[] = ['PURCHASE', 'OPENING_BALANCE'];

@Injectable()
export class StockReceiptService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly stockReceiptRepository: StockReceiptRepository,
    private readonly drugRepository: DrugRepository,
    private readonly warehouseRepository: WarehouseRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly stockLedgerRepository: StockLedgerRepository,
    private readonly stockBalanceRepository: StockBalanceRepository,
    private readonly businessCodeService: BusinessCodeService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  async create(tenantId: string, actorId: string, dto: CreateStockReceiptRequest, meta: RequestMeta): Promise<StockReceiptDetail> {
    if (!SUPPORTED_RECEIPT_TYPES.includes(dto.receiptType)) {
      throw new UnprocessableEntityException(`Loại phiếu "${dto.receiptType}" chưa được hỗ trợ ở giai đoạn này.`);
    }

    const created = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const warehouse = await this.warehouseRepository.findById(tx, tenantId, dto.warehouseId);
      if (!warehouse) throw new NotFoundException();
      if (dto.supplierId) {
        const supplier = await this.supplierRepository.findById(tx, tenantId, dto.supplierId);
        if (!supplier) throw new NotFoundException();
      }

      const lines = await this.buildLineData(tx, tenantId, dto.lines);
      const totalAmount = lines.reduce((sum, l) => sum + l.lineAmount, 0n);
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const receiptNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_RECEIPT', occurredAt);

      const row = await this.stockReceiptRepository.create(tx, tenantId, actorId, {
        receiptNo,
        warehouseId: dto.warehouseId,
        supplierId: dto.supplierId ?? null,
        receiptType: dto.receiptType,
        occurredAt,
        note: dto.note ?? null,
        supplierInvoiceNo: dto.supplierInvoiceNo ?? null,
        totalAmount,
        lines,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_receipt.created',
        entityType: 'stock_receipt',
        entityId: row.id,
        afterJson: { receiptNo, receiptType: dto.receiptType, warehouseId: dto.warehouseId, lineCount: lines.length, totalAmount: totalAmount.toString() },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return row;
    });

    return this.getById(tenantId, created.id);
  }

  /** Sửa Nháp — bulk-replace toàn bộ dòng hàng + header, chỉ khi `status='DRAFT'`. */
  async update(tenantId: string, actorId: string, id: string, dto: UpdateStockReceiptRequest, meta: RequestMeta): Promise<StockReceiptDetail> {
    if (!SUPPORTED_RECEIPT_TYPES.includes(dto.receiptType)) {
      throw new UnprocessableEntityException(`Loại phiếu "${dto.receiptType}" chưa được hỗ trợ ở giai đoạn này.`);
    }

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockReceiptRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockReceiptNotDraftError();

      const warehouse = await this.warehouseRepository.findById(tx, tenantId, dto.warehouseId);
      if (!warehouse) throw new NotFoundException();
      if (dto.supplierId) {
        const supplier = await this.supplierRepository.findById(tx, tenantId, dto.supplierId);
        if (!supplier) throw new NotFoundException();
      }

      const lines = await this.buildLineData(tx, tenantId, dto.lines);
      const totalAmount = lines.reduce((sum, l) => sum + l.lineAmount, 0n);
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : existing.occurredAt;

      const count = await this.stockReceiptRepository.updateDraft(tx, tenantId, id, dto.version, actorId, {
        warehouseId: dto.warehouseId,
        supplierId: dto.supplierId ?? null,
        receiptType: dto.receiptType,
        occurredAt,
        note: dto.note ?? null,
        supplierInvoiceNo: dto.supplierInvoiceNo ?? null,
        totalAmount,
        lines,
      });
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_receipt.updated',
        entityType: 'stock_receipt',
        entityId: id,
        afterJson: { receiptType: dto.receiptType, warehouseId: dto.warehouseId, lineCount: lines.length, totalAmount: totalAmount.toString() },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, id);
  }

  async getById(tenantId: string, id: string): Promise<StockReceiptDetail> {
    const row = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const receipt = await this.stockReceiptRepository.findByIdAnyWithLines(tx, tenantId, id);
      if (!receipt) throw new NotFoundException();
      const warehouse = await this.warehouseRepository.findById(tx, tenantId, receipt.warehouseId);
      const supplier = receipt.supplierId ? await this.supplierRepository.findById(tx, tenantId, receipt.supplierId) : null;
      return { receipt, warehouseName: warehouse?.name ?? '—', supplierName: supplier?.name ?? null };
    });

    const names = await this.doctorDirectory.getUserFullNames(tenantId, row.receipt.approvedBy ? [row.receipt.createdBy, row.receipt.approvedBy] : [row.receipt.createdBy]);
    return this.toLineDetailDto(row.receipt, row.warehouseName, row.supplierName, names);
  }

  async list(tenantId: string, query: ListStockReceiptsQuery): Promise<ListStockReceiptsResponse> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.stockReceiptRepository.list(tx, tenantId, {
        warehouseId: query.warehouseId,
        receiptType: query.receiptType,
        status: query.status,
        from: query.from ? new Date(`${query.from}T00:00:00+07:00`) : undefined,
        to: query.to ? new Date(`${query.to}T23:59:59.999+07:00`) : undefined,
        q: query.q,
        cursor: query.cursor,
        take: query.limit + 1,
      }),
    );
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    const ids = new Set<string>();
    for (const row of page) {
      ids.add(row.createdBy);
      if (row.approvedBy) ids.add(row.approvedBy);
    }
    const names = ids.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...ids]) : new Map<string, string>();

    return { items: page.map((row) => this.toSummaryDto(row, row.warehouse.name, row.supplier?.name ?? null, row._count.lines, names)), nextCursor };
  }

  async approve(tenantId: string, actorId: string, id: string, dto: ApproveStockReceiptRequest, meta: RequestMeta): Promise<StockReceiptDetail> {
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockReceiptRepository.findByIdAnyWithLines(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockReceiptNotDraftError();

      const count = await this.stockReceiptRepository.approve(tx, tenantId, id, dto.version, actorId);
      if (count === 0) throw new ConcurrentModificationError();

      const drugCache = new Map<string, DrugWithDetails>();
      for (const line of existing.lines) {
        let drug = drugCache.get(line.drugId);
        if (!drug) {
          const found = await this.drugRepository.findByIdWithDetails(tx, tenantId, line.drugId);
          if (!found) throw new NotFoundException();
          drug = found;
          drugCache.set(line.drugId, drug);
        }

        const { baseQuantity, baseUnitCost } = this.convertLineToBaseUnit(drug, line.unitCode, line.quantity, line.unitCost);
        const reason = existing.receiptType === 'PURCHASE' ? 'RECEIPT_PURCHASE' : 'RECEIPT_OPENING_BALANCE';

        let batchId: string | null = null;
        if (drug.isBatchManaged) {
          if (!line.batchNo) throw new UnprocessableEntityException(`Thuốc/vật tư "${drug.name}" quản lý theo lô — phải nhập Số lô.`);
          const batch = await this.inventoryBatchRepository.findByKey(tx, tenantId, drug.id, existing.warehouseId, line.batchNo);
          if (batch) {
            const existingBalance = await this.stockBalanceRepository.findByKey(tx, tenantId, drug.id, existing.warehouseId, batch.id);
            const newCost = computeWeightedAverageCost(existingBalance?.quantityOnHand ?? 0, batch.unitCost, baseQuantity, baseUnitCost);
            await this.inventoryBatchRepository.updateCost(tx, tenantId, batch.id, actorId, newCost);
            batchId = batch.id;
          } else {
            const created = await this.inventoryBatchRepository.create(tx, tenantId, actorId, {
              drugId: drug.id,
              warehouseId: existing.warehouseId,
              batchNo: line.batchNo,
              expiryDate: line.expiryDate,
              unitCost: baseUnitCost,
            });
            batchId = created.id;
          }
          await this.stockBalanceRepository.upsertQuantity(tx, tenantId, actorId, { drugId: drug.id, warehouseId: existing.warehouseId, batchId, quantityDelta: baseQuantity });
        } else {
          const existingBalance = await this.stockBalanceRepository.findByKey(tx, tenantId, drug.id, existing.warehouseId, null);
          const newAverage = computeWeightedAverageCost(existingBalance?.quantityOnHand ?? 0, existingBalance?.averageUnitCost ?? 0n, baseQuantity, baseUnitCost);
          await this.stockBalanceRepository.upsertQuantity(tx, tenantId, actorId, {
            drugId: drug.id,
            warehouseId: existing.warehouseId,
            batchId: null,
            quantityDelta: baseQuantity,
            averageUnitCost: newAverage,
          });
        }

        await this.stockLedgerRepository.create(tx, tenantId, actorId, {
          drugId: drug.id,
          warehouseId: existing.warehouseId,
          batchId,
          quantityChange: baseQuantity,
          unitCost: baseUnitCost,
          reason,
          sourceReceiptId: existing.id,
          occurredAt: existing.occurredAt,
          note: null,
        });

        if (existing.receiptType === 'PURCHASE') {
          await this.drugRepository.updateLastPurchase(tx, tenantId, drug.id, actorId, baseUnitCost, existing.occurredAt);
        }
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_receipt.approved',
        entityType: 'stock_receipt',
        entityId: id,
        beforeJson: { status: 'DRAFT' },
        afterJson: { status: 'POSTED' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, id);
  }

  async reject(tenantId: string, actorId: string, id: string, dto: RejectStockReceiptRequest, meta: RequestMeta): Promise<StockReceiptDetail> {
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockReceiptRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockReceiptNotDraftError();

      const count = await this.stockReceiptRepository.reject(tx, tenantId, id, dto.version, actorId, dto.reason);
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_receipt.rejected',
        entityType: 'stock_receipt',
        entityId: id,
        beforeJson: { status: 'DRAFT' },
        afterJson: { status: 'REJECTED', reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, id);
  }

  /** Huỷ phiếu ĐÃ DUYỆT — đảo NGƯỢC đúng các dòng `stock_ledger` mà chính phiếu này đã sinh ra
   * (`sourceReceiptId=id`), KHÔNG tính lại từ `stock_receipt_line`/chuỗi quy đổi hiện tại (tránh
   * lệch nếu đơn vị quy đổi của thuốc đã đổi sau khi phiếu được duyệt). Chặn huỷ nếu tồn hiện có
   * của bất kỳ lô/dòng nào không đủ để trừ ngược (đã bị dùng bớt — GĐ2 chưa có xuất kho nên trường
   * hợp này chỉ xảy ra khi GĐ3 đã chạy, để sẵn logic đúng từ bây giờ). */
  async voidReceipt(tenantId: string, actorId: string, id: string, dto: VoidStockReceiptRequest, meta: RequestMeta): Promise<StockReceiptDetail> {
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockReceiptRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'POSTED') throw new StockReceiptVoidNotAllowedError('Phiếu này chưa được duyệt hoặc đã bị huỷ trước đó.');

      const originalEntries = await this.stockLedgerRepository.listForSourceReceipt(tx, tenantId, id);

      for (const entry of originalEntries) {
        const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, entry.drugId, entry.warehouseId, entry.batchId);
        if (!balance || balance.quantityOnHand < entry.quantityChange) {
          throw new StockReceiptVoidNotAllowedError();
        }
      }

      const count = await this.stockReceiptRepository.voidPosted(tx, tenantId, id, dto.version, actorId, dto.reason);
      if (count === 0) throw new ConcurrentModificationError();

      for (const entry of originalEntries) {
        await this.stockLedgerRepository.create(tx, tenantId, actorId, {
          drugId: entry.drugId,
          warehouseId: entry.warehouseId,
          batchId: entry.batchId,
          quantityChange: -entry.quantityChange,
          unitCost: entry.unitCost,
          reason: 'RECEIPT_VOID',
          sourceReceiptId: id,
          occurredAt: new Date(),
          note: 'Đảo dòng thẻ kho do huỷ phiếu nhập kho',
        });
        await this.stockBalanceRepository.upsertQuantity(tx, tenantId, actorId, {
          drugId: entry.drugId,
          warehouseId: entry.warehouseId,
          batchId: entry.batchId,
          quantityDelta: -entry.quantityChange,
        });
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_receipt.voided',
        entityType: 'stock_receipt',
        entityId: id,
        afterJson: { reason: dto.reason, reversedEntryCount: originalEntries.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, id);
  }

  // ============ helpers ============

  private async buildLineData(tx: Prisma.TransactionClient, tenantId: string, lines: CreateStockReceiptRequest['lines']): Promise<StockReceiptLineData[]> {
    const result: StockReceiptLineData[] = [];
    for (const line of lines) {
      const drug = await this.drugRepository.findById(tx, tenantId, line.drugId);
      if (!drug) throw new NotFoundException();
      if (drug.isBatchManaged && !line.batchNo) {
        throw new UnprocessableEntityException(`Thuốc/vật tư "${drug.name}" quản lý theo lô — phải nhập Số lô.`);
      }
      result.push({
        drugId: line.drugId,
        unitCode: line.unitCode,
        quantity: line.quantity,
        unitCost: BigInt(line.unitCost),
        batchNo: line.batchNo ?? null,
        expiryDate: line.expiryDate ? new Date(`${line.expiryDate}T00:00:00Z`) : null,
        lineAmount: BigInt(line.quantity) * BigInt(line.unitCost),
      });
    }
    return result;
  }

  /** Quy đổi số lượng/giá của 1 dòng sang đơn vị CƠ SỞ. `drug.baseUnitCode` rỗng (dữ liệu cũ trước
   * GĐ1) → coi `unitCode` của dòng CHÍNH LÀ đơn vị cơ sở (không quy đổi gì). */
  private convertLineToBaseUnit(drug: DrugWithDetails, unitCode: string, quantity: number, unitCost: bigint): { baseQuantity: number; baseUnitCost: bigint } {
    if (!drug.baseUnitCode || unitCode === drug.baseUnitCode) {
      return { baseQuantity: quantity, baseUnitCost: unitCost };
    }
    const levels = computeUnitConversion(drug.baseUnitCode, drug.units);
    const level = levels.find((l) => l.unitCode === unitCode);
    const factor = level?.factorToBaseUnit ?? 1;
    const baseQuantity = quantity * factor;
    // unitCost là giá/1 đơn vị `unitCode` → giá/1 đơn vị CƠ SỞ = unitCost / factor, round-half-up.
    const divisor = BigInt(factor);
    const quotient = unitCost / divisor;
    const remainder = unitCost % divisor;
    const baseUnitCost = remainder * 2n >= divisor ? quotient + 1n : quotient;
    return { baseQuantity, baseUnitCost };
  }

  private toSummaryDto(row: StockReceipt, warehouseName: string, supplierName: string | null, lineCount: number, names: Map<string, string>): StockReceiptSummary {
    return {
      id: row.id,
      receiptNo: row.receiptNo,
      receiptType: row.receiptType,
      status: row.status,
      warehouseId: row.warehouseId,
      warehouseName,
      supplierId: row.supplierId,
      supplierName,
      occurredAt: row.occurredAt.toISOString(),
      note: row.note,
      supplierInvoiceNo: row.supplierInvoiceNo,
      totalAmount: Number(row.totalAmount),
      lineCount,
      createdByName: names.get(row.createdBy) ?? 'Không rõ',
      approvedByName: row.approvedBy ? (names.get(row.approvedBy) ?? 'Không rõ') : null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      voided: row.deletedAt !== null,
      version: row.version,
    };
  }

  private toLineDetailDto(row: StockReceiptWithLines, warehouseName: string, supplierName: string | null, names: Map<string, string>): StockReceiptDetail {
    return {
      ...this.toSummaryDto(row, warehouseName, supplierName, row.lines.length, names),
      lines: row.lines.map((line) => ({
        id: line.id,
        drugId: line.drugId,
        drugCode: line.drug.code,
        drugName: line.drug.name,
        unitCode: line.unitCode,
        quantity: line.quantity,
        unitCost: Number(line.unitCost),
        batchNo: line.batchNo,
        expiryDate: line.expiryDate ? line.expiryDate.toISOString().slice(0, 10) : null,
        lineAmount: Number(line.lineAmount),
      })),
    };
  }

}
