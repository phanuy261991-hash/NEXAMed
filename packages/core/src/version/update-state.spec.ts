import { describe, expect, it } from 'vitest';
import type { ReleaseEntry } from '@nexamed/shared';
import { deriveUpdateState } from './update-state';

const entry = (version: string, extra: Partial<ReleaseEntry> = {}): ReleaseEntry => ({
  version,
  releasedAt: '2026-10-20',
  notes: { features: ['Tính năng mới'], improvements: [], fixes: [] },
  requiresMigration: false,
  ...extra,
});

describe('deriveUpdateState', () => {
  it('chưa cấu hình máy chủ phát hành → not_configured, dù có kết quả cũ', () => {
    expect(deriveUpdateState({ configured: false, currentVersion: '0.9.0', result: { kind: 'ok', latest: entry('1.0.0') } }).state).toBe('not_configured');
  });

  it('đã cấu hình nhưng chưa kiểm lần nào → never_checked', () => {
    expect(deriveUpdateState({ configured: true, currentVersion: '0.9.0', result: null }).state).toBe('never_checked');
  });

  it('lỗi kiểm tra → error kèm thông báo', () => {
    const r = deriveUpdateState({ configured: true, currentVersion: '0.9.0', result: { kind: 'error', message: 'Không kết nối được máy chủ phát hành.' } });
    expect(r).toMatchObject({ state: 'error', errorMessage: 'Không kết nối được máy chủ phát hành.', latest: null });
  });

  it('kênh chưa có bản nào → up_to_date', () => {
    expect(deriveUpdateState({ configured: true, currentVersion: '0.9.0', result: { kind: 'ok', latest: null } }).state).toBe('up_to_date');
  });

  it('bản trên máy chủ mới hơn → update_available', () => {
    const r = deriveUpdateState({ configured: true, currentVersion: '0.9.0', result: { kind: 'ok', latest: entry('0.10.0') } });
    expect(r.state).toBe('update_available');
    expect(r.latest?.version).toBe('0.10.0');
    expect(r.needsIntermediateVersion).toBe(false);
  });

  it('cùng bản hoặc bản trên máy chủ cũ hơn → up_to_date (không mời hạ cấp)', () => {
    for (const latest of ['0.9.0', '0.8.5']) {
      expect(deriveUpdateState({ configured: true, currentVersion: '0.9.0', result: { kind: 'ok', latest: entry(latest) } }).state, latest).toBe('up_to_date');
    }
  });

  it('so sánh theo SemVer: bản chính thức mới hơn bản beta cùng số', () => {
    expect(deriveUpdateState({ configured: true, currentVersion: '1.0.0-beta.2', result: { kind: 'ok', latest: entry('1.0.0') } }).state).toBe('update_available');
  });

  it('phiên bản hiện tại thấp hơn minimumFromVersion → cần bản trung gian', () => {
    const r = deriveUpdateState({ configured: true, currentVersion: '0.9.0', result: { kind: 'ok', latest: entry('1.2.0', { minimumFromVersion: '1.0.0' }) } });
    expect(r).toMatchObject({ state: 'update_available', needsIntermediateVersion: true });
  });

  it('phiên bản hiện tại đạt minimumFromVersion → nâng thẳng', () => {
    const r = deriveUpdateState({ configured: true, currentVersion: '1.0.0', result: { kind: 'ok', latest: entry('1.2.0', { minimumFromVersion: '1.0.0' }) } });
    expect(r.needsIntermediateVersion).toBe(false);
  });

  it('phiên bản đang chạy không phải SemVer → error rõ ràng, không so sánh sai', () => {
    const r = deriveUpdateState({ configured: true, currentVersion: 'abc', result: { kind: 'ok', latest: entry('1.0.0') } });
    expect(r.state).toBe('error');
    expect(r.errorMessage).toContain('phiên bản');
  });
});
