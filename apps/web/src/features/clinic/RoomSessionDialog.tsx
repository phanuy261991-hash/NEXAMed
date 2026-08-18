import { useState } from 'react';
import { MapPinLine } from '@phosphor-icons/react';
import type { RoomOption } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { useSetRoomSessionMutation } from './clinic.queries';

/**
 * "Chọn phòng làm việc hôm nay" (docs/DECISIONS.md #054) — hiện khi bác sĩ đăng nhập ở tenant có
 * ≥2 phòng active và chưa chọn phòng cho ngày hôm nay (`RoomSessionGate.tsx`), hoặc bấm lại "Đổi
 * phòng" ở "Hàng đợi khám". Cùng khuôn `PatientMatchDialog.tsx` (overlay + card trắng bo góc) —
 * không có `Dialog`/`Modal` primitive dùng chung trong dự án, mỗi popup tự dựng theo cùng markup.
 * KHÔNG có nút đóng bỏ qua khi bắt buộc chọn lần đầu (`dismissible=false`) — bác sĩ phải chọn 1
 * phòng mới vào được hệ thống làm việc hôm nay; khi mở lại từ "Đổi phòng" thì cho đóng được.
 */
export function RoomSessionDialog({
  options,
  currentRoomId,
  dismissible,
  onClose,
}: {
  options: RoomOption[];
  currentRoomId?: string | null;
  dismissible: boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(currentRoomId ?? null);
  const mutation = useSetRoomSessionMutation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby="room-session-title">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="px-6 pb-5 pt-6">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 ring-8 ring-blue-100/60">
            <MapPinLine size={22} weight="fill" className="text-blue-600" />
          </div>
          <h2 id="room-session-title" className="text-[16px] font-bold text-slate-900">
            Chọn phòng làm việc hôm nay
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            Lễ tân sẽ thấy phòng này khi tiếp nhận/đặt lịch cho bạn. Có thể đổi lại bất cứ lúc nào trong ngày.
          </p>

          <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto scroll-hover">
            {options.map((room) => {
              const active = selected === room.id;
              return (
                <li key={room.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(room.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
                      active ? 'border-brand-teal bg-brand-teal' : 'border-slate-200 hover:border-blue-400 hover:bg-brand-teal-tint'
                    }`}
                  >
                    <span className={`text-[13.5px] font-semibold ${active ? 'text-white' : 'text-slate-900'}`}>{room.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {mutation.isError && <p className="mt-3 text-xs font-medium text-rose-600">Không lưu được lựa chọn. Thử lại.</p>}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          {dismissible && (
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
          )}
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              mutation.mutate({ roomId: selected }, { onSuccess: onClose });
            }}
          >
            Xác nhận
          </Button>
        </div>
      </div>
    </div>
  );
}
