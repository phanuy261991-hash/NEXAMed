import type { SpecimenCapColor } from '@nexamed/shared';

/**
 * Màu nắp ống (docs/DECISIONS.md #220) — gán cho loại Mẫu bệnh phẩm ở danh mục. `apps/web` KHÔNG import được GIÁ TRỊ từ `@nexamed/shared` (#073) nên bảng này PHẢN CHIẾU
 * `SPECIMEN_CAP_COLORS` ở `packages/shared`; `satisfies Record<SpecimenCapColor, …>` để typecheck bắt lệch khoá. `hex` chỉ để vẽ chấm màu nhận biết (không phải token giao diện).
 */
export const CAP_COLOR_META = {
  RED: { name: 'Đỏ', label: 'Nắp đỏ', hex: '#dc2626' },
  YELLOW: { name: 'Vàng (gel)', label: 'Nắp vàng', hex: '#eab308' },
  PURPLE: { name: 'Tím (EDTA)', label: 'Nắp tím', hex: '#7c3aed' },
  BLUE: { name: 'Xanh dương (citrat)', label: 'Nắp xanh dương', hex: '#38bdf8' },
  GREEN: { name: 'Xanh lá (heparin)', label: 'Nắp xanh lá', hex: '#16a34a' },
  GRAY: { name: 'Xám (fluorid)', label: 'Nắp xám', hex: '#9ca3af' },
  BLACK: { name: 'Đen', label: 'Nắp đen', hex: '#1f2937' },
  URINE: { name: 'Lọ / không nắp', label: 'Lọ không nắp', hex: '#facc15' },
} as const satisfies Record<SpecimenCapColor, { name: string; label: string; hex: string }>;

export const CAP_COLOR_ORDER = ['RED', 'YELLOW', 'PURPLE', 'BLUE', 'GREEN', 'GRAY', 'BLACK', 'URINE'] as const satisfies readonly SpecimenCapColor[];

/** Chấm tròn màu nắp ống; không có màu → vòng viền xám (chưa khai). */
export function CapColorDot({ color, size = 14 }: { color: SpecimenCapColor | null; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block flex-none rounded-full border border-slate-900/25"
      style={{ width: size, height: size, backgroundColor: color ? CAP_COLOR_META[color].hex : 'transparent', borderStyle: color ? 'solid' : 'dashed' }}
    />
  );
}
