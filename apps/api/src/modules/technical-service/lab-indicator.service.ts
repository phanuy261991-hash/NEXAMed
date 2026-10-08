import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { LabIndicatorReference, Prisma } from '@prisma/client';
import { ConcurrentModificationError, LabIndicatorValueTypeLockedError } from '@nexamed/core';
import type {
  CreateLabIndicatorRequest,
  LabIndicatorDetail,
  LabIndicatorItem,
  LabIndicatorReferenceInput,
  LabIndicatorValueType,
  ListLabIndicatorsQuery,
  ListLabIndicatorsResponse,
  UpdateLabIndicatorRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { LabIndicatorRepository, type CreateReferenceData, type LabIndicatorRow, type UpdateLabIndicatorData } from './lab-indicator.repository';

function parseChoiceOptions(raw: unknown): string[] | null {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : null;
}

/**
 * Chỉ số xét nghiệm + khoảng tham chiếu theo giới tính × tuổi (Cận lâm sàng GĐ1, docs/DECISIONS.md #212). Chỉ số dùng
 * chung cho nhiều dịch vụ (`technical_service_indicator`) nên đã gắn vào dịch vụ thì KHÔNG đổi Kiểu giá trị.
 */
@Injectable()
export class LabIndicatorService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: LabIndicatorRepository,
    private readonly businessCodeService: BusinessCodeService,
  ) {}

  async list(tenantId: string, query: ListLabIndicatorsQuery): Promise<ListLabIndicatorsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.repository.list(tx, tenantId, { search: query.search, includeInactive: query.includeInactive });
      return { items: rows.map((r) => this.toItem(r)) };
    });
  }

  async getById(tenantId: string, id: string): Promise<LabIndicatorDetail> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => this.loadDetail(tx, tenantId, id));
  }

  async create(tenantId: string, actorId: string, dto: CreateLabIndicatorRequest, meta: RequestMeta): Promise<LabIndicatorDetail> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const code = await this.businessCodeService.generate(tx, tenantId, actorId, 'LAB_INDICATOR', new Date());
      const created = await this.repository.create(tx, tenantId, actorId, {
        code,
        name: dto.name,
        abbreviation: dto.abbreviation ?? null,
        unit: dto.unit ?? null,
        valueType: dto.valueType,
        decimals: dto.valueType === 'NUMBER' ? (dto.decimals ?? null) : null,
        choiceOptions: dto.valueType === 'CHOICE' ? (dto.choiceOptions ?? null) : null,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      });
      if (dto.references !== undefined) {
        await this.repository.replaceReferences(tx, tenantId, created.id, actorId, this.toReferenceData(dto.valueType, dto.references));
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'lab_indicator.created',
        entityType: 'lab_indicator',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.loadDetail(tx, tenantId, created.id);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateLabIndicatorRequest, meta: RequestMeta): Promise<LabIndicatorDetail> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findRowById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();

      const valueType: LabIndicatorValueType = dto.valueType ?? existing.valueType;
      if (valueType !== existing.valueType && existing._count.services > 0) {
        throw new LabIndicatorValueTypeLockedError();
      }
      const choiceOptions = dto.choiceOptions !== undefined ? dto.choiceOptions : parseChoiceOptions(existing.choiceOptions);
      if (valueType === 'CHOICE' && (choiceOptions === null || choiceOptions.length < 2)) {
        throw new BadRequestException('Chỉ số kiểu Chọn cần ít nhất 2 lựa chọn.');
      }

      const data: UpdateLabIndicatorData = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.abbreviation !== undefined) data.abbreviation = dto.abbreviation;
      if (dto.unit !== undefined) data.unit = dto.unit;
      if (dto.valueType !== undefined) data.valueType = dto.valueType;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
      // Đồng bộ trường phụ thuộc kiểu giá trị: số lẻ chỉ cho NUMBER, danh sách lựa chọn chỉ cho CHOICE.
      data.decimals = valueType === 'NUMBER' ? (dto.decimals !== undefined ? dto.decimals : existing.decimals) : null;
      data.choiceOptions = valueType === 'CHOICE' ? choiceOptions : null;

      const count = await this.repository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, data);
      if (count === 0) throw new ConcurrentModificationError();

      if (dto.references !== undefined) {
        await this.repository.replaceReferences(tx, tenantId, id, actorId, this.toReferenceData(valueType, dto.references));
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'lab_indicator.updated',
        entityType: 'lab_indicator',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.loadDetail(tx, tenantId, id);
    });
  }

  private async loadDetail(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<LabIndicatorDetail> {
    const row = await this.repository.findRowById(tx, tenantId, id);
    if (!row) throw new NotFoundException();
    const references = await this.repository.listReferences(tx, tenantId, id);
    return { ...this.toItem(row), references: references.map((r) => this.toReferenceItem(r)) };
  }

  /**
   * Chuẩn hoá theo kiểu giá trị: NUMBER dùng ngưỡng (bỏ `normalText`), TEXT/CHOICE dùng `normalText` (bỏ ngưỡng).
   * Thứ tự dòng giữ đúng thứ tự người dùng nhập — `selectLabReference` tự chọn dòng cụ thể nhất, không phụ thuộc thứ tự.
   */
  private toReferenceData(valueType: LabIndicatorValueType, items: LabIndicatorReferenceInput[]): CreateReferenceData[] {
    return items.map((item, index) => {
      const numeric = valueType === 'NUMBER';
      return {
        sex: item.sex,
        ageFromYears: item.ageFromYears,
        ageToYears: item.ageToYears ?? null,
        lowValue: numeric ? (item.lowValue ?? null) : null,
        highValue: numeric ? (item.highValue ?? null) : null,
        lowInclusive: item.lowInclusive,
        highInclusive: item.highInclusive,
        normalText: numeric ? null : (item.normalText?.trim() || null),
        displayText: item.displayText?.trim() ? item.displayText : null,
        note: item.note?.trim() || null,
        sortOrder: index,
      };
    });
  }

  private toReferenceItem(r: LabIndicatorReference): LabIndicatorDetail['references'][number] {
    return {
      id: r.id,
      sex: r.sex,
      ageFromYears: r.ageFromYears,
      ageToYears: r.ageToYears,
      lowValue: r.lowValue,
      highValue: r.highValue,
      lowInclusive: r.lowInclusive,
      highInclusive: r.highInclusive,
      normalText: r.normalText,
      displayText: r.displayText,
      note: r.note,
    };
  }

  private toItem(row: LabIndicatorRow): LabIndicatorItem {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      abbreviation: row.abbreviation,
      unit: row.unit,
      valueType: row.valueType,
      decimals: row.decimals,
      choiceOptions: parseChoiceOptions(row.choiceOptions),
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      version: row.version,
      referenceCount: row._count.references,
      serviceCount: row._count.services,
    };
  }
}
