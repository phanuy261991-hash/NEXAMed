/**
 * Thời gian coi dữ liệu là "còn mới" cho các truy vấn DANH MỤC/TUỲ CHỌN ít đổi — TanStack Query mặc định
 * `staleTime: 0` nên mỗi lần mở lại một trang đều tải lại cả danh mục (đơn vị, kho, bác sĩ, cấu hình
 * lịch...). Chỉ áp cho truy vấn mà mọi mutation phía web đều `invalidate` đúng khoá (sửa xong là thấy
 * ngay); người khác sửa thì chậm nhất sau chừng này thời gian (hoặc khi F5). KHÔNG áp cho dữ liệu nghiệp
 * vụ đang thay đổi liên tục (danh sách bệnh nhân/lượt khám/hoá đơn) — các truy vấn đó giữ nguyên hành vi cũ.
 */
export const STALE_REFERENCE_MS = 5 * 60_000;
/** Danh sách người/phòng ban có thể đổi do quản trị viên ở màn khác (không phải mọi chỗ sửa đều invalidate khoá này) — ngắn hơn. */
export const STALE_OPTIONS_MS = 60_000;
