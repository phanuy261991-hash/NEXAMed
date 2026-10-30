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

  it('lấy mọi bản từ SAU bản đang chạy đến bản sắp cài (gồm), mới nhất trước, so theo số chứ không theo chuỗi', () => {
    expect(notesForUpgrade(all, '0.9.0', '0.10.0')?.items.map((n) => n.version)).toEqual(['0.10.0', '0.9.2', '0.9.1']);
    expect(notesForUpgrade(all, '0.9.0', '0.9.2')?.items.map((n) => n.version)).toEqual(['0.9.2', '0.9.1']);
  });

  it('nhảy đúng một bản → chỉ ghi chú của bản đó; ghi rõ from/to', () => {
    const r = notesForUpgrade(all, '0.9.1', '0.9.2');
    expect(r?.items.map((n) => n.version)).toEqual(['0.9.2']);
    expect([r?.from, r?.to]).toEqual(['0.9.1', '0.9.2']);
  });

  it('không nâng cấp (cùng bản / bản gói thấp hơn / thiếu một đầu) → null', () => {
    expect(notesForUpgrade(all, '0.9.2', '0.9.2')).toBeNull();
    expect(notesForUpgrade(all, '0.10.0', '0.9.0')).toBeNull();
    expect(notesForUpgrade(all, null, '0.9.2')).toBeNull();
    expect(notesForUpgrade(all, '0.9.0', null)).toBeNull();
  });

  it('gói không kèm ghi chú của các bản giữa → null (không báo lỗi); bỏ bản trùng số', () => {
    expect(notesForUpgrade([note('0.9.0')], '0.9.0', '0.9.2')).toBeNull();
    expect(notesForUpgrade([note('0.9.1'), note('0.9.1', { features: ['trùng'] })], '0.9.0', '0.9.1')?.items).toHaveLength(1);
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
