import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkManufactureDate } from './manufacture-date';

interface Case {
  name: string;
  manufactureDate: string | null;
  expiryDate: string | null;
  today: string;
  expected: string | null;
}
// Bộ ca DÙNG CHUNG với máy chủ (`packages/core/src/inventory/check-manufacture-date.spec.ts`): hai bản cài đặt luật phải giống hệt.
const { cases } = JSON.parse(readFileSync(new URL('../../../../../packages/shared/test-vectors/manufacture-date-rules.json', import.meta.url), 'utf8')) as { cases: Case[] };

describe('checkManufactureDate (web) — bộ ca dùng chung với core', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(checkManufactureDate(c.manufactureDate, c.expiryDate, c.today)).toBe(c.expected);
  });
});
