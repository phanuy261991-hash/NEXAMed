import { useState } from 'react';
import { Buildings, UserSwitch } from '@phosphor-icons/react';
import type { EncounterSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { useDoctorsQuery } from '../appointment/appointment.queries';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { useDoctorAvailabilityTodayQuery } from '../clinic/clinic.queries';
import { doctorAvailabilityBadgeMeta } from './queue-card';
import { useReassignEncounterMutation } from './reception.queries';

/** Thẻ chọn 1-trong-nhiều dùng chung cho cả bác sĩ lẫn Khoa — cùng token "Lựa chọn" (`ui-guidelines.md` 2.1). */
const CHOICE_BASE = 'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors';
const CHOICE_UNSELECTED = 'border-slate-300 hover:border-blue-400 hover:bg-brand-teal-tint';
const CHOICE_SELECTED = 'border-brand-teal bg-brand-teal text-white';

/**
 * "Trung tâm Điều phối Tiếp nhận" — lễ tân chủ động đổi bác sĩ/Khoa phụ trách một lượt khám còn
 * `CHECKED_IN` (mockup đã duyệt). Chọn "đích danh bác sĩ" (server tự suy Khoa của bác sĩ đó) HOẶC
 * "theo Khoa, chưa rõ bác sĩ" — 2 lựa chọn loại trừ nhau, cùng ràng buộc
 * `reassignEncounterRequestSchema` (`@nexamed/shared`).
 *
 * Cả 2 nhóm đều là THẺ chọn luôn hiện sẵn (lưới 2 cột) — Khoa trước đây là dropdown `Combobox` đặt
 * trong khung cuộn của dialog nên danh sách xổ xuống bị cắt/ẩn dưới đáy (lỗi UX phản hồi trực tiếp
 * 30/09/2026); số Khoa ít nên thẻ chọn thẳng gọn và nhìn thấy hết ngay, không cần bấm mở.
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
  const departments = departmentsQuery.data?.items ?? [];
  const availabilityByDoctorId = new Map((availabilityQuery.data?.items ?? []).map((i) => [i.doctorId, i.status]));

  function selectDoctor(id: string) {
    setDoctorId(id);
    setDepartmentId('');
  }

  function selectDepartment(id: string) {
    setDepartmentId(id);
    setDoctorId(null);
  }

  const canConfirm = doctorId !== null || departmentId !== '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canConfirm) return;
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
      <form onSubmit={(e) => void handleSubmit(e)} className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader icon={UserSwitch} title="Đổi bác sĩ phụ trách" subtitle={patientFullName} onClose={onClose} />

        <div className="scroll-hover min-h-0 flex-1 overflow-y-auto pr-1">
          <p className="mb-3 text-sm text-slate-600">Chỉ áp dụng khi lượt khám chưa vào khám (còn "Đã tiếp nhận").</p>

          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Bác sĩ phụ trách</p>
          {doctorsQuery.isPending && <p className="text-sm text-slate-400">Đang tải danh sách bác sĩ...</p>}
          {!doctorsQuery.isPending && doctors.length === 0 && <p className="text-sm text-slate-500">Không có bác sĩ nào khác để chọn.</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {doctors.map((d) => {
              const badge = doctorAvailabilityBadgeMeta(availabilityByDoctorId.get(d.id) ?? 'ACTIVE');
              const selected = doctorId === d.id;
              return (
                <button key={d.id} type="button" onClick={() => selectDoctor(d.id)} className={`${CHOICE_BASE} ${selected ? CHOICE_SELECTED : CHOICE_UNSELECTED}`}>
                  <span className="min-w-0">
                    <span className={`block truncate text-sm font-bold ${selected ? 'text-white' : 'text-slate-800'}`}>{d.displayName ?? d.fullName}</span>
                    {d.currentRoomName && <span className={`block truncate text-xs ${selected ? 'text-white/90' : 'text-slate-500'}`}>Phòng {d.currentRoomName}</span>}
                  </span>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${selected ? 'bg-white/20 text-white' : badge.className}`}>{badge.label}</span>
                </button>
              );
            })}
          </div>

          <div className="my-4 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            Hoặc chưa rõ bác sĩ — chọn theo Khoa
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          {departmentsQuery.isPending && <p className="text-sm text-slate-400">Đang tải danh sách Khoa...</p>}
          {!departmentsQuery.isPending && departments.length === 0 && <p className="text-sm text-slate-500">Chưa có Khoa/Phòng nào được cấu hình.</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {departments.map((d) => {
              const selected = departmentId === d.id;
              return (
                <button key={d.id} type="button" onClick={() => selectDepartment(d.id)} className={`${CHOICE_BASE} justify-start ${selected ? CHOICE_SELECTED : CHOICE_UNSELECTED}`}>
                  <Buildings size={18} weight={selected ? 'fill' : 'regular'} className={`flex-shrink-0 ${selected ? 'text-white' : 'text-slate-400'}`} aria-hidden="true" />
                  <span className={`min-w-0 truncate text-sm font-bold ${selected ? 'text-white' : 'text-slate-800'}`}>{d.name}</span>
                </button>
              );
            })}
          </div>

          {mutation.isError && (
            <p role="alert" className="mt-3 text-sm font-semibold text-rose-600">
              {mutation.error instanceof ApiError ? mutation.error.message : 'Không đổi được bác sĩ phụ trách, vui lòng thử lại.'}
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-shrink-0 justify-end gap-2.5 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!canConfirm}>
            Xác nhận đổi
          </Button>
        </div>
      </form>
    </div>
  );
}
