import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CASHIER_SHIFT_READER_PORT,
  CashVoucherNotEditableError,
  CashVoucherNotPendingApprovalError,
  CLINIC_CONFIG_READER_PORT,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  type CashierShiftReaderPort,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  CashVoucher as CashVoucherDto,
  CreateCashVoucherRequest,
  DataScope,
  ListCashVouchersQuery,
  ListCashVouchersResponse,
  RejectCashVoucherRequest,
  UpdateCashVoucherRequest,
  VoidCashVoucherRequest,
} from '@nexamed/shared';
import type { CashVoucher } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { CashAccountRepository } from './cash-account.repository';
import { CashVoucherRepository, type UpdateCashVoucherData } from './cash-voucher.repository';

/**
 * "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1, mockup Artifact duyệt trước khi code) — Phiếu thu/chi
 * ngoài dịch vụ khám (tiền điện/nước, bán phế liệu...). Đơn giản hơn `InvoiceService`/
 * `CashierShiftService` ở chỗ KHÔNG có luồng trạng thái phức tạp (chỉ 3 trạng thái tuyến tính,
 * không có "sửa sau khi chốt"/"xử lý chênh lệch") nhưng CÓ 2 điều kiện khoá sửa/huỷ:
 * (1) đã bị Từ chối (`REJECTED`, chỉ đọc — lập phiếu mới thay vì hồi sinh); (2) ca thu ngân gắn
 * với phiếu (nếu có) đã chốt — cùng nguyên tắc "Chốt ca" tự khoá số liệu của chính nó.
 */
