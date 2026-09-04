/**
 * "Đóng ca hôm nay" — popup tổng hợp ca khám trong ngày cho bác sĩ xác nhận trước khi đóng ca
 * (mockup duyệt qua nhiều vòng trước khi code). Repository chỉ trả dữ liệu THÔ (đếm sẵn qua SQL +
 * mảng khoảng thời gian khám); hàm thuần ở đây chỉ lo phần có "luật tính" thật sự — làm tròn thời
 * gian khám trung bình, và xử lý trường hợp chưa có ca nào hoàn tất hôm nay (trả `null`, không phải
 * `0` hay `NaN`, để UI hiện "—" thay vì con số gây hiểu lầm).
 */
export interface ShiftSummaryRawCounts {
  calledCount: number;
  completedCount: number;
  cancelledCount: number;
  prescriptionCount: number;
  /** Khoảng cách `completedAt - startedAt` (mili-giây) của từng ca đã hoàn tất hôm nay. */
  completedDurationsMs: number[];
}

export interface ShiftSummary {
  calledCount: number;
  completedCount: number;
  avgConsultMinutes: number | null;
  cancelledCount: number;
  prescriptionCount: number;
}

export function computeShiftSummary(raw: ShiftSummaryRawCounts): ShiftSummary {
  const avgConsultMinutes =
    raw.completedDurationsMs.length === 0
      ? null
      : Math.round(raw.completedDurationsMs.reduce((sum, ms) => sum + ms, 0) / raw.completedDurationsMs.length / 60_000);
  return {
    calledCount: raw.calledCount,
    completedCount: raw.completedCount,
    avgConsultMinutes,
    cancelledCount: raw.cancelledCount,
    prescriptionCount: raw.prescriptionCount,
  };
}
