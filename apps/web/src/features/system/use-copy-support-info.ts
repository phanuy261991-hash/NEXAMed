import { useState } from 'react';
import type { SystemVersion } from '@nexamed/shared';
import { copyText } from '../../shared/format/clipboard';
import { WEB_BUILD_ID, WEB_VERSION } from '../../shared/version/app-version';
import { buildSupportInfo } from './support-info';

/**
 * Sao chép khối "thông tin gửi hỗ trợ" (phiên bản, kênh, trình duyệt — không có dữ liệu bệnh nhân) vào bộ nhớ tạm. Dùng chung cho hộp "Giới thiệu" và trang "Cập nhật phần mềm". `copyText` có đường
 * dự phòng khi chạy HTTP thường ở mạng nội bộ (không có `navigator.clipboard`, #257); thất bại thì `status` là `failed` để nơi gọi báo người dùng tự chọn và sao chép.
 */
export function useCopySupportInfo(server: SystemVersion | null) {
  const [status, setStatus] = useState<'idle' | 'ok' | 'failed'>('idle');
  async function copy() {
    const ok = await copyText(buildSupportInfo(server, { version: WEB_VERSION, build: WEB_BUILD_ID }, navigator.userAgent));
    setStatus(ok ? 'ok' : 'failed');
  }
  return { status, copy };
}
