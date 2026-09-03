import { useMemo, useRef, useState } from 'react';
import type { BusinessCodeTemplateItem } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { BUSINESS_CODE_TOKEN_PREVIEW, formatBusinessCodePreview, parseBusinessCodeTemplatePreview } from './business-code-preview';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const boxedSectionClassName = 'relative rounded-lg border border-slate-200 p-6 pt-8';
const boxedBadgeClassName = 'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

/** Nút chèn nhanh — nhãn ngắn gọn, giá trị chèn đúng token thật (xem `business-code-preview.ts`). */
const TOKEN_BUTTONS: { label: string; token: string }[] = [
  { label: 'Năm (2 số)', token: BUSINESS_CODE_TOKEN_PREVIEW.YEAR_2 },
  { label: 'Năm (4 số)', token: BUSINESS_CODE_TOKEN_PREVIEW.YEAR_4 },
  { label: 'Tháng', token: BUSINESS_CODE_TOKEN_PREVIEW.MONTH },
  { label: 'Ngày', token: BUSINESS_CODE_TOKEN_PREVIEW.DAY },
  { label: 'Số đếm', token: BUSINESS_CODE_TOKEN_PREVIEW.COUNTER },
];

/** Ngày hôm nay (giờ trình duyệt) — CHỈ dùng để xem trước ở client, không cần chính xác múi giờ VN
 * tuyệt đối như lúc sinh mã thật ở backend (`toVietnamDateParts`, `packages/core`). */
function todayParts(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114) — sửa khuôn mẫu 1 loại mã. Chèn token qua
 * nút bấm tại vị trí con trỏ (không kéo-thả khối, chốt qua AskUserQuestion), xem trước trực tiếp
 * bằng `formatBusinessCode`/`parseBusinessCodeTemplate` thuần (không round-trip API).
 */
export function BusinessCodeTemplateFormModal({
  item,
  submitting,
  submitError,
  onCancel,
  onSubmit,
}: {
  item: BusinessCodeTemplateItem;
  submitting: boolean;
  submitError?: string;
  onCancel: () => void;
  onSubmit: (dto: { template: string; counterDigits: number; startingValue?: number }) => void;
}) {
  const [template, setTemplate] = useState(item.template);
  const [counterDigits, setCounterDigits] = useState(String(item.counterDigits));
  const [startingValue, setStartingValue] = useState(String(item.startingValue));
  const inputRef = useRef<HTMLInputElement>(null);

  const parseResult = useMemo(() => parseBusinessCodeTemplatePreview(template), [template]);
  const counterDigitsNum = Number(counterDigits);
  const isValidCounterDigits = Number.isInteger(counterDigitsNum) && counterDigitsNum >= 1 && counterDigitsNum <= 9;
  const startingValueNum = Number(startingValue);
  const isValidStartingValue = item.locked || (Number.isInteger(startingValueNum) && startingValueNum >= 1);
  const isValid = parseResult.ok && isValidCounterDigits && isValidStartingValue;

  const preview = useMemo(() => {
    if (!parseResult.ok || !isValidCounterDigits) return null;
    // Chỉ minh hoạ cách ghép token — số đếm thật do backend cấp atomic (xem `exampleNextCode` ở
    // danh sách), ở đây luôn dùng số bắt đầu đã nhập làm ví dụ, không round-trip API.
    const seq = isValidStartingValue && !item.locked ? startingValueNum : 1;
    return formatBusinessCodePreview(template, counterDigitsNum, todayParts(), seq);
  }, [template, parseResult, isValidCounterDigits, counterDigitsNum, isValidStartingValue, item.locked, startingValueNum]);

  function insertToken(token: string) {
    const el = inputRef.current;
    if (!el) {
      setTemplate((t) => t + token);
      return;
    }
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    const next = template.slice(0, start) + token + template.slice(end);
    setTemplate(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + token.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onSubmit({
      template,
      counterDigits: counterDigitsNum,
      startingValue: item.locked ? undefined : startingValueNum,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl" onSubmit={handleSubmit}>
        <div className="mb-5">
          <h2 className="text-[15px] font-semibold text-slate-900">Sửa khuôn mẫu — {item.label}</h2>
          <p className="mt-0.5 text-xs text-slate-500">Chỉ áp dụng cho mã tạo MỚI từ lúc lưu — mã đã cấp trước đó giữ nguyên.</p>
        </div>

        <div className="space-y-5">
          <div className={boxedSectionClassName}>
            <span className={boxedBadgeClassName}>Khuôn mẫu</span>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bct-template" className="text-sm font-semibold text-slate-800">
                Cú pháp mã <span className="text-rose-500">*</span>
              </label>
              <input
                id="bct-template"
                ref={inputRef}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className={`${inputClassName} font-mono`}
              />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {TOKEN_BUTTONS.map((t) => (
                  <button
                    key={t.token}
                    type="button"
                    onClick={() => insertToken(t.token)}
                    className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    + {t.label}
                  </button>
                ))}
              </div>
              {!parseResult.ok && <p className="mt-1 text-xs font-medium text-rose-600">{parseResult.error}</p>}
              {preview !== null && (
                <p className="mt-1 text-xs text-slate-500">
                  Mã kế tiếp minh hoạ: <span className="font-mono font-bold text-slate-800">{preview}</span>
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bct-digits" className="text-sm font-semibold text-slate-800">
                  Số chữ số đệm (Số đếm) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="bct-digits"
                  type="number"
                  min={1}
                  max={9}
                  value={counterDigits}
                  onChange={(e) => setCounterDigits(e.target.value)}
                  className={`${inputClassName} text-center`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bct-start" className="text-sm font-semibold text-slate-800">
                  Số bắt đầu đếm {!item.locked && <span className="text-rose-500">*</span>}
                </label>
                <input
                  id="bct-start"
                  type="number"
                  min={1}
                  value={startingValue}
                  onChange={(e) => setStartingValue(e.target.value)}
                  disabled={item.locked}
                  title={item.locked ? 'Loại mã này đã phát sinh mã đầu tiên — không sửa lại được.' : undefined}
                  className={`${inputClassName} text-center ${item.locked ? 'cursor-not-allowed bg-slate-100 text-slate-400' : ''}`}
                />
                {item.locked && <p className="text-[11px] text-slate-400">Đã khoá — loại mã này đã phát sinh mã đầu tiên.</p>}
              </div>
            </div>
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
