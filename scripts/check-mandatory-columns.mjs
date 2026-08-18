#!/usr/bin/env node
// Kiểm tra mọi model trong apps/api/prisma/schema.prisma có đủ 8 cột bắt buộc
// theo .claude/docs/data-model.md, trừ các ngoại lệ đã liệt kê rõ lý do bên dưới.
// Dùng trong CI (xem .github/workflows/ci.yml) — gate cuối Sprint 1 trong docs/product/plan.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/api/prisma/schema.prisma',
);

const REQUIRED_COLUMNS = ['tenant_id', 'created_at', 'updated_at', 'deleted_at', 'version', 'created_by', 'updated_by'];

// model -> cột được miễn trừ, phải khớp với ngoại lệ đã ghi trong .claude/docs/data-model.md
// AuditLog: dùng occurred_at + actor_id thay cho created_at/created_by (xem docs/DECISIONS.md #005 —
// ERD.md liệt kê chi tiết cột của audit_log không có created_at/created_by/updated_by, dù câu tóm tắt
// trong data-model.md chỉ nhắc updated_at/deleted_at/version).
const APPEND_ONLY_EXEMPT = ['created_at', 'updated_at', 'deleted_at', 'version', 'created_by', 'updated_by'];

const EXEMPTIONS = {
  Tenant: ['tenant_id'], // là gốc của tenant, không tự tham chiếu chính mình
  AuditLog: APPEND_ONLY_EXEMPT,
  BreakGlassSession: APPEND_ONLY_EXEMPT, // append-only như audit_log, xem security-audit.md
  Permission: [...APPEND_ONLY_EXEMPT, 'tenant_id'], // danh mục toàn hệ thống, giống icd10_catalog
  // Danh mục toàn hệ thống, quản lý qua API (docs/DECISIONS.md #037) — có `id` riêng, thiếu
  // exemption này từ lúc thêm bảng (phát hiện lại lúc thêm Province/Ward, không phải bug mới).
  ReferenceCatalog: [...APPEND_ONLY_EXEMPT, 'tenant_id'],
  // Danh mục hành chính Tỉnh/Phường-Xã toàn hệ thống, read-only (docs/DECISIONS.md #038) — PK là
  // `code` (giống icd10_catalog), không có cột `id` riêng.
  Province: [...APPEND_ONLY_EXEMPT, 'tenant_id', 'id'],
  Ward: [...APPEND_ONLY_EXEMPT, 'tenant_id', 'id'],
  // Danh mục ICD-10 toàn hệ thống, read-only (S3-01) — cùng bản chất Province/Ward, PK là `code`.
  Icd10Catalog: [...APPEND_ONLY_EXEMPT, 'tenant_id', 'id'],
};

const schema = readFileSync(SCHEMA_PATH, 'utf8');
const modelRegex = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;

let hasError = false;
let match;
while ((match = modelRegex.exec(schema)) !== null) {
  const [, modelName, body] = match;
  const exempt = EXEMPTIONS[modelName] ?? [];

  const missing = REQUIRED_COLUMNS.filter((col) => {
    if (exempt.includes(col)) return false;
    // Cột có @map("col") tường minh, hoặc field trùng tên cột (không cần @map, ví dụ "version").
    const hasMap = new RegExp(`@map\\("${col}"\\)`).test(body);
    const hasBareField = new RegExp(`^\\s*${col}\\s+\\S`, 'm').test(body);
    return !hasMap && !hasBareField;
  });

  const hasId = /^\s*id\s+\S+.*@id/m.test(body);
  if (!hasId && !exempt.includes('id')) missing.unshift('id');

  if (missing.length > 0) {
    hasError = true;
    console.error(`✖ model ${modelName} thiếu cột bắt buộc: ${missing.join(', ')}`);
  }
}

if (hasError) {
  console.error(
    '\nMọi bảng nghiệp vụ phải có đủ 8 cột bắt buộc (xem .claude/docs/data-model.md).' +
      '\nNếu bảng thật sự cần miễn trừ, thêm vào EXEMPTIONS trong scripts/check-mandatory-columns.mjs kèm lý do.',
  );
  process.exit(1);
}

console.log('✓ Mọi model trong schema.prisma đều có đủ cột bắt buộc.');
