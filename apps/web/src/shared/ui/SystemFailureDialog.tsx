import type { Icon } from '@phosphor-icons/react';
import { Warning, WifiSlash } from '@phosphor-icons/react';
import type { SystemFailureKind } from '../errors/system-failure';
import { useSystemFailureStore } from '../errors/system-failure.store';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';

const KEEP_DATA = 'Dữ liệu bạn đã nhập vẫn còn nguyên trên màn hình.';
// Khi mất kết nối, máy chủ CÓ THỂ đã ghi xong mà chỉ chưa kịp trả lời — nên KHÔNG được khẳng định "chưa thực hiện". Từ #257 (khoá chống ghi trùng) bấm lại là AN TOÀN:
// giao diện giữ nguyên khoá của thao tác và máy chủ trả lại đúng kết quả lần đầu nếu nó đã được ghi (trước đó phải dặn người dùng kiểm tra lại vì bấm "Tiếp nhận" hai lần ra hai lượt khám, #255 bổ sung).
const CHECK_FIRST = 'Chưa xác nhận được thao tác đã hoàn tất hay chưa. Bạn có thể bấm thử lại — hệ thống tự nhận ra để không ghi trùng.';

const CONTENT: Record<SystemFailureKind, { icon: Icon; title: string; body: string }> = {
  network: {
    icon: WifiSlash,
    title: 'Không kết nối được máy chủ',
    body: `Kiểm tra kết nối mạng. ${CHECK_FIRST} ${KEEP_DATA}`,
  },
  unavailable: {
    icon: WifiSlash,
    title: 'Hệ thống tạm thời không truy cập được',
    body: `Hệ thống có thể đang khởi động hoặc bảo trì, vui lòng đợi ít phút. ${CHECK_FIRST} ${KEEP_DATA}`,
  },
  server: {
    icon: Warning,
    title: 'Hệ thống đang gặp sự cố',
    body: `Thao tác có thể chưa được ghi nhận. Bạn có thể bấm thử lại — hệ thống tự nhận ra để không ghi trùng; nếu vẫn lỗi, báo cho người quản trị. ${KEEP_DATA}`,
  },
};

/**
 * Hộp thông báo lỗi HỆ THỐNG khi đang thực hiện một thao tác (docs/DECISIONS.md #255, ui-guidelines mục 17): mất mạng, máy chủ chưa bật, lỗi 5xx.
 * Đặt MỘT lần ở gốc ứng dụng; hiện đè lên trang, người dùng đóng lại để quay về form còn nguyên dữ liệu rồi bấm thử lại. Không hiện mã lỗi hay thông
 * điệp thô — chỉ lời giải thích tiếng Việt. Lỗi nghiệp vụ/kiểm tra hợp lệ (4xx) KHÔNG đi qua đây, vẫn hiện tại chỗ.
 */
export function SystemFailureDialog() {
  const kind = useSystemFailureStore((s) => s.kind);
  const close = useSystemFailureStore((s) => s.close);
  if (!kind) return null;
  const content = CONTENT[kind];
  return (
    <ConfirmDialog
      icon={content.icon}
      tone="danger"
      title={content.title}
      onClose={close}
      actions={
        <Button type="button" autoFocus onClick={close}>
          Đóng
        </Button>
      }
    >
      <p className="text-sm text-slate-600">{content.body}</p>
    </ConfirmDialog>
  );
}
