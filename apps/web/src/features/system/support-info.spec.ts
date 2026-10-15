import { describe, expect, it } from 'vitest';
import type { SystemVersion } from '@nexamed/shared';
import { buildSupportInfo, formatReleaseDate } from './support-info';

const server: SystemVersion = {
  version: '0.9.0',
  build: '127',
  channel: 'stable',
  releasedAt: '2026-10-15',
  deploymentMode: 'single',
  schemaVersion: '20261015090000_branch_dot2',
  notes: null,
};

describe('formatReleaseDate', () => {
  it('đổi ISO sang ngày/tháng/năm', () => {
    expect(formatReleaseDate('2026-10-15')).toBe('15/10/2026');
  });
  it('thiếu ngày thì hiện gạch', () => {
    expect(formatReleaseDate(null)).toBe('—');
  });
});

describe('buildSupportInfo', () => {
  it('gồm phiên bản đầy đủ, kênh, chế độ, cơ sở dữ liệu và gói web', () => {
    const text = buildSupportInfo(server, { version: '0.9.0', build: '127' }, 'Chrome/130');
    expect(text).toContain('NEXAMed 0.9.0+127');
    expect(text).toContain('Kênh: Ổn định | Chế độ: Một công ty (máy chủ riêng)');
    expect(text).toContain('Phiên bản cơ sở dữ liệu: 20261015090000_branch_dot2');
    expect(text).toContain('Giao diện (Web): 0.9.0+127');
    expect(text).toContain('Trình duyệt: Chrome/130');
  });

  it('không đọc được máy chủ thì vẫn có thông tin gói web để hỗ trợ', () => {
    const text = buildSupportInfo(null, { version: '0.9.0', build: 'dev' }, 'Chrome/130');
    expect(text).toContain('không đọc được từ máy chủ');
    expect(text).toContain('Giao diện (Web): 0.9.0');
  });

  it('không chứa dữ liệu định danh người dùng hay công ty', () => {
    const text = buildSupportInfo(server, { version: '0.9.0', build: 'x' }, 'UA');
    expect(text).not.toMatch(/tenant|username|họ tên/i);
  });
});
