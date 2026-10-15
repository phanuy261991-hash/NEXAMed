import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { channelOfVersion, isValidSemver } from '@nexamed/core';
import { releaseNotesSchema, type ReleaseChannel, type ReleaseNotes, type SystemVersion } from '@nexamed/shared';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

/** Số phiên bản dự phòng khi chạy ở máy phát triển mà không có bản dựng thật (không có biến `APP_VERSION` và không đọc được `package.json` gốc). */
const FALLBACK_VERSION = '0.0.0-dev';
/** Migration mới nhất ít đổi — endpoint này công khai nên không truy vấn DB mỗi lần gọi. */
const SCHEMA_VERSION_TTL_MS = 60_000;

/**
 * Phiên bản phần mềm ĐANG CHẠY (docs/DECISIONS.md #236). Mọi số liệu lấy từ bản dựng thật, không gõ tay:
 * - `APP_VERSION`/`BUILD_ID`/`RELEASE_CHANNEL`/`RELEASED_AT` do ảnh Docker truyền lúc dựng (`deploy/on-prem/build-and-export.ps1`); thiếu thì (máy phát triển) lấy phiên bản từ `package.json` gốc.
 * - Ghi chú phát hành đọc từ `apps/api/release-notes/<phiên bản>.json` đi cùng ảnh; thiếu hoặc sai định dạng → `null` (không làm hỏng endpoint).
 * - Phiên bản cơ sở dữ liệu đọc thật từ bảng `_prisma_migrations` (migration đã áp xong mới nhất), lưu đệm ngắn.
 */
@Injectable()
export class SystemVersionService {
  private readonly logger = new Logger(SystemVersionService.name);
  private readonly version: string;
  private notes: ReleaseNotes | null | undefined;
  private schemaCache: { value: string | null; at: number } | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    this.version = this.resolveVersion();
  }

  async getVersion(): Promise<SystemVersion> {
    const notes = this.loadNotes();
    const channel: ReleaseChannel = this.config.get('RELEASE_CHANNEL', { infer: true }) ?? (this.config.get('APP_VERSION', { infer: true }) ? channelOfVersion(this.version) : 'dev');
    return {
      version: this.version,
      build: this.config.get('BUILD_ID', { infer: true }) ?? 'dev',
      channel,
      releasedAt: this.config.get('RELEASED_AT', { infer: true }) ?? notes?.releasedAt ?? null,
      deploymentMode: this.config.get('DEPLOYMENT_MODE', { infer: true }),
      schemaVersion: await this.readSchemaVersion(),
      notes,
    };
  }

  private resolveVersion(): string {
    const fromEnv = this.config.get('APP_VERSION', { infer: true });
    if (fromEnv) return fromEnv;
    for (const candidate of [resolve(process.cwd(), '../../package.json'), resolve(process.cwd(), 'package.json')]) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
        if (parsed.name === 'nexamed' && parsed.version && isValidSemver(parsed.version)) return parsed.version;
      } catch {
        // thử đường dẫn kế tiếp
      }
    }
    return FALLBACK_VERSION;
  }

  private loadNotes(): ReleaseNotes | null {
    if (this.notes !== undefined) return this.notes;
    this.notes = null;
    // `version` đã qua kiểm SemVer ở trên/`APP_VERSION` (có thể lẫn ký tự lạ nếu cấu hình sai) — chỉ dùng làm tên file khi đúng SemVer, chặn đi ra ngoài thư mục ghi chú.
    if (isValidSemver(this.version)) {
      try {
        const raw = readFileSync(join(__dirname, '..', '..', '..', 'release-notes', `${this.version}.json`), 'utf8');
        const parsed = releaseNotesSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.version === this.version) this.notes = parsed.data;
        else this.logger.warn(`Ghi chú phát hành của ${this.version} sai định dạng hoặc sai phiên bản — bỏ qua.`);
      } catch {
        // Không có ghi chú cho bản này (ví dụ bản phát triển) — bình thường.
      }
    }
    return this.notes;
  }

  private async readSchemaVersion(): Promise<string | null> {
    const now = Date.now();
    if (this.schemaCache && now - this.schemaCache.at < SCHEMA_VERSION_TTL_MS) return this.schemaCache.value;
    let value: string | null = null;
    try {
      const rows = await this.prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1`;
      value = rows[0]?.migration_name ?? null;
    } catch {
      value = null;
    }
    this.schemaCache = { value, at: now };
    return value;
  }
}
