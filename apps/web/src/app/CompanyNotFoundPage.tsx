import { Buildings } from '@phosphor-icons/react';
import { WEB_BUILD_ID, WEB_VERSION, formatDisplayVersion } from '../shared/version/app-version';

/** Địa chỉ truy cập (tên miền phụ) không ứng với công ty nào — chế độ SaaS (docs/DECISIONS.md #237). Không có khung ứng dụng, không gọi thêm API. */
export function CompanyNotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-4 inline-block rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500">{window.location.host}</p>
        <div className="flex items-center gap-2">
          <Buildings size={22} weight="regular" className="text-slate-400" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-slate-900">Không tìm thấy công ty này</h1>
        </div>
        <p className="mt-2 text-sm font-medium text-slate-600">
          Địa chỉ không đúng hoặc công ty chưa được kích hoạt. Kiểm tra lại đường dẫn mà nhà cung cấp đã gửi cho bạn.
        </p>
      </div>
      <p className="mt-4 text-center text-xs font-medium tabular-nums text-slate-500">NEXAMed {formatDisplayVersion(WEB_VERSION, WEB_BUILD_ID)}</p>
    </div>
  );
}
