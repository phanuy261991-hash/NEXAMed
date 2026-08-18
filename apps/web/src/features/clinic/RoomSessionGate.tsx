import { useAuthStore } from '../auth/auth.store';
import { RoomSessionDialog } from './RoomSessionDialog';
import { useMyRoomSessionQuery, useRoomOptionsQuery } from './clinic.queries';

/**
 * Mount 1 lần trong `AppShell.tsx` (docs/DECISIONS.md #054) — quyết định có hiện popup "Chọn phòng
 * làm việc hôm nay" hay không, tách khỏi mọi trang cụ thể vì cả luồng đăng nhập MỚI (`LoginPage`)
 * lẫn khôi phục phiên (`AppBootstrap`) đều hội tụ về `AppShell` trước khi trang nào render.
 *
 * Tự động ẩn hoàn toàn ở quy mô 1-3 bác sĩ (quyết định đã chốt qua AskUserQuestion): `roomOptions`
 * chỉ fetch khi vai trò `doctor` (`useRoomOptionsQuery`), và `mySession` chỉ fetch khi
 * `options.length > 1` — tenant chưa tạo phòng nào hoặc chỉ 1 phòng thì KHÔNG gọi thêm request
 * nào, không hiện gì. Không tự đóng được (dismissible=false) khi bắt buộc chọn lần đầu trong
 * ngày — bác sĩ phải chọn 1 phòng mới thao tác tiếp; "Đổi phòng" ở "Hàng đợi khám" mở lại dialog ở
 * chế độ đóng được (component riêng, không qua gate này).
 */
export function RoomSessionGate() {
  const user = useAuthStore((s) => s.user);
  const isDoctor = user?.roles.includes('doctor') ?? false;

  const roomOptions = useRoomOptionsQuery();
  const multiRoomActive = isDoctor && (roomOptions.data?.items.length ?? 0) > 1;

  const mySession = useMyRoomSessionQuery(multiRoomActive);

  if (!multiRoomActive || !mySession.isSuccess || mySession.data !== null) {
    return null;
  }

  return <RoomSessionDialog options={roomOptions.data?.items ?? []} dismissible={false} onClose={() => {}} />;
}
