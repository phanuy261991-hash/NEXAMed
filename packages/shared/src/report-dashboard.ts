import { z } from 'zod';

/**
 * Trang Tổng quan (docs/DECISIONS.md #279, `docs/product/reporting-plan.md`, mockup đã chốt 02/11/2026). Máy chủ tính MỌI số, web chỉ hiển thị — không tính lại tiền ở trình duyệt.
 * Ngày luôn là `YYYY-MM-DD` theo lịch Việt Nam; tiền là số nguyên đồng; thời điểm là ISO UTC.
 */

/** Kỳ của Trang Tổng quan: hôm nay / 7 ngày gần nhất (gồm hôm nay) / tháng này (từ mùng 1 đến hôm nay). */
export const dashboardPeriodKindSchema = z.enum(['today', 'week', 'month']);
export type DashboardPeriodKind = z.infer<typeof dashboardPeriodKindSchema>;

export const ownerDashboardQuerySchema = z.object({ period: dashboardPeriodKindSchema.default('today') });
export type OwnerDashboardQuery = z.infer<typeof ownerDashboardQuerySchema>;

export const dashboardPeriodSchema = z.object({
  kind: dashboardPeriodKindSchema,
  from: z.string(),
  to: z.string(),
  /** Kỳ so sánh: hôm qua / 7 ngày liền trước / cùng khoảng ngày của tháng trước. */
  compareFrom: z.string(),
  compareTo: z.string(),
});
export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;

/** Một chỉ số kèm số kỳ trước và chuỗi 7 ngày gần nhất (đường nhỏ dưới số). */
export const dashboardKpiSchema = z.object({
  value: z.number(),
  previous: z.number(),
  /** `value − previous`. */
  diff: z.number(),
  /** Phần trăm so với kỳ trước; `null` khi kỳ trước bằng 0. */
  diffPercent: z.number().nullable(),
  direction: z.enum(['up', 'down', 'flat']),
  /** 7 ngày kết thúc hôm nay, cũ → mới (không phụ thuộc kỳ đang chọn). */
  series: z.array(z.number()),
});
export type DashboardKpi = z.infer<typeof dashboardKpiSchema>;

export const revenueGroupSchema = z.enum(['EXAM', 'PARACLINICAL', 'DRUG', 'PACKAGE']);

export const ownerDashboardSchema = z.object({
  /** Thời điểm chụp số (ISO UTC) — web ghi "Số lúc HH:MM". */
  generatedAt: z.string(),
  period: dashboardPeriodSchema,
  /** Lượt khám đã tiếp nhận (đang chờ, đang khám, đã xong) theo ngày tiếp nhận. */
  encounters: dashboardKpiSchema,
  /** Thực thu = tiền đã thu trừ đã hoàn, theo NGÀY THU. */
  collected: dashboardKpiSchema,
  /** Bệnh nhân khám lần đầu (lượt khám đầu tiên trong đời của bệnh nhân rơi vào kỳ). */
  newPatients: dashboardKpiSchema.extend({ shareOfEncountersPercent: z.number() }),
  /** Phiếu thu chưa thanh toán của các lượt khám trong kỳ. */
  pending: z.object({ invoiceCount: z.number(), amount: z.number(), series: z.array(z.number()) }),
  /** Lượt khám theo giờ trong kỳ (đủ 24 giờ, giờ VN). */
  hourly: z.array(z.object({ hour: z.number(), count: z.number() })),
  /** Thực thu theo nhóm, chia theo tỉ trọng các dòng của từng phiếu. */
  collectedByGroup: z.array(z.object({ group: revenueGroupSchema, amount: z.number(), percent: z.number() })),
  /** Thực thu từng ngày trong 7 ngày gần nhất. */
  collectedDaily: z.array(z.object({ date: z.string(), amount: z.number() })),
  needsAttention: z.object({
    unpaidInvoices: z.object({ count: z.number(), amount: z.number() }),
    openShifts: z.array(z.object({ label: z.string(), openedAt: z.string() })),
    expiringBatches: z.object({ count: z.number(), withinDays: z.number() }),
    belowMinStockItems: z.object({ count: z.number() }),
  }),
  /** Dịch vụ dùng nhiều nhất trong kỳ (đếm theo DÒNG chỉ định/dịch vụ trên phiếu thu), không gồm thuốc. */
  topServices: z.object({
    items: z.array(z.object({ name: z.string(), count: z.number(), amount: z.number() })),
    totalCount: z.number(),
    totalAmount: z.number(),
    /** Tỉ trọng của nhóm hàng đầu trong tổng giá trị dịch vụ của kỳ. */
    shareOfServiceAmountPercent: z.number(),
  }),
  /** Hàng đợi tại thời điểm chụp số (hôm nay, theo bác sĩ). */
  queue: z.object({
    rows: z.array(
      z.object({
        doctorName: z.string().nullable(),
        roomName: z.string().nullable(),
        inProgress: z.number(),
        waiting: z.number(),
        longestWaitMinutes: z.number().nullable(),
      }),
    ),
    totalInProgress: z.number(),
    totalWaiting: z.number(),
    longestWaitMinutes: z.number().nullable(),
    doctorsInProgress: z.number(),
  }),
});
export type OwnerDashboard = z.infer<typeof ownerDashboardSchema>;

