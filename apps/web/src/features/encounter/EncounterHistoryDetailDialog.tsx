import { useEffect } from 'react';
import { CalendarBlank, CheckCircle, Heartbeat, Pill, Stethoscope, X } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { Button } from '../../shared/ui/Button';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { ENCOUNTER_STATUS_META } from '../reception/encounter-status';
import { CLINICAL_SECTION_LABEL, DIAGNOSIS_TYPE_LABEL, VitalChip, classifyBmi, type ClinicalKey } from './clinical-display';
import { PrescriptionItemsTable } from './PrescriptionPanel';
import { useConsultationDetailQuery } from './encounter.queries';

/** Bắt buộc (`hasRequiredClinicalFields` ở `EncounterConsultationPage.tsx`) — chỉ dùng để hiện dấu `*`, dữ liệu ở đây luôn chỉ đọc. */
const REQUIRED_CLINICAL_KEYS = new Set<ClinicalKey>(['reasonForVisit', 'preliminaryDiagnosis']);

function formatVisitDateTime(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  const date = `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
  const time = `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
  return `${date} · ${time}`;
}

/**
 * "Xem chi tiết đợt khám cũ" (mockup đã duyệt 2026-08-29) — mở từ thẻ trong panel "Lịch sử khám"
 * (`EncounterConsultationPage.tsx`). CHỈ ĐỌC tuyệt đối: không ô nhập, không nút Sửa/Đính chính nào
 * — đúng nguyên tắc bản ghi đã ký là bất biến. Tái dùng `GET /encounters/:id/consultation` sẵn có
 * (không thêm endpoint mới) và đúng khối trực quan đã dùng ở màn khám đang chỉnh sửa (`clinical-display.tsx`,
 * `PrescriptionItemsTable`) để không tạo ngôn ngữ thị giác thứ hai cho cùng một loại dữ liệu.
 *
 * `history` (nguồn của `EncounterHistoryItem`) KHÔNG lọc theo `status` — đợt khám cũ có thể chưa
 * `COMPLETED` (ví dụ bác sĩ đang khám dở ca khác cùng lúc, #088 xác nhận đây là hành vi có chủ đích
 * chứ không phải bug) nên dialog phải tự chịu được trường hợp chưa ký: không hiện dòng "Đã ký lúc",
 * ô ghi chú/chẩn đoán có thể rỗng.
 */
