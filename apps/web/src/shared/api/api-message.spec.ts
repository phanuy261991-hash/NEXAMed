import { describe, expect, it } from 'vitest';
import { friendlyApiMessage, isUserFacingMessage, resolveApiErrorCode } from './api-message';

describe('isUserFacingMessage', () => {
  it.each([
    'Không tìm thấy bệnh nhân.',
    'Dữ liệu này vừa được người khác cập nhật nên chưa lưu được.',
    'Số tiền hoàn vượt quá số đã thu.',
    'Tài khoản bị khoá. Thử lại sau 04:59.',
  ])('nhận câu nghiệp vụ tiếng Việt: %s', (message) => {
    expect(isUserFacingMessage(message)).toBe(true);
  });

  it.each([
    'Bad Request',
    'Unauthorized',
    'Forbidden resource',
    'Cannot GET /api/v1/xyz',
    'Validation failed (uuid is expected)',
    'ThrottlerException: Too Many Requests',
    'Internal server error',
    'Request Entity Too Large',
    'connect ECONNREFUSED 127.0.0.1:5432',
    'TypeError: Cannot read properties of undefined (reading \'map\')',
    'Unexpected token < in JSON at position 0',
    '<html><body>502 Bad Gateway</body></html>',
    'Lỗi tại PatientService.ts dòng 42',
    'Lỗi: undefined',
    '',
    '   ',
  ])('loại thông điệp thô/kỹ thuật/tiếng Anh: %s', (message) => {
    expect(isUserFacingMessage(message)).toBe(false);
  });

  it('loại giá trị không phải chuỗi và chuỗi quá dài', () => {
    expect(isUserFacingMessage(undefined)).toBe(false);
    expect(isUserFacingMessage(null)).toBe(false);
    expect(isUserFacingMessage(42)).toBe(false);
    expect(isUserFacingMessage({ message: 'Không tìm thấy' })).toBe(false);
    expect(isUserFacingMessage('Không tìm thấy. '.repeat(40))).toBe(false);
  });
});

describe('friendlyApiMessage', () => {
  it('giữ câu tiếng Việt của máy chủ', () => {
    expect(friendlyApiMessage(409, 'Phiếu này đã được duyệt.')).toBe('Phiếu này đã được duyệt.');
  });

  it('thay câu tiếng Anh/thô bằng câu mặc định theo mã HTTP', () => {
    expect(friendlyApiMessage(400, 'Bad Request')).toBe('Dữ liệu gửi lên chưa hợp lệ. Vui lòng kiểm tra lại.');
    expect(friendlyApiMessage(401, 'Unauthorized')).toContain('hết hạn');
    expect(friendlyApiMessage(403, 'Forbidden resource')).toContain('không có quyền');
    expect(friendlyApiMessage(404, 'Cannot GET /x')).toBe('Không tìm thấy nội dung yêu cầu.');
    expect(friendlyApiMessage(413, 'Request Entity Too Large')).toBe('Dữ liệu gửi lên quá lớn.');
    expect(friendlyApiMessage(429, 'ThrottlerException: Too Many Requests')).toContain('quá nhanh');
  });

  it('mọi mã 5xx đều ra câu thân thiện, 502/503 nói rõ hệ thống đang khởi động/không truy cập được', () => {
    expect(friendlyApiMessage(500, 'Internal server error')).toContain('gặp sự cố');
    expect(friendlyApiMessage(502, '<html>Bad Gateway</html>')).toContain('khởi động');
    expect(friendlyApiMessage(503, undefined)).toContain('khởi động');
    expect(friendlyApiMessage(504, 'Gateway Time-out')).toContain('phản hồi quá chậm');
    expect(friendlyApiMessage(599, 'weird')).toContain('gặp sự cố');
  });

  it('không có mã HTTP và không có câu dùng được → câu dự phòng', () => {
    expect(friendlyApiMessage(undefined, 'Bad Request')).toBe('Có lỗi xảy ra, vui lòng thử lại.');
    expect(friendlyApiMessage(undefined, undefined, 'Không tải được file.')).toBe('Không tải được file.');
    expect(friendlyApiMessage(418, 'I am a teapot', 'Không tải được file.')).toBe('Không tải được file.');
  });
});

describe('resolveApiErrorCode', () => {
  it('ưu tiên code máy chủ trả', () => {
    expect(resolveApiErrorCode(409, 'CONCURRENT_MODIFICATION')).toBe('CONCURRENT_MODIFICATION');
  });

  it('thiếu code thì suy từ mã HTTP để các nơi dựa vào code vẫn chạy đúng', () => {
    expect(resolveApiErrorCode(404, undefined)).toBe('NOT_FOUND');
    expect(resolveApiErrorCode(403, '')).toBe('PERMISSION_DENIED');
    expect(resolveApiErrorCode(401, undefined)).toBe('UNAUTHENTICATED');
    expect(resolveApiErrorCode(502, undefined)).toBe('SERVICE_UNAVAILABLE');
    expect(resolveApiErrorCode(500, undefined)).toBe('SERVER_ERROR');
    expect(resolveApiErrorCode(418, undefined)).toBe('UNKNOWN_ERROR');
    expect(resolveApiErrorCode(undefined, undefined)).toBe('UNKNOWN_ERROR');
  });
});
