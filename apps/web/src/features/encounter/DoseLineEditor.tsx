import { useState, type ReactNode } from 'react';
import type { DoseMode, DrugSummary } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { useDrugQuery } from '../drug/drug.queries';
import { unitLabel, useUnitNameByCode } from '../drug/useUnitNameByCode';
import { DoseInput, DosePatternPills, DoseQuickChips } from './dose-controls';
import { AS_NEEDED_WHEN_SUGGESTIONS, buildAsNeededInstruction, parsePositiveInt } from './as-needed-instruction';
import {
  computePrescriptionExactQuartersPreview,
  formatDoseAmountPreview,
  formatDoseDecimalPreview,
  formatPrescriptionDosePreview,
  formatQuarterTotalVi,
  parseDoseInput,
  quartersPerBaseUnitPreview,
} from './prescription-dose-preview';
import { padSmallQuantity } from '../../shared/format/pad-small-quantity';

/**
 * Phần "liều" của MỘT dòng thuốc trong đơn (docs/DECISIONS.md #267, mockup màn 2–3): dùng chung cho đơn đang kê và hộp "Sửa đơn".
 * Ba dạng: (1) thuốc viên/gói "Theo buổi" — 4 ô Sáng/Trưa/Chiều/Tối × số ngày, tổng tự tính (như cũ); (2) thuốc tính liều bằng ml — liều mẫu + 4 ô theo ml,
 * tổng ml quy ra số Hộp/chai làm tròn lên; (3) kiểu "Khi cần" — liều mỗi lần + số lượng nhập thẳng + soạn nhanh câu dặn.
 * Cấu hình của thuốc (đơn vị liều, dung tích, liều mẫu) đọc từ chi tiết thuốc (cache TanStack), nên dòng nạp từ đơn mẫu/đơn lần trước cũng có đủ.
 */
export type DoseField = 'doseMorning' | 'doseNoon' | 'doseAfternoon' | 'doseEvening';

export const DOSE_SLOTS: readonly { field: DoseField; label: string }[] = [
  { field: 'doseMorning', label: 'Sáng' },
  { field: 'doseNoon', label: 'Trưa' },
  { field: 'doseAfternoon', label: 'Chiều' },
  { field: 'doseEvening', label: 'Tối' },
];

/** Phần của một dòng đơn mà bộ soạn liều đọc/ghi. Giá trị liều giữ dạng CHUỖI số thập phân ('' | '0.5' | '5'). */
export interface DoseLineState {
  key: string;
  drugId: string | null;
  drugName: string;
  /** Đơn vị nhỏ nhất của thuốc (mã danh mục) — `null` cho dòng kê tự do. */
  unitCode: string | null;
  doseMode: DoseMode;
  doseMorning: string;
  doseNoon: string;
  doseAfternoon: string;
  doseEvening: string;
  durationDays: string;
  /** Liều mỗi lần của kiểu "Khi cần". */
  singleDose: string;
  /** Số lượng kê của kiểu "Khi cần" (nhập thẳng). */
  quantity: string;
  instruction: string;
  isSplittable: boolean;
}

/** Cấu hình hiệu lực của dòng: đơn vị liều (tên hiển thị, ví dụ "ml") + dung tích, lấy từ chi tiết thuốc. */
export interface LineDoseConfig {
  doseUnitName: string | null;
  dosePerBaseUnit: number | null;
  presets: DrugSummary['dosePresets'];
}

/** Đọc cấu hình liều của thuốc trong dòng. Dòng kê tự do và thuốc chưa tải xong: không có đơn vị liều, không liều mẫu. */
export function useLineDoseConfig(drugId: string | null): LineDoseConfig {
  const drugQuery = useDrugQuery(drugId);
  const unitNameByCode = useUnitNameByCode();
  const drug = drugQuery.data;
  return {
    doseUnitName: drug?.doseUnitCode ? unitLabel(unitNameByCode, drug.doseUnitCode) : null,
    dosePerBaseUnit: drug?.doseUnitCode ? (drug.dosePerBaseUnit ?? null) : null,
    presets: drug?.dosePresets ?? [],
  };
}

/** Liều mỗi lần người dùng gõ ("1,5", "1/2", "½") → số; sai định dạng/để trống → 0. */
export function parseSingleDose(text: string): number {
  const parsed = parseDoseInput(text);
  return typeof parsed === 'number' ? parsed : 0;
}

