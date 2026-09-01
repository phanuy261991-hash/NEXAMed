# Ảnh Docker cho apps/api (NestJS) — dùng chung cho service `api` (chạy dài hạn) VÀ service
# `migrate` (chạy một lần lúc khởi tạo: `prisma migrate deploy` + seed) trong
# deploy/on-prem/docker-compose.yml — cả hai chỉ khác `command:`, không tách 2 ảnh.
#
# CỐ Ý không dùng `pnpm deploy --prod` (thử thật lúc viết ảnh này, xem docs/Deploy.md): lệnh đó
# không mang theo `node_modules/.prisma/client` (Prisma Client generate SAU khi cài đặt, ngoài
# phạm vi lockfile mà `pnpm deploy` dựng lại) — thiếu nó thì API crash lúc kết nối DB. Ảnh này
# đơn giản hơn: cài đủ devDependencies + build, không tách stage runtime rút gọn. Đổi lại: ảnh
# nặng hơn vài trăm MB (typescript/vitest/prisma CLI...) — chấp nhận được cho một bản cài một máy
# tại phòng khám, ưu tiên đúng/dễ bảo trì hơn tối ưu dung lượng ở giai đoạn pilot.
FROM node:20-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# `argon2` (S1-04) không có prebuilt binary cho mọi tổ hợp glibc/Node — cần biên dịch native từ
# nguồn (node-gyp: python3/make/g++). `openssl` — Prisma engine cần dò đúng phiên bản libssl lúc
# `prisma generate`/runtime (thiếu thì tự chọn nhầm openssl-1.1.x, cảnh báo lúc build).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl \
  && rm -rf /var/lib/apt/lists/*

# Cài dependency toàn workspace trước, tách riêng khỏi COPY source — tận dụng cache layer Docker:
# sửa code không làm mất cache `pnpm install` (chỉ mất khi đổi package.json/lockfile).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/shared/package.json packages/shared/package.json
# --filter "@nexamed/api..." — chỉ cài apps/api + dependency của nó (packages/core, packages/
# shared), KHÔNG cài devDependencies riêng của apps/web (vite/rollup/esbuild/tailwindcss...) dù
# tất cả package.json ở trên phải có mặt để khớp pnpm-lock.yaml (khoá 1 lockfile toàn workspace).
RUN pnpm install --frozen-lockfile --filter "@nexamed/api..."

# Chỉ copy source apps/api cần — KHÔNG copy apps/web/src (ảnh này không dùng tới, tránh phình to
# vô ích và tránh phải rebuild lại khi chỉ web đổi).
COPY apps/api apps/api
COPY packages/core packages/core
COPY packages/shared packages/shared

RUN pnpm --filter @nexamed/api run db:generate
RUN pnpm --filter "@nexamed/api..." run build

WORKDIR /repo/apps/api
ENV NODE_ENV=production

EXPOSE 3000

# Không cài thêm curl (ảnh slim) — dùng thẳng Node có sẵn để gọi GET /health (S4-05).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]