import { useEffect, useState } from 'react';
import { resolveApiUrl } from '../api/client';
import { useClinicPrintHeaderQuery } from '../print/clinic-print-header.queries';

/**
 * Đầu thanh menu: logo chính của phòng khám đặt thẳng lên nền tối của menu (không tách khối); chưa tải logo, hoặc ảnh không tải được thì dùng logo NEXAMed bản
 * cho nền tối. Menu thu gọn luôn hiện biểu tượng N+ của NEXAMed vì logo không đọc được ở bề ngang 64px.
 */
export function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const logoUrl = useClinicPrintHeaderQuery().data?.logoUrl ?? null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => setFailedUrl(null), [logoUrl]);

  const clinicLogo = logoUrl && logoUrl !== failedUrl ? logoUrl : null;
  return (
    <div className="flex h-full items-center justify-center px-3">
      {collapsed ? (
        <img src="/brand/nexamed-icon-inverse.svg" alt="NEXAMed" className="h-7 w-7 flex-shrink-0 rounded-md" />
      ) : clinicLogo ? (
        <img src={resolveApiUrl(clinicLogo)} alt="Logo phòng khám" onError={() => setFailedUrl(clinicLogo)} className="max-h-8 max-w-full object-contain" />
      ) : (
        <img src="/brand/nexamed-logo-horizontal-white.svg" alt="NEXAMed" className="h-6 max-w-full object-contain" />
      )}
    </div>
  );
}
