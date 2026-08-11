import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Đo hiệu năng tìm kiếm bệnh nhân với 50.000 bản ghi (PAT-02, S2-02: "kết quả trả về dưới 1 giây
 * với 50.000 hồ sơ" — .claude/docs/data-model.md, docs/product/prd.md mục 5). Script thủ công,
 * KHÔNG chạy trong `pnpm test`/CI (seed 50k dòng tốn thời gian, không phù hợp vòng lặp test
 * nhanh) — chạy tay khi cần xác minh lại, giống `seed-dev-tenant.ts`.
 *
 * Dùng: pnpm --filter @nexamed/api run perf:patient-search
 */
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const ROW_COUNT = 50_000;
const NEEDLE_FULL_NAME = 'Đặng Thị Kim Cương Perf Test';
const NEEDLE_PHONE = '0909999999';

async function main() {
  const privileged = new PrismaClient({
    datasources: { db: { url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL } },
  });
  const appDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  try {
    await privileged.$connect();
    await appDb.$connect();

    const tenant = await privileged.tenant.create({
      data: { name: `Perf test ${randomUUID().slice(0, 8)}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    console.log(`Tenant tạm: ${tenant.id}`);

    console.log(`Đang chèn ${ROW_COUNT} bản ghi patient (bulk INSERT, không qua Prisma create() để nhanh)...`);
    const insertStart = Date.now();
    await privileged.$executeRawUnsafe(
      `
      INSERT INTO patient (
        id, tenant_id, patient_code, full_name, dob, gender, phone,
        created_at, updated_at, version, created_by, updated_by
      )
      SELECT
        uuidv7(),
        '${tenant.id}'::uuid,
        'PF' || lpad(seq::text, 8, '0'),
        (ARRAY['Nguyễn','Trần','Lê','Phạm','Hoàng','Huỳnh','Phan','Vũ','Võ','Đặng','Bùi','Đỗ','Hồ','Ngô','Dương'])[1 + floor(random()*15)::int]
          || ' ' ||
        (ARRAY['Văn','Thị','Hữu','Đức','Minh','Thành','Quang','Ngọc','Thu','Xuân'])[1 + floor(random()*10)::int]
          || ' ' ||
        (ARRAY['An','Bình','Cường','Dũng','Em','Giang','Hà','Hùng','Khánh','Lan','Mai','Nam','Oanh','Phúc','Quân','Sơn','Thảo','Uyên','Việt','Yến'])[1 + floor(random()*20)::int],
        (DATE '1950-01-01' + (floor(random()*25000))::int),
        (ARRAY['male','female','other'])[1 + floor(random()*3)::int],
        '09' || lpad((floor(random()*100000000))::text, 8, '0'),
        now(), now(), 1, '${SYSTEM_ACTOR}'::uuid, '${SYSTEM_ACTOR}'::uuid
      FROM generate_series(1, ${ROW_COUNT}) AS seq
      `,
    );
    console.log(`Chèn xong ${ROW_COUNT} dòng "noise" sau ${Date.now() - insertStart}ms.`);

    // Bulk INSERT vừa xong chưa được autovacuum/autoanalyze cập nhật thống kê kịp — planner sẽ
    // vẫn thấy pg_stats cũ (bảng gần như rỗng) và có thể bỏ qua GIN index dù nó hiệu quả hơn.
    // ANALYZE thủ công ở đây để mô phỏng đúng trạng thái "đã ổn định" của dữ liệu thật, không
    // phải trạng thái nhất thời ngay sau một lần bulk insert.
    await privileged.$executeRawUnsafe('ANALYZE patient');

    const needle = await privileged.patient.create({
      data: {
        tenantId: tenant.id,
        patientCode: 'PFNEEDLE01',
        fullName: NEEDLE_FULL_NAME,
        dob: new Date('1990-01-01'),
        gender: 'female',
        phone: NEEDLE_PHONE,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });
    console.log(`Đã chèn bản ghi "kim" cần tìm: ${needle.id} — "${NEEDLE_FULL_NAME}"`);

    // Đo qua đúng role app (DATABASE_URL) + SET LOCAL app.current_tenant_id, giống hệt
    // UnitOfWorkService.runInTenantScope() lúc chạy thật — không đo qua role đặc quyền
    // (MIGRATE_DATABASE_URL, bypass RLS) vì không phản ánh đúng chi phí RLS.
    const normalizedNeedle = 'kim cuong perf test'; // khớp packages/core/strip-vietnamese-diacritics
    const cases: { label: string; where: string }[] = [
      { label: 'tìm theo tên không dấu (trigram GIN)', where: `search_key LIKE '%${normalizedNeedle}%'` },
      { label: 'tìm theo số điện thoại (prefix, btree)', where: `phone LIKE '${NEEDLE_PHONE}%'` },
      { label: 'tìm theo mã bệnh nhân (prefix, unique btree)', where: `patient_code ILIKE 'pfneedle%'` },
    ];

    for (const testCase of cases) {
      const elapsed = await appDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenant.id}'`);
        const start = Date.now();
        const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM patient WHERE tenant_id = '${tenant.id}'::uuid AND deleted_at IS NULL AND (${testCase.where}) LIMIT 21`,
        );
        const ms = Date.now() - start;
        if (!rows.some((r) => r.id === needle.id)) {
          throw new Error(`Không tìm thấy bản ghi needle với case "${testCase.label}" — có lỗi logic tìm kiếm.`);
        }
        return ms;
      });
      const verdict = elapsed < 1000 ? 'ĐẠT (< 1s)' : 'KHÔNG ĐẠT (>= 1s)';
      console.log(`  ${testCase.label}: ${elapsed}ms — ${verdict}`);
    }

    const planRows = await appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenant.id}'`);
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (ANALYZE, COSTS OFF) SELECT id FROM patient WHERE tenant_id = '${tenant.id}'::uuid AND deleted_at IS NULL AND search_key LIKE '%${normalizedNeedle}%'`,
      );
    });
    console.log('\nEXPLAIN ANALYZE, kế hoạch mặc định của planner (tìm theo tên):');
    for (const row of planRows) {
      console.log(`  ${row['QUERY PLAN']}`);
    }
    const usesGinIndexByDefault = planRows.some((r) => r['QUERY PLAN'].includes('patient_tenant_id_search_key_trgm_idx'));

    // Ở quy mô 50k dòng của MỘT tenant, planner thường chọn Seq Scan thay vì GIN — bảng đủ nhỏ để
    // nằm gọn trong shared buffers nên quét tuần tự rẻ hơn tra index. Đây là quyết định ĐÚNG của
    // Postgres cho quy mô này, không phải lỗi. Ép `enable_seqscan=off` để xác nhận GIN index vẫn
    // tồn tại và DÙNG ĐƯỢC thật (không hỏng/không lỗi cú pháp) — planner sẽ tự chuyển sang dùng nó
    // khi dữ liệu đủ lớn (nhiều tenant cộng dồn, hoặc một tenant lâu năm) mà không cần đổi code.
    const forcedPlanRows = await appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenant.id}'`);
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = on');
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (ANALYZE, COSTS OFF) SELECT id FROM patient WHERE tenant_id = '${tenant.id}'::uuid AND deleted_at IS NULL AND search_key LIKE '%${normalizedNeedle}%'`,
      );
    });
    console.log('\nEXPLAIN ANALYZE, ép tắt Seq Scan (xác nhận GIN index tồn tại và dùng được):');
    for (const row of forcedPlanRows) {
      console.log(`  ${row['QUERY PLAN']}`);
    }
    const ginIndexUsable = forcedPlanRows.some((r) => r['QUERY PLAN'].includes('patient_tenant_id_search_key_trgm_idx'));

    console.log(`\nPlanner tự chọn GIN index ở quy mô 50k/tenant: ${usesGinIndexByDefault ? 'CÓ' : 'KHÔNG (seq scan rẻ hơn — đúng, không phải lỗi)'}`);
    console.log(`GIN trigram index tồn tại và dùng được (ép chọn): ${ginIndexUsable ? 'CÓ' : 'KHÔNG — lỗi thật, cần xem lại!'}`);
    if (!ginIndexUsable) {
      throw new Error('GIN trigram index không được planner chọn dù đã ép enable_seqscan=off — index có thể bị hỏng hoặc điều kiện WHERE không khớp opclass.');
    }
  } finally {
    console.log('\nDọn dữ liệu perf test...');
    const tenants = await privileged.tenant.findMany({ where: { name: { startsWith: 'Perf test ' } } });
    const tenantIds = tenants.map((t) => t.id);
    if (tenantIds.length > 0) {
      await privileged.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await privileged.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await privileged.$disconnect();
    await appDb.$disconnect();
    console.log('Xong.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
