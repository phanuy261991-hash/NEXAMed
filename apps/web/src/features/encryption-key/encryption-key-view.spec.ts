import { describe, expect, it } from 'vitest';
import { buildEncryptionKeyBanner } from './encryption-key-view';

const base = { state: 'mismatch' as const, actualFingerprint: '51B0-22DE', expectedFingerprint: '7F3A-91C2', canSeeDetails: true };

describe('buildEncryptionKeyBanner (cảnh báo khoá không khớp, #262)', () => {
  it('khoá khớp, chưa có dữ liệu hoặc người xem không phải quản trị → không hiện cảnh báo đỏ', () => {
    expect(buildEncryptionKeyBanner(undefined)).toBeNull();
    expect(buildEncryptionKeyBanner({ ...base, state: 'ok' })).toBeNull();
    expect(buildEncryptionKeyBanner({ ...base, canSeeDetails: false, actualFingerprint: null, expectedFingerprint: null })).toBeNull();
  });

  it('khoá lệch: nêu CẢ HAI mã kiểm và dặn đặt lại đúng file .env, không nhập lại dữ liệu', () => {
    const view = buildEncryptionKeyBanner(base)!;
    expect(view.title).toMatch(/KHÔNG khớp/);
    expect(view.detail).toContain('51B0-22DE');
    expect(view.detail).toContain('7F3A-91C2');
    expect(view.action).toMatch(/Đừng nhập lại/);
    expect(view.action).toContain('7F3A-91C2');
  });

  it('không biết mã gốc (cài trước bản kiểm tra khoá): vẫn cảnh báo, không bịa mã', () => {
    const view = buildEncryptionKeyBanner({ ...base, expectedFingerprint: null })!;
    expect(view.detail).toContain('51B0-22DE');
    expect(view.detail).toMatch(/không rõ mã kiểm/);
    expect(view.action).toMatch(/file khoá lúc cài đặt/);
  });
});