/** Số liều từ máy chủ → chuỗi hiển thị trong ô nhập: 1.5 → "1,5". */
export function singleDoseText(value: number | null): string {
  return value === null ? '' : formatDoseDecimalPreview(value);
}

export function lineDoseNumbers(line: Pick<DoseLineState, DoseField>): [number, number, number, number] {
  return [Number(line.doseMorning) || 0, Number(line.doseNoon) || 0, Number(line.doseAfternoon) || 0, Number(line.doseEvening) || 0];
}

/** Số theo đơn vị ¼ (chưa làm tròn) của kiểu "Theo buổi" — `% quartersPerBaseUnit !== 0` nghĩa là bị làm tròn lên. */
export function lineExactQuarters(line: DoseLineState): number {
  const [m, n, a, e] = lineDoseNumbers(line);
  return computePrescriptionExactQuartersPreview({ doseMorning: m, doseNoon: n, doseAfternoon: a, doseEvening: e }, Number(line.durationDays) || 0);
}

/** Số lượng kê/xuất kho của dòng (khớp backend): "Khi cần" = số bác sĩ nhập; "Theo buổi" = tổng ÷ dung tích, làm tròn lên. */
export function lineQuantity(line: DoseLineState, config: Pick<LineDoseConfig, 'dosePerBaseUnit'>): number {
  if (line.doseMode === 'AS_NEEDED') return Math.max(0, Math.floor(Number(line.quantity) || 0));
  return Math.ceil(lineExactQuarters(line) / quartersPerBaseUnitPreview(config.dosePerBaseUnit));
}

/** Dòng đã đủ liều để ký — "Khi cần" cần liều mỗi lần VÀ số lượng; "Theo buổi" cần ít nhất một buổi. */
export function lineHasDose(line: DoseLineState): boolean {
  if (line.doseMode === 'AS_NEEDED') return parseSingleDose(line.singleDose) > 0 && (Number(line.quantity) || 0) > 0;
  return lineDoseNumbers(line).some((d) => d > 0);
}

/** Phần dòng gửi lên máy chủ (không gồm thuốc): "Khi cần" không gửi 4 buổi/số ngày; "Theo buổi" luôn kèm số ngày ≥ 1. */
export function lineDoseRequest(line: DoseLineState): {
  doseMode: DoseMode;
  doseMorning: number;
  doseNoon: number;
  doseAfternoon: number;
  doseEvening: number;
  durationDays?: number;
  singleDose?: number;
  quantity?: number;
} {
  if (line.doseMode === 'AS_NEEDED') {
    const single = parseSingleDose(line.singleDose);
    return {
      doseMode: 'AS_NEEDED',
      doseMorning: 0,
      doseNoon: 0,
      doseAfternoon: 0,
      doseEvening: 0,
      ...(single > 0 ? { singleDose: single } : {}),
      quantity: Math.max(0, Math.floor(Number(line.quantity) || 0)),
    };
  }
  const [m, n, a, e] = lineDoseNumbers(line);
  return { doseMode: 'SCHEDULED', doseMorning: m, doseNoon: n, doseAfternoon: a, doseEvening: e, durationDays: Math.max(1, Number(line.durationDays) || 1) };
}

const INPUT_BOX =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-400';

