import { PencilSimple, Plus, ShieldCheck, Trash, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import type { InsuranceCard, InsuranceCardWarning, PatientDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDobDisplay } from '../../shared/format/date';
import { useInsuranceEnabledQuery } from '../clinic/clinic.queries';
import { InsuranceCardDialog } from './InsuranceCardDialog';
import { formatValidityRange, KIND_CHIP_CLASS, KIND_LABEL, VALIDITY_LABEL, VALIDITY_TONE } from './insurance-card-view';
import { useInsuranceCardsQuery, useRemoveInsuranceCardMutation } from './insurance-card.queries';

/** Lưới bảng: tiêu đề và dòng dùng CÙNG cột và CÙNG khoảng cách (ui-guidelines mục 14). */
const GRID = 'grid grid-cols-[minmax(150px,1.3fr)_130px_minmax(120px,1fr)_minmax(150px,1.3fr)_80px_120px_72px] gap-x-3.5';

function warningNotice(warnings: InsuranceCardWarning[], photoError: string | null): string | null {
  const parts: string[] = [];
  if (warnings.includes('DUPLICATE_CARD_NO')) parts.push('Số thẻ này đã có trong hồ sơ của bệnh nhân.');
  if (warnings.includes('UNRECOGNIZED_FORMAT')) parts.push('Số thẻ chưa đúng 12 chữ số hoặc 15 ký tự chữ+số, đã lưu nhưng nên kiểm tra lại.');
  if (photoError) parts.push(`Thẻ đã lưu nhưng chưa tải được ảnh: ${photoError}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Khung "Thẻ bảo hiểm y tế" ở tab Thông tin cá nhân của hồ sơ bệnh nhân (S2-04, docs/DECISIONS.md #243, mockup màn 1) — nằm dưới "Thông tin hành chính".
 * CHỈ hiện khi công tắc "Áp dụng BHYT" bật. Thẻ theo bệnh nhân nên dùng chung cả công ty. Quyền: xem = `patient.read`, thêm/sửa/xoá = `patient.update` (`canEdit`).
 */
export function InsuranceCardSection({ patient, canEdit }: { patient: PatientDetail; canEdit: boolean }) {
  const enabledQuery = useInsuranceEnabledQuery();
  const enabled = enabledQuery.data?.enabled === true;
  const cardsQuery = useInsuranceCardsQuery(patient.id, enabled);
  const removeMutation = useRemoveInsuranceCardMutation(patient.id);
  const [dialog, setDialog] = useState<{ card: InsuranceCard | null } | null>(null);
  const [removing, setRemoving] = useState<InsuranceCard | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!enabled) return null;

  const merged = patient.mergedIntoId !== null;
  const mayEdit = canEdit && !merged;
  const items = cardsQuery.data?.items ?? [];

  function handleSaved(warnings: InsuranceCardWarning[], photoError: string | null) {
    setDialog(null);
    setNotice(warningNotice(warnings, photoError));
  }

  async function handleRemove() {
    if (!removing) return;
    setRemoveError(null);
    try {
      await removeMutation.mutateAsync({ cardId: removing.id, version: removing.version });
      setRemoving(null);
      setNotice(null);
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : 'Không xoá được thẻ, vui lòng thử lại.');
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm" aria-label="Thẻ bảo hiểm y tế">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <ShieldCheck size={16} weight="fill" className="text-blue-600" aria-hidden="true" />
          Thẻ bảo hiểm y tế
        </h2>
        {mayEdit && (
          <Button type="button" className="px-3 py-1.5 text-[13px]" onClick={() => setDialog({ card: null })}>
            <Plus size={13} weight="bold" aria-hidden="true" />
            Thêm thẻ
          </Button>
        )}
      </div>

      {notice && (
        <div role="status" className="mx-5 mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          <WarningCircle size={16} weight="fill" className="mt-0.5 flex-none text-amber-500" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {cardsQuery.isPending ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : cardsQuery.isError ? (
        <div className="p-5">
          <ErrorBanner message={cardsQuery.error instanceof ApiError ? cardsQuery.error.message : 'Không tải được thẻ BHYT.'} onRetry={() => void cardsQuery.refetch()} />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-6">
          <div>
            <p className="text-sm font-semibold text-slate-800">Chưa có thẻ BHYT</p>
            <p className="text-sm text-slate-500">Lượt khám mới của bệnh nhân này sẽ ghi tự chi trả cho tới khi có thẻ.</p>
          </div>
          {mayEdit && (
            <Button type="button" variant="add" onClick={() => setDialog({ card: null })}>
              <Plus size={14} weight="bold" aria-hidden="true" />
              Thêm thẻ
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[880px]" role="table" aria-label="Danh sách thẻ BHYT">
            <div role="row" className={`${GRID} border-b-2 border-blue-600 bg-slate-100 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700`}>
              <span role="columnheader">Số thẻ</span>
              <span role="columnheader">Kiểu thẻ</span>
              <span role="columnheader">Hiệu lực</span>
              <span role="columnheader">Nơi đăng ký KCB</span>
              <span role="columnheader">Mức hưởng</span>
              <span role="columnheader">Trạng thái</span>
              <span role="columnheader" className="sr-only">
                Thao tác
              </span>
            </div>
            {items.map((card) => (
              <div key={card.id} role="row" className={`${GRID} items-center border-t border-slate-100 px-5 py-2.5 text-sm`}>
                <span role="cell" className="font-semibold tracking-wide text-slate-900 tabular-nums">
                  {card.cardNo}
                </span>
                <span role="cell">
                  <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${KIND_CHIP_CLASS[card.kind]}`}>{KIND_LABEL[card.kind]}</span>
                </span>
                <span role="cell" className={card.validity === 'UNKNOWN_EXPIRY' ? 'text-slate-500' : 'text-slate-900'}>
                  {card.validFrom && card.validTo ? (
                    <>
                      {formatDobDisplay(card.validFrom)}
                      <span className="block text-xs text-slate-500">đến {formatDobDisplay(card.validTo)}</span>
                    </>
                  ) : (
                    formatValidityRange(card.validFrom, card.validTo)
                  )}
                </span>
                <span role="cell" className="min-w-0">
                  <span className="block truncate text-slate-900" title={card.facilityName ?? undefined}>
                    {card.facilityName ?? '—'}
                  </span>
                  {card.facilityCode && <span className="block text-xs text-slate-500">Mã {card.facilityCode}</span>}
                </span>
                <span role="cell" className="font-semibold tabular-nums text-slate-900">
                  {card.benefitRate !== null ? `${card.benefitRate}%` : '—'}
                </span>
                <span role="cell">
                  <StatusBadge tone={VALIDITY_TONE[card.validity]}>{VALIDITY_LABEL[card.validity]}</StatusBadge>
                </span>
                <span role="cell" className="flex justify-end gap-1">
                  {mayEdit && (
                    <>
                      <RowActionButton icon={PencilSimple} label="Sửa thẻ" onClick={() => setDialog({ card })} />
                      <RowActionButton icon={Trash} label="Xoá thẻ" tone="danger" onClick={() => setRemoving(card)} />
                    </>
                  )}
                </span>
              </div>
            ))}
            <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
              Tiếp nhận tự gợi ý thẻ còn hiệu lực hoặc chưa rõ hạn được thêm gần nhất. Số thẻ được mã hoá khi lưu và hiện rõ cho người có quyền xem bệnh nhân.
            </p>
          </div>
        </div>
      )}

      {dialog && (
        <InsuranceCardDialog
          patientId={patient.id}
          patientName={patient.fullName}
          patientNationalId={patient.nationalId}
          card={dialog.card}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      )}

      {removing && (
        <ConfirmDialog
          icon={Trash}
          tone="danger"
          title="Xoá thẻ BHYT"
          rows={[
            { label: 'Số thẻ', value: removing.cardNo },
            { label: 'Kiểu thẻ', value: KIND_LABEL[removing.kind] },
          ]}
          note="Lượt khám đã tiếp nhận vẫn giữ thẻ đã chụp."
          error={removeError}
          onClose={() => {
            setRemoving(null);
            setRemoveError(null);
          }}
          actions={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRemoving(null);
                  setRemoveError(null);
                }}
              >
                Đóng
              </Button>
              <Button type="button" variant="danger" loading={removeMutation.isPending} onClick={() => void handleRemove()}>
                Xoá thẻ
              </Button>
            </>
          }
        />
      )}
    </section>
  );
}
