# Handoff — Khoá lạc quan (6 form + danh mục dùng chung + ma trận quyền), kiểm tra toàn diện phân quyền, gợi ý "quyền đi kèm" — TOÀN BỘ ĐÃ XONG, ĐÃ VERIFY

**Ngày ghi**: 01/10/2026, nối tiếp handoff `HANDOFF-GoiYICD-TuDienVietTat-XungDotNhieuMay-2026-10-01.md`. Chi tiết quyết định: `docs/DECISIONS.md` #207, #208. Không còn việc dở dang.

## Việc đã làm (theo thứ tự)

1. **Áp mẫu xử lý xung đột nhiều máy** (`useSaveAttempt` + `RecordFormNotice` + `useEditedRecordGuard`) cho 9 form: Tầng, Phòng, Loại Khoa/Phòng, Khoa/Phòng, Quỹ, Ca làm việc, Đổi tên/Ẩn vai trò, Đơn thuốc mẫu, Bàn khám/Ghế. Danh sách nhỏ nên KHÔNG thêm `GET :id` — dùng `shared/api/fetch-one-from-list.ts`.
2. **Khoá lạc quan `reference_catalog`**: migration `20261001120000_reference_catalog_version` (cột `version`); PATCH body + DELETE/reactivate query `?version=` BẮT BUỘC, lệch → 409. PATCH chỉ-đơn-giá vẫn tăng version.
3. **Khoá lạc quan ma trận quyền**: `PUT /roles/:id/permissions` BẮT BUỘC `version` của vai trò, mỗi lần lưu tăng `role.version` (nên đổi tên/ẩn bằng version cũ cũng 409). Web: gặp 409 thì bỏ thay đổi chờ + tải lại ma trận.
4. **Test quét toàn bộ phân quyền** `apps/api/src/common/permission-matrix-enforcement-http.spec.ts` (quét mọi controller qua `ModulesContainer`): không token → 401; ma trận toàn "none" → 403 mọi route; cấp đúng 1 quyền → chỉ mở route đó; thu hồi → chặn ngay; endpoint mới quên `@RequirePermission` → fail (route đăng-nhập-là-đủ phải nằm trong `LOGIN_ONLY_ROUTES`).
5. **3 lỗi thật sửa**: (a) cấp LẠI quyền đã thu hồi → 500 (unique không partial; `replaceMatrix` nay hồi sinh dòng soft-delete); (b) 5 mục menu lệch route guard ở vai trò tuỳ biến (`Sidebar.tsx`); (c) TopBar gọi `/appointments/schedule-config` ở mọi trang → 403 vô ích.
6. **Gợi ý "quyền đi kèm"** ở "Vai trò & Phân quyền": `PERMISSION_COMPANIONS` (`packages/core`, 19 quyền, dữ liệu từ quét Chrome thật) → API ma trận trả `companions` → web `companion-hints.ts` + `CompanionHint.tsx` (cảnh báo + "Cấp kèm", chỉ gợi ý). Kèm sửa lỗi lễ tân/thu ngân luôn bị 403 ở `GET /clinic-settings` nên tuỳ chọn "Trả hỗn hợp ví" luôn tắt — nay dùng chiếu tự-phục vụ `GET /clinic-settings/wallet-mixed-payment-enabled`.

## Đã xác minh thật

- `pnpm -w typecheck` sạch, lint 0 lỗi (8 warning có sẵn), build web sạch. `packages/core` 280, `packages/shared` 31, `apps/web` 8 pass. `apps/api` 1129/1130: 1 test hoàn tiền ĐỒNG THỜI (`invoice-refund-http.spec.ts`) fail trong toàn suite nhưng pass 16/16 chạy riêng 3 lần (flake đã biết).
- Kiểm đột biến: bỏ `PermissionGuard` khỏi 1 controller → test quét fail đúng; bỏ `version` khỏi WHERE repository → test khoá lạc quan fail đúng.
- Chrome thật (tenant test cố định, 2 phiên): xung đột ở Tầng/Ca làm việc/Quỹ/Khoa-Phòng/Vai trò/Danh mục dùng chung/lưu ma trận; tài khoản thật theo vai trò tuỳ biến (80/80 ô quyền, 35/35 route guard, menu + API khớp, thu hồi có hiệu lực ngay, cấp lại không còn 500); quét 80 quyền → không còn mục menu dẫn vào trang bị chặn; khung "quyền đi kèm" (hiện/Cấp kèm/lưu/bỏ lại/vai trò mặc định).
- Đơn thuốc mẫu và Bàn khám/Ghế: **đã chạy Chrome thật 2 phiên (01/10/2026, phiên sau)** — Đơn thuốc mẫu: tự phát hiện bản mới + khoá Lưu + tải lại + báo xung đột trong form + Ẩn nhanh báo xung đột; Bàn khám/Ghế: báo xung đột trong dialog + danh sách tự tải lại + lưu lại được trên bản mới. Không phát hiện bug.

