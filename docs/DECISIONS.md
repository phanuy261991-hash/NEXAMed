# Decisions — NEXAMed

Quyết định kiến trúc/nghiệp vụ đã chốt, ngoài những gì đã nằm sẵn trong `CLAUDE.md` và `.claude/docs/`. Không sửa lại quyết định cũ trong file này — nếu quyết định đổi, thêm mục mới ghi rõ "thay thế mục #N".

## 001 — Phân vai `docs/` và `.claude/docs/`

**Ngày**: 2026-08-07
**Quyết định**: `docs/` chứa tài liệu cho người (product, design, trạng thái dự án...); `.claude/docs/` chứa tài liệu kỹ thuật đã chốt cho agent (schema, state machine, contract...). CLAUDE.md chỉ tham chiếu `.claude/docs/`.
**Vì sao**: Tránh agent đọc nhầm tài liệu chưa chốt làm nguồn "đã chốt".

## 002 — Vị trí PRD và plan

**Ngày**: 2026-08-07
**Quyết định**: PRD và plan triển khai đặt tại `docs/product/prd.md` và `docs/product/plan.md`.
**Vì sao**: Vòng đời theo sprint/release, khác nhịp với tài liệu kỹ thuật lâu dài.

## 003 — Vị trí design system

**Ngày**: 2026-08-07
**Quyết định**: Design system ở v1 là tài liệu (không phải code triển khai), đặt tại `docs/design/design-system.md`.
**Vì sao**: Chưa cần token/theme chạy được trong code; khi cần sẽ bổ sung code triển khai riêng ở `packages/shared` hoặc `apps/web/src/shared`.

## 004 — `packages/core` và `packages/shared` build ra CommonJS, không phải ESM

**Ngày**: 2026-08-07
**Quyết định**: Cả hai package build bằng `tsc` ra `dist/` dạng CommonJS (`module: "CommonJS"`), export qua `main`/`types` trỏ vào `dist/index.js`/`dist/index.d.ts`. Không dùng ESM hay trỏ `main` thẳng vào file `.ts`.
**Vì sao**: `apps/api` (NestJS, `nest build`) chỉ biên dịch code của chính nó, không transpile ngược các package workspace phụ thuộc. Nếu `packages/core`/`packages/shared` là ESM hoặc trỏ `main` vào `.ts`, `node dist/main.js` của `apps/api` sẽ crash khi `require()` các package này ở runtime (`ERR_REQUIRE_ESM` hoặc không đọc được `.ts`). Dùng chung CommonJS với `apps/api` để interop an toàn; `apps/web` (Vite) vẫn tiêu thụ được CommonJS bình thường.
**Ảnh hưởng**: Mọi package mới trong `packages/` phải build ra `dist/` trước khi được `apps/*` import ở runtime — không import thẳng `src/*.ts` từ ngoài package.