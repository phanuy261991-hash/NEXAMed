import { forwardRef, Injectable, Inject, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  computeDiscountAmount,
  computeInvoiceDiscount,
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
import type { DiscountType, Prisma, StockLedgerReason, StockReceipt, StockReceiptType } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { assertWarehouseInScope, resolveActorDepartmentId } from '../../common/warehouse-scope.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { DrugRepository, type DrugWithDetails } from '../drug/drug.repository';
import { WarehouseRepository } from '../drug/warehouse.repository';
import { SupplierRepository } from '../drug/supplier.repository';
import { SupplierDebtService } from '../supplier-debt/supplier-debt.service';
import { StockReceiptRepository, type StockReceiptWithLines, type StockReceiptLineData } from './stock-receipt.repository';
import { InventoryBatchRepository } from './inventory-batch.repository';
import { StockLedgerRepository } from './stock-ledger.repository';
import { StockBalanceRepository } from './stock-balance.repository';

/** "Phiếu nhập kho mở rộng" (Kho Thuốc GĐ4, docs/DECISIONS.md #170) mở khoá thêm `RETURN_FROM_USE`
 * (lập tay, Nháp→Duyệt đúng khuôn PURCHASE/OPENING_BALANCE — không cột đặc thù, "kiểm duyệt chặt
 * chẽ" chính là bước Duyệt sẵn có). `TRANSFER_IN`/`COUNT_SURPLUS` KHÔNG có trong danh sách này —
 * chỉ tự sinh qua `createTransferInReceipt()`/`createCountSurplusReceipt()`, không lập tay được. */
const SUPPORTED_RECEIPT_TYPES: readonly StockReceiptType[] = ['PURCHASE', 'OPENING_BALANCE', 'RETURN_FROM_USE'];

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
    // Phần D (docs/DECISIONS.md #180/#182) làm `supplier-debt ⇄ inventory` thành vòng phụ thuộc THẬT
    // ở mức Service (SupplierDebtService.approveAdjustment() giờ gọi ngược StockReceiptService.
    // voidPostedForAdjustment()) — bọc forwardRef() ở CẢ HAI đầu injection, đúng khuyến nghị NestJS
    // cho circular provider dependency (khác forwardRef Ở MODULE chỉ giải quyết thứ tự require() CommonJS).
    @Inject(forwardRef(() => SupplierDebtService)) private readonly supplierDebtService: SupplierDebtService,
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
        discountType: (dto.discountType ?? null) as DiscountType | null,
        discountValue: dto.discountValue != null ? BigInt(dto.discountValue) : null,
        discountReason: dto.discountReason ?? null,
        prepaidAmount: BigInt(dto.prepaidAmount ?? 0),
        prepaidPaymentMethodCode: dto.prepaidPaymentMethodCode ?? null,
        prepaidCashAccountId: dto.prepaidCashAccountId ?? null,
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
        discountType: (dto.discountType ?? null) as DiscountType | null,
        discountValue: dto.discountValue != null ? BigInt(dto.discountValue) : null,
        discountReason: dto.discountReason ?? null,
        prepaidAmount: BigInt(dto.prepaidAmount ?? 0),
        prepaidPaymentMethodCode: dto.prepaidPaymentMethodCode ?? null,
        prepaidCashAccountId: dto.prepaidCashAccountId ?? null,
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
        supplierId: query.supplierId,
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

      // "Công nợ nhà cung cấp" (docs/DECISIONS.md #180/#182) — ghi PURCHASE + xử lý "Trả ngay" TRƯỚC
      // khi chuyển phiếu sang POSTED, để `prepaidVoucherId` (nếu có) gắn được ngay trong CÙNG lệnh
      // `updateMany` bên dưới (tránh 1 lệnh UPDATE riêng chỉ để gắn cột này).
      let prepaidVoucherId: string | undefined;
      if (existing.receiptType === 'PURCHASE' && existing.supplierId) {
        const supplier = await this.supplierRepository.findById(tx, tenantId, existing.supplierId);
        if (!supplier) throw new NotFoundException();
        const discount = computeInvoiceDiscount({
          totalAmount: Number(existing.totalAmount),
          discountType: existing.discountType,
          discountValue: existing.discountValue !== null ? Number(existing.discountValue) : null,
          lines: existing.lines.map((l) => ({ lineTotal: Number(l.lineAmount), discountType: l.discountType, discountValue: l.discountValue !== null ? Number(l.discountValue) : null })),
        });
        const { prepaidVoucherId: voucherId } = await this.supplierDebtService.recordPurchaseApproval(tx, tenantId, actorId, {
          supplierId: existing.supplierId,
          supplierName: supplier.name,
          netAmount: BigInt(discount.dueAmount),
          stockReceiptId: id,
          receiptNo: existing.receiptNo,
          occurredAt: existing.occurredAt,
          prepaidAmount: existing.prepaidAmount,
          prepaidPaymentMethodCode: existing.prepaidPaymentMethodCode,
          prepaidCashAccountId: existing.prepaidCashAccountId,
          meta,
        });
        prepaidVoucherId = voucherId ?? undefined;
      }

      const count = await this.stockReceiptRepository.approve(tx, tenantId, id, dto.version, actorId, prepaidVoucherId);
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
      discountType: null,
      discountValue: null,
      discountReason: null,
      prepaidAmount: 0n,
      prepaidPaymentMethodCode: null,
      prepaidCashAccountId: null,
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
      discountType: null,
      discountValue: null,
      discountReason: null,
      prepaidAmount: 0n,
      prepaidPaymentMethodCode: null,
      prepaidCashAccountId: null,
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

      const warehouse = await this.warehouseRepository.findById(tx, tenantId, existing.warehouseId);
      assertWarehouseInScope(warehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      await this.voidPostedCore(tx, tenantId, actorId, existing, dto.version, dto.reason, meta);
    });

    return this.getById(tenantId, actorId, dataScope, id);
  }

  /**
   * "Công nợ nhà cung cấp" Phần D, mục 5 (docs/DECISIONS.md #180/#182) — Tầng 2 "Huỷ chứng từ" khi
   * `SupplierDebtService.approveAdjustment()` duyệt 1 "Đề nghị huỷ" (`VOID_REQUEST`, người KHÔNG có
   * `stock_receipt.approve` đã lập). Chạy TRONG transaction của caller (nhận `tx`, không tự mở
   * transaction riêng) — cùng khuôn `createCountSurplusReceipt()`/`createTransferInReceipt()`
   * (method nội bộ "hệ thống tự sinh/thao tác thay", KHÔNG kiểm `dataScope`/Khoa-Phòng — người duyệt
   * chỉ cần `supplier_debt.approve`, đã chốt qua AskUserQuestion). Đọc `version` hiện tại NGAY TRƯỚC
   * khi huỷ (không nhận từ caller — caller không biết trước).
   */
  async voidPostedForAdjustment(tx: Prisma.TransactionClient, tenantId: string, actorId: string, id: string, reason: string, meta: RequestMeta): Promise<void> {
    const existing = await this.stockReceiptRepository.findById(tx, tenantId, id);
    if (!existing) throw new NotFoundException();
    await this.voidPostedCore(tx, tenantId, actorId, existing, existing.version, reason, meta);
  }

  /** Lõi "Huỷ phiếu nhập ĐÃ Duyệt" dùng chung cho `voidReceipt()` (Huỷ trực tiếp, đã qua kiểm
   * `dataScope`) và `voidPostedForAdjustment()` (hệ thống thực thi thay lúc duyệt "Đề nghị huỷ") —
   * tách khỏi `voidReceipt()` (24/09/2026) để CẢ HAI đường đều tự đảo công nợ NCC trong CÙNG
   * transaction (đúng đặc tả mục 4.1 tầng 2, thay vì gọi lại public API mở transaction riêng — mất
   * tính nguyên tử giữa Huỷ chứng từ và đảo công nợ). */
  private async voidPostedCore(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    existing: StockReceipt,
    expectedVersion: number,
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (existing.status !== 'POSTED') throw new StockReceiptVoidNotAllowedError('Phiếu này chưa được duyệt hoặc đã bị huỷ trước đó.');

    const originalEntries = await this.stockLedgerRepository.listForSourceReceipt(tx, tenantId, existing.id);

    for (const entry of originalEntries) {
      const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, entry.drugId, entry.warehouseId, entry.batchId);
      if (!balance || balance.quantityOnHand < entry.quantityChange) {
        throw new StockReceiptVoidNotAllowedError();
      }
    }

    const count = await this.stockReceiptRepository.voidPosted(tx, tenantId, existing.id, expectedVersion, actorId, reason);
    if (count === 0) throw new ConcurrentModificationError();

    for (const entry of originalEntries) {
      await this.stockLedgerRepository.create(tx, tenantId, actorId, {
        drugId: entry.drugId,
        warehouseId: entry.warehouseId,
        batchId: entry.batchId,
        quantityChange: -entry.quantityChange,
        unitCost: entry.unitCost,
        reason: 'RECEIPT_VOID',
        sourceReceiptId: existing.id,
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
      entityId: existing.id,
      afterJson: { reason, reversedEntryCount: originalEntries.length },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Phần D, Tầng 2 — tự đảo công nợ NCC TRONG CÙNG transaction nếu phiếu này gắn NCC (PURCHASE có
    // supplierId). No-op (không tìm thấy bút toán PURCHASE gốc) cho mọi receiptType khác.
    if (existing.receiptType === 'PURCHASE' && existing.supplierId) {
      await this.supplierDebtService.reverseStockEntry(tx, tenantId, actorId, { stockReceiptId: existing.id, stockIssueId: null }, reason, meta);
    }
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
        discountType: (line.discountType ?? null) as DiscountType | null,
        discountValue: line.discountValue != null ? BigInt(line.discountValue) : null,
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
      discountType: row.discountType,
      discountValue: row.discountValue !== null ? Number(row.discountValue) : null,
      discountReason: row.discountReason,
      prepaidAmount: Number(row.prepaidAmount),
      prepaidPaymentMethodCode: row.prepaidPaymentMethodCode,
      prepaidCashAccountId: row.prepaidCashAccountId,
      prepaidVoucherId: row.prepaidVoucherId,
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
    // Chiết khấu (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — tái dùng NGUYÊN `computeInvoiceDiscount()`
    // đã có ở Thu ngân (#137), map `lineAmount`→`lineTotal` (tên khác nhau, cùng ý nghĩa "thành tiền
    // dòng trước chiết khấu"). `lines[].discountType!=null` bất kỳ dòng nào ⇒ mode PER_LINE, BỎ QUA
    // discount cấp header — đúng logic hàm dùng chung, KHÔNG viết lại.
    const discount = computeInvoiceDiscount({
      totalAmount: Number(row.totalAmount),
      discountType: row.discountType,
      discountValue: row.discountValue !== null ? Number(row.discountValue) : null,
      lines: row.lines.map((l) => ({
        lineTotal: Number(l.lineAmount),
        discountType: l.discountType,
        discountValue: l.discountValue !== null ? Number(l.discountValue) : null,
      })),
    });
    return {
      ...this.toSummaryDto(row, warehouseName, supplierName, row.lines.length, names),
      discountMode: discount.mode,
      discountAmount: discount.discountAmount,
      netAmount: discount.dueAmount,
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
        discountType: line.discountType,
        discountValue: line.discountValue !== null ? Number(line.discountValue) : null,
        discountAmount: computeDiscountAmount(Number(line.lineAmount), line.discountType, line.discountValue !== null ? Number(line.discountValue) : null),
      })),
    };
  }

}
