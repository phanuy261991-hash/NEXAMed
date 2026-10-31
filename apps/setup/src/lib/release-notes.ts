/**
 * Ghi chú phát hành đóng trong gói cài đặt (mockup đã chốt https://claude.ai/artifact/R6oTbDuS7fczynmib7V5BT, 30/10/2026): `build-and-export.ps1` chép mọi `apps/api/release-notes/<phiên bản>.json` vào
 * thư mục `release-notes/` của gói. Khi NÂNG CẤP, bước "Bản đang chạy và bản mới" hiện ghi chú của CHÍNH bản sắp cài (chủ dự án chốt 30/10/2026: không gộp các bản ở giữa).
 * Gói cũ không kèm ghi chú, hoặc file hỏng, thì không có gì để hiện — KHÔNG báo lỗi, không chặn nâng cấp. Trình cài đặt là ứng dụng riêng, không import `@nexamed/shared`, nên tự kiểm định dạng ở đây.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { compareVersions } from './package-files';

export interface BundledReleaseNotes {
  version: string;
  releasedAt: string;
  features: string[];
  improvements: string[];
  fixes: string[];
}

const MAX_LINES_PER_GROUP = 50;
const MAX_LINE_LENGTH = 300;

function cleanLines(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_LINES_PER_GROUP) return null;
  const lines: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return null;
    const line = raw.trim();
    if (line.length === 0 || line.length > MAX_LINE_LENGTH) return null;
    lines.push(line);
  }
  return lines;
}

/** Một file ghi chú hợp lệ, hoặc `null` (sai định dạng — bỏ qua). */
export function parseReleaseNotes(raw: unknown): BundledReleaseNotes | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== 'string' || o.version.length === 0 || typeof o.releasedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.releasedAt)) return null;
  const features = cleanLines(o.features);
  const improvements = cleanLines(o.improvements);
  const fixes = cleanLines(o.fixes);
  if (!features || !improvements || !fixes) return null;
  return { version: o.version, releasedAt: o.releasedAt, features, improvements, fixes };
}

/** Đọc mọi `release-notes/*.json` hợp lệ trong thư mục gói; tên file phải khớp phiên bản bên trong (như quy ước của `scripts/release.mjs`). Thiếu thư mục → danh sách rỗng. */
export async function loadBundledReleaseNotes(workDir: string): Promise<BundledReleaseNotes[]> {
  const dir = join(workDir, 'release-notes');
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const all: BundledReleaseNotes[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed = parseReleaseNotes(JSON.parse(await readFile(join(dir, name), 'utf8')));
      if (parsed && `${parsed.version}.json` === name) all.push(parsed);
    } catch {
      // file hỏng — bỏ qua
    }
  }
  return all;
}

/** Ghi chú của bản sắp cài (`target`), CHỈ khi đó là một lần nâng cấp (`target` cao hơn `installed`); gói không kèm ghi chú của bản đó (hoặc thiếu một đầu) thì `null`. */
export function notesForUpgrade(all: readonly BundledReleaseNotes[], installed: string | null, target: string | null): BundledReleaseNotes | null {
  if (!installed || !target || compareVersions(target, installed) <= 0) return null;
  return all.find((n) => compareVersions(n.version, target) === 0) ?? null;
}
