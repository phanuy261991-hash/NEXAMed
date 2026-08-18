/**
 * Trùng logic với `computeBmi` ở `packages/core/src/vital-sign/bmi.ts` — cố ý KHÔNG import từ
 * `@nexamed/core` (apps/web hiện chỉ phụ thuộc `@nexamed/shared`, không phải `@nexamed/core` —
 * thêm dependency mới cho một hàm thuần rất nhỏ không đáng, cùng lý do `calculateAgeYears` đã
 * trùng lặp ở `features/patient/patient-form.utils.ts`: `packages/**` build CommonJS, barrel
 * `index.ts` dùng `export *` (`__exportStar`) mà Rollup/`vite build` không dò tĩnh được, dù Node
 * `require()` thấy đúng — xem docs/DECISIONS.md #032).
 */
export function computeBmi(weightGram: number | undefined, heightMm: number | undefined): number | null {
  if (!weightGram || !heightMm || weightGram <= 0 || heightMm <= 0) return null;
  const weightKg = weightGram / 1000;
  const heightM = heightMm / 1000;
  return weightKg / (heightM * heightM);
}