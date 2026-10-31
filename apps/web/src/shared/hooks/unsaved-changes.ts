import { matchPath } from 'react-router-dom';
import { create } from 'zustand';

/**
 * Các trang BIỂU MẪU DÀI mà đóng/tải lại/chuyển trang giữa chừng làm mất công nhập (cảnh báo "dữ liệu nhập dở", ưu tiên thấp từ #257): thêm bệnh nhân, tiếp nhận, và các phiếu kho
 * (nhập/xuất/kiểm kê/điều chuyển — gồm cả sửa phiếu nháp). Khai báo MỘT chỗ ở đây thay vì sửa từng trang; muốn canh thêm trang thì thêm đường dẫn vào danh sách.
 * Màn khám KHÔNG có trong danh sách vì tự lưu nháp định kỳ và lưu nốt khi rời trang (`EncounterConsultationPage`).
 */
export const UNSAVED_GUARD_ROUTES: readonly string[] = [
  '/patients/new',
  '/reception/new',
  '/inventory/receipts/:id',
  '/inventory/issues/manual/:id',
  '/inventory/counts/:id',
  '/inventory/transfers/:id',
];

export function isGuardedPath(pathname: string): boolean {
  return UNSAVED_GUARD_ROUTES.some((pattern) => matchPath({ path: pattern, end: true }, pathname) !== null);
}

/** Chặn chuyển trang chỉ khi ĐANG có dữ liệu nhập dở và đường dẫn thật sự đổi (đổi `?tham số` cùng trang không chặn). */
export function shouldBlockNavigation(dirty: boolean, currentPath: string, nextPath: string): boolean {
  return dirty && currentPath !== nextPath;
}

interface UnsavedChangesState {
  /** `true` khi người dùng đã gõ/chọn gì đó trên trang biểu mẫu và chưa lưu. */
  dirty: boolean;
  markDirty: () => void;
  clear: () => void;
}

/**
 * Cờ "đã nhập, chưa lưu" của trang biểu mẫu đang mở. Bật khi có thao tác nhập THẬT của người dùng (`UnsavedChangesGuard`); tắt khi một thao tác ghi thành công
 * (`MutationCache.onSuccess` ở `App.tsx`, chạy TRƯỚC `onSuccess` của từng form nên form có điều hướng sau khi lưu không bị chặn) hoặc khi rời/đổi trang.
 */
export const useUnsavedChangesStore = create<UnsavedChangesState>((set) => ({
  dirty: false,
  markDirty: () => set((s) => (s.dirty ? s : { dirty: true })),
  clear: () => set((s) => (s.dirty ? { dirty: false } : s)),
}));
