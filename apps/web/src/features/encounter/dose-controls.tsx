import { useState } from 'react';
import { doseToQuartersPreview, formatDoseAmountPreview, parseDoseInput } from './prescription-dose-preview';

/**
 * Các ô nhập liều dùng theo buổi có hỗ trợ liều LẺ (#241, mockup đã duyệt) — dùng chung cho màn kê đơn,
 * hộp "Sửa đơn" và trang "Đơn thuốc mẫu". Nhận/trả giá trị dạng CHUỖI SỐ THẬP PHÂN chuẩn ('' | '0.5' | '1') để
 * khớp `DraftLine` sẵn có; hiển thị dạng ½, 1½.
 */

/** Dãy liều gợi ý Sáng·Trưa·Chiều·Tối. Thuốc không chia được chỉ nhận các dãy số nguyên. */
export const DOSE_PATTERNS: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 0, 0],
  [1, 0, 0, 1],
  [1, 1, 0, 1],
  [1, 1, 1, 1],
  [0.5, 0, 0, 0.5],
  [0.5, 0.5, 0.5, 0.5],
];

function formatDoseText(value: string): string {
  if (value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? formatDoseAmountPreview(n) : value;
}

/** Ô liều một buổi: gõ `0,5` / `1/2` / `1 1/2` hoặc dán ½; Enter hoặc rời ô thì chốt, giá trị sai quay về giá trị cũ. */
export function DoseInput({
  id,
  label,
  value,
  onCommit,
  onFocus,
  disabled,
}: {
  id?: string;
  label: string;
  /** Chuỗi số thập phân chuẩn: '' (trống) | '0' | '0.5' | '1'... */
  value: string;
  onCommit: (next: string) => void;
  onFocus?: () => void;
  disabled?: boolean;
}) {
  // `null` = đang hiển thị giá trị đã chốt; chuỗi = người dùng đang gõ dở.
  const [editingText, setEditingText] = useState<string | null>(null);
  const shown = editingText ?? formatDoseText(value);
  // Giá trị đổi từ NGOÀI (nút chọn nhanh, pill liều, nạp mẫu) trong lúc ô đang mở sửa thì hiện giá trị mới, không giữ chữ gõ dở cũ.
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    if (editingText !== null) setEditingText(formatDoseText(value));
  }

  function commit() {
    if (editingText === null) return;
    const parsed = parseDoseInput(editingText);
    setEditingText(null);
    if (parsed === null) return;
    const next = parsed === '' ? '' : String(parsed);
    if (next !== value) onCommit(next);
  }

  return (
    <label className="flex flex-col gap-0.5 text-center text-xs font-semibold text-slate-600">
      {label}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={shown}
        disabled={disabled}
        onFocus={(e) => {
          setEditingText(shown);
          e.currentTarget.select();
          onFocus?.();
        }}
        onChange={(e) => setEditingText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="w-full border-0 border-b-2 border-slate-300 bg-transparent px-0 py-1 text-center text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none disabled:text-slate-400"
      />
    </label>
  );
}

const PILL_BASE = 'rounded-full border px-2.5 py-0.5 font-mono text-[13px] font-semibold tabular-nums transition-colors';
const PILL_IDLE = 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:bg-brand-teal-tint';
const PILL_ON = 'border-brand-teal bg-brand-teal text-white';

/** Dãy pill liều gợi ý — bấm điền 4 ô, bấm lại pill đang chọn thì xoá (`onPick(null)`). */
export function DosePatternPills({
  doses,
  splittable,
  disabled,
  onPick,
}: {
  /** 4 liều hiện tại (Sáng, Trưa, Chiều, Tối) dạng số. */
  doses: readonly [number, number, number, number];
  splittable: boolean;
  disabled?: boolean;
  onPick: (pattern: readonly [number, number, number, number] | null) => void;
}) {
  const hasAny = doses.some((d) => doseToQuartersPreview(d) > 0);
  const patterns = splittable ? DOSE_PATTERNS : DOSE_PATTERNS.filter((p) => p.every((d) => doseToQuartersPreview(d) % 4 === 0));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-xs font-semibold text-slate-500">Gợi ý liều (Sáng · Trưa · Chiều · Tối)</span>
      {patterns.map((p) => {
        const on = hasAny && p.every((d, i) => doseToQuartersPreview(d) === doseToQuartersPreview(doses[i]!));
        return (
          <button
            key={p.join('-')}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            aria-label={`Sáng ${formatDoseAmountPreview(p[0])}, Trưa ${formatDoseAmountPreview(p[1])}, Chiều ${formatDoseAmountPreview(p[2])}, Tối ${formatDoseAmountPreview(p[3])}`}
            onClick={() => onPick(on ? null : p)}
            className={`${PILL_BASE} ${on ? PILL_ON : PILL_IDLE} disabled:opacity-50`}
          >
            {p.map(formatDoseAmountPreview).join('·')}
          </button>
        );
      })}
    </div>
  );
}

const QUICK_CHIPS: readonly { label: string; value: number }[] = [
  { label: '¼', value: 0.25 },
  { label: '½', value: 0.5 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
];

/** Hàng nút chọn nhanh ¼ · ½ · 1 · 2 cho ô liều đang đứng (`onPick(null)` = xoá ô). */
export function DoseQuickChips({ onPick }: { onPick: (value: number | null) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-semibold text-slate-500">Điền nhanh</span>
      {QUICK_CHIPS.map((c) => (
        <button
          key={c.label}
          type="button"
          // Giữ focus ở ô liều đang nhập để chọn nhanh nhiều ô liên tiếp.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c.value)}
          className="min-w-10 rounded-md border border-slate-300 bg-white px-2.5 py-0.5 text-[13px] font-semibold text-slate-800 transition-colors hover:border-blue-400 hover:bg-brand-teal-tint"
        >
          {c.label}
        </button>
      ))}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(null)}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-0.5 text-[13px] font-semibold text-slate-600 transition-colors hover:border-rose-300 hover:text-rose-600"
      >
        Xoá
      </button>
    </div>
  );
}
