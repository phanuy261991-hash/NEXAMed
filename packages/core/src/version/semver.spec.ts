import { describe, expect, it } from 'vitest';
import { bumpVersion, channelOfVersion, compareSemver, isValidSemver, parseSemver } from './semver';

describe('parseSemver', () => {
  it('đọc đủ các phần, kể cả tiền phát hành và thông tin bản dựng', () => {
    expect(parseSemver('0.9.0')).toEqual({ major: 0, minor: 9, patch: 0, prerelease: [], build: null });
    expect(parseSemver('1.5.0-beta.2+20261015.e97a27c')).toEqual({ major: 1, minor: 5, patch: 0, prerelease: ['beta', '2'], build: '20261015.e97a27c' });
  });

  it('từ chối chuỗi sai chuẩn', () => {
    for (const bad of ['', '1', '1.2', 'v1.2.3', '01.2.3', '1.2.3-', '1.2.3-01', '1.2.3+', 'abc', '1.2.3.4']) {
      expect(parseSemver(bad), bad).toBeNull();
      expect(isValidSemver(bad)).toBe(false);
    }
  });
});

describe('compareSemver', () => {
  it('so sánh số theo thứ tự số học, không theo chữ', () => {
    expect(compareSemver('0.9.0', '0.10.0')).toBe(-1);
    expect(compareSemver('1.10.0', '1.9.9')).toBe(1);
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
  });

  it('bản tiền phát hành nhỏ hơn bản chính thức cùng số', () => {
    expect(compareSemver('1.0.0-beta.2', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBe(1);
  });

  it('theo đúng ví dụ thứ tự trong chuẩn SemVer 2.0', () => {
    const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareSemver(ordered[i]!, ordered[i + 1]!), `${ordered[i]} < ${ordered[i + 1]}`).toBe(-1);
      expect(compareSemver(ordered[i + 1]!, ordered[i]!)).toBe(1);
    }
  });

  it('bỏ qua thông tin bản dựng', () => {
    expect(compareSemver('1.2.3+aaa', '1.2.3+zzz')).toBe(0);
  });

  it('ném lỗi khi phiên bản không hợp lệ thay vì so sánh sai', () => {
    expect(() => compareSemver('1.2', '1.2.3')).toThrow();
  });
});

describe('bumpVersion', () => {
  it('tăng chính, phụ, vá', () => {
    expect(bumpVersion('0.9.0', 'patch')).toBe('0.9.1');
    expect(bumpVersion('0.9.4', 'minor')).toBe('0.10.0');
    expect(bumpVersion('0.9.4', 'major')).toBe('1.0.0');
  });

  it('chốt chính thức từ bản beta bằng patch', () => {
    expect(bumpVersion('1.5.0-beta.3', 'patch')).toBe('1.5.0');
  });

  it('beta: mở đợt thử nghiệm của minor kế tiếp rồi tăng số beta', () => {
    expect(bumpVersion('1.4.2', 'beta')).toBe('1.5.0-beta.1');
    expect(bumpVersion('1.5.0-beta.1', 'beta')).toBe('1.5.0-beta.2');
  });

  it('ném lỗi khi phiên bản hiện tại không hợp lệ', () => {
    expect(() => bumpVersion('abc', 'patch')).toThrow();
  });
});

describe('channelOfVersion', () => {
  it('beta khi có tiền phát hành beta, còn lại là stable', () => {
    expect(channelOfVersion('1.5.0-beta.1')).toBe('beta');
    expect(channelOfVersion('1.5.0')).toBe('stable');
    expect(channelOfVersion('1.5.0-rc.1')).toBe('stable');
  });
});
