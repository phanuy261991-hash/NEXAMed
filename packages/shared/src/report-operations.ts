import { z } from 'zod';
import { withReportScope } from './branch';

/**
 * Nhóm báo cáo "Khám bệnh và vận hành" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): giờ cao điểm, thời gian chờ, huỷ và không đến, tái khám, nguồn đặt lịch
 * (cùng trang với Sổ khám bệnh, `report-visit-book.ts`). Quyền xem: `operations_report.read` (mặc định chỉ quản lý phòng khám). Máy chủ tính mọi số, web chỉ hiển thị.
 * Ngày `YYYY-MM-DD` theo lịch Việt Nam; phạm vi chi nhánh dùng chung bộ chọn của các báo cáo tổng hợp (#235). Thứ theo ISO: 1 = Thứ Hai ... 7 = Chủ nhật.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const operationsPeriodQuerySchema = withReportScope({ from: isoDate, to: isoDate });
export type OperationsPeriodQuery = z.infer<typeof operationsPeriodQuerySchema>;

/** Phần đầu chung của mọi báo cáo trong nhóm. */
const headerFields = {
  /** Thời điểm chụp số (ISO UTC) — web ghi "Số lúc HH:MM". */
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  /** Số chi nhánh trong phạm vi đã đọc. */
  branchCount: z.number().int(),
};

const count = z.number().int();
const percent = z.number().nullable();

export const waitingSummarySchema = z.object({
  measuredCount: count,
  averageMinutes: z.number().int().nullable(),
  over30Count: count,
  over30Percent: percent,
  slots: z.array(z.object({ label: z.string(), visits: count, averageMinutes: z.number().int().nullable(), over30Percent: percent })),
  distribution: z.array(z.object({ label: z.string(), count, percent: z.number() })),
});
export type WaitingSummaryDto = z.infer<typeof waitingSummarySchema>;

/** Giờ cao điểm: bản đồ nhiệt thứ × giờ tiếp nhận + thời gian chờ theo khung giờ và phân bố. */
export const peakHoursReportSchema = z.object({
  ...headerFields,
  hours: z.array(z.number().int()),
  days: z.array(z.object({ isoDow: z.number().int(), counts: z.array(count), total: count })),
  totalVisits: count,
  peak: z.object({ isoDow: z.number().int(), hour: z.number().int(), count }).nullable(),
  quietestDay: z.object({ isoDow: z.number().int(), total: count }).nullable(),
  waiting: waitingSummarySchema,
});
export type PeakHoursReport = z.infer<typeof peakHoursReportSchema>;

const waitGroupSchema = z.object({ visits: count, averageMinutes: z.number().int().nullable(), over30Count: count, over30Percent: percent });

/** Thời gian chờ từ tiếp nhận đến vào khám, theo bác sĩ và theo ngày. */
export const waitingReportSchema = z.object({
  ...headerFields,
  summary: waitingSummarySchema,
  /** Lượt chờ lâu nhất (phút); `null` khi chưa đo được lượt nào. */
  maxMinutes: z.number().int().nullable(),
  byDoctor: z.array(waitGroupSchema.extend({ doctorId: z.string().uuid().nullable(), doctorName: z.string() })),
  byDay: z.array(waitGroupSchema.extend({ date: isoDate })),
});
export type WaitingReport = z.infer<typeof waitingReportSchema>;

const cancelCountsSchema = z.object({ encounterCancelled: count, encounterNoShow: count, appointmentCancelled: count, appointmentNoShow: count });

/** Huỷ và không đến: lượt khám (`encounter`) và lịch hẹn (`appointment`) tách riêng. */
export const cancellationReportSchema = z.object({
  ...headerFields,
  encounters: z.object({ total: count, cancelled: count, noShow: count }),
  appointments: z.object({ total: count, cancelled: count, noShow: count, rescheduled: count }),
  reasons: z.array(z.object({ reason: z.string(), encounterCount: count, appointmentCount: count })),
  byDoctor: z.array(cancelCountsSchema.extend({ doctorId: z.string().uuid().nullable(), doctorName: z.string() })),
  byDay: z.array(cancelCountsSchema.extend({ date: isoDate })),
});
export type CancellationReport = z.infer<typeof cancellationReportSchema>;

/** Tái khám: hẹn có ngày hẹn trong kỳ — đã hẹn, đã đến, quá hạn chưa đến, còn chờ; kèm nhật ký nhắc. */
export const followUpReportSchema = z.object({
  ...headerFields,
  summary: z.object({
    total: count,
    arrived: count,
    overdue: count,
    pending: count,
    /** Hẹn đã ghi "Bệnh nhân không tái khám" (không tính vào `total`). */
    notReturning: count,
    arrivalPercent: percent,
  }),
  byDoctor: z.array(z.object({ doctorId: z.string().uuid().nullable(), doctorName: z.string(), total: count, arrived: count, overdue: count, pending: count, arrivalPercent: percent })),
  /** Số lần nhắc trong kỳ theo kết quả (mã kết quả của nhật ký nhắc). */
  reminders: z.array(z.object({ result: z.string(), count })),
});
export type FollowUpReport = z.infer<typeof followUpReportSchema>;

/** Nguồn đặt lịch: lịch hẹn có ngày hẹn trong kỳ, theo nguồn đặt. */
export const bookingSourceReportSchema = z.object({
  ...headerFields,
  total: count,
  arrived: count,
  arrivalPercent: percent,
  topSource: z.string().nullable(),
  sources: z.array(z.object({ source: z.string(), total: count, arrived: count, pending: count, cancelled: count, noShow: count, rescheduled: count, arrivalPercent: percent })),
});
export type BookingSourceReport = z.infer<typeof bookingSourceReportSchema>;
