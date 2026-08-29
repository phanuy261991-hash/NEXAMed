import { useEffect, useState } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import type { BusinessHours } from '@nexamed/shared';
import { useAuthStore } from '../auth/auth.store';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { EditIconButton } from '../../shared/ui/EditIconButton';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { TimeInput } from '../../shared/ui/TimeInput';
import { useClinicSettingsQuery, useUpdateClinicSettingsMutation } from './clinic.queries';

/** Khớp `clinic_config.update` — .claude/docs/security-audit.md (chỉ clinic_admin ở v1). */
const MANAGE_ROLES = ['clinic_admin'];

const DAY_ORDER: (keyof BusinessHours)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABEL: Record<keyof BusinessHours, string> = {
  monday: 'Thứ 2',
  tuesday: 'Thứ 3',
  wednesday: 'Thứ 4',
  thursday: 'Thứ 5',
  friday: 'Thứ 6',
  saturday: 'Thứ 7',
  sunday: 'Chủ nhật',
};

const SLOT_DURATION_OPTIONS = ['10', '15', '20', '30', '45', '60'].map((v) => ({ value: v, label: `${v} phút` }));

const DEFAULT_HOURS: BusinessHours = {
  monday: { open: '07:30', close: '17:00' },
  tuesday: { open: '07:30', close: '17:00' },
  wednesday: { open: '07:30', close: '17:00' },
  thursday: { open: '07:30', close: '17:00' },
  friday: { open: '07:30', close: '17:00' },
  saturday: { open: '07:30', close: '12:00' },
  sunday: null,
};

const SECTION_BADGE_CLASS =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

/**
 * Cấu hình phòng khám: giờ làm việc theo tuần + độ dài slot (`GET/PATCH /clinic-settings`, đã có
 * backend từ S2-07, lần đầu có UI web). Dùng độc lập trên trang riêng "Cấu hình hệ thống"
 * (`/admin/system-config`) — không còn nhúng trong trang "Danh mục" (.claude/docs/ui-guidelines.md
 * mục 10, docs/DECISIONS.md #039/#040). Cùng dữ liệu lưới lịch hẹn đọc qua
 * `GET /appointments/schedule-config` (S2-09) — sửa ở đây phản ánh ngay bên đó nhờ invalidate
 * chung (`clinic.queries.ts`). Mỗi nhóm cấu hình bọc khung viền + badge riêng (Boxed Section Form
 * Pattern, mục 9b) để phân tách rõ 2 phần: giờ làm việc và độ dài slot.
 */
