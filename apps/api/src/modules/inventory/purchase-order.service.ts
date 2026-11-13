import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  BranchPurchasingDisabledError,
  CLINIC_CONFIG_READER_PORT,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  PurchaseOrderApproverBranchError,
  PurchaseOrderInvalidStateError,
  StockReceiptLineUnitInvalidError,
  canPerformPurchaseOrderAction,
  computePurchaseOrderTotal,
  isPurchaseOrderApproverBranch,
  purchaseOrderRemainingQty,
  requiresMainBranchApproval,
  vietnamDayEndUtc,
  vietnamDayStartUtc,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  CancelPurchaseOrderRequest,
  ClosePurchaseOrderRequest,
  CreatePurchaseOrderRequest,
  DataScope,
  GetPurchaseOrderOptionsResponse,
  GetPurchaseOrderPendingCountsResponse,
  ListPurchaseOrdersQuery,
  ListPurchaseOrdersResponse,
  PurchaseOrderDetail,
  PurchaseOrderStatus,
  PurchaseOrderSummary,
  RejectPurchaseOrderRequest,
  UpdatePurchaseOrderRequest,
  VersionedPurchaseOrderRequest,
} from '@nexamed/shared';
import type { Prisma } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { assertWarehouseInScope, resolveActorDepartmentId } from '../../common/warehouse-scope.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { DrugRepository, type DrugWithDetails } from '../drug/drug.repository';
import { SupplierRepository } from '../drug/supplier.repository';
import { WarehouseRepository } from '../drug/warehouse.repository';
import { PurchaseOrderRepository, type PurchaseOrderDetailRow, type PurchaseOrderLineData, type PurchaseOrderListRow } from './purchase-order.repository';

const ALL_STATUSES: PurchaseOrderStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'];

/** Cột DATE lưu ngày dương lịch nguyên văn (00:00 UTC của chính ngày đó). */
const dateOnly = (value: string | null | undefined): Date | null => (value ? new Date(`${value}T00:00:00Z`) : null);
const toDateString = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);

interface Settings {
  branchPurchasingEnabled: boolean;
  branchPurchaseNeedsMainApproval: boolean;
  allowOverReceipt: boolean;
}

