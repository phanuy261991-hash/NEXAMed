import type { PrismaClient } from '@prisma/client';
import { PROVINCE_ITEMS, WARD_ITEMS } from '@nexamed/core';

/**
 * Seed danh mục `province`/`ward` toàn hệ thống (docs/DECISIONS.md #038) — read-only lúc chạy.
 * `province` (34 dòng, rẻ) dùng upsert để tên sửa lại trong `data.ts` (ví dụ đổi viết tắt "Tp" →
 * "Thành phố") đồng bộ được khi seed lại, không kẹt ở giá trị cũ đã insert trước đó. `ward`
 * (~3321 dòng) vẫn dùng `createMany({ skipDuplicates: true })` — bulk, không cần cập nhật tại chỗ
 * vì tên phường/xã hiếm khi cần sửa sau khi soạn seed.
 */
export async function seedGeo(prisma: PrismaClient): Promise<void> {
  for (const item of PROVINCE_ITEMS) {
    await prisma.province.upsert({
      where: { code: item.code },
      create: { code: item.code, name: item.name, sortOrder: item.sortOrder },
      update: { name: item.name, sortOrder: item.sortOrder },
    });
  }

  await prisma.ward.createMany({
    data: WARD_ITEMS.map((item) => ({
      code: item.code,
      name: item.name,
      provinceCode: item.provinceCode,
      sortOrder: item.sortOrder,
    })),
    skipDuplicates: true,
  });
}
