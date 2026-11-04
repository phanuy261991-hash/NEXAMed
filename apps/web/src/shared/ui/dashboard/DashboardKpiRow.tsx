import { ArrowDown, ArrowUp } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { Sparkline } from '../charts/Sparkline';

export type DashboardKpiTone = 'amber' | 'emerald' | 'rose' | 'blue' | 'violet';

const CHIP_CLASS: Record<DashboardKpiTone, string> = {
  amber: 'bg-amber-100 text-amber-600',
  emerald: 'bg-emerald-100 text-emerald-600',
  rose: 'bg-rose-100 text-rose-600',
  blue: 'bg-blue-100 text-blue-600',
  violet: 'bg-violet-100 text-violet-600',
};

const SPARKLINE_COLOR: Record<DashboardKpiTone, string> = {
  amber: '#f59e0b',
  emerald: '#10b981',
  rose: '#f43f5e',
  blue: '#2563eb',
  violet: '#8b5cf6',
};

const DELTA_CLASS = { good: 'text-emerald-700', bad: 'text-rose-700', neutral: 'text-slate-500' } as const;

export interface DashboardKpiItem {
  icon: Icon;
  tone: DashboardKpiTone;
  label: string;
  value: string;
  /** Ô "chốt hạ" của dải (thường là Thực thu): nền xanh đặc, chữ trắng. */
  solid?: boolean;
  /** Dòng so sánh với kỳ trước; màu theo tốt/xấu/trung tính do nơi gọi quyết định. Ô `solid` hiện chữ trắng. */
  delta?: { direction: 'up' | 'down' | 'flat'; text: string; tone: 'good' | 'bad' | 'neutral' };
  /** Đường nhỏ diễn biến vài ngày bên phải con số; `label` đọc cho trình đọc màn hình. */
  trend?: { values: readonly number[]; label: string };
}

/**
 * Dải KPI của trang Tổng quan (docs/DECISIONS.md #283, hướng B): mỗi chỉ số một khối trắng bo góc với ô biểu tượng màu nhạt, số lớn không tô màu; riêng ô `solid` nền xanh đặc.
 * Chỉ dùng cho trang Tổng quan — trang khác dùng `StatCardRow` (kiểu dải liền cũ).
 */
export function DashboardKpiRow({ items }: { items: DashboardKpiItem[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      {items.map((item) => (
        <div key={item.label} className={`min-w-0 rounded-2xl px-5 py-5 ${item.solid ? 'bg-blue-600 text-white' : 'bg-white text-slate-900'}`}>
          <div className="flex items-center gap-2.5">
            <span className={`flex size-8 flex-none items-center justify-center rounded-[10px] ${item.solid ? 'bg-white/20 text-white' : CHIP_CLASS[item.tone]}`}>
              <item.icon size={17} weight="bold" aria-hidden="true" />
            </span>
            <span className={`min-w-0 truncate text-sm ${item.solid ? 'text-blue-100' : 'text-slate-500'}`}>{item.label}</span>
          </div>
          <div className="mt-3.5 flex items-end justify-between gap-2">
            <span className="text-[32px] font-semibold leading-none tracking-tight tabular-nums">{item.value}</span>
            {item.trend && <Sparkline values={item.trend.values} color={item.solid ? '#ffffff' : SPARKLINE_COLOR[item.tone]} ariaLabel={item.trend.label} />}
          </div>
          {item.delta && (
            <span className={`mt-2.5 flex items-center gap-1 text-[13px] font-medium ${item.solid ? 'text-blue-100' : DELTA_CLASS[item.delta.tone]}`}>
              {item.delta.direction === 'up' && <ArrowUp size={12} weight="bold" aria-hidden="true" />}
              {item.delta.direction === 'down' && <ArrowDown size={12} weight="bold" aria-hidden="true" />}
              {item.delta.text}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
