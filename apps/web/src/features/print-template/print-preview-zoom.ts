/** Các bậc thu/phóng của khung xem trước mẫu in (%). */
export const PREVIEW_ZOOM_STEPS = [30, 40, 50, 60, 75, 90, 100, 120];

/** 1 mm = 96/25,4 px (CSS). */
const MM_TO_PX = 96 / 25.4;

/**
 * Mức thu/phóng TỰ VỪA khổ giấy (%): bậc lớn nhất trong `PREVIEW_ZOOM_STEPS` mà tờ giấy (rộng `paperWidthMm`) còn nằm gọn trong
 * `availablePx` bề ngang khung xem. Không vượt `maxZoom` (mặc định theo khổ giấy) nên màn rộng vẫn giữ mức mặc định; khung quá
 * hẹp (hoặc chưa đo được) không xuống dưới bậc nhỏ nhất. Hàm thuần để dễ kiểm thử.
 */
export function fitPreviewZoom(availablePx: number, paperWidthMm: number, maxZoom: number, steps: readonly number[] = PREVIEW_ZOOM_STEPS): number {
  if (!(availablePx > 0) || !(paperWidthMm > 0)) return maxZoom;
  const exactPercent = (availablePx / (paperWidthMm * MM_TO_PX)) * 100;
  if (exactPercent >= maxZoom) return maxZoom;
  const fitting = steps.filter((s) => s <= exactPercent);
  return fitting[fitting.length - 1] ?? steps[0] ?? maxZoom;
}
