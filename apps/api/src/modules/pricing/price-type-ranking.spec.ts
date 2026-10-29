import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rankPriceTypeCodes } from './priceable-catalog.service';

/**
 * Luật xếp thứ tự Loại giá có HAI bản cài đặt phải khớp nhau (docs/DECISIONS.md #268): bản này (máy chủ, dùng để TÍNH TIỀN) và bản web
 * (`technical-service-price-model.ts`, dùng để HIỂN THỊ mức trong form). Cả hai spec đọc cùng bộ ca — sửa luật ở một bên mà quên bên kia thì một spec đỏ.
 */
interface RankingCase {
  name: string;
  catalog: string[];
  defaultCode: string;
  expected: string[];
}

const { cases } = JSON.parse(readFileSync(join(__dirname, '../../../../../packages/shared/test-vectors/price-type-ranking.json'), 'utf8')) as { cases: RankingCase[] };

describe('rankPriceTypeCodes (máy chủ) — bộ ca dùng chung với web', () => {
  it('đọc được bộ ca', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
  });

  it.each(cases)('$name', ({ catalog, defaultCode, expected }) => {
    expect(rankPriceTypeCodes(catalog, defaultCode)).toEqual(expected);
  });

  it('không sửa mảng đầu vào', () => {
    const catalog = ['THUONG', 'VIP'];
    rankPriceTypeCodes(catalog, 'VIP');
    expect(catalog).toEqual(['THUONG', 'VIP']);
  });
});
