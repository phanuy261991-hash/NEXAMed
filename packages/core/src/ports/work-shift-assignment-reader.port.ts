/** Khớp `workShiftColorSchema` ở `packages/shared/src/work-shift.ts` — định nghĩa lại cục bộ
 * (không import `packages/shared` vào `packages/core`, giữ đúng chiều phụ thuộc
 * `.claude/docs/project-structure.md`), cùng cách `DayHours`/`WeeklyBusinessHours` ở
 * `clinic-config-reader.port.ts` đã làm. */
export type PortWorkShiftColor = 'blue' | 'teal' | 'emerald' | 'amber' | 'rose' | 'purple' | 'cyan' | 'slate';

/**
 * Đọc ca làm việc đã đăng ký của bác sĩ theo ngày — dữ liệu thuộc module `work-shift-assignment`
 * ("Đăng ký ca làm việc" Giai đoạn 2 của #101). Module `appointment` đọc qua port này (không import
 * thẳng module khác, .claude/docs/coding-standards.md mục "Ranh giới module") cho 2 việc: (1) lưới
 * Lịch hẹn hiện dải màu ca + gạch chéo ngoài ca theo từng cột bác sĩ, (2) chặn đặt lịch ngoài ca khi
 * `ClinicSettings.blockBookingOutsideWorkShiftEnabled=true`.
 */
export interface WorkShiftAssignmentReaderPort {
  /**
   * Key = `userId` — chỉ trả những người CÓ ít nhất 1 ca đăng ký đúng ngày đó (không có key = chưa
   * đăng ký ca nào, caller tự hiểu là "không giới hạn"). Nhận nhiều `userIds` một lần để tránh N+1
   * khi lưới Lịch hẹn cần dữ liệu của toàn bộ bác sĩ hiển thị cùng lúc.
   */
  getWorkShiftsForUsersOnDate(
    tenantId: string,
    userIds: string[],
    date: string,
  ): Promise<Record<string, Array<{ name: string; color: PortWorkShiftColor; startTime: string; endTime: string }>>>;
}

export const WORK_SHIFT_ASSIGNMENT_READER_PORT = Symbol('WORK_SHIFT_ASSIGNMENT_READER_PORT');
