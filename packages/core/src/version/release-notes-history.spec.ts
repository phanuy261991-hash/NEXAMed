import { describe, expect, it } from 'vitest';
import { selectReleaseNotesHistory } from './release-notes-history';

const n = (version: string) => ({ version, tag: `ghi chú ${version}` });

describe('selectReleaseNotesHistory', () => {
  it('chỉ lấy bản THẤP HƠN bản đang chạy, mới nhất trước (so theo SemVer, không theo chuỗi)', () => {
    const all = [n('0.9.0'), n('0.10.0'), n('0.9.1'), n('1.0.0'), n('0.2.0')];
    expect(selectReleaseNotesHistory(all, '0.10.0', 10).map((x) => x.version)).toEqual(['0.9.1', '0.9.0', '0.2.0']);
  });

  it('bản đang chạy và bản cao hơn không có trong lịch sử', () => {
    const all = [n('1.0.0'), n('1.1.0'), n('0.9.0')];
    expect(selectReleaseNotesHistory(all, '1.0.0', 10).map((x) => x.version)).toEqual(['0.9.0']);
  });

  it('giới hạn số bản, giữ các bản gần nhất', () => {
    const all = Array.from({ length: 15 }, (_, i) => n(`0.${i + 1}.0`));
    const r = selectReleaseNotesHistory(all, '0.16.0', 10);
    expect(r).toHaveLength(10);
    expect(r[0]!.version).toBe('0.15.0');
    expect(r[9]!.version).toBe('0.6.0');
  });

  it('bỏ bản sai SemVer và bản trùng số phiên bản (giữ bản đầu)', () => {
    const all = [{ version: 'abc', tag: 'x' }, { version: '0.9.0', tag: 'đầu' }, { version: '0.9.0', tag: 'trùng' }, n('0.8.0')];
    const r = selectReleaseNotesHistory(all, '1.0.0', 10);
    expect(r.map((x) => x.version)).toEqual(['0.9.0', '0.8.0']);
    expect(r[0]!.tag).toBe('đầu');
  });

  it('bản tiền phát hành thấp hơn bản chính thức cùng số được tính là bản trước', () => {
    expect(selectReleaseNotesHistory([n('1.0.0-beta.1'), n('0.9.0')], '1.0.0', 10).map((x) => x.version)).toEqual(['1.0.0-beta.1', '0.9.0']);
  });

  it('phiên bản đang chạy không hợp lệ (máy phát triển 0.0.0-dev vẫn hợp lệ) hoặc limit ≤ 0 → rỗng', () => {
    expect(selectReleaseNotesHistory([n('0.9.0')], 'khong-hop-le', 10)).toEqual([]);
    expect(selectReleaseNotesHistory([n('0.9.0')], '1.0.0', 0)).toEqual([]);
    expect(selectReleaseNotesHistory([n('0.9.0')], '0.0.0-dev', 10)).toEqual([]);
  });
});
