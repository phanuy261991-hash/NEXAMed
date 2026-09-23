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
  DataScope,
  ListStockReceiptsQuery,
  ListStockReceiptsResponse,
  RejectStockReceiptRequest,
  StockReceiptDetail,
  StockReceiptSummary,
  UpdateStockReceiptRequest,
  VoidStockReceiptRequest,
} from '@nexamed/shared';
import type { Prisma, StockLedgerReason, StockReceipt, StockReceiptType } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { assertWarehouseInScope, resolveActorDepartmentId } from '../../common/warehouse-scope.helper';
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

/** Ánh xạ ĐẦY ĐỦ mọi `receiptType` sang đúng `stock_ledger.reason` — rà soát lúc thêm TRANSFER_IN
 * (Điều chuyển kho, #170): bản trước dùng chuỗi if/else 2 nhánh rồi fallback OPENING_BALANCE cho
 * "mọi loại khác", sẽ ÂM THẦM gán sai reason cho TRANSFER_IN/RETURN_FROM_USE (đúng số lượng/tồn
 * kho vẫn khớp, nhưng thẻ kho/báo cáo lọc theo reason sẽ sai) — map tường minh để không tái diễn
 * khi thêm receiptType mới. RETURN_FROM_USE chưa có logic tạo (StockReceiptService.create() chỉ
 * PURCHASE/OPENING_BALANCE, createTransferInReceipt()/createCountSurplusReceipt() tự đặt receiptType
 * đúng) nhưng khai sẵn cho đối xứng, tránh sót khi GĐ4 mở khoá loại này.
 */
