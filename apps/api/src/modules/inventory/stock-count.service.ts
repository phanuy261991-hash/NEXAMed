import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  classifyStockCountDifference,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  StockCountApprovalReasonRequiredError,
  StockCountNotDraftError,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  ApproveStockCountRequest,
  CreateStockCountRequest,
  DataScope,
  ListStockCountsQuery,
  ListStockCountsResponse,
  RejectStockCountRequest,
  StockCountDetail,
  StockCountSummary,
  UpdateStockCountRequest,
} from '@nexamed/shared';
import type { Prisma, StockCount } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { assertWarehouseInScope, resolveActorDepartmentId } from '../../common/warehouse-scope.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { DrugRepository } from '../drug/drug.repository';
import { WarehouseRepository } from '../drug/warehouse.repository';
import { StockCountRepository, type StockCountLineData, type StockCountWithLines } from './stock-count.repository';
import { InventoryBatchRepository } from './inventory-batch.repository';
import { StockBalanceRepository } from './stock-balance.repository';
import type { StockReceiptLineData } from './stock-receipt.repository';
import { StockReceiptService } from './stock-receipt.service';
import { StockIssueService } from './stock-issue.service';

/**
 * Kho Thuốc & Vật tư y tế — Giai đoạn 4, phần "Kiểm kê" (docs/DECISIONS.md #170, kế hoạch kỹ thuật
 * bright-bubbling-axolotl.md, mockup đã duyệt). Luồng Nháp (đếm, sửa tự do) → Duyệt (đọc lại
 * `stock_balance` SỐNG tại thời điểm Duyệt để tính dư/thiếu — KHÔNG dùng `systemQuantitySnapshot`
 * cũ lưu trên dòng) / Từ chối, đúng khuôn `StockReceiptService`. Duyệt tự sinh 1 `StockReceipt`
 * (`COUNT_SURPLUS`, dư) và/hoặc 1 `StockIssue` (`COUNT_SHORTAGE`, thiếu) trong CÙNG transaction —
 * gọi 2 method dùng chung mới thêm ở `StockReceiptService`/`StockIssueService` để không lặp lại
 * logic cộng/trừ tồn + ghi thẻ kho.
 */
