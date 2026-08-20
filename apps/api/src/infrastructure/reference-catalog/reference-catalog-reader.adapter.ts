import { Injectable } from '@nestjs/common';
import type { ReferenceCatalogReaderPort } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { ReferenceCatalogRepository } from '../../modules/reference-catalog/reference-catalog.repository';

/**
 * Adapter thật (không no-op) cho `ReferenceCatalogReaderPort` (mở rộng ADM-01) — đọc thẳng
 * `reference_catalog` qua `ReferenceCatalogRepository` (đã có sẵn), tự mở transaction riêng qua
 * `UnitOfWorkService` (cùng mẫu `DoctorDirectoryAdapter`) vì port chỉ nhận `tenantId`, không có
 * `tx` sẵn từ caller.
 */
@Injectable()
export class ReferenceCatalogReaderAdapter implements ReferenceCatalogReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
  ) {}

  async findActiveByCode(
    tenantId: string,
    category: string,
    code: string,
  ): Promise<{ code: string; name: string; deactivatesAccount: boolean } | null> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      // `category` đến từ cột text tự do trên `user_account` (không FK cứng, xem schema.prisma) —
      // ép kiểu Prisma enum ở biên đọc, không phải bỏ qua kiểm tra: giá trị sai (danh mục đã đổi
      // category hoặc gõ nhầm) chỉ khiến `findByCategoryAndCode` trả null, không throw.
      const row = await this.referenceCatalogRepository.findByCategoryAndCode(
        tx,
        category as never,
        code,
      );
      if (!row || !row.isActive) {
        return null;
      }
      return { code: row.code, name: row.name, deactivatesAccount: row.deactivatesAccount };
    });
  }
}
