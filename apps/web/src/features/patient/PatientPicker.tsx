import { useState } from 'react';
import { MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import type { PatientSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { Button } from '../../shared/ui/Button';
import { useCreatePatientMutation, usePatientSearchQuery } from './patient.queries';
import { EMPTY_PATIENT_FORM, PatientFormFields, type PatientFormValues } from './PatientFormFields';
import { toCreatePatientRequest } from './patient-form.utils';

export interface PickedPatient {
  id: string;
  fullName: string;
  patientCode: string;
}

/**
 * Tìm + chọn bệnh nhân, có lối tắt "Tạo bệnh nhân mới" khi không tìm ra hồ sơ — dùng cho form đặt
 * lịch nhanh (S2-09). Đặt ở `features/patient/` (thuộc domain bệnh nhân, không phải UI primitive
 * chung) — điểm vào thứ hai cho việc tạo bệnh nhân, đúng hướng đã chốt ở docs/DECISIONS.md #027
 * ("điểm vào cụ thể quyết định khi làm S2-09/S3"). Tái dùng nguyên `PatientFormFields`/
 * `toCreatePatientRequest`/`useCreatePatientMutation` đã có — không viết lại form tạo bệnh nhân.
 */
export function PatientPicker({
  value,
  onChange,
  initialQuery,
}: {
  value: PickedPatient | null;
  onChange: (patient: PickedPatient | null) => void;
  /** Tự điền + chạy tìm kiếm ngay khi mount (Sprint 3, trang Tiếp nhận truyền SĐT của lịch hẹn để
   * lễ tân thấy ngay danh sách khách hàng trùng SĐT, không phải gõ lại thủ công). */
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery ?? '');
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<PatientFormValues>(EMPTY_PATIENT_FORM);
  const [createError, setCreateError] = useState<string | null>(null);

  const debouncedQ = useDebouncedValue(q, 300);
  const searchQuery = usePatientSearchQuery(debouncedQ);
  const createMutation = useCreatePatientMutation();

  async function handleCreate() {
    setCreateError(null);
    try {
      const created = await createMutation.mutateAsync(toCreatePatientRequest(createForm));
      onChange({ id: created.id, fullName: created.fullName, patientCode: created.patientCode });
      setCreating(false);
      setCreateForm(EMPTY_PATIENT_FORM);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  if (value) {
    return (
      <div>
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">Bệnh nhân</span>
        <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">{value.fullName}</div>
            <div className="text-xs text-slate-500">{value.patientCode}</div>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs font-medium text-slate-400 underline hover:text-slate-600"
          >
            Đổi
          </button>
        </div>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="rounded-md border border-slate-200 p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-600">Tạo bệnh nhân mới</span>
          <button type="button" onClick={() => setCreating(false)} className="text-slate-400 hover:text-slate-600" aria-label="Đóng">
            <X size={16} weight="bold" />
          </button>
        </div>
        <PatientFormFields values={createForm} onChange={setCreateForm} />
        {createError && (
          <p role="alert" className="mt-3 text-xs text-rose-600">
            {createError}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
            Huỷ
          </Button>
          <Button type="button" loading={createMutation.isPending} onClick={() => void handleCreate()}>
            Tạo và chọn
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">Bệnh nhân</span>
      <div className="relative">
        <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo tên, SĐT hoặc mã bệnh nhân…"
          className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      {debouncedQ && searchQuery.isSuccess && (
        <div className="mt-2 flex flex-col gap-1.5">
          {searchQuery.data.items.map((p: PatientSummary) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange({ id: p.id, fullName: p.fullName, patientCode: p.patientCode })}
              className="rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
            >
              <div className="text-sm font-semibold text-slate-900">{p.fullName}</div>
              <div className="text-xs text-slate-500">
                {p.patientCode} · {p.dob}
              </div>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 px-3 py-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
      >
        <Plus size={14} weight="bold" aria-hidden="true" />
        Không tìm thấy? Tạo bệnh nhân mới
      </button>
    </div>
  );
}