@Injectable()
export class StockCountService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly stockCountRepository: StockCountRepository,
    private readonly drugRepository: DrugRepository,
    private readonly warehouseRepository: WarehouseRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly stockBalanceRepository: StockBalanceRepository,
    private readonly businessCodeService: BusinessCodeService,
    private readonly stockReceiptService: StockReceiptService,
    private readonly stockIssueService: StockIssueService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  async create(tenantId: string, actorId: string, dataScope: DataScope, dto: CreateStockCountRequest, meta: RequestMeta): Promise<StockCountDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const created = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const warehouse = await this.warehouseRepository.findById(tx, tenantId, dto.warehouseId);
      if (!warehouse) throw new NotFoundException();
      assertWarehouseInScope(warehouse.departmentId, dataScope, actorDepartmentId);

      const lines = await this.buildLineData(tx, tenantId, dto.lines);
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const countNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_COUNT', occurredAt);

      const row = await this.stockCountRepository.create(tx, tenantId, actorId, {
        countNo,
        warehouseId: dto.warehouseId,
        occurredAt,
        note: dto.note ?? null,
        lines,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_count.created',
        entityType: 'stock_count',
        entityId: row.id,
        afterJson: { countNo, warehouseId: dto.warehouseId, lineCount: lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return row;
    });

    return this.getById(tenantId, actorId, dataScope, created.id);
  }

  /** Sửa Nháp — bulk-replace toàn bộ dòng đếm + header, chỉ khi `status='DRAFT'`. Kiểm scope CẢ 2
   * đầu: kho HIỆN TẠI của phiếu (không cho sửa phiếu ngoài Khoa mình) VÀ kho MỚI trong `dto` (không
   * cho "chuyển" phiếu sang kho ngoài Khoa mình). */
  async update(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: UpdateStockCountRequest, meta: RequestMeta): Promise<StockCountDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockCountRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockCountNotDraftError();

      const currentWarehouse = await this.warehouseRepository.findById(tx, tenantId, existing.warehouseId);
      assertWarehouseInScope(currentWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const warehouse = await this.warehouseRepository.findById(tx, tenantId, dto.warehouseId);
      if (!warehouse) throw new NotFoundException();
      assertWarehouseInScope(warehouse.departmentId, dataScope, actorDepartmentId);

      const lines = await this.buildLineData(tx, tenantId, dto.lines);
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : existing.occurredAt;

      const count = await this.stockCountRepository.updateDraft(tx, tenantId, id, dto.version, actorId, {
        warehouseId: dto.warehouseId,
        occurredAt,
        note: dto.note ?? null,
        lines,
      });
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_count.updated',
        entityType: 'stock_count',
        entityId: id,
        afterJson: { warehouseId: dto.warehouseId, lineCount: lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, actorId, dataScope, id);
  }

  async getById(tenantId: string, actorId: string, dataScope: DataScope, id: string): Promise<StockCountDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const row = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.stockCountRepository.findByIdAnyWithLines(tx, tenantId, id);
      if (!count) throw new NotFoundException();
      const warehouse = await this.warehouseRepository.findById(tx, tenantId, count.warehouseId);
      assertWarehouseInScope(warehouse?.departmentId ?? null, dataScope, actorDepartmentId);
      return { count, warehouseName: warehouse?.name ?? '—' };
    });

    const names = await this.doctorDirectory.getUserFullNames(tenantId, row.count.approvedBy ? [row.count.createdBy, row.count.approvedBy] : [row.count.createdBy]);
    return this.toDetailDto(row.count, row.warehouseName, names);
  }

  async list(tenantId: string, actorId: string, dataScope: DataScope, query: ListStockCountsQuery): Promise<ListStockCountsResponse> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    // Scope `department` nhưng actor CHƯA gán Khoa/Phòng nào — không thể khớp bất kỳ kho nào, trả
    // rỗng ngay (không lỗi) thay vì query rồi lọc ra 0 kết quả.
    if (dataScope === 'department' && actorDepartmentId === null) {
      return { items: [], nextCursor: null };
    }

    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.stockCountRepository.list(tx, tenantId, {
        warehouseId: query.warehouseId,
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
      if (row.approvedBy) ids.add(row.approvedBy);
    }
    const names = ids.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...ids]) : new Map<string, string>();

    return { items: page.map((row) => this.toSummaryDto(row, row.warehouse.name, row._count.lines, names)), nextCursor };
  }

  async reject(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: RejectStockCountRequest, meta: RequestMeta): Promise<StockCountDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockCountRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockCountNotDraftError();

      const warehouse = await this.warehouseRepository.findById(tx, tenantId, existing.warehouseId);
      assertWarehouseInScope(warehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const count = await this.stockCountRepository.reject(tx, tenantId, id, dto.version, actorId, dto.reason);
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_count.rejected',
        entityType: 'stock_count',
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
   * Duyệt — với MỖI dòng, đọc LẠI `stock_balance` SỐNG tại thời điểm Duyệt (không dùng
   * `systemQuantitySnapshot` cũ lưu trên dòng lúc thêm — tránh sai lệch nếu có giao dịch khác xảy
   * ra giữa lúc đếm và lúc duyệt). Gom mọi dòng DƯ thành 1 `StockReceipt` tự sinh
   * (`COUNT_SURPLUS`), mọi dòng THIẾU thành 1 `StockIssue` tự sinh (`COUNT_SHORTAGE`) — cả hai POST
   * NGAY trong cùng transaction, đúng thiết kế đã chốt.
   */
  async approve(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: ApproveStockCountRequest, meta: RequestMeta): Promise<StockCountDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockCountRepository.findByIdAnyWithLines(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockCountNotDraftError();

      const existingWarehouse = await this.warehouseRepository.findById(tx, tenantId, existing.warehouseId);
      assertWarehouseInScope(existingWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const differenceUpdates: { lineId: string; difference: number }[] = [];
      const surplusLines: StockReceiptLineData[] = [];
      const shortageLines: { drugId: string; batchId: string | null; quantity: number; unitCost: bigint }[] = [];

      for (const line of existing.lines) {
        const drug = line.drug;
        let liveQuantity = 0;
        let unitCost = 0n;

        if (drug.isBatchManaged && line.batchId) {
          const [balance, batch] = await Promise.all([
            this.stockBalanceRepository.findByKey(tx, tenantId, line.drugId, existing.warehouseId, line.batchId),
            this.inventoryBatchRepository.findById(tx, tenantId, line.batchId),
          ]);
          liveQuantity = balance?.quantityOnHand ?? 0;
          unitCost = batch?.unitCost ?? 0n;
        } else if (!drug.isBatchManaged) {
          const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, line.drugId, existing.warehouseId, null);
          liveQuantity = balance?.quantityOnHand ?? 0;
          unitCost = balance?.averageUnitCost ?? 0n;
        }
        // else: hàng quản lý theo lô nhưng `batchId=null` (lô MỚI phát hiện lúc đếm, chưa từng có
        // trong hệ thống) — tồn sống chắc chắn = 0, giá vốn chưa biết = 0 (giữ mặc định ở trên).

        const { difference, kind } = classifyStockCountDifference(line.countedQuantity, liveQuantity);
        differenceUpdates.push({ lineId: line.id, difference });

        if (kind === 'SURPLUS') {
          surplusLines.push({
            drugId: line.drugId,
            unitCode: '', // gán lại đúng đơn vị CƠ SỞ ngay dưới vòng lặp này (cần tra `drug.baseUnitCode`)
            quantity: difference,
            unitCost,
            batchNo: line.batchId ? (line.batch?.batchNo ?? null) : line.newBatchNo,
            expiryDate: line.batchId ? (line.batch?.expiryDate ?? null) : line.newBatchExpiryDate,
            lineAmount: unitCost * BigInt(difference),
            // Phiếu tự sinh — không có khái niệm chiết khấu (Kho Thuốc GĐ4, "Phiếu nhập kho mở rộng", #170).
            discountType: null,
            discountValue: null,
          });
        } else if (kind === 'SHORTAGE') {
          shortageLines.push({ drugId: line.drugId, batchId: line.batchId, quantity: -difference, unitCost });
        }
      }

      // Bắt buộc lý do CHỈ khi có dòng dư/thiếu thật (tính từ tồn kho SỐNG ở trên, không phải
      // preview client gửi lên) — rà soát lỗ hổng quy trình 22/09/2026. Kiểm TRƯỚC khi lật trạng
      // thái/sinh chứng từ để không phải rollback ngược lại khi thiếu lý do.
      const approvalReason = dto.reason?.trim() || null;
      if ((surplusLines.length > 0 || shortageLines.length > 0) && !approvalReason) {
        throw new StockCountApprovalReasonRequiredError();
      }

      const approvedCount = await this.stockCountRepository.approve(tx, tenantId, id, dto.version, actorId, approvalReason);
      if (approvedCount === 0) throw new ConcurrentModificationError();

      // `unitCode` của dòng dư PHẢI là đơn vị CƠ SỞ của đúng thuốc đó (đơn vị mà `difference` đã
      // tính theo, vì `stock_balance`/`countedQuantity` đều luôn ở đơn vị cơ sở) — tra lại 1 lượt
      // sau vòng lặp trên để không phải gọi `findByIdWithDetails` 2 lần/dòng.
      if (surplusLines.length > 0) {
        const drugIds = [...new Set(surplusLines.map((l) => l.drugId))];
        const drugs = await this.drugRepository.findByIds(tx, tenantId, drugIds);
        const baseUnitByDrugId = new Map(drugs.map((d) => [d.id, d.baseUnitCode ?? '']));
        for (const line of surplusLines) {
          line.unitCode = baseUnitByDrugId.get(line.drugId) ?? '';
        }
      }

      await this.stockCountRepository.updateLineDifferences(tx, tenantId, actorId, differenceUpdates);

      let generatedReceiptId: string | null = null;
      let generatedIssueId: string | null = null;

      if (surplusLines.length > 0) {
        const receipt = await this.stockReceiptService.createCountSurplusReceipt(tx, tenantId, actorId, {
          warehouseId: existing.warehouseId,
          countId: id,
          occurredAt: new Date(),
          countNo: existing.countNo,
          lines: surplusLines,
        });
        generatedReceiptId = receipt.id;
      }
      if (shortageLines.length > 0) {
        const issue = await this.stockIssueService.createCountShortageIssue(tx, tenantId, actorId, {
          warehouseId: existing.warehouseId,
          countId: id,
          occurredAt: new Date(),
          countNo: existing.countNo,
          lines: shortageLines,
        });
        generatedIssueId = issue.id;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_count.approved',
        entityType: 'stock_count',
        entityId: id,
        beforeJson: { status: 'DRAFT' },
        afterJson: { status: 'POSTED', surplusLineCount: surplusLines.length, shortageLineCount: shortageLines.length, generatedReceiptId, generatedIssueId, approvalReason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, actorId, dataScope, id);
  }

  // ============ helpers ============

  private async buildLineData(tx: Prisma.TransactionClient, tenantId: string, lines: CreateStockCountRequest['lines']): Promise<StockCountLineData[]> {
    const result: StockCountLineData[] = [];
    for (const line of lines) {
      const drug = await this.drugRepository.findById(tx, tenantId, line.drugId);
      if (!drug) throw new NotFoundException();
      if (drug.isBatchManaged && !line.batchId && !line.newBatchNo) {
        throw new UnprocessableEntityException(`Thuốc/vật tư "${drug.name}" quản lý theo lô — phải chọn lô có sẵn hoặc nhập lô mới.`);
      }
      result.push({
        drugId: line.drugId,
        batchId: line.batchId ?? null,
        newBatchNo: line.newBatchNo ?? null,
        newBatchExpiryDate: line.newBatchExpiryDate ? new Date(`${line.newBatchExpiryDate}T00:00:00Z`) : null,
        systemQuantitySnapshot: line.systemQuantitySnapshot,
        countedQuantity: line.countedQuantity,
      });
    }
    return result;
  }

  private toSummaryDto(row: StockCount, warehouseName: string, lineCount: number, names: Map<string, string>): StockCountSummary {
    return {
      id: row.id,
      countNo: row.countNo,
      status: row.status,
      warehouseId: row.warehouseId,
      warehouseName,
      occurredAt: row.occurredAt.toISOString(),
      note: row.note,
      lineCount,
      createdByName: names.get(row.createdBy) ?? 'Không rõ',
      approvedByName: row.approvedBy ? (names.get(row.approvedBy) ?? 'Không rõ') : null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      approvalReason: row.approvalReason,
      rejectionReason: row.rejectionReason,
      version: row.version,
    };
  }

  private toDetailDto(row: StockCountWithLines, warehouseName: string, names: Map<string, string>): StockCountDetail {
    return {
      ...this.toSummaryDto(row, warehouseName, row.lines.length, names),
      lines: row.lines.map((line) => ({
        id: line.id,
        drugId: line.drugId,
        drugCode: line.drug.code,
        drugName: line.drug.name,
        isBatchManaged: line.drug.isBatchManaged,
        batchId: line.batchId,
        batchNo: line.batchId ? (line.batch?.batchNo ?? null) : line.newBatchNo,
        expiryDate: line.batchId
          ? (line.batch?.expiryDate ? line.batch.expiryDate.toISOString().slice(0, 10) : null)
          : line.newBatchExpiryDate
            ? line.newBatchExpiryDate.toISOString().slice(0, 10)
            : null,
        isNewBatch: line.batchId === null && line.newBatchNo !== null,
        systemQuantitySnapshot: line.systemQuantitySnapshot,
        countedQuantity: line.countedQuantity,
        difference: line.difference,
      })),
    };
  }
}
