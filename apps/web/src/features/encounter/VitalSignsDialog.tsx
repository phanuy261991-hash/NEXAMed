import { useState } from 'react';
import { Heartbeat } from '@phosphor-icons/react';
import type { VitalSignResponse } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { useRecordVitalSignsMutation } from './encounter.queries';

interface FieldState {
  pulse: string;
  temperatureC: string;
  bpSystolic: string;
  bpDiastolic: string;
  respiratoryRate: string;
  spo2: string;
  weightKg: string;
  heightCm: string;
}

function toFieldState(vitals: VitalSignResponse | null): FieldState {
  return {
    pulse: vitals?.pulse != null ? String(vitals.pulse) : '',
    temperatureC: vitals?.temperatureC != null ? String(vitals.temperatureC) : '',
    bpSystolic: vitals?.bpSystolic != null ? String(vitals.bpSystolic) : '',
    bpDiastolic: vitals?.bpDiastolic != null ? String(vitals.bpDiastolic) : '',
    respiratoryRate: vitals?.respiratoryRate != null ? String(vitals.respiratoryRate) : '',
    spo2: vitals?.spo2 != null ? String(vitals.spo2) : '',
    weightKg: vitals?.weightGram != null ? String(vitals.weightGram / 1000) : '',
    heightCm: vitals?.heightMm != null ? String(vitals.heightMm / 10) : '',
  };
}

function toNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Bổ sung/đo lại sinh hiệu ngay trong màn khám — dùng khi lễ tân chưa nhập lúc tiếp nhận hoặc bác
 * sĩ cần ghi nhận lần đo mới (REC-02/03, `POST /reception/encounters/:id/vital-signs` — hạ tầng có
 * sẵn từ Sprint 3, lần đầu có UI web gọi tới). Cùng khuôn overlay/card `RoomSessionDialog.tsx` —
 * không có `Dialog` primitive dùng chung trong dự án.
 */
export function VitalSignsDialog({
  encounterId,
  current,
  onClose,
}: {
  encounterId: string;
  current: VitalSignResponse | null;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<FieldState>(() => toFieldState(current));
  const [error, setError] = useState<string | null>(null);
  const mutation = useRecordVitalSignsMutation(encounterId);

  function set<K extends keyof FieldState>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setError(null);
    const weightKg = toNumber(fields.weightKg);
    const heightCm = toNumber(fields.heightCm);
    const body = {
      pulse: toNumber(fields.pulse),
      temperatureC: toNumber(fields.temperatureC),
      bpSystolic: toNumber(fields.bpSystolic),
      bpDiastolic: toNumber(fields.bpDiastolic),
      respiratoryRate: toNumber(fields.respiratoryRate),
      spo2: toNumber(fields.spo2),
      weightGram: weightKg !== undefined ? Math.round(weightKg * 1000) : undefined,
      heightMm: heightCm !== undefined ? Math.round(heightCm * 10) : undefined,
    };
    if (Object.values(body).every((v) => v === undefined)) {
      setError('Phải nhập ít nhất một chỉ số sinh hiệu.');
      return;
    }
    try {
      await mutation.mutateAsync(body);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được sinh hiệu, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby="vital-signs-title">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="px-6 pb-5 pt-6">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 ring-8 ring-blue-100/60">
            <Heartbeat size={22} weight="fill" className="text-blue-600" />
          </div>
          <h2 id="vital-signs-title" className="text-[16px] font-bold text-slate-900">
            {current ? 'Cập nhật sinh hiệu' : 'Bổ sung sinh hiệu'}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            {current ? 'Ghi lại lần đo mới — thay thế giá trị hiển thị hiện tại.' : 'Lễ tân chưa nhập sinh hiệu lúc tiếp nhận — bác sĩ có thể bổ sung ở đây.'}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <VitalInput id="vs-pulse" label="Mạch (l/p)" value={fields.pulse} onChange={(v) => set('pulse', v)} />
            <VitalInput id="vs-temp" label="Nhiệt độ (°C)" value={fields.temperatureC} onChange={(v) => set('temperatureC', v)} step="0.1" />
            <VitalInput id="vs-spo2" label="SpO2 (%)" value={fields.spo2} onChange={(v) => set('spo2', v)} />
            <VitalInput id="vs-rr" label="Nhịp thở (l/p)" value={fields.respiratoryRate} onChange={(v) => set('respiratoryRate', v)} />
            <VitalInput id="vs-bps" label="HA tâm thu" value={fields.bpSystolic} onChange={(v) => set('bpSystolic', v)} />
            <VitalInput id="vs-bpd" label="HA tâm trương" value={fields.bpDiastolic} onChange={(v) => set('bpDiastolic', v)} />
            <VitalInput id="vs-weight" label="Cân nặng (kg)" value={fields.weightKg} onChange={(v) => set('weightKg', v)} step="0.1" />
            <VitalInput id="vs-height" label="Chiều cao (cm)" value={fields.heightCm} onChange={(v) => set('heightCm', v)} step="0.1" />
          </div>

          {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={() => void handleSubmit()}>
            Lưu sinh hiệu
          </Button>
        </div>
      </div>
    </div>
  );
}

function VitalInput({
  id,
  label,
  value,
  onChange,
  step,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={step ?? '1'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
    </div>
  );
}