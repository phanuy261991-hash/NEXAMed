import { create } from 'zustand';
import type { SystemFailureKind } from './system-failure';

interface SystemFailureState {
  /** Loại lỗi hệ thống đang hiện hộp thông báo; `null` = không hiện. */
  kind: SystemFailureKind | null;
  show: (kind: SystemFailureKind) => void;
  close: () => void;
}

/**
 * Trạng thái hộp thông báo lỗi hệ thống (docs/DECISIONS.md #255). Đã mở thì bỏ qua lượt báo mới — nhiều thao tác cùng thất bại một lúc (mất mạng)
 * chỉ hiện MỘT hộp thay vì chồng nhiều hộp lên nhau.
 */
export const useSystemFailureStore = create<SystemFailureState>((set, get) => ({
  kind: null,
  show: (kind) => {
    if (get().kind === null) set({ kind });
  },
  close: () => set({ kind: null }),
}));