@Injectable()
export class CashVoucherService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly cashVoucherRepository: CashVoucherRepository,
    private readonly cashAccountRepository: CashAccountRepository,
    private readonly businessCodeService: BusinessCodeService,
    @Inject(CASHIER_SHIFT_READER_PORT) private readonly cashierShiftReader: CashierShiftReaderPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  async create(tenantId: string, actorId: string, dto: CreateCashVoucherRequest, meta: RequestMeta): Promise<CashVoucherDto> {
    // Đúng khuôn InvoiceService.markPaid() — port tự mở transaction đọc riêng, resolve TRƯỚC
    // transaction chính, không lồng runInTenantScope.
    const cashierShiftId = await this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId);
    // Chỉ phiếu CHI mới cần duyệt (chủ đích — tiền ra khỏi két mới cần kiểm soát chặt, phiếu THU
    // không ảnh hưởng, xem comment `cashVoucherApprovalEnabled` ở packages/shared/src/clinic.ts).
    const approvalEnabled = dto.direction === 'EXPENSE' && (await this.clinicConfigReader.getCashVoucherApprovalEnabled(tenantId));

    const created = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const account = await this.cashAccountRepository.findById(tx, tenantId, dto.cashAccountId);
      if (!account) {
        throw new NotFoundException();
      }

      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const voucherNo = await this.businessCodeService.generate(tx, tenantId, actorId, dto.direction === 'INCOME' ? 'CASH_RECEIPT' : 'CASH_PAYMENT', occurredAt);
      const status = approvalEnabled ? 'PENDING_APPROVAL' : 'POSTED';

      const row = await this.cashVoucherRepository.create(tx, tenantId, actorId, {
        voucherNo,
        direction: dto.direction,
        incomeExpenseTypeCode: dto.incomeExpenseTypeCode,
        cashAccountId: dto.cashAccountId,
        paymentMethodCode: dto.paymentMethodCode,
        amount: BigInt(dto.amount),
        occurredAt,
        partnerName: dto.partnerName ?? null,
        description: dto.description,
        note: dto.note ?? null,
        status,
        cashierShiftId,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cash_voucher.created',
        entityType: 'cash_voucher',
        entityId: row.id,
        afterJson: { voucherNo, direction: dto.direction, amount: dto.amount, status },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return row;
    });

    return this.toDto(tenantId, created);
  }

  async getById(tenantId: string, dataScope: DataScope, actorId: string, id: string): Promise<CashVoucherDto> {
    const row = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.cashVoucherRepository.findByIdAny(tx, tenantId, id));
    if (!row || (dataScope === 'personal' && row.createdBy !== actorId)) {
      throw new NotFoundException();
    }
    return this.toDto(tenantId, row);
  }

  async list(tenantId: string, query: ListCashVouchersQuery): Promise<ListCashVouchersResponse> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.cashVoucherRepository.list(tx, tenantId, {
        from: query.from ? new Date(`${query.from}T00:00:00+07:00`) : undefined,
        to: query.to ? new Date(`${query.to}T23:59:59.999+07:00`) : undefined,
        direction: query.direction,
        status: query.status,
        cashierShiftId: query.cashierShiftId,
      }),
    );

    let totalIncomeAmount = 0;
    let totalExpenseAmount = 0;
    let pendingApprovalCount = 0;
    for (const row of rows) {
      if (row.deletedAt) continue; // Phiếu đã huỷ vẫn HIỆN trong `items` (xem findByIdAny/list) nhưng không tính vào tổng kết.
      if (row.status === 'PENDING_APPROVAL') pendingApprovalCount += 1;
      if (row.status !== 'POSTED') continue;
      if (row.direction === 'INCOME') totalIncomeAmount += Number(row.amount);
      else totalExpenseAmount += Number(row.amount);
    }

    const items = await this.toDtoList(tenantId, rows);
    return { items, totalIncomeAmount, totalExpenseAmount, pendingApprovalCount };
  }

  async update(tenantId: string, dataScope: DataScope, actorId: string, id: string, dto: UpdateCashVoucherRequest, meta: RequestMeta): Promise<CashVoucherDto> {
    const existing = await this.findOwnedOrThrow(tenantId, dataScope, actorId, id);
    await this.assertEditable(tenantId, existing);

    const patch: UpdateCashVoucherData = {};
    if (dto.incomeExpenseTypeCode !== undefined) patch.incomeExpenseTypeCode = dto.incomeExpenseTypeCode;
    if (dto.cashAccountId !== undefined) patch.cashAccountId = dto.cashAccountId;
    if (dto.paymentMethodCode !== undefined) patch.paymentMethodCode = dto.paymentMethodCode;
    if (dto.amount !== undefined) patch.amount = BigInt(dto.amount);
    if (dto.occurredAt !== undefined) patch.occurredAt = new Date(dto.occurredAt);
    if (dto.partnerName !== undefined) patch.partnerName = dto.partnerName;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.note !== undefined) patch.note = dto.note;

    const updated = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.cashVoucherRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cash_voucher.updated',
        entityType: 'cash_voucher',
        entityId: id,
        afterJson: { ...patch, amount: patch.amount?.toString() },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.cashVoucherRepository.findById(tx, tenantId, id);
    });
    return this.toDto(tenantId, updated!);
  }

  async voidVoucher(tenantId: string, dataScope: DataScope, actorId: string, id: string, dto: VoidCashVoucherRequest, meta: RequestMeta): Promise<CashVoucherDto> {
    const existing = await this.findOwnedOrThrow(tenantId, dataScope, actorId, id);
    await this.assertEditable(tenantId, existing);

    const updated = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.cashVoucherRepository.voidById(tx, tenantId, id, dto.version, actorId, dto.reason);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cash_voucher.voided',
        entityType: 'cash_voucher',
        entityId: id,
        afterJson: { reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      // `findById` lọc `deletedAt: null` (vừa huỷ xong sẽ trả null) — dùng `findByIdAny` để đọc
      // lại đúng bản ghi vừa huỷ (voided=true), không tái tạo DTO thủ công.
      return this.cashVoucherRepository.findByIdAny(tx, tenantId, id);
    });
    return this.toDto(tenantId, updated!);
  }

  /** Chỉ `clinic_admin` (`cash_voucher.approve=global`) — không kiểm sở hữu. */
  async approve(tenantId: string, actorId: string, id: string, version: number, meta: RequestMeta): Promise<CashVoucherDto> {
    const existing = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.cashVoucherRepository.findById(tx, tenantId, id));
    if (!existing) {
      throw new NotFoundException();
    }
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new CashVoucherNotPendingApprovalError();
    }

    const updated = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.cashVoucherRepository.approve(tx, tenantId, id, version, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cash_voucher.approved',
        entityType: 'cash_voucher',
        entityId: id,
        beforeJson: { status: 'PENDING_APPROVAL' },
        afterJson: { status: 'POSTED' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.cashVoucherRepository.findById(tx, tenantId, id);
    });
    return this.toDto(tenantId, updated!);
  }

  async reject(tenantId: string, actorId: string, id: string, dto: RejectCashVoucherRequest, meta: RequestMeta): Promise<CashVoucherDto> {
    const existing = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.cashVoucherRepository.findById(tx, tenantId, id));
    if (!existing) {
      throw new NotFoundException();
    }
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new CashVoucherNotPendingApprovalError();
    }

    const updated = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.cashVoucherRepository.reject(tx, tenantId, id, dto.version, actorId, dto.reason);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cash_voucher.rejected',
        entityType: 'cash_voucher',
        entityId: id,
        beforeJson: { status: 'PENDING_APPROVAL' },
        afterJson: { status: 'REJECTED', reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.cashVoucherRepository.findById(tx, tenantId, id);
    });
    return this.toDto(tenantId, updated!);
  }

  async markPrinted(tenantId: string, dataScope: DataScope, actorId: string, id: string, meta: RequestMeta): Promise<CashVoucherDto> {
    const existing = await this.findOwnedOrThrow(tenantId, dataScope, actorId, id);
    const updated = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.cashVoucherRepository.markPrintedIfNotYet(tx, tenantId, id, actorId);
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cash_voucher.printed',
        entityType: 'cash_voucher',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.cashVoucherRepository.findById(tx, tenantId, id);
    });
    return this.toDto(tenantId, updated ?? existing);
  }

  private async findOwnedOrThrow(tenantId: string, dataScope: DataScope, actorId: string, id: string): Promise<CashVoucher> {
    const row = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.cashVoucherRepository.findById(tx, tenantId, id));
    if (!row || (dataScope === 'personal' && row.createdBy !== actorId)) {
      throw new NotFoundException();
    }
    return row;
  }

  /** Đã Từ chối → chỉ đọc (lập phiếu mới thay vì hồi sinh). Gắn ca đã chốt → khoá theo đúng
   * nguyên tắc "Chốt ca" tự khoá số liệu của chính nó sau khi CLOSED/APPROVED. */
  private async assertEditable(tenantId: string, voucher: CashVoucher): Promise<void> {
    if (voucher.status === 'REJECTED') {
      throw new CashVoucherNotEditableError();
    }
    if (voucher.cashierShiftId) {
      const open = await this.cashierShiftReader.isCashierShiftOpen(tenantId, voucher.cashierShiftId);
      if (!open) {
        throw new CashVoucherNotEditableError();
      }
    }
  }

  private async toDtoList(tenantId: string, rows: CashVoucher[]): Promise<CashVoucherDto[]> {
    const ids = new Set<string>();
    for (const row of rows) {
      ids.add(row.createdBy);
      if (row.approvedBy) ids.add(row.approvedBy);
    }
    const names = ids.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...ids]) : new Map<string, string>();
    return rows.map((row) => this.toDtoWithNames(row, names));
  }

  private async toDto(tenantId: string, row: CashVoucher): Promise<CashVoucherDto> {
    const ids = row.approvedBy ? [row.createdBy, row.approvedBy] : [row.createdBy];
    const names = await this.doctorDirectory.getUserFullNames(tenantId, ids);
    return this.toDtoWithNames(row, names);
  }

  private toDtoWithNames(row: CashVoucher, names: Map<string, string>): CashVoucherDto {
    return {
      id: row.id,
      voucherNo: row.voucherNo,
      direction: row.direction,
      incomeExpenseTypeCode: row.incomeExpenseTypeCode,
      cashAccountId: row.cashAccountId,
      paymentMethodCode: row.paymentMethodCode,
      amount: Number(row.amount),
      occurredAt: row.occurredAt.toISOString(),
      partnerName: row.partnerName,
      description: row.description,
      note: row.note,
      status: row.status,
      voided: row.deletedAt !== null,
      approvedByName: row.approvedBy ? (names.get(row.approvedBy) ?? 'Không rõ') : null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      createdByName: names.get(row.createdBy) ?? 'Không rõ',
      printedAt: row.printedAt?.toISOString() ?? null,
      version: row.version,
    };
  }
}
