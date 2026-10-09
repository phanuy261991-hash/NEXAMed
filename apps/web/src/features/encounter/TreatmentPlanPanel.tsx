import { useEffect, useState } from 'react';
import { CalendarBlank, FileText, Warning, WarningCircle } from '@phosphor-icons/react';
import type { TreatmentDirection } from '@nexamed/shared';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { CheckTile } from '../../shared/ui/CheckTile';
import { DateInput } from '../../shared/ui/DateInput';
import { Textarea } from '../../shared/ui/Textarea';
import { useHasPermission } from '../auth/usePermission';
import { useScheduleConfigQuery } from '../appointment/appointment.queries';
import { AdviceTemplateDialog } from '../advice-template/AdviceTemplateDialog';
import { appendAdviceTexts } from '../advice-template/advice-template.utils';
import {
  FOLLOW_UP_DEFAULT_DAYS,
  FOLLOW_UP_QUICK_DAYS,
  addDaysToDateString,
  closedDayName,
  formatDateStringVi,
  resolveFollowUpFromDate,
  resolveFollowUpFromDays,
  vietnameseWeekdayLabel,
} from './follow-up-date';
import { TREATMENT_DIRECTION_LABEL, TREATMENT_DIRECTION_ORDER, type TreatmentPlanDraft } from './treatment-plan';

/**
 * Nội dung tab "Điều trị & Hẹn tái khám" (docs/DECISIONS.md #222, mockup đã duyệt): khung "Điều trị" (Hướng điều trị chọn nhiều hướng, Nội dung điều trị, Lời dặn bác sĩ kèm nút "Mẫu lời dặn")
 * và khung "Hẹn tái khám" (chỉ hiện khi tích hướng "Hẹn tái khám": nhập số ngày hoặc chọn ngày, ô còn lại tự đổi theo, tính từ NGÀY KHÁM). Dùng cả ở tab (soạn / xem) lẫn hộp thoại "Đính chính điều trị"
 * (`idPrefix` khác nhau để id không trùng khi cùng hiện). Chỉ ghi nhận — không đổi trạng thái lượt khám, không tự tạo lịch hẹn.
 */
export function TreatmentPlanPanel({
  idPrefix,
  plan,
  onPlanChange,
  content,
  onContentChange,
  advice,
  onAdviceChange,
  examDate,
  readOnly,
}: {
  idPrefix: string;
  plan: TreatmentPlanDraft;
  onPlanChange: (plan: TreatmentPlanDraft) => void;
  content: string;
  onContentChange: (value: string) => void;
  advice: string;
  onAdviceChange: (value: string) => void;
  /** Ngày khám `YYYY-MM-DD` (giờ Việt Nam) — mốc tính số ngày hẹn. */
  examDate: string;
  readOnly: boolean;
}) {
  const canReadTemplates = useHasPermission('advice_template', 'read');
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const followUpOn = plan.directions.includes('FOLLOW_UP');
  // Giờ làm việc phòng khám — chỉ để nhắc nhẹ khi ngày hẹn rơi vào ngày nghỉ; không có quyền đọc lịch hẹn thì bỏ qua (không gọi API, tránh 403).
  const canReadSchedule = useHasPermission('appointment', 'read');
  const scheduleConfigQuery = useScheduleConfigQuery({ enabled: followUpOn && !readOnly && canReadSchedule });
  const resolved = plan.followUpDate !== null ? resolveFollowUpFromDate(examDate, plan.followUpDate) : null;

  // Số ngày đang gõ (chuỗi, để gõ dở như "" hay "1" không bị ép về ngày hợp lệ ngay) — đồng bộ ngược từ ngày hẹn khi ngày đổi từ nguồn khác (chọn ngày, chip, nạp từ server).
  const [daysText, setDaysText] = useState(() => (resolved?.ok ? String(resolved.days) : ''));
  useEffect(() => {
    if (resolved?.ok && Number(daysText) !== resolved.days) setDaysText(String(resolved.days));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ đồng bộ khi ngày hẹn đổi; `daysText` là kết quả của chính lần gõ vừa rồi.
  }, [plan.followUpDate]);

  const daysFromText = /^\d+$/.test(daysText.trim()) ? Number(daysText) : Number.NaN;
  const daysResolution = daysText.trim() === '' ? null : resolveFollowUpFromDays(examDate, daysFromText);
  const closedDay = resolved?.ok ? closedDayName(scheduleConfigQuery.data?.businessHours, resolved.date) : null;
  const error = daysResolution && !daysResolution.ok ? daysResolution.message : resolved && !resolved.ok ? resolved.message : null;

  function setDirection(direction: TreatmentDirection, checked: boolean) {
    const directions = TREATMENT_DIRECTION_ORDER.filter((d) => (d === direction ? checked : plan.directions.includes(d)));
    if (direction !== 'FOLLOW_UP') {
      onPlanChange({ ...plan, directions });
      return;
    }
    if (!checked) {
      onPlanChange({ directions, followUpDate: null });
      return;
    }
    // Vừa tích: mặc định hẹn sau 7 ngày (bác sĩ đổi ngay được).
    const date = plan.followUpDate ?? addDaysToDateString(examDate, FOLLOW_UP_DEFAULT_DAYS);
    setDaysText(String(FOLLOW_UP_DEFAULT_DAYS));
    onPlanChange({ directions, followUpDate: date });
  }

  function handleDaysChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, 3);
    setDaysText(digits);
    const r = digits === '' ? null : resolveFollowUpFromDays(examDate, Number(digits));
    onPlanChange({ ...plan, followUpDate: r?.ok ? r.date : null });
  }

  function handleDateChange(iso: string) {
    onPlanChange({ ...plan, followUpDate: iso === '' ? null : iso });
  }

  return (
    <div className="flex flex-col gap-6">
      <BoxedSection badge="Điều trị">
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-slate-800">
            Hướng điều trị <span className="ml-1.5 text-xs font-normal text-slate-500">Chọn được nhiều hướng cùng lúc</span>
          </legend>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {TREATMENT_DIRECTION_ORDER.map((d) => (
              <CheckTile
                key={d}
                id={`${idPrefix}-direction-${d}`}
                label={TREATMENT_DIRECTION_LABEL[d]}
                checked={plan.directions.includes(d)}
                disabled={readOnly}
                tone={d === 'EMERGENCY' ? 'danger' : 'default'}
                onChange={(checked) => setDirection(d, checked)}
              />
            ))}
          </div>
        </fieldset>

        <div className="mt-4 space-y-4">
          <Textarea id={`${idPrefix}-content`} label="Nội dung điều trị" rows={4} value={content} onChange={(e) => onContentChange(e.target.value)} readOnly={readOnly} placeholder={readOnly ? undefined : 'Nhập nội dung điều trị…'} />
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor={`${idPrefix}-advice`} className="block text-sm font-semibold text-slate-800">
                Lời dặn bác sĩ
              </label>
              {!readOnly && canReadTemplates && (
                <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setTemplateDialogOpen(true)}>
                  <FileText size={14} weight="regular" aria-hidden="true" />
                  Mẫu lời dặn
                </Button>
              )}
            </div>
            <Textarea id={`${idPrefix}-advice`} label="Lời dặn bác sĩ" hideLabel rows={4} value={advice} onChange={(e) => onAdviceChange(e.target.value)} readOnly={readOnly} placeholder={readOnly ? undefined : 'Lời dặn cho bệnh nhân…'} />
          </div>
        </div>
      </BoxedSection>

      {followUpOn && (
        <BoxedSection badge="Hẹn tái khám">
          <div className={`grid grid-cols-1 gap-4 ${readOnly ? '' : 'md:grid-cols-[minmax(0,240px)_minmax(0,230px)_minmax(0,1fr)]'}`}>
            {!readOnly && (
              <>
                <div>
                  <label htmlFor={`${idPrefix}-follow-up-days`} className="mb-1 block text-sm font-semibold text-slate-800">
                    Hẹn sau
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id={`${idPrefix}-follow-up-days`}
                      inputMode="numeric"
                      value={daysText}
                      onChange={(e) => handleDaysChange(e.target.value)}
                      className="w-24 rounded-md border border-slate-300 px-3 py-2 text-center text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <span className="text-sm font-semibold text-slate-700">ngày</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {FOLLOW_UP_QUICK_DAYS.map((n) => (
                      <Button key={n} type="button" variant={resolved?.ok && resolved.days === n ? 'primary' : 'secondary'} className="px-3 py-1 text-xs" onClick={() => handleDaysChange(String(n))}>
                        {n} ngày
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor={`${idPrefix}-follow-up-date`} className="mb-1 block text-sm font-semibold text-slate-800">
                    Hoặc chọn ngày hẹn
                  </label>
                  <DateInput id={`${idPrefix}-follow-up-date`} value={plan.followUpDate ?? ''} onChange={handleDateChange} />
                  <p className="mt-1 text-xs text-slate-500">Gõ ngày hoặc số ngày, ô còn lại tự đổi theo.</p>
                </div>
              </>
            )}
            <div>
              <div className="mb-1 text-sm font-semibold text-slate-800">Ngày hẹn tái khám</div>
              <div
                aria-live="polite"
                className={`flex min-h-[38px] items-center gap-2.5 rounded-md border px-3 py-1.5 ${error ? 'border-rose-500 text-rose-600' : 'border-slate-300 bg-slate-50 text-slate-900'}`}
              >
                {error ? <WarningCircle size={17} weight="fill" className="flex-none" aria-hidden="true" /> : <CalendarBlank size={17} weight="regular" className="flex-none text-blue-600" aria-hidden="true" />}
                {resolved?.ok && !error ? (
                  <>
                    <span className="min-w-0 flex-1 text-[15px] font-semibold">
                      {vietnameseWeekdayLabel(resolved.date)}, {formatDateStringVi(resolved.date)}
                    </span>
                    <span className="flex-none rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">sau {resolved.days} ngày</span>
                  </>
                ) : (
                  <span className={`min-w-0 flex-1 text-sm ${error ? 'font-semibold' : 'text-slate-500'}`}>{error ?? 'Chưa chọn ngày hẹn'}</span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">Tính từ ngày khám {formatDateStringVi(examDate)}</p>
              {!readOnly && !error && closedDay && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-amber-700" role="status">
                  <Warning size={14} weight="fill" className="mt-px flex-none" aria-hidden="true" />
                  Phòng khám nghỉ {closedDay} theo giờ làm việc đã cấu hình. Vẫn có thể giữ ngày này.
                </p>
              )}
            </div>
          </div>
        </BoxedSection>
      )}

      {templateDialogOpen && <AdviceTemplateDialog onInsert={(texts) => onAdviceChange(appendAdviceTexts(advice, texts))} onClose={() => setTemplateDialogOpen(false)} />}
    </div>
  );
}
