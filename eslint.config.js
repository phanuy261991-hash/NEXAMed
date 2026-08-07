// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

const CORE_RESTRICTED_MESSAGE =
  'packages/core là logic nghiệp vụ thuần — không phụ thuộc framework/hạ tầng (xem .claude/docs/project-structure.md).';

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
  eslintConfigPrettier,
);