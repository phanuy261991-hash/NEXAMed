import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { classifySystemFailure } from './system-failure';

describe('classifySystemFailure', () => {
  it('502/503/504 → unavailable (hệ thống đang khởi động/proxy không nối được)', () => {
    for (const status of [502, 503, 504]) {
      expect(classifySystemFailure(new ApiError('SERVICE_UNAVAILABLE', 'x', undefined, status))).toBe('unavailable');
    }
  });

  it('các 5xx còn lại → server', () => {
    expect(classifySystemFailure(new ApiError('SERVER_ERROR', 'x', undefined, 500))).toBe('server');
    expect(classifySystemFailure(new ApiError('SERVER_ERROR', 'x', undefined, 501))).toBe('server');
  });

  it('lỗi nghiệp vụ/kiểm tra hợp lệ 4xx và lỗi không có mã HTTP KHÔNG phải lỗi hệ thống (hiện tại chỗ)', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(classifySystemFailure(new ApiError('X', 'Thông báo nghiệp vụ.', undefined, status))).toBeNull();
    }
    expect(classifySystemFailure(new ApiError('NOT_FOUND', 'Bản ghi không còn tồn tại.'))).toBeNull();
  });

  it('mất mạng: TypeError của fetch (Chrome/Firefox/Safari) và AbortError/TimeoutError → network', () => {
    expect(classifySystemFailure(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifySystemFailure(new TypeError('NetworkError when attempting to fetch resource.'))).toBe('network');
    expect(classifySystemFailure(new TypeError('Load failed'))).toBe('network');
    expect(classifySystemFailure(new DOMException('The user aborted a request.', 'AbortError'))).toBe('network');
    expect(classifySystemFailure(new DOMException('Timed out', 'TimeoutError'))).toBe('network');
  });

  it('lỗi lập trình/lỗi lạ/giá trị không phải Error → null (màn lỗi toàn cục lo)', () => {
    expect(classifySystemFailure(new Error('Chưa chọn bác sĩ.'))).toBeNull();
    expect(classifySystemFailure(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBeNull();
    expect(classifySystemFailure('lỗi')).toBeNull();
    expect(classifySystemFailure(undefined)).toBeNull();
  });
});