## Điều cần biết / việc kế tiếp (không bắt buộc)

- **5 vai trò mặc định còn vài khoảng trống quyền đọc phụ** (`KNOWN_DEFAULT_ROLE_GAPS` trong `packages/core/src/rbac/permission-companions.spec.ts`, có ghi lý do): lễ tân/điều dưỡng/bác sĩ thiếu `user_account.read` (Lịch làm việc nhân viên); lễ tân thiếu `user_account.read` (lọc Thu ngân) và `stock_receipt.read` (phiếu xuất thủ công); điều dưỡng/bác sĩ thiếu `cash_account.read` (khối thanh toán phiếu nhập kho). Cố ý chưa cấp (lộ dữ liệu nhân sự/quỹ). Riêng `nurse.appointment.read` ĐÃ cấp (#209, chủ dự án chọn phương án 2). Khoảng trống MỚI sẽ làm test fail.
- **Bảo trì**: thêm trang/endpoint mới gọi API đọc của module khác → cập nhật `PERMISSION_COMPANIONS`; endpoint mới BẮT BUỘC khai `@RequirePermission` (hoặc thêm `LOGIN_ONLY_ROUTES` kèm lý do). Quy tắc đã ghi ở `.claude/docs/security-audit.md`.
- Dữ liệu test còn lại ở tenant test cố định `01a0cc3c-...`: một số vai trò `VF-*` có tài khoản (đã vô hiệu hoá) gán nên chưa ẩn được; không ảnh hưởng tenant thật.
- Môi trường: Node v26, Postgres container cổng 5433, API dev 3001 (`nest start --watch`), web 5173. Sau khi đổi `packages/core`/`shared` phải `pnpm --filter ... run build` rồi `openapi:generate` + `api:codegen`. Script Playwright dùng phiên này nằm ở scratchpad (không commit).

## File chính đã sửa/thêm (đối chiếu `git status`)

```
apps/api/prisma/{schema.prisma, migrations/20261001120000_reference_catalog_version}
apps/api/src/modules/reference-catalog/*            # version + khoá lạc quan
apps/api/src/modules/iam/{role.service,role.repository,role-permission.repository}.ts  # version ma trận, replaceMatrix hồi sinh, companions
apps/api/src/modules/clinic/clinic-settings.{controller,service}.ts  # wallet-mixed-payment-enabled
apps/api/src/common/permission-matrix-enforcement-http.spec.ts       # quét toàn bộ phân quyền (mới)
apps/api/scripts/generate-openapi.ts, apps/api/openapi/openapi.json
packages/core/src/rbac/permission-companions{,.spec}.ts (mới), packages/core/src/index.ts
packages/shared/src/{role,reference-catalog,clinic}.ts
apps/web/src/features/role/{RolePermissionPane,CompanionHint,companion-hints{,.spec}}.ts(x)
apps/web/src/features/{clinic,department,cash-book,drug,reference-catalog}/*   # áp mẫu xung đột
apps/web/src/features/billing/InvoiceDetailPage.tsx, apps/web/src/shared/layout/Sidebar.tsx
apps/web/src/shared/{api/fetch-one-from-list.ts, hooks/useSaveAttempt.ts, api/openapi-schema.d.ts}
docs/{CHANGELOG,DECISIONS,ERD,TASK}.md, .claude/docs/security-audit.md
```
