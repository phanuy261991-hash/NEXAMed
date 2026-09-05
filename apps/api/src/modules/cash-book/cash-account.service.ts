import { Injectable, NotFoundException } from '@nestjs/common';
import { ConcurrentModificationError, formatShortSequentialCode } from '@nexamed/core';
import type { CashAccount as CashAccountDto, CreateCashAccountRequest, ListCashAccountsResponse, UpdateCashAccountRequest } from '@nexamed/shared';
import type { CashAccount } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import type { RequestMeta } from '../../common/request-meta';
import { CashAccountRepository, type UpdateCashAccountData } from './cash-account.repository';

/** Mã ngắn tuần tự (docs/DECISIONS.md #113) — RIÊNG theo tenant (khác 6 category `reference_catalog`
 * toàn hệ thống), dùng `CodeSequenceRepository` có sẵn — đúng khuôn `WorkShiftService`/`department`. */
const CASH_ACCOUNT_CODE_PREFIX = 'QU';

/**
 * "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1, mockup Artifact duyệt trước khi code) — quản lý Quỹ
 * (tiền mặt/ngân hàng). Mỗi loại quỹ (CASH/BANK/DRAWER) chỉ có đúng 1 quỹ mặc định/tenant (C —
 * partial unique index `cash_account_one_default_per_type`) — đổi quỹ mặc định mới thì phải bỏ cờ
 * quỹ mặc định cũ TRONG CÙNG transaction trước khi set quỹ mới, tránh vi phạm unique.
 */
@Injectable()
export class CashAccountService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly cashAccountRepository: CashAccountRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
  ) {}

  async create(tenantId: string, actorId: string, dto: CreateCashAccountRequest, meta: RequestMeta): Promise<CashAccountDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      if (dto.isDefault) {
        const other = await this.cashAccountRepository.findDefault(tx, tenantId, dto.type);
        if (other) {
          await this.cashAccountRepository.clearDefaultFlag(tx, tenantId, other.id, actorId);
        }
      }

      const seq = await this.codeSequenceRepository.next(tx, tenantId, CASH_ACCOUNT_CODE_PREFIX, actorId);
      const code = formatShortSequentialCode(CASH_ACCOUNT_CODE_PREFIX, seq);

      const created = await this.cashAccountRepository.create(tx, tenantId, actorId, {
        code,
        name: dto.name,
        type: dto.type,
        bankName: dto.bankName ?? null,
        bankAccountNo: dto.bankAccountNo ?? null,
        openingBalance: BigInt(dto.openingBalance),
        openingBalanceAt: new Date(dto.openingBalanceAt),
        isDefault: dto.isDefault ?? false,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cash_account.created',
        entityType: 'cash_account',
        entityId: created.id,
        afterJson: { code, name: dto.name, type: dto.type },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toDto(created);
    });
  }

  async list(tenantId: string): Promise<ListCashAccountsResponse> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.cashAccountRepository.list(tx, tenantId));
    return { items: rows.map((row) => this.toDto(row)) };
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateCashAccountRequest, meta: RequestMeta): Promise<CashAccountDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.cashAccountRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      if (dto.isDefault === true) {
        const other = await this.cashAccountRepository.findOtherDefault(tx, tenantId, existing.type, id);
        if (other) {
          await this.cashAccountRepository.clearDefaultFlag(tx, tenantId, other.id, actorId);
        }
      }

      const patch: UpdateCashAccountData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.bankName !== undefined) patch.bankName = dto.bankName;
      if (dto.bankAccountNo !== undefined) patch.bankAccountNo = dto.bankAccountNo;
      if (dto.isDefault !== undefined) patch.isDefault = dto.isDefault;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const count = await this.cashAccountRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cash_account.updated',
        entityType: 'cash_account',
        entityId: id,
        afterJson: { ...patch },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.cashAccountRepository.findById(tx, tenantId, id);
      return this.toDto(updated!);
    });
  }

  private toDto(row: CashAccount): CashAccountDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      bankName: row.bankName,
      bankAccountNo: row.bankAccountNo,
      openingBalance: Number(row.openingBalance),
      openingBalanceAt: row.openingBalanceAt.toISOString(),
      isDefault: row.isDefault,
      isActive: row.isActive,
      version: row.version,
    };
  }
}
