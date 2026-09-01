import { useState } from 'react';
import { Info, X } from '@phosphor-icons/react';
import type { WorkShiftItem } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { WORK_SHIFT_COLOR_HEX } from '../clinic/WorkShiftFormModal';

/**
 * "Đăng ký ca làm việc" (Giai đoạn 2 của #101) — modal dùng chung cho `MyWorkSchedulePage.tsx`
 * (đăng ký cho chính mình, 1 hoặc nhiều ngày đã chọn) và `StaffWorkSchedulePage.tsx` (quản lý
 * đăng ký hộ). Chọn 1 hoặc nhiều ca cùng lúc từ danh mục `work_shift` đã có.
 */
export function WorkShiftPickerModal({
  subtitle,
  workShifts,
  saving,
  showLockNotice,
  onClose,
  onSave,
}: {
  subtitle: string;
  workShifts: WorkShiftItem[];
  saving: boolean;
  /** Chỉ hiện ghi chú quy tắc khoá khi đăng ký cho CHÍNH MÌNH (Lịch làm việc của tôi) — quản lý
   * đăng ký hộ ở "Lịch làm việc nhân viên" không bị khoá, không cần ghi chú này. */
  showLockNotice: boolean;
  onClose: () => void;
  onSave: (workShiftIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const activeShifts = workShifts.filter((s) => s.isActive);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Bọc `<form>` để Enter submit — bắt buộc cho form Thêm (.claude/docs/ui-guidelines.md mục 4.4).
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) return;
    onSave(selected);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby="work-shift-picker-title">
      <form onSubmit={handleSubmit} className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="relative px-6 pb-5 pt-6">
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} weight="bold" />
          </button>

          <h2 id="work-shift-picker-title" className="text-[16px] font-bold text-slate-900">
            Đăng ký ca làm việc
          </h2>
          <p className="mt-1 text-[13px] text-slate-500">{subtitle}</p>

          {activeShifts.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
              Chưa có mẫu ca nào trong danh mục — vào Cấu hình hệ thống → Cấu hình phòng khám → Ca làm việc để tạo trước.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-1.5">
              {activeShifts.map((shift) => (
                <label
                  key={shift.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 ${
                    selected.includes(shift.id) ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input type="checkbox" checked={selected.includes(shift.id)} onChange={() => toggle(shift.id)} className="h-4 w-4" />
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: WORK_SHIFT_COLOR_HEX[shift.color] }} />
                  <span className="flex-1 text-sm font-semibold text-slate-900">{shift.name}</span>
                  <span className="text-xs font-medium text-slate-500">
                    {shift.startTime}–{shift.endTime}
                  </span>
                </label>
              ))}
            </div>
          )}

          {showLockNotice && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <Info size={15} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>Bạn có thể tự sửa/xoá ca này trong hôm nay; từ ngày mai chỉ quản lý mới sửa được.</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button type="submit" loading={saving} disabled={selected.length === 0}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
