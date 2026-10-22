import { ArrowRight, Buildings } from '@phosphor-icons/react';
import { WEB_BUILD_ID, WEB_VERSION, formatDisplayVersion } from '../shared/version/app-version';

/**
 * Địa chỉ CŨ của một công ty vừa đổi mã tên miền (chế độ SaaS, docs/DECISIONS.md #245): trình duyệt được tự chuyển sang địa chỉ mới; trang này hiện trong lúc chuyển và là chỗ dự phòng
 * (kèm liên kết bấm tay) khi trình duyệt chặn chuyển hướng. Không có khung ứng dụng, không gọi thêm API.
 */
export function CompanyMovedPage({ loginUrl }: { loginUrl: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-4 inline-block rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500">{window.location.host}</p>
        <div className="flex items-center gap-2">
          <Buildings size={22} weight="regular" className="text-slate-400" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-slate-900">Địa chỉ đã được đổi</h1>
        </div>
        <p className="mt-2 text-sm font-medium text-slate-600">Phòng khám đã chuyển sang địa chỉ mới. Đang đưa bạn tới đó; nếu không tự chuyển, hãy bấm vào địa chỉ bên dưới và lưu lại.</p>
        <a href={loginUrl} className="mt-4 inline-flex items-center gap-1.5 break-all text-sm font-semibold text-blue-600 underline hover:text-blue-700">
          {loginUrl.replace(/^https?:\/\//, '')}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </a>
      </div>
      <p className="mt-4 text-center text-xs font-medium tabular-nums text-slate-500">NEXAMed {formatDisplayVersion(WEB_VERSION, WEB_BUILD_ID)}</p>
    </div>
  );
}
