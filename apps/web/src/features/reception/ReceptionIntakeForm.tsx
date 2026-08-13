import { useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { Combobox, withLegacyValueOption } from '../../shared/ui/Combobox';
import { useDoctorsQuery } from '../appointment/appointment.queries';
import { getVietnamTodayDateString, minutesToLabel, vietnamNowMinutes, vnDateTimeToIso } from '../appointment/schedule-grid.utils';
import { PatientPicker, type PickedPatient } from '../patient/PatientPicker';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useCheckInMutation, useRegisterReceptionMutation } from './reception.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const labelClassName = 'mb-1.5 block text-xs font-semibold text-slate-600';
/** Boxed Section Form Pattern — .claude/docs/ui-guidelines.md mục 9b. */
const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-5 pt-7';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

interface VitalValues {
  pulse: string;
  temperatureC: string;
  bpSystolic: string;
  bpDiastolic: string;
  respiratoryRate: string;
  spo2: string;
  weightKg: string;
  heightCm: string;
}

const EMPTY_VITALS: VitalValues = {
  pulse: '',
  temperatureC: '',
  bpSystolic: '',
  bpDiastolic: '',
  respiratoryRate: '',
  spo2: '',
  weightKg: '',
  heightCm: '',
};

function toNumber(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function VitalField({ id, label, value, onChange, step }: { id: string; label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <div>
      <label className={labelClassName} htmlFor={id}>
        {label}
      </label>
      <input id={id} type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className={inputClassName} />
    </div>
  );
}

export interface ReceptionIntakeCheckinContext {
  appointmentId: string;
  appointmentVersion: number;
  doctorId: string;
  doctorName: string;
  fullName: string;
  phone: string;
  reason?: string;
}

/**
 * Biểu mẫu tiếp nhận DÙNG CHUNG cho cả 2 luồng (`docs/DECISIONS.md` #044) — bệnh nhân, lý do, nguồn
 * khách, loại khám, bác sĩ, sinh hiệu (tuỳ chọn, thiếu thì bác sĩ tự bổ sung ở form phiếu khám
 * sau). `mode='direct'`: trang "Tiếp nhận bệnh nhân" (`/reception/new`), tạo `encounter` trực
 * tiếp, đủ trường ngày giờ/bác sĩ tự chọn. `mode='checkin'`: popup trên panel chi tiết Lịch hẹn,
 * bác sĩ/giờ tiếp nhận đã cố định theo lịch hẹn (không cho sửa ở đây — sửa lịch hẹn thì dùng "Sửa
 * lịch hẹn" riêng), chỉ cần chọn/tạo bệnh nhân + xác nhận loại khám/nguồn khách/sinh hiệu.
 */
export function ReceptionIntakeForm({
  mode,
  checkin,
  onSuccess,
  onCancel,
}: {
  mode: 'direct' | 'checkin';
  checkin?: ReceptionIntakeCheckinContext;
  onSuccess: (encounterNo: string) => void;
  onCancel: () => void;
}) {
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [date, setDate] = useState(getVietnamTodayDateString());
  const [time, setTime] = useState(minutesToLabel(vietnamNowMinutes()));
  const [reason, setReason] = useState(checkin?.reason ?? '');
  const [patientSourceCode, setPatientSourceCode] = useState('');
  const [examTypeCode, setExamTypeCode] = useState('');
  const [doctorId, setDoctorId] = useState(checkin?.doctorId ?? '');
  const [vitals, setVitals] = useState<VitalValues>(EMPTY_VITALS);
  const [error, setError] = useState<string | null>(null);

  const doctorsQuery = useDoctorsQuery();
  const patientSourceQuery = useReferenceCatalogQuery('PATIENT_SOURCE');
  const examTypeQuery = useReferenceCatalogQuery('EXAM_TYPE');
  const registerMutation = useRegisterReceptionMutation();
  const checkInMutation = useCheckInMutation();
  const submitting = registerMutation.isPending || checkInMutation.isPending;

  const doctorOptions = (doctorsQuery.data?.items ?? []).map((d) => ({ value: d.id, label: d.fullName }));
  const patientSourceOptions = withLegacyValueOption(
    (patientSourceQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    patientSourceCode,
  );
  const examTypeItems = examTypeQuery.data?.items ?? [];
  const examTypeOptions = withLegacyValueOption(
    examTypeItems.map((i) => ({ value: i.code, label: i.price !== null ? `${i.name} — ${formatVnd(i.price)}` : i.name })),
    examTypeCode,
  );
  const selectedExamType = examTypeItems.find((i) => i.code === examTypeCode) ?? null;

  const canSubmit = patient !== null && examTypeCode !== '' && (mode === 'checkin' || doctorId !== '');

  function buildVitalsPayload() {
    return {
      pulse: toNumber(vitals.pulse),
      temperatureC: toNumber(vitals.temperatureC),
      bpSystolic: toNumber(vitals.bpSystolic),
      bpDiastolic: toNumber(vitals.bpDiastolic),
      respiratoryRate: toNumber(vitals.respiratoryRate),
      spo2: toNumber(vitals.spo2),
      weightGram: toNumber(vitals.weightKg) !== undefined ? Math.round(Number(vitals.weightKg) * 1000) : undefined,
      heightMm: toNumber(vitals.heightCm) !== undefined ? Math.round(Number(vitals.heightCm) * 10) : undefined,
    };
  }

  async function handleSubmit() {
    if (!patient || !selectedExamType) return;
    setError(null);
    const examTypeFields = {
      patientSourceCode: patientSourceCode === '' ? undefined : patientSourceCode,
      examTypeCode: selectedExamType.code,
      examTypeName: selectedExamType.name,
      examTypePrice: selectedExamType.price ?? 0,
    };
    try {
      if (mode === 'direct') {
        if (doctorId === '') return;
        const created = await registerMutation.mutateAsync({
          patientId: patient.id,
          doctorId,
          checkedInAt: vnDateTimeToIso(date, time),
          chiefComplaint: reason.trim() === '' ? undefined : reason.trim(),
          ...examTypeFields,
          ...buildVitalsPayload(),
        });
        onSuccess(created.encounterNo);
      } else if (checkin) {
        const created = await checkInMutation.mutateAsync({
          appointmentId: checkin.appointmentId,
          patientId: patient.id,
          version: checkin.appointmentVersion,
          chiefComplaint: reason.trim() === '' ? undefined : reason.trim(),
          ...examTypeFields,
          ...buildVitalsPayload(),
        });
        onSuccess(created.encounterNo);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Bệnh nhân</span>
        <PatientPicker value={patient} onChange={setPatient} initialQuery={checkin?.phone} />
      </div>

      <div className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Thông tin tiếp nhận</span>
        <div className="flex flex-col gap-4">
          {mode === 'direct' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="intake-date" className={labelClassName}>
                  Ngày tiếp nhận
                </label>
                <input id="intake-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClassName} />
              </div>
              <div className="flex-1">
                <label htmlFor="intake-time" className={labelClassName}>
                  Giờ tiếp nhận
                </label>
                <input id="intake-time" type="time" step={60} value={time} onChange={(e) => setTime(e.target.value)} className={inputClassName} />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="intake-reason" className={labelClassName}>
              Lý do tiếp nhận
            </label>
            <textarea
              id="intake-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Không bắt buộc"
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="intake-source" className={labelClassName}>
              Nguồn khách
            </label>
            <Combobox
              id="intake-source"
              value={patientSourceCode}
              onChange={setPatientSourceCode}
              options={patientSourceOptions}
              placeholder="Không bắt buộc — gõ để tìm..."
            />
          </div>

          <div>
            <label htmlFor="intake-exam-type" className={labelClassName}>
              Loại khám <span className="text-rose-500">*</span>
            </label>
            <Combobox id="intake-exam-type" value={examTypeCode} onChange={setExamTypeCode} options={examTypeOptions} required />
          </div>

          {mode === 'direct' ? (
            <div>
              <label htmlFor="intake-doctor" className={labelClassName}>
                Bác sĩ khám <span className="text-rose-500">*</span>
              </label>
              <Combobox id="intake-doctor" value={doctorId} onChange={setDoctorId} options={doctorOptions} required />
            </div>
          ) : (
            <div>
              <span className={labelClassName}>Bác sĩ khám</span>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{checkin?.doctorName}</div>
            </div>
          )}
        </div>
      </div>

      <div className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Sinh hiệu (không bắt buộc)</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <VitalField id="intake-pulse" label="Mạch (l/p)" value={vitals.pulse} onChange={(v) => setVitals((p) => ({ ...p, pulse: v }))} />
          <VitalField
            id="intake-temperature"
            label="Nhiệt độ (°C)"
            step="0.1"
            value={vitals.temperatureC}
            onChange={(v) => setVitals((p) => ({ ...p, temperatureC: v }))}
          />
          <VitalField id="intake-spo2" label="SpO2 (%)" value={vitals.spo2} onChange={(v) => setVitals((p) => ({ ...p, spo2: v }))} />
          <VitalField
            id="intake-bp-systolic"
            label="HA tâm thu"
            value={vitals.bpSystolic}
            onChange={(v) => setVitals((p) => ({ ...p, bpSystolic: v }))}
          />
          <VitalField
            id="intake-bp-diastolic"
            label="HA tâm trương"
            value={vitals.bpDiastolic}
            onChange={(v) => setVitals((p) => ({ ...p, bpDiastolic: v }))}
          />
          <VitalField
            id="intake-respiratory-rate"
            label="Nhịp thở (l/p)"
            value={vitals.respiratoryRate}
            onChange={(v) => setVitals((p) => ({ ...p, respiratoryRate: v }))}
          />
          <VitalField
            id="intake-weight"
            label="Cân nặng (kg)"
            step="0.1"
            value={vitals.weightKg}
            onChange={(v) => setVitals((p) => ({ ...p, weightKg: v }))}
          />
          <VitalField
            id="intake-height"
            label="Chiều cao (cm)"
            step="0.1"
            value={vitals.heightCm}
            onChange={(v) => setVitals((p) => ({ ...p, heightCm: v }))}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2.5">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Huỷ
        </Button>
        <Button type="button" disabled={!canSubmit} loading={submitting} onClick={() => void handleSubmit()}>
          {mode === 'direct' ? 'Lưu tiếp nhận' : 'Xác nhận tiếp nhận'}
        </Button>
      </div>
    </div>
  );
}
