import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CLINIC_CONFIG_READER_PORT,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  sortBatchesByFefo,
  StockIssueExceedsPrescribedQuantityError,
  StockIssueInsufficientStockError,
  StockIssueNotDraftError,
  StockIssueOtcRequiresNonPrescriptionDrugError,
  StockIssueVoidNotAllowedError,
  stripVietnameseDiacritics,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  ApproveStockIssueRequest,
  CreateManualStockIssueRequest,
  CreateStockIssueRequest,
  DataScope,
  DispenseBatchOption,
  DispenseQueueItem,
  GetPrescriptionDispenseStatusResponse,
  ListDispenseQueueQuery,
  ListDispenseQueueResponse,
  ListStockIssuesQuery,
  ListStockIssuesResponse,
  ManualStockIssueType,
  PrescriptionDispenseLine,
  RejectStockIssueRequest,
  StockIssueDetail,
  StockIssueSummary,
  UpdateManualStockIssueRequest,
  VoidStockIssueRequest,
} from '@nexamed/shared';
import type { Prisma, StockIssue } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { assertWarehouseInScope, resolveActorDepartmentId } from '../../common/warehouse-scope.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { DrugRepository, type DrugWithDetails } from '../drug/drug.repository';
import { WarehouseRepository } from '../drug/warehouse.repository';
import { PrescriptionRepository, type PrescriptionWithItems } from '../encounter/prescription.repository';
import { DiagnosisRepository } from '../encounter/diagnosis.repository';
import { EncounterRepository } from '../encounter/encounter.repository';
import { InvoiceRepository } from '../billing/invoice.repository';
import { StockIssueRepository, type StockIssueLineData, type StockIssueWithContext } from './stock-issue.repository';
import { InventoryBatchRepository } from './inventory-batch.repository';
import { StockLedgerRepository } from './stock-ledger.repository';
import { StockBalanceRepository } from './stock-balance.repository';

/** 3 loại phiếu xuất Nháp→Duyệt lập TAY ("Phiếu xuất kho mở rộng", docs/DECISIONS.md #170) — khác
 * `RETAIL_SALE` (1 bước) và `TRANSFER_OUT`/`COUNT_SHORTAGE` (tự sinh bởi hệ thống). */
const SUPPORTED_MANUAL_ISSUE_TYPES: readonly ManualStockIssueType[] = ['INTERNAL_ALLOCATION', 'RETURN_TO_SUPPLIER', 'WRITE_OFF'];

const MANUAL_ISSUE_TYPE_TO_LEDGER_REASON: Record<ManualStockIssueType, 'ISSUE_INTERNAL_ALLOCATION' | 'ISSUE_RETURN_TO_SUPPLIER' | 'ISSUE_WRITE_OFF'> = {
  INTERNAL_ALLOCATION: 'ISSUE_INTERNAL_ALLOCATION',
  RETURN_TO_SUPPLIER: 'ISSUE_RETURN_TO_SUPPLIER',
  WRITE_OFF: 'ISSUE_WRITE_OFF',
};

interface InvoiceLineToAppend {
  sourceStockIssueLineId: string;
  examTypeCode: string;
  examTypeName: string;
  unitPrice: bigint;
  quantity: number;
  lineTotal: bigint;
}

/**
 * Kho Thuốc & Vật tư y tế — Giai đoạn 3 (Xuất kho theo đơn + FEFO + tiền thuốc, docs/DECISIONS.md
 * #163, kế hoạch kỹ thuật fluttering-scribbling-liskov.md, mockup đã duyệt). Nguyên tắc cốt lõi
 * (#146, không đổi): đơn thuốc là Y LỆNH — CHỈ Phiếu xuất kho mới sinh tiền/trừ kho. Luồng 1 BƯỚC
 * (khác `StockReceiptService` Nháp→Duyệt) — chọn lô, xác nhận là trừ kho + sinh tiền NGAY.
 */