/** Ô có hậu tố đơn vị bên phải ("gói", "lần / 24 tiếng") — đúng mockup màn 3. */
function SuffixField({
  id,
  label,
  value,
  suffix,
  suffixWidthClass,
  disabled,
  inputMode = 'decimal',
  onChange,
  onBlur,
  onFocus,
}: {
  id: string;
  label: string;
  value: string;
  suffix: string;
  suffixWidthClass: string;
  disabled?: boolean;
  inputMode?: 'decimal' | 'numeric';
  onChange: (v: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-slate-800">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onFocus={onFocus}
          className={`${INPUT_BOX} ${suffixWidthClass}`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-600">{suffix}</span>
      </div>
    </div>
  );
}

/** Dòng "Xem trước trên đơn và nhãn" cuối mỗi dòng thuốc: liều · số ngày · SL (+ câu dặn với "Khi cần"). */
export function DoseLinePreview({ line }: { line: DoseLineState }) {
  const config = useLineDoseConfig(line.drugId);
  const unitNameByCode = useUnitNameByCode();
  const unitName = line.unitCode ? unitLabel(unitNameByCode, line.unitCode) : '';
  const quantity = lineQuantity(line, config);
  const qtyText = quantity > 0 ? `SL ${padSmallQuantity(quantity)}${unitName ? ` ${unitName}` : ''}` : '';
  let text: string;
  if (line.doseMode === 'AS_NEEDED') {
    text = [qtyText, line.instruction.trim() || formatPrescriptionDosePreview({ doseMode: 'AS_NEEDED', singleDose: parseSingleDose(line.singleDose), doseUnitName: config.doseUnitName, unitName: unitName, doseMorning: 0, doseNoon: 0, doseAfternoon: 0, doseEvening: 0 })]
      .filter((s) => s !== '')
      .join(' · ');
  } else {
    const [m, n, a, e] = lineDoseNumbers(line);
    const summary = formatPrescriptionDosePreview({ doseMode: 'SCHEDULED', doseUnitName: config.doseUnitName, doseMorning: m, doseNoon: n, doseAfternoon: a, doseEvening: e });
    text = [summary === '—' ? '' : summary, summary === '—' ? '' : `${Number(line.durationDays) || 0} ngày`, qtyText].filter((s) => s !== '').join(' · ');
  }
  if (text === '') return null;
  return (
    <p className="mt-2 text-[13px] text-slate-600">
      Xem trước trên đơn và nhãn: <span className="font-semibold text-slate-900">{text}</span>
    </p>
  );
}

export function DoseLineEditor({
  idPrefix,
  line,
  canEdit,
  showAids,
  daysField,
  daysHint,
  onPatch,
  onCommit,
  onAppendInstruction,
}: {
  idPrefix: string;
  line: DoseLineState;
  canEdit: boolean;
  /** Hiện gợi ý dãy liều + nút điền nhanh ¼ · ½ · 1 · 2 (chỉ màn kê đơn chính, không ở hộp "Sửa đơn"). */
  showAids: boolean;
  /** Ô "Số ngày" do nơi gọi dựng (có logic "số ngày chung" riêng của màn kê đơn). */
  daysField: ReactNode;
  /** Dòng gợi ý dưới hàng liều ("Số ngày chung của đơn", nút "Theo chung"). */
  daysHint?: ReactNode;
  /** Sửa tạm trong bộ nhớ (đang gõ) — chưa lưu. */
  onPatch: (patch: Partial<DoseLineState>) => void;
  /** Chốt thay đổi (rời ô, chọn nhanh, bấm liều mẫu, đổi kiểu kê) — nơi gọi lưu nháp. */
  onCommit: (patch: Partial<DoseLineState>) => void;
  /** Chèn một câu vào ô "Hướng dẫn dùng" của dòng (soạn nhanh câu dặn). */
  onAppendInstruction: (sentence: string) => void;
}) {
  const config = useLineDoseConfig(line.drugId);
  const unitNameByCode = useUnitNameByCode();
  const baseUnitName = line.unitCode ? unitLabel(unitNameByCode, line.unitCode) : '';
  const [focusedField, setFocusedField] = useState<DoseField>('doseMorning');
  const [when, setWhen] = useState('');
  const [maxPerDay, setMaxPerDay] = useState('');
  const [minGap, setMinGap] = useState('');
  const inMl = config.doseUnitName !== null;
  const unitText = config.doseUnitName ?? baseUnitName.toLocaleLowerCase('vi-VN');
  const splittable = line.isSplittable;

  /** Thuốc tính liều bằng ml: kiểu kê cố định theo cấu hình thuốc, không đổi được trên dòng. Thuốc viên/gói và dòng tự do đổi được. */
  const canSwitchMode = canEdit && !inMl;

  function pickPreset(preset: LineDoseConfig['presets'][number]) {
    const v = (n: number) => (n > 0 ? String(n) : '');
    onCommit({ doseMorning: v(preset.doseMorning), doseNoon: v(preset.doseNoon), doseAfternoon: v(preset.doseAfternoon), doseEvening: v(preset.doseEvening) });
  }
  const presetMatches = (preset: LineDoseConfig['presets'][number]) => {
    const [m, n, a, e] = lineDoseNumbers(line);
    return m === preset.doseMorning && n === preset.doseNoon && a === preset.doseAfternoon && e === preset.doseEvening;
  };

  function pickPattern(pattern: readonly [number, number, number, number] | null) {
    const v = (n: number | undefined) => (pattern === null ? '' : String(n ?? 0));
    onCommit({ doseMorning: v(pattern?.[0]), doseNoon: v(pattern?.[1]), doseAfternoon: v(pattern?.[2]), doseEvening: v(pattern?.[3]) });
  }

  function insertSentence() {
    const amount = parseSingleDose(line.singleDose);
    const sentence = buildAsNeededInstruction({
      // Câu dặn viết cho người dùng thuốc đọc: "1,5 gói" tự nhiên hơn "1½ gói" (ký hiệu ½ chỉ dùng ở ô nhập liều).
      amountText: amount > 0 ? formatDoseDecimalPreview(amount) : '',
      unitText,
      when,
      maxPerDay: parsePositiveInt(maxPerDay),
      minGapHours: parsePositiveInt(minGap),
    });
    onAppendInstruction(sentence);
  }

  const modeToggle = canSwitchMode ? (
    <div className="mt-2.5 flex items-center gap-3">
      <span className="text-xs font-semibold text-slate-600">Cách kê</span>
      <div role="group" aria-label={`Cách kê ${line.drugName}`} className="inline-flex overflow-hidden rounded-md border border-slate-300">
        {(['SCHEDULED', 'AS_NEEDED'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={line.doseMode === mode}
            onClick={() => {
              if (line.doseMode !== mode) onCommit({ doseMode: mode });
            }}
            className={`px-4 py-1.5 text-sm font-semibold first:border-0 [&+&]:border-l [&+&]:border-slate-300 ${
              line.doseMode === mode ? 'bg-brand-teal text-white' : 'bg-white text-slate-700 hover:bg-brand-teal-tint'
            }`}
          >
            {mode === 'SCHEDULED' ? 'Theo buổi' : 'Khi cần'}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  if (line.doseMode === 'AS_NEEDED') {
    return (
      <div>
        {modeToggle}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SuffixField
            id={`${idPrefix}-single-dose`}
            label="Liều mỗi lần"
            value={line.singleDose}
            suffix={config.doseUnitName ?? unitText}
            suffixWidthClass="pr-14"
            disabled={!canEdit}
            onChange={(v) => onPatch({ singleDose: v })}
            onBlur={() => {
              const parsed = parseDoseInput(line.singleDose);
              // Sai định dạng (không phải bội ¼) → xoá ô thay vì gửi giá trị mà máy chủ sẽ từ chối.
              onCommit({ singleDose: parsed === null || parsed === '' ? '' : formatDoseDecimalPreview(parsed) });
            }}
          />
          <SuffixField
            id={`${idPrefix}-quantity`}
            label="Số lượng kê"
            value={line.quantity}
            suffix={baseUnitName}
            suffixWidthClass="pr-14"
            inputMode="numeric"
            disabled={!canEdit}
            onChange={(v) => onPatch({ quantity: v.replace(/[^\d]/g, '') })}
            onBlur={() => onCommit({})}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">Số lượng kê là số xuất kho, không tính từ liều mỗi lần.</p>
        {canEdit && (
          <>
            <hr className="my-3 border-slate-200" />
            <span className="text-sm font-semibold text-slate-800">Soạn nhanh câu dặn</span>
            <div className="mt-1.5 flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-[2]">
                <label htmlFor={`${idPrefix}-when`} className="mb-1 block text-[13px] font-semibold text-slate-800">
                  Khi
                </label>
                <input
                  id={`${idPrefix}-when`}
                  type="text"
                  list={`${idPrefix}-when-options`}
                  autoComplete="off"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  placeholder="Chọn hoặc gõ: sốt cao > 38,5 độ C…"
                  className={INPUT_BOX}
                />
                <datalist id={`${idPrefix}-when-options`}>
                  {AS_NEEDED_WHEN_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="min-w-[180px] flex-1">
                <SuffixField id={`${idPrefix}-max`} label="Tối đa" value={maxPerDay} suffix="lần / 24 tiếng" suffixWidthClass="pr-28" inputMode="numeric" onChange={(v) => setMaxPerDay(v.replace(/[^\d]/g, ''))} />
              </div>
              <div className="min-w-[180px] flex-1">
                <SuffixField id={`${idPrefix}-gap`} label="Cách nhau tối thiểu" value={minGap} suffix="tiếng" suffixWidthClass="pr-14" inputMode="numeric" onChange={(v) => setMinGap(v.replace(/[^\d]/g, ''))} />
              </div>
              <Button type="button" variant="info" className="h-9" onClick={insertSentence}>
                Chèn vào hướng dẫn
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ---- "Theo buổi" (viên/gói hoặc ml)
  const exactQuarters = lineExactQuarters(line);
  const perUnitQuarters = quartersPerBaseUnitPreview(config.dosePerBaseUnit);
  const quantity = Math.ceil(exactQuarters / perUnitQuarters);
  const roundedUp = !inMl && exactQuarters % 4 !== 0;
  const totalLabelSuffix = inMl ? ` (${config.doseUnitName})` : '';
  const leftover = inMl && config.dosePerBaseUnit ? Math.round((quantity * perUnitQuarters - exactQuarters) / 4 * 100) / 100 : 0;

  return (
    <div>
      {modeToggle}
      {config.presets.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-slate-600">Liều mẫu</span>
          {config.presets.map((p) => {
            const on = lineHasDose(line) && presetMatches(p);
            const cells = [p.doseMorning, p.doseNoon, p.doseAfternoon, p.doseEvening].map((d) => (inMl ? formatDoseDecimalPreview(d) : formatDoseAmountPreview(d)));
            return (
              <button
                key={p.name}
                type="button"
                disabled={!canEdit}
                aria-pressed={on}
                onClick={() => (on ? onCommit({ doseMorning: '', doseNoon: '', doseAfternoon: '', doseEvening: '' }) : pickPreset(p))}
                className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[13px] transition-colors disabled:opacity-50 ${
                  on ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 bg-white text-slate-900 hover:border-blue-400 hover:bg-brand-teal-tint'
                }`}
              >
                {p.name}
                <span className={`font-mono text-xs tabular-nums ${on ? 'text-white' : 'text-slate-600'}`}>{cells.join('·')}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-4">
        {DOSE_SLOTS.map(({ field, label }) => (
          <div key={field} className="w-14">
            <DoseInput
              id={`${idPrefix}-${field}`}
              label={inMl ? `${label} (${config.doseUnitName})` : label}
              value={line[field]}
              decimal={inMl}
              disabled={!canEdit}
              onFocus={() => setFocusedField(field)}
              onCommit={(v) => onCommit({ [field]: v } as Partial<DoseLineState>)}
            />
          </div>
        ))}
        <span className="pb-1.5 text-lg font-semibold text-slate-300">×</span>
        {daysField}
        <span className="pb-1.5 text-lg font-semibold text-slate-300">=</span>
        {inMl ? (
          <>
            <div className="min-w-[116px] rounded-md border border-slate-200 bg-slate-50 px-3 py-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Tổng dùng</div>
              <div className="text-[17px] font-semibold text-slate-900">
                {formatQuarterTotalVi(exactQuarters)} {config.doseUnitName}
              </div>
            </div>
            <span className="pb-1.5 text-lg font-semibold text-slate-300">→</span>
            <div className="min-w-[116px] rounded-md border border-slate-200 bg-slate-50 px-3 py-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Kê và xuất kho</div>
              <div className="text-[17px] font-semibold text-slate-900">
                {padSmallQuantity(quantity)} {baseUnitName}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-md bg-brand-teal-tint px-3 py-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tổng số{totalLabelSuffix}</div>
            <div className="text-[15px] font-semibold text-blue-700">
              {quantity} {baseUnitName}
            </div>
            {roundedUp && <div className="text-[11px] font-semibold text-amber-700">{formatQuarterTotalVi(exactQuarters)} làm tròn lên</div>}
          </div>
        )}
      </div>
      {inMl && config.dosePerBaseUnit !== null && quantity > 0 && (
        <p className="mt-1 text-xs font-semibold text-slate-600">
          1 {baseUnitName} = {formatDoseDecimalPreview(config.dosePerBaseUnit)} {config.doseUnitName}
          {leftover > 0 ? `, dư ${formatDoseDecimalPreview(leftover)} ${config.doseUnitName}` : ''}. Kho đếm nguyên {baseUnitName}.
        </p>
      )}
      {daysHint}
      {canEdit && showAids && !inMl && (
        // Hàng gợi ý luôn chiếm chỗ (chỉ đổi visibility) để bấm pill đầu không bị đẩy xuống giữa lúc nhấn chuột.
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <DosePatternPills doses={lineDoseNumbers(line)} splittable={splittable} onPick={pickPattern} />
          <div className="invisible group-focus-within:visible">
            <DoseQuickChips onPick={(value) => onCommit({ [focusedField]: value === null ? '' : String(value) } as Partial<DoseLineState>)} />
          </div>
        </div>
      )}
    </div>
  );
}
