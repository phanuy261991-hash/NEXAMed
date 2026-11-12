# HANDOFF — #297 bổ sung 4 "Lãi gộp dịch vụ" XONG và đã push — 2026-11-12 (phần 2)

## 1. Trạng thái một câu
Doanh thu + lãi gộp dịch vụ trong báo cáo Chi phí vật tư (4 tab, thêm Theo vật tư và Theo chi nhánh) và lãi gộp dịch vụ/tổng ở Toàn hệ thống (So sánh chi nhánh, Tổng hợp tháng, Xếp hạng) đã làm xong, đã push `master`. Full API 2310 xanh, Chrome IP LAN 54/54 + 19/19. Không migration, không `db:seed`; môi trường khác chỉ cần khởi động lại API.

## 2. Việc đầu tiên của phiên sau
1. **Kiểm CI của commit sửa lỗi kiểu** (đứng sau `53608d4`): CI của `53608d4` ĐỎ ở bước Typecheck vì `system-report-http.spec.ts` dòng 383 (`rowOf<…>` thiếu `branchId`; vitest không kiểm kiểu nên test vẫn xanh). Đã sửa, `pnpm typecheck` + `pnpm lint` toàn cục sạch trước khi push. Cần xác nhận CI xanh (không có `gh`: dùng REST với Git credential, script nhỏ gọi `GET /repos/phanuy261991-hash/NEXAMed/actions/runs?branch=master`, xem job/step qua `jobs_url`).
2. **Bài học**: sau khi sửa file `*.spec.ts`, chạy `pnpm typecheck` (không chỉ vitest) trước khi push.

## 3. Đã chốt (đừng bàn lại) — chi tiết ở `docs/DECISIONS.md` #297 bổ sung 4
- Doanh thu theo "Ghi nhận"; chỉ tính các lượt ĐÃ GHI tiêu hao (mọi tab khớp số nhau); lượt hoàn tiền mà vật tư đã hao vẫn tính chi phí, lãi gộp âm; Excel vật tư để trống "Tính chất sử dụng" giữ "chưa phân loại".
- Tab Theo chi nhánh chỉ có khi `scope.canChoose` (≥ 2 chi nhánh + `company_report.read`); KHÔNG có thẻ riêng trong Trung tâm báo cáo.
- Chủ dự án "chốt mockup" https://claude.ai/artifact/Q24fVpUDrunFxbz2qB1HVw và yêu cầu làm luôn Tổng hợp tháng + Xếp hạng (mockup không vẽ, dựng theo khuôn tab cùng trang).

## 4. Việc chủ dự án chưa xem
- 6 quyết định kỹ thuật GĐ4 (#297 bổ sung 2) và các chỗ tự chọn ở bổ sung 4: dòng gói chia theo giá niêm yết; dịch vụ bị bỏ ở quầy (#280) có lãi gộp âm nhưng không có nhãn "Đã hoàn tiền".
- Hình thức: dải số Tổng hợp tháng nay 7 ô xếp 5 + 2 (dòng dưới giãn rộng) — chưa có ý kiến.

## 5. Việc kế tiếp
- #297 GĐ5 phần kiểm thử cuối (tài liệu đã xong ở `docs/pilot-onboarding.md` mục 3.10).
- Danh sách chờ người/máy ngoài: xem `docs/CURRENT.md` mục "Đang chờ / việc treo" (pilot S6-02/S6-04/`1.0.0`, hạ tầng SaaS, bộ cài trên máy sạch/NAS, liên thông thật, chữ ký điện tử bệnh án, gói Nhi khoa, Thông tư 18/2026, luật tường lửa 8181 cần Administrator).

## 6. Cách chạy lại kiểm Chrome
1. Build API sang thư mục riêng (KHÔNG ghi đè `dist/`, vì có thể có tiến trình khác đang chạy `dist/main`): `cd apps/api && npx tsc -p tsconfig.json --outDir dist-lancheck --incremental false`, chạy `PORT=3011 node dist-lancheck/main.js`.
2. `LAN_API_TARGET=http://localhost:3011 pnpm dev:lan` (in địa chỉ IP, đổi giữa các phiên). Cài `playwright-core@1.49.1` ở thư mục tạm.
3. `PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<tạm> node scripts/ui-audit/service-consumption-check.cjs` (54/54) và `scripts/ui-audit/system-service-margin-check.cjs` (19/19, chỉ đọc).
4. Dọn: tắt API 3011 + dev:lan, xoá `apps/api/dist-lancheck`. **Tắt cưỡng bức dev:lan làm `config.json` không tự khôi phục** — kiểm `apps/web/public/config.json` còn `apiBaseUrl` và không còn `config.json.lan-backup` (nếu còn: đổi tên đè lên `config.json`).

## 7. Bẫy đã gặp
- Tiến trình lạ chiếm cổng 3001 chạy `dist/main` bản cũ (người dùng/IDE khởi động): đừng dùng/đừng tắt, chạy API riêng ở cổng khác.
- `rowOf<T>` của spec hệ thống yêu cầu `T extends { branchId: string }`.
- `innerText` của đầu bảng là CHỮ HOA (CSS): so khớp không phân biệt hoa thường.
- Lỗi 503 ở báo cáo hiện câu chung "Hệ thống đang khởi động hoặc tạm thời không truy cập được…" chứ không phải câu dự phòng `errorMessage` của từng tab.