const RECEIPT_TYPE_TO_LEDGER_REASON: Record<StockReceiptType, StockLedgerReason> = {
  PURCHASE: 'RECEIPT_PURCHASE',
  OPENING_BALANCE: 'RECEIPT_OPENING_BALANCE',
  TRANSFER_IN: 'RECEIPT_TRANSFER_IN',
  RETURN_FROM_USE: 'RECEIPT_RETURN_FROM_USE',
  COUNT_SURPLUS: 'RECEIPT_COUNT_SURPLUS',
};

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

  async create(tenantId: string, actorId: string, dataScope: DataScope, dto: CreateStockReceiptRequest, meta: RequestMeta): Promise<StockReceiptDetail> {
    if (!SUPPORTED_RECEIPT_TYPES.includes(dto.receiptType)) {
      throw new UnprocessableEntityException(`Loại phiếu "${dto.receiptType}" chưa được hỗ trợ ở giai đoạn này.`);
    }
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const created = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const warehouse = await this.warehouseRepository.findById(tx, tenantId, dto.warehouseId);
      if (!warehouse) throw new NotFoundException();
      assertWarehouseInScope(warehouse.departmentId, dataScope, actorDepartmentId);
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
        countId: null,
        transferId: null,
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

    return this.getById(tenantId, actorId, dataScope, created.id);
  }

  /** Sửa Nháp — bulk-replace toàn bộ dòng hàng + header, chỉ khi `status='DRAFT'`. Kiểm scope CẢ 2
   * đầu: kho HIỆN TẠI của phiếu (không cho sửa phiếu ngoài Khoa mình) VÀ kho MỚI trong `dto` (không
   * cho "chuyển" phiếu sang kho ngoài Khoa mình) — đúng khuôn `StockCountService.update()`. */
  async update(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: UpdateStockReceiptRequest, meta: RequestMeta): Promise<StockReceiptDetail> {
    if (!SUPPORTED_RECEIPT_TYPES.includes(dto.receiptType)) {
      throw new UnprocessableEntityException(`Loại phiếu "${dto.receiptType}" chưa được hỗ trợ ở giai đoạn này.`);
    }
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockReceiptRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockReceiptNotDraftError();

      const currentWarehouse = await this.warehouseRepository.findById(tx, tenantId, existing.warehouseId);
      assertWarehouseInScope(currentWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const warehouse = await this.warehouseRepository.findById(tx, tenantId, dto.warehouseId);
      if (!warehouse) throw new NotFoundException();
      assertWarehouseInScope(warehouse.departmentId, dataScope, actorDepartmentId);
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

    return this.getById(tenantId, actorId, dataScope, id);
  }

  async getById(tenantId: string, actorId: string, dataScope: DataScope, id: string): Promise<StockReceiptDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const row = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const receipt = await this.stockReceiptRepository.findByIdAnyWithLines(tx, tenantId, id);
      if (!receipt) throw new NotFoundException();
      const warehouse = await this.warehouseRepository.findById(tx, tenantId, receipt.warehouseId);
      assertWarehouseInScope(warehouse?.departmentId ?? null, dataScope, actorDepartmentId);
      const supplier = receipt.supplierId ? await this.supplierRepository.findById(tx, tenantId, receipt.supplierId) : null;
      return { receipt, warehouseName: warehouse?.name ?? '—', supplierName: supplier?.name ?? null };
    });

    const names = await this.doctorDirectory.getUserFullNames(tenantId, row.receipt.approvedBy ? [row.receipt.createdBy, row.receipt.approvedBy] : [row.receipt.createdBy]);
    return this.toLineDetailDto(row.receipt, row.warehouseName, row.supplierName, names);
  }

  async list(tenantId: string, actorId: string, dataScope: DataScope, query: ListStockReceiptsQuery): Promise<ListStockReceiptsResponse> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    // Scope `department` nhưng actor CHƯA gán Khoa/Phòng nào — không thể khớp bất kỳ kho nào, trả
    // rỗng ngay (không lỗi) thay vì query rồi lọc ra 0 kết quả, đúng khuôn `StockCountService.list()`.
    if (dataScope === 'department' && actorDepartmentId === null) {
      return { items: [], nextCursor: null };
    }

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
        departmentId: dataScope === 'department' ? (actorDepartmentId ?? undefined) : undefined,
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

  async approve(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: ApproveStockReceiptRequest, meta: RequestMeta): Promise<StockReceiptDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockReceiptRepository.findByIdAnyWithLines(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockReceiptNotDraftError();

      const existingWarehouse = await this.warehouseRepository.findById(tx, tenantId, existing.warehouseId);
      assertWarehouseInScope(existingWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const count = await this.stockReceiptRepository.approve(tx, tenantId, id, dto.version, actorId);
      if (count === 0) throw new ConcurrentModificationError();

      await this.applyPostedLines(tx, tenantId, actorId, existing);

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

    return this.getById(tenantId, actorId, dataScope, id);
  }

  /**
   * Kho Thuốc GĐ4 (docs/DECISIONS.md #170) — Kiểm kê phát hiện DƯ: `StockCountService.approve()`
   * gọi hàm này TRONG CÙNG transaction để tự sinh 1 `StockReceipt` (`receiptType='COUNT_SURPLUS'`)
   * đã ở trạng thái `POSTED` NGAY (khác `create()` thường luôn tạo `DRAFT` rồi chờ Duyệt riêng) —
   * dùng lại đúng `applyPostedLines()` cho phần cộng tồn/ghi thẻ kho, không lặp lại logic.
   */
  async createCountSurplusReceipt(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    params: { warehouseId: string; countId: string; occurredAt: Date; countNo: string; lines: StockReceiptLineData[] },
  ): Promise<StockReceiptWithLines> {
    const totalAmount = params.lines.reduce((sum, l) => sum + l.lineAmount, 0n);
    const receiptNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_RECEIPT', params.occurredAt);

    const created = await this.stockReceiptRepository.create(tx, tenantId, actorId, {
      receiptNo,
      warehouseId: params.warehouseId,
      supplierId: null,
      receiptType: 'COUNT_SURPLUS',
      occurredAt: params.occurredAt,
      note: `Tự sinh từ phiếu kiểm kê ${params.countNo}`,
      supplierInvoiceNo: null,
      totalAmount,
      lines: params.lines,
      countId: params.countId,
      transferId: null,
    });

    // Chuyển thẳng DRAFT→POSTED (vừa tạo, version chắc chắn = 1, không tranh chấp ai khác trong
    // cùng transaction) — dùng lại nguyên `approve()` repository, không viết lệnh SQL riêng.
    const postedCount = await this.stockReceiptRepository.approve(tx, tenantId, created.id, created.version, actorId);
    if (postedCount === 0) throw new ConcurrentModificationError();

    await this.applyPostedLines(tx, tenantId, actorId, created);
    return created;
  }

  /**
   * Kho Thuốc GĐ4, phần "Điều chuyển kho" (docs/DECISIONS.md #170) — Xác nhận nhận hàng:
   * `StockTransferService.confirmReceive()` gọi hàm này TRONG CÙNG transaction để tự sinh 1
   * `StockReceipt` (`receiptType='TRANSFER_IN'`) đã ở trạng thái `POSTED` NGAY tại kho ĐÍCH, cộng
   * đúng SL THỰC NHẬN (có thể thấp hơn SL đã xuất) — dùng lại đúng `applyPostedLines()`, không lặp
   * lại logic. `unitCost` của từng dòng ĐÃ snapshot sẵn từ lúc Duyệt xuất
   * (`StockTransferLine.unitCost`), không tính lại/đọc lại giá vốn kho nguồn ở đây.
   */
  async createTransferInReceipt(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    params: { warehouseId: string; transferId: string; occurredAt: Date; transferNo: string; lines: StockReceiptLineData[] },
  ): Promise<StockReceiptWithLines> {
    const totalAmount = params.lines.reduce((sum, l) => sum + l.lineAmount, 0n);
    const receiptNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_RECEIPT', params.occurredAt);

    const created = await this.stockReceiptRepository.create(tx, tenantId, actorId, {
      receiptNo,
      warehouseId: params.warehouseId,
      supplierId: null,
      receiptType: 'TRANSFER_IN',
      occurredAt: params.occurredAt,
      note: `Tự sinh từ phiếu điều chuyển kho ${params.transferNo}`,
      supplierInvoiceNo: null,
      totalAmount,
      lines: params.lines,
      countId: null,
      transferId: params.transferId,
    });

    const postedCount = await this.stockReceiptRepository.approve(tx, tenantId, created.id, created.version, actorId);
    if (postedCount === 0) throw new ConcurrentModificationError();

    await this.applyPostedLines(tx, tenantId, actorId, created);
    return created;
  }

  /** Cộng tồn kho + ghi thẻ kho cho từng dòng của 1 phiếu VỪA chuyển POSTED — dùng chung cho
   * `approve()` (phiếu lập tay) và `createCountSurplusReceipt()` (phiếu tự sinh từ Kiểm kê, GĐ4). */
  private async applyPostedLines(tx: Prisma.TransactionClient, tenantId: string, actorId: string, receipt: StockReceiptWithLines): Promise<void> {
    const drugCache = new Map<string, DrugWithDetails>();
    for (const line of receipt.lines) {
      let drug = drugCache.get(line.drugId);
      if (!drug) {
        const found = await this.drugRepository.findByIdWithDetails(tx, tenantId, line.drugId);
        if (!found) throw new NotFoundException();
        drug = found;
        drugCache.set(line.drugId, drug);
      }

      const { baseQuantity, baseUnitCost } = this.convertLineToBaseUnit(drug, line.unitCode, line.quantity, line.unitCost);
      const reason = RECEIPT_TYPE_TO_LEDGER_REASON[receipt.receiptType];

      let batchId: string | null = null;
      if (drug.isBatchManaged) {
        if (!line.batchNo) throw new UnprocessableEntityException(`Thuốc/vật tư "${drug.name}" quản lý theo lô — phải nhập Số lô.`);
        const batch = await this.inventoryBatchRepository.findByKey(tx, tenantId, drug.id, receipt.warehouseId, line.batchNo);
        if (batch) {
          const existingBalance = await this.stockBalanceRepository.findByKey(tx, tenantId, drug.id, receipt.warehouseId, batch.id);
          const newCost = computeWeightedAverageCost(existingBalance?.quantityOnHand ?? 0, batch.unitCost, baseQuantity, baseUnitCost);
          await this.inventoryBatchRepository.updateCost(tx, tenantId, batch.id, actorId, newCost);
          batchId = batch.id;
        } else {
          const created = await this.inventoryBatchRepository.create(tx, tenantId, actorId, {
            drugId: drug.id,
            warehouseId: receipt.warehouseId,
            batchNo: line.batchNo,
            expiryDate: line.expiryDate,
            unitCost: baseUnitCost,
          });
          batchId = created.id;
        }
        await this.stockBalanceRepository.upsertQuantity(tx, tenantId, actorId, { drugId: drug.id, warehouseId: receipt.warehouseId, batchId, quantityDelta: baseQuantity });
      } else {
        const existingBalance = await this.stockBalanceRepository.findByKey(tx, tenantId, drug.id, receipt.warehouseId, null);
        const newAverage = computeWeightedAverageCost(existingBalance?.quantityOnHand ?? 0, existingBalance?.averageUnitCost ?? 0n, baseQuantity, baseUnitCost);
        await this.stockBalanceRepository.upsertQuantity(tx, tenantId, actorId, {
          drugId: drug.id,
          warehouseId: receipt.warehouseId,
          batchId: null,
          quantityDelta: baseQuantity,
          averageUnitCost: newAverage,
        });
      }

      await this.stockLedgerRepository.create(tx, tenantId, actorId, {
        drugId: drug.id,
        warehouseId: receipt.warehouseId,
        batchId,
        quantityChange: baseQuantity,
        unitCost: baseUnitCost,
        reason,
        sourceReceiptId: receipt.id,
        occurredAt: receipt.occurredAt,
        note: null,
      });

      if (receipt.receiptType === 'PURCHASE') {
        await this.drugRepository.updateLastPurchase(tx, tenantId, drug.id, actorId, baseUnitCost, receipt.occurredAt);
      }
    }
  }

  async reject(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: RejectStockReceiptRequest, meta: RequestMeta): Promise<StockReceiptDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockReceiptRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockReceiptNotDraftError();

      const warehouse = await this.warehouseRepository.findById(tx, tenantId, existing.warehouseId);
      assertWarehouseInScope(warehouse?.departmentId ?? null, dataScope, actorDepartmentId);

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

    return this.getById(tenantId, actorId, dataScope, id);
  }

  /** Huỷ phiếu ĐÃ DUYỆT — đảo NGƯỢC đúng các dòng `stock_ledger` mà chính phiếu này đã sinh ra
   * (`sourceReceiptId=id`), KHÔNG tính lại từ `stock_receipt_line`/chuỗi quy đổi hiện tại (tránh
   * lệch nếu đơn vị quy đổi của thuốc đã đổi sau khi phiếu được duyệt). Chặn huỷ nếu tồn hiện có
   * của bất kỳ lô/dòng nào không đủ để trừ ngược (đã bị dùng bớt — GĐ2 chưa có xuất kho nên trường
   * hợp này chỉ xảy ra khi GĐ3 đã chạy, để sẵn logic đúng từ bây giờ). */
  async voidReceipt(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: VoidStockReceiptRequest, meta: RequestMeta): Promise<StockReceiptDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockReceiptRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'POSTED') throw new StockReceiptVoidNotAllowedError('Phiếu này chưa được duyệt hoặc đã bị huỷ trước đó.');

      const warehouse = await this.warehouseRepository.findById(tx, tenantId, existing.warehouseId);
      assertWarehouseInScope(warehouse?.departmentId ?? null, dataScope, actorDepartmentId);

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

    return this.getById(tenantId, actorId, dataScope, id);
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
