/**
 * Chữ cái loại đơn thuốc theo Bộ Y tế (docs/DECISIONS.md #242, mockup đã chốt): ô vuông nhỏ nền đặc, chữ trắng — C thông thường (xám đậm), N gây nghiện (đỏ),
 * H hướng thần và tiền chất (hổ phách), Y y học cổ truyền (teal). Dùng ở màn kê đơn, bảng ánh xạ, danh sách đơn pháp lý, phát thuốc. Viết ở `shared/ui` vì dùng từ nhiều màn.
 */
export type PrescriptionKindLetter = 'C' | 'N' | 'H' | 'Y';

export const PRESCRIPTION_KIND_TEXT: Record<PrescriptionKindLetter, string> = {
  C: 'thông thường',
  N: 'gây nghiện',
  H: 'hướng thần',
  Y: 'y học cổ truyền',
};

const KIND_COLOR: Record<PrescriptionKindLetter, string> = {
  C: 'bg-slate-600',
  N: 'bg-rose-600',
  H: 'bg-amber-500',
  Y: 'bg-brand-teal',
};

export function PrescriptionKindChip({ kind, className = '' }: { kind: PrescriptionKindLetter; className?: string }) {
  return (
    <span
      title={`Đơn loại ${kind} — ${PRESCRIPTION_KIND_TEXT[kind]}`}
      aria-label={`Đơn loại ${kind}, ${PRESCRIPTION_KIND_TEXT[kind]}`}
      className={`inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded text-xs font-semibold text-white ${KIND_COLOR[kind]} ${className}`}
    >
      {kind}
    </span>
  );
}
