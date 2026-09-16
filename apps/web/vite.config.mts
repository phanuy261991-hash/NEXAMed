import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Chunk khởi động (`.claude/docs/coding-standards.md` mục Hiệu suất, cap 500 kB/chunk) đã
        // vượt trần chỉ vì thư viện thứ ba DÙNG CHUNG TOÀN APP (react/react-dom/react-router/
        // @tanstack/react-query/zod/@phosphor-icons/zustand/openapi-fetch — vốn đã nằm trong chunk
        // khởi động từ trước, không phải do route/trang lazy nào) ngày càng lớn theo số route/icon
        // mới — tách riêng thành chunk `vendor` để mỗi chunk nằm dưới trần, KHÔNG giảm tổng byte
        // tải lúc khởi động (browser tải cả 2 song song).
        //
        // CHỈ liệt kê đúng nhóm lib này bằng regex tên package — thử `id.includes('node_modules')
        // → 'vendor'` (gộp MỌI thư viện bất kể trang nào dùng) trước đó làm chunk `vendor` phình
        // tới 656.98 kB: kéo theo cả lib chỉ 1-2 trang lazy dùng (`@tanstack/react-virtual`,
        // `country-flag-icons`...) vào chung 1 chunk EAGER, biến chúng từ "chỉ tải khi vào đúng
        // trang" thành "luôn tải ngay lúc khởi động" — sai tinh thần code-splitting theo route đã
        // chốt. Các lib còn lại (không khớp regex) vẫn để Rollup tự chia theo lazy chunk như cũ.
        manualChunks(id) {
          if (/node_modules\/\.pnpm\/(react@|react-dom@|scheduler@|react-router[@-]|@tanstack\+react-query|@tanstack\+query-core|zod@|zustand@|openapi-fetch@)/.test(id)) {
            return 'vendor';
          }
        },
      },
    },
  },
});