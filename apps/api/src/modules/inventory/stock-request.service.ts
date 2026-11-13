import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CLINIC_CONFIG_READER_PORT,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  StockRequestAllocationInvalidError,
  StockRequestDisabledError,
  StockRequestInsufficientStockError,
  StockRequestInvalidStateError,
  StockRequestNoSupplierError,
  computeLineProgress,
  isPurchaseOrderPlaced,
  getVietnamDateString,
  requesterActions,
  resolveSupplyingWarehouseId,
  selectFefoBatches,
  supplierActions,
  vietnamDayEndUtc,
  vietnamDayStartUtc,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  AddStockRequestLinesRequest,
  AllocateStockRequestRequest,
  CancelStockRequestRequest,
  CreateStockRequestRequest,
  DataScope,
  EscalateStockRequestRequest,
  EscalateStockRequestResponse,
  GetStockRequestLowStockResponse,
  GetStockRequestOptionsResponse,
  GetStockRequestPendingCountsResponse,
  GetStockRequestRestockResponse,
  ListStockRequestsQuery,
  ListStockRequestsResponse,
  RejectStockRequestRequest,
  ResolveStockRequestWithdrawRequest,
  StockRequestDetail,
  StockRequestStatus,
  StockRequestSummary,
  UpdateStockRequestNoteRequest,
  UpdateStockRequestRequest,
  VersionedStockRequestRequest,
  WithdrawStockRequestLinesRequest,
} from '@nexamed/shared';
import type { Prisma } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { assertEitherWarehouseInScope, assertWarehouseInScope, resolveActorDepartmentId } from '../../common/warehouse-scope.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { DrugRepository } from '../drug/drug.repository';
import { WarehouseRepository, type WarehouseWithDepartment } from '../drug/warehouse.repository';
import { InventoryBatchRepository } from './inventory-batch.repository';
import { StockBalanceRepository } from './stock-balance.repository';
import { StockRequestRepository, type StockRequestDetailRow, type StockRequestLineData, type StockRequestListRow } from './stock-request.repository';
import { StockRequestSyncService, toLineInput } from './stock-request-sync.service';
import { StockTransferRepository, type StockTransferLineData } from './stock-transfer.repository';

const ALL_STATUSES: StockRequestStatus[] = ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED', 'WITHDRAWN'];
/** Chi nhánh NHẬN thấy phiếu điều chuyển từ lúc nó đã rời chi nhánh gửi — cùng quy tắc `stock-transfer.repository.ts`. */
const RECEIVER_VISIBLE_TRANSFER_STATUSES = ['IN_TRANSIT', 'COMPLETED', 'VARIANCE_PENDING', 'RETURNING', 'RETURNED'];

/** Cột DATE lưu ngày dương lịch nguyên văn (00:00 UTC của chính ngày đó) — không quy đổi múi giờ như mốc đầu ngày để cắt khoảng. */
const dateOnly = (value: string | null | undefined): Date | null => (value ? new Date(`${value}T00:00:00Z`) : null);
const toDateString = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);

/**
 * "Yêu cầu cấp hàng" theo cấp (docs/DECISIONS.md #298, mockup chủ dự án duyệt 12/11/2026).
 *  - Bên XIN (kho phòng ban hoặc kho chính chi nhánh phụ): lập, sửa, gửi, huỷ, nhắn bổ sung, thêm/rút dòng.
 *  - Bên CẤP (kho cấp cấp trên, suy ra theo cấp): Tiếp nhận, Từ chối cả phiếu, "Chuyển thành phiếu điều chuyển" (cấp từng phần, phần chưa cấp chờ hàng về hoặc từ chối),
 *    "Xin phần thiếu" lên cấp trên.
 * Hàng đi bằng Phiếu điều chuyển kho sẵn có (nháp tự tạo); số đã cấp/đã nhận suy ra từ phiếu điều chuyển liên kết, trạng thái phiếu đồng bộ qua `StockRequestSyncService`.
 * Chi nhánh kế thừa qua kho xin/kho cấp (#231): bên cấp chỉ thấy từ lúc phiếu đã gửi, bên xin thấy phiếu của kho thuộc chi nhánh mình.
 */
