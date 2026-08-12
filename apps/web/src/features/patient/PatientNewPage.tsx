import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Warning } from '@phosphor-icons/react';
import type { PatientSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { checkPatientDuplicate } from './patient.api';
import { useCreatePatientMutation } from './patient.queries';
import { EMPTY_PATIENT_FORM, PatientFormFields, type PatientFormValues } from './PatientFormFields';
import { toCreatePatientRequest } from './patient-form.utils';

/**
 * Tạo hồ sơ bệnh nhân mới (PAT-01) — luồng chống trùng (PAT-03) đã chốt với chủ dự án: kiểm tra
 * LÚC bấm Lưu (không debounce theo từng ký tự), nghi trùng thì chặn submit lần đầu và hiện cảnh
 * báo kèm nút "Vẫn tạo mới"/"Huỷ" — không tự động tạo khi đang nghi trùng.
 */
export function PatientNewPage() {
  useBreadcrumb([
    { label: 'Tiếp nhận và Đặt lịch' },
    { label: 'Danh sách bệnh nhân', to: '/patients' },
    { label: 'Thêm bệnh nhân' },
  ]);

  const navigate = useNavigate();
  const createMutation = useCreatePatientMutation();

  const [values, setValues] = useState<PatientFormValues>(EMPTY_PATIENT_FORM);
  const [duplicates, setDuplicates] = useState<PatientSummary[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  async function create() {
    setApiError(null);
    try {
      const created = await createMutation.mutateAsync(toCreatePatientRequest(values));
      navigate(`/patients/${created.id}`, { replace: true });
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiError(null);
    setChecking(true);
    try {
      const result = await checkPatientDuplicate(values.fullName, values.dob);
      if (result.items.length > 0) {
        setDuplicates(result.items);
        return;
      }
      await create();
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setChecking(false);
    }
  }

  const submitting = checking || createMutation.isPending;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Thêm bệnh nhân</h1>

      {duplicates && duplicates.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
            <Warning size={20} weight="fill" aria-hidden="true" />
            Có thể trùng với hồ sơ đã có
          </div>
          <ul className="mb-3 space-y-1 text-sm text-amber-800">
            {duplicates.map((p) => (
              <li key={p.id}>
                <Link to={`/patients/${p.id}`} target="_blank" className="underline hover:text-amber-900">
                  {p.patientCode} — {p.fullName} — {p.dob}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setDuplicates(null)}>
              Huỷ
            </Button>
            <Button type="button" loading={createMutation.isPending} onClick={() => void create()}>
              Vẫn tạo mới
            </Button>
          </div>
        </div>
      )}

      {apiError && (
        <p role="alert" className="mb-6 text-sm text-rose-600">
          {apiError}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="rounded-lg bg-white p-6 shadow-sm">
        <PatientFormFields values={values} onChange={setValues} disabled={duplicates !== null} />

        {!duplicates && (
          <div className="mt-6 flex justify-end">
            <Button type="submit" loading={submitting}>
              Lưu
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
