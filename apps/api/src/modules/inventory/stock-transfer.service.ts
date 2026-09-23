import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  StockTransferInsufficientStockError,
  StockTransferNotDraftError,
  StockTransferNotInTransitError,
  StockTransferReceivedExceedsShippedError,
  StockTransferVarianceNoteRequiredError,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  CreateStockTransferRequest,
  DataScope,
  ListStockTransfersQuery,
  ListStockTransfersResponse,
  ReceiveStockTransferRequest,
  RejectStockTransferRequest,
  ShipStockTransferRequest,
  StockTransferDetail,
  StockTransferSummary,
  UpdateStockTransferRequest,
} from '@nexamed/shared';
import type { Prisma, StockTransfer } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { DrugRepository } from '../drug/drug.repository';
import { WarehouseRepository } from '../drug/warehouse.repository';
import { StockTransferRepository, type StockTransferLineData, type StockTransferWithLines } from './stock-transfer.repository';
import { InventoryBatchRepository } from './inventory-batch.repository';
import { StockBalanceRepository } from './stock-balance.repository';
import type { StockReceiptLineData } from './stock-receipt.repository';
import { StockReceiptService } from './stock-receipt.service';
import { StockIssueService } from './stock-issue.service';

/**
 * Kho Thuốc & Vật tư y tế — Giai đoạn 4, phần "Điều chuyển kho" (docs/DECISIONS.md #170, kế hoạch
 * kỹ thuật bright-bubbling-axolotl.md, mockup đã duyệt). 1 LUỒNG DUY NHẤT tự sinh CẶP chứng từ liên
 * kết, tách 2 bước: Duyệt (`approveShip`, DRAFT→IN_TRANSIT, xuất kho NGUỒN NGAY, sinh `StockIssue`
 * TRANSFER_OUT) → Xác nhận nhận hàng (`confirmReceive`, IN_TRANSIT→COMPLETED, nhập kho ĐÍCH đúng SL
 * THỰC NHẬN, sinh `StockReceipt` TRANSFER_IN). KHÔNG hỗ trợ Huỷ sau khi đã IN_TRANSIT. Xác nhận nhận
 * hàng là MỘT LẦN DUY NHẤT — lệch phát hiện sau đó xử lý bằng Kiểm kê riêng ở kho đích.
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

  /** Phân quyền theo Khoa/Phòng (kiến trúc mục 0, docs/DECISIONS.md #170) — đúng khuôn
   * `StockCountService`. CHỈ gọi khi `dataScope==='department'`. */
  private async resolveActorDepartmentId(tenantId: string, actorId: string, dataScope: DataScope): Promise<string | null> {
    if (dataScope !== 'department') return null;
    return this.doctorDirectory.getDoctorDepartmentId(tenantId, actorId);
  }

  /** Chặn 404 nếu 1 kho cụ thể không thuộc đúng Khoa của actor khi scope `department` — dùng cho
   * Tạo/Sửa/Từ chối/Duyệt xuất (luôn kiểm theo kho NGUỒN — phía khởi tạo/xuất hàng) và Xác nhận
   * nhận hàng (kiểm theo kho ĐÍCH). */
  private assertWarehouseInScope(warehouseDepartmentId: string | null, dataScope: DataScope, actorDepartmentId: string | null): void {
    if (dataScope !== 'department') return;
    if (actorDepartmentId === null || warehouseDepartmentId !== actorDepartmentId) {
      throw new NotFoundException();
    }
  }

  /** XEM (GET) — nới hơn các thao tác ghi: actor thuộc Khoa quản lý kho NGUỒN **hoặc** kho ĐÍCH đều
   * xem được (cả 2 phía đều liên quan tới cùng 1 phiếu), không chỉ đúng 1 đầu như thao tác ghi. */
  private assertEitherWarehouseInScope(
    fromWarehouseDepartmentId: string | null,
    toWarehouseDepartmentId: string | null,
    dataScope: DataScope,
    actorDepartmentId: string | null,
  ): void {
    if (dataScope !== 'department') return;
    const inScope = actorDepartmentId !== null && (fromWarehouseDepartmentId === actorDepartmentId || toWarehouseDepartmentId === actorDepartmentId);
    if (!inScope) throw new NotFoundException();
  }

  async create(tenantId: string, actorId: string, dataScope: DataScope, dto: CreateStockTransferRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await this.resolveActorDepartmentId(tenantId, actorId, dataScope);

    const created = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const fromWarehouse = await this.warehouseRepository.findById(tx, tenantId, dto.fromWarehouseId);
      if (!fromWarehouse) throw new NotFoundException();
      const toWarehouse = await this.warehouseRepository.findById(tx, tenantId, dto.toWarehouseId);
      if (!toWarehouse) throw new NotFoundException();
      // Lập phiếu là hành động của phía kho NGUỒN (người chuẩn bị hàng đi) — kiểm scope theo kho
      // nguồn, cùng phía với "Duyệt xuất" bên dưới (thường cùng 1 actor ở phòng khám nhỏ).
      this.assertWarehouseInScope(fromWarehouse.departmentId, dataScope, actorDepartmentId);

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

    return this.getById(tenantId, actorId, dataScope, created.id);
  }

  /** Sửa Nháp — bulk-replace toàn bộ dòng hàng + header, chỉ khi `status='DRAFT'`. Kiểm scope CẢ 2
   * đầu kho NGUỒN: kho HIỆN TẠI của phiếu (không cho sửa phiếu ngoài Khoa mình) VÀ kho MỚI trong
   * `dto` (không cho "chuyển" phiếu sang kho nguồn ngoài Khoa mình) — đúng khuôn `StockCountService.update()`. */
  async update(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: UpdateStockTransferRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await this.resolveActorDepartmentId(tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockTransferNotDraftError();

      const currentFromWarehouse = await this.warehouseRepository.findById(tx, tenantId, existing.fromWarehouseId);
      this.assertWarehouseInScope(currentFromWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const fromWarehouse = await this.warehouseRepository.findById(tx, tenantId, dto.fromWarehouseId);
      if (!fromWarehouse) throw new NotFoundException();
      this.assertWarehouseInScope(fromWarehouse.departmentId, dataScope, actorDepartmentId);
      const toWarehouse = await this.warehouseRepository.findById(tx, tenantId, dto.toWarehouseId);
      if (!toWarehouse) throw new NotFoundException();

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

    return this.getById(tenantId, actorId, dataScope, id);
  }

  async getById(tenantId: string, actorId: string, dataScope: DataScope, id: string): Promise<StockTransferDetail> {
    const actorDepartmentId = await this.resolveActorDepartmentId(tenantId, actorId, dataScope);

    const row = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const transfer = await this.stockTransferRepository.findByIdAnyWithLines(tx, tenantId, id);
      if (!transfer) throw new NotFoundException();
      const [fromWarehouse, toWarehouse] = await Promise.all([
        this.warehouseRepository.findById(tx, tenantId, transfer.fromWarehouseId),
        this.warehouseRepository.findById(tx, tenantId, transfer.toWarehouseId),
      ]);
      this.assertEitherWarehouseInScope(fromWarehouse?.departmentId ?? null, toWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);
      return { transfer, fromWarehouseName: fromWarehouse?.name ?? '—', toWarehouseName: toWarehouse?.name ?? '—' };
    });

    const ids = new Set<string>([row.transfer.createdBy]);
    if (row.transfer.shippedBy) ids.add(row.transfer.shippedBy);
    if (row.transfer.receivedBy) ids.add(row.transfer.receivedBy);
    const names = await this.doctorDirectory.getUserFullNames(tenantId, [...ids]);
    return this.toDetailDto(row.transfer, row.fromWarehouseName, row.toWarehouseName, names);
  }

  async list(tenantId: string, actorId: string, dataScope: DataScope, query: ListStockTransfersQuery): Promise<ListStockTransfersResponse> {
    const actorDepartmentId = await this.resolveActorDepartmentId(tenantId, actorId, dataScope);
    if (dataScope === 'department' && actorDepartmentId === null) {
      return { items: [], nextCursor: null };
    }

    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.stockTransferRepository.list(tx, tenantId, {
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
      if (row.shippedBy) ids.add(row.shippedBy);
      if (row.receivedBy) ids.add(row.receivedBy);
    }
    const names = ids.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...ids]) : new Map<string, string>();

    return { items: page.map((row) => this.toSummaryDto(row, row.fromWarehouse.name, row.toWarehouse.name, row._count.lines, names)), nextCursor };
  }

  async reject(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: RejectStockTransferRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await this.resolveActorDepartmentId(tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockTransferNotDraftError();

      const fromWarehouse = await this.warehouseRepository.findById(tx, tenantId, existing.fromWarehouseId);
      this.assertWarehouseInScope(fromWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

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

    return this.getById(tenantId, actorId, dataScope, id);
  }

  /**
   * Duyệt (xuất kho NGUỒN) — DRAFT→IN_TRANSIT. Chuyển trạng thái ATOMIC (optimistic lock) TRƯỚC,
   * chỉ khi thành công mới kiểm tồn + snapshot `unitCost`/sinh `StockIssue` TRANSFER_OUT — đúng thứ
   * tự `StockReceiptService.approve()`→`applyPostedLines()` (nếu bước sau ném lỗi, cả transaction
   * rollback luôn cả việc đổi trạng thái, không để lại nửa vời).
   */
  async approveShip(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: ShipStockTransferRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await this.resolveActorDepartmentId(tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findByIdAnyWithLines(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockTransferNotDraftError();

      const fromWarehouse = await this.warehouseRepository.findById(tx, tenantId, existing.fromWarehouseId);
      this.assertWarehouseInScope(fromWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

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

    return this.getById(tenantId, actorId, dataScope, id);
  }

  /**
   * Xác nhận nhận hàng — IN_TRANSIT→COMPLETED, MỘT LẦN DUY NHẤT. Nhận ÍT hơn số đã xuất được (bắt
   * buộc `varianceNote`), KHÔNG được nhận NHIỀU hơn (chặn cứng, đúng cả CHECK DB). Cộng tồn kho ĐÍCH
   * đúng số THỰC NHẬN, dùng `unitCost` đã snapshot từ lúc Duyệt xuất (không đọc lại giá vốn kho
   * nguồn — có thể đã đổi giữa lúc xuất và lúc nhận).
   */
  async confirmReceive(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: ReceiveStockTransferRequest, meta: RequestMeta): Promise<StockTransferDetail> {
    const actorDepartmentId = await this.resolveActorDepartmentId(tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockTransferRepository.findByIdAnyWithLines(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'IN_TRANSIT') throw new StockTransferNotInTransitError();

      const toWarehouse = await this.warehouseRepository.findById(tx, tenantId, existing.toWarehouseId);
      this.assertWarehouseInScope(toWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      if (dto.lines.length !== existing.lines.length) {
        throw new UnprocessableEntityException('Danh sách dòng hàng thực nhận không khớp số dòng của phiếu gốc.');
      }
      const inputByLineId = new Map(dto.lines.map((l) => [l.lineId, l]));

      const lineUpdates: { lineId: string; quantityReceived: number; varianceNote: string | null }[] = [];
      const receiptLines: StockReceiptLineData[] = [];
      for (const line of existing.lines) {
        const input = inputByLineId.get(line.id);
        if (!input) throw new NotFoundException();
        if (input.quantityReceived > line.quantityShipped) {
          throw new StockTransferReceivedExceedsShippedError(line.drug.name);
        }
        const varianceNote = input.varianceNote?.trim() || null;
        if (input.quantityReceived < line.quantityShipped && !varianceNote) {
          throw new StockTransferVarianceNoteRequiredError(line.drug.name);
        }
        lineUpdates.push({ lineId: line.id, quantityReceived: input.quantityReceived, varianceNote });

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
          });
        }
      }

      const receivedCount = await this.stockTransferRepository.markReceived(tx, tenantId, id, dto.version, actorId);
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
        afterJson: { status: 'COMPLETED', generatedReceiptId, lines: lineUpdates },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, actorId, dataScope, id);
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

  private toSummaryDto(row: StockTransfer, fromWarehouseName: string, toWarehouseName: string, lineCount: number, names: Map<string, string>): StockTransferSummary {
    return {
      id: row.id,
      transferNo: row.transferNo,
      status: row.status,
      fromWarehouseId: row.fromWarehouseId,
      fromWarehouseName,
      toWarehouseId: row.toWarehouseId,
      toWarehouseName,
      occurredAt: row.occurredAt.toISOString(),
      note: row.note,
      lineCount,
      createdByName: names.get(row.createdBy) ?? 'Không rõ',
      shippedByName: row.shippedBy ? (names.get(row.shippedBy) ?? 'Không rõ') : null,
      shippedAt: row.shippedAt?.toISOString() ?? null,
      receivedByName: row.receivedBy ? (names.get(row.receivedBy) ?? 'Không rõ') : null,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      version: row.version,
    };
  }

  private toDetailDto(row: StockTransferWithLines, fromWarehouseName: string, toWarehouseName: string, names: Map<string, string>): StockTransferDetail {
    return {
      ...this.toSummaryDto(row, fromWarehouseName, toWarehouseName, row.lines.length, names),
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
      })),
    };
  }
}
