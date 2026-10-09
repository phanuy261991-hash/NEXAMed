import { Injectable } from '@nestjs/common';
import { isWholeDayLeaveWindow, type LeaveReaderPort, type LeaveWindowRecord } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { LeaveRequestRepository } from '../../modules/leave-request/leave-request.repository';

/**
 * Adapter thật cho `LeaveReaderPort` ("Đơn xin nghỉ", #224) — chỉ đọc, tự mở transaction riêng qua
 * `UnitOfWorkService` (port chỉ nhận `tenantId`, cùng khuôn `ParaclinicalProgressReaderAdapter`).
 * Đăng ký ở `LeaveReaderModule` (`@Global()`).
 */
@Injectable()
export class LeaveReaderAdapter implements LeaveReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: LeaveRequestRepository,
  ) {}

  async getLeaveInRange(tenantId: string, userIds: string[], fromDate: string, toDate: string): Promise<LeaveWindowRecord[]> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.repository.listActiveInRange(tx, tenantId, userIds, fromDate, toDate),
    );
    return rows.map((r) => ({
      leaveRequestId: r.id,
      userId: r.userId,
      date: r.leaveDate.toISOString().slice(0, 10),
      status: r.status as LeaveWindowRecord['status'],
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      isWholeDay: isWholeDayLeaveWindow({ startMinute: r.startMinute, endMinute: r.endMinute }),
      workShiftName: r.workShift?.name ?? null,
    }));
  }
}