export function EncounterHistoryDetailDialog({
  encounterId,
  doctorName,
  onClose,
}: {
  encounterId: string;
  doctorName: string | null;
  onClose: () => void;
}) {
  const query = useConsultationDetailQuery(encounterId);
  const receptionTypeCatalogQuery = useReferenceCatalogQuery('RECEPTION_TYPE');

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-detail-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng cửa sổ"
          className="absolute right-3.5 top-3.5 z-10 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={16} weight="bold" aria-hidden="true" />
        </button>

        {query.isPending && (
          <div className="space-y-4 p-6">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        )}

        {query.isError && (
          <div className="p-6">
            <ErrorBanner
              message={query.error instanceof ApiError ? query.error.message : 'Không tải được chi tiết đợt khám.'}
              onRetry={() => void query.refetch()}
            />
          </div>
        )}

        {query.isSuccess && (
          <DialogContent
            data={query.data}
            doctorName={doctorName}
            receptionTypeName={
              query.data.encounter.receptionTypeCode
                ? (receptionTypeCatalogQuery.data?.items.find((i) => i.code === query.data.encounter.receptionTypeCode)?.name ?? null)
                : null
            }
          />
        )}

        <div className="flex flex-shrink-0 justify-end border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}

function DialogContent({
  data,
  doctorName,
  receptionTypeName,
}: {
  data: NonNullable<ReturnType<typeof useConsultationDetailQuery>['data']>;
  doctorName: string | null;
  receptionTypeName: string | null;
}) {
  const { encounter, vitalSigns, diagnoses, clinicalNote, prescription } = data;
  const statusMeta = ENCOUNTER_STATUS_META[encounter.status];
  const signedAt = clinicalNote.reasonForVisit?.signedAt ?? null;
  const amended = Boolean(clinicalNote.reasonForVisit?.amendmentReason);
  const bmi = vitalSigns?.weightGram && vitalSigns.heightMm ? vitalSigns.weightGram / 1000 / (vitalSigns.heightMm / 1000) ** 2 : null;
  const bmiClass = bmi != null ? classifyBmi(bmi) : null;
  const warningFields = new Set((vitalSigns?.warnings ?? []).map((w) => w.field));

  return (
    <>
      <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Chi tiết đợt khám</p>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="history-detail-title" className="flex items-center gap-1.5 text-lg font-bold text-slate-900">
              <CalendarBlank size={16} weight="bold" className="text-slate-400" aria-hidden="true" />
              {formatVisitDateTime(encounter.checkedInAt)}
            </h2>
            <span className="whitespace-nowrap rounded-full bg-brand-teal-tint px-2.5 py-0.5 text-[11px] font-semibold text-brand-teal-active">
              {encounter.encounterNo}
            </span>
            <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusMeta.bg} ${statusMeta.text}`}>
              {statusMeta.label}
            </span>
            {receptionTypeName && (
              <span className="whitespace-nowrap rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue-700">
                {receptionTypeName}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span>
              Bác sĩ: <strong className="font-bold text-slate-900">{doctorName ?? '—'}</strong>
            </span>
            {signedAt && (
              <>
                <span className="text-slate-300">|</span>
                <span>
                  Đã ký lúc: <strong className="font-bold text-slate-900">{new Date(signedAt).toLocaleString('vi-VN')}</strong>
                  {amended && <span className="ml-1 font-semibold text-blue-600">(bản đính chính)</span>}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="scroll-hover flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-5">
          <div className="relative rounded-lg border border-slate-200 bg-white p-5 pt-8 shadow-sm">
            <span className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
              <Heartbeat size={12} weight="bold" aria-hidden="true" />
              Sinh hiệu lúc khám
            </span>
            {vitalSigns ? (
              <div className="flex flex-wrap items-stretch divide-x divide-slate-300 rounded-lg border border-slate-200 bg-slate-100">
                <VitalChip label="Mạch" value={vitalSigns.pulse} unit="l/p" tier={warningFields.has('pulse') ? 'danger' : 'normal'} />
                <VitalChip
                  label="Huyết áp"
                  value={vitalSigns.bpSystolic != null && vitalSigns.bpDiastolic != null ? `${vitalSigns.bpSystolic}/${vitalSigns.bpDiastolic}` : null}
                  unit="mmHg"
                  tier={warningFields.has('bpSystolic') || warningFields.has('bpDiastolic') ? 'danger' : 'normal'}
                />
                <VitalChip label="Nhiệt độ" value={vitalSigns.temperatureC} unit="°C" tier={warningFields.has('temperatureC') ? 'danger' : 'normal'} />
                <VitalChip label="SpO2" value={vitalSigns.spo2} unit="%" tier={warningFields.has('spo2') ? 'danger' : 'normal'} />
                <VitalChip
                  label="Cân nặng"
                  value={vitalSigns.weightGram != null ? Math.round(vitalSigns.weightGram / 1000) : null}
                  unit="kg"
                  tier={warningFields.has('weightGram') ? 'danger' : 'normal'}
                />
                <VitalChip label="BMI" value={bmi != null ? bmi.toFixed(1) : null} unit="" tier={bmi != null ? bmiClass?.tier : 'normal'} sublabel={bmiClass?.label} />
              </div>
            ) : (
              <p className="text-xs text-slate-400">Chưa ghi nhận sinh hiệu ở đợt khám này.</p>
            )}
          </div>

          <div className="relative rounded-lg border border-slate-200 bg-white p-5 pt-8 shadow-sm">
            <span className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
              <Stethoscope size={12} weight="bold" aria-hidden="true" />
              Thông tin khám lâm sàng
            </span>

            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-700">Thăm khám</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(CLINICAL_SECTION_LABEL) as ClinicalKey[]).map((key) => (
                <div key={key}>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">
                    {CLINICAL_SECTION_LABEL[key]}
                    {REQUIRED_CLINICAL_KEYS.has(key) && <span className="text-rose-500"> *</span>}
                  </label>
                  <div className="min-h-[46px] rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[13px] leading-relaxed">
                    {clinicalNote[key]?.content ? (
                      <span className="font-medium text-slate-900">{clinicalNote[key]?.content}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-2 mt-4 border-t border-dashed border-slate-200 pt-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Chẩn đoán bệnh (ICD-10)</h3>
            </div>
            <div className="flex flex-col gap-1.5">
              {diagnoses.length === 0 && <p className="text-xs text-slate-400">Chưa có chẩn đoán nào.</p>}
              {diagnoses.map((d) => (
                <div
                  key={d.id}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                    d.type === 'PRIMARY' ? 'border-l-4 border-l-blue-600 border-y-slate-200 border-r-slate-200 bg-blue-50' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="text-sm text-slate-900">
                    <span
                      className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        d.type === 'PRIMARY' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {DIAGNOSIS_TYPE_LABEL[d.type]}
                    </span>
                    <strong>{d.icd10Code}</strong> — {d.icd10Name}
                    {d.amendmentReason && <span className="ml-1.5 text-[11px] font-medium text-blue-600">(đã đính chính)</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative rounded-lg border border-slate-200 bg-white p-5 pt-8 shadow-sm">
            <span className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-md bg-brand-teal px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
              <Pill size={12} weight="bold" aria-hidden="true" />
              Đơn thuốc
            </span>
            {prescription ? (
              <>
                {prescription.signedAt && (
                  <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                    <CheckCircle size={16} weight="fill" aria-hidden="true" />
                    Đã ký lúc {new Date(prescription.signedAt).toLocaleString('vi-VN')}
                    {prescription.amendmentReason && ' (bản đính chính)'}
                  </p>
                )}
                <PrescriptionItemsTable items={prescription.items} />
              </>
            ) : (
              <p className="text-xs text-slate-400">Chưa kê đơn thuốc cho đợt khám này.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}