@Injectable()
export class StockRequestService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly stockRequestRepository: StockRequestRepository,
    private readonly syncService: StockRequestSyncService,
    private readonly stockTransferRepository: StockTransferRepository,
    private readonly warehouseRepository: WarehouseRepository,
    private readonly drugRepository: DrugRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly stockBalanceRepository: StockBalanceRepository,
    private readonly businessCodeService: BusinessCodeService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  // ============ Chung ============

  private async assertEnabled(tenantId: string): Promise<void> {
    if (!(await this.clinicConfigReader.getStockRequestEnabled(tenantId))) throw new StockRequestDisabledError();
  }

  /** Kho cấp của một kho xin (hoặc `null` khi không có cấp trên) — đọc kho mặc định chi nhánh + kho mặc định chi nhánh chính trong CÙNG transaction. */
  private async resolveSupplier(tx: Prisma.TransactionClient, tenantId: string, requesting: { id: string; branchId: string }): Promise<WarehouseWithDepartment | null> {
    const [branchDefault, mainDefault] = await Promise.all([this.warehouseRepository.findDefault(tx, tenantId, requesting.branchId), this.warehouseRepository.findMainBranchDefault(tx, tenantId)]);
    const supplierId = resolveSupplyingWarehouseId(requesting, branchDefault, mainDefault);
    if (!supplierId) return null;
    const supplier = await this.warehouseRepository.findByIdAnyBranch(tx, tenantId, supplierId);
    return supplier && supplier.isActive ? supplier : null;
  }

  private async buildLines(tx: Prisma.TransactionClient, tenantId: string, requestingWarehouseId: string, inputs: { drugId: string; requestedQty: number; lineNote?: string | null }[], addedAfterAccept = false): Promise<StockRequestLineData[]> {
    const ids = [...new Set(inputs.map((l) => l.drugId))];
    const drugs = await this.drugRepository.findByIds(tx, tenantId, ids);
    if (drugs.length !== ids.length) throw new UnprocessableEntityException('Có mặt hàng không tồn tại hoặc đã bị xoá.');
    const inactive = drugs.find((d) => !d.isActive);
    if (inactive) throw new UnprocessableEntityException(`Mặt hàng "${inactive.name}" đã ngừng sử dụng, không thể thêm vào phiếu.`);
    const stock = await this.stockBalanceRepository.sumOnHandByWarehouseDrugs(tx, tenantId, [requestingWarehouseId], ids);
    return inputs.map((l) => ({
      drugId: l.drugId,
      requestedQty: l.requestedQty,
      lineNote: l.lineNote?.trim() || null,
      requesterStockSnapshot: stock.get(`${requestingWarehouseId}:${l.drugId}`) ?? 0,
      addedAfterAccept,
    }));
  }

  private async audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, id: string, action: string, afterJson: Prisma.InputJsonValue, meta: RequestMeta, beforeJson?: Prisma.InputJsonValue): Promise<void> {
    await writeAuditLog(tx, tenantId, { actorId, action, entityType: 'stock_request', entityId: id, beforeJson, afterJson, ip: meta.ip, userAgent: meta.userAgent });
  }

  // ============ Đọc ============

  async getById(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const loaded = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const row = await this.stockRequestRepository.findDetailById(tx, tenantId, branchId, id, 'viewer');
      if (!row) throw new NotFoundException();
      assertEitherWarehouseInScope(row.requestingWarehouse.departmentId, row.supplyingWarehouse.departmentId, dataScope, actorDepartmentId);
      const canActAsSupplier = this.isSupplierSide(row, branchId, dataScope, actorDepartmentId);
      const stock = canActAsSupplier
        ? await this.stockBalanceRepository.sumOnHandByWarehouseDrugs(tx, tenantId, [row.supplyingWarehouseId], row.lines.map((l) => l.drugId))
        : null;
      const supplierOfSupplier = await this.resolveSupplier(tx, tenantId, { id: row.supplyingWarehouse.id, branchId: row.supplyingWarehouse.branchId });
      return { row, stock, canEscalate: canActAsSupplier && supplierOfSupplier !== null };
    });

    const names = await this.userNames(tenantId, [loaded.row.createdBy, loaded.row.acceptedBy, ...loaded.row.events.map((e) => e.actorId)]);
    return this.toDetailDto(loaded.row, { branchId, dataScope, actorDepartmentId, names, stock: loaded.stock, canEscalate: loaded.canEscalate });
  }

  async list(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, query: ListStockRequestsQuery): Promise<ListStockRequestsResponse> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    if (dataScope === 'department' && actorDepartmentId === null) {
      return { items: [], nextCursor: null, statusCounts: this.zeroCounts() };
    }
    const filter = this.toFilter(branchId, dataScope, actorDepartmentId, query, query.limit + 1);

    const result = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [rows, counts] = await Promise.all([this.stockRequestRepository.list(tx, tenantId, filter), this.stockRequestRepository.countByStatus(tx, tenantId, filter)]);
      const page = rows.length > query.limit ? rows.slice(0, query.limit) : rows;
      const ready = query.view === 'incoming' ? await this.readyRequestIds(tx, tenantId, page) : new Set<string>();
      return { rows, page, counts, ready };
    });
    const hasMore = result.rows.length > query.limit;
    const names = await this.userNames(tenantId, result.page.flatMap((r) => [r.createdBy, r.acceptedBy]));
    return {
      items: result.page.map((r) => this.toSummaryDto(r, names, result.ready.has(r.id))),
      nextCursor: hasMore ? (result.page[result.page.length - 1]?.id ?? null) : null,
      statusCounts: { ...this.zeroCounts(), ...result.counts },
    };
  }

  /** Mọi dòng khớp bộ lọc (không phân trang, tối đa 5000) — cho Xuất Excel danh sách. */
  async listAllForExport(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, query: ListStockRequestsQuery): Promise<{ items: StockRequestSummary[] }> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    if (dataScope === 'department' && actorDepartmentId === null) return { items: [] };
    const filter = this.toFilter(branchId, dataScope, actorDepartmentId, { ...query, cursor: undefined }, 5000);
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.stockRequestRepository.list(tx, tenantId, filter));
    const names = await this.userNames(tenantId, rows.flatMap((r) => [r.createdBy, r.acceptedBy]));
    return { items: rows.map((r) => this.toSummaryDto(r, names, false)) };
  }

  async recordExportAudit(tenantId: string, actorId: string, query: ListStockRequestsQuery, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.audit(tx, tenantId, actorId, tenantId, 'stock_request.exported', { view: query.view, status: query.status ?? null, from: query.from ?? null, to: query.to ?? null }, meta),
    );
  }

  async getPendingCounts(tenantId: string, branchId: string, actorId: string, dataScope: DataScope): Promise<GetStockRequestPendingCountsResponse> {
    // Công tắc tắt thì chấm số trên menu cũng không cần — trả 0 thay vì 409 (menu đã ẩn theo công tắc, cuộc gọi này chỉ là phòng thủ).
    if (!(await this.clinicConfigReader.getStockRequestEnabled(tenantId))) return { toAccept: 0, updated: 0 };
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    if (dataScope === 'department' && actorDepartmentId === null) return { toAccept: 0, updated: 0 };
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.stockRequestRepository.countPending(tx, tenantId, branchId, dataScope === 'department' ? (actorDepartmentId ?? undefined) : undefined));
  }

  /** Các kho người dùng được phép xin kèm kho cấp suy ra theo cấp — kho nào không có cấp trên thì không xuất hiện. */
  async getOptions(tenantId: string, branchId: string, actorId: string, dataScope: DataScope): Promise<GetStockRequestOptionsResponse> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    if (dataScope === 'department' && actorDepartmentId === null) return { options: [] };

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [warehouses, branchDefault, mainDefault] = await Promise.all([
        this.warehouseRepository.list(tx, tenantId, [branchId]),
        this.warehouseRepository.findDefault(tx, tenantId, branchId),
        this.warehouseRepository.findMainBranchDefault(tx, tenantId),
      ]);
      const byId = new Map<string, WarehouseWithDepartment>();
      const options: GetStockRequestOptionsResponse['options'] = [];
      const candidates = warehouses.filter((w) => w.isActive && (dataScope !== 'department' || w.departmentId === actorDepartmentId));
      for (const w of candidates) {
        const supplierId = resolveSupplyingWarehouseId({ id: w.id, branchId: w.branchId }, branchDefault, mainDefault);
        if (!supplierId) continue;
        let supplier = byId.get(supplierId) ?? warehouses.find((x) => x.id === supplierId) ?? null;
        if (!supplier) supplier = await this.warehouseRepository.findByIdAnyBranch(tx, tenantId, supplierId);
        if (!supplier || !supplier.isActive) continue;
        byId.set(supplierId, supplier);
        options.push({
          requestingWarehouseId: w.id,
          requestingWarehouseName: w.name,
          supplyingWarehouseId: supplier.id,
          supplyingWarehouseName: supplier.name,
          supplyingBranchId: supplier.branchId,
          supplyingBranchName: supplier.branch.name,
        });
      }
      return { options };
    });
  }

  /** "Thêm các mặt hàng dưới mức tồn tối thiểu" — gợi ý số xin để về tới mức tối thiểu, người dùng sửa trước khi gửi. */
  async getLowStock(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, warehouseId: string): Promise<GetStockRequestLowStockResponse> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const warehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, warehouseId);
      if (!warehouse) throw new NotFoundException();
      assertWarehouseInScope(warehouse.departmentId, dataScope, actorDepartmentId);
      const rows = await this.stockRequestRepository.listLowStock(tx, tenantId, warehouseId);
      return { items: rows.map((r) => ({ drugId: r.drugId, drugCode: r.code, drugName: r.name, unitCode: r.unitCode, onHand: r.onHand, minStock: r.minStock, suggestedQty: Math.max(r.minStock - r.onHand, 1) })) };
    });
  }

  /**
   * Tab "Hàng cần bổ sung" (mockup màn 4): kho chính của chi nhánh đang làm — mặt hàng dưới mức tối thiểu kèm phần các phòng ban đang chờ cấp. Từ đây người dùng chọn xin chi nhánh chính hoặc đặt NCC
   * (web điền sẵn form tương ứng). Chi nhánh không có kho chính (hiếm) trả danh sách rỗng.
   */
  async getRestock(tenantId: string, branchId: string, actorId: string, dataScope: DataScope): Promise<GetStockRequestRestockResponse> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    const empty: GetStockRequestRestockResponse = { warehouseId: null, warehouseName: null, canRequestUp: false, stats: { belowMin: 0, deptWaiting: 0, waitingArrival: 0, requestedUp: 0 }, items: [] };
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const main = await this.warehouseRepository.findDefault(tx, tenantId, branchId);
      if (!main) return empty;
      assertWarehouseInScope(main.departmentId, dataScope, actorDepartmentId);
      const [needs, upper] = await Promise.all([this.stockRequestRepository.listRestockNeeds(tx, tenantId, main.id), this.resolveSupplier(tx, tenantId, { id: main.id, branchId })]);
      return {
        warehouseId: main.id,
        warehouseName: main.name,
        canRequestUp: upper !== null,
        stats: { belowMin: needs.items.length, deptWaiting: needs.items.filter((i) => i.deptWaitingQty > 0).length, waitingArrival: needs.waitingArrival, requestedUp: needs.requestedUp },
        items: needs.items,
      };
    });
  }

  // ============ Bên XIN ============

  async create(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, dto: CreateStockRequestRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const id = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const requesting = await this.warehouseRepository.findById(tx, tenantId, branchId, dto.requestingWarehouseId);
      if (!requesting || !requesting.isActive) throw new NotFoundException();
      assertWarehouseInScope(requesting.departmentId, dataScope, actorDepartmentId);
      const supplier = await this.resolveSupplier(tx, tenantId, requesting);
      if (!supplier) throw new StockRequestNoSupplierError();

      const lines = await this.buildLines(tx, tenantId, requesting.id, dto.lines);
      const requestNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_REQUEST', new Date());
      const row = await this.stockRequestRepository.create(tx, tenantId, actorId, {
        requestNo,
        requestingWarehouseId: requesting.id,
        supplyingWarehouseId: supplier.id,
        priority: dto.priority,
        neededBy: dateOnly(dto.neededBy),
        note: dto.note?.trim() || null,
        parentRequestId: null,
        submitted: dto.submit,
        lines,
      });
      await this.stockRequestRepository.addEvent(tx, tenantId, row.id, actorId, dto.submit ? 'submitted' : 'created', dto.submit ? 'Đã gửi' : 'Đã lưu nháp');
      await this.audit(tx, tenantId, actorId, row.id, dto.submit ? 'stock_request.submitted' : 'stock_request.created', { requestNo, requestingWarehouseId: requesting.id, supplyingWarehouseId: supplier.id, lineCount: lines.length }, meta);
      return row.id;
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** Sửa tự do khi còn Nháp/Đã gửi (kho cấp chưa tiếp nhận) — thay toàn bộ dòng, kho cấp tính lại theo kho xin mới. */
  async update(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: UpdateStockRequestRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireRequester(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      if (!requesterActions(existing.status).edit) throw new StockRequestInvalidStateError('Phiếu đã được kho cấp tiếp nhận nên không sửa tự do được. Dùng "Thêm mặt hàng" hoặc "Rút dòng".');

      const requesting = await this.warehouseRepository.findById(tx, tenantId, branchId, dto.requestingWarehouseId);
      if (!requesting || !requesting.isActive) throw new NotFoundException();
      assertWarehouseInScope(requesting.departmentId, dataScope, actorDepartmentId);
      const supplier = await this.resolveSupplier(tx, tenantId, requesting);
      if (!supplier) throw new StockRequestNoSupplierError();

      const lines = await this.buildLines(tx, tenantId, requesting.id, dto.lines);
      const count = await this.stockRequestRepository.replaceDraft(
        tx,
        tenantId,
        id,
        dto.version,
        actorId,
        { requestingWarehouseId: requesting.id, supplyingWarehouseId: supplier.id, priority: dto.priority, neededBy: dateOnly(dto.neededBy), note: dto.note?.trim() || null },
        lines,
      );
      if (count === 0) throw new ConcurrentModificationError();
      await this.audit(tx, tenantId, actorId, id, 'stock_request.updated', { lineCount: lines.length, supplyingWarehouseId: supplier.id }, meta);
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** Gửi bản nháp — chụp lại tồn của kho xin tại lúc gửi. */
  async submit(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: VersionedStockRequestRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireRequester(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      if (existing.status !== 'DRAFT') throw new StockRequestInvalidStateError('Chỉ gửi được phiếu còn ở trạng thái Nháp.');
      const supplier = await this.resolveSupplier(tx, tenantId, { id: existing.requestingWarehouseId, branchId });
      if (!supplier) throw new StockRequestNoSupplierError();

      const count = await this.stockRequestRepository.transition(tx, tenantId, id, dto.version, ['DRAFT'], actorId, { status: 'SUBMITTED', submittedAt: new Date(), submittedBy: actorId, supplyingWarehouseId: supplier.id });
      if (count === 0) throw new ConcurrentModificationError();
      await this.refreshSnapshots(tx, tenantId, actorId, id, existing.requestingWarehouseId);
      await this.stockRequestRepository.addEvent(tx, tenantId, id, actorId, 'submitted', 'Đã gửi');
      await this.audit(tx, tenantId, actorId, id, 'stock_request.submitted', { requestNo: existing.requestNo }, meta, { status: 'DRAFT' });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  async cancel(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: CancelStockRequestRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireRequester(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      if (!requesterActions(existing.status).cancel) throw new StockRequestInvalidStateError('Phiếu đã được kho cấp tiếp nhận nên không huỷ được. Hãy rút các dòng chưa có hàng.');
      const count = await this.stockRequestRepository.transition(tx, tenantId, id, dto.version, ['DRAFT', 'SUBMITTED'], actorId, { status: 'CANCELLED', cancellationReason: dto.reason, cancelledAt: new Date(), cancelledBy: actorId });
      if (count === 0) throw new ConcurrentModificationError();
      await this.stockRequestRepository.addEvent(tx, tenantId, id, actorId, 'cancelled', 'Đã huỷ phiếu', { detail: dto.reason });
      await this.audit(tx, tenantId, actorId, id, 'stock_request.cancelled', { reason: dto.reason }, meta, { status: existing.status });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** Nhắn bổ sung / đổi mức khẩn / đổi ngày cần — làm được cả sau khi đã tiếp nhận (kho cấp được báo). */
  async updateNote(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: UpdateStockRequestNoteRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireRequester(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      if (!requesterActions(existing.status).message) throw new StockRequestInvalidStateError('Phiếu này không còn nhắn bổ sung hay đổi mức khẩn được nữa.');
      const afterAccept = existing.status === 'ACCEPTED' || existing.status === 'IN_PROGRESS';
      const data: Prisma.StockRequestUncheckedUpdateManyInput = {};
      if (dto.priority !== undefined) data.priority = dto.priority;
      if (dto.neededBy !== undefined) data.neededBy = dateOnly(dto.neededBy);
      if (afterAccept) data.supplierUpdatePending = true;
      const count = await this.stockRequestRepository.transition(tx, tenantId, id, dto.version, [existing.status], actorId, data);
      if (count === 0) throw new ConcurrentModificationError();

      const parts: string[] = [];
      if (dto.priority !== undefined) parts.push(dto.priority === 'URGENT' ? 'Đổi mức khẩn thành Khẩn.' : 'Đổi mức khẩn thành Thường.');
      if (dto.neededBy !== undefined) parts.push(dto.neededBy ? `Đổi ngày cần hàng thành ${dto.neededBy}.` : 'Bỏ ngày cần hàng.');
      if (dto.message) parts.push(dto.message);
      await this.stockRequestRepository.addEvent(tx, tenantId, id, actorId, 'note_updated', 'Bên xin cập nhật phiếu', { detail: parts.join(' ') });
      await this.audit(tx, tenantId, actorId, id, 'stock_request.note_updated', { priority: dto.priority ?? null, neededBy: dto.neededBy ?? null, hasMessage: Boolean(dto.message) }, meta);
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** Thêm mặt hàng vào phiếu đã gửi hoặc ĐÃ TIẾP NHẬN mà chưa cấp dòng nào — sau tiếp nhận kho cấp được báo bằng nhãn "Có cập nhật mới" + dòng "Mới thêm". */
  async addLines(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: AddStockRequestLinesRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireRequester(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      if (!requesterActions(existing.status).addLines) throw new StockRequestInvalidStateError('Phiếu đã được cấp một phần nên không thêm mặt hàng được. Hãy lập phiếu mới.');
      const detail = await this.stockRequestRepository.findDetailByIdInternal(tx, tenantId, id);
      if (!detail) throw new NotFoundException();
      const present = new Set(detail.lines.map((l) => l.drugId));
      const dup = dto.lines.find((l) => present.has(l.drugId));
      if (dup) throw new UnprocessableEntityException('Có mặt hàng đã nằm trên phiếu. Hãy sửa số lượng ở phiếu thay vì thêm lại.');

      const afterAccept = existing.status === 'ACCEPTED';
      const lines = await this.buildLines(tx, tenantId, existing.requestingWarehouseId, dto.lines, afterAccept);
      const count = await this.stockRequestRepository.transition(tx, tenantId, id, dto.version, [existing.status], actorId, afterAccept ? { supplierUpdatePending: true } : {});
      if (count === 0) throw new ConcurrentModificationError();
      await this.stockRequestRepository.createLines(tx, tenantId, actorId, id, lines);

      const drugs = await this.drugRepository.findByIds(tx, tenantId, dto.lines.map((l) => l.drugId));
      const names = drugs.map((d) => d.name).join(', ');
      await this.stockRequestRepository.addEvent(tx, tenantId, id, actorId, 'lines_added', `Thêm ${lines.length} mặt hàng`, { detail: names });
      await this.audit(tx, tenantId, actorId, id, 'stock_request.lines_added', { lineCount: lines.length }, meta);
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /**
   * Rút dòng chưa có hàng (lý do bắt buộc). Phiếu đã tiếp nhận mà chưa cấp: rút được dòng "Chờ xử lý"; phiếu đã cấp một phần: chỉ rút dòng đang "Chờ hàng về"
   * (phần đã cấp giữ nguyên, phần còn thiếu đóng lại). Rút hết dòng khi chưa cấp dòng nào thì cả phiếu thành "Đã rút".
   */
  async withdrawLines(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: WithdrawStockRequestLinesRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireRequester(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      const actions = requesterActions(existing.status);
      if (!actions.withdrawLines || existing.status === 'DRAFT' || existing.status === 'SUBMITTED') {
        throw new StockRequestInvalidStateError(existing.status === 'DRAFT' || existing.status === 'SUBMITTED' ? 'Phiếu chưa được tiếp nhận: hãy sửa trực tiếp thay vì rút dòng.' : 'Phiếu này không còn rút dòng được nữa.');
      }
      const detail = await this.stockRequestRepository.findDetailByIdInternal(tx, tenantId, id);
      if (!detail) throw new NotFoundException();
      const byId = new Map(detail.lines.map((l) => [l.id, l]));
      const targets = dto.lineIds.map((lineId) => byId.get(lineId));
      if (targets.some((t) => !t)) throw new NotFoundException();

      const names: string[] = [];
      const requested: string[] = [];
      for (const line of targets as StockRequestDetailRow['lines']) {
        const progress = computeLineProgress(toLineInput(line));
        const canWithdraw = actions.withdrawOnlyWaiting ? line.fulfilStatus === 'WAITING_STOCK' : line.fulfilStatus === 'PENDING' || line.fulfilStatus === 'WAITING_STOCK';
        if (!canWithdraw) throw new StockRequestInvalidStateError(`Dòng "${line.drug.name}" đã được xử lý, không rút được.`);
        if (line.withdrawRequestedAt) throw new StockRequestInvalidStateError(`Dòng "${line.drug.name}" đã gửi yêu cầu rút, đang chờ kho cấp xác nhận.`);
        // Đơn đặt hàng NCC đã gửi nhà cung cấp: kho cấp đã chịu chi phí nên bên xin chỉ gửi "Yêu cầu rút", kho cấp xác nhận (#298 giai đoạn 2). Đơn KHÔNG bị huỷ theo.
        if (line.waitPurchaseOrder && isPurchaseOrderPlaced(line.waitPurchaseOrder.status)) {
          await this.stockRequestRepository.updateLine(tx, tenantId, line.id, actorId, { withdrawRequestedAt: new Date(), withdrawRequestedBy: actorId, withdrawRequestReason: dto.reason });
          requested.push(line.drug.name);
          continue;
        }
        const now = new Date();
        await this.stockRequestRepository.updateLine(tx, tenantId, line.id, actorId, {
          // Đã cấp một phần thì phần đã cấp giữ nguyên (đóng phần còn thiếu); chưa cấp gì thì dòng thành "Đã rút".
          fulfilStatus: progress.allocatedQty > 0 ? 'ALLOCATED' : 'WITHDRAWN',
          withdrawReason: dto.reason,
          withdrawnAt: now,
          withdrawnBy: actorId,
        });
        names.push(line.drug.name);
      }
      const count = await this.stockRequestRepository.transition(tx, tenantId, id, dto.version, [existing.status], actorId, { supplierUpdatePending: true });
      if (count === 0) throw new ConcurrentModificationError();
      if (names.length > 0) {
        await this.syncService.refresh(tx, tenantId, actorId, id, { type: 'lines_withdrawn', message: `Rút ${names.length} dòng chờ hàng`, detail: `${names.join(', ')}. ${dto.reason}` });
        await this.audit(tx, tenantId, actorId, id, 'stock_request.lines_withdrawn', { lineCount: names.length, reason: dto.reason }, meta);
      }
      if (requested.length > 0) {
        await this.stockRequestRepository.addEvent(tx, tenantId, id, actorId, 'withdraw_requested', `Gửi yêu cầu rút ${requested.length} dòng đã đặt nhà cung cấp`, { detail: `${requested.join(', ')}. ${dto.reason}` });
        await this.audit(tx, tenantId, actorId, id, 'stock_request.withdraw_requested', { lineCount: requested.length, reason: dto.reason }, meta);
      }
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  // ============ Bên CẤP ============

  async accept(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: VersionedStockRequestRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireSupplier(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      if (!supplierActions(existing.status).accept) throw new StockRequestInvalidStateError('Phiếu không còn ở trạng thái chờ tiếp nhận.');
      const count = await this.stockRequestRepository.transition(tx, tenantId, id, dto.version, ['SUBMITTED'], actorId, { status: 'ACCEPTED', acceptedAt: new Date(), acceptedBy: actorId, supplierUpdatePending: false });
      if (count === 0) throw new ConcurrentModificationError();
      await this.stockRequestRepository.addEvent(tx, tenantId, id, actorId, 'accepted', 'Đã tiếp nhận');
      await this.audit(tx, tenantId, actorId, id, 'stock_request.accepted', { requestNo: existing.requestNo }, meta, { status: 'SUBMITTED' });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** Từ chối cả phiếu — lý do bắt buộc; chỉ khi chưa tiếp nhận hoặc đã tiếp nhận mà chưa cấp/quyết định dòng nào. */
  async reject(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: RejectStockRequestRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireSupplier(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      if (!supplierActions(existing.status).rejectAll) throw new StockRequestInvalidStateError('Phiếu đã được cấp một phần nên không từ chối cả phiếu được. Hãy từ chối từng dòng.');
      const count = await this.stockRequestRepository.transition(tx, tenantId, id, dto.version, ['SUBMITTED', 'ACCEPTED'], actorId, { status: 'REJECTED', rejectionReason: dto.reason, rejectedAt: new Date(), rejectedBy: actorId, supplierUpdatePending: false });
      if (count === 0) throw new ConcurrentModificationError();
      await this.stockRequestRepository.addEvent(tx, tenantId, id, actorId, 'rejected', 'Kho cấp từ chối phiếu', { detail: dto.reason });
      await this.audit(tx, tenantId, actorId, id, 'stock_request.rejected', { reason: dto.reason }, meta, { status: existing.status });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  async acknowledgeUpdate(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireSupplier(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      if (existing.supplierUpdatePending) await this.stockRequestRepository.touch(tx, tenantId, id, actorId, { supplierUpdatePending: false });
      await this.audit(tx, tenantId, actorId, id, 'stock_request.update_acknowledged', { requestNo: existing.requestNo }, meta);
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /**
   * "Chuyển thành phiếu điều chuyển" (cũng là "Cấp tiếp"): cấp số đã chọn thành MỘT phiếu điều chuyển nháp (mang sẵn kho gửi/nhận, mặt hàng, số lượng và gợi ý lô theo hạn dùng)
   * và ghi quyết định cho phần còn thiếu của từng dòng: chờ hàng về hoặc từ chối, cả hai bắt buộc lý do. Một phiếu có thể được cấp nhiều lần (nhiều phiếu điều chuyển).
   */
  async allocate(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: AllocateStockRequestRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireSupplier(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      if (!supplierActions(existing.status).allocate) throw new StockRequestInvalidStateError('Phiếu phải được tiếp nhận trước khi cấp hàng.');
      const detail = await this.stockRequestRepository.findDetailByIdInternal(tx, tenantId, id);
      if (!detail) throw new NotFoundException();
      const lineById = new Map(detail.lines.map((l) => [l.id, l]));

      const count = await this.stockRequestRepository.transition(tx, tenantId, id, dto.version, ['ACCEPTED', 'IN_PROGRESS'], actorId, { supplierUpdatePending: false });
      if (count === 0) throw new ConcurrentModificationError();

      const transferLines: StockTransferLineData[] = [];
      const decisions: { lineId: string; status: 'PENDING' | 'WAITING_STOCK' | 'ALLOCATED' | 'REJECTED'; reason: string | null; expectedDate: Date | null; purchaseOrderId?: string | null }[] = [];
      const seen = new Set<string>();
      let allocatedLines = 0;
      for (const input of dto.lines) {
        if (seen.has(input.lineId)) throw new StockRequestAllocationInvalidError('Một dòng chỉ được xử lý một lần trong mỗi lần cấp.');
        seen.add(input.lineId);
        const line = lineById.get(input.lineId);
        if (!line) throw new NotFoundException();
        if (line.fulfilStatus !== 'PENDING' && line.fulfilStatus !== 'WAITING_STOCK') {
          throw new StockRequestAllocationInvalidError(`Dòng "${line.drug.name}" đã được xử lý xong.`);
        }
        const progress = computeLineProgress(toLineInput(line));
        if (input.allocateQty > progress.remainingQty) {
          throw new StockRequestAllocationInvalidError(`Số cấp của "${line.drug.name}" vượt số còn thiếu (${progress.remainingQty}).`);
        }
        const stillMissing = progress.remainingQty - input.allocateQty;
        if (stillMissing > 0 && !input.remainder) {
          throw new StockRequestAllocationInvalidError(`"${line.drug.name}" còn thiếu ${stillMissing}: hãy chọn Chờ hàng về hoặc Từ chối và ghi lý do.`);
        }
        if (input.allocateQty === 0 && stillMissing === 0) {
          throw new StockRequestAllocationInvalidError(`Dòng "${line.drug.name}" không có gì để cấp.`);
        }

        if (input.allocateQty > 0) {
          allocatedLines += 1;
          transferLines.push(...(await this.pickLots(tx, tenantId, branchId, detail.supplyingWarehouseId, line, input.allocateQty)));
        }
        if (stillMissing === 0) {
          decisions.push({ lineId: line.id, status: 'ALLOCATED', reason: null, expectedDate: null });
        } else if (input.remainder?.action === 'WAIT') {
          // Chờ đơn đặt hàng NCC: đơn phải thuộc kho cấp này và chưa bị từ chối/đóng/huỷ; không chọn thì giữ liên kết sẵn có (nếu lập đơn từ phiếu này).
          let purchaseOrderId: string | null = line.waitPurchaseOrderId;
          if (input.remainder.purchaseOrderId) {
            const order = await this.stockRequestRepository.findOrderBrief(tx, tenantId, input.remainder.purchaseOrderId);
            if (!order || order.warehouseId !== detail.supplyingWarehouseId) throw new StockRequestAllocationInvalidError('Đơn đặt hàng được chọn không thuộc kho cấp của phiếu này.');
            if (['REJECTED', 'CLOSED', 'CANCELLED', 'RECEIVED'].includes(order.status)) throw new StockRequestAllocationInvalidError('Đơn đặt hàng được chọn đã đóng, huỷ hoặc đã nhận đủ.');
            purchaseOrderId = order.id;
          }
          decisions.push({ lineId: line.id, status: 'WAITING_STOCK', reason: input.remainder.reason, expectedDate: dateOnly(input.remainder.expectedDate), purchaseOrderId });
        } else {
          // Từ chối phần còn thiếu: chưa cấp gì thì dòng "Từ chối", đã cấp một phần thì "Đã cấp" kèm lý do đóng phần thiếu.
          decisions.push({ lineId: line.id, status: progress.allocatedQty + input.allocateQty > 0 ? 'ALLOCATED' : 'REJECTED', reason: input.remainder?.reason ?? null, expectedDate: null });
        }
      }

      let transferNo: string | null = null;
      if (transferLines.length > 0) {
        transferNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_TRANSFER', new Date());
        const transfer = await this.stockTransferRepository.create(tx, tenantId, actorId, {
          transferNo,
          fromWarehouseId: detail.supplyingWarehouseId,
          toWarehouseId: detail.requestingWarehouseId,
          occurredAt: new Date(),
          note: `Cấp theo phiếu yêu cầu ${detail.requestNo}`,
          requestId: id,
          lines: transferLines,
        });
        await writeAuditLog(tx, tenantId, { actorId, action: 'stock_transfer.created', entityType: 'stock_transfer', entityId: transfer.id, afterJson: { transferNo, fromWarehouseId: detail.supplyingWarehouseId, toWarehouseId: detail.requestingWarehouseId, lineCount: transferLines.length, requestId: id }, ip: meta.ip, userAgent: meta.userAgent });
      }

      for (const d of decisions) {
        await this.stockRequestRepository.setLineStatus(tx, tenantId, d.lineId, actorId, d.status, { decisionReason: d.reason, waitExpectedDate: d.expectedDate, waitPurchaseOrderId: d.purchaseOrderId ?? null });
      }
      const waitCount = decisions.filter((d) => d.status === 'WAITING_STOCK').length;
      const rejectCount = decisions.filter((d) => d.status === 'REJECTED').length;
      const batch = detail.transfers.filter((t) => t.status !== 'REJECTED').length + 1;
      const summary = [transferNo ? `${allocatedLines} dòng` : null, rejectCount > 0 ? `${rejectCount} dòng từ chối` : null, waitCount > 0 ? `${waitCount} dòng chờ hàng về` : null].filter(Boolean);
      await this.syncService.refresh(tx, tenantId, actorId, id, {
        type: 'allocated',
        message: transferNo ? `Cấp đợt ${batch}: tạo ${transferNo}` : 'Kho cấp ghi quyết định cho các dòng',
        detail: summary.join('. ') || null,
      });
      await this.audit(tx, tenantId, actorId, id, 'stock_request.allocated', { transferNo, allocatedLines, decisionCount: decisions.length }, meta);
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** "Xin phần thiếu lên cấp trên": tạo phiếu con xin đúng phần còn thiếu của các dòng đã chọn và đặt các dòng đó vào "Chờ hàng về" gắn với phiếu con. */
  async escalate(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: EscalateStockRequestRequest, meta: RequestMeta): Promise<EscalateStockRequestResponse> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const childId = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireSupplier(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      if (!supplierActions(existing.status).allocate) throw new StockRequestInvalidStateError('Phiếu phải được tiếp nhận trước khi xin phần thiếu.');
      const upper = await this.resolveSupplier(tx, tenantId, { id: existing.supplyingWarehouseId, branchId });
      if (!upper) throw new StockRequestNoSupplierError();
      const detail = await this.stockRequestRepository.findDetailByIdInternal(tx, tenantId, id);
      if (!detail) throw new NotFoundException();

      const lineById = new Map(detail.lines.map((l) => [l.id, l]));
      const childLines: { drugId: string; requestedQty: number }[] = [];
      const picked: StockRequestDetailRow['lines'] = [];
      for (const lineId of dto.lineIds) {
        const line = lineById.get(lineId);
        if (!line) throw new NotFoundException();
        if (line.fulfilStatus !== 'PENDING' && line.fulfilStatus !== 'WAITING_STOCK') throw new StockRequestAllocationInvalidError(`Dòng "${line.drug.name}" đã được xử lý xong.`);
        const progress = computeLineProgress(toLineInput(line));
        if (progress.remainingQty <= 0) throw new StockRequestAllocationInvalidError(`Dòng "${line.drug.name}" không còn phần thiếu.`);
        childLines.push({ drugId: line.drugId, requestedQty: progress.remainingQty });
        picked.push(line);
      }

      const count = await this.stockRequestRepository.transition(tx, tenantId, id, dto.version, ['ACCEPTED', 'IN_PROGRESS'], actorId, { supplierUpdatePending: false });
      if (count === 0) throw new ConcurrentModificationError();

      const childLineData = await this.buildLines(tx, tenantId, existing.supplyingWarehouseId, childLines);
      const requestNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_REQUEST', new Date());
      const child = await this.stockRequestRepository.create(tx, tenantId, actorId, {
        requestNo,
        requestingWarehouseId: existing.supplyingWarehouseId,
        supplyingWarehouseId: upper.id,
        priority: existing.priority,
        neededBy: existing.neededBy,
        note: `Xin phần thiếu của phiếu ${existing.requestNo}`,
        parentRequestId: id,
        submitted: true,
        lines: childLineData,
      });
      await this.stockRequestRepository.addEvent(tx, tenantId, child.id, actorId, 'submitted', 'Đã gửi', { detail: `Xin phần thiếu của ${existing.requestNo}` });
      for (const line of picked) {
        await this.stockRequestRepository.setLineStatus(tx, tenantId, line.id, actorId, 'WAITING_STOCK', { decisionReason: `Đã xin cấp trên theo phiếu ${requestNo}`, waitChildRequestId: child.id });
      }
      await this.syncService.refresh(tx, tenantId, actorId, id, { type: 'escalated', message: 'Xin phần thiếu lên cấp trên', detail: `Phiếu ${requestNo}, ${picked.length} dòng` });
      await this.audit(tx, tenantId, actorId, child.id, 'stock_request.escalated', { parentRequestId: id, requestNo, lineCount: picked.length }, meta);
      return child.id;
    });
    const [child, parent] = await Promise.all([this.getById(tenantId, branchId, actorId, dataScope, childId), this.getById(tenantId, branchId, actorId, dataScope, id)]);
    return { child, parent };
  }

  /**
   * Kho cấp xác nhận hoặc từ chối "Yêu cầu rút" của bên xin (dòng chờ hàng về đã gắn đơn đặt hàng NCC đã gửi nhà cung cấp, #298 giai đoạn 2).
   * Xác nhận: dòng rút như rút thường (phần đã cấp giữ nguyên); Từ chối: dòng giữ Chờ hàng về. Đơn đặt hàng NCC không bị huỷ theo.
   */
  async resolveWithdrawRequests(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: ResolveStockRequestWithdrawRequest, meta: RequestMeta): Promise<StockRequestDetail> {
    await this.assertEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.requireSupplier(tx, tenantId, branchId, dataScope, actorDepartmentId, id);
      const detail = await this.stockRequestRepository.findDetailByIdInternal(tx, tenantId, id);
      if (!detail) throw new NotFoundException();
      const byId = new Map(detail.lines.map((l) => [l.id, l]));
      const names: string[] = [];
      for (const lineId of dto.lineIds) {
        const line = byId.get(lineId);
        if (!line) throw new NotFoundException();
        if (!line.withdrawRequestedAt) throw new StockRequestInvalidStateError(`Dòng "${line.drug.name}" không có yêu cầu rút nào đang chờ.`);
        const clear = { withdrawRequestedAt: null, withdrawRequestedBy: null, withdrawRequestReason: null };
        if (dto.action === 'CONFIRM') {
          const progress = computeLineProgress(toLineInput(line));
          await this.stockRequestRepository.updateLine(tx, tenantId, line.id, actorId, {
            ...clear,
            fulfilStatus: progress.allocatedQty > 0 ? 'ALLOCATED' : 'WITHDRAWN',
            withdrawReason: line.withdrawRequestReason,
            withdrawnAt: new Date(),
            withdrawnBy: line.withdrawRequestedBy ?? actorId,
          });
        } else {
          await this.stockRequestRepository.updateLine(tx, tenantId, line.id, actorId, clear);
        }
        names.push(line.drug.name);
      }
      const count = await this.stockRequestRepository.transition(tx, tenantId, id, dto.version, [existing.status], actorId, {});
      if (count === 0) throw new ConcurrentModificationError();
      const note = dto.note?.trim() || null;
      await this.syncService.refresh(tx, tenantId, actorId, id, {
        type: dto.action === 'CONFIRM' ? 'withdraw_confirmed' : 'withdraw_declined',
        message: dto.action === 'CONFIRM' ? `Kho cấp xác nhận rút ${names.length} dòng` : `Kho cấp giữ lại ${names.length} dòng chờ hàng`,
        detail: [names.join(', '), note].filter(Boolean).join('. ') || null,
      });
      await this.audit(tx, tenantId, actorId, id, 'stock_request.withdraw_request_resolved', { action: dto.action, lineCount: names.length, note }, meta);
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  // ============ Nội bộ ============

  private isSupplierSide(row: StockRequestDetailRow, branchId: string, dataScope: DataScope, actorDepartmentId: string | null): boolean {
    if (row.supplyingWarehouse.branchId !== branchId || row.submittedAt === null) return false;
    return dataScope !== 'department' || (actorDepartmentId !== null && row.supplyingWarehouse.departmentId === actorDepartmentId);
  }

  private async requireRequester(tx: Prisma.TransactionClient, tenantId: string, branchId: string, dataScope: DataScope, actorDepartmentId: string | null, id: string) {
    const existing = await this.stockRequestRepository.findById(tx, tenantId, branchId, id, 'requester');
    if (!existing) throw new NotFoundException();
    const warehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, existing.requestingWarehouseId);
    assertWarehouseInScope(warehouse?.departmentId ?? null, dataScope, actorDepartmentId);
    return existing;
  }

  private async requireSupplier(tx: Prisma.TransactionClient, tenantId: string, branchId: string, dataScope: DataScope, actorDepartmentId: string | null, id: string) {
    const existing = await this.stockRequestRepository.findById(tx, tenantId, branchId, id, 'supplier');
    if (!existing) throw new NotFoundException();
    const warehouse = await this.warehouseRepository.findById(tx, tenantId, branchId, existing.supplyingWarehouseId);
    assertWarehouseInScope(warehouse?.departmentId ?? null, dataScope, actorDepartmentId);
    return existing;
  }

  /** Chụp lại tồn kho xin của từng dòng — lúc gửi, để kho cấp thấy đúng số tại thời điểm gửi. */
  private async refreshSnapshots(tx: Prisma.TransactionClient, tenantId: string, actorId: string, requestId: string, requestingWarehouseId: string): Promise<void> {
    const detail = await this.stockRequestRepository.findDetailByIdInternal(tx, tenantId, requestId);
    if (!detail) return;
    const stock = await this.stockBalanceRepository.sumOnHandByWarehouseDrugs(tx, tenantId, [requestingWarehouseId], detail.lines.map((l) => l.drugId));
    for (const line of detail.lines) {
      await this.stockRequestRepository.updateLine(tx, tenantId, line.id, actorId, { requesterStockSnapshot: stock.get(`${requestingWarehouseId}:${line.drugId}`) ?? 0 });
    }
  }

  /** Chọn lô theo hạn dùng (FEFO) cho số cấp; thuốc không quản lý theo lô thì kiểm tồn gộp. Lô đã hết hạn không được gợi ý. */
  private async pickLots(tx: Prisma.TransactionClient, tenantId: string, branchId: string, supplyingWarehouseId: string, line: StockRequestDetailRow['lines'][number], quantity: number): Promise<StockTransferLineData[]> {
    if (!line.drug.isBatchManaged) {
      const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, line.drugId, supplyingWarehouseId, null);
      if ((balance?.quantityOnHand ?? 0) < quantity) throw new StockRequestInsufficientStockError(line.drug.name);
      return [{ drugId: line.drugId, batchId: null, quantityShipped: quantity, requestLineId: line.id }];
    }
    const todayStart = vietnamDayStartUtc(getVietnamDateString());
    const batches = await this.inventoryBatchRepository.listWithBalanceForDrug(tx, tenantId, branchId, line.drugId, supplyingWarehouseId);
    const usable = batches.filter((b) => b.expiryDate === null || b.expiryDate.getTime() >= todayStart.getTime());
    const allocation = selectFefoBatches(
      usable.map((b) => ({ batchId: b.batchId, quantityOnHand: b.quantityOnHand, expiryDate: toDateString(b.expiryDate) })),
      quantity,
    );
    if (!allocation) throw new StockRequestInsufficientStockError(line.drug.name);
    return allocation.map((a) => ({ drugId: line.drugId, batchId: a.batchId, quantityShipped: a.quantity, requestLineId: line.id }));
  }

  /** "Hàng đã về": phiếu có dòng chờ hàng về mà kho cấp nay đủ tồn cho phần còn thiếu của ít nhất một dòng. */
  private async readyRequestIds(tx: Prisma.TransactionClient, tenantId: string, rows: StockRequestListRow[]): Promise<Set<string>> {
    const candidates = rows.filter((r) => r.status === 'ACCEPTED' || r.status === 'IN_PROGRESS');
    if (candidates.length === 0) return new Set();
    const waiting = await this.stockRequestRepository.listWaitingLines(tx, tenantId, candidates.map((r) => r.id));
    if (waiting.length === 0) return new Set();
    const supplierByRequest = new Map(candidates.map((r) => [r.id, r.supplyingWarehouseId]));
    const stock = await this.stockBalanceRepository.sumOnHandByWarehouseDrugs(tx, tenantId, [...new Set(supplierByRequest.values())], [...new Set(waiting.map((w) => w.drugId))]);
    const ready = new Set<string>();
    for (const w of waiting) {
      const shipped = w.transferLines.filter((t) => t.transfer.status !== 'REJECTED').reduce((s, t) => s + t.quantityShipped, 0);
      const remaining = w.requestedQty - shipped;
      const onHand = stock.get(`${supplierByRequest.get(w.requestId)}:${w.drugId}`) ?? 0;
      if (remaining > 0 && onHand >= remaining) ready.add(w.requestId);
    }
    return ready;
  }

  private toFilter(branchId: string, dataScope: DataScope, actorDepartmentId: string | null, query: ListStockRequestsQuery, take: number) {
    return {
      branchId,
      view: query.view,
      status: query.status,
      priority: query.priority,
      warehouseId: query.warehouseId,
      from: query.from ? vietnamDayStartUtc(query.from) : undefined,
      to: query.to ? vietnamDayEndUtc(query.to) : undefined,
      q: query.q,
      cursor: query.cursor,
      take,
      departmentId: dataScope === 'department' ? (actorDepartmentId ?? undefined) : undefined,
    };
  }

  private zeroCounts(): Record<StockRequestStatus, number> {
    return Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<StockRequestStatus, number>;
  }

  private async userNames(tenantId: string, ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    return unique.length > 0 ? this.doctorDirectory.getUserFullNames(tenantId, unique) : new Map<string, string>();
  }

  private toSummaryDto(row: StockRequestListRow | StockRequestDetailRow, names: Map<string, string>, readyToSupply: boolean): StockRequestSummary {
    const lineCount = '_count' in row ? row._count.lines : row.lines.length;
    return {
      id: row.id,
      requestNo: row.requestNo,
      status: row.status,
      priority: row.priority,
      neededBy: toDateString(row.neededBy),
      note: row.note,
      requestingWarehouseId: row.requestingWarehouseId,
      requestingWarehouseName: row.requestingWarehouse.name,
      requestingBranchId: row.requestingWarehouse.branchId,
      requestingBranchName: row.requestingWarehouse.branch.name,
      supplyingWarehouseId: row.supplyingWarehouseId,
      supplyingWarehouseName: row.supplyingWarehouse.name,
      supplyingBranchId: row.supplyingWarehouse.branchId,
      supplyingBranchName: row.supplyingWarehouse.branch.name,
      lineCount,
      createdByName: names.get(row.createdBy) ?? '',
      createdAt: row.createdAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      acceptedByName: row.acceptedBy ? (names.get(row.acceptedBy) ?? null) : null,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      cancellationReason: row.cancellationReason,
      supplierUpdatePending: row.supplierUpdatePending,
      parentRequestId: row.parentRequestId,
      parentRequestNo: row.parentRequest?.requestNo ?? null,
      readyToSupply,
      version: row.version,
    };
  }

  private toDetailDto(
    row: StockRequestDetailRow,
    ctx: { branchId: string; dataScope: DataScope; actorDepartmentId: string | null; names: Map<string, string>; stock: Map<string, number> | null; canEscalate: boolean },
  ): StockRequestDetail {
    const canActAsSupplier = this.isSupplierSide(row, ctx.branchId, ctx.dataScope, ctx.actorDepartmentId);
    const canActAsRequester = row.requestingWarehouse.branchId === ctx.branchId && (ctx.dataScope !== 'department' || (ctx.actorDepartmentId !== null && row.requestingWarehouse.departmentId === ctx.actorDepartmentId));
    const canOpen = (t: StockRequestDetailRow['transfers'][number]): boolean =>
      t.fromWarehouse.branchId === ctx.branchId || (t.toWarehouse.branchId === ctx.branchId && RECEIVER_VISIBLE_TRANSFER_STATUSES.includes(t.status));

    const lines = row.lines.map((line) => {
      const progress = computeLineProgress(toLineInput(line));
      const transferRefs = new Map<string, { id: string; transferNo: string; status: StockRequestDetailRow['transfers'][number]['status'] }>();
      for (const tl of line.transferLines) {
        if (tl.transfer.status !== 'REJECTED') transferRefs.set(tl.transfer.id, { id: tl.transfer.id, transferNo: tl.transfer.transferNo, status: tl.transfer.status });
      }
      return {
        id: line.id,
        drugId: line.drugId,
        drugCode: line.drug.code,
        drugName: line.drug.name,
        unitCode: line.drug.baseUnitCode,
        requestedQty: line.requestedQty,
        requesterStockSnapshot: line.requesterStockSnapshot,
        supplierStock: ctx.stock ? (ctx.stock.get(`${row.supplyingWarehouseId}:${line.drugId}`) ?? 0) : null,
        lineNote: line.lineNote,
        fulfilStatus: line.fulfilStatus,
        displayStatus: progress.status,
        allocatedQty: progress.allocatedQty,
        receivedQty: progress.receivedQty,
        remainingQty: progress.remainingQty,
        decisionReason: line.decisionReason,
        waitExpectedDate: toDateString(line.waitExpectedDate),
        waitChildRequestId: line.waitChildRequestId,
        waitChildRequestNo: line.waitChildRequest?.requestNo ?? null,
        waitPurchaseOrderId: line.waitPurchaseOrderId,
        waitPurchaseOrderNo: line.waitPurchaseOrder?.orderNo ?? null,
        waitPurchaseOrderStatus: line.waitPurchaseOrder?.status ?? null,
        withdrawRequestedAt: line.withdrawRequestedAt?.toISOString() ?? null,
        withdrawRequestReason: line.withdrawRequestReason,
        addedAfterAccept: line.addedAfterAccept,
        withdrawReason: line.withdrawReason,
        withdrawnAt: line.withdrawnAt?.toISOString() ?? null,
        transfers: [...transferRefs.values()],
      };
    });

    return {
      ...this.toSummaryDto(row, ctx.names, false),
      lines,
      events: row.events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actorName: ctx.names.get(e.actorId) ?? '',
        occurredAt: e.occurredAt.toISOString(),
        message: e.message,
        detail: typeof (e.meta as { detail?: unknown } | null)?.detail === 'string' ? (e.meta as { detail: string }).detail : null,
      })),
      transfers: row.transfers
        .filter((t) => t.status !== 'REJECTED')
        .map((t) => ({ id: t.id, transferNo: t.transferNo, status: t.status, lineCount: t._count.lines, fromBranchName: t.fromWarehouse.branch.name, toBranchName: t.toWarehouse.branch.name, fromWarehouseName: t.fromWarehouse.name, toWarehouseName: t.toWarehouse.name, canOpen: canOpen(t) })),
      canActAsRequester,
      canActAsSupplier,
      canEscalate: ctx.canEscalate,
    };
  }
}
