import type { Icon } from '@phosphor-icons/react';
import { ArrowClockwise, ArrowLeft, ArrowsClockwise, Compass, House, Warning, WifiSlash } from '@phosphor-icons/react';
import type { AppErrorKind } from '../errors/app-error';
import { WEB_BUILD_ID, WEB_VERSION, formatDisplayVersion } from '../version/app-version';
import { Button } from './Button';

interface ErrorContent {
  icon: Icon;
  /** Nền + màu biểu tượng. */
  tone: string;
  title: string;
  description: string;
}

/**
 * Nội dung màn lỗi toàn cục theo loại lỗi (docs/DECISIONS.md #255). Tuyệt đối KHÔNG đưa mã lỗi, thông điệp thô hay ngăn xếp vào đây — người dùng
 * cuối chỉ được thấy lời giải thích tiếng Việt và việc nên làm tiếp.
 */
const CONTENT: Record<AppErrorKind, ErrorContent> = {
  unexpected: {
    icon: Warning,
    tone: 'bg-rose-50 text-rose-600',
    title: 'Màn hình này tạm thời không hiển thị được',
    description:
      'Hệ thống gặp sự cố ngoài dự kiến. Dữ liệu đã lưu không bị ảnh hưởng, nhưng thông tin đang nhập dở chưa lưu có thể không còn. Hãy tải lại trang; nếu vẫn lỗi, vui lòng báo cho người quản trị.',
  },
  outdated: {
    icon: ArrowsClockwise,
    tone: 'bg-blue-50 text-blue-600',
    title: 'Phần mềm vừa được cập nhật',
    description: 'Cần tải lại trang để dùng phiên bản mới. Thông tin đang nhập dở chưa lưu có thể không còn.',
  },
  notFound: {
    icon: Compass,
    tone: 'bg-slate-100 text-slate-500',
    title: 'Không mở được trang này',
    description: 'Đường dẫn có thể đã đổi chỗ hoặc nhập chưa đúng. Hãy quay về trang chủ hoặc chọn mục trong thanh bên.',
  },
  unreachable: {
    icon: WifiSlash,
    tone: 'bg-amber-50 text-amber-600',
    title: 'Không kết nối được tới hệ thống',
    description: 'Kiểm tra kết nối mạng và máy chủ của phòng khám đã bật chưa, rồi tải lại trang. Nếu vẫn không được, vui lòng báo cho người quản trị.',
  },
};

/**
 * Màn lỗi toàn cục — hiện khi có ngoại lệ không lường trước lúc hiển thị giao diện, khi phần mềm vừa cập nhật làm hỏng việc tải mã, hoặc khi không
 * khởi động được (docs/DECISIONS.md #255, `.claude/docs/ui-guidelines.md` mục 17). Thay màn lỗi mặc định của `react-router` ("Unexpected Application
 * Error!") và trang trắng.
 *
 * CỐ Ý thuần trình bày: KHÔNG dùng router/store/context nào — màn này phải hiện được ngay cả khi chính các thứ đó đã hỏng. Hai nút dùng điều hướng
 * của trình duyệt (tải lại hẳn trang) để đưa ứng dụng về trạng thái sạch.
 *
 * - `embedded`: hiện TRONG vùng nội dung (giữ nguyên thanh bên và thanh trên của `AppShell`) khi lỗi xảy ra ở một trang;
 *   mặc định là toàn trang (lỗi ở khung ứng dụng, ngoài router, hoặc lúc khởi động).
 */
export function AppErrorScreen({ kind, embedded = false }: { kind: AppErrorKind; embedded?: boolean }) {
  const content = CONTENT[kind];
  // Còn trang trước trong chính ứng dụng thì quay lại; mở thẳng bằng đường dẫn (không có trang trước) thì về trang chủ.
  const goBack = () => (window.history.length > 1 ? window.history.back() : window.location.assign('/'));
  const IconComponent = content.icon;

  const body = (
    <section role="alert" aria-labelledby="app-error-title" className="mx-auto flex max-w-lg flex-col items-center px-6 py-16 text-center">
      <span className={`flex h-16 w-16 items-center justify-center rounded-full ${content.tone}`}>
        <IconComponent size={32} weight="regular" aria-hidden="true" />
      </span>
      <h1 id="app-error-title" className="mt-5 text-xl font-semibold text-slate-900">
        {content.title}
      </h1>
      <p className="mt-2 text-sm text-slate-600">{content.description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {kind === 'notFound' ? (
          <>
            <Button type="button" autoFocus onClick={() => window.location.assign('/')}>
              <House size={16} weight="bold" aria-hidden="true" />
              Về trang chủ
            </Button>
            <Button type="button" variant="secondary" onClick={goBack}>
              <ArrowLeft size={16} weight="bold" aria-hidden="true" />
              Quay lại trang trước
            </Button>
          </>
        ) : (
          <>
            <Button type="button" autoFocus onClick={() => window.location.reload()}>
              <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
              Tải lại trang
            </Button>
            <Button type="button" variant="secondary" onClick={() => window.location.assign('/')}>
              <House size={16} weight="bold" aria-hidden="true" />
              Về trang chủ
            </Button>
          </>
        )}
      </div>
    </section>
  );

  if (embedded) return body;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4">
      {body}
      <p className="mt-2 text-center text-xs font-medium tabular-nums text-slate-500">NEXAMed {formatDisplayVersion(WEB_VERSION, WEB_BUILD_ID)}</p>
    </div>
  );
}
