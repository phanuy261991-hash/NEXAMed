import { useEffect } from 'react';
import { WarningIcon } from '@phosphor-icons/react';
import { useBlocker, useLocation } from 'react-router-dom';
import { isGuardedPath, shouldBlockNavigation, useUnsavedChangesStore } from '../hooks/unsaved-changes';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Cảnh báo khi rời trang biểu mẫu dài lúc còn dữ liệu nhập dở (xem `UNSAVED_GUARD_ROUTES`): đóng tab/tải lại → hộp xác nhận của trình duyệt (chữ do trình duyệt đặt, không đổi được);
 * bấm sang trang khác trong ứng dụng → hộp xác nhận "Rời khỏi trang này?" (Ở lại / Rời trang). Đặt MỘT lần ở `AppShell`.
 * "Đã nhập" = có sự kiện `input`/`change` THẬT của người dùng (`isTrusted`) bên trong vùng nội dung `<main>`; ô điền tự động bằng mã không tính.
 */
export function UnsavedChangesGuard() {
  const { pathname } = useLocation();
  const guarded = isGuardedPath(pathname);
  const dirty = useUnsavedChangesStore((s) => s.dirty);

  // Theo dõi thao tác nhập; mỗi lần vào/rời một trang canh thì xoá cờ để trang mới bắt đầu "sạch".
  useEffect(() => {
    const { markDirty, clear } = useUnsavedChangesStore.getState();
    clear();
    if (!guarded) return;
    const onEdit = (event: Event) => {
      const target = event.target;
      if (event.isTrusted && target instanceof Element && target.closest('main')) markDirty();
    };
    document.addEventListener('input', onEdit, true);
    document.addEventListener('change', onEdit, true);
    return () => {
      document.removeEventListener('input', onEdit, true);
      document.removeEventListener('change', onEdit, true);
      clear();
    };
  }, [guarded, pathname]);

  // Đóng tab / tải lại trang.
  useEffect(() => {
    if (!guarded || !dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [guarded, dirty]);

  // Chuyển trang trong ứng dụng (menu, liên kết, nút Quay lại). Đọc cờ lúc chuyển, không dùng giá trị cũ của lần vẽ trước.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => shouldBlockNavigation(useUnsavedChangesStore.getState().dirty, currentLocation.pathname, nextLocation.pathname));

  if (blocker.state !== 'blocked') return null;
  return (
    <ConfirmDialog
      icon={WarningIcon}
      tone="danger"
      title="Rời khỏi trang này?"
      note="Thông tin đang nhập chưa được lưu và sẽ mất."
      onClose={() => blocker.reset()}
      actions={
        <>
          <Button type="button" variant="secondary" autoFocus onClick={() => blocker.reset()}>
            Ở lại
          </Button>
          <Button type="button" variant="danger" onClick={() => blocker.proceed()}>
            Rời trang
          </Button>
        </>
      }
    />
  );
}
