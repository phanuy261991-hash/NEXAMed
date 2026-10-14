import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  StockTransferInsufficientStockError,
  StockTransferNotDraftError,
  StockTransferNotInTransitError,
  StockTransferNotReturningError,
  StockTransferNotVariancePendingError,
  StockTransferReceivedExceedsShippedError,
  StockTransferResolutionIncompleteError,
  StockTransferReturnQuantityInvalidError,
  StockTransferVarianceReasonRequiredError,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  ConfirmStockTransferReturnRequest,
  CreateStockTransferRequest,
  DataScope,
  GetStockTransferPendingCountsResponse,
  GetStockTransferShrinkageQuery,
  GetStockTransferShrinkageResponse,
  ListStockTransfersQuery,
  ListStockTransfersResponse,
  ReceiveStockTransferRequest,
  RejectStockTransferReceiptRequest,
  RejectStockTransferRequest,
  ResolveStockTransferVarianceRequest,
  ShipStockTransferRequest,
  StockTransferDetail,
  StockTransferSummary,
  StockTransferVarianceReason,
  UpdateStockTransferRequest,
} from '@nexamed/shared';
import type { Prisma, StockTransfer } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { assertEitherWarehouseInScope, assertWarehouseInScope, resolveActorDepartmentId } from '../../common/warehouse-scope.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { DrugRepository } from '../drug/drug.repository';
import { WarehouseRepository, type WarehouseWithDepartment } from '../drug/warehouse.repository';
import { StockTransferRepository, type StockTransferLineData, type StockTransferListRow, type StockTransferWithLines, type TransferViewerRole } from './stock-transfer.repository';
import { InventoryBatchRepository } from './inventory-batch.repository';
import { StockBalanceRepository } from './stock-balance.repository';
import type { StockReceiptLineData } from './stock-receipt.repository';
import { StockReceiptService } from './stock-receipt.service';
import { StockIssueService } from './stock-issue.service';

/** Nhãn lý do chênh lệch — dùng làm ghi chú mặc định khi người kiểm nhận không gõ thêm (CHECK DB bắt buộc `variance_note` khi nhận thiếu). */
const VARIANCE_REASON_LABEL: Record<StockTransferVarianceReason, string> = {
  SHORTAGE: 'Thiếu hàng',
  DAMAGED: 'Hư hỏng / ướt',
  EXPIRED: 'Hết hạn / cận date quá mức',
  WRONG_ITEM: 'Sai lô / sai hàng',
  OTHER: 'Khác',
};

type BranchedWarehouse = Pick<WarehouseWithDepartment, 'name' | 'branchId' | 'departmentId'> & { branch: { name: string } };

/**
 * Kho Thuốc & Vật tư y tế — Giai đoạn 4, phần "Điều chuyển kho" (docs/DECISIONS.md #170, kế hoạch
 * kỹ thuật bright-bubbling-axolotl.md, mockup đã duyệt). 1 LUỒNG tự sinh CẶP chứng từ liên kết:
 * Duyệt (`approveShip`, DRAFT→IN_TRANSIT, xuất kho NGUỒN NGAY, sinh `StockIssue` TRANSFER_OUT) →
 * Kiểm nhận (`confirmReceive`, IN_TRANSIT→COMPLETED/VARIANCE_PENDING, nhập kho ĐÍCH đúng SL THỰC NHẬN,
 * sinh `StockReceipt` TRANSFER_IN). KHÔNG hỗ trợ Huỷ sau khi đã IN_TRANSIT.
 *
 * Đợt 2 chi nhánh (docs/DECISIONS.md #233, mockup chốt 14/10/2026): kho gửi và kho nhận có thể thuộc 2 chi nhánh KHÁC NHAU.
 *  - Phiếu thuộc chi nhánh GỬI (lập, sửa, Duyệt xuất, từ chối lúc Nháp, xử lý chênh lệch, xác nhận nhận lại hàng bị từ chối).
 *  - Chi nhánh NHẬN chỉ thấy phiếu từ lúc Duyệt xuất; làm Kiểm nhận hoặc Từ chối nhận cả phiếu.
 *  - Người ở chi nhánh nhận KHÔNG thấy giá vốn (Q3); chi nhánh gửi thấy giá vốn để biết giá trị hao hụt.
 *  - Nhận thiếu → VARIANCE_PENDING: hàng thực nhận đã vào kho nhận, chi nhánh GỬI quyết từng dòng (Q7): hàng về kho gửi / ghi hao hụt.
 *  - Từ chối nhận cả phiếu → RETURNING (hàng không vào kho nhận) → chi nhánh gửi xác nhận nhận lại → RETURNED.
 * Dùng chung quyền \`stock_transfer.approve\` cho mọi bước ghi trạng thái (Q8) — kiểm đúng chi nhánh + Khoa/Phòng của từng bước ở đây.
 */
