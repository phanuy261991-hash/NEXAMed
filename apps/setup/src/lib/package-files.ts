/**
 * Đọc gói cài đặt đã giải nén vào thư mục cài đặt (`/work`): các file ảnh Docker trong `images/` và file `.env`.
 * Tên file ảnh do `deploy/on-prem/build-and-export.ps1` đặt: `nexamed-<api|web|backup>-<phiên bản>.tar.gz`, cộng `third-party-caddy.tar.gz` / `third-party-postgres.tar.gz`.
 */
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getEnvValue } from './env-file';

export const APP_IMAGES = ['nexamed-api', 'nexamed-web', 'nexamed-backup'] as const;
export const THIRD_PARTY_IMAGES = [
  { ref: 'postgres:18', file: 'third-party-postgres' },
  { ref: 'caddy:2.8-alpine', file: 'third-party-caddy' },
] as const;

export interface PackageInfo {
  /** Phiên bản có đủ cả 3 ảnh ứng dụng, mới nhất trước (so theo chuỗi số). */
  versions: string[];
  /** File ảnh theo `<tên>:<phiên bản>` → đường dẫn tuyệt đối trong container. */
  files: Map<string, string>;
}

const VERSION_FILE = /^(nexamed-(?:api|web|backup))-(.+)\.tar(?:\.gz)?$/;

/** So sánh hai nhãn phiên bản dạng `2026.10.15.2` hoặc SemVer `0.9.0` theo từng đoạn số; đoạn không phải số so theo chuỗi. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => v.split(/[.+-]/);
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export async function discoverPackage(workDir: string): Promise<PackageInfo> {
  const imagesDir = join(workDir, 'images');
  let names: string[] = [];
  try {
    names = await readdir(imagesDir);
  } catch {
    names = [];
  }
  const files = new Map<string, string>();
  const byVersion = new Map<string, Set<string>>();
  for (const name of names) {
    const match = VERSION_FILE.exec(name);
    if (match) {
      const [, image, version] = match;
      const key = `${image}:${version}`;
      // Ưu tiên .tar.gz nếu có cả hai; đơn giản hơn là lấy file đầu gặp, nhưng .gz gọn hơn nên ghi đè khi gặp.
      if (!files.has(key) || name.endsWith('.gz')) files.set(key, join(imagesDir, name));
      if (!byVersion.has(version!)) byVersion.set(version!, new Set());
      byVersion.get(version!)!.add(image!);
    } else {
      for (const tp of THIRD_PARTY_IMAGES) {
        if (name === `${tp.file}.tar.gz` || name === `${tp.file}.tar`) files.set(tp.ref, join(imagesDir, name));
      }
    }
  }
  const versions = [...byVersion.entries()]
    .filter(([, set]) => APP_IMAGES.every((img) => set.has(img)))
    .map(([v]) => v)
    .sort((a, b) => compareVersions(b, a));
  return { versions, files };
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Phiên bản đang ghi trong `.env` (null nếu chưa cài hoặc vẫn là giá trị mẫu). */
export async function readInstalledVersion(workDir: string): Promise<string | null> {
  try {
    const text = await readFile(join(workDir, '.env'), 'utf8');
    const value = getEnvValue(text, 'NEXAMED_VERSION');
    if (!value || value.startsWith('doi-gia-tri')) return null;
    return value;
  } catch {
    return null;
  }
}
