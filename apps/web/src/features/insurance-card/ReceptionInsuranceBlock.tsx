import { Plus, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import type { InsuranceCard, PatientDetail } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDobDisplay } from '../../shared/format/date';
import { ApiError } from '../../shared/api/client';
import { useInsuranceEnabledQuery } from '../clinic/clinic.queries';
import { InsuranceCardDialog } from './InsuranceCardDialog';
import { deriveReceptionInsuranceView, formatValidityRange, insuranceBadgeLabel, KIND_LABEL, VALIDITY_LABEL, VALIDITY_TONE } from './insurance-card-view';
import { useInsuranceCardsQuery } from './insurance-card.queries';

const pickBase = 'flex min-w-[220px] flex-col items-start gap-0.5 rounded-lg border px-3.5 py-2 text-left';
const pickIdle = 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:bg-brand-teal-tint';
const pickSelected = 'border-brand-teal bg-brand-teal text-white';

/** Dòng phụ của thẻ chọn: "Thẻ mới · chưa rõ hạn · 80%". */
function pickSubtitle(card: InsuranceCard): string {
  const kind = card.kind === 'NEW_12' ? 'Thẻ mới' : card.kind === 'OLD_15' ? 'Thẻ cũ' : KIND_LABEL.UNKNOWN;
  const range = card.validTo ? `đến ${formatDobDisplay(card.validTo)}` : formatValidityRange(card.validFrom, card.validTo).toLowerCase();
  return [kind, range, card.benefitRate !== null ? `${card.benefitRate}%` : null].filter(Boolean).join(' · ');
}

/**
 * Khối "Thẻ bảo hiểm y tế" ở form Tiếp nhận (S2-04, docs/DECISIONS.md #243, mockup màn 3), nằm ngay dưới phần thông tin bệnh nhân. CHỈ hiện khi công tắc "Áp dụng BHYT" bật.
 * Thẻ được CHỤP vào lượt khám lúc bấm Tiếp nhận. `choice`: `undefined` = theo gợi ý của máy chủ (thẻ còn hiệu lực mới nhất, chọn sẵn — ngoại lệ có chủ đích với quy tắc
 * "không tô sẵn lựa chọn"), `null` = "Không dùng thẻ" (tự chi trả), uuid = đúng thẻ đó. Thẻ hết hạn / không có thẻ chỉ cảnh báo, không chặn tiếp nhận.
 * `patient` = hồ sơ đã khớp; hồ sơ mới (chưa lưu) chưa có thẻ nào nên lượt khám ghi tự chi trả.
 */
