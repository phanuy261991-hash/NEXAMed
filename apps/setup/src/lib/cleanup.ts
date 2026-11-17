/**
 * DỌN GÓI CŨ (docs/DECISIONS.md #301): xoá tệp nạp ảnh `.tar.gz` trong `images/` và gỡ ảnh Docker của các bản NEXAMed cũ để lấy lại ổ đĩa.
 * Luôn giữ: bản đang chạy, bản trước (theo lần nâng cấp gần nhất — đúng với nút "Quay lui"), bản mới trong gói. Không đụng cơ sở dữ liệu, `.env`, `config.json`, `certs`,
 * `release-notes` và các bản sao lưu `upgrade-backups` (chỉ đếm để hiện). Danh sách bản cần dọn luôn do MÁY CHỦ tính lại, không tin giao diện.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DockerClient } from './docker';
import type { StepDef } from './job';
import { compareVersions } from './package-files';
import { BACKUP_DIR_NAME } from './upgrade';

/** Tệp nạp ảnh của một bản: `nexamed-<api|web|backup|setup>-<phiên bản>.tar[.gz]`. Tệp bên thứ ba (`third-party-*`) không khớp nên không bao giờ bị xoá. */
const APP_IMAGE_FILE = /^(nexamed-(?:api|web|backup|setup))-(.+)\.tar(?:\.gz)?$/;

export type CleanupAction = 'running' | 'previous' | 'package' | 'clean';

export interface CleanupVersionRow {
  version: string;
  fileCount: number;
  fileBytes: number;
  /** Số ảnh Docker của bản này đang có trên máy. */
  dockerImages: number;
  action: CleanupAction;
}

export interface CleanupPlan {
  /** `false` khi Docker không trả lời: danh sách chỉ dựa vào tệp, có thể thiếu ảnh Docker. */
  dockerAvailable: boolean;
  /** Mọi bản có tệp hoặc ảnh trên máy: các bản được giữ ở trên, bản sẽ dọn ở dưới (mới trước). */
  rows: CleanupVersionRow[];
  cleanVersions: string[];
  cleanBytes: number;
  backups: { count: number; bytes: number };
}

export interface CleanupKeep {
  installed: string;
  packageVersion: string | null;
  /** Bản trước lần nâng cấp gần nhất (null nếu chưa nâng cấp lần nào hoặc đã quay lui). */
  previous: string | null;
}

export type CleanupFailureReason = 'docker-unavailable' | 'in-use' | 'file' | 'other';

export interface CleanupState {
  freedBytes: number;
  removedVersions: string[];
  failures: Array<{ version: string; reason: CleanupFailureReason }>;
}

export interface CleanupDeps {
  docker: DockerClient;
  workDir: string;
}

function actionOf(version: string, keep: CleanupKeep): CleanupAction {
  if (version === keep.installed) return 'running';
  if (version === keep.previous) return 'previous';
  if (version === keep.packageVersion) return 'package';
  return 'clean';
}

async function listVersionFiles(workDir: string): Promise<Map<string, Array<{ name: string; bytes: number }>>> {
  const dir = join(workDir, 'images');
  const byVersion = new Map<string, Array<{ name: string; bytes: number }>>();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return byVersion;
  }
  for (const name of names) {
    const match = APP_IMAGE_FILE.exec(name);
    if (!match) continue;
    let bytes = 0;
    try {
      bytes = (await stat(join(dir, name))).size;
    } catch {
      continue;
    }
    const version = match[2]!;
    const list = byVersion.get(version) ?? [];
    list.push({ name, bytes });
    byVersion.set(version, list);
  }
  return byVersion;
}

async function backupsInfo(workDir: string): Promise<{ count: number; bytes: number }> {
  const dir = join(workDir, BACKUP_DIR_NAME);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return { count: 0, bytes: 0 };
  }
  let count = 0;
  let bytes = 0;
  for (const name of names) {
    if (!name.endsWith('.dump')) continue;
    try {
      bytes += (await stat(join(dir, name))).size;
      count += 1;
    } catch {
      // tệp vừa bị xoá — bỏ qua
    }
  }
  return { count, bytes };
}

