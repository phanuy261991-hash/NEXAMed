import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // S1-07: dựng Postgres tạm bằng testcontainers + migrate deploy trước toàn bộ test —
    // xem src/testing/global-setup.ts.
    globalSetup: ['./src/testing/global-setup.ts'],
    // Khởi động container + migrate deploy có thể chậm hơn timeout mặc định (10s/5s), nhất là
    // lần đầu Docker cần pull image.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
  // S1-07: Vitest transform TypeScript bằng esbuild theo mặc định, mà esbuild KHÔNG emit
  // `design:paramtypes` (decorator metadata) — NestJS DI dựa vào metadata này để suy ra kiểu
  // tham số constructor khi không có @Inject() tường minh. Thiếu nó, `Test.createTestingModule`
  // âm thầm inject `undefined` thay vì lỗi rõ ràng (phát hiện lúc viết test HTTP e2e đầu tiên,
  // auth-login-http.spec.ts — các test trước giờ đều tự `new Service(...)` tay nên chưa từng
  // chạm DI thật của Nest). Dùng plugin SWC (đúng theo khuyến nghị chính thức của NestJS —
  // docs.nestjs.com/recipes/swc mục Vitest) để transform bằng `.swcrc` (decoratorMetadata: true)
  // thay cho esbuild. Chỉ ảnh hưởng lúc chạy test — build production vẫn dùng `tsc`/`nest build`
  // như cũ, vốn đã emit đúng metadata (xác nhận bằng smoke test `node dist/main.js` ở S1-06).
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
