import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import type { StoragePort, StoredFileRef } from '@nexamed/core';
import type { Env } from '../../config/env.schema';

/**
 * Adapter v1 cho StoragePort — ghi/đọc/xoá file trên disk cục bộ dưới `STORAGE_DIR/<tenantId>/
 * <key>`, cách ly theo tenant bằng đường dẫn con. Sau này đổi sang S3/MinIO chỉ thay adapter
 * này, không sửa service (xem .claude/docs/project-structure.md).
 */
@Injectable()
export class LocalDiskStorageAdapter implements StoragePort {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  async save(tenantId: string, key: string, content: Uint8Array, contentType: string): Promise<StoredFileRef> {
    const filePath = this.resolvePath(tenantId, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return { key, sizeBytes: content.byteLength, contentType };
  }

  async read(tenantId: string, key: string): Promise<Uint8Array> {
    const filePath = this.resolvePath(tenantId, key);
    return new Uint8Array(await readFile(filePath));
  }

  async delete(tenantId: string, key: string): Promise<void> {
    const filePath = this.resolvePath(tenantId, key);
    await rm(filePath, { force: true });
  }

  /** Chặn path traversal qua `key` — key luôn do code nội bộ sinh, nhưng không tin ngay cả vậy. */
  private resolvePath(tenantId: string, key: string): string {
    if (key.includes('..')) {
      throw new Error('StoragePort: key chứa ".." không hợp lệ.');
    }
    const baseDir = this.configService.get('STORAGE_DIR', { infer: true });
    return normalize(join(baseDir, tenantId, key));
  }
}
