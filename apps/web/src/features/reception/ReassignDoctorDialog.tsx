import { useState } from 'react';
import { CaretDown, UsersThree, X } from '@phosphor-icons/react';
import type { EncounterSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { useDoctorsQuery } from '../appointment/appointment.queries';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { useDoctorAvailabilityTodayQuery } from '../clinic/clinic.queries';
import { doctorAvailabilityBadgeMeta } from './queue-card';
import { useReassignEncounterMutation } from './reception.queries';

/**
 * "Trung tâm Điều phối Tiếp nhận" — lễ tân chủ động đổi bác sĩ/Khoa phụ trách một lượt khám còn
 * `CHECKED_IN` (mockup đã duyệt). Chọn "đích danh bác sĩ" (server tự suy Khoa của bác sĩ đó) HOẶC
 * "theo Khoa, chưa rõ bác sĩ" — 2 lựa chọn loại trừ nhau, cùng ràng buộc
 * `reassignEncounterRequestSchema` (`@nexamed/shared`).
 *
 * KHÔNG tái dùng `DoctorAvailabilityList.tsx` — component đó tính "Trống"/"Bận tới HH:mm" theo
 * XUNG ĐỘT KHUNG GIỜ lịch hẹn (Đặt lịch nhanh/Dời lịch), khác bản chất câu hỏi ở đây ("bác sĩ này
 * có đang tiếp nhận bệnh nhân được không" — dựa trạng thái ca ACTIVE/BREAK/ENDED của
 * `doctor-availability`, #094) — dùng chung sẽ trộn lẫn 2 ý nghĩa "bận" khác nhau.
 */
export function ReassignDoctorDialog({
  encounterId,
  patientFullName,
  version,
  currentDoctorId,
  onReassigned,
  onClose,
}: {
  encounterId: string;
  patientFullName: string;
  version: number;
  currentDoctorId: string | null;
  onReassigned: (updated: EncounterSummary) => void;
  onClose: () => void;
}) {
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const doctorsQuery = useDoctorsQuery();
  const availabilityQuery = useDoctorAvailabilityTodayQuery();
  const departmentsQuery = useDepartmentOptionsQuery(true);
  const mutation = useReassignEncounterMutation();

  const doctors = (doctorsQuery.data?.items ?? []).filter((d) => d.id !== currentDoctorId);
  const availabilityByDoctorId = new Map((availabilityQuery.data?.items ?? []).map((i) => [i.doctorId, i.status]));

  function selectDoctor(id: string) {
    setDoctorId(id);
    setDepartmentId('');
  }

  function selectDepartment(id: string) {
    setDepartmentId(id);
    setDoctorId(null);
  }

  async function handleConfirm() {
    try {
      const updated = await mutation.mutateAsync({
        id: encounterId,
        body: doctorId ? { doctorId, version } : { departmentId, version },
      });
      onReassigned(updated);
    } catch {
      // Giữ dialog mở, hiện lỗi ngay bên dưới — không tự đóng để lễ tân đọc lỗi rồi tự quyết định.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="reassign-doctor-title">
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-lg bg-white shadow-xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <p id="reassign-doctor-title" className="text-sm font-bold text-slate-900">
            Đổi bác sĩ phụ trách
          </p>
          <button type="button" onClick={onClose} aria-label="Đóng" className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={15} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-xs text-slate-500">
            <span className="font-semibold text-slate-800">{patientFullName}</span> — chỉ áp dụng khi lượt khám chưa vào khám (còn "Đã tiếp nhận").
          </p>

          {doctorsQuery.isPending && <p className="text-xs text-slate-400">Đang tải danh sách bác sĩ...</p>}

          <div className="space-y-1.5">
            {doctors.map((d) => {
              const badge = doctorAvailabilityBadgeMeta(availabilityByDoctorId.get(d.id) ?? 'ACTIVE');
              const selected = doctorId === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => selectDoctor(d.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selected ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 hover:border-blue-400 hover:bg-brand-teal-tint'
                  }`}
                >
                  <span className="min-w-0 truncate">
                    <span className={`block truncate text-[13px] font-bold ${selected ? 'text-white' : 'text-slate-800'}`}>{d.displayName ?? d.fullName}</span>
                    {d.currentRoomName && <span className={`block truncate text-[11px] ${selected ? 'text-white/90' : 'text-slate-500'}`}>Phòng {d.currentRoomName}</span>}
                  </span>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${selected ? 'bg-white/20 text-white' : badge.className}`}>{badge.label}</span>
                </button>
              );
            })}
          </div>

          <div className="my-3.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            Hoặc theo Khoa
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2">
            <UsersThree size={16} weight="bold" className="flex-shrink-0 text-slate-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Combobox
                id="reassign-department"
                value={departmentId}
                onChange={selectDepartment}
                options={(departmentsQuery.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
                placeholder="Chưa rõ bác sĩ — chọn Khoa..."
              />
            </div>
            <CaretDown size={13} weight="bold" className="flex-shrink-0 text-slate-400" aria-hidden="true" />
          </div>

          {mutation.isError && (
            <p className="mt-3 text-xs font-medium text-rose-600">
              {mutation.error instanceof ApiError ? mutation.error.message : 'Không đổi được bác sĩ phụ trách, vui lòng thử lại.'}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2.5 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="button" loading={mutation.isPending} disabled={!doctorId && !departmentId} onClick={() => void handleConfirm()}>
            Xác nhận đổi
          </Button>
        </div>
      </div>
    </div>
  );
}
