import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type BundledReleaseNotes, loadBundledReleaseNotes, notesForUpgrade, parseReleaseNotes } from './release-notes';

const note = (version: string, over: Partial<BundledReleaseNotes> = {}): BundledReleaseNotes => ({ version, releasedAt: '2026-10-30', features: [`tính năng ${version}`], improvements: [], fixes: [], ...over });

describe('parseReleaseNotes', () => {
  it('nhận file đúng định dạng, cắt khoảng trắng đầu/cuối mỗi dòng', () => {
    expect(parseReleaseNotes({ version: '0.9.0', releasedAt: '2026-10-15', features: ['  A  '], improvements: [], fixes: ['B'] })).toEqual({ version: '0.9.0', releasedAt: '2026-10-15', features: ['A'], improvements: [], fixes: ['B'] });
  });

  it('từ chối: không phải đối tượng, thiếu nhóm, sai ngày, dòng rỗng/quá dài/không phải chữ', () => {
    expect(parseReleaseNotes(null)).toBeNull();
    expect(parseReleaseNotes('x')).toBeNull();
    expect(parseReleaseNotes({ version: '0.9.0', releasedAt: '2026-10-15', features: [], improvements: [] })).toBeNull();
    expect(parseReleaseNotes({ version: '0.9.0', releasedAt: '15/10/2026', features: [], improvements: [], fixes: [] })).toBeNull();
    expect(parseReleaseNotes({ version: '0.9.0', releasedAt: '2026-10-15', features: [' '], improvements: [], fixes: [] })).toBeNull();
    expect(parseReleaseNotes({ version: '0.9.0', releasedAt: '2026-10-15', features: ['x'.repeat(301)], improvements: [], fixes: [] })).toBeNull();
    expect(parseReleaseNotes({ version: '0.9.0', releasedAt: '2026-10-15', features: [1], improvements: [], fixes: [] })).toBeNull();
  });
});

describe('notesForUpgrade', () => {
  const all = [note('0.9.0'), note('0.9.1'), note('0.9.2'), note('0.10.0')];

  it('chỉ lấy ghi chú của CHÍNH bản sắp cài, kể cả khi nhảy qua nhiều bản (không gộp các bản ở giữa); so theo số chứ không theo chuỗi', () => {
    expect(notesForUpgrade(all, '0.9.0', '0.10.0')?.version).toBe('0.10.0');
    expect(notesForUpgrade(all, '0.9.0', '0.9.2')?.version).toBe('0.9.2');
    expect(notesForUpgrade(all, '0.9.1', '0.9.2')).toEqual(note('0.9.2'));
  });

  it('không nâng cấp (cùng bản / bản gói thấp hơn / thiếu một đầu) → null', () => {
    expect(notesForUpgrade(all, '0.9.2', '0.9.2')).toBeNull();
    expect(notesForUpgrade(all, '0.10.0', '0.9.0')).toBeNull();
    expect(notesForUpgrade(all, null, '0.9.2')).toBeNull();
    expect(notesForUpgrade(all, '0.9.0', null)).toBeNull();
  });

  it('gói không kèm ghi chú của bản sắp cài (dù có ghi chú các bản khác) → null, không báo lỗi; trùng số thì lấy bản đầu', () => {
    expect(notesForUpgrade([note('0.9.0'), note('0.9.1')], '0.9.0', '0.9.2')).toBeNull();
    expect(notesForUpgrade([note('0.9.1'), note('0.9.1', { features: ['trùng'] })], '0.9.0', '0.9.1')?.features).toEqual(['tính năng 0.9.1']);
  });
});

describe('loadBundledReleaseNotes', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('đọc file hợp lệ, bỏ file hỏng / sai tên / không phải JSON; thiếu thư mục → rỗng', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexamed-notes-'));
    expect(await loadBundledReleaseNotes(dir)).toEqual([]);
    await mkdir(join(dir, 'release-notes'));
    await writeFile(join(dir, 'release-notes', '0.9.1.json'), JSON.stringify(note('0.9.1')));
    await writeFile(join(dir, 'release-notes', '0.9.2.json'), '{ khong phai json');
    await writeFile(join(dir, 'release-notes', '0.9.3.json'), JSON.stringify(note('0.9.9')));
    await writeFile(join(dir, 'release-notes', 'ghi-chu.txt'), 'x');
    expect((await loadBundledReleaseNotes(dir)).map((n) => n.version)).toEqual(['0.9.1']);
  });
});
