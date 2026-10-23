# Ảnh Docker của trình cài đặt/nâng cấp NEXAMed (docs/DECISIONS.md #238). Chạy TRÊN MÁY KHÁCH lúc cài/nâng cấp, điều khiển Docker của máy qua docker.sock rồi tắt.
# Dựng từ gốc repo: docker build -f apps/setup/Dockerfile -t nexamed-setup:<phiên bản> .   (build-and-export.ps1 làm việc này cùng 3 ảnh còn lại)

# ---- Stage 1: biên dịch + gom dependency chạy thật ----
FROM node:26-alpine AS build
# Node 25+ không còn kèm corepack trong ảnh chính thức nên cài pnpm bằng npm — ghim ĐÚNG phiên bản của `packageManager` (docs/DECISIONS.md #253).
RUN npm install -g pnpm@9.15.9
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/setup/package.json apps/setup/package.json
# Các thành viên workspace khác: pnpm cần package.json của chúng để khớp pnpm-lock.yaml (không cài dependency của chúng vì --filter chỉ chọn gói này).
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter "@nexamed/setup..."

COPY apps/setup apps/setup
RUN pnpm --filter @nexamed/setup run build
# `pnpm deploy` dựng thư mục độc lập chỉ có dependency chạy thật (không có liên kết tượng trưng ra ngoài).
RUN pnpm --filter @nexamed/setup deploy --prod /out

# ---- Stage 2: chạy ----
FROM node:26-alpine
# docker-cli + docker-cli-compose: trình cài đặt điều khiển Docker của máy qua docker.sock.
RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/setup/dist ./dist
COPY --from=build /repo/apps/setup/package.json ./package.json
ENV NODE_ENV=production
EXPOSE 8090
CMD ["node", "dist/main.js"]
