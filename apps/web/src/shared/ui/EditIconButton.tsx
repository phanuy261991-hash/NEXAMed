import { PencilSimple } from '@phosphor-icons/react';

/**
 * Nút "Sửa" dạng icon-only (bút chì) — dùng cho khung cấu hình (Boxed Section) nhỏ gọn, nơi chữ
 * "Sửa" tốn diện tích không cần thiết. Tách ra dùng chung từ lần dùng thứ hai (`ClinicHoursPane.tsx`
 * có 2 khung độc lập, `AppointmentConfigPane.tsx` có 1 khung) — theo CLAUDE.md.
 */
export function EditIconButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title="Sửa"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <PencilSimple size={15} weight="regular" aria-hidden="true" />
    </button>
  );
}
