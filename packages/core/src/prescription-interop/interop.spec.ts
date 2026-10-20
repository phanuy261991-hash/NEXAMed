import { describe, expect, it } from 'vitest';
import { INTEROP_TOKEN_REFRESH_BEFORE_MS, INTEROP_TOKEN_TTL_MS, computeInteropTokenState, interopTokenNeedsRefresh } from './token-lifecycle';
import { parseGatewayErrors, parseGatewaySuccessMessage } from './gateway-errors';

const T0 = new Date('2026-10-20T08:00:00.000Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

describe('computeInteropTokenState — hạn token tự tính = giờ nhận + 7 ngày', () => {
  it('chưa có token → NONE, cần đăng nhập', () => {
    expect(computeInteropTokenState(null, T0)).toEqual({ status: 'NONE', issuedAt: null, expiresAt: null, remainingMs: 0 });
    expect(computeInteropTokenState(undefined, T0).status).toBe('NONE');
    expect(interopTokenNeedsRefresh(null, T0)).toBe(true);
  });

  it('vừa nhận → VALID, hạn đúng 7 ngày sau', () => {
    const s = computeInteropTokenState(T0, T0);
    expect(s.status).toBe('VALID');
    expect(s.remainingMs).toBe(INTEROP_TOKEN_TTL_MS);
    expect(s.expiresAt).toBe('2026-10-27T08:00:00.000Z');
    expect(interopTokenNeedsRefresh(T0, T0)).toBe(false);
  });

  it('còn đúng 1 ngày thì vẫn VALID; còn dưới 1 ngày → EXPIRING và phải làm mới', () => {
    expect(computeInteropTokenState(T0, after(INTEROP_TOKEN_TTL_MS - INTEROP_TOKEN_REFRESH_BEFORE_MS)).status).toBe('VALID');
    const expiring = computeInteropTokenState(T0, after(INTEROP_TOKEN_TTL_MS - INTEROP_TOKEN_REFRESH_BEFORE_MS + 1));
    expect(expiring.status).toBe('EXPIRING');
    expect(interopTokenNeedsRefresh(T0, after(INTEROP_TOKEN_TTL_MS - 60_000))).toBe(true);
  });

  it('đúng hạn và quá hạn → EXPIRED, còn lại 0', () => {
    expect(computeInteropTokenState(T0, after(INTEROP_TOKEN_TTL_MS))).toMatchObject({ status: 'EXPIRED', remainingMs: 0 });
    expect(computeInteropTokenState(T0, after(INTEROP_TOKEN_TTL_MS + 5 * 86_400_000))).toMatchObject({ status: 'EXPIRED', remainingMs: 0 });
  });
});

describe('parseGatewayErrors — chịu được nhiều dạng danh_sach_cac_loi', () => {
  it('mảng chuỗi', () => {
    expect(parseGatewayErrors({ danh_sach_cac_loi: ['Mã liên thông hoặc mật khẩu không đúng', 'Bác sĩ chưa được thêm vào cơ sở'] })).toEqual([
      'Mã liên thông hoặc mật khẩu không đúng',
      'Bác sĩ chưa được thêm vào cơ sở',
    ]);
  });

  it('chuỗi đơn và mảng đối tượng có message/truong', () => {
    expect(parseGatewayErrors({ danh_sach_cac_loi: 'Lỗi chung' })).toEqual(['Lỗi chung']);
    expect(parseGatewayErrors({ danh_sach_cac_loi: [{ truong: 'ma_thuoc', message: 'không hợp lệ' }, { message: 'Thiếu chẩn đoán' }] })).toEqual(['ma_thuoc: không hợp lệ', 'Thiếu chẩn đoán']);
  });

  it('đối tượng "tên trường → danh sách lỗi" (kiểu Laravel), kể cả lồng nhau', () => {
    expect(parseGatewayErrors({ danh_sach_cac_loi: { hinh_thuc_dieu_tri: ['bắt buộc với đơn loại c'], 'thong_tin_don_thuoc.0.ma_thuoc': ['không hợp lệ'] } })).toEqual([
      'hinh_thuc_dieu_tri: bắt buộc với đơn loại c',
      'thong_tin_don_thuoc.0.ma_thuoc: không hợp lệ',
    ]);
  });

  it('chỉ có message/error/errors; không đọc được thì rỗng, không ném lỗi', () => {
    expect(parseGatewayErrors({ message: 'Unauthenticated.' })).toEqual(['Unauthenticated.']);
    expect(parseGatewayErrors({ error: 'Sai mật khẩu' })).toEqual(['Sai mật khẩu']);
    expect(parseGatewayErrors({ errors: { password: ['sai'] } })).toEqual(['password: sai']);
    expect(parseGatewayErrors(undefined)).toEqual([]);
    expect(parseGatewayErrors(null)).toEqual([]);
    expect(parseGatewayErrors('lỗi thô')).toEqual(['lỗi thô']);
    expect(parseGatewayErrors({ so: 1 })).toEqual([]);
  });

  it('cắt ngắn chuỗi quá dài và giới hạn số lỗi', () => {
    const long = parseGatewayErrors({ danh_sach_cac_loi: ['x'.repeat(1000)] });
    expect(long[0]!.length).toBe(300);
    expect(parseGatewayErrors({ danh_sach_cac_loi: Array.from({ length: 50 }, (_, i) => `lỗi ${i}`) })).toHaveLength(20);
  });
});

describe('parseGatewaySuccessMessage', () => {
  it('đọc success; thiếu thì rỗng', () => {
    expect(parseGatewaySuccessMessage({ success: 'Bạn đã thêm bác sĩ thành công' })).toBe('Bạn đã thêm bác sĩ thành công');
    expect(parseGatewaySuccessMessage({})).toBe('');
    expect(parseGatewaySuccessMessage(null)).toBe('');
  });
});
