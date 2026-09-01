# Ảnh Docker cho apps/web (React SPA) — build tĩnh, phục vụ qua nginx (S4-05).
# `config.json` KHÔNG bake giá trị thật vào ảnh — nginx sẽ mount đè bằng
# deploy/on-prem/config.json (tạo lúc cài đặt, sửa được tại chỗ không cần build lại, xem
# docs/DECISIONS.md #020). Ảnh chỉ chứa `config.example.json` làm placeholder phòng khi quên mount.

# ---- Stage 1: build static assets ----
FROM node:20-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/core/package.json packages/core/package.json
# --filter "@nexamed/web..." — chỉ cài apps/web + dependency (packages/shared), KHÔNG cài
# devDependencies riêng của apps/api (nestjs/prisma CLI/vitest...).
RUN pnpm install --frozen-lockfile --filter "@nexamed/web..."

# KHÔNG copy apps/api/src, packages/core/src — image này không build/dùng tới (apps/web chỉ phụ
# thuộc @nexamed/shared, cấm import @nexamed/core theo ESLint boundary rule — docs/DECISIONS.md
# #073). Copy package.json của chúng ở trên chỉ để `pnpm install` khớp lockfile toàn workspace.
COPY apps/web apps/web
COPY packages/shared packages/shared

RUN pnpm --filter "@nexamed/web..." run build

# ---- Stage 2: nginx phục vụ static + reverse proxy /api ----
FROM nginx:1.27-alpine
COPY deploy/on-prem/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/public/config.example.json /usr/share/nginx/html/config.json

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O- http://127.0.0.1/ >/dev/null || exit 1