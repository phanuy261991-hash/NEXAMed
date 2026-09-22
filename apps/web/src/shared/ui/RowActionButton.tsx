import type { Icon } from '@phosphor-icons/react';

/**
 * Nút thao tác dạng icon tròn cho cột "Thao tác" trong bảng danh sách — thay cho chữ thuần
 * (`text-xs font-semibold ... hover:bg-...`) không đủ nổi bật, "giống 1 dòng dữ liệu" (chủ dự án
 * phản hồi trực tiếp 22/09/2026). Đặt ở `shared/ui` với chủ đích dùng chung ngay từ đầu cho MỌI
 * bảng danh sách trong app (đúng CLAUDE.md — không viết component riêng cho từng trang), khác
 * `Button` (quá lớn, `px-4 py-2`, không hợp hàng bảng cao 56-60px).
 */
type RowActionTone = 'neutral' | 'primary' | 'success' | 'danger' | 'amber';

const TONE_CLASSNAME: Record<RowActionTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
  primary: 'bg-blue-50 text-blue-600 hover:bg-blue-100',
  success: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100',
  danger: 'bg-rose-50 text-rose-600 hover:bg-rose-100',
  amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100',
};

export function RowActionButton({
  icon: IconComponent,
  label,
  tone = 'neutral',
  onClick,
  disabled,
  type = 'button',
}: {
  icon: Icon;
  /** Tên hành động — hiện dạng tooltip (`title`) lúc rê chuột VÀ đọc bằng screen reader
   * (`aria-label`), bắt buộc vì nút chỉ có icon, không có chữ. */
  label: string;
  tone?: RowActionTone;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${TONE_CLASSNAME[tone]}`}
    >
      <IconComponent size={14} weight="bold" aria-hidden="true" />
    </button>
  );
}
