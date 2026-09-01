import { useState } from 'react';
import type { WorkShiftColor, WorkShiftItem } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { TimeInput } from '../../shared/ui/TimeInput';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const boxedSectionClassName = 'relative rounded-lg border border-slate-200 p-6 pt-8';
const boxedBadgeClassName = 'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

/** 8 màu cố định — không color-picker tự do (tránh chọn hex lệch tông với giao diện app). */
const COLOR_OPTIONS: { value: WorkShiftColor; hex: string; label: string }[] = [
  { value: 'blue', hex: '#2563eb', label: 'Xanh dương' },
  { value: 'teal', hex: '#0d9488', label: 'Xanh ngọc' },
  { value: 'emerald', hex: '#059669', label: 'Xanh lá' },
  { value: 'amber', hex: '#d97706', label: 'Cam' },
  { value: 'rose', hex: '#e11d48', label: 'Đỏ' },
  { value: 'purple', hex: '#7c3aed', label: 'Tím' },
  { value: 'cyan', hex: '#0891b2', label: 'Xanh cyan' },
  { value: 'slate', hex: '#64748b', label: 'Xám' },
];

export const WORK_SHIFT_COLOR_HEX: Record<WorkShiftColor, string> = Object.fromEntries(
  COLOR_OPTIONS.map((c) => [c.value, c.hex]),
) as Record<WorkShiftColor, string>;

type RestUnit = 'minute' | 'hour';

export interface WorkShiftFormValues {
  name: string;
  startTime: string;
  endTime: string;
  color: WorkShiftColor;
  restStartTime: string;
  restEndTime: string;
  restTotal: string;
  restUnit: RestUnit;
  standardWorkHours: string;
  sortOrder: number;
}

function toFormValues(item?: WorkShiftItem): WorkShiftFormValues {
  return {
    name: item?.name ?? '',
    startTime: item?.startTime ?? '',
    endTime: item?.endTime ?? '',
    color: item?.color ?? 'blue',
    restStartTime: item?.restStartTime ?? '',
    restEndTime: item?.restEndTime ?? '',
    restTotal: item?.restMinutes != null ? String(item.restMinutes) : '',
    restUnit: 'minute',
    standardWorkHours: item?.standardWorkMinutes != null ? String(item.standardWorkMinutes / 60) : '',
    sortOrder: item?.sortOrder ?? 0,
  };
}

export interface WorkShiftSubmitDto {
  name: string;
  startTime: string;
  endTime: string;
  color: WorkShiftColor;
  restStartTime: string | null;
  restEndTime: string | null;
  restMinutes: number | null;
  standardWorkMinutes: number | null;
  sortOrder: number;
}

/**
 * Modal riêng cho "Ca làm việc" (docs/DECISIONS.md #101, `.claude/docs/ui-guidelines.md` mục 9b) —
 * KHÔNG dùng modal chung `ItemFormModal` của `reference_catalog` (backend/schema khác hẳn, và đủ
 * nhiều trường để cần Boxed Section thay vì 1 form đơn). 3 khối: Thông tin chung, Giờ làm việc, Giờ
 * nghỉ giữa ca (tuỳ chọn) — mỗi khối dàn lưới ngang, KHÔNG xếp input thành 1 cột dọc (mục 4.1).
 */