/**
 * Trang Tổng quan của THU NGÂN (docs/DECISIONS.md #283, mockup "Thu ngân" đã chốt 02/11/2026). Chỉ NGÀY HÔM NAY của chi nhánh đang làm việc (không chọn kỳ).
 * Khối "ca đang mở / tiền mặt dự kiến trong két" KHÔNG nằm ở đây: web dùng lại endpoint Chốt ca sẵn có (`/cashier-shifts/current` + `/summary`) để không nhân đôi công thức két.
 */
export const cashierDashboardSchema = z.object({
  /** Thời điểm chụp số (ISO UTC) — web ghi "Số lúc HH:MM". */
  generatedAt: z.string(),
  /** Ngày báo cáo `YYYY-MM-DD` (giờ VN). */
  date: z.string(),
  /** Phiếu thu chưa thanh toán của các lượt khám tiếp nhận hôm nay, `dueAmount` sau chiết khấu. `items` chỉ gồm các phiếu đầu danh sách (cũ trước); `moreCount` là số phiếu còn lại. */
  pending: z.object({
    invoiceCount: z.number(),
    amount: z.number(),
    items: z.array(
      z.object({
        invoiceId: z.string(),
        encounterId: z.string(),
        invoiceNo: z.string(),
        invoiceType: z.enum(['SERVICE', 'DRUG', 'PARACLINICAL']),
        patientName: z.string(),
        /** Tóm tắt dịch vụ trên phiếu ("Khám nội, Công thức máu +1"). */
        summary: z.string(),
        dueAmount: z.number(),
      }),
    ),
    moreCount: z.number(),
  }),
  /** Tiền ĐÃ THU trong ngày (theo ngày thu, chưa trừ hoàn) và số phiếu có thu. */
  collected: z.object({ invoiceCount: z.number(), amount: z.number() }),
  /** Tiền ĐÃ HOÀN trong ngày và số phiếu có hoàn. */
  refunded: z.object({ invoiceCount: z.number(), amount: z.number() }),
  /** Thực thu = đã thu − đã hoàn. */
  net: z.number(),
  /** Đã thu theo phương thức (chưa trừ hoàn); tổng khớp `collected.amount`. */
  byMethod: z.array(z.object({ methodCode: z.string(), methodName: z.string(), amount: z.number(), paymentCount: z.number() })),
  /** Thực thu ròng theo giờ thu (đủ 24 giờ, giờ VN). */
  hourly: z.array(z.object({ hour: z.number(), amount: z.number() })),
});
export type CashierDashboard = z.infer<typeof cashierDashboardSchema>;

/**
 * Trang Tổng quan của LỄ TÂN (docs/DECISIONS.md #279/#284, mockup "Lễ tân" hướng B đã chốt 04/11/2026). Chỉ NGÀY HÔM NAY của chi nhánh đang làm việc; máy chủ tính mọi số.
 * "Lịch hẹn hôm nay" = lịch đang hiệu lực (chưa đến hoặc đã chuyển khám), không tính huỷ/không đến/đã dời.
 */
export const receptionDashboardSchema = z.object({
  generatedAt: z.string(),
  /** Ngày báo cáo `YYYY-MM-DD` (giờ VN). */
  date: z.string(),
  /** Lịch hẹn hôm nay: tổng, đã đến (đã chuyển thành lượt khám), chưa đến. */
  appointments: z.object({ total: z.number(), arrived: z.number(), notArrived: z.number() }),
  /** Lượt khám đang chờ bác sĩ (đã tiếp nhận, chưa vào khám). */
  waiting: z.number(),
  /** Lượt khám hôm nay theo Loại tiếp nhận: khám mới (RT_NEW) và tái khám (RT_RETURN). */
  reception: z.object({ newCount: z.number(), returnCount: z.number() }),
  /** Bác sĩ có đơn nghỉ đã duyệt hôm nay mà còn lịch hẹn chưa đến trùng giờ nghỉ (cần đổi bác sĩ). `startMinute`/`endMinute` là phút trong ngày giờ VN. */
  leaveAlerts: z.array(z.object({ doctorName: z.string(), startMinute: z.number(), endMinute: z.number(), appointmentCount: z.number() })),
  /** Lịch hẹn chưa đến, từ 30 phút trước giờ hiện tại trở đi; `items` là các lịch đầu danh sách, `moreCount` là số còn lại. */
  upcoming: z.object({
    items: z.array(
      z.object({
        appointmentId: z.string(),
        scheduledAt: z.string(),
        patientName: z.string(),
        /** Tuổi (năm) nếu lịch gắn với hồ sơ bệnh nhân; `null` nếu chưa có hồ sơ. */
        age: z.number().nullable(),
        doctorName: z.string(),
        doctorOnLeave: z.boolean(),
      }),
    ),
    moreCount: z.number(),
  }),
  /** Lịch hẹn theo giờ hẹn (đủ 24 giờ, giờ VN), tách đã đến / chưa đến. */
  hourly: z.array(z.object({ hour: z.number(), arrived: z.number(), notArrived: z.number() })),
  /** Hàng đợi hôm nay theo bác sĩ (cùng nguồn với Tổng quan chủ phòng khám). */
  queue: z.object({
    rows: z.array(z.object({ doctorName: z.string().nullable(), roomName: z.string().nullable(), inProgress: z.number(), waiting: z.number() })),
    totalInProgress: z.number(),
    totalWaiting: z.number(),
  }),
  /** Hẹn tái khám (kế hoạch điều trị đã ký có hướng "Hẹn tái khám"): đến hạn hôm nay, trong đó đã quay lại; quá hạn (trong `overdueWithinDays` ngày gần nhất) chưa quay lại. */
  followUp: z.object({ dueToday: z.number(), arrivedToday: z.number(), overdueNotArrived: z.number(), overdueWithinDays: z.number() }),
});
export type ReceptionDashboard = z.infer<typeof receptionDashboardSchema>;