export function ReceptionInsuranceBlock({
  patient,
  choice,
  onChoiceChange,
}: {
  patient: PatientDetail | null;
  choice: string | null | undefined;
  onChoiceChange: (choice: string | null | undefined) => void;
}) {
  const enabled = useInsuranceEnabledQuery().data?.enabled === true;
  const cardsQuery = useInsuranceCardsQuery(patient?.id, enabled && patient !== null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!enabled) return null;

  const view = cardsQuery.data ? deriveReceptionInsuranceView(cardsQuery.data.items, cardsQuery.data.suggestedCardId, choice) : null;
  const addButton = (variant: 'primary' | 'secondary') => (
    <Button type="button" variant={variant} className="px-3 py-1.5 text-[13px]" onClick={() => setDialogOpen(true)} disabled={patient === null}>
      <Plus size={13} weight="bold" aria-hidden="true" />
      {variant === 'primary' ? 'Thêm thẻ' : 'Thêm thẻ mới'}
    </Button>
  );

  let body: React.ReactNode;
  if (patient === null) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700">
          <strong className="font-semibold text-slate-900">Hồ sơ bệnh nhân mới.</strong> Lượt khám ghi tự chi trả; thêm thẻ BHYT ở hồ sơ bệnh nhân sau khi tiếp nhận.
        </p>
        <StatusBadge tone="neutral">Tự chi trả</StatusBadge>
      </div>
    );
  } else if (cardsQuery.isPending) {
    body = <Skeleton className="h-12 w-full" />;
  } else if (cardsQuery.isError || view === null) {
    body = <ErrorBanner message={cardsQuery.error instanceof ApiError ? cardsQuery.error.message : 'Không tải được thẻ BHYT.'} onRetry={() => void cardsQuery.refetch()} />;
  } else if (view.mode === 'NO_CARDS') {
    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700">
            <strong className="font-semibold text-slate-900">Bệnh nhân chưa có thẻ BHYT.</strong> Lượt khám ghi tự chi trả.
          </p>
          {addButton('primary')}
        </div>
        <div className="mt-2.5">
          <StatusBadge tone="neutral">Tự chi trả</StatusBadge>
        </div>
      </>
    );
  } else if (view.mode === 'INELIGIBLE') {
    const notStarted = view.card.validity === 'NOT_STARTED';
    body = (
      <>
        <div role="status" className="flex flex-wrap items-center gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          <WarningCircle size={18} weight="fill" className="flex-none text-amber-500" aria-hidden="true" />
          <span>
            Thẻ {view.card.cardNo} {notStarted ? 'chưa đến ngày hiệu lực' : view.card.validTo ? `hết hạn ngày ${formatDobDisplay(view.card.validTo)}` : 'đã hết hạn'}. Lượt khám ghi <b>Tự chi trả</b>.
          </span>
          <span className="flex-1" />
          {addButton('secondary')}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-slate-700">
          <StatusBadge tone={VALIDITY_TONE[view.card.validity]}>{VALIDITY_LABEL[view.card.validity]}</StatusBadge>
          <span>Vẫn tiếp nhận bình thường, không chặn.</span>
        </div>
      </>
    );
  } else {
    const selected = view.selected;
    body = (
      <>
        <div role="radiogroup" aria-label="Thẻ BHYT dùng cho lượt khám" className="flex flex-wrap gap-2.5">
          {view.picks.map((card) => (
            <button
              key={card.id}
              type="button"
              role="radio"
              aria-checked={selected?.id === card.id}
              onClick={() => onChoiceChange(card.id)}
              className={`${pickBase} ${selected?.id === card.id ? pickSelected : pickIdle}`}
            >
              <span className="text-[15px] font-semibold tabular-nums tracking-wide">{card.cardNo}</span>
              <span className="text-xs">{pickSubtitle(card)}</span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={selected === null}
            onClick={() => onChoiceChange(null)}
            className={`${pickBase} min-w-[150px] items-center justify-center ${selected === null ? pickSelected : pickIdle}`}
          >
            <span className="text-sm font-semibold">Không dùng thẻ</span>
            <span className="text-xs">Tự chi trả</span>
          </button>
          <span className="self-center">{addButton('secondary')}</span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-slate-700">
          {selected ? (
            <>
              <StatusBadge tone={VALIDITY_TONE[selected.validity]}>{VALIDITY_LABEL[selected.validity]}</StatusBadge>
              <span>
                {selected.validity === 'UNKNOWN_EXPIRY' ? 'Thẻ không in hạn. Kiểm tra thẻ gốc của khách rồi mới chọn; vẫn ghi ' : 'Lượt khám ghi '}
                <b>{insuranceBadgeLabel({ selfPay: false, benefitRate: selected.benefitRate })}</b>.
                {view.isSuggested && selected.validity === 'VALID' && ' Thẻ gợi ý: thẻ còn hiệu lực thêm gần nhất.'}
              </span>
            </>
          ) : (
            <>
              <StatusBadge tone="neutral">Tự chi trả</StatusBadge>
              <span>Lượt khám ghi tự chi trả (không dùng thẻ).</span>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="relative rounded-lg border border-slate-200 p-5 pt-7">
      <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Thẻ bảo hiểm y tế</span>
      {notice && (
        <p role="status" className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          <WarningCircle size={16} weight="fill" className="mt-0.5 flex-none text-amber-500" aria-hidden="true" />
          {notice}
        </p>
      )}
      {body}
      {dialogOpen && patient && (
        <InsuranceCardDialog
          patientId={patient.id}
          patientName={patient.fullName}
          patientNationalId={patient.nationalId}
          card={null}
          onClose={() => setDialogOpen(false)}
          onSaved={(warnings, photoError) => {
            setDialogOpen(false);
            setNotice(
              [
                warnings.includes('DUPLICATE_CARD_NO') ? 'Số thẻ này đã có trong hồ sơ của bệnh nhân.' : null,
                warnings.includes('UNRECOGNIZED_FORMAT') ? 'Số thẻ chưa đúng 12 chữ số hoặc 15 ký tự chữ+số, đã lưu nhưng nên kiểm tra lại.' : null,
                photoError ? `Thẻ đã lưu nhưng chưa tải được ảnh: ${photoError}` : null,
              ]
                .filter(Boolean)
                .join(' ') || null,
            );
            onChoiceChange(undefined);
          }}
        />
      )}
    </div>
  );
}