export function WorkShiftFormModal({
  mode,
  item,
  submitting,
  submitError,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  item?: WorkShiftItem;
  submitting: boolean;
  submitError?: string;
  onCancel: () => void;
  onSubmit: (dto: WorkShiftSubmitDto) => void;
}) {
  const [values, setValues] = useState<WorkShiftFormValues>(() => toFormValues(item));

  function set<K extends keyof WorkShiftFormValues>(key: K, value: WorkShiftFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const isValid = values.name.trim() !== '' && values.startTime !== '' && values.endTime !== '';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    const restTotalNum = values.restTotal.trim() === '' ? null : Number(values.restTotal);
    const restMinutes = restTotalNum === null ? null : Math.round(values.restUnit === 'hour' ? restTotalNum * 60 : restTotalNum);
    const standardHoursNum = values.standardWorkHours.trim() === '' ? null : Number(values.standardWorkHours);
    onSubmit({
      name: values.name.trim(),
      startTime: values.startTime,
      endTime: values.endTime,
      color: values.color,
      restStartTime: values.restStartTime || null,
      restEndTime: values.restEndTime || null,
      restMinutes,
      standardWorkMinutes: standardHoursNum === null ? null : Math.round(standardHoursNum * 60),
      sortOrder: values.sortOrder,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl" onSubmit={handleSubmit}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{mode === 'create' ? 'Thêm ca làm việc' : 'Sửa ca làm việc'}</h2>
            <p className="mt-0.5 text-xs text-slate-500">Danh mục: Ca làm việc</p>
          </div>
          {mode === 'edit' && item && (
            <span
              className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600"
              title="Mã tự sinh, không sửa được"
            >
              Mã: {item.code}
            </span>
          )}
        </div>

        <div className="space-y-5">
          <div className={boxedSectionClassName}>
            <span className={boxedBadgeClassName}>Thông tin chung</span>
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3">
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label htmlFor="ws-name" className="text-sm font-semibold text-slate-800">
                  Tên hiển thị <span className="text-rose-500">*</span>
                </label>
                <input id="ws-name" value={values.name} onChange={(e) => set('name', e.target.value)} className={inputClassName} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ws-sort" className="text-sm font-semibold text-slate-800">
                  Thứ tự hiển thị
                </label>
                <input
                  id="ws-sort"
                  type="number"
                  value={values.sortOrder}
                  onChange={(e) => set('sortOrder', Number(e.target.value))}
                  className={inputClassName}
                />
              </div>
              <div className="flex flex-col gap-1.5 md:col-span-3">
                <label className="text-sm font-semibold text-slate-800">
                  Màu sắc <span className="text-rose-500">*</span>
                </label>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      title={c.label}
                      onClick={() => set('color', c.value)}
                      className={`h-[34px] w-[34px] rounded-full border-2 ${
                        values.color === c.value ? 'border-slate-900 shadow-[0_0_0_2px_white]' : 'border-transparent'
                      }`}
                      style={{ background: c.hex }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className={boxedSectionClassName}>
            <span className={boxedBadgeClassName}>Giờ làm việc</span>
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ws-start" className="text-sm font-semibold text-slate-800">
                  Giờ bắt đầu <span className="text-rose-500">*</span>
                </label>
                <TimeInput id="ws-start" value={values.startTime} onChange={(v) => set('startTime', v)} className={`${inputClassName} text-center`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ws-end" className="text-sm font-semibold text-slate-800">
                  Giờ kết thúc <span className="text-rose-500">*</span>
                </label>
                <TimeInput id="ws-end" value={values.endTime} onChange={(v) => set('endTime', v)} className={`${inputClassName} text-center`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ws-standard" className="text-sm font-semibold text-slate-800">
                  Số giờ công chuẩn
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="ws-standard"
                    type="number"
                    min={0}
                    step={0.5}
                    value={values.standardWorkHours}
                    onChange={(e) => set('standardWorkHours', e.target.value)}
                    className={`${inputClassName} text-center`}
                  />
                  <span className="flex-shrink-0 text-xs font-semibold text-slate-500">giờ</span>
                </div>
              </div>
            </div>
          </div>

          <div className={boxedSectionClassName}>
            <span className={boxedBadgeClassName}>Giờ nghỉ giữa ca · Tuỳ chọn</span>
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ws-rest-start" className="text-sm font-semibold text-slate-800">
                  Bắt đầu giờ nghỉ
                </label>
                <TimeInput
                  id="ws-rest-start"
                  value={values.restStartTime}
                  onChange={(v) => set('restStartTime', v)}
                  className={`${inputClassName} text-center`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ws-rest-end" className="text-sm font-semibold text-slate-800">
                  Kết thúc giờ nghỉ
                </label>
                <TimeInput
                  id="ws-rest-end"
                  value={values.restEndTime}
                  onChange={(v) => set('restEndTime', v)}
                  className={`${inputClassName} text-center`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ws-rest-total" className="text-sm font-semibold text-slate-800">
                  Tổng thời gian nghỉ
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="ws-rest-total"
                    type="number"
                    min={0}
                    value={values.restTotal}
                    onChange={(e) => set('restTotal', e.target.value)}
                    className={`${inputClassName} text-center`}
                  />
                  <div className="flex flex-shrink-0 overflow-hidden rounded-md border border-slate-300">
                    <button
                      type="button"
                      onClick={() => set('restUnit', 'minute')}
                      className={`px-2.5 py-2 text-xs font-bold ${values.restUnit === 'minute' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
                    >
                      Phút
                    </button>
                    <button
                      type="button"
                      onClick={() => set('restUnit', 'hour')}
                      className={`px-2.5 py-2 text-xs font-bold ${values.restUnit === 'hour' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
                    >
                      Giờ
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              Có thể nhập khung giờ nghỉ cố định, tổng thời gian nghỉ linh động, hoặc cả hai — không bắt buộc khớp nhau.
            </p>
          </div>
        </div>

        {submitError && <p className="mt-4 text-xs font-medium text-rose-600">{submitError}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting} disabled={!isValid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
