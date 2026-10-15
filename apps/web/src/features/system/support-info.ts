import type { SystemVersion } from '@nexamed/shared';
import { DEPLOYMENT_MODE_LABELS, RELEASE_CHANNEL_LABELS, formatFullVersion } from '../../shared/version/app-version';

/** `2026-10-15` → `15/10/2026` (ngày phát hành lưu dạng ISO, hiển thị theo thói quen Việt Nam). */
export function formatReleaseDate(isoDate: string | null): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}/${m}/${y}` : isoDate;
}

/**
 * Khối thông tin nhân viên sao chép gửi cho bộ phận hỗ trợ khi báo lỗi (nút "Sao chép thông tin gửi hỗ trợ" ở hộp Giới thiệu). Chỉ gồm thông tin phiên bản/môi trường — KHÔNG có tên người dùng,
 * công ty hay dữ liệu bệnh nhân (đúng quy tắc không đưa PII/PHI ra ngoài hệ thống).
 */
export function buildSupportInfo(server: SystemVersion | null, web: { version: string; build: string }, userAgent: string): string {
  const lines = [`NEXAMed ${server ? formatFullVersion(server.version, server.build) : 'không đọc được từ máy chủ'}`];
  if (server) {
    lines.push(`Kênh: ${RELEASE_CHANNEL_LABELS[server.channel]} | Chế độ: ${DEPLOYMENT_MODE_LABELS[server.deploymentMode]}`);
    lines.push(`Ngày phát hành: ${formatReleaseDate(server.releasedAt)}`);
    lines.push(`Phiên bản cơ sở dữ liệu: ${server.schemaVersion ?? 'không đọc được'}`);
  }
  lines.push(`Giao diện (Web): ${formatFullVersion(web.version, web.build)}`);
  lines.push(`Trình duyệt: ${userAgent}`);
  return lines.join('\n');
}