@Injectable()
export class StockIssueService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly stockIssueRepository: StockIssueRepository,
    private readonly drugRepository: DrugRepository,
    private readonly warehouseRepository: WarehouseRepository,
    private readonly prescriptionRepository: PrescriptionRepository,
    private readonly diagnosisRepository: DiagnosisRepository,
    private readonly encounterRepository: EncounterRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly stockLedgerRepository: StockLedgerRepository,
    private readonly stockBalanceRepository: StockBalanceRepository,
    private readonly businessCodeService: BusinessCodeService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  async create(tenantId: string, actorId: string, dataScope: DataScope, dto: CreateStockIssueRequest, meta: RequestMeta): Promise<StockIssueDetail> {
    const pharmacySeparateInvoiceEnabled = await this.clinicConfigReader.getPharmacySeparateInvoiceEnabled(tenantId);
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const createdId = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const warehouse = await this.warehouseRepository.findById(tx, tenantId, dto.warehouseId);
      if (!warehouse) throw new NotFoundException();
      assertWarehouseInScope(warehouse.departmentId, dataScope, actorDepartmentId);

      const prescription = await this.prescriptionRepository.findById(tx, tenantId, dto.prescriptionId);
      if (!prescription || prescription.signedAt === null) throw new NotFoundException();

      // Khoá tay theo TỪNG mặt hàng trong phiếu — tần suất phát thuốc cao, đồng thời tại 1 quầy
      // hoặc auto-dispense là race THẬT (khác GĐ2 chấp nhận rủi ro hiếm giữa 2 phiếu NHẬP).
      const distinctDrugIds = [...new Set(dto.lines.map((l) => l.drugId))];
      for (const drugId of distinctDrugIds) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${dto.warehouseId}:${drugId}`}, 0))`;
      }

      const lineData = await this.buildAndValidateLines(tx, tenantId, dto.warehouseId, prescription, dto.lines);
      const totalAmount = lineData.reduce((sum, l) => sum + l.lineAmount, 0n);
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const issueNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_ISSUE', occurredAt);

      const created = await this.stockIssueRepository.create(tx, tenantId, actorId, {
        issueNo,
        warehouseId: dto.warehouseId,
        prescriptionId: dto.prescriptionId,
        issueType: 'RETAIL_SALE',
        countId: null,
        transferId: null,
        departmentId: null,
        occurredAt,
        note: dto.note ?? null,
        totalAmount,
        lines: lineData,
      });

      for (const line of created.lines) {
        await this.stockLedgerRepository.create(tx, tenantId, actorId, {
          drugId: line.drugId,
          warehouseId: dto.warehouseId,
          batchId: line.batchId,
          quantityChange: -line.quantity,
          unitCost: line.unitCost,
          reason: 'ISSUE_RETAIL_SALE',
          sourceReceiptId: null,
          sourceIssueId: created.id,
          occurredAt,
          note: null,
        });
        await this.stockBalanceRepository.upsertQuantity(tx, tenantId, actorId, {
          drugId: line.drugId,
          warehouseId: dto.warehouseId,
          batchId: line.batchId,
          quantityDelta: -line.quantity,
        });
      }

      const invoiceLines: InvoiceLineToAppend[] = created.lines.map((line) => ({
        sourceStockIssueLineId: line.id,
        examTypeCode: line.drug.code,
        examTypeName: line.drug.name,
        unitPrice: line.sellPrice,
        quantity: line.quantity,
        lineTotal: line.lineAmount,
      }));
      await this.attachInvoiceLines(tx, tenantId, actorId, prescription.encounterId, pharmacySeparateInvoiceEnabled, invoiceLines);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_issue.created',
        entityType: 'stock_issue',
        entityId: created.id,
        afterJson: { issueNo, prescriptionId: dto.prescriptionId, warehouseId: dto.warehouseId, lineCount: created.lines.length, totalAmount: totalAmount.toString() },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return created.id;
    });

    return this.getById(tenantId, actorId, dataScope, createdId);
  }

  /** Đọc/validate mọi dòng hàng — dùng chung cho `create()` (thủ công) và `autoDispenseForPrescription()`. */
  private async buildAndValidateLines(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    prescription: PrescriptionWithItems,
    lines: { prescriptionItemId?: string | null; drugId: string; batchId?: string | null; quantity: number }[],
  ): Promise<StockIssueLineData[]> {
    const itemIds = [...new Set(lines.map((l) => l.prescriptionItemId).filter((v): v is string => !!v))];
    const dispensedMap = await this.stockIssueRepository.sumDispensedForItems(tx, tenantId, itemIds);
    const drugCache = new Map<string, DrugWithDetails>();
    // Kho Thuốc GĐ3 (#165, "tách nhiều lô/dòng") — 1 request giờ có thể chứa NHIỀU dòng cho CÙNG
    // 1 `prescriptionItemId` (mỗi lô 1 dòng) hoặc CÙNG 1 `(drugId, batchId)` — 2 map dưới đây cộng
    // dồn NGAY TRONG request này, tránh lỗ hổng "mỗi dòng kiểm riêng lẻ đều qua dù tổng vượt số đã
    // kê/vượt tồn thật" (chỉ kiểm độc lập là đủ khi trước đây LUÔN đúng 1 dòng/thuốc mỗi request).
    const claimedByItem = new Map<string, number>();
    const claimedByStockKey = new Map<string, number>();

    const result: StockIssueLineData[] = [];
    for (const line of lines) {
      let drug = drugCache.get(line.drugId);
      if (!drug) {
        const found = await this.drugRepository.findByIdWithDetails(tx, tenantId, line.drugId);
        if (!found) throw new NotFoundException();
        drug = found;
        drugCache.set(line.drugId, drug);
      }

      if (line.prescriptionItemId) {
        const item = prescription.items.find((i) => i.id === line.prescriptionItemId);
        if (!item) throw new NotFoundException();
        const dispensedSoFar = dispensedMap.get(line.prescriptionItemId) ?? 0;
        const claimedSoFar = claimedByItem.get(line.prescriptionItemId) ?? 0;
        const remaining = item.quantity - dispensedSoFar - claimedSoFar;
        if (line.quantity > remaining) {
          throw new StockIssueExceedsPrescribedQuantityError(drug.name, remaining);
        }
        claimedByItem.set(line.prescriptionItemId, claimedSoFar + line.quantity);
      } else if (drug.isPrescriptionOnly) {
        throw new StockIssueOtcRequiresNonPrescriptionDrugError(drug.name);
      }

      let unitCost: bigint;
      let batchId: string | null = null;
      if (drug.isBatchManaged) {
        if (!line.batchId) {
          throw new UnprocessableEntityException(`Thuốc/vật tư "${drug.name}" quản lý theo lô — phải chọn lô.`);
        }
        const batch = await this.inventoryBatchRepository.findById(tx, tenantId, line.batchId);
        if (!batch || batch.drugId !== line.drugId || batch.warehouseId !== warehouseId) {
          throw new NotFoundException();
        }
        const stockKey = `${line.drugId}:${line.batchId}`;
        const claimedStock = claimedByStockKey.get(stockKey) ?? 0;
        const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, line.drugId, warehouseId, line.batchId);
        if ((balance?.quantityOnHand ?? 0) - claimedStock < line.quantity) {
          throw new StockIssueInsufficientStockError(drug.name);
        }
        claimedByStockKey.set(stockKey, claimedStock + line.quantity);
        unitCost = batch.unitCost;
        batchId = line.batchId;
      } else {
        const stockKey = `${line.drugId}:`;
        const claimedStock = claimedByStockKey.get(stockKey) ?? 0;
        const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, line.drugId, warehouseId, null);
        if ((balance?.quantityOnHand ?? 0) - claimedStock < line.quantity) {
          throw new StockIssueInsufficientStockError(drug.name);
        }
        claimedByStockKey.set(stockKey, claimedStock + line.quantity);
        unitCost = balance?.averageUnitCost ?? 0n;
      }

      // Giá bán LUÔN theo đơn vị NHỎ NHẤT (`drug.defaultSellPrice`) — quantity ở đây vốn đã là đơn
      // vị cơ sở (đúng khuôn `prescription_item.quantity`), KHÔNG cần tra `unitPricingEnabled`/
      // `DrugUnit.sellPrice` như lúc nhập kho (chỉ có ý nghĩa khi bán theo vỉ/hộp).
      const sellPrice = drug.defaultSellPrice ?? 0n;
      const lineAmount = sellPrice * BigInt(line.quantity);
      result.push({ prescriptionItemId: line.prescriptionItemId ?? null, drugId: line.drugId, batchId, quantity: line.quantity, unitCost, sellPrice, lineAmount });
    }
    return result;
  }

  /**
   * Gắn tiền vào hoá đơn (#146, không đổi nguyên tắc): hoá đơn SERVICE đang mở (UNPAID) VÀ tenant
   * KHÔNG bật tách hoá đơn thuốc → cộng vào đó; ngược lại → cộng vào hoá đơn DRUG UNPAID gần nhất
   * của cùng lượt khám, hoặc tạo mới nếu chưa có. Retry 1 lần khi version lệch (hiếm — dispensing 2
   * phiếu gần như đồng thời cho CÙNG 1 lượt khám), rơi hẳn sang tạo hoá đơn DRUG riêng nếu vẫn kẹt.
   */
  private async attachInvoiceLines(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    encounterId: string,
    pharmacySeparateInvoiceEnabled: boolean,
    invoiceLines: InvoiceLineToAppend[],
  ): Promise<void> {
    const serviceInvoice = pharmacySeparateInvoiceEnabled ? null : await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
    if (serviceInvoice && serviceInvoice.status === 'UNPAID') {
      const count = await this.invoiceRepository.appendLines(tx, tenantId, serviceInvoice.id, serviceInvoice.version, actorId, invoiceLines);
      if (count > 0) return;
    }

    const openDrugInvoice = await this.invoiceRepository.findOpenDrugInvoiceForEncounter(tx, tenantId, encounterId);
    if (openDrugInvoice) {
      const count = await this.invoiceRepository.appendLines(tx, tenantId, openDrugInvoice.id, openDrugInvoice.version, actorId, invoiceLines);
      if (count > 0) return;
    }

    await this.invoiceRepository.createDrugInvoice(tx, tenantId, actorId, encounterId, invoiceLines);
  }

  async voidIssue(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: VoidStockIssueRequest, meta: RequestMeta): Promise<StockIssueDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockIssueRepository.findByIdAnyWithContext(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'POSTED') throw new StockIssueVoidNotAllowedError();
      assertWarehouseInScope(existing.warehouse.departmentId, dataScope, actorDepartmentId);

      const lineIds = existing.lines.map((l) => l.id);
      const invoice = await this.invoiceRepository.findByStockIssueLineIds(tx, tenantId, lineIds);
      if (invoice && invoice.status !== 'UNPAID') {
        throw new StockIssueVoidNotAllowedError();
      }

      const count = await this.stockIssueRepository.voidPosted(tx, tenantId, id, dto.version, actorId, dto.reason);
      if (count === 0) throw new ConcurrentModificationError();

      const originalEntries = await this.stockLedgerRepository.listForSourceIssue(tx, tenantId, id);
      for (const entry of originalEntries) {
        await this.stockLedgerRepository.create(tx, tenantId, actorId, {
          drugId: entry.drugId,
          warehouseId: entry.warehouseId,
          batchId: entry.batchId,
          quantityChange: -entry.quantityChange,
          unitCost: entry.unitCost,
          reason: 'ISSUE_VOID',
          sourceReceiptId: null,
          sourceIssueId: id,
          occurredAt: new Date(),
          note: 'Đảo dòng thẻ kho do huỷ phiếu xuất kho',
        });
        await this.stockBalanceRepository.upsertQuantity(tx, tenantId, actorId, {
          drugId: entry.drugId,
          warehouseId: entry.warehouseId,
          batchId: entry.batchId,
          quantityDelta: -entry.quantityChange,
        });
      }

      if (invoice) {
        await this.invoiceRepository.removeStockIssueLines(tx, tenantId, invoice.id, lineIds, actorId, existing.totalAmount);
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_issue.voided',
        entityType: 'stock_issue',
        entityId: id,
        afterJson: { reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, actorId, dataScope, id);
  }

  // ============ "Phiếu xuất kho mở rộng" (docs/DECISIONS.md #170, kế hoạch kỹ thuật
  // bright-bubbling-axolotl.md mục 4, mockup đã duyệt) — 3 loại Nháp→Duyệt lập tay: Xuất dùng nội
  // bộ/Xuất trả nhà cung cấp/Xuất huỷ. KHÔNG gắn đơn thuốc/hoá đơn (sellPrice/lineAmount luôn 0,
  // đúng bản chất COUNT_SHORTAGE/TRANSFER_OUT). Kiểm đủ tồn CHỈ lúc Duyệt (đọc SỐNG), không chặn lúc
  // lập Nháp — đúng khuôn `StockTransferService.approveShip()`, KHÔNG dùng advisory lock (thao tác
  // không tần suất cao như "Phát thuốc" tại quầy). ============

  async createManual(tenantId: string, actorId: string, dataScope: DataScope, dto: CreateManualStockIssueRequest, meta: RequestMeta): Promise<StockIssueDetail> {
    if (!SUPPORTED_MANUAL_ISSUE_TYPES.includes(dto.issueType)) {
      throw new UnprocessableEntityException(`Loại phiếu "${dto.issueType}" chưa được hỗ trợ ở giai đoạn này.`);
    }
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const created = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const warehouse = await this.warehouseRepository.findById(tx, tenantId, dto.warehouseId);
      if (!warehouse) throw new NotFoundException();
      assertWarehouseInScope(warehouse.departmentId, dataScope, actorDepartmentId);
      if (dto.departmentId) {
        const departments = await this.doctorDirectory.getDepartmentNames(tenantId);
        if (!departments.has(dto.departmentId)) throw new NotFoundException();
      }

      const lines = await this.buildManualLineData(tx, tenantId, dto.warehouseId, dto.lines);
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const issueNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_ISSUE', occurredAt);

      const row = await this.stockIssueRepository.create(tx, tenantId, actorId, {
        issueNo,
        warehouseId: dto.warehouseId,
        prescriptionId: null,
        issueType: dto.issueType,
        countId: null,
        transferId: null,
        departmentId: dto.departmentId ?? null,
        occurredAt,
        note: dto.note,
        totalAmount: 0n,
        status: 'DRAFT',
        lines,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_issue.created',
        entityType: 'stock_issue',
        entityId: row.id,
        afterJson: { issueNo, issueType: dto.issueType, warehouseId: dto.warehouseId, lineCount: lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return row;
    });

    return this.getById(tenantId, actorId, dataScope, created.id);
  }

  /** Sửa Nháp — bulk-replace toàn bộ dòng hàng + header, chỉ khi `status='DRAFT'`. Kiểm scope CẢ 2
   * đầu (kho HIỆN TẠI của phiếu VÀ kho MỚI trong `dto`) — đúng khuôn `StockReceiptService.update()`. */
  async updateManual(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: UpdateManualStockIssueRequest, meta: RequestMeta): Promise<StockIssueDetail> {
    if (!SUPPORTED_MANUAL_ISSUE_TYPES.includes(dto.issueType)) {
      throw new UnprocessableEntityException(`Loại phiếu "${dto.issueType}" chưa được hỗ trợ ở giai đoạn này.`);
    }
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockIssueRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockIssueNotDraftError();

      const currentWarehouse = await this.warehouseRepository.findById(tx, tenantId, existing.warehouseId);
      assertWarehouseInScope(currentWarehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const warehouse = await this.warehouseRepository.findById(tx, tenantId, dto.warehouseId);
      if (!warehouse) throw new NotFoundException();
      assertWarehouseInScope(warehouse.departmentId, dataScope, actorDepartmentId);
      if (dto.departmentId) {
        const departments = await this.doctorDirectory.getDepartmentNames(tenantId);
        if (!departments.has(dto.departmentId)) throw new NotFoundException();
      }

      const lines = await this.buildManualLineData(tx, tenantId, dto.warehouseId, dto.lines);
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : existing.occurredAt;

      const count = await this.stockIssueRepository.updateManualDraft(tx, tenantId, id, dto.version, actorId, {
        warehouseId: dto.warehouseId,
        issueType: dto.issueType,
        departmentId: dto.departmentId ?? null,
        occurredAt,
        note: dto.note,
        lines,
      });
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_issue.updated',
        entityType: 'stock_issue',
        entityId: id,
        afterJson: { issueType: dto.issueType, warehouseId: dto.warehouseId, lineCount: lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, actorId, dataScope, id);
  }

  /** Duyệt — đọc lại tồn kho SỐNG cho từng dòng, chặn nếu bất kỳ dòng nào không đủ tồn, rồi trừ tồn
   * + ghi thẻ kho (mirror `applyPostedLines()` phía `StockReceiptService` nhưng CỘNG→TRỪ). */
  async approveManual(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: ApproveStockIssueRequest, meta: RequestMeta): Promise<StockIssueDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockIssueRepository.findByIdAnyWithContext(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockIssueNotDraftError();
      assertWarehouseInScope(existing.warehouse.departmentId, dataScope, actorDepartmentId);

      for (const line of existing.lines) {
        const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, line.drugId, existing.warehouseId, line.batchId);
        if ((balance?.quantityOnHand ?? 0) < line.quantity) {
          throw new StockIssueInsufficientStockError(line.drug.name);
        }
      }

      const count = await this.stockIssueRepository.approveManual(tx, tenantId, id, dto.version, actorId);
      if (count === 0) throw new ConcurrentModificationError();

      for (const line of existing.lines) {
        await this.stockLedgerRepository.create(tx, tenantId, actorId, {
          drugId: line.drugId,
          warehouseId: existing.warehouseId,
          batchId: line.batchId,
          quantityChange: -line.quantity,
          unitCost: line.unitCost,
          reason: MANUAL_ISSUE_TYPE_TO_LEDGER_REASON[existing.issueType as ManualStockIssueType],
          sourceReceiptId: null,
          sourceIssueId: id,
          occurredAt: existing.occurredAt,
          note: null,
        });
        await this.stockBalanceRepository.upsertQuantity(tx, tenantId, actorId, {
          drugId: line.drugId,
          warehouseId: existing.warehouseId,
          batchId: line.batchId,
          quantityDelta: -line.quantity,
        });
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_issue.approved',
        entityType: 'stock_issue',
        entityId: id,
        beforeJson: { status: 'DRAFT' },
        afterJson: { status: 'POSTED' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, actorId, dataScope, id);
  }

  async rejectManual(tenantId: string, actorId: string, dataScope: DataScope, id: string, dto: RejectStockIssueRequest, meta: RequestMeta): Promise<StockIssueDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.stockIssueRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'DRAFT') throw new StockIssueNotDraftError();

      const warehouse = await this.warehouseRepository.findById(tx, tenantId, existing.warehouseId);
      assertWarehouseInScope(warehouse?.departmentId ?? null, dataScope, actorDepartmentId);

      const count = await this.stockIssueRepository.rejectManual(tx, tenantId, id, dto.version, actorId, dto.reason);
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_issue.rejected',
        entityType: 'stock_issue',
        entityId: id,
        beforeJson: { status: 'DRAFT' },
        afterJson: { status: 'REJECTED', reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.getById(tenantId, actorId, dataScope, id);
  }

  /** Đọc/validate mọi dòng hàng lúc lập/sửa Nháp phiếu xuất mở rộng — KHÔNG kiểm đủ tồn ở đây (chỉ
   * lúc Duyệt, đúng khuôn `StockTransferService.buildLineData()`). `unitCost` lấy từ lô/tồn kho hiện
   * có CHỈ để hiển thị/ghi thẻ kho — không chặn nếu lô đang tạm hết hàng lúc lập Nháp. */
  private async buildManualLineData(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    lines: { drugId: string; batchId?: string | null; quantity: number }[],
  ): Promise<StockIssueLineData[]> {
    const drugCache = new Map<string, DrugWithDetails>();
    const result: StockIssueLineData[] = [];
    for (const line of lines) {
      let drug = drugCache.get(line.drugId);
      if (!drug) {
        const found = await this.drugRepository.findByIdWithDetails(tx, tenantId, line.drugId);
        if (!found) throw new NotFoundException();
        drug = found;
        drugCache.set(line.drugId, drug);
      }

      let unitCost: bigint;
      let batchId: string | null = null;
      if (drug.isBatchManaged) {
        if (!line.batchId) {
          throw new UnprocessableEntityException(`Thuốc/vật tư "${drug.name}" quản lý theo lô — phải chọn lô.`);
        }
        const batch = await this.inventoryBatchRepository.findById(tx, tenantId, line.batchId);
        if (!batch || batch.drugId !== line.drugId) throw new NotFoundException();
        unitCost = batch.unitCost;
        batchId = line.batchId;
      } else {
        const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, line.drugId, warehouseId, null);
        unitCost = balance?.averageUnitCost ?? 0n;
      }

      result.push({ prescriptionItemId: null, drugId: line.drugId, batchId, quantity: line.quantity, unitCost, sellPrice: 0n, lineAmount: 0n });
    }
    return result;
  }

  /**
   * Kho Thuốc GĐ4 (docs/DECISIONS.md #170) — Kiểm kê phát hiện THIẾU: `StockCountService.approve()`
   * gọi hàm này TRONG CÙNG transaction để tự sinh 1 `StockIssue` (`issueType='COUNT_SHORTAGE'`),
   * không gắn đơn thuốc/hoá đơn nào — CHỈ trừ tồn + ghi thẻ kho, khác `create()` (luồng phát thuốc
   * theo đơn, có gắn tiền vào invoice).
   */
  async createCountShortageIssue(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    params: { warehouseId: string; countId: string; occurredAt: Date; countNo: string; lines: { drugId: string; batchId: string | null; quantity: number; unitCost: bigint }[] },
  ): Promise<StockIssueWithContext> {
    return this.createSystemGeneratedIssue(tx, tenantId, actorId, {
      warehouseId: params.warehouseId,
      issueType: 'COUNT_SHORTAGE',
      countId: params.countId,
      transferId: null,
      occurredAt: params.occurredAt,
      note: `Tự sinh từ phiếu kiểm kê ${params.countNo}`,
      ledgerReason: 'ISSUE_COUNT_SHORTAGE',
      lines: params.lines,
    });
  }

  /**
   * Kho Thuốc GĐ4, phần "Điều chuyển kho" (docs/DECISIONS.md #170) — `StockTransferService.
   * approveShip()` gọi hàm này TRONG CÙNG transaction để tự sinh 1 `StockIssue`
   * (`issueType='TRANSFER_OUT'`) lúc Duyệt xuất — xuất kho NGUỒN NGAY, không gắn đơn thuốc/hoá đơn
   * nào (cùng bản chất `createCountShortageIssue()`, tách hàm dùng chung `createSystemGeneratedIssue()`
   * vì đây là lần lặp lại THỨ HAI của cùng 1 khuôn "phiếu xuất tự sinh, không gắn tiền").
   */
  async createTransferOutIssue(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    params: { warehouseId: string; transferId: string; occurredAt: Date; transferNo: string; lines: { drugId: string; batchId: string | null; quantity: number; unitCost: bigint }[] },
  ): Promise<StockIssueWithContext> {
    return this.createSystemGeneratedIssue(tx, tenantId, actorId, {
      warehouseId: params.warehouseId,
      issueType: 'TRANSFER_OUT',
      countId: null,
      transferId: params.transferId,
      occurredAt: params.occurredAt,
      note: `Tự sinh từ phiếu điều chuyển kho ${params.transferNo}`,
      ledgerReason: 'ISSUE_TRANSFER_OUT',
      lines: params.lines,
    });
  }

  /** Khuôn dùng chung cho MỌI phiếu xuất TỰ SINH bởi hệ thống (không gắn đơn thuốc/hoá đơn nào,
   * `sellPrice`/`lineAmount` luôn 0) — `POSTED` NGAY, trừ tồn + ghi thẻ kho. Dùng bởi
   * `createCountShortageIssue()`/`createTransferOutIssue()` ở trên. */
  private async createSystemGeneratedIssue(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    params: {
      warehouseId: string;
      issueType: 'COUNT_SHORTAGE' | 'TRANSFER_OUT';
      countId: string | null;
      transferId: string | null;
      occurredAt: Date;
      note: string;
      ledgerReason: 'ISSUE_COUNT_SHORTAGE' | 'ISSUE_TRANSFER_OUT';
      lines: { drugId: string; batchId: string | null; quantity: number; unitCost: bigint }[];
    },
  ): Promise<StockIssueWithContext> {
    const lineData: StockIssueLineData[] = params.lines.map((l) => ({
      prescriptionItemId: null,
      drugId: l.drugId,
      batchId: l.batchId,
      quantity: l.quantity,
      unitCost: l.unitCost,
      // Không có "giá bán" — đây là điều chỉnh/di chuyển tồn kho thuần, không gắn hoá đơn nào.
      sellPrice: 0n,
      lineAmount: 0n,
    }));
    const issueNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'STOCK_ISSUE', params.occurredAt);

    const created = await this.stockIssueRepository.create(tx, tenantId, actorId, {
      issueNo,
      warehouseId: params.warehouseId,
      prescriptionId: null,
      issueType: params.issueType,
      countId: params.countId,
      transferId: params.transferId,
      departmentId: null,
      occurredAt: params.occurredAt,
      note: params.note,
      totalAmount: 0n,
      lines: lineData,
    });

    for (const line of created.lines) {
      await this.stockLedgerRepository.create(tx, tenantId, actorId, {
        drugId: line.drugId,
        warehouseId: params.warehouseId,
        batchId: line.batchId,
        quantityChange: -line.quantity,
        unitCost: line.unitCost,
        reason: params.ledgerReason,
        sourceReceiptId: null,
        sourceIssueId: created.id,
        occurredAt: params.occurredAt,
        note: null,
      });
      await this.stockBalanceRepository.upsertQuantity(tx, tenantId, actorId, {
        drugId: line.drugId,
        warehouseId: params.warehouseId,
        batchId: line.batchId,
        quantityDelta: -line.quantity,
      });
    }

    return created;
  }

  async getById(tenantId: string, actorId: string, dataScope: DataScope, id: string): Promise<StockIssueDetail> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);

    const row = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.stockIssueRepository.findByIdAnyWithContext(tx, tenantId, id));
    if (!row) throw new NotFoundException();
    assertWarehouseInScope(row.warehouse.departmentId, dataScope, actorDepartmentId);
    const names = await this.doctorDirectory.getUserFullNames(tenantId, row.voidedBy ? [row.createdBy, row.voidedBy] : [row.createdBy]);
    // Kho Thuốc GĐ3 (#165) — hoá đơn ĐÃ cộng tiền của chính phiếu xuất này, cho nút "Xem hoá đơn" ở
    // màn thành công `DispensePrescriptionDialog.tsx`. Tính lại qua `findByStockIssueLineIds()` có
    // sẵn (đúng khuôn kiểm tra lúc huỷ phiếu) — KHÔNG lưu `invoiceId` trên `stock_issue` (tránh 2
    // nguồn sự thật, hoá đơn có thể đổi nếu dòng bị xoá/gộp lại sau này).
    const attachedInvoice = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.invoiceRepository.findByStockIssueLineIds(tx, tenantId, row.lines.map((l) => l.id)),
    );
    return this.toDetailDto(row, names, attachedInvoice ? { invoiceId: attachedInvoice.id, invoiceNo: attachedInvoice.invoiceNo, invoiceType: attachedInvoice.invoiceType } : null);
  }

  async list(tenantId: string, actorId: string, dataScope: DataScope, query: ListStockIssuesQuery): Promise<ListStockIssuesResponse> {
    const actorDepartmentId = await resolveActorDepartmentId(this.doctorDirectory, tenantId, actorId, dataScope);
    // Scope `department` nhưng actor CHƯA gán Khoa/Phòng nào — trả rỗng ngay, đúng khuôn
    // `StockCountService.list()`/`StockReceiptService.list()`.
    if (dataScope === 'department' && actorDepartmentId === null) {
      return { items: [], nextCursor: null };
    }

    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.stockIssueRepository.list(tx, tenantId, {
        warehouseId: query.warehouseId,
        status: query.status,
        issueType: query.issueType,
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
      if (row.voidedBy) ids.add(row.voidedBy);
    }
    const names = ids.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...ids]) : new Map<string, string>();

    return {
      items: page.map((row) => this.toSummaryDto(row, row.warehouse.name, row.prescription?.encounter ?? null, row._count.lines, names)),
      nextCursor,
    };
  }

  /** `GET /inventory/prescriptions/:id/dispense-status` — kê/đã phát/còn lại từng dòng + gợi ý FEFO. */
  async getDispenseStatus(tenantId: string, prescriptionId: string, warehouseId: string | undefined): Promise<GetPrescriptionDispenseStatusResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const prescription = await this.prescriptionRepository.findById(tx, tenantId, prescriptionId);
      if (!prescription || prescription.signedAt === null) throw new NotFoundException();

      const resolvedWarehouseId = warehouseId ?? (await this.warehouseRepository.findDefault(tx, tenantId))?.id ?? null;
      const itemIds = prescription.items.map((i) => i.id);
      const dispensedMap = await this.stockIssueRepository.sumDispensedForItems(tx, tenantId, itemIds);

      const drugCache = new Map<string, DrugWithDetails>();
      const lines: PrescriptionDispenseLine[] = [];
      for (const item of prescription.items) {
        let drug = drugCache.get(item.drugId);
        if (!drug) {
          const found = await this.drugRepository.findByIdWithDetails(tx, tenantId, item.drugId);
          if (!found) continue;
          drug = found;
          drugCache.set(item.drugId, drug);
        }
        const dispensedQuantity = dispensedMap.get(item.id) ?? 0;
        let suggestedBatches: DispenseBatchOption[] = [];
        let warehouseStockOnHand = 0;
        if (resolvedWarehouseId) {
          if (drug.isBatchManaged) {
            const batches = await this.inventoryBatchRepository.listWithBalanceForDrug(tx, tenantId, item.drugId, resolvedWarehouseId);
            const withStringExpiry = batches.map((b) => ({ ...b, expiryDate: b.expiryDate ? b.expiryDate.toISOString().slice(0, 10) : null }));
            suggestedBatches = sortBatchesByFefo(withStringExpiry).map((b) => ({
              batchId: b.batchId,
              batchNo: b.batchNo,
              expiryDate: b.expiryDate,
              quantityOnHand: b.quantityOnHand,
              unitCost: Number(b.unitCost),
            }));
            // Tồn kho hiển thị cho dược sĩ là TỔNG mọi lô — tách biệt hoàn toàn với
            // `remainingQuantity` (còn lại theo đơn), tránh nhầm lẫn đã gặp thật (báo "không đủ" dù
            // đơn "còn lại" 1 trong khi kho có 3300, chỉ là chưa nhìn thấy vì kẹt dưới lô khác cờ).
            warehouseStockOnHand = suggestedBatches.reduce((sum, b) => sum + b.quantityOnHand, 0);
          } else {
            const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, item.drugId, resolvedWarehouseId, null);
            warehouseStockOnHand = balance?.quantityOnHand ?? 0;
          }
        }
        lines.push({
          prescriptionItemId: item.id,
          drugId: item.drugId,
          drugName: item.drugName,
          isBatchManaged: drug.isBatchManaged,
          isPrescriptionOnly: drug.isPrescriptionOnly,
          prescribedQuantity: item.quantity,
          dispensedQuantity,
          remainingQuantity: Math.max(0, item.quantity - dispensedQuantity),
          sellPrice: drug.defaultSellPrice === null ? 0 : Number(drug.defaultSellPrice),
          suggestedBatches,
          warehouseStockOnHand,
        });
      }

      // "Mã đơn thuốc thật" (docs/DECISIONS.md #169) — khối thông tin đầu dialog "Phát thuốc".
      const signedByNames = prescription.signedBy ? await this.doctorDirectory.getUserFullNames(tenantId, [prescription.signedBy]) : new Map<string, string>();
      const diagnoses = await this.diagnosisRepository.listForEncounter(tx, tenantId, prescription.encounterId);
      const diagnosisLabel = diagnoses.length > 0 ? diagnoses.map((d) => `${d.icd10.nameVi} (${d.icd10Code})`).join(' / ') : null;
      // Rà soát 22/09/2026 (chủ dự án phát hiện): dialog "Phát thuốc" trước đây không hiện đang phát
      // cho bệnh nhân nào — chỉ trang danh sách hàng đợi mới có tên/mã, API dialog gọi lại thiếu.
      const patient = await this.encounterRepository.findPatientIdentityById(tx, tenantId, prescription.encounterId);

      return {
        prescriptionId: prescription.id,
        encounterId: prescription.encounterId,
        patientFullName: patient?.fullName ?? '—',
        patientCode: patient?.patientCode ?? '—',
        signedAt: prescription.signedAt?.toISOString() ?? null,
        prescriptionNo: prescription.prescriptionNo,
        signedByName: prescription.signedBy ? (signedByNames.get(prescription.signedBy) ?? null) : null,
        diagnosisLabel,
        lines,
      };
    });
  }

  /** `GET /inventory/dispense-queue` — đơn ĐÃ KÝ còn thuốc chưa phát hết. */
  async listDispenseQueue(tenantId: string, query: ListDispenseQueueQuery): Promise<ListDispenseQueueResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const qRaw = query.q?.trim() || undefined;
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const prescriptions = await this.stockIssueRepository.listSignedPrescriptionsForDispenseQueue(tx, tenantId, {
        qRaw,
        qNormalized: qRaw ? stripVietnameseDiacritics(qRaw) : undefined,
        includeOlder: query.includeOlder,
        cutoff,
      });

      const allItemIds = prescriptions.flatMap((p) => p.items.map((i) => i.id));
      const dispensedMap = await this.stockIssueRepository.sumDispensedForItems(tx, tenantId, allItemIds);

      const items: DispenseQueueItem[] = [];
      for (const p of prescriptions) {
        const totalPrescribedQuantity = p.items.reduce((sum, i) => sum + i.quantity, 0);
        const totalDispensedQuantity = p.items.reduce((sum, i) => sum + (dispensedMap.get(i.id) ?? 0), 0);
        const fullyDispensed = totalDispensedQuantity >= totalPrescribedQuantity;
        if (fullyDispensed) continue;
        items.push({
          prescriptionId: p.id,
          encounterId: p.encounter.id,
          encounterNo: p.encounter.encounterNo,
          patientId: p.encounter.patient.id,
          patientCode: p.encounter.patient.patientCode,
          patientFullName: p.encounter.patient.fullName,
          phone: p.encounter.patient.phone,
          signedAt: p.signedAt!.toISOString(),
          totalPrescribedQuantity,
          totalDispensedQuantity,
          fullyDispensed,
        });
      }
      return { items };
    });
  }

  private toSummaryDto(
    row: StockIssue,
    warehouseName: string,
    // Nullable từ Kho Thuốc GĐ4 (#170) — `COUNT_SHORTAGE` tự sinh không gắn đơn thuốc/lượt khám nào.
    encounter: { id: string; encounterNo: string; patient: { patientCode: string; fullName: string } } | null,
    lineCount: number,
    names: Map<string, string>,
    // "Phiếu xuất kho mở rộng" (#170) — `null` cho mọi phiếu không phải INTERNAL_ALLOCATION.
    departmentName: string | null = null,
  ): StockIssueSummary {
    return {
      id: row.id,
      issueNo: row.issueNo,
      issueType: row.issueType,
      status: row.status,
      warehouseId: row.warehouseId,
      warehouseName,
      prescriptionId: row.prescriptionId,
      encounterId: encounter?.id ?? null,
      patientCode: encounter?.patient.patientCode ?? null,
      patientFullName: encounter?.patient.fullName ?? null,
      occurredAt: row.occurredAt.toISOString(),
      note: row.note,
      totalAmount: Number(row.totalAmount),
      lineCount,
      createdByName: names.get(row.createdBy) ?? 'Không rõ',
      approvedByName: row.approvedBy ? (names.get(row.approvedBy) ?? 'Không rõ') : null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      departmentId: row.departmentId,
      departmentName,
      voidedByName: row.voidedBy ? (names.get(row.voidedBy) ?? 'Không rõ') : null,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidReason: row.voidReason,
      version: row.version,
    };
  }

  private toDetailDto(row: StockIssueWithContext, names: Map<string, string>, attachedInvoice: StockIssueDetail['attachedInvoice'] = null): StockIssueDetail {
    return {
      ...this.toSummaryDto(row, row.warehouse.name, row.prescription?.encounter ?? null, row.lines.length, names, row.department?.name ?? null),
      attachedInvoice,
      lines: row.lines.map((line) => ({
        id: line.id,
        prescriptionItemId: line.prescriptionItemId,
        drugId: line.drugId,
        drugCode: line.drug.code,
        drugName: line.drug.name,
        batchId: line.batchId,
        batchNo: line.batch?.batchNo ?? null,
        quantity: line.quantity,
        unitCost: Number(line.unitCost),
        sellPrice: Number(line.sellPrice),
        lineAmount: Number(line.lineAmount),
      })),
    };
  }
}
