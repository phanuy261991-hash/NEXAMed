import { Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import type { DoseMode } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { EMPTY_DOSE_PRESET_ROW, MAX_DOSE_PRESETS, type DoseConfigIssue, type DosePresetRow } from './drug-dose-config';

const MODE_CARDS: { mode: DoseMode; title: string; description: string }[] = [
  { mode: 'SCHEDULED', title: 'Theo buổi', description: 'Sáng / Trưa / Chiều / Tối nhân số ngày. Số lượng tự tính.' },
  { mode: 'AS_NEEDED', title: 'Khi cần', description: 'Liều mỗi lần, bác sĩ nhập thẳng số lượng và câu dặn.' },
];

const DOSE_COLUMNS = [
  { field: 'doseMorning', label: 'Sáng' },
  { field: 'doseNoon', label: 'Trưa' },
  { field: 'doseAfternoon', label: 'Chiều' },
  { field: 'doseEvening', label: 'Tối' },
] as const;

const GRID = 'grid grid-cols-[minmax(0,1fr)_92px_92px_92px_92px_48px] items-center gap-x-3';
const cellInput = 'w-full border-0 border-b border-slate-300 bg-transparent px-1 py-1.5 text-[15px] font-normal text-slate-900 focus:border-b-2 focus:border-blue-600 focus:outline-none';
const textInput =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-800';

/**
 * Khối "Cách kê liều" của form Thuốc (docs/DECISIONS.md #267, mockup màn 1 đã chốt): kiểu kê mặc định (theo buổi / khi cần), đơn vị liều khác đơn vị nhỏ nhất
 * (vd ml cho siro bán nguyên Hộp) + "mỗi đơn vị nhỏ nhất chứa bao nhiêu", và bảng "Liều mẫu" để bác sĩ bấm chọn ở màn kê đơn. Hoàn toàn điều khiển từ ngoài (form cha giữ state).
 */
export function DrugDoseConfigSection({
  doseMode,
  onDoseModeChange,
  doseUnitCode,
  onDoseUnitCodeChange,
  dosePerBaseUnit,
  onDosePerBaseUnitChange,
  rows,
  onRowsChange,
  doseUnitOptions,
  onCreateDoseUnit,
  baseUnitLabel,
  doseUnitLabel,
  issues,
}: {
  doseMode: DoseMode;
  onDoseModeChange: (mode: DoseMode) => void;
  doseUnitCode: string;
  onDoseUnitCodeChange: (code: string) => void;
  dosePerBaseUnit: string;
  onDosePerBaseUnitChange: (text: string) => void;
  rows: DosePresetRow[];
  onRowsChange: (rows: DosePresetRow[]) => void;
  doseUnitOptions: ComboboxOption[];
  onCreateDoseUnit: (name: string) => Promise<ComboboxOption>;
  /** Tên hiển thị của đơn vị nhỏ nhất ("Hộp"); rỗng nếu chưa chọn. */
  baseUnitLabel: string;
  /** Tên hiển thị của đơn vị liều ("ml"); rỗng nếu chưa chọn. */
  doseUnitLabel: string;
  issues: DoseConfigIssue[];
}) {
  const hasDoseUnit = doseUnitCode !== '';
  const columnUnit = doseUnitLabel || baseUnitLabel;
  const unitOptions: ComboboxOption[] = [{ value: '', label: 'Dùng đơn vị nhỏ nhất' }, ...doseUnitOptions];
  const setRow = (index: number, patch: Partial<DosePresetRow>) => onRowsChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const rowIssue = (index: number) => issues.find((i) => i.row === index);
  const configIssues = issues.filter((i) => i.row === null);

  return (
    <section className="relative rounded-lg border border-slate-200 p-6 pt-8" aria-label="Cách kê liều">
      <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Cách kê liều</span>

      <span className="mb-1.5 block text-sm font-semibold text-slate-800" id="drug-dose-mode-label">
        Kiểu kê liều mặc định
      </span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-labelledby="drug-dose-mode-label">
        {MODE_CARDS.map((card) => {
          const selected = doseMode === card.mode;
          return (
            <button
              key={card.mode}
              type="button"
              aria-pressed={selected}
              onClick={() => onDoseModeChange(card.mode)}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                selected ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 bg-white text-slate-900 hover:border-blue-400 hover:bg-brand-teal-tint'
              }`}
            >
              <span className="block text-[15px] font-semibold">{card.title}</span>
              <span className={`mt-0.5 block text-[13px] ${selected ? 'text-white' : 'text-slate-600'}`}>{card.description}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-4">
        <div>
          <label htmlFor="drug-dose-unit" className="mb-1.5 block text-sm font-semibold text-slate-800">
            Đơn vị liều
          </label>
          <Combobox id="drug-dose-unit" value={doseUnitCode} onChange={onDoseUnitCodeChange} options={unitOptions} allowCreate onCreateOption={onCreateDoseUnit} placeholder="Dùng đơn vị nhỏ nhất" />
        </div>
        <div>
          <label htmlFor="drug-dose-per-base" className="mb-1.5 block text-sm font-semibold text-slate-800">
            Mỗi {baseUnitLabel || 'đơn vị bán'} chứa
          </label>
          <div className="relative">
            <input
              id="drug-dose-per-base"
              inputMode="decimal"
              value={dosePerBaseUnit}
              onChange={(e) => onDosePerBaseUnitChange(e.target.value)}
              disabled={!hasDoseUnit}
              className={`${textInput} ${hasDoseUnit ? 'pr-12' : ''}`}
            />
            {hasDoseUnit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-600">{doseUnitLabel}</span>}
          </div>
        </div>
      </div>
      {configIssues.map((issue) => (
        <p key={issue.message} role="alert" className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-rose-700">
          <WarningCircle size={15} weight="fill" aria-hidden="true" />
          {issue.message}
        </p>
      ))}
      <p className="mt-2.5 text-[13px] leading-relaxed text-slate-600">
        {hasDoseUnit
          ? `Bác sĩ nhập liều bằng ${doseUnitLabel || 'đơn vị liều'}, kho vẫn đếm ${baseUnitLabel || 'đơn vị nhỏ nhất'}: xuất kho làm tròn lên theo ${baseUnitLabel || 'đơn vị nhỏ nhất'}. Thuốc tính liều theo đơn vị này thì kiểu kê cố định, không đổi được trên dòng đơn.`
          : 'Để trống nếu liều tính theo chính đơn vị nhỏ nhất (viên, gói...). Thuốc dạng lỏng bán nguyên chai/hộp thì chọn ml và nhập dung tích mỗi chai/hộp.'}
      </p>

      <div className="mt-5">
        <span className="block text-sm font-semibold text-slate-800">Liều mẫu</span>
        <p className="mb-2.5 text-[13px] text-slate-600">Bác sĩ bấm chọn ở màn kê đơn, 4 ô liều tự điền và vẫn sửa tay được.</p>
        <div role="table" aria-label="Liều mẫu">
          <div role="row" className={`${GRID} border-b-2 border-blue-600 bg-slate-100 px-2 py-2`}>
            <span role="columnheader" className="text-xs font-semibold uppercase tracking-wide text-slate-700">
              Tên nhóm
            </span>
            {DOSE_COLUMNS.map((c) => (
              <span key={c.field} role="columnheader" className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                {c.label}
                {columnUnit ? ` (${columnUnit})` : ''}
              </span>
            ))}
            <span />
          </div>
          {rows.length === 0 && <p className="border-b border-slate-200 px-2 py-3 text-[13px] text-slate-500">Chưa có liều mẫu. Bấm &quot;Thêm liều mẫu&quot; nếu muốn bác sĩ chọn nhanh.</p>}
          {rows.map((row, index) => {
            const issue = rowIssue(index);
            return (
              <div key={index}>
                <div role="row" className={`${GRID} border-b border-slate-200 px-2 py-1`}>
                  <input
                    role="cell"
                    className={cellInput}
                    value={row.name}
                    onChange={(e) => setRow(index, { name: e.target.value })}
                    aria-label={`Tên nhóm liều mẫu ${index + 1}`}
                    maxLength={60}
                    placeholder="Ví dụ Người lớn"
                  />
                  {DOSE_COLUMNS.map((c) => (
                    <input
                      key={c.field}
                      role="cell"
                      inputMode="decimal"
                      className={cellInput}
                      value={row[c.field]}
                      onChange={(e) => setRow(index, { [c.field]: e.target.value } as Partial<DosePresetRow>)}
                      aria-label={`${c.label} của liều mẫu ${index + 1}`}
                      placeholder="0"
                    />
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2.5 py-1.5"
                    aria-label={`Xoá liều mẫu ${row.name.trim() || index + 1}`}
                    onClick={() => onRowsChange(rows.filter((_, i) => i !== index))}
                  >
                    <Trash size={15} weight="bold" aria-hidden="true" />
                  </Button>
                </div>
                {issue && (
                  <p role="alert" className="flex items-center gap-1.5 px-2 py-1 text-[13px] font-semibold text-rose-700">
                    <WarningCircle size={15} weight="fill" aria-hidden="true" />
                    {issue.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <Button type="button" variant="secondary" className="mt-3" disabled={rows.length >= MAX_DOSE_PRESETS} onClick={() => onRowsChange([...rows, { ...EMPTY_DOSE_PRESET_ROW }])}>
          <Plus size={14} weight="bold" aria-hidden="true" />
          Thêm liều mẫu
        </Button>
        {rows.length >= MAX_DOSE_PRESETS && <p className="mt-1.5 text-xs text-slate-500">Tối đa {MAX_DOSE_PRESETS} liều mẫu cho mỗi thuốc.</p>}
      </div>
    </section>
  );
}