interface ViewerBranch {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 giai đoạn 2, mockup chủ dự án duyệt 12/11/2026).
 *  - Đơn thuộc chi nhánh của KHO NHẬN; chi nhánh khác chỉ thấy đơn CHỜ DUYỆT khi đơn cần chi nhánh chính duyệt và người xem thuộc chi nhánh chính.
 *  - Nháp → (Gửi duyệt) → Chờ duyệt → Đã duyệt → (Gửi nhà cung cấp) → Đã đặt NCC → Nhận một phần → Đã nhận đủ; nhánh Từ chối/Đã đóng/Đã huỷ.
 *    Đơn không cần chi nhánh chính duyệt: người có quyền duyệt bấm "Duyệt" ngay trên bản nháp (bỏ bước Chờ duyệt).
 *  - Nhận hàng bằng Phiếu nhập kho liên kết (`StockReceiptService` + `PurchaseOrderLinkService`); trạng thái đơn tính lại sau mỗi lần phiếu nhập được Duyệt/Huỷ.
 * Mọi cấu hình đọc qua port TRƯỚC khi mở transaction (#264).
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly warehouseRepository: WarehouseRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly drugRepository: DrugRepository,
    private readonly businessCodeService: BusinessCodeService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  // ============ Chung ============

  private async audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, id: string, action: string, afterJson: Prisma.InputJsonValue, meta: RequestMeta, beforeJson?: Prisma.InputJsonValue): Promise<void> {
    await writeAuditLog(tx, tenantId, { actorId, action, entityType: 'purchase_order', entityId: id, beforeJson, afterJson, ip: meta.ip, userAgent: meta.userAgent });
  }

  private async requireViewerBranch(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<ViewerBranch> {
    const branch = await this.purchaseOrderRepository.findBranch(tx, tenantId, branchId);
    if (!branch) throw new NotFoundException();
    return branch;
  }

  /** Chi nhánh đang làm có được lập/sửa đơn không (chi nhánh chính luôn được; chi nhánh phụ khi công tắc đặt riêng BẬT). */
  private canOrderHere(branch: ViewerBranch, settings: Settings): boolean {
    return branch.isDefault || settings.branchPurchasingEnabled;
  }

  private assertCanOrder(branch: ViewerBranch, settings: Settings): void {
    if (!this.canOrderHere(branch, settings)) throw new BranchPurchasingDisabledError();
  }

  /** Đọc đơn người xem được thấy: đơn của chi nhánh mình, hoặc đơn CHỜ DUYỆT của chi nhánh phụ khi người xem thuộc chi nhánh chính và đơn cần chi nhánh chính duyệt. Khác → 404. */
  private async loadVisible(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branch: ViewerBranch,
    settings: Settings,
    id: string,
    decidedByActorId?: string,
  ): Promise<{ row: PurchaseOrderDetailRow; isOwnBranch: boolean; requiresMainApproval: boolean }> {
    const row = await this.purchaseOrderRepository.findDetailById(tx, tenantId, id);
    if (!row) throw new NotFoundException();
    const requiresMainApproval = requiresMainBranchApproval({ needsMainApprovalSetting: settings.branchPurchaseNeedsMainApproval, orderBranchIsMain: row.warehouse.branch.isDefault });
    const isOwnBranch = row.warehouse.branchId === branch.id;
    if (!isOwnBranch) {
      // Chi nhánh chính xem được đơn đang chờ mình duyệt, và xem lại đơn chính người đó đã duyệt/từ chối (chỉ xem — mọi thao tác khác vẫn 404).
      const decidedByViewer = decidedByActorId !== undefined && (row.approvedBy === decidedByActorId || row.rejectedBy === decidedByActorId);
      const approverView = requiresMainApproval && branch.isDefault && (row.status === 'PENDING_APPROVAL' || decidedByViewer);
      if (!approverView) throw new NotFoundException();
    }
    return { row, isOwnBranch, requiresMainApproval };
  }

  private async userNames(tenantId: string, ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    return unique.length > 0 ? this.doctorDirectory.getUserFullNames(tenantId, unique) : new Map<string, string>();
  }

  private zeroCounts(): Record<PurchaseOrderStatus, number> {
    return Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<PurchaseOrderStatus, number>;
  }

  // ============ Đọc ============

  async getOptions(tenantId: string, branchId: string): Promise<GetPurchaseOrderOptionsResponse> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const branch = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.requireViewerBranch(tx, tenantId, branchId));
    return {
      canOrderHere: this.canOrderHere(branch, settings),
      requiresMainApproval: requiresMainBranchApproval({ needsMainApprovalSetting: settings.branchPurchaseNeedsMainApproval, orderBranchIsMain: branch.isDefault }),
      isMainBranch: branch.isDefault,
      allowOverReceipt: settings.allowOverReceipt,
    };
  }

  /** Đơn chờ duyệt mà người xem được duyệt: của chính chi nhánh mình (đơn không cần chi nhánh chính duyệt) + của chi nhánh phụ (khi người xem ở chi nhánh chính và công tắc bật). */
  private approvalScope(branch: ViewerBranch, settings: Settings): { own: boolean; cross: boolean } {
    return { own: branch.isDefault || !settings.branchPurchaseNeedsMainApproval, cross: branch.isDefault && settings.branchPurchaseNeedsMainApproval };
  }

  async getPendingCounts(tenantId: string, branchId: string): Promise<GetPurchaseOrderPendingCountsResponse> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      const scope = this.approvalScope(branch, settings);
      return { toApprove: await this.purchaseOrderRepository.countPendingApproval(tx, tenantId, { branchId, ...scope }) };
    });
  }

  async getById(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string): Promise<PurchaseOrderDetail> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const loaded = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      const found = await this.loadVisible(tx, tenantId, branch, settings, id, actorId);
      if (found.isOwnBranch) assertWarehouseInScope(found.row.warehouse.departmentId, dataScope, actorDepartmentId);
      const [received, drafts, waiting] = await Promise.all([
        this.purchaseOrderRepository.receivedByLine(tx, tenantId, id),
        this.purchaseOrderRepository.draftReceiptCounts(tx, tenantId, [id]),
        this.purchaseOrderRepository.listWaitingRequestLines(tx, tenantId, id),
      ]);
      return { ...found, branch, received, draftCount: drafts.get(id) ?? 0, waiting };
    });

    const names = await this.userNames(tenantId, [loaded.row.createdBy, loaded.row.approvedBy]);
    return this.toDetailDto(loaded.row, {
      names,
      received: loaded.received,
      draftCount: loaded.draftCount,
      waiting: loaded.waiting,
      requiresMainApproval: loaded.requiresMainApproval,
      isOwnBranch: loaded.isOwnBranch,
      canActAsApprover: isPurchaseOrderApproverBranch({ requiresMainApproval: loaded.requiresMainApproval, viewerBranchId: loaded.branch.id, viewerBranchIsMain: loaded.branch.isDefault, orderBranchId: loaded.row.warehouse.branchId }),
      allowOverReceipt: settings.allowOverReceipt,
    });
  }

  private toFilter(branch: ViewerBranch, settings: Settings, dataScope: DataScope, actorDepartmentId: string | null, query: ListPurchaseOrdersQuery, take: number) {
    const scope = this.approvalScope(branch, settings);
    return {
      branchId: branch.id,
      view: query.view,
      approvalOwn: scope.own,
      approvalCross: scope.cross,
      status: query.status,
      supplierId: query.supplierId,
      warehouseId: query.warehouseId,
      from: query.from ? vietnamDayStartUtc(query.from) : undefined,
      to: query.to ? vietnamDayEndUtc(query.to) : undefined,
      q: query.q,
      cursor: query.cursor,
      take,
      departmentId: dataScope === 'department' ? (actorDepartmentId ?? undefined) : undefined,
    };
  }

  async list(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, query: ListPurchaseOrdersQuery): Promise<ListPurchaseOrdersResponse> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    if (dataScope === 'department' && actorDepartmentId === null && query.view === 'mine') {
      return { items: [], nextCursor: null, statusCounts: this.zeroCounts() };
    }

    const result = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      const filter = this.toFilter(branch, settings, dataScope, actorDepartmentId, query, query.limit + 1);
      const [rows, counts] = await Promise.all([this.purchaseOrderRepository.list(tx, tenantId, filter), this.purchaseOrderRepository.countByStatus(tx, tenantId, filter)]);
      const page = rows.length > query.limit ? rows.slice(0, query.limit) : rows;
      const [receivedLines, drafts] = await Promise.all([this.purchaseOrderRepository.receivedLineCounts(tx, tenantId, page), this.purchaseOrderRepository.draftReceiptCounts(tx, tenantId, page.map((r) => r.id))]);
      return { rows, page, counts, receivedLines, drafts };
    });
    const hasMore = result.rows.length > query.limit;
    const names = await this.userNames(tenantId, result.page.flatMap((r) => [r.createdBy, r.approvedBy]));
    return {
      items: result.page.map((r) => this.toSummaryDto(r, names, settings, result.receivedLines.get(r.id) ?? 0, result.drafts.get(r.id) ?? 0)),
      nextCursor: hasMore ? (result.page[result.page.length - 1]?.id ?? null) : null,
      statusCounts: { ...this.zeroCounts(), ...result.counts },
    };
  }

  /** Mọi dòng khớp bộ lọc (không phân trang, tối đa 5000) — cho Xuất Excel danh sách. */
  async listAllForExport(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, query: ListPurchaseOrdersQuery): Promise<{ items: PurchaseOrderSummary[] }> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    if (dataScope === 'department' && actorDepartmentId === null && query.view === 'mine') return { items: [] };
    const result = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      const filter = this.toFilter(branch, settings, dataScope, actorDepartmentId, { ...query, cursor: undefined }, 5000);
      const rows = await this.purchaseOrderRepository.list(tx, tenantId, filter);
      const [receivedLines, drafts] = await Promise.all([this.purchaseOrderRepository.receivedLineCounts(tx, tenantId, rows), this.purchaseOrderRepository.draftReceiptCounts(tx, tenantId, rows.map((r) => r.id))]);
      return { rows, receivedLines, drafts };
    });
    const names = await this.userNames(tenantId, result.rows.flatMap((r) => [r.createdBy, r.approvedBy]));
    return { items: result.rows.map((r) => this.toSummaryDto(r, names, settings, result.receivedLines.get(r.id) ?? 0, result.drafts.get(r.id) ?? 0)) };
  }

  async recordExportAudit(tenantId: string, actorId: string, query: ListPurchaseOrdersQuery, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.audit(tx, tenantId, actorId, tenantId, 'purchase_order.exported', { view: query.view, status: query.status ?? null, from: query.from ?? null, to: query.to ?? null }, meta),
    );
  }

  // ============ Lập / sửa ============

  private async buildLines(tx: Prisma.TransactionClient, tenantId: string, inputs: CreatePurchaseOrderRequest['lines']): Promise<PurchaseOrderLineData[]> {
    const result: PurchaseOrderLineData[] = [];
    const cache = new Map<string, DrugWithDetails>();
    for (const l of inputs) {
      let drug = cache.get(l.drugId);
      if (!drug) {
        const found = await this.drugRepository.findByIdWithDetails(tx, tenantId, l.drugId);
        if (!found) throw new UnprocessableEntityException('Có mặt hàng không tồn tại hoặc đã bị xoá.');
        drug = found;
        cache.set(l.drugId, drug);
      }
      if (!drug.isActive) throw new UnprocessableEntityException(`Mặt hàng "${drug.name}" đã ngừng sử dụng, không thể thêm vào đơn.`);
      // Đơn vị dòng đơn phải là đơn vị cơ sở hoặc thuộc chuỗi quy đổi (cùng luật Phiếu nhập kho, #275) — Phiếu nhập liên kết dùng lại đúng đơn vị này.
      if (drug.baseUnitCode && l.unitCode !== drug.baseUnitCode && !drug.units.some((u) => u.unitCode === l.unitCode)) {
        throw new StockReceiptLineUnitInvalidError(drug.name, l.unitCode);
      }
      result.push({ drugId: l.drugId, unitCode: l.unitCode, quantity: l.quantity, expectedUnitCost: l.expectedUnitCost != null ? BigInt(l.expectedUnitCost) : null, lineNote: l.lineNote?.trim() || null });
    }
    return result;
  }

  private async resolveHeader(tx: Prisma.TransactionClient, tenantId: string, branch: ViewerBranch, settings: Settings, dataScope: DataScope, actorDepartmentId: string | null, dto: CreatePurchaseOrderRequest) {
    this.assertCanOrder(branch, settings);
    const warehouse = await this.warehouseRepository.findById(tx, tenantId, branch.id, dto.warehouseId);
    if (!warehouse || !warehouse.isActive) throw new NotFoundException();
    assertWarehouseInScope(warehouse.departmentId, dataScope, actorDepartmentId);
    const supplier = await this.supplierRepository.findById(tx, tenantId, dto.supplierId);
    if (!supplier || !supplier.isActive) throw new NotFoundException();
    const lines = await this.buildLines(tx, tenantId, dto.lines);
    const total = computePurchaseOrderTotal(lines.map((l) => ({ quantity: l.quantity, expectedUnitCost: l.expectedUnitCost !== null ? Number(l.expectedUnitCost) : null })));
    return {
      lines,
      header: { supplierId: supplier.id, warehouseId: warehouse.id, expectedDate: dateOnly(dto.expectedDate), note: dto.note?.trim() || null, totalAmount: BigInt(total) },
    };
  }

  /** Gắn dòng yêu cầu cấp hàng đang chờ vào đơn — số dòng gắn được phải đủ số dòng yêu cầu (dòng không còn chờ / kho cấp khác kho nhận → lỗi). */
  private async linkSources(tx: Prisma.TransactionClient, tenantId: string, actorId: string, orderId: string, warehouseId: string, dto: CreatePurchaseOrderRequest): Promise<void> {
    const ids = [...new Set(dto.lines.map((l) => l.sourceRequestLineId).filter((v): v is string => !!v))];
    if (ids.length === 0) return;
    const linked = await this.purchaseOrderRepository.linkRequestLines(tx, tenantId, actorId, orderId, warehouseId, ids);
    if (linked !== ids.length) throw new UnprocessableEntityException('Có dòng yêu cầu cấp hàng không còn ở trạng thái chờ hàng về hoặc không xin kho nhận của đơn này.');
  }

  async create(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, dto: CreatePurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrderDetail> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const id = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      const { header, lines } = await this.resolveHeader(tx, tenantId, branch, settings, dataScope, actorDepartmentId, dto);
      const orderNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'PURCHASE_ORDER', new Date());
      const row = await this.purchaseOrderRepository.create(tx, tenantId, actorId, orderNo, header, lines);
      await this.linkSources(tx, tenantId, actorId, row.id, header.warehouseId, dto);
      await this.audit(tx, tenantId, actorId, row.id, 'purchase_order.created', { orderNo, supplierId: header.supplierId, warehouseId: header.warehouseId, lineCount: lines.length, totalAmount: header.totalAmount.toString() }, meta);
      return row.id;
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** Sửa Nháp hoặc đơn đã bị Từ chối (sửa xong quay về Nháp) — thay toàn bộ dòng. */
  async update(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: UpdatePurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrderDetail> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      const { row, isOwnBranch } = await this.loadVisible(tx, tenantId, branch, settings, id);
      if (!isOwnBranch) throw new NotFoundException();
      assertWarehouseInScope(row.warehouse.departmentId, dataScope, actorDepartmentId);
      if (!canPerformPurchaseOrderAction(row.status, 'update')) throw new PurchaseOrderInvalidStateError('Đơn đã gửi duyệt hoặc đã đặt nhà cung cấp nên không sửa được.');
      const { header, lines } = await this.resolveHeader(tx, tenantId, branch, settings, dataScope, actorDepartmentId, dto);
      const count = await this.purchaseOrderRepository.replaceDraft(tx, tenantId, id, dto.version, actorId, header, lines);
      if (count === 0) throw new ConcurrentModificationError();
      await this.linkSources(tx, tenantId, actorId, id, header.warehouseId, dto);
      await this.audit(tx, tenantId, actorId, id, 'purchase_order.updated', { lineCount: lines.length, totalAmount: header.totalAmount.toString() }, meta, { status: row.status });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  // ============ Duyệt và gửi nhà cung cấp ============

  private async ownOrder(tx: Prisma.TransactionClient, tenantId: string, branch: ViewerBranch, settings: Settings, dataScope: DataScope, actorDepartmentId: string | null, id: string) {
    const found = await this.loadVisible(tx, tenantId, branch, settings, id);
    if (!found.isOwnBranch) throw new NotFoundException();
    assertWarehouseInScope(found.row.warehouse.departmentId, dataScope, actorDepartmentId);
    return found;
  }

  /** Nháp → Chờ duyệt. */
  async submit(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: VersionedPurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrderDetail> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      this.assertCanOrder(branch, settings);
      const { row } = await this.ownOrder(tx, tenantId, branch, settings, dataScope, actorDepartmentId, id);
      if (!canPerformPurchaseOrderAction(row.status, 'submit')) throw new PurchaseOrderInvalidStateError('Chỉ gửi duyệt được đơn còn ở trạng thái Nháp.');
      const count = await this.purchaseOrderRepository.transition(tx, tenantId, id, dto.version, ['DRAFT'], actorId, { status: 'PENDING_APPROVAL', submittedAt: new Date(), submittedBy: actorId });
      if (count === 0) throw new ConcurrentModificationError();
      await this.audit(tx, tenantId, actorId, id, 'purchase_order.submitted', { orderNo: row.orderNo }, meta, { status: 'DRAFT' });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /**
   * Duyệt: Nháp (người lập tự duyệt, chỉ khi đơn KHÔNG cần chi nhánh chính duyệt) hoặc Chờ duyệt (người ở đúng phía duyệt: chi nhánh chính nếu đơn cần, ngược lại chính chi nhánh của đơn).
   * Quyền `purchase_order.approve` kiểm ở controller.
   */
  async approve(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: VersionedPurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrderDetail> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      const { row, isOwnBranch, requiresMainApproval } = await this.loadVisible(tx, tenantId, branch, settings, id);
      if (isOwnBranch) assertWarehouseInScope(row.warehouse.departmentId, dataScope, actorDepartmentId);
      if (!canPerformPurchaseOrderAction(row.status, 'approve')) throw new PurchaseOrderInvalidStateError('Chỉ duyệt được đơn Nháp hoặc đơn đang Chờ duyệt.');
      if (!isPurchaseOrderApproverBranch({ requiresMainApproval, viewerBranchId: branch.id, viewerBranchIsMain: branch.isDefault, orderBranchId: row.warehouse.branchId })) {
        throw new PurchaseOrderApproverBranchError(requiresMainApproval);
      }
      // Duyệt thẳng từ Nháp chỉ dành cho đơn không cần chi nhánh chính duyệt (đã bảo đảm bởi kiểm phía duyệt ở trên: đơn cần chi nhánh chính thì người lập không thuộc phía duyệt).
      const now = new Date();
      const count = await this.purchaseOrderRepository.transition(tx, tenantId, id, dto.version, ['DRAFT', 'PENDING_APPROVAL'], actorId, {
        status: 'APPROVED',
        approvedAt: now,
        approvedBy: actorId,
        ...(row.status === 'DRAFT' ? { submittedAt: now, submittedBy: actorId } : {}),
      });
      if (count === 0) throw new ConcurrentModificationError();
      await this.audit(tx, tenantId, actorId, id, 'purchase_order.approved', { orderNo: row.orderNo }, meta, { status: row.status });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  async reject(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: RejectPurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrderDetail> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      const { row, isOwnBranch, requiresMainApproval } = await this.loadVisible(tx, tenantId, branch, settings, id);
      if (isOwnBranch) assertWarehouseInScope(row.warehouse.departmentId, dataScope, actorDepartmentId);
      if (!canPerformPurchaseOrderAction(row.status, 'reject')) throw new PurchaseOrderInvalidStateError('Chỉ từ chối được đơn đang Chờ duyệt.');
      if (!isPurchaseOrderApproverBranch({ requiresMainApproval, viewerBranchId: branch.id, viewerBranchIsMain: branch.isDefault, orderBranchId: row.warehouse.branchId })) {
        throw new PurchaseOrderApproverBranchError(requiresMainApproval);
      }
      const count = await this.purchaseOrderRepository.transition(tx, tenantId, id, dto.version, ['PENDING_APPROVAL'], actorId, { status: 'REJECTED', rejectionReason: dto.reason, rejectedAt: new Date(), rejectedBy: actorId });
      if (count === 0) throw new ConcurrentModificationError();
      await this.audit(tx, tenantId, actorId, id, 'purchase_order.rejected', { reason: dto.reason }, meta, { status: 'PENDING_APPROVAL' });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** "Đã gửi nhà cung cấp": Đã duyệt → Đã đặt NCC. */
  async order(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: VersionedPurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrderDetail> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      this.assertCanOrder(branch, settings);
      const { row } = await this.ownOrder(tx, tenantId, branch, settings, dataScope, actorDepartmentId, id);
      if (!canPerformPurchaseOrderAction(row.status, 'order')) throw new PurchaseOrderInvalidStateError('Chỉ gửi nhà cung cấp được đơn đã duyệt.');
      const count = await this.purchaseOrderRepository.transition(tx, tenantId, id, dto.version, ['APPROVED'], actorId, { status: 'ORDERED', orderedAt: new Date(), orderedBy: actorId });
      if (count === 0) throw new ConcurrentModificationError();
      await this.audit(tx, tenantId, actorId, id, 'purchase_order.ordered', { orderNo: row.orderNo }, meta, { status: 'APPROVED' });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** Đóng đơn khi nhà cung cấp không giao nữa — phần còn thiếu không nhận nữa; còn phiếu nhập Nháp thì phải xử lý trước. */
  async close(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: ClosePurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrderDetail> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      this.assertCanOrder(branch, settings);
      const { row } = await this.ownOrder(tx, tenantId, branch, settings, dataScope, actorDepartmentId, id);
      if (!canPerformPurchaseOrderAction(row.status, 'close')) throw new PurchaseOrderInvalidStateError('Chỉ đóng được đơn đã đặt nhà cung cấp và chưa nhận đủ.');
      const drafts = await this.purchaseOrderRepository.draftReceiptCounts(tx, tenantId, [id]);
      if ((drafts.get(id) ?? 0) > 0) throw new PurchaseOrderInvalidStateError('Đơn còn phiếu nhập kho đang soạn. Hãy duyệt hoặc xoá phiếu nhập đó trước khi đóng đơn.');
      const count = await this.purchaseOrderRepository.transition(tx, tenantId, id, dto.version, ['ORDERED', 'PARTIALLY_RECEIVED'], actorId, { status: 'CLOSED', closedReason: dto.reason, closedAt: new Date(), closedBy: actorId });
      if (count === 0) throw new ConcurrentModificationError();
      await this.audit(tx, tenantId, actorId, id, 'purchase_order.closed', { reason: dto.reason }, meta, { status: row.status });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  /** Huỷ đơn: trước khi đặt NCC, hoặc đã đặt nhưng CHƯA nhận gì và không còn phiếu nhập đang soạn. Dòng yêu cầu cấp hàng đang chờ đơn này được gỡ liên kết. */
  async cancel(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, dto: CancelPurchaseOrderRequest, meta: RequestMeta): Promise<PurchaseOrderDetail> {
    const settings = await this.clinicConfigReader.getPurchaseOrderSettings(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const branch = await this.requireViewerBranch(tx, tenantId, branchId);
      this.assertCanOrder(branch, settings);
      const { row } = await this.ownOrder(tx, tenantId, branch, settings, dataScope, actorDepartmentId, id);
      if (!canPerformPurchaseOrderAction(row.status, 'cancel')) throw new PurchaseOrderInvalidStateError('Đơn đã nhận hàng hoặc đã đóng nên không huỷ được. Dùng "Đóng đơn" nếu nhà cung cấp không giao nữa.');
      if (row.status === 'ORDERED') {
        const [received, drafts] = await Promise.all([this.purchaseOrderRepository.receivedByLine(tx, tenantId, id), this.purchaseOrderRepository.draftReceiptCounts(tx, tenantId, [id])]);
        if ([...received.values()].some((q) => q > 0) || (drafts.get(id) ?? 0) > 0) throw new PurchaseOrderInvalidStateError('Đơn đã có phiếu nhập kho nên không huỷ được.');
      }
      const count = await this.purchaseOrderRepository.transition(tx, tenantId, id, dto.version, ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'ORDERED'], actorId, {
        status: 'CANCELLED',
        // Từ chối → Huỷ: xoá dấu vết từ chối để thoả CHECK (chỉ trạng thái REJECTED mới có lý do từ chối).
        rejectionReason: null,
        cancellationReason: dto.reason,
        cancelledAt: new Date(),
        cancelledBy: actorId,
      });
      if (count === 0) throw new ConcurrentModificationError();
      await this.purchaseOrderRepository.unlinkRequestLines(tx, tenantId, actorId, id);
      await this.audit(tx, tenantId, actorId, id, 'purchase_order.cancelled', { reason: dto.reason }, meta, { status: row.status });
    });
    return this.getById(tenantId, branchId, actorId, dataScope, id);
  }

  // ============ DTO ============

  private toSummaryDto(row: PurchaseOrderListRow | PurchaseOrderDetailRow, names: Map<string, string>, settings: Settings, receivedLineCount: number, draftReceiptCount: number): PurchaseOrderSummary {
    return {
      id: row.id,
      orderNo: row.orderNo,
      status: row.status,
      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      branchId: row.warehouse.branchId,
      branchName: row.warehouse.branch.name,
      expectedDate: toDateString(row.expectedDate),
      note: row.note,
      totalAmount: Number(row.totalAmount),
      lineCount: row.lines.length,
      receivedLineCount,
      draftReceiptCount,
      createdByName: names.get(row.createdBy) ?? 'Không rõ',
      createdAt: row.createdAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      approvedByName: row.approvedBy ? (names.get(row.approvedBy) ?? 'Không rõ') : null,
      orderedAt: row.orderedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      cancellationReason: row.cancellationReason,
      closedReason: row.closedReason,
      requiresMainApproval: requiresMainBranchApproval({ needsMainApprovalSetting: settings.branchPurchaseNeedsMainApproval, orderBranchIsMain: row.warehouse.branch.isDefault }),
      version: row.version,
    };
  }

  private toDetailDto(
    row: PurchaseOrderDetailRow,
    ctx: {
      names: Map<string, string>;
      received: Map<string, number>;
      draftCount: number;
      waiting: { id: string; drugId: string; request: { id: string; requestNo: string } }[];
      requiresMainApproval: boolean;
      isOwnBranch: boolean;
      canActAsApprover: boolean;
      allowOverReceipt: boolean;
    },
  ): PurchaseOrderDetail {
    const receivedLineCount = row.lines.filter((l) => (ctx.received.get(l.id) ?? 0) >= l.quantity).length;
    const summary = this.toSummaryDto(
      row,
      ctx.names,
      // `requiresMainApproval` đã tính sẵn theo cấu hình lúc đọc — truyền lại qua cờ tương đương để không đọc cấu hình lần nữa.
      { branchPurchasingEnabled: true, branchPurchaseNeedsMainApproval: ctx.requiresMainApproval, allowOverReceipt: ctx.allowOverReceipt },
      receivedLineCount,
      ctx.draftCount,
    );
    return {
      ...summary,
      requiresMainApproval: ctx.requiresMainApproval,
      lines: row.lines.map((l) => {
        const receivedQty = ctx.received.get(l.id) ?? 0;
        const cost = l.expectedUnitCost !== null ? Number(l.expectedUnitCost) : null;
        return {
          id: l.id,
          drugId: l.drugId,
          drugCode: l.drug.code,
          drugName: l.drug.name,
          unitCode: l.unitCode,
          quantity: l.quantity,
          expectedUnitCost: cost,
          lineAmount: cost === null ? 0 : cost * l.quantity,
          lineNote: l.lineNote,
          receivedQty,
          remainingQty: purchaseOrderRemainingQty(l.quantity, receivedQty),
          sourceRequests: ctx.waiting.filter((w) => w.drugId === l.drugId).map((w) => ({ id: w.request.id, requestNo: w.request.requestNo })),
        };
      }),
      receipts: row.receipts.map((r) => ({ id: r.id, receiptNo: r.receiptNo, status: r.status, occurredAt: r.occurredAt.toISOString(), lineCount: r._count.lines, voided: r.deletedAt !== null })),
      canActAsApprover: ctx.canActAsApprover,
      isOwnBranch: ctx.isOwnBranch,
      allowOverReceipt: ctx.allowOverReceipt,
    };
  }
}
