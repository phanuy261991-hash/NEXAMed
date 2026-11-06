import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TechnicalServicePrice } from '@prisma/client';
import { CLINIC_CONFIG_READER_PORT, ConcurrentModificationError, getVietnamDateString, LabPartnerDisabledError, maxDataScope, TechnicalServicePriceOverlapError, type ClinicConfigReaderPort } from '@nexamed/core';
import {
  DEFAULT_RESULT_TYPE_BY_KIND,
  type BusinessCodeType,
  type CreateTechnicalServiceRequest,
  type LabPartnerPriceInput,
  type ListTechnicalServicesQuery,
  type ListTechnicalServicesResponse,
  type TechnicalServiceCurrentPrice,
  type TechnicalServiceDetail,
  type TechnicalServiceItem,
  type TechnicalServiceKind,
  type UpdateTechnicalServiceRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { findScopesForUserPermission } from '../../infrastructure/persistence/permission-lookup.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { LabIndicatorRepository } from './lab-indicator.repository';
import {
  TechnicalServiceRepository,
  type CreatePriceData,
  type IndicatorLinkData,
  type LabPartnerPriceRow,
  type TechnicalServiceRow,
  type UpdateTechnicalServiceData,
} from './technical-service.repository';

const PRICE_OVERLAP_CONSTRAINT = 'technical_service_price_no_overlap_excl';

const CODE_TYPE_BY_KIND: Record<TechnicalServiceKind, BusinessCodeType> = {
  LAB: 'TECH_SERVICE_LAB',
  IMAGING: 'TECH_SERVICE_IMAGING',
  FUNCTIONAL: 'TECH_SERVICE_FUNCTIONAL',
};

/** Exclusion constraint của Postgres → Prisma trả `PrismaClientUnknownRequestError` (xem
 * `appointment.service.ts` `isExclusionViolation` — xác nhận thật bằng test, không đoán mã). */
function isPriceOverlap(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientUnknownRequestError && err.message.includes('23P01') && err.message.includes(PRICE_OVERLAP_CONSTRAINT);
}

function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Danh mục dịch vụ kỹ thuật cận lâm sàng (Cận lâm sàng GĐ1, docs/DECISIONS.md #212) — xét nghiệm / chẩn đoán
 * hình ảnh / thăm dò chức năng, kèm đơn giá đa mức và danh sách chỉ số. Mã tự sinh theo loại (XN/CD/TD).
 */
@Injectable()
export class TechnicalServiceService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: TechnicalServiceRepository,
    private readonly indicatorRepository: LabIndicatorRepository,
    private readonly businessCodeService: BusinessCodeService,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfig: ClinicConfigReaderPort,
  ) {}

  async list(tenantId: string, query: ListTechnicalServicesQuery): Promise<ListTechnicalServicesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.repository.list(tx, tenantId, {
        kind: query.kind,
        search: query.search,
        categoryCode: query.categoryCode,
        inHouse: query.inHouse === undefined ? undefined : query.inHouse === 'true',
        includeInactive: query.includeInactive,
      });
      const prices = await this.repository.listPrices(
        tx,
        tenantId,
        rows.map((r) => r.id),
      );
      const counts = await this.repository.countsByKind(tx, tenantId, query.includeInactive);
      return {
        items: rows.map((row) => this.toItem(row, prices.filter((p) => p.technicalServiceId === row.id))),
        counts: { ...counts, total: counts.LAB + counts.IMAGING + counts.FUNCTIONAL },
      };
    });
  }

  async getById(tenantId: string, id: string, actorId: string): Promise<TechnicalServiceDetail> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => this.loadDetail(tx, tenantId, id, actorId));
  }

  /** Toàn bộ dịch vụ (cả đã ẩn) kèm giá đang hiệu lực — cho Xuất Excel (#276), đọc trong transaction của người gọi. */
  async listAllInTx(tx: Prisma.TransactionClient, tenantId: string): Promise<TechnicalServiceItem[]> {
    const rows = await this.repository.list(tx, tenantId, { includeInactive: true });
    const prices = await this.repository.listPrices(
      tx,
      tenantId,
      rows.map((r) => r.id),
    );
    return rows.map((row) => this.toItem(row, prices.filter((p) => p.technicalServiceId === row.id)));
  }

  /** Ghi dữ liệu "Gửi đối tác" (#291) chỉ được khi công tắc BẬT. Đọc cấu hình NGOÀI transaction (một request = một transaction, #264). */
  private async assertPartnerWriteAllowed(tenantId: string, dto: { sentToPartner?: boolean; partnerPrices?: LabPartnerPriceInput[] }): Promise<void> {
    const writes = dto.sentToPartner === true || (dto.partnerPrices !== undefined && dto.partnerPrices.length > 0);
    if (writes && !(await this.clinicConfig.getLabPartnerEnabled(tenantId))) throw new LabPartnerDisabledError();
  }

  async create(tenantId: string, actorId: string, dto: CreateTechnicalServiceRequest, meta: RequestMeta): Promise<TechnicalServiceDetail> {
    await this.assertPartnerWriteAllowed(tenantId, dto);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => this.createInTx(tx, tenantId, actorId, dto, meta));
  }

  /** Tạo dịch vụ trong transaction của người gọi — dùng chung cho form "Thêm dịch vụ" và Nhập Excel (#276, tạo hàng loạt trong MỘT giao dịch). */
  async createInTx(tx: Prisma.TransactionClient, tenantId: string, actorId: string, dto: CreateTechnicalServiceRequest, meta: RequestMeta): Promise<TechnicalServiceDetail> {
    await this.assertIndicatorsValid(tx, tenantId, dto.indicators?.map((i) => i.indicatorId));
    this.assertPartnerEligible({ serviceKind: dto.serviceKind, isPerformedInHouse: dto.isPerformedInHouse, sentToPartner: dto.sentToPartner });

    const code = await this.businessCodeService.generate(tx, tenantId, actorId, CODE_TYPE_BY_KIND[dto.serviceKind], new Date());
    let created;
    try {
      created = await this.repository.create(tx, tenantId, actorId, {
        code,
        name: dto.name,
        shortName: dto.shortName ?? null,
        nationalCode: dto.nationalCode ?? null,
        serviceKind: dto.serviceKind,
        categoryCode: dto.categoryCode ?? null,
        // Mẫu bệnh phẩm chỉ có nghĩa với xét nghiệm.
        specimenTypeCode: dto.serviceKind === 'LAB' ? (dto.specimenTypeCode ?? null) : null,
        isPerformedInHouse: dto.isPerformedInHouse,
        sentToPartner: dto.sentToPartner,
        departmentId: dto.departmentId ?? null,
        turnaroundMinutes: dto.turnaroundMinutes ?? null,
        resultType: dto.resultType ?? DEFAULT_RESULT_TYPE_BY_KIND[dto.serviceKind],
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) throw new BadRequestException('Khoa/Phòng không tồn tại.');
      throw err;
    }

    if (dto.prices !== undefined) await this.replacePrices(tx, tenantId, created.id, actorId, dto.prices);
    await this.savePartnerConfig(tx, tenantId, actorId, created.id, {
      serviceKind: created.serviceKind,
      isPerformedInHouse: created.isPerformedInHouse,
      sentToPartner: created.sentToPartner,
      prices: dto.partnerPrices,
    });
    if (dto.indicators !== undefined) await this.repository.replaceIndicatorLinks(tx, tenantId, created.id, actorId, this.toLinkData(dto.indicators));

    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'technical_service.created',
      entityType: 'technical_service',
      entityId: created.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return this.loadDetail(tx, tenantId, created.id, actorId);
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateTechnicalServiceRequest, meta: RequestMeta): Promise<TechnicalServiceDetail> {
    await this.assertPartnerWriteAllowed(tenantId, dto);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findRowById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      await this.assertIndicatorsValid(tx, tenantId, dto.indicators?.map((i) => i.indicatorId));
      this.assertPartnerEligible({
        serviceKind: existing.serviceKind,
        isPerformedInHouse: dto.isPerformedInHouse ?? existing.isPerformedInHouse,
        sentToPartner: dto.sentToPartner ?? existing.sentToPartner,
      });

      const data: UpdateTechnicalServiceData = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.shortName !== undefined) data.shortName = dto.shortName;
      if (dto.nationalCode !== undefined) data.nationalCode = dto.nationalCode;
      if (dto.categoryCode !== undefined) data.categoryCode = dto.categoryCode;
      if (dto.specimenTypeCode !== undefined) data.specimenTypeCode = existing.serviceKind === 'LAB' ? dto.specimenTypeCode : null;
      if (dto.isPerformedInHouse !== undefined) data.isPerformedInHouse = dto.isPerformedInHouse;
      if (dto.sentToPartner !== undefined) data.sentToPartner = dto.sentToPartner;
      if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;
      if (dto.turnaroundMinutes !== undefined) data.turnaroundMinutes = dto.turnaroundMinutes;
      if (dto.resultType !== undefined) data.resultType = dto.resultType;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

      let count: number;
      try {
        // Luôn đi qua đây (kể cả khi chỉ đổi đơn giá/chỉ số) để khoá lạc quan + tăng `version` đúng 1 lần.
        count = await this.repository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, data);
      } catch (err) {
        if (isForeignKeyViolation(err)) throw new BadRequestException('Khoa/Phòng không tồn tại.');
        throw err;
      }
      if (count === 0) throw new ConcurrentModificationError();

      if (dto.prices !== undefined) await this.replacePrices(tx, tenantId, id, actorId, dto.prices);
      await this.savePartnerConfig(tx, tenantId, actorId, id, {
        serviceKind: existing.serviceKind,
        isPerformedInHouse: dto.isPerformedInHouse ?? existing.isPerformedInHouse,
        sentToPartner: dto.sentToPartner ?? existing.sentToPartner,
        prices: dto.partnerPrices,
      });
      if (dto.indicators !== undefined) await this.repository.replaceIndicatorLinks(tx, tenantId, id, actorId, this.toLinkData(dto.indicators));

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'technical_service.updated',
        entityType: 'technical_service',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.loadDetail(tx, tenantId, id, actorId);
    });
  }

  /**
   * Giá TRẢ đối tác là giá vốn của dịch vụ, khách không được thấy (#291): chỉ trả cho người cấu hình dịch vụ (`technical_service.update`) hoặc xem công nợ nhà cung cấp (`supplier_debt.read`);
   * bác sĩ, điều dưỡng, lễ tân xem dịch vụ nhận danh sách rỗng. Cũng không có trong phiếu chỉ định/phiếu thu/kết quả in cho bệnh nhân.
   */
  private async canSeePartnerCost(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<boolean> {
    const scopes = [
      ...(await findScopesForUserPermission(tx, tenantId, actorId, 'technical_service', 'update')),
      ...(await findScopesForUserPermission(tx, tenantId, actorId, 'supplier_debt', 'read')),
    ];
    return maxDataScope(scopes) !== 'none';
  }

  private async loadDetail(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string): Promise<TechnicalServiceDetail> {
    const row = await this.repository.findRowById(tx, tenantId, id);
    if (!row) throw new NotFoundException();
    const prices = await this.repository.listPrices(tx, tenantId, [id]);
    const links = await this.repository.listIndicatorLinks(tx, tenantId, id);
    const partnerPrices = (await this.canSeePartnerCost(tx, tenantId, actorId)) ? await this.repository.listPartnerPrices(tx, tenantId, [id]) : [];
    return {
      ...this.toItem(row, prices),
      partnerPrices: partnerPrices.map((p: LabPartnerPriceRow) => ({
        id: p.id,
        supplierId: p.supplierId,
        supplierCode: p.supplier.code,
        supplierName: p.supplier.name,
        amount: Number(p.amount),
        isDefault: p.isDefault,
      })),
      prices: prices.map((p) => ({
        id: p.id,
        priceTypeCode: p.priceTypeCode,
        unitCode: p.unitCode,
        amount: Number(p.amount),
        effectiveFrom: toDateOnly(p.effectiveFrom),
        ...(p.effectiveTo ? { effectiveTo: toDateOnly(p.effectiveTo) } : {}),
      })),
      indicators: links.map((l) => ({
        id: l.id,
        indicatorId: l.indicatorId,
        code: l.indicator.code,
        name: l.indicator.name,
        abbreviation: l.indicator.abbreviation,
        unit: l.indicator.unit,
        sortOrder: l.sortOrder,
        interpretationText: l.interpretationText,
      })),
    };
  }

  private async replacePrices(
    tx: Prisma.TransactionClient,
    tenantId: string,
    serviceId: string,
    actorId: string,
    items: NonNullable<CreateTechnicalServiceRequest['prices']>,
  ): Promise<void> {
    const data: CreatePriceData[] = items.map((item) => ({
      priceTypeCode: item.priceTypeCode,
      unitCode: item.unitCode,
      amount: BigInt(item.amount),
      effectiveFrom: new Date(item.effectiveFrom),
      effectiveTo: item.effectiveTo ? new Date(item.effectiveTo) : null,
    }));
    try {
      await this.repository.replacePrices(tx, tenantId, serviceId, actorId, data);
    } catch (err) {
      if (isPriceOverlap(err)) throw new TechnicalServicePriceOverlapError();
      throw err;
    }
  }

  /**
   * Kiểm và lưu cấu hình "Gửi đối tác" (#291). `prices` undefined = không đụng giá trả hiện có (chỉ kiểm lại điều kiện với giá đang có). Quy tắc: chỉ XÉT NGHIỆM tự làm mới gửi đối tác được; đang bật thì phải có
   * ít nhất một đối tác có giá và đúng MỘT đối tác mặc định (không đánh dấu thì dòng đầu là mặc định); mỗi đối tác một dòng, đối tác phải còn dùng và được đánh dấu "Đối tác XN".
   */
  /** Điều kiện của "Gửi đối tác" — kiểm TRƯỚC khi ghi dịch vụ để người dùng nhận 400 rõ ràng thay vì ràng buộc CHECK của DB (500). */
  private assertPartnerEligible(ctx: { serviceKind: TechnicalServiceKind; isPerformedInHouse: boolean; sentToPartner: boolean }): void {
    if (!ctx.sentToPartner) return;
    if (ctx.serviceKind !== 'LAB') throw new BadRequestException('Chỉ xét nghiệm mới gửi đối tác được.');
    if (!ctx.isPerformedInHouse) throw new BadRequestException('Dịch vụ chỉ định ra ngoài không gửi đối tác được.');
  }

  private async savePartnerConfig(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    serviceId: string,
    ctx: { serviceKind: TechnicalServiceKind; isPerformedInHouse: boolean; sentToPartner: boolean; prices: LabPartnerPriceInput[] | undefined },
  ): Promise<void> {
    this.assertPartnerEligible(ctx);
    let effective: { supplierId: string; amount: bigint; isDefault: boolean }[];
    if (ctx.prices !== undefined) {
      const ids = ctx.prices.map((p) => p.supplierId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Mỗi đối tác chỉ có một giá trả cho dịch vụ.');
      const valid = new Set(await this.repository.findActivePartnerIds(tx, tenantId, ids));
      if (ids.some((i) => !valid.has(i))) throw new BadRequestException('Có đối tác không tồn tại, đã ngưng hoặc chưa được đánh dấu là đối tác xét nghiệm.');
      const defaults = ctx.prices.filter((p) => p.isDefault).length;
      if (defaults > 1) throw new BadRequestException('Chỉ được đặt một đối tác mặc định.');
      effective = ctx.prices.map((p, index) => ({ supplierId: p.supplierId, amount: BigInt(p.amount), isDefault: defaults === 1 ? p.isDefault : index === 0 }));
    } else {
      const current = await this.repository.listPartnerPrices(tx, tenantId, [serviceId]);
      effective = current.map((p) => ({ supplierId: p.supplierId, amount: p.amount, isDefault: p.isDefault }));
    }
    if (ctx.sentToPartner && effective.length === 0) throw new BadRequestException('Chọn ít nhất một đối tác và nhập giá trả.');
    if (ctx.prices !== undefined) await this.repository.replacePartnerPrices(tx, tenantId, serviceId, actorId, effective);
  }

  private toLinkData(items: NonNullable<CreateTechnicalServiceRequest['indicators']>): IndicatorLinkData[] {
    return items.map((item, index) => ({ indicatorId: item.indicatorId, sortOrder: index, interpretationText: item.interpretationText?.trim() || null }));
  }

  private async assertIndicatorsValid(tx: Prisma.TransactionClient, tenantId: string, ids: string[] | undefined): Promise<void> {
    if (ids === undefined || ids.length === 0) return;
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw new BadRequestException('Chỉ số bị trùng trong danh sách.');
    const found = await this.indicatorRepository.findByIds(tx, tenantId, unique);
    if (found.length !== unique.length) throw new BadRequestException('Có chỉ số không tồn tại trong danh mục.');
  }

  /** Giá đang hiệu lực HÔM NAY (giờ Việt Nam) — mỗi Loại giá một dòng (đã chặn chồng lấn ở DB nên không mơ hồ). */
  private currentPrices(prices: TechnicalServicePrice[]): TechnicalServiceCurrentPrice[] {
    const today = getVietnamDateString();
    return prices
      .filter((p) => toDateOnly(p.effectiveFrom) <= today && (p.effectiveTo === null || toDateOnly(p.effectiveTo) >= today))
      .map((p) => ({ priceTypeCode: p.priceTypeCode, unitCode: p.unitCode, amount: Number(p.amount) }));
  }

  private toItem(row: TechnicalServiceRow, prices: TechnicalServicePrice[]): TechnicalServiceItem {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      nationalCode: row.nationalCode,
      serviceKind: row.serviceKind,
      categoryCode: row.categoryCode,
      specimenTypeCode: row.specimenTypeCode,
      isPerformedInHouse: row.isPerformedInHouse,
      sentToPartner: row.sentToPartner,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
      turnaroundMinutes: row.turnaroundMinutes,
      resultType: row.resultType,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      version: row.version,
      currentPrices: this.currentPrices(prices),
      indicatorCount: row._count.indicators,
    };
  }
}