@Injectable()
export class StockTransferService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly stockTransferRepository: StockTransferRepository,
    private readonly drugRepository: DrugRepository,
    private readonly warehouseRepository: WarehouseRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly stockBalanceRepository: StockBalanceRepository,
    private readonly businessCodeService: BusinessCodeService,
    private readonly stockReceiptService: StockReceiptService,
    private readonly stockIssueService: StockIssueService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  async create(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, dto: CreateStockTransferRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const created = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      // Lập phiếu là hành động của phía kho NGUỒN (người chuẩn bị hàng đi): kho nguồn BẮT BUỘC thuộc chi nhánh đang làm; kho đích có thể ở chi nhánh khác.
      const fromWarehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, dto.fromWarehouseId);
      if (!fromWarehouse) throw new NotFoundException();
      const toWarehouse = await this.warehouseRepository.findByIdAnyBranch(tx, tenantId, dto.toWarehouseId);
      if (!toWarehouse || !toWarehouse.isActive) throw new NotFoundException();
      assertWarehouseInScope(fromWarehouse.departmentId, dataScope, actorDepartmentId);

      const lines = await this.buildLineData(tx, tenantId, dto.lines);
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const transferNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_TRANSFER', occurredAt);

      const row = await this.stockTransferRepository.create(tx, tenantId, actorId, {
        transferNo,
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        occurredAt,
        note: dto.note ?? null,
        lines,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_transfer.created',
        entityType: 'stock_transfer',
        entityId: row.id,
        afterJson: { transferNo, fromWarehouseId: dto.fromWarehouseId, toWarehouseId: dto.toWarehouseId, lineCount: lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return row;
    });

    return this.getById(tenantId, branchId, actorId, dataScope, created.id);
  }

  /** Sửa Nháp — bulk-replace toàn bộ dòng hàng + header, chỉ khi `status='DRAFT'`. Kiểm scope CẢ 2
   * đầu kho NGUỒN: kho HIỆN TẠI của phiếu (không cho sửa phiếu ngoài Khoa mình) VÀ kho MỚI trong
   * `dto` (không cho "chuyển" phiếu sang kho nguồn ngoài Khoa mình) — đúng khuôn `StockCountService.update()`. */
  async update(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: UpdateStockTransferRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findById(tx, tenantId, branchId, id, 'sender');
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockTransferNotDraftError();

      const currentFromWarehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, existing.fromWarehouseId);
      assertWarehouseInScope(currentFromWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const fromWarehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, dto.fromWarehouseId);
      if (!fromWarehouse) throw new NotFoundException();
      assertWarehouseInScope(fromWarehouse.departmentId, dataScope, actorDepartmentId);
      const toWarehouse = await this.warehouseRepository.findByIdAnyBranch(tx, tenantId, dto.toWarehouseId);
      if (!toWarehouse || !toWarehouse.isActive) throw new NotFoundException();

      const lines = await this.buildLineData(tx, tenantId, dto.lines);
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : existing.occurredAt;

      const count = await this.stockTransferRepository.updateDraft(tx, tenantId, id, dto.version, actorId, {
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        occurredAt,
        note: dto.note ?? null,
        lines,
      });
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_transfer.updated',
        entityType: 'stock_transfer',
        entityId: id,
        afterJson: { fromWarehouseId: dto.fromWarehouseId, toWarehouseId: dto.toWarehouseId, lineCount: lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  async getById(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string): Promise<StockTransferDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const row = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const transfer = await this.stockTransferRepository.findByIdAnyWithLines(tx, tenantId, branchId, id, 'viewer');
      if (!transfer) throw new NotFoundException();
      const [fromWarehouse, toWarehouse] = await Promise.all([
        this.warehouseRepository.findByIdAnyBranch(tx, tenantId, transfer.fromWarehouseId),
        this.warehouseRepository.findByIdAnyBranch(tx, tenantId, transfer.toWarehouseId),
      ]);
      assertEitherWarehouseInScope(fromWarehouse?.departmentId ?? null, toWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);
      return { transfer, from: fromWarehouse, to: toWarehouse };
    });

    const ids = new Set<string>([row.transfer.createdBy]);
    for (const uid of [row.transfer.shippedBy, row.transfer.receivedBy, row.transfer.receiveRejectedBy, row.transfer.returnConfirmedBy, row.transfer.varianceResolvedBy]) {
      if (uid) ids.add(uid);
    }
    const names = await this.doctorDirectory.getUserFullNames(tenantId, [...ids]);
    // Giá vốn CHỈ cho người ở chi nhánh GỬI (Q3).
    const canSeeCost = row.from?.branchId === branchId;
    return this.toDetailDto(row.transfer, this.brief(row.from), this.brief(row.to), names, canSeeCost);
  }

  async list(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, query: ListStockTransfersQuery): Promise<ListStockTransfersResponse> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    if (dataScope === 'department' && actorDepartmentId === null) {
      return { items: [], nextCursor: null };
    }

    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.stockTransferRepository.list(tx, tenantId, {
        branchId,
        direction: query.direction,
        fromWarehouseId: query.fromWarehouseId,
        toWarehouseId: query.toWarehouseId,
        status: query.status,
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
      for (const uid of [row.shippedBy, row.receivedBy, row.receiveRejectedBy, row.returnConfirmedBy, row.varianceResolvedBy]) {
        if (uid) ids.add(uid);
      }
    }
    const names = ids.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...ids]) : new Map<string, string>();

    return { items: page.map((row) => this.toSummaryDto(row, this.briefFromRow(row.fromWarehouse), this.briefFromRow(row.toWarehouse), row._count.lines, names)), nextCursor };
  }

  /** Số phiếu cần xử lý ở chi nhánh đang làm — chấm số trên menu "Điều chuyển kho". */
  async getPendingCounts(tenantId: string, branchId: string, actorId: string, dataScope: DataScope): Promise<GetStockTransferPendingCountsResponse> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    if (dataScope === 'department' && actorDepartmentId === null) {
      return { incoming: 0, toResolve: 0 };
    }
    return this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.stockTransferRepository.countPending(tx, tenantId, branchId, dataScope === 'department' ? (actorDepartmentId ?? undefined) : undefined),
    );
  }

  /** "Báo cáo hao hụt điều chuyển" — chỉ phần hao hụt của chi nhánh GỬI đang làm. */
  async getShrinkageReport(tenantId: string, branchId: string, query: GetStockTransferShrinkageQuery): Promise<GetStockTransferShrinkageResponse> {
    const from = new Date(`${query.from}T00:00:00+07:00`);
    const to = new Date(`${query.to}T23:59:59.999+07:00`);
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.stockTransferRepository.listShrinkage(tx, tenantId, [branchId], from, to));
    const items = rows.map((r) => ({
      transferId: r.transferId,
      transferNo: r.transferNo,
      occurredAt: r.occurredAt.toISOString(),
      fromWarehouseName: r.fromWarehouseName,
      toWarehouseName: r.toWarehouseName,
      drugCode: r.drugCode,
      drugName: r.drugName,
      quantity: r.quantity,
      unitCost: Number(r.unitCost),
      lineValue: Number(r.unitCost * BigInt(r.quantity)),
      cause: r.cause,
    }));
    return { items, totalQuantity: items.reduce((s, i) => s + i.quantity, 0), totalValue: items.reduce((s, i) => s + i.lineValue, 0) };
  }

  /** Bên GỬI từ chối duyệt phiếu còn Nháp (khác "Từ chối nhận" của bên nhận khi hàng đã đi). */
  async reject(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: RejectStockTransferRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findById(tx, tenantId, branchId, id, 'sender');
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockTransferNotDraftError();

      const fromWarehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, existing.fromWarehouseId);
      assertWarehouseInScope(fromWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const count = await this.stockTransferRepository.reject(tx, tenantId, id, dto.version, actorId, dto.reason);
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_transfer.rejected',
        entityType: 'stock_transfer',
        entityId: id,
        beforeJson: { status: 'DRAFT' },
        afterJson: { status: 'REJECTED', reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /**
   * Duyệt (xuất kho NGUỒN) — DRAFT→IN_TRANSIT. Chuyển trạng thái ATOMIC (optimistic lock) TRƯỚC,
   * chỉ khi thành công mới kiểm tồn + snapshot `unitCost`/sinh `StockIssue` TRANSFER_OUT — đúng thứ
   * tự `StockReceiptService.approve()`→`applyPostedLines()` (nếu bước sau ném lỗi, cả transaction
   * rollback luôn cả việc đổi trạng thái, không để lại nửa vời).
   */
  async approveShip(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: ShipStockTransferRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findByIdAnyWithLines(tx, tenantId, branchId, id, 'sender');
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockTransferNotDraftError();

      const fromWarehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, existing.fromWarehouseId);
      assertWarehouseInScope(fromWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const shippedCount = await this.stockTransferRepository.markShipped(tx, tenantId, id, dto.version, actorId);
      if (shippedCount === 0) throw new ConcurrentModificationError();

      const issueLines: { drugId: string; batchId: string | null; quantity: number; unitCost: bigint }[] = [];
      const unitCostUpdates: { lineId: string; unitCost: bigint }[] = [];
      for (const line of existing.lines) {
        let quantityOnHand = 0;
        let unitCost = 0n;
        if (line.drug.isBatchManaged) {
          const [balance, batch] = await Promise.all([
            this.stockBalanceRepository.findByKey(tx, tenantId, line.drugId, existing.fromWarehouseId, line.batchId),
            line.batchId ? this.inventoryBatchRepository.findById(tx, tenantId, line.batchId) : Promise.resolve(null),
          ]);
          quantityOnHand = balance?.quantityOnHand ?? 0;
          unitCost = batch?.unitCost ?? 0n;
        } else {
          const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, line.drugId, existing.fromWarehouseId, null);
          quantityOnHand = balance?.quantityOnHand ?? 0;
          unitCost = balance?.averageUnitCost ?? 0n;
        }
        if (quantityOnHand < line.quantityShipped) {
          throw new StockTransferInsufficientStockError(line.drug.name);
        }
        issueLines.push({ drugId: line.drugId, batchId: line.batchId, quantity: line.quantityShipped, unitCost });
        unitCostUpdates.push({ lineId: line.id, unitCost });
      }

      const issue = await this.stockIssueService.createTransferOutIssue(tx, tenantId, actorId, {
        warehouseId: existing.fromWarehouseId,
        transferId: id,
        occurredAt: new Date(),
        transferNo: existing.transferNo,
        lines: issueLines,
      });
      await this.stockTransferRepository.updateLineUnitCosts(tx, tenantId, actorId, unitCostUpdates);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_transfer.shipped',
        entityType: 'stock_transfer',
        entityId: id,
        beforeJson: { status: 'DRAFT' },
        afterJson: { status: 'IN_TRANSIT', generatedIssueId: issue.id },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /**
   * Kiểm nhận hàng (chi nhánh NHẬN) — IN_TRANSIT→COMPLETED (đủ hàng) hoặc VARIANCE_PENDING (có dòng nhận thiếu), MỘT LẦN DUY NHẤT. Nhận ÍT hơn số
   * đã xuất được (bắt buộc chọn lý do chênh lệch), KHÔNG được nhận NHIỀU hơn (chặn cứng, đúng cả CHECK DB — hàng dư báo bên gửi lập phiếu mới).
   * Cộng tồn kho ĐÍCH đúng số THỰC NHẬN, dùng `unitCost` đã snapshot từ lúc Duyệt xuất (không đọc lại giá vốn kho nguồn — có thể đã đổi giữa
   * lúc xuất và lúc nhận). Phần nhận thiếu CHƯA chạy về đâu cho tới khi chi nhánh GỬI xử lý (`resolveVariance`).
   */
  async confirmReceive(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: ReceiveStockTransferRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findByIdAnyWithLines(tx, tenantId, branchId, id, 'receiver');
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'IN_TRANSIT') throw new StockTransferNotInTransitError();

      const toWarehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, existing.toWarehouseId);
      if (!toWarehouse) throw new NotFoundException();
      assertWarehouseInScope(toWarehouse.departmentId, dataScope, actorDepartmentId);

      if (dto.lines.length !== existing.lines.length) {
        throw new UnprocessableEntityException('Danh sách dòng hàng thực nhận không khớp số dòng của phiếu gốc.');
      }
      const inputByLineId = new Map(dto.lines.map((l) => [l.lineId, l]));

      const lineUpdates: { lineId: string; quantityReceived: number; varianceReason: string | null; varianceNote: string | null }[] = [];
      const receiptLines: StockReceiptLineData[] = [];
      let withVariance = false;
      for (const line of existing.lines) {
        const input = inputByLineId.get(line.id);
        if (!input) throw new NotFoundException();
        if (input.quantityReceived > line.quantityShipped) {
          throw new StockTransferReceivedExceedsShippedError(line.drug.name);
        }
        let varianceReason: StockTransferVarianceReason | null = null;
        let varianceNote: string | null = null;
        if (input.quantityReceived < line.quantityShipped) {
          withVariance = true;
          varianceReason = input.varianceReason ?? null;
          const typedNote = input.varianceNote?.trim() || null;
          if (!varianceReason || (varianceReason === 'OTHER' && !typedNote)) {
            throw new StockTransferVarianceReasonRequiredError(line.drug.name);
          }
          varianceNote = typedNote ?? VARIANCE_REASON_LABEL[varianceReason];
        }
        lineUpdates.push({ lineId: line.id, quantityReceived: input.quantityReceived, varianceReason, varianceNote });

        if (input.quantityReceived > 0) {
          const unitCost = line.unitCost ?? 0n;
          receiptLines.push({
            drugId: line.drugId,
            unitCode: line.drug.baseUnitCode ?? '',
            quantity: input.quantityReceived,
            unitCost,
            batchNo: line.batchId ? (line.batch?.batchNo ?? null) : null,
            expiryDate: line.batchId ? (line.batch?.expiryDate ?? null) : null,
            lineAmount: unitCost * BigInt(input.quantityReceived),
            // Phiếu tự sinh — không có khái niệm chiết khấu (Kho Thuốc GĐ4, "Phiếu nhập kho mở rộng", #170).
            discountType: null,
            discountValue: null,
          });
        }
      }

      const receivedCount = await this.stockTransferRepository.markReceived(tx, tenantId, id, dto.version, actorId, withVariance);
      if (receivedCount === 0) throw new ConcurrentModificationError();

      await this.stockTransferRepository.updateLineReceived(tx, tenantId, actorId, lineUpdates);

      let generatedReceiptId: string | null = null;
      if (receiptLines.length > 0) {
        const receipt = await this.stockReceiptService.createTransferInReceipt(tx, tenantId, actorId, {
          warehouseId: existing.toWarehouseId,
          transferId: id,
          occurredAt: new Date(),
          transferNo: existing.transferNo,
          lines: receiptLines,
        });
        generatedReceiptId = receipt.id;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_transfer.received',
        entityType: 'stock_transfer',
        entityId: id,
        beforeJson: { status: 'IN_TRANSIT' },
        afterJson: { status: withVariance ? 'VARIANCE_PENDING' : 'COMPLETED', generatedReceiptId, lines: lineUpdates },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** Từ chối nhận CẢ PHIẾU (chi nhánh NHẬN) — IN_TRANSIT→RETURNING. Hàng KHÔNG vào kho nhận; chờ chi nhánh gửi xác nhận nhận lại. Không hoàn tác. */
  async rejectReceipt(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: RejectStockTransferReceiptRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findById(tx, tenantId, branchId, id, 'receiver');
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'IN_TRANSIT') throw new StockTransferNotInTransitError();

      const toWarehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, existing.toWarehouseId);
      if (!toWarehouse) throw new NotFoundException();
      assertWarehouseInScope(toWarehouse.departmentId, dataScope, actorDepartmentId);

      const count = await this.stockTransferRepository.markReceiveRejected(tx, tenantId, id, dto.version, actorId, dto.reason, dto.note);
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_transfer.receive_rejected',
        entityType: 'stock_transfer',
        entityId: id,
        beforeJson: { status: 'IN_TRANSIT' },
        afterJson: { status: 'RETURNING', reason: dto.reason, note: dto.note },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /**
   * Xác nhận đã nhận lại hàng bị từ chối (chi nhánh GỬI) — RETURNING→RETURNED. Cùng màn đếm như kiểm nhận: số nhận lại đủ thì tồn kho gửi tăng
   * lại đúng lô + giá vốn cũ; nhận lại THIẾU thì phần thiếu là hao hụt, bắt buộc ghi chú (không còn vòng xử lý thứ hai).
   */
  async confirmReturn(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: ConfirmStockTransferReturnRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findByIdAnyWithLines(tx, tenantId, branchId, id, 'sender');
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'RETURNING') throw new StockTransferNotReturningError();

      const fromWarehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, existing.fromWarehouseId);
      if (!fromWarehouse) throw new NotFoundException();
      assertWarehouseInScope(fromWarehouse.departmentId, dataScope, actorDepartmentId);

      if (dto.lines.length !== existing.lines.length) {
        throw new UnprocessableEntityException('Danh sách dòng hàng nhận lại không khớp số dòng của phiếu gốc.');
      }
      const inputByLineId = new Map(dto.lines.map((l) => [l.lineId, l]));

      const updates: { lineId: string; quantityReturnedBack: number; note: string | null }[] = [];
      const receiptLines: StockReceiptLineData[] = [];
      for (const line of existing.lines) {
        const input = inputByLineId.get(line.id);
        if (!input) throw new NotFoundException();
        if (input.quantityReturnedBack > line.quantityShipped) {
          throw new StockTransferReturnQuantityInvalidError(`"${line.drug.name}" — số nhận lại không được vượt quá số lượng đã gửi.`);
        }
        const note = input.note?.trim() || null;
        if (input.quantityReturnedBack < line.quantityShipped && !note) {
          throw new StockTransferReturnQuantityInvalidError(`"${line.drug.name}" — nhận lại ít hơn số đã gửi, phải ghi chú lý do hao hụt.`);
        }
        updates.push({ lineId: line.id, quantityReturnedBack: input.quantityReturnedBack, note });

        if (input.quantityReturnedBack > 0) {
          const unitCost = line.unitCost ?? 0n;
          receiptLines.push({
            drugId: line.drugId,
            unitCode: line.drug.baseUnitCode ?? '',
            quantity: input.quantityReturnedBack,
            unitCost,
            batchNo: line.batchId ? (line.batch?.batchNo ?? null) : null,
            expiryDate: line.batchId ? (line.batch?.expiryDate ?? null) : null,
            lineAmount: unitCost * BigInt(input.quantityReturnedBack),
            discountType: null,
            discountValue: null,
          });
        }
      }

      const count = await this.stockTransferRepository.markReturnConfirmed(tx, tenantId, id, dto.version, actorId);
      if (count === 0) throw new ConcurrentModificationError();
      await this.stockTransferRepository.updateLineReturnedBack(tx, tenantId, actorId, updates);

      let generatedReceiptId: string | null = null;
      if (receiptLines.length > 0) {
        const receipt = await this.stockReceiptService.createTransferReturnReceipt(tx, tenantId, actorId, {
          warehouseId: existing.fromWarehouseId,
          transferId: id,
          occurredAt: new Date(),
          transferNo: existing.transferNo,
          lines: receiptLines,
          reasonNote: 'hàng bị từ chối nhận, đã hoàn trả về kho gửi',
        });
        generatedReceiptId = receipt.id;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_transfer.return_confirmed',
        entityType: 'stock_transfer',
        entityId: id,
        beforeJson: { status: 'RETURNING' },
        afterJson: { status: 'RETURNED', generatedReceiptId, lines: updates },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /**
   * Xử lý chênh lệch (chi nhánh GỬI, Q7) — VARIANCE_PENDING→COMPLETED. Phải chọn cách xử lý cho ĐÚNG mọi dòng đang nhận thiếu: hàng đã về kho
   * gửi (tự sinh phiếu nhập hoàn trả, tồn kho gửi tăng lại) hoặc ghi hao hụt (không cộng tồn, vào báo cáo hao hụt điều chuyển).
   */
  async resolveVariance(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: ResolveStockTransferVarianceRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findByIdAnyWithLines(tx, tenantId, branchId, id, 'sender');
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'VARIANCE_PENDING') throw new StockTransferNotVariancePendingError();

      const fromWarehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, existing.fromWarehouseId);
      if (!fromWarehouse) throw new NotFoundException();
      assertWarehouseInScope(fromWarehouse.departmentId, dataScope, actorDepartmentId);

      const shortageLines = existing.lines.filter((l) => (l.quantityReceived ?? l.quantityShipped) < l.quantityShipped);
      const shortageIds = new Set(shortageLines.map((l) => l.id));
      const inputIds = new Set(dto.lines.map((l) => l.lineId));
      if (shortageIds.size !== inputIds.size || [...shortageIds].some((lineId) => !inputIds.has(lineId))) {
        throw new StockTransferResolutionIncompleteError();
      }
      const resolutionByLine = new Map(dto.lines.map((l) => [l.lineId, l.resolution]));

      const receiptLines: StockReceiptLineData[] = [];
      const updates: { lineId: string; resolution: string }[] = [];
      for (const line of shortageLines) {
        const resolution = resolutionByLine.get(line.id)!;
        updates.push({ lineId: line.id, resolution });
        if (resolution === 'RETURN_TO_SOURCE') {
          const quantity = line.quantityShipped - (line.quantityReceived ?? 0);
          const unitCost = line.unitCost ?? 0n;
          receiptLines.push({
            drugId: line.drugId,
            unitCode: line.drug.baseUnitCode ?? '',
            quantity,
            unitCost,
            batchNo: line.batchId ? (line.batch?.batchNo ?? null) : null,
            expiryDate: line.batchId ? (line.batch?.expiryDate ?? null) : null,
            lineAmount: unitCost * BigInt(quantity),
            discountType: null,
            discountValue: null,
          });
        }
      }

      const count = await this.stockTransferRepository.markVarianceResolved(tx, tenantId, id, dto.version, actorId, dto.note?.trim() || null);
      if (count === 0) throw new ConcurrentModificationError();
      await this.stockTransferRepository.updateLineResolutions(tx, tenantId, actorId, updates);

      let generatedReceiptId: string | null = null;
      if (receiptLines.length > 0) {
        const receipt = await this.stockReceiptService.createTransferReturnReceipt(tx, tenantId, actorId, {
          warehouseId: existing.fromWarehouseId,
          transferId: id,
          occurredAt: new Date(),
          transferNo: existing.transferNo,
          lines: receiptLines,
          reasonNote: 'hàng nhận thiếu, đã về kho gửi',
        });
        generatedReceiptId = receipt.id;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_transfer.variance_resolved',
        entityType: 'stock_transfer',
        entityId: id,
        beforeJson: { status: 'VARIANCE_PENDING' },
        afterJson: { status: 'COMPLETED', generatedReceiptId, lines: updates, note: dto.note?.trim() || null },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  // ============ helpers ============

  private async buildLineData(tx: Prisma.TransactionClient, tenantId: string, lines: CreateStockTransferRequest['lines']): Promise<StockTransferLineData[]> {
    const result: StockTransferLineData[] = [];
    for (const line of lines) {
      const drug = await this.drugRepository.findById(tx, tenantId, line.drugId);
      if (!drug) throw new NotFoundException();
      if (drug.isBatchManaged && !line.batchId) {
        throw new UnprocessableEntityException(`Thuốc/vật tư "${drug.name}" quản lý theo lô — phải chọn lô tại kho nguồn.`);
      }
      result.push({ drugId: line.drugId, batchId: line.batchId ?? null, quantityShipped: line.quantityShipped });
    }
    return result;
  }

  private brief(w: BranchedWarehouse | null): { name: string; branchId: string; branchName: string } {
    return { name: w?.name ?? '—', branchId: w?.branchId ?? '', branchName: w?.branch.name ?? '—' };
  }

  private briefFromRow(w: StockTransferListRow['fromWarehouse']): { name: string; branchId: string; branchName: string } {
    return { name: w.name, branchId: w.branchId, branchName: w.branch.name };
  }

  private toSummaryDto(
    row: StockTransfer,
    from: { name: string; branchId: string; branchName: string },
    to: { name: string; branchId: string; branchName: string },
    lineCount: number,
    names: Map<string, string>,
  ): StockTransferSummary {
    const nameOf = (userId: string | null): string | null => (userId ? (names.get(userId) ?? 'Không rõ') : null);
    return {
      id: row.id,
      transferNo: row.transferNo,
      status: row.status,
      fromWarehouseId: row.fromWarehouseId,
      fromWarehouseName: from.name,
      toWarehouseId: row.toWarehouseId,
      toWarehouseName: to.name,
      occurredAt: row.occurredAt.toISOString(),
      note: row.note,
      lineCount,
      createdByName: names.get(row.createdBy) ?? 'Không rõ',
      shippedByName: nameOf(row.shippedBy),
      shippedAt: row.shippedAt?.toISOString() ?? null,
      receivedByName: nameOf(row.receivedBy),
      receivedAt: row.receivedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      fromBranchId: from.branchId,
      fromBranchName: from.branchName,
      toBranchId: to.branchId,
      toBranchName: to.branchName,
      receiveRejectReason: (row.receiveRejectReasonCode as StockTransferSummary['receiveRejectReason']) ?? null,
      receiveRejectNote: row.receiveRejectNote,
      receiveRejectedByName: nameOf(row.receiveRejectedBy),
      receiveRejectedAt: row.receiveRejectedAt?.toISOString() ?? null,
      returnConfirmedByName: nameOf(row.returnConfirmedBy),
      returnConfirmedAt: row.returnConfirmedAt?.toISOString() ?? null,
      varianceResolvedByName: nameOf(row.varianceResolvedBy),
      varianceResolvedAt: row.varianceResolvedAt?.toISOString() ?? null,
      varianceResolutionNote: row.varianceResolutionNote,
      version: row.version,
    };
  }

  private toDetailDto(
    row: StockTransferWithLines,
    from: { name: string; branchId: string; branchName: string },
    to: { name: string; branchId: string; branchName: string },
    names: Map<string, string>,
    canSeeCost: boolean,
  ): StockTransferDetail {
    return {
      ...this.toSummaryDto(row, from, to, row.lines.length, names),
      lines: row.lines.map((line) => ({
        id: line.id,
        drugId: line.drugId,
        drugCode: line.drug.code,
        drugName: line.drug.name,
        isBatchManaged: line.drug.isBatchManaged,
        batchId: line.batchId,
        batchNo: line.batch?.batchNo ?? null,
        expiryDate: line.batch?.expiryDate ? line.batch.expiryDate.toISOString().slice(0, 10) : null,
        quantityShipped: line.quantityShipped,
        quantityReceived: line.quantityReceived,
        varianceNote: line.varianceNote,
        varianceReason: (line.varianceReasonCode as StockTransferVarianceReason | null) ?? null,
        varianceResolution: (line.varianceResolution as 'RETURN_TO_SOURCE' | 'WRITE_OFF' | null) ?? null,
        quantityReturnedBack: line.quantityReturnedBack,
        returnVarianceNote: line.returnVarianceNote,
        unitCost: canSeeCost && line.unitCost !== null ? Number(line.unitCost) : null,
      })),
    };
  }
}

export type { TransferViewerRole };
