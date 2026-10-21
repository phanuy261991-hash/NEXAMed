import type { EncounterInsuranceBadge } from '@nexamed/shared';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { insuranceBadgeLabel } from './insurance-card-view';

/**
 * Nhãn BHYT cạnh tên bệnh nhân ở hàng đợi / danh sách tiếp nhận / đầu màn khám (S2-04, docs/DECISIONS.md #243, mockup màn 4): "BHYT 80%" nền xanh dương đặc
 * (cờ có/không, không phải tín hiệu y tế), "Tự chi trả" nền xám đặc. `badge` là `null` khi phòng khám chưa bật "Áp dụng BHYT" (máy chủ không trả) → không hiện gì.
 * `cardNo`: đầu màn khám kèm số thẻ để bác sĩ đối chiếu nhanh; hàng đợi chỉ hiện mức hưởng cho gọn.
 */
export function InsuranceBadge({ badge, cardNo }: { badge: EncounterInsuranceBadge | null | undefined; cardNo?: string | null }) {
  if (!badge) return null;
  const label = insuranceBadgeLabel(badge);
  return (
    <span className="inline-block align-middle">
      <StatusBadge tone={badge.selfPay ? 'neutral' : 'info'}>{!badge.selfPay && cardNo ? `${label} · ${cardNo}` : label}</StatusBadge>
    </span>
  );
}
