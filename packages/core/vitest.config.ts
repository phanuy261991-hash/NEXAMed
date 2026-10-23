import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4 không còn loại `dist` khỏi danh sách mặc định; `tsc` biên dịch cả `*.spec.ts` ra `dist/*.spec.js`
    // (CommonJS) nên nếu không loại ra thì bị chạy lại và lỗi "Vitest cannot be imported in a CommonJS module".
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
