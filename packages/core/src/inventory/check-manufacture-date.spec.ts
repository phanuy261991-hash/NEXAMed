import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkManufactureDate, MANUFACTURE_DATE_ISSUE_MESSAGES } from './check-manufacture-date';

interface Case {
  name: string;
  manufactureDate: string | null;
  expiryDate: string | null;
  today: string;
  expected: string | null;
}
// Bộ ca dùng chung với bản web (`apps/web/src/features/inventory/manufacture-date.spec.ts`).
const { cases } = JSON.parse(readFileSync(join(__dirname, '../../../shared/test-vectors/manufacture-date-rules.json'), 'utf8')) as { cases: Case[] };

describe('checkManufactureDate — bộ ca dùng chung với web', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(checkManufactureDate(c.manufactureDate, c.expiryDate, c.today)).toBe(c.expected);
  });

  it('có thông điệp tiếng Việt cho từng lý do', () => {
    expect(MANUFACTURE_DATE_ISSUE_MESSAGES.AFTER_TODAY).toContain('sau hôm nay');
    expect(MANUFACTURE_DATE_ISSUE_MESSAGES.NOT_BEFORE_EXPIRY).toContain('trước hạn dùng');
  });
});
