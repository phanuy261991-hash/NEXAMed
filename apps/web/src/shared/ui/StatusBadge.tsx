import type { ReactNode } from 'react';

/**
 * Badge trạng thái nền đặc + chữ trắng đậm — đúng token "Tín hiệu Y tế" đã chốt ở
 * `.claude/docs/ui-guidelines.md` mục 2.1 (`bg-emerald-500`/`bg-amber-500`/`bg-rose-600`, vô hiệu
 * `bg-slate-300`), thay kiểu nhạt (`bg-*-50 text-*-700`) từng dùng rải rác không đúng token. Chốt
 * 2026-09-03 sau phản hồi trực tiếp của chủ dự án (badge "Đang hoạt động" nhợt nhạt khó đọc).
 * `info` (xanh dương đặc) dùng cho cờ cấu hình có/không (không thuộc 4 tín hiệu y tế gốc).
 */
const TONE_CLASSES = {
  success: 'bg-emerald-500 text-white',
  warning: 'bg-amber-500 text-white',
  danger: 'bg-rose-600 text-white',
  neutral: 'bg-slate-300 text-slate-600',
  info: 'bg-blue-600 text-white',
  /** Không thuộc 4 "Tín hiệu Y tế" gốc — dùng cho trạng thái đặc thù cần tách màu riêng (ví dụ phiếu thu "Đã hoàn tiền"). */
  accent: 'bg-violet-500 text-white',
} as const;

export type StatusBadgeTone = keyof typeof TONE_CLASSES;

export function StatusBadge({ tone, children }: { tone: StatusBadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
