// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

const CORE_RESTRICTED_MESSAGE =
  'packages/core là logic nghiệp vụ thuần — không phụ thuộc framework/hạ tầng (xem .claude/docs/project-structure.md).';

/**
 * `apps/web` chỉ được phụ thuộc `@nexamed/shared` (type + Zod schema, ~123 kB), KHÔNG phụ thuộc
 * `@nexamed/core`. Lý do là HIỆU SUẤT, không phải kiến trúc: `packages/core` chứa dữ liệu seed
 * lớn (`icd10/data.ts` ~9.1 MB, `geo/data.ts` ~280 kB) phục vụ riêng tầng API — kéo vào web là
 * kéo theo rủi ro phình bundle của trình duyệt. Trước đây ranh giới này chỉ được giữ bằng quy
 * ước ngầm (`apps/web/package.json` không khai dependency) + comment, không có gì cưỡng chế.
 * Cần một hàm thuần đang nằm ở `core`? Chuyển hàm đó sang `packages/shared` (nếu thật sự dùng
 * chung cả hai phía) thay vì mở dependency này.
 */
const WEB_RESTRICTED_MESSAGE =
  'apps/web không được import @nexamed/core (kéo theo dữ liệu seed lớn vào bundle trình duyệt) — dùng @nexamed/shared, hoặc chuyển hàm thuần cần dùng chung sang packages/shared. Xem .claude/docs/coding-standards.md mục Hiệu suất.';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: CORE_RESTRICTED_MESSAGE },
            { group: ['@prisma/*'], message: CORE_RESTRICTED_MESSAGE },
            { group: ['react', 'react-dom', 'react/*', 'react-dom/*'], message: CORE_RESTRICTED_MESSAGE },
            { group: ['axios', 'node-fetch', 'got'], message: CORE_RESTRICTED_MESSAGE },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'packages/core không được đọc process.env trực tiếp — nhận cấu hình qua tham số.' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['@nexamed/core', '@nexamed/core/*'], message: WEB_RESTRICTED_MESSAGE }],
        },
      ],
      // Chỉ bật 2 rule cổ điển (đúng thứ mã nguồn đang có `eslint-disable-next-line` tham chiếu tới
      // — trước đây báo lỗi "Definition for rule ... was not found" vì plugin chưa từng cài/đăng
      // ký, 2026-08-26). KHÔNG bật cả bộ `recommended`/`recommended-latest` của plugin (v7 gộp
      // thêm nhiều rule hướng React Compiler — immutability/purity/set-state-in-render...) — chưa
      // rà soát tác động, ngoài phạm vi việc này.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  eslintConfigPrettier,
);