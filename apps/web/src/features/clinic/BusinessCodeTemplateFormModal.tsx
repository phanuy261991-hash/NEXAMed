import { useMemo, useRef, useState } from 'react';
import { Hash, Prohibit, WarningCircle } from '@phosphor-icons/react';
import type { BusinessCodeTemplateItem, PrescriptionStandardReadinessBranch } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { PrescriptionNationalCode } from '../../shared/ui/PrescriptionNationalCode';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { TwoOptionToggle } from '../../shared/ui/TwoOptionToggle';
import { usePrescriptionStandardReadinessQuery } from './clinic.queries';
import {
  BUSINESS_CODE_TOKEN_PREVIEW,
  PRESCRIPTION_STANDARD_COUNTER_DIGITS_PREVIEW,
  PRESCRIPTION_STANDARD_TEMPLATE_PREVIEW,
  formatBusinessCodePreview,
  parseBusinessCodeTemplatePreview,
} from './business-code-preview';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const readOnlyClassName = 'cursor-not-allowed bg-slate-50 text-slate-800';

type Mode = 'CUSTOM' | 'STANDARD';

/** Nút chèn nhanh — nhãn ngắn gọn, giá trị chèn đúng token thật (xem `business-code-preview.ts`). */
const TOKEN_BUTTONS: { label: string; token: string; prescriptionOnly?: boolean }[] = [
  { label: 'Năm (2 số)', token: BUSINESS_CODE_TOKEN_PREVIEW.YEAR_2 },
  { label: 'Năm (4 số)', token: BUSINESS_CODE_TOKEN_PREVIEW.YEAR_4 },
  { label: 'Tháng', token: BUSINESS_CODE_TOKEN_PREVIEW.MONTH },
  { label: 'Ngày', token: BUSINESS_CODE_TOKEN_PREVIEW.DAY },
  { label: 'Số đếm', token: BUSINESS_CODE_TOKEN_PREVIEW.COUNTER },
  { label: 'Mã cơ sở KCB', token: BUSINESS_CODE_TOKEN_PREVIEW.FACILITY_CODE, prescriptionOnly: true },
  { label: 'Loại đơn', token: BUSINESS_CODE_TOKEN_PREVIEW.PRESCRIPTION_KIND, prescriptionOnly: true },
];

/** Khuôn tuỳ chỉnh mặc định của mã đơn thuốc — dùng khi tắt chế độ chuẩn mà API không trả lại khuôn tuỳ chỉnh cũ. */
const DEFAULT_PRESCRIPTION_CUSTOM_TEMPLATE = `DT${BUSINESS_CODE_TOKEN_PREVIEW.YEAR_2}${BUSINESS_CODE_TOKEN_PREVIEW.MONTH}${BUSINESS_CODE_TOKEN_PREVIEW.COUNTER}`;

/** Ngày hôm nay (giờ trình duyệt) — CHỈ dùng để xem trước ở client, không cần chính xác múi giờ VN
 * tuyệt đối như lúc sinh mã thật ở backend (`toVietnamDateParts`, `packages/core`). */