/**
 * Trang Tổng quan của BÁC SĨ (docs/DECISIONS.md #286, mockup hướng B đã chốt 04/11/2026). Chỉ HÔM NAY, chỉ lượt khám do CHÍNH bác sĩ đang đăng nhập khám, ở chi nhánh đang làm việc.
 * Khối "ca chưa đóng" KHÔNG nằm ở đây: web dùng lại `GET /doctor-availability/me/closing-state` sẵn có. Số tiền (`revenue`) chỉ có khi phòng khám bật "Hiện doanh thu sinh ra trên Tổng quan bác sĩ".
 */
export const doctorDashboardSchema = z.object({
  /** Thời điểm chụp số (ISO UTC) — web ghi "Số lúc HH:MM". */
  generatedAt: z.string(),
  /** Ngày báo cáo `YYYY-MM-DD` (giờ VN). */
  date: z.string(),
  /** Lượt khám đã tiếp nhận của tôi hôm nay (đang chờ, đang khám, đã xong); `averagePerDay` = trung bình các ngày CÓ khám trong 7 ngày trước, `null` khi chưa có ngày nào. */
  total: z.object({ count: z.number(), averagePerDay: z.number().nullable() }),
  /** Đang chờ tôi + người chờ lâu nhất (phút). */
  waiting: z.object({ count: z.number(), longestWaitMinutes: z.number().nullable() }),
  /** Đang khám: số lượt, bệnh nhân đầu tiên và số phút đã khám. */
  inProgress: z.object({ count: z.number(), patientName: z.string().nullable(), minutes: z.number().nullable() }),
  /** Đã xong + thời gian khám trung bình (phút, từ lúc bắt đầu đến lúc hoàn tất). */
  done: z.object({ count: z.number(), averageMinutes: z.number().nullable() }),
  /** Bệnh nhân đang chờ tôi, người chờ lâu nhất đứng đầu. */
  waitingList: z.object({
    items: z.array(z.object({ encounterId: z.string().uuid(), patientName: z.string(), patientCode: z.string(), age: z.number().nullable(), waitMinutes: z.number() })),
    moreCount: z.number(),
  }),
  /** Hàng chờ chung của cùng Khoa: lượt chưa có bác sĩ mà tôi nhận được ("Nhận ca"). */
  commonQueue: z.object({ count: z.number() }),
  /** Kết quả cận lâm sàng đã duyệt mà tôi chưa xem. */
  unseenResults: z.object({
    count: z.number(),
    /** `abnormalCount` = số chỉ số xét nghiệm cao/thấp/bất thường của kết quả đã ký (0 với CĐHA/thăm dò hoặc khi chưa so được khoảng tham chiếu). */
    items: z.array(z.object({ name: z.string(), patientName: z.string(), resultedAt: z.string(), abnormalCount: z.number().int().nonnegative() })),
    moreCount: z.number(),
  }),
  /** Lượt khám của tôi theo giờ nhận (đủ 24 giờ, giờ VN). */
  hourly: z.array(z.object({ hour: z.number(), count: z.number() })),
  /** Hẹn tái khám của tôi: cùng định nghĩa với Tổng quan lễ tân nhưng chỉ lượt khám tôi khám. */
  followUp: z.object({ dueToday: z.number(), arrivedToday: z.number(), overdueNotArrived: z.number(), overdueWithinDays: z.number() }),
  /** Doanh thu sinh ra hôm nay (tiền sau chiết khấu của phiếu thu các lượt khám của tôi, gồm phiếu chưa thu, không gồm phiếu đã huỷ/hoàn). `null` khi phòng khám không bật hiển thị tiền. */
  revenue: z.object({ amount: z.number() }).nullable(),
});
export type DoctorDashboard = z.infer<typeof doctorDashboardSchema>;
