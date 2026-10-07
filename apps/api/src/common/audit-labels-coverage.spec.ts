import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { labelForAuditAction, labelForEntityType } from '@nexamed/shared';

/**
 * Chặn lỗ hổng "ghi audit nhưng quên nhãn tiếng Việt" (rà soát log 2026-10-07): màn Nhật ký hiện nguyên văn
 * `stock_receipt.approved` thay vì "Duyệt phiếu nhập kho" nếu action/entityType chưa có trong
 * `packages/shared/src/audit/*-labels.ts`. Quét mã nguồn API — module mới ghi audit mà quên nhãn thì test này đỏ.
 *
 * Quy ước module mới (xem .claude/docs/security-audit.md): ghi → `writeAuditLog(tx, ...)` cùng transaction; GET chi tiết dữ liệu
 * lâm sàng/chứng từ → `@AuditView` + `AuditViewInterceptor`; mọi action/entityType có nhãn; KHÔNG đưa PII/PHI vào before/afterJson.
 */
const SRC = join(__dirname, '..');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.spec.')) out.push(full);
  }
  return out;
}

function collect() {
  const actions = new Set<string>();
  const entityTypes = new Set<string>();
  for (const file of listSourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    // Mỗi lời gọi writeAuditLog(...) — lấy action + entityType trong cùng khối (tới `});` đầu tiên).
    for (const block of source.matchAll(/writeAuditLog\([^]*?\}\)/g)) {
      const action = /action(?:\s*:\s*|,\s*)'([a-z_]+\.[a-z_.]+)'/.exec(block[0]);
      const entityType = /entityType\s*:\s*'([a-z_]+)'/.exec(block[0]);
      if (action?.[1]) actions.add(action[1]);
      if (entityType?.[1]) entityTypes.add(entityType[1]);
    }
    for (const view of source.matchAll(/@AuditView\('([a-z_]+)'/g)) {
      if (view[1]) {
        actions.add(`${view[1]}.viewed`);
        entityTypes.add(view[1]);
      }
    }
  }
  return { actions: [...actions].sort(), entityTypes: [...entityTypes].sort() };
}

describe('Nhãn tiếng Việt cho audit_log', () => {
  const { actions, entityTypes } = collect();

  it('quét được action/entityType (không phải test rỗng)', () => {
    expect(actions.length).toBeGreaterThan(50);
    expect(entityTypes.length).toBeGreaterThan(20);
  });

  it('mọi action ghi trong code đều có nhãn', () => {
    expect(actions.filter((a) => labelForAuditAction(a) === a)).toEqual([]);
  });

  it('mọi entityType ghi trong code đều có nhãn', () => {
    expect(entityTypes.filter((t) => labelForEntityType(t) === t)).toEqual([]);
  });
});