export function ClinicHoursPane() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.roles.some((role) => MANAGE_ROLES.includes(role)) ?? false;

  const query = useClinicSettingsQuery();
  const mutation = useUpdateClinicSettingsMutation();

  // 2 khung độc lập (Boxed Section) — mỗi khung tự Sửa/Lưu/Huỷ riêng, không còn 1 nút "Sửa" chung
  // cho cả trang (yêu cầu chủ dự án trực tiếp, xem AppointmentConfigPane.tsx cùng mẫu).
  const [editingHours, setEditingHours] = useState(false);
  const [editingSlot, setEditingSlot] = useState(false);
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_HOURS);
  const [slotDuration, setSlotDuration] = useState('15');
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setHours(query.data.businessHours ?? DEFAULT_HOURS);
    setSlotDuration(String(query.data.slotDurationMinutes));
  }, [query.data]);

  function toggleDay(day: keyof BusinessHours, open: boolean) {
    setHours((h) => ({ ...h, [day]: open ? { open: '07:30', close: '17:00' } : null }));
  }

  function updateDayTime(day: keyof BusinessHours, field: 'open' | 'close', value: string) {
    setHours((h) => {
      const current = h[day];
      if (!current) return h;
      return { ...h, [day]: { ...current, [field]: value } };
    });
  }

  function handleCancelHours() {
    setHours(query.data?.businessHours ?? DEFAULT_HOURS);
    setEditingHours(false);
  }

  function handleSaveHours() {
    mutation.mutate(
      { businessHours: hours },
      {
        onSuccess: () => {
          setEditingHours(false);
          setSavedNotice(true);
          setTimeout(() => setSavedNotice(false), 3000);
        },
      },
    );
  }

  function handleCancelSlot() {
    setSlotDuration(String(query.data?.slotDurationMinutes ?? 15));
    setEditingSlot(false);
  }

  function handleSaveSlot() {
    mutation.mutate(
      { slotDurationMinutes: Number(slotDuration) },
      {
        onSuccess: () => {
          setEditingSlot(false);
          setSavedNotice(true);
          setTimeout(() => setSavedNotice(false), 3000);
        },
      },
    );
  }

  return (
    <div>
      <p className="mb-5 text-xs text-slate-500">Áp dụng cho lưới lịch hẹn và cảnh báo trễ hẹn.</p>

      {query.isError && <ErrorBanner message="Không tải được cấu hình phòng khám." onRetry={() => query.refetch()} />}

      {query.isLoading || !query.data ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="relative rounded-lg border border-slate-200 p-6 pt-8">
            <span className={SECTION_BADGE_CLASS}>Giờ làm việc theo tuần</span>
            {canManage && !editingHours && (
              <div className="absolute right-4 top-4">
                <EditIconButton onClick={() => setEditingHours(true)} />
              </div>
            )}
            <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
              {DAY_ORDER.map((day) => {
                const dayHours = hours[day];
                return (
                  <div key={day} className="flex items-center gap-3 border-b border-slate-100 py-2.5 text-sm">
                    <span className="w-20 flex-shrink-0 font-medium text-slate-700">{DAY_LABEL[day]}</span>
                    {editingHours ? (
                      <>
                        <label className="flex flex-shrink-0 items-center gap-1.5 text-xs text-slate-500">
                          <input type="checkbox" checked={dayHours !== null} onChange={(e) => toggleDay(day, e.target.checked)} />
                          Mở cửa
                        </label>
                        {dayHours && (
                          <div className="flex flex-1 items-center gap-1.5">
                            <TimeInput
                              id={`hours-open-${day}`}
                              value={dayHours.open}
                              onChange={(v) => updateDayTime(day, 'open', v)}
                              className="w-full min-w-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                            <span className="flex-shrink-0 text-slate-400">–</span>
                            <TimeInput
                              id={`hours-close-${day}`}
                              value={dayHours.close}
                              onChange={(v) => updateDayTime(day, 'close', v)}
                              className="w-full min-w-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                          </div>
                        )}
                      </>
                    ) : dayHours ? (
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                        {dayHours.open} – {dayHours.close}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Nghỉ</span>
                    )}
                  </div>
                );
              })}
            </div>

            {editingHours && (
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button type="button" variant="secondary" onClick={handleCancelHours} disabled={mutation.isPending}>
                  Huỷ
                </Button>
                <Button type="button" loading={mutation.isPending} onClick={handleSaveHours}>
                  Lưu
                </Button>
              </div>
            )}
          </div>

          <div className="relative rounded-lg border border-slate-200 p-4 pt-6">
            <span className={SECTION_BADGE_CLASS}>Độ dài khung giờ</span>
            <p className="mb-2 text-xs text-slate-500">
              Khoảng cách giữa các mốc giờ hiển thị trên lưới đặt lịch hẹn (ví dụ 15 phút/ô).
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Độ dài mỗi khung giờ</span>
              <div className="flex flex-shrink-0 items-center gap-2">
                {editingSlot ? (
                  <div className="w-36">
                    <Combobox id="slot-duration" value={slotDuration} onChange={setSlotDuration} options={SLOT_DURATION_OPTIONS} />
                  </div>
                ) : (
                  <span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-base font-bold text-blue-700">
                    {query.data.slotDurationMinutes} phút
                  </span>
                )}
                {canManage && !editingSlot && <EditIconButton onClick={() => setEditingSlot(true)} />}
              </div>
            </div>

            {editingSlot && (
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button type="button" variant="secondary" onClick={handleCancelSlot} disabled={mutation.isPending}>
                  Huỷ
                </Button>
                <Button type="button" loading={mutation.isPending} onClick={handleSaveSlot}>
                  Lưu
                </Button>
              </div>
            )}
          </div>

          {mutation.isError && <ErrorBanner message="Không lưu được cấu hình. Thử lại." />}
        </div>
      )}

      {savedNotice && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          <CheckCircle size={15} weight="fill" aria-hidden="true" />
          Đã lưu cấu hình giờ làm việc.
        </div>
      )}
    </div>
  );
}
