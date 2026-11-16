import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_PORT, type StoragePort } from '@nexamed/core';
import type { PatientDocumentUsage } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { PatientDocumentUsageRepository } from './patient-document-usage.repository';

/** Số lần đo dung lượng tệp chạy đồng thời — đủ nhanh cho hàng chục nghìn tệp mà không mở quá nhiều tệp cùng lúc. */
const STAT_CONCURRENCY = 32;
/** Giữ tối đa chừng này kết quả đo trong bộ nhớ (mỗi dòng ~100 byte); vượt thì xoá hết đo lại, vẫn đúng. */
const SIZE_CACHE_LIMIT = 200_000;

/**
 * Dung lượng đã dùng của tệp gắn bệnh nhân ở Cấu hình chung (docs/DECISIONS.md #299 bổ sung 4, mockup màn 13). Phần có `size_bytes` lấy từ CSDL bằng một transaction ngắn; phần
 * không có (ảnh thẻ BHYT, ảnh đại diện, ảnh thu nhỏ) đo bằng `StoragePort.sizeOf` SAU khi transaction đóng (#264). Khoá lưu là UUID mới cho mỗi lần tải và nội dung không đổi,
 * nên kết quả đo được nhớ lại: các lần xem sau chỉ đo thêm tệp mới.
 */
@Injectable()
export class PatientDocumentUsageService {
  private readonly sizeCache = new Map<string, number>();

  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: PatientDocumentUsageRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async getUsage(tenantId: string): Promise<PatientDocumentUsage> {
    const data = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.collect(tx, tenantId));

    const unique = new Map<string, boolean>();
    for (const item of data.unsized) unique.set(item.key, (unique.get(item.key) ?? false) || item.counted);
    const keys = [...unique.keys()];
    let cursor = 0;
    const sizes = new Map<string, number>();
    const worker = async (): Promise<void> => {
      while (cursor < keys.length) {
        const key = keys[cursor++] as string;
        const size = await this.sizeOfCached(tenantId, key);
        if (size !== null) sizes.set(key, size);
      }
    };
    await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, keys.length) }, worker));

    let totalBytes = data.uploads.bytes + data.results.bytes;
    let fileCount = data.uploads.count + data.results.count;
    for (const [key, counted] of unique) {
      const size = sizes.get(key);
      if (size === undefined) continue; // tệp không còn trong kho: không có gì chiếm chỗ
      totalBytes += size;
      if (counted) fileCount += 1;
    }

    const volume = await this.storage.volumeUsage();
    return { fileCount, totalBytes, volumeTotalBytes: volume?.totalBytes ?? null, volumeFreeBytes: volume?.freeBytes ?? null };
  }

  private async sizeOfCached(tenantId: string, key: string): Promise<number | null> {
    const cacheKey = `${tenantId}|${key}`;
    const hit = this.sizeCache.get(cacheKey);
    if (hit !== undefined) return hit;
    const size = await this.storage.sizeOf(tenantId, key);
    if (size !== null) {
      if (this.sizeCache.size >= SIZE_CACHE_LIMIT) this.sizeCache.clear();
      this.sizeCache.set(cacheKey, size);
    }
    return size;
  }
}
