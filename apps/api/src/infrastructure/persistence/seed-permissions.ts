import type { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@nexamed/core';

/** Seed danh mục permission toàn hệ thống (idempotent — upsert theo (module, action)). */
export async function seedPermissionCatalog(prisma: PrismaClient): Promise<void> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      create: p,
      update: { description: p.description },
    });
  }
}