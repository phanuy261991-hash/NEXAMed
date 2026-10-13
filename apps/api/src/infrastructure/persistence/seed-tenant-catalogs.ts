import type { Prisma, PrismaClient } from '@prisma/client';
import { seedReferenceCatalogForTenant } from './seed-reference-catalog';
import { seedAllergenCatalogForTenant } from './seed-allergen-catalog';

/**
 * Bản MẶC ĐỊNH đầy đủ của mọi danh mục riêng theo tenant (docs/DECISIONS.md #230): `reference_catalog` + nhóm dị nguyên/dị nguyên.
 * Điểm vào DUY NHẤT để nạp danh mục cho một tenant mới (script tạo tenant pilot/dev, và về sau là luồng cấp tenant tự động của SaaS)
 * hoặc bổ sung cho tenant hiện có (`db:seed`). "Tạo nếu thiếu, không ghi đè" nên chạy lại an toàn.
 */
export async function seedTenantDefaultCatalogs(client: Prisma.TransactionClient | PrismaClient, tenantId: string, actorId: string): Promise<void> {
  await seedReferenceCatalogForTenant(client, tenantId, actorId);
  await seedAllergenCatalogForTenant(client, tenantId, actorId);
}
