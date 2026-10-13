import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Kiểm tra TOÀN BỘ lược đồ (không chỉ vài bảng) cho cô lập tenant — chạy trên cơ sở dữ liệu thật đã áp mọi migration
 * (testcontainers, `src/testing/global-setup.ts`), chỉ ĐỌC danh mục hệ thống:
 *  1. Mọi bảng có cột `tenant_id` phải bật Row Level Security và có ít nhất 1 policy ràng buộc theo `app.current_tenant_id`.
 *  2. Bảng KHÔNG có `tenant_id` phải nằm trong danh sách "danh mục dùng chung" bên dưới — thêm bảng mới không có `tenant_id`
 *     làm test này đỏ, buộc phải xem lại có thật sự là dữ liệu dùng chung giữa các phòng khám hay là quên `tenant_id`.
 *  3. Role ứng dụng (`nexamed_app`) không được là superuser và không được BYPASSRLS.
 * (`.claude/docs/multi-tenancy.md` — kiểm chứng toàn lược đồ, bổ sung cho test cô lập theo từng endpoint.)
 */
// Danh mục dùng chung CÓ CHỦ ĐÍCH (docs/DECISIONS.md #037/#038/#113 và `.claude/docs/data-model.md`). `reference_catalog` dùng
// chung giữa MỌI tenant nhưng do clinic_admin của từng phòng khám sửa được — rủi ro đã báo ở rà soát 13/10/2026, chờ quyết định.
const SHARED_TABLES = [
  'allergen',
  'allergen_group',
  'global_code_sequence',
  'icd10_catalog',
  'permission',
  'province',
  'reference_catalog',
  'tenant',
  'ward',
];

describe('Cô lập tenant — kiểm tra toàn lược đồ', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('mọi bảng có tenant_id đều bật RLS và có policy ràng buộc theo app.current_tenant_id', async () => {
    const tables = await prisma.$queryRawUnsafe<{ tbl: string; rls: boolean; policies: bigint; scoped: bigint }[]>(`
      SELECT c.relname AS tbl, c.relrowsecurity AS rls,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND pg_get_expr(p.polqual, p.polrelid) LIKE '%current_tenant_id%') AS scoped
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id')
      ORDER BY c.relname`);
    expect(tables.length).toBeGreaterThan(50);
    expect(tables.filter((t) => !t.rls).map((t) => t.tbl)).toEqual([]);
    expect(tables.filter((t) => Number(t.scoped) === 0).map((t) => t.tbl)).toEqual([]);
  });

  it('bảng không có tenant_id chỉ gồm danh mục dùng chung đã được duyệt', async () => {
    const tables = await prisma.$queryRawUnsafe<{ tbl: string }[]>(`
      SELECT c.relname AS tbl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT LIKE '\\_prisma%' ESCAPE '\\'
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id')
      ORDER BY c.relname`);
    expect(tables.map((t) => t.tbl)).toEqual(SHARED_TABLES);
  });

  it('role ứng dụng không phải superuser và không bypass RLS', async () => {
    const roles = await prisma.$queryRawUnsafe<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'nexamed_app'`,
    );
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });
});
