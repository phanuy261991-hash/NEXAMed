import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BRANCH_DIRECTORY_PORT, ConcurrentModificationError, DOCTOR_DIRECTORY_PORT, formatShortSequentialCode, type BranchDirectoryPort, type DoctorDirectoryPort } from '@nexamed/core';
import type { CashAccount as CashAccountDto, CreateCashAccountRequest, ListCashAccountsResponse, UpdateCashAccountRequest } from '@nexamed/shared';
import { resolveBranchScope } from '../../common/branch-context';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import type { RequestMeta } from '../../common/request-meta';
import { CashAccountRepository, type CashAccountWithBranch, type UpdateCashAccountData } from './cash-account.repository';

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
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(BRANCH_DIRECTORY_PORT) private readonly branchDirectory: BranchDirectoryPort,
  ) {}

  async create(tenantId: string, actorId: string, currentBranchId: string, dto: CreateCashAccountRequest, meta: RequestMeta): Promise<CashAccountDto> {
    const branchId = dto.branchId ?? currentBranchId;
    await this.assertBranchAssigned(tenantId, actorId, currentBranchId, branchId);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      if (dto.isDefault) {
        const other = await this.cashAccountRepository.findDefault(tx, tenantId, branchId, dto.type);
        if (other) {
          await this.cashAccountRepository.clearDefaultFlag(tx, tenantId, other.id, actorId);
        }
      }

      const seq = await this.codeSequenceRepository.next(tx, tenantId, CASH_ACCOUNT_CODE_PREFIX, actorId);
      const code = formatShortSequentialCode(CASH_ACCOUNT_CODE_PREFIX, seq);

      const created = await this.cashAccountRepository.create(tx, tenantId, actorId, {
        branchId,
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
        afterJson: { code, name: dto.name, type: dto.type, branchId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const withBranch = await this.cashAccountRepository.findByIdAnyBranch(tx, tenantId, created.id);
      return this.toDto(withBranch!, new Map());
    });
  }

  async list(tenantId: string, actorId: string, currentBranchId: string, allBranches: boolean): Promise<ListCashAccountsResponse> {
    const branchIds = await resolveBranchScope(this.branchDirectory, tenantId, actorId, currentBranchId, allBranches);
    return this.listForBranches(tenantId, branchIds);
  }

  /** Danh sách quỹ của các chi nhánh ĐÃ được kiểm quyền — dùng chung cho màn quản trị quỹ và ô "Quỹ" của Sổ quỹ (Đợt 3, `ReportBranchScopeService`). */
  async listForBranches(tenantId: string, branchIds: string[]): Promise<ListCashAccountsResponse> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.cashAccountRepository.list(tx, tenantId, branchIds));
    const ownerIds = [...new Set(rows.map((r) => r.ownerUserId).filter((id): id is string => id !== null))];
    const names = ownerIds.length > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, ownerIds) : new Map<string, string>();
    return { items: rows.map((row) => this.toDto(row, names)) };
  }

  async update(tenantId: string, actorId: string, currentBranchId: string, id: string, dto: UpdateCashAccountRequest, meta: RequestMeta): Promise<CashAccountDto> {
    // Màn QUẢN TRỊ quỹ: sửa được quỹ của mọi chi nhánh tài khoản được gán (không chỉ chi nhánh đang làm); chi nhánh không được gán → 404.
    const assigned = new Set([currentBranchId, ...(await this.branchDirectory.listAssignedBranchIds(tenantId, actorId))]);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.cashAccountRepository.findByIdAnyBranch(tx, tenantId, id);
      if (!existing || !assigned.has(existing.branchId)) {
        throw new NotFoundException();
      }

      if (dto.isDefault === true) {
        const other = await this.cashAccountRepository.findOtherDefault(tx, tenantId, existing.branchId, existing.type, id);
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

      const updated = await this.cashAccountRepository.findByIdAnyBranch(tx, tenantId, id);
      const names = updated?.ownerUserId ? await this.doctorDirectory.getUserFullNames(tenantId, [updated.ownerUserId]) : new Map<string, string>();
      return this.toDto(updated!, names);
    });
  }

  private async assertBranchAssigned(tenantId: string, actorId: string, currentBranchId: string, branchId: string): Promise<void> {
    if (branchId === currentBranchId) return;
    const assigned = await this.branchDirectory.listAssignedBranchIds(tenantId, actorId);
    if (!assigned.includes(branchId)) {
      throw new NotFoundException();
    }
  }

  private toDto(row: CashAccountWithBranch, names: Map<string, string>): CashAccountDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      branchId: row.branchId,
      branchName: row.branch.name,
      type: row.type,
      bankName: row.bankName,
      bankAccountNo: row.bankAccountNo,
      openingBalance: Number(row.openingBalance),
      openingBalanceAt: row.openingBalanceAt.toISOString(),
      isDefault: row.isDefault,
      isActive: row.isActive,
      ownerUserId: row.ownerUserId,
      ownerUserName: row.ownerUserId ? (names.get(row.ownerUserId) ?? 'Không rõ') : null,
      version: row.version,
    };
  }
}
