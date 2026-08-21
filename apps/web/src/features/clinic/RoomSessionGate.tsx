import { useState } from 'react';
import { useAuthStore } from '../auth/auth.store';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { RoomSessionDialog } from './RoomSessionDialog';
import { useMyRoomSessionQuery, useRoomOptionsQuery } from './clinic.queries';

/** `sessionStorage` (không phải `useState`) — F5/điều hướng trong cùng tab KHÔNG hiện lại popup
 * sau khi bỏ qua (phản hồi chủ dự án 2026-08-21); đóng tab/trình duyệt hoặc sang NGÀY khác (khoá
 * theo `work_date`, đúng phạm vi `doctor_room_session`) thì nhắc lại bình thường. */
function dismissKey(userId: string): string {
  return `nexamed:room-picker-dismissed:${userId}:${getVietnamTodayDateString()}`;
}

/**
 * Mount 1 lần trong `AppShell.tsx` (docs/DECISIONS.md #054) — quyết định có hiện popup "Chọn phòng
 * làm việc hôm nay" hay không, tách khỏi mọi trang cụ thể vì cả luồng đăng nhập MỚI (`LoginPage`)
 * lẫn khôi phục phiên (`AppBootstrap`) đều hội tụ về `AppShell` trước khi trang nào render.
 *
 * Tự động ẩn hoàn toàn ở quy mô 1-3 bác sĩ (quyết định đã chốt qua AskUserQuestion): `roomOptions`
 * chỉ fetch khi vai trò `doctor` (`useRoomOptionsQuery`), và `mySession` chỉ fetch khi
 * `options.length > 1` — tenant chưa tạo phòng nào hoặc chỉ 1 phòng thì KHÔNG gọi thêm request
 * nào, không hiện gì.
 *
 * **Cho "Bỏ qua" được (nới lỏng 2026-08-21, phản hồi chủ dự án)** — đăng nhập không đồng nghĩa vào
 * khám ngay (bác sĩ có thể chỉ xem hồ sơ/đổi lịch), nên không còn ép chọn phòng tại đây
 * (`dismissible=true`). Bỏ qua thì ghi `sessionStorage` (`dismissKey`) — F5/điều hướng trang khác
 * trong CÙNG tab không hiện lại nữa (phản hồi chủ dự án lần 2: "F5 lại thì đừng hiện lại"), đóng
 * tab/qua ngày khác thì nhắc lại. Nếu bác sĩ thật sự vào "Hàng đợi khám" mà vẫn chưa chọn phòng thì
 * `ReceptionDoctorQueuePage.tsx` tự bắt chọn lại ở đó (`dismissible=false`, đúng lúc cần phòng thật
 * để khám) — độc lập với cờ bỏ qua này.
 */
export function RoomSessionGate() {
  const user = useAuthStore((s) => s.user);
  const isDoctor = user?.roles.includes('doctor') ?? false;
  const [dismissedForNow, setDismissedForNow] = useState(() => (user ? sessionStorage.getItem(dismissKey(user.id)) === '1' : false));

  const roomOptions = useRoomOptionsQuery();
  const multiRoomActive = isDoctor && (roomOptions.data?.items.length ?? 0) > 1;

  const mySession = useMyRoomSessionQuery(multiRoomActive);

  if (!multiRoomActive || !mySession.isSuccess || mySession.data !== null || dismissedForNow) {
    return null;
  }

  return (
    <RoomSessionDialog
      options={roomOptions.data?.items ?? []}
      dismissible
      onClose={() => {
        if (user) sessionStorage.setItem(dismissKey(user.id), '1');
        setDismissedForNow(true);
      }}
    />
  );
}
