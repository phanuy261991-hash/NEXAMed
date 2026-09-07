import type { Icon } from '@phosphor-icons/react';

/**
 * Dải số liệu tổng kết (KPI row) dùng chung kiểu "Tổng thu/Tổng chi/Chênh lệch" — trích xuất từ
 * `CashVoucherListPage.tsx`/`CashFlowReportPage.tsx`/`CashBookPage.tsx` (trùng lặp lần 3, đúng
 * ngưỡng phải gộp theo `CLAUDE.md`).
 *
 * Redesign lần 2 (2026-09-07, chủ dự án phản hồi trực tiếp bản đầu "giống AI tạo quá") — bỏ hẳn
 * khuôn "mỗi số liệu 1 thẻ riêng + icon lồng vòng tròn nền màu + viền trái đậm màu" (khuôn rất phổ
 * biến ở UI do AI sinh ra, dễ nhận ra ngay). Đổi sang **1 dải liền khối, chia ngăn bằng đường kẻ
 * mảnh** (`divide-x`) — đúng cách phần mềm tài chính thật trình bày số liệu tổng kết (rà `/ui-ux-
 * pro-max` domain `style`, nhóm "Financial Dashboard": màu sắc gắn vào CHÍNH con số — lãi màu xanh/
 * lỗ màu đỏ — không phải trang trí quanh nó bằng thẻ/icon riêng). Icon giờ nhỏ, PHẲNG (không lồng
 * vòng tròn nền), đặt cạnh nhãn — chỉ đóng vai trò gợi ý ngữ nghĩa, không phải điểm nhấn thị giác.
 * `emphasis` (số liệu "chốt hạ" của dải — Chênh lệch/Số dư cuối kỳ) tạo phân cấp bằng CỠ CHỮ lớn
 * hơn một nấc, không phải màu nền/viền khác biệt.
 */
export type StatCardTone = 'emerald' | 'rose' | 'blue' | 'slate' | 'amber' | 'violet';

const TONE_ICON_CLASS: Record<StatCardTone, string> = {
  emerald: 'text-emerald-500',
  rose: 'text-rose-500',
  blue: 'text-blue-500',
  slate: 'text-slate-400',
  amber: 'text-amber-500',
  violet: 'text-violet-500',
};

/** Màu con số — chỉ 2 tín hiệu thật có ý nghĩa "tốt/xấu" (thu/chi); số liệu tổng hợp/trung tính
 * (Chênh lệch, Số dư) giữ `text-slate-900` — đúng cách bảng chứng từ trong CÙNG các trang này đã
 * tô màu cột Số tiền (`text-emerald-700`/`text-rose-700`), không bịa quy ước màu mới. */
const TONE_VALUE_CLASS: Record<StatCardTone, string> = {
  emerald: 'text-emerald-600',
  rose: 'text-rose-600',
  blue: 'text-slate-900',
  slate: 'text-slate-900',
  amber: 'text-amber-600',
  violet: 'text-violet-600',
};

export interface StatCardItem {
  icon: Icon;
  tone: StatCardTone;
  label: string;
  value: string;
  /** Số liệu "chốt hạ" của dải (ví dụ Chênh lệch/Số dư cuối kỳ) — cỡ chữ lớn hơn 1 nấc để nổi bật,
   * không đổi màu nền/viền. */
  emphasis?: boolean;
}

export function StatCardRow({ items }: { items: StatCardItem[] }) {
  return (
    <div className="flex flex-wrap items-stretch divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {items.map((item, index) => (
        <div key={index} className="flex min-w-[190px] flex-1 flex-col justify-center gap-1.5 px-5 py-4">
          <div className="flex items-center gap-1.5">
            <item.icon size={15} weight="bold" className={TONE_ICON_CLASS[item.tone]} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</span>
          </div>
          <span className={`tabular-nums font-bold leading-tight ${item.emphasis ? 'text-[26px]' : 'text-2xl'} ${TONE_VALUE_CLASS[item.tone]}`}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