function todayParts(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

export interface BusinessCodeTemplateSubmitDto {
  template: string;
  counterDigits: number;
  startingValue?: number;
  mode?: Mode;
}

function ReadinessTable({ branches, multiBranch }: { branches: PrescriptionStandardReadinessBranch[]; multiBranch: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
            <th className="px-3 py-2 text-left">{multiBranch ? 'Chi nhánh' : 'Cơ sở'}</th>
            <th className="px-3 py-2 text-center">Mã cơ sở KCB</th>
            <th className="px-3 py-2 text-center">Mã kế tiếp (đơn thường)</th>
            <th className="px-3 py-2 text-center">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.branchId} className="border-b border-slate-200 last:border-b-0">
              <td className="px-3 py-2 text-left font-semibold text-slate-900">
                <span className="block max-w-[220px] truncate" title={b.name}>{b.name}</span>
                {b.isDefault && multiBranch && <span className="text-xs font-normal text-slate-500">Mặc định</span>}
              </td>
              <td className="px-3 py-2 text-center">
                {b.effectiveFacilityCode ? (
                  <>
                    <span className="font-semibold tabular-nums text-blue-700">{b.effectiveFacilityCode}</span>
                    {b.source === 'COMPANY' && <span className="block text-xs text-slate-500">mã công ty</span>}
                  </>
                ) : (
                  <StatusBadge tone="danger">Chưa có</StatusBadge>
                )}
              </td>
              <td className="px-3 py-2 text-center">{b.exampleNextCode ? <PrescriptionNationalCode code={b.exampleNextCode} /> : <span className="text-slate-400">—</span>}</td>
              <td className="px-3 py-2 text-center">
                <StatusBadge tone={b.ready ? 'success' : 'danger'}>{b.ready ? 'Sẵn sàng' : 'Thiếu mã'}</StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114) — sửa khuôn mẫu 1 loại mã. Chèn token qua
 * nút bấm tại vị trí con trỏ (không kéo-thả khối, chốt qua AskUserQuestion), xem trước trực tiếp
 * bằng `formatBusinessCode`/`parseBusinessCodeTemplate` thuần (không round-trip API).
 *
 * Mã đơn thuốc (#242, mockup đã chốt): thêm chế độ "Chuẩn Bộ Y tế" — khuôn và số chữ số bị khoá, bảng kiểm tra mã cơ sở KCB theo chi nhánh, không bật được khi còn
 * chi nhánh thiếu mã; tắt lại được nhưng có xác nhận (đơn đã cấp giữ mã chuẩn, đơn mới quay về mã nội bộ).
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
  onSubmit: (dto: BusinessCodeTemplateSubmitDto) => void;
}) {
  const supportsStandard = item.supportsStandardMode;
  const wasStandard = item.mode === 'STANDARD';
  const [mode, setMode] = useState<Mode>(item.mode);
  const [template, setTemplate] = useState(wasStandard ? DEFAULT_PRESCRIPTION_CUSTOM_TEMPLATE : item.template);
  const [counterDigits, setCounterDigits] = useState(wasStandard ? '6' : String(item.counterDigits));
  const [startingValue, setStartingValue] = useState(String(item.startingValue));
  const [confirmOff, setConfirmOff] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const standard = supportsStandard && mode === 'STANDARD';
  const readinessQuery = usePrescriptionStandardReadinessQuery(supportsStandard);
  const readiness = readinessQuery.data;

  const parseResult = useMemo(() => parseBusinessCodeTemplatePreview(template, item.codeType), [template, item.codeType]);
  const counterDigitsNum = Number(counterDigits);
  const isValidCounterDigits = Number.isInteger(counterDigitsNum) && counterDigitsNum >= 1 && counterDigitsNum <= 9;
  const startingValueNum = Number(startingValue);
  const isValidStartingValue = item.locked || (Number.isInteger(startingValueNum) && startingValueNum >= 1);
  const customValid = parseResult.ok && isValidCounterDigits && isValidStartingValue;
  // Bật chế độ chuẩn lần đầu cần mọi chi nhánh có mã; đang bật sẵn thì vẫn lưu được (không đổi gì).
  const standardBlocked = standard && !wasStandard && (readinessQuery.isLoading || readiness === undefined || !readiness.ready);
  const isValid = standard ? !standardBlocked : customValid;

  const preview = useMemo(() => {
    if (standard || !parseResult.ok || !isValidCounterDigits) return null;
    // Chỉ minh hoạ cách ghép token — số đếm thật do backend cấp atomic (xem `exampleNextCode`
    // ở danh sách), ở đây luôn dùng số bắt đầu đã nhập làm ví dụ, không round-trip API.
    const seq = isValidStartingValue && !item.locked ? startingValueNum : 1;
    return formatBusinessCodePreview(template, counterDigitsNum, todayParts(), seq, { facilityCode: readiness?.branches[0]?.effectiveFacilityCode ?? '79001', prescriptionKind: 'C' });
  }, [standard, template, parseResult, isValidCounterDigits, counterDigitsNum, isValidStartingValue, item.locked, startingValueNum, readiness]);

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

  function submitNow() {
    if (standard) {
      onSubmit({ template: PRESCRIPTION_STANDARD_TEMPLATE_PREVIEW, counterDigits: PRESCRIPTION_STANDARD_COUNTER_DIGITS_PREVIEW, mode: 'STANDARD' });
      return;
    }
    onSubmit({
      template,
      counterDigits: counterDigitsNum,
      startingValue: item.locked || wasStandard ? undefined : startingValueNum,
      mode: supportsStandard ? 'CUSTOM' : undefined,
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    // Tắt chế độ chuẩn đang chạy: hỏi lại một lần (đơn mới sẽ quay về mã nội bộ).
    if (wasStandard && !standard) {
      setConfirmOff(true);
      return;
    }
    submitNow();
  }

  const shownTemplate = standard ? PRESCRIPTION_STANDARD_TEMPLATE_PREVIEW : template;
  const shownDigits = standard ? String(PRESCRIPTION_STANDARD_COUNTER_DIGITS_PREVIEW) : counterDigits;
  const missing = readiness?.branches.filter((b) => !b.ready) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader icon={Hash} title={`Sửa khuôn mẫu — ${item.label}`} subtitle="Cấu hình: Mẫu mã phát sinh" onClose={onCancel} />
        <p className="-mt-2 mb-4 text-xs text-slate-500">Chỉ áp dụng cho mã tạo MỚI từ lúc lưu — mã đã cấp trước đó giữ nguyên.</p>

        <div className="space-y-5">
          {supportsStandard && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-slate-800">Chế độ</span>
              <TwoOptionToggle<Mode>
                options={[
                  { value: 'CUSTOM', label: 'Tuỳ chỉnh' },
                  { value: 'STANDARD', label: 'Chuẩn Bộ Y tế' },
                ]}
                value={mode}
                onChange={(next) => next && setMode(next)}
              />
              {standard && <span className="text-xs text-slate-500">Mã 14 ký tự xxxxxyyyyyyy-z theo quy định Bộ Y tế</span>}
            </div>
          )}

          <BoxedSection badge="Khuôn mẫu">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bct-template" className="text-sm font-semibold text-slate-800">
                Cú pháp mã <span className="text-rose-500">*</span>
              </label>
              <input
                id="bct-template"
                ref={inputRef}
                value={shownTemplate}
                readOnly={standard}
                onChange={(e) => setTemplate(e.target.value)}
                className={`${inputClassName} ${standard ? readOnlyClassName : ''}`}
              />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {TOKEN_BUTTONS.filter((t) => !t.prescriptionOnly || supportsStandard).map((t) => (
                  <button
                    key={t.token}
                    type="button"
                    disabled={standard}
                    onClick={() => insertToken(t.token)}
                    className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    + {t.label}
                  </button>
                ))}
              </div>
              {!standard && !parseResult.ok && <p className="mt-1 text-xs font-semibold text-rose-600">{parseResult.error}</p>}
              {standard ? (
                <p className="mt-1 text-xs text-slate-500">Khuôn mẫu bị khoá ở chế độ chuẩn. Mã kế tiếp minh hoạ ở bảng bên dưới.</p>
              ) : (
                preview !== null && (
                  <p className="mt-1 text-xs text-slate-500">
                    Mã kế tiếp minh hoạ: <span className="font-semibold text-slate-800">{preview}</span>
                  </p>
                )
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bct-digits" className="text-sm font-semibold text-slate-800">
                  Số chữ số đệm (Số đếm) {!standard && <span className="text-rose-500">*</span>}
                </label>
                <input
                  id="bct-digits"
                  type="number"
                  min={1}
                  max={9}
                  value={shownDigits}
                  readOnly={standard}
                  onChange={(e) => setCounterDigits(e.target.value)}
                  className={`${inputClassName} text-center ${standard ? readOnlyClassName : ''}`}
                />
                {standard && <p className="text-xs text-slate-500">Cố định 7 chữ số</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bct-start" className="text-sm font-semibold text-slate-800">
                  {standard ? 'Đánh số lại' : 'Số bắt đầu đếm'} {!item.locked && !standard && <span className="text-rose-500">*</span>}
                </label>
                <input
                  id="bct-start"
                  type={standard ? 'text' : 'number'}
                  min={1}
                  value={standard ? 'Không' : startingValue}
                  onChange={(e) => setStartingValue(e.target.value)}
                  disabled={standard || item.locked}
                  readOnly={standard}
                  title={item.locked && !standard ? 'Loại mã này đã phát sinh mã đầu tiên — không sửa lại được.' : undefined}
                  className={`${inputClassName} text-center ${standard || item.locked ? 'cursor-not-allowed bg-slate-100 text-slate-500' : ''}`}
                />
                {standard && <p className="text-xs text-slate-500">Mã phải duy nhất, không đánh số lại</p>}
                {item.locked && !standard && <p className="text-[11px] text-slate-500">Đã khoá — loại mã này đã phát sinh mã đầu tiên.</p>}
              </div>
            </div>
          </BoxedSection>

          {standard && (
            <BoxedSection badge={readiness?.multiBranch ? 'Mã cơ sở KCB và mã kế tiếp theo chi nhánh' : 'Mã cơ sở KCB và mã kế tiếp'}>
              {readinessQuery.isLoading && <Skeleton className="h-16 w-full" />}
              {readinessQuery.isError && <p className="text-sm font-semibold text-rose-700">Không tải được danh sách chi nhánh. Đóng hộp thoại và mở lại.</p>}
              {readiness && <ReadinessTable branches={readiness.branches} multiBranch={readiness.multiBranch} />}
              {readiness && (
                <p className="mt-2 text-xs text-slate-500">Chi nhánh dùng chung mã công ty thì dùng chung một bộ đếm (hai chi nhánh cùng mã KCB không được trùng 7 số giữa).</p>
              )}
              <div className="mt-3">
                {readiness && missing.length > 0 && !wasStandard ? (
                  <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700" role="alert">
                    <WarningCircle size={18} weight="fill" className="mt-0.5 flex-none" aria-hidden="true" />
                    <span>
                      Chưa bật được: {missing.map((b) => b.name).join(', ')} chưa có mã cơ sở KCB.{' '}
                      {readiness.multiBranch ? 'Vào Quản trị, Chi nhánh, mục Sửa để nhập (5 chữ số).' : 'Nhập ở Thông tin phòng khám, ô "Mã cơ sở khám chữa bệnh" (5 chữ số).'}
                    </span>
                  </div>
                ) : (
                  <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-700">
                    {wasStandard
                      ? 'Chế độ chuẩn đang bật. Tắt lại được (có xác nhận): đơn đã cấp giữ mã chuẩn, đơn mới quay về mã nội bộ.'
                      : 'Đơn đã ký trước khi lưu giữ nguyên mã cũ. Từ lúc lưu, mỗi đơn ký mới nhận mã chuẩn của chi nhánh đang làm. Tắt lại sau này được (có xác nhận).'}
                  </div>
                )}
              </div>
            </BoxedSection>
          )}
        </div>

        {submitError && <p className="mt-4 text-xs font-semibold text-rose-600">{submitError}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting} disabled={!isValid}>
            Lưu
          </Button>
        </div>
      </form>

      {confirmOff && (
        <ConfirmDialog
          icon={Prohibit}
          tone="danger"
          title="Tắt chế độ Chuẩn Bộ Y tế"
          rows={[{ label: 'Loại mã', value: item.label }]}
          note="Đơn đã cấp giữ mã chuẩn, đơn mới dùng mã nội bộ"
          error={submitError ?? null}
          onClose={() => setConfirmOff(false)}
          actions={
            <>
              <Button type="button" variant="secondary" onClick={() => setConfirmOff(false)} disabled={submitting}>
                Huỷ
              </Button>
              <Button type="button" variant="danger" loading={submitting} onClick={submitNow}>
                Tắt chế độ chuẩn
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
