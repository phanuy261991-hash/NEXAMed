import { useState } from 'react';
import type { PatientSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { useMergePatientsMutation } from './patient-merge.queries';

type MergePatientsDialogProps =
  | { mode: 'choose'; candidates: [PatientSummary, PatientSummary]; onClose: () => void; onSuccess: () => void }
  | { mode: 'confirm'; source: PatientSummary; target: PatientSummary; onClose: () => void; onSuccess: () => void };

/**
 * Gộp hồ sơ trùng (S5-06, PAT-04) — 2 luồng vào cùng dùng chung dialog này:
 * - `mode: 'choose'` (Entry 1, chọn 2 dòng ở Danh sách bệnh nhân): chưa biết ai giữ ai gộp, hiện 2
 *   thẻ cạnh nhau để chọn trước.
 * - `mode: 'confirm'` (Entry 2, nút "Gộp vào hồ sơ khác" ở Chi tiết bệnh nhân): đã biết rõ nguồn
 *   (hồ sơ đang xem) và đích (hồ sơ vừa tìm/chọn), vào thẳng bước xác nhận.
 * Chỉ 1 lựa chọn nhị phân "giữ ai" — không có UI so sánh field theo từng bên (đã hỏi và chốt: chỉ
 * chuyển `encounter` + 3 bảng tiền sử, không đụng field nào khác của hồ sơ đích).
 */
export function MergePatientsDialog(props: MergePatientsDialogProps) {
  const [resolved, setResolved] = useState<{ source: PatientSummary; target: PatientSummary } | null>(
    props.mode === 'confirm' ? { source: props.source, target: props.target } : null,
  );
  const mutation = useMergePatientsMutation();

  async function handleConfirm() {
    if (!resolved) return;
    try {
      await mutation.mutateAsync({ sourceId: resolved.source.id, targetId: resolved.target.id });
      props.onSuccess();
    } catch {
      // Giữ dialog mở, hiện lỗi ngay bên dưới (mutation.isError) — cùng khuôn ReleaseEncounterDialog.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4" role="dialog" aria-modal="true" aria-labelledby="merge-patients-title">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl">
        {!resolved && props.mode === 'choose' && (
          <>
            <h3 id="merge-patients-title" className="text-base font-bold text-slate-900">
              Chọn hồ sơ giữ lại
            </h3>
            <p className="mt-1.5 text-sm font-medium text-slate-700">
              Hồ sơ còn lại sẽ chuyển toàn bộ lượt khám, tiền sử và dị ứng sang hồ sơ bạn chọn giữ — không xóa, chỉ ngừng dùng để tạo lượt khám mới.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {props.candidates.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="font-semibold text-slate-900">{p.fullName}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Mã BN {p.patientCode} · {p.phone}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-3 w-full"
                    onClick={() => {
                      const other = props.candidates.find((c) => c.id !== p.id)!;
                      setResolved({ target: p, source: other });
                    }}
                  >
                    Giữ hồ sơ này
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" variant="secondary" onClick={props.onClose}>
                Huỷ
              </Button>
            </div>
          </>
        )}

        {resolved && (
          <>
            <h3 id="merge-patients-title" className="text-base font-bold text-slate-900">
              Xác nhận gộp hồ sơ
            </h3>
            <p className="mt-1.5 text-sm text-slate-600">
              Toàn bộ lượt khám, dị ứng, tiền sử của <span className="font-semibold text-slate-800">{resolved.source.fullName}</span> (Mã BN{' '}
              {resolved.source.patientCode}) sẽ chuyển sang <span className="font-semibold text-slate-800">{resolved.target.fullName}</span> (Mã BN{' '}
              {resolved.target.patientCode}). Hồ sơ nguồn vẫn được giữ nhưng không tạo được lượt khám mới.
            </p>
            {mutation.isError && (
              <p className="mt-2 text-xs font-medium text-rose-600">
                {mutation.error instanceof ApiError ? mutation.error.message : 'Không gộp được, vui lòng thử lại.'}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2.5">
              <Button type="button" variant="secondary" onClick={() => (props.mode === 'choose' ? setResolved(null) : props.onClose())}>
                {props.mode === 'choose' ? 'Chọn lại' : 'Huỷ'}
              </Button>
              <Button type="button" variant="danger" loading={mutation.isPending} onClick={() => void handleConfirm()}>
                Xác nhận gộp
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