export async function buildCleanupPlan(deps: CleanupDeps, keep: CleanupKeep): Promise<CleanupPlan> {
  const files = await listVersionFiles(deps.workDir);
  const images = await deps.docker.listAppImages();
  const imageCount = new Map<string, number>();
  for (const image of images ?? []) imageCount.set(image.tag, (imageCount.get(image.tag) ?? 0) + 1);

  const versions = new Set<string>([...files.keys(), ...imageCount.keys()]);
  // Bản đang chạy luôn có mặt trong danh sách (kể cả khi tệp nạp ảnh đã bị xoá) để người dùng thấy rõ nó được giữ.
  versions.add(keep.installed);
  const rows: CleanupVersionRow[] = [...versions].map((version) => {
    const list = files.get(version) ?? [];
    return {
      version,
      fileCount: list.length,
      fileBytes: list.reduce((sum, f) => sum + f.bytes, 0),
      dockerImages: imageCount.get(version) ?? 0,
      action: actionOf(version, keep),
    };
  });
  const keepOrder: Record<CleanupAction, number> = { running: 0, previous: 1, package: 2, clean: 3 };
  rows.sort((a, b) => keepOrder[a.action] - keepOrder[b.action] || compareVersions(b.version, a.version));

  // Chỉ bản còn thứ gì đó để dọn (tệp hoặc ảnh) mới đáng liệt kê là "sẽ dọn".
  const clean = rows.filter((r) => r.action === 'clean' && (r.fileCount > 0 || r.dockerImages > 0));
  const visible = rows.filter((r) => r.action !== 'clean' || clean.includes(r));
  return {
    dockerAvailable: images !== null,
    rows: visible,
    cleanVersions: clean.map((r) => r.version),
    cleanBytes: clean.reduce((sum, r) => sum + r.fileBytes, 0),
    backups: await backupsInfo(deps.workDir),
  };
}

export function newCleanupState(): CleanupState {
  return { freedBytes: 0, removedVersions: [], failures: [] };
}

/** Một bước cho mỗi bản. Bước KHÔNG ném lỗi: lỗi của một bản được ghi vào `state.failures` để các bản còn lại vẫn được dọn. */
export function buildCleanupSteps(versions: string[], deps: CleanupDeps, keep: CleanupKeep, state: CleanupState): StepDef[] {
  // Danh sách ảnh Docker đọc một lần, ở bước đầu, để mọi bản dùng chung (không gọi lại Docker cho từng bản).
  let imageList: Array<{ repo: string; tag: string }> | null | undefined;
  return versions.map((version, index) => ({
    id: `clean-${index}`,
    title: `Bản ${version}`,
    detail: 'Xoá tệp nạp ảnh và gỡ ảnh Docker',
    run: async (ctx) => {
      // Phòng thủ lần hai: không bao giờ dọn bản đang được giữ, dù danh sách gửi tới có sai thế nào.
      if (actionOf(version, keep) !== 'clean') {
        ctx.note('Đang được giữ, bỏ qua');
        return;
      }
      let failed: CleanupFailureReason | null = null;

      const files = (await listVersionFiles(deps.workDir)).get(version) ?? [];
      let removedFiles = 0;
      for (const file of files) {
        try {
          await unlink(join(deps.workDir, 'images', file.name));
          state.freedBytes += file.bytes;
          removedFiles += 1;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          failed ??= 'file';
        }
      }

      if (imageList === undefined) imageList = await deps.docker.listAppImages();
      let removedImages = 0;
      if (imageList === null) {
        failed ??= 'docker-unavailable';
      } else {
        for (const image of imageList.filter((i) => i.tag === version)) {
          const result = await deps.docker.removeImage(`${image.repo}:${image.tag}`);
          if (result.ok) removedImages += 1;
          else failed ??= result.reason;
        }
      }

      if (failed) state.failures.push({ version, reason: failed });
      else state.removedVersions.push(version);
      if (failed) ctx.note('Chưa dọn hết');
      else if (removedFiles > 0 && removedImages > 0) ctx.note('Đã xoá tệp nạp ảnh và ảnh Docker');
      else if (removedFiles > 0) ctx.note('Đã xoá tệp nạp ảnh');
      else if (removedImages > 0) ctx.note('Đã gỡ ảnh Docker');
      else ctx.note('Không còn gì để dọn');
    },
  }));
}
