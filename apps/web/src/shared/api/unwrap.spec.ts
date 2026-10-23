import { describe, expect, it } from 'vitest';
import { ApiError, apiErrorFromResponse, unwrap } from './client';

function catchError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('không ném lỗi');
}

describe('unwrap — chuẩn hoá lỗi theo mã HTTP (#255)', () => {
  it('trả dữ liệu khi thành công', () => {
    expect(unwrap<{ id: string }>({ data: { data: { id: 'a' } }, response: { status: 200 } })).toEqual({ id: 'a' });
  });

  it('giữ nguyên câu tiếng Việt và code của máy chủ, kèm mã HTTP', () => {
    const err = catchError(() => unwrap({ error: { error: { code: 'INVOICE_ALREADY_PAID', message: 'Phiếu thu đã được thanh toán.' } }, response: { status: 409 } }));
    expect(err.code).toBe('INVOICE_ALREADY_PAID');
    expect(err.message).toBe('Phiếu thu đã được thanh toán.');
    expect(err.status).toBe(409);
  });

  it('thông điệp tiếng Anh/thô của máy chủ KHÔNG lên giao diện: thay bằng câu theo mã HTTP', () => {
    const err = catchError(() => unwrap({ error: { error: { code: 'BAD_REQUEST', message: 'Validation failed (uuid is expected)' } }, response: { status: 400 } }));
    expect(err.message).toBe('Dữ liệu gửi lên chưa hợp lệ. Vui lòng kiểm tra lại.');
    expect(err.message).not.toMatch(/uuid|Validation/);
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('proxy trả trang HTML (502) thay vì JSON: không lộ HTML, code suy từ mã HTTP', () => {
    const err = catchError(() => unwrap({ error: '<html><body>502 Bad Gateway</body></html>' as never, response: { status: 502 } }));
    expect(err.message).toContain('khởi động');
    expect(err.message).not.toMatch(/html|Bad Gateway/i);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.status).toBe(502);
  });

  it('lỗi 5xx thân rỗng (không có error) vẫn ném ApiError chứ không lặng lẽ qua', () => {
    const err = catchError(() => unwrap({ response: { status: 500 } }));
    expect(err.status).toBe(500);
    expect(err.code).toBe('SERVER_ERROR');
    expect(err.message).toContain('gặp sự cố');
  });

  it('404 thiếu code → NOT_FOUND để RecordLoadError vẫn nhận ra', () => {
    const err = catchError(() => unwrap({ error: { error: { message: 'Not Found' } } as never, response: { status: 404 } }));
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Không tìm thấy nội dung yêu cầu.');
  });

  it('thành công nhưng không có dữ liệu → ApiError tiếng Việt', () => {
    const err = catchError(() => unwrap({ response: { status: 200 } }));
    expect(err.message).toBe('Không nhận được dữ liệu từ máy chủ.');
  });
});

describe('apiErrorFromResponse — tệp/xuất bệnh án không qua openapi-fetch', () => {
  it('thân HTML (nginx 413) → câu thân thiện, không ném SyntaxError', async () => {
    const err = await apiErrorFromResponse(new Response('<html><h1>413 Request Entity Too Large</h1></html>', { status: 413 }), 'Không tải lên được.');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Dữ liệu gửi lên quá lớn.');
    expect(err.status).toBe(413);
    expect(err.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('thân JSON có câu tiếng Việt → giữ nguyên', async () => {
    const body = JSON.stringify({ error: { code: 'EXPORT_NOT_ALLOWED', message: 'Bệnh nhân chưa có lượt khám hoàn tất.' } });
    const err = await apiErrorFromResponse(new Response(body, { status: 422, headers: { 'content-type': 'application/json' } }));
    expect(err.message).toBe('Bệnh nhân chưa có lượt khám hoàn tất.');
    expect(err.code).toBe('EXPORT_NOT_ALLOWED');
  });

  it('thân rỗng + mã lạ → dùng câu dự phòng của nơi gọi', async () => {
    const err = await apiErrorFromResponse(new Response(null, { status: 418 }), 'Không xuất được bệnh án.');
    expect(err.message).toBe('Không xuất được bệnh án.');
  });
});
