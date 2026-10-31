import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { updateDrugRequestSchema } from '@nexamed/shared';

/**
 * Luật chuỗi quy đổi đơn vị có HAI bản cài đặt phải khớp nhau (docs/DECISIONS.md #275): Zod ở `packages/shared/src/drug.ts` (máy chủ chặn) và
 * `validateUnitChain` ở web (`drug-unit-chain.ts`, form báo trước). Cả hai spec đọc cùng bộ ca — sửa luật ở một bên mà quên bên kia thì một spec đỏ.
 * (Spec này đặt ở API vì `packages/shared` không có kiểu Node để đọc tệp JSON.)
 */
interface UnitChainVector {
  name: string;
  baseUnitCode: string;
  units: { unitCode: string; factorToUnitBelow: number }[];
  messages: string[];
}

const { cases } = JSON.parse(readFileSync(join(__dirname, '../../../../../packages/shared/test-vectors/unit-chain-validation.json'), 'utf8')) as { cases: UnitChainVector[] };

describe('schema thuốc (máy chủ) — bộ ca chuỗi đơn vị dùng chung với web', () => {
  it('đọc được bộ ca', () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
  });

  it.each(cases)('$name', ({ baseUnitCode, units, messages }) => {
    const result = updateDrugRequestSchema.safeParse({
      version: 1,
      units: units.map((u, i) => ({ ...u, sortOrder: i })),
      ...(baseUnitCode ? { baseUnitCode } : {}),
    });
    const actual = result.success ? [] : result.error.issues.map((i) => i.message);
    expect([...new Set(actual)].sort()).toEqual([...messages].sort());
  });
});
