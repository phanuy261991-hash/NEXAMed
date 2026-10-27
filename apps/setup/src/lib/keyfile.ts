/**
 * File KHOÁ HỆ THỐNG tải về ở trang "Hoàn tất" (docs/DECISIONS.md #262). KHÁC file bàn giao: file này chứa DUY NHẤT khoá mã hoá dữ liệu (`ENCRYPTION_KEY`) — thứ không thể thay thế —
 * cùng mã kiểm và cách khôi phục, để người cài cất riêng ở nơi khác máy chủ. KHÔNG chứa mật khẩu cơ sở dữ liệu, JWT hay bí mật nào khác (những thứ đó đặt lại/sinh lại được).
 */
import { keyFingerprint } from './key-fingerprint';

export interface KeyFileInput {
  key: string;
  version: string;
  publicUrl: string;
  clinicName?: string;
  createdAt: Date;
}

export function buildKeyFileText(input: KeyFileInput): string {
  const lines = [
    'NEXAMED — FILE KHOÁ HỆ THỐNG',
    '============================',
    '',
    'ĐÂY LÀ THÔNG TIN KHÔNG THỂ THAY THẾ. Hãy cất file này ở NƠI KHÁC MÁY CHỦ (USB, két sắt, nơi lưu trữ riêng).',
    'Không gửi qua Zalo, nhóm chat hay email công khai. Ai có file này có thể giải mã số CCCD, số thẻ BHYT trong bản sao lưu.',
    '',
    `Phòng khám : ${input.clinicName ?? '(chưa đặt tên)'}`,
    `Địa chỉ    : ${input.publicUrl}`,
    `Phiên bản  : NEXAMed ${input.version}`,
    `Tạo lúc    : ${input.createdAt.toISOString()}`,
    '',
    `MÃ KIỂM KHOÁ: ${keyFingerprint(input.key)}   (dùng để đối chiếu, không phải khoá)`,
    '',
    'KHOÁ MÃ HOÁ (dòng dưới đây, nguyên văn, không thêm dấu cách):',
    `ENCRYPTION_KEY=${input.key}`,
    '',
    'VÌ SAO QUAN TRỌNG',
    '- Số CCCD, số thẻ BHYT và mật khẩu cổng liên thông được mã hoá bằng khoá này.',
    '- Bản sao lưu tự động KHÔNG chứa khoá (để lộ bản sao lưu vẫn không lộ dữ liệu).',
    '- Mất khoá = các thông tin đó KHÔNG đọc lại được và KHÔNG có cách lấy lại, kể cả khi còn bản sao lưu.',
    '',
    'KHI NÀO CẦN FILE NÀY',
    '- Máy chủ hỏng ổ đĩa, hoặc chuyển hệ thống sang máy mới rồi khôi phục bản sao lưu.',
    '- Lỡ xoá hoặc làm mất file .env trong thư mục cài đặt.',
    '',
    'CÁCH KHÔI PHỤC',
    '1. Cài NEXAMed trên máy mới, khôi phục bản sao lưu theo hướng dẫn (docs/Deploy.md, mục sao lưu và khôi phục).',
    '2. Mở file .env trong thư mục cài đặt, sửa dòng ENCRYPTION_KEY= thành đúng dòng ENCRYPTION_KEY=... ở trên.',
    '3. Khởi động lại hệ thống. Nếu khoá đúng, mã kiểm khoá hiện trong ứng dụng là: ' + keyFingerprint(input.key),
    '   Nếu thấy cảnh báo "Khoá hệ thống không khớp", mã kiểm trong cảnh báo cho biết khoá nào đang chạy — đối chiếu với mã kiểm ở file này.',
    '',
  ];
  return lines.join('\r\n');
}
