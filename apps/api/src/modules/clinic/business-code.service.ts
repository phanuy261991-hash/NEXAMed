import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BusinessCodeTemplateInvalidError, BusinessCodeTemplateStartingValueLockedError, toVietnamDateParts } from '@nexamed/core';
import {
  BUSINESS_CODE_TYPE_REGISTRY,
  businessCodeTypeSchema,
  computeBusinessCodePeriodKey,
  DEFAULT_BUSINESS_CODE_COUNTER_DIGITS,
  DEFAULT_BUSINESS_CODE_STARTING_VALUE,
  DEFAULT_BUSINESS_CODE_TEMPLATE,
  formatBusinessCode,
  parseBusinessCodeTemplate,
  type BusinessCodeTemplateItem,
  type BusinessCodeType,
  type UpdateBusinessCodeTemplateRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { ClinicSettingsRepository, type BusinessCodeTemplateEntry } from './clinic-settings.repository';

/**
 * "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114, chủ dự án yêu cầu trực tiếp 2026-09-03) —
 * điểm gọi DUY NHẤT cho 7 loại mã nghiệp vụ có tháng-năm (thay `formatDisplayCode` +
 * `CodeSequenceRepository.next()` gọi trực tiếp trước đây ở `patient.service.ts`/
 * `department.service.ts`/`user-account.service.ts`/`appointment.service.ts`/`reception.service.ts`/
 * `invoice.repository.ts`/`cashier-shift.repository.ts`). `generate()` chạy TRONG transaction của
 * caller (nhận `tx`, không tự mở transaction riêng) — đúng khuôn `CodeSequenceRepository.next()`.
 *
 * Tiền tố NỘI BỘ (`BUSINESS_CODE_TYPE_REGISTRY[...].internalPrefix`, vd "BN") CHỈ dùng làm khoá
 * đếm `code_sequence.prefix` — KHÔNG đổi theo chữ tự do admin gõ trong khuôn mẫu hiển thị. Nhờ
 * vậy sửa khuôn không bao giờ làm mất mạch bộ đếm đang chạy.
 */
@Injectable()
export class BusinessCodeService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly clinicSettingsRepository: ClinicSettingsRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
  ) {}

  /** Sinh mã thật — cấp số atomic, KHÔNG hoàn tác được. Gọi trong transaction đang tạo bản ghi
   * (patient/encounter/invoice...), đúng khuôn `formatDisplayCode` cũ. */
  async generate(tx: Prisma.TransactionClient, tenantId: string, actorId: string, codeType: BusinessCodeType, occurredAtUtc: Date): Promise<string> {
    const config = await this.resolveConfig(tx, tenantId, codeType);
    // Khuôn mặc định luôn hợp lệ (test tương thích ngược); khuôn tenant tự sửa đã validate lúc
    // lưu (updateTemplate) nên về lý thuyết không bao giờ lỗi tới đây — vẫn kiểm để không âm thầm
    // sinh mã sai nếu có lỗ hổng nào đó lọt qua validate.
    const parseResult = parseBusinessCodeTemplate(config.template);
    if (!parseResult.ok) {
      throw new BusinessCodeTemplateInvalidError(`Cấu hình mẫu mã hỏng cho ${codeType}: ${parseResult.error}`);
    }

    const dateParts = toVietnamDateParts(occurredAtUtc);
    const periodKey = computeBusinessCodePeriodKey(parseResult.parsed, dateParts);
    const prefix = BUSINESS_CODE_TYPE_REGISTRY[codeType].internalPrefix;

    const seq = await this.codeSequenceRepository.next(tx, tenantId, prefix, actorId, {
      periodKey,
      initialValueIfNeverUsed: BigInt(config.startingValue),
    });

    return formatBusinessCode(config.template, config.counterDigits, dateParts, seq);
  }

  /** `GET /clinic-settings/code-templates` — 7 dòng, kèm `locked`/`exampleNextCode` tính toán,
   * KHÔNG cấp số/đụng `code_sequence` thật. */
  async listTemplates(tenantId: string): Promise<BusinessCodeTemplateItem[]> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const stored = await this.clinicSettingsRepository.getBusinessCodeTemplatesConfig(tx, tenantId);
      const now = toVietnamDateParts(new Date());
      const items: BusinessCodeTemplateItem[] = [];
      for (const codeType of businessCodeTypeSchema.options) {
        const config = stored[codeType] ?? this.defaultConfig(codeType);
        items.push(await this.toItem(tx, tenantId, codeType, config, now));
      }
      return items;
    });
  }

  /** `PATCH /clinic-settings/code-templates/:codeType` — validate cú pháp, chặn sửa `startingValue`
   * khi loại mã đã `locked` (đã phát sinh mã đầu tiên, bất kỳ chu kỳ nào). */
  async updateTemplate(
    tenantId: string,
    actorId: string,
    codeType: BusinessCodeType,
    dto: UpdateBusinessCodeTemplateRequest,
    meta: RequestMeta,
  ): Promise<BusinessCodeTemplateItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const parseResult = parseBusinessCodeTemplate(dto.template);
      if (!parseResult.ok) {
        throw new BusinessCodeTemplateInvalidError(parseResult.error);
      }

      const prefix = BUSINESS_CODE_TYPE_REGISTRY[codeType].internalPrefix;
      const existingStored = await this.clinicSettingsRepository.getBusinessCodeTemplatesConfig(tx, tenantId);
      const existingEntry = existingStored[codeType];

      if (dto.startingValue !== undefined) {
        const locked = await this.codeSequenceRepository.hasEverBeenUsed(tx, tenantId, prefix);
        if (locked) {
          throw new BusinessCodeTemplateStartingValueLockedError();
        }
      }

      const newEntry: BusinessCodeTemplateEntry = {
        template: dto.template,
        counterDigits: dto.counterDigits,
        startingValue: dto.startingValue ?? existingEntry?.startingValue ?? DEFAULT_BUSINESS_CODE_STARTING_VALUE,
      };
      await this.clinicSettingsRepository.upsertBusinessCodeTemplateEntry(tx, tenantId, actorId, codeType, newEntry);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'business_code_template.updated',
        entityType: 'tenant_setting',
        entityId: tenantId,
        beforeJson: (existingEntry ?? null) as unknown as Prisma.InputJsonValue,
        afterJson: newEntry as unknown as Prisma.InputJsonObject,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const now = toVietnamDateParts(new Date());
      return this.toItem(tx, tenantId, codeType, newEntry, now);
    });
  }

  private defaultConfig(codeType: BusinessCodeType): BusinessCodeTemplateEntry {
    return {
      template: DEFAULT_BUSINESS_CODE_TEMPLATE[codeType],
      counterDigits: DEFAULT_BUSINESS_CODE_COUNTER_DIGITS,
      startingValue: DEFAULT_BUSINESS_CODE_STARTING_VALUE,
    };
  }

  private async resolveConfig(tx: Prisma.TransactionClient, tenantId: string, codeType: BusinessCodeType): Promise<BusinessCodeTemplateEntry> {
    const stored = await this.clinicSettingsRepository.getBusinessCodeTemplatesConfig(tx, tenantId);
    return stored[codeType] ?? this.defaultConfig(codeType);
  }

  private async toItem(
    tx: Prisma.TransactionClient,
    tenantId: string,
    codeType: BusinessCodeType,
    config: BusinessCodeTemplateEntry,
    now: { year: number; month: number; day: number },
  ): Promise<BusinessCodeTemplateItem> {
    const prefix = BUSINESS_CODE_TYPE_REGISTRY[codeType].internalPrefix;
    const locked = await this.codeSequenceRepository.hasEverBeenUsed(tx, tenantId, prefix);

    const parseResult = parseBusinessCodeTemplate(config.template);
    let exampleNextCode = '(khuôn mẫu lỗi)';
    if (parseResult.ok) {
      const periodKey = computeBusinessCodePeriodKey(parseResult.parsed, now);
      const current = await this.codeSequenceRepository.peekCurrentValue(tx, tenantId, prefix, periodKey);
      const nextSeq = current !== null ? current + 1n : BigInt(config.startingValue);
      exampleNextCode = formatBusinessCode(config.template, config.counterDigits, now, nextSeq);
    }

    return {
      codeType,
      label: BUSINESS_CODE_TYPE_REGISTRY[codeType].label,
      prefix,
      template: config.template,
      counterDigits: config.counterDigits,
      startingValue: config.startingValue,
      locked,
      exampleNextCode,
    };
  }
}
