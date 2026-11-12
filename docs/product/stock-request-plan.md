# Kế hoạch — Yêu cầu cấp hàng + Đơn đặt hàng NCC theo cấp (chốt nghiệp vụ 12/11/2026)

Trạng thái: **MOCKUP ĐÃ DUYỆT 12/11/2026; GĐ1 (Yêu cầu cấp hàng) ĐÃ LÀM, GĐ2 (Đơn đặt hàng NCC) CHƯA.** Quyết định: `docs/DECISIONS.md` #298.

## 1. Bài toán (lời chủ dự án)

Chi nhánh hết hàng thì yêu cầu cấp hàng lên chi nhánh chính; các phòng ban yêu cầu cấp hàng lên kho chính của chi nhánh. Phân cấp: phòng ban → kho chính của chi nhánh → (chi nhánh) kho chính của chi nhánh chính. Bổ sung: cho phép chi nhánh đặt hàng trực tiếp từ nhà cung cấp, phân cấp rõ giữa các chi nhánh; đây là chức năng TUỲ CHỌN, phòng khám không cho đặt riêng từng chi nhánh thì ẩn.

## 2. Hiện trạng tái dùng được

- "Điều chuyển kho" (`stock_transfer`) chỉ chạy chiều bên gửi chủ động; đã có Duyệt xuất → Kiểm nhận → hao hụt. **Không viết lại**, yêu cầu được duyệt sẽ sinh phiếu này.
- Kho chính của chi nhánh = `warehouse.is_default` (mỗi chi nhánh đúng 1). Kho phụ gắn Khoa/Phòng qua `warehouse.department_id`. Chi nhánh chính = `branch.is_default`.
- Mức tồn tối thiểu có sẵn: `drug.min_stock_alert`.
- Nhà cung cấp, Phiếu nhập kho `PURCHASE`, công nợ NCC (chung cả công ty) đã có. **Chưa có chứng từ đặt hàng.**

## 3. Đã chốt (8 câu)

1. Duyệt yêu cầu xong → **tự sinh Phiếu điều chuyển nháp** ở kho cấp trên (gợi ý lô theo hạn dùng); phần giao/nhận/hao hụt dùng nguyên luồng điều chuyển hiện có.
2. Kho chính thiếu hàng cấp cho phòng ban → người kho chính bấm **"Xin phần thiếu lên chi nhánh chính"**: sinh yêu cầu MỚI lên chi nhánh chính, gắn liên kết với yêu cầu gốc để theo dõi cả chuỗi.
3. Biết hàng nào cần xin: **chọn tay + nút "Thêm các mặt hàng dưới mức tồn tối thiểu"** (dùng `min_stock_alert`), người dùng sửa số lượng trước khi gửi.
4. Chi nhánh chính = **chi nhánh mặc định** sẵn có, không thêm cấu hình cấp trên.
5. (**SỬA 12/11/2026, thay bản đầu "phần thiếu đóng, xin lại bằng yêu cầu mới"**) Người xử lý **sửa "Số cấp" từng dòng** (0 đến số xin) và với phần chưa cấp chọn MỘT trong: **Từ chối** (lý do BẮT BUỘC) hoặc **Chờ hàng về** (lý do bắt buộc, ngày dự kiến tuỳ chọn, liên kết tuỳ chọn tới Đơn đặt hàng NCC hoặc yêu cầu đã xin lên chi nhánh chính). Mỗi lần "Cấp" sinh MỘT phiếu điều chuyển nháp; một yêu cầu có thể có NHIỀU phiếu điều chuyển, bên xin KHÔNG phải lập lại yêu cầu.
6. Nội dung phiếu: **mức khẩn (Thường/Khẩn), ngày cần hàng, lý do/ghi chú, tồn của bên xin tại lúc gửi** (chụp số lượng, KHÔNG giá vốn/giá bán).
7. Menu: mục **"Yêu cầu cấp hàng"** cạnh "Điều chuyển kho" trong nhóm Quản lý kho (2 tab "Yêu cầu của tôi" / "Cần duyệt"); thêm công tắc **"Dùng yêu cầu cấp hàng"** ở Cấu hình chung. Người duyệt thấy số tồn lúc gửi của bên xin (ngoại lệ liên chi nhánh, chỉ số lượng).
8. Đặt hàng NCC: chứng từ mới **"Đơn đặt hàng NCC"**, nhận hàng bằng **Phiếu nhập kho liên kết** (một đơn nhận nhiều đợt, theo dõi đã nhận/còn thiếu). Duyệt đơn của chi nhánh phụ **cấu hình được** (chi nhánh chính duyệt hoặc chi nhánh tự duyệt). Công tắc **"Cho phép chi nhánh đặt hàng NCC riêng"**: TẮT → chỉ chi nhánh chính đặt/nhập hàng NCC, chi nhánh phụ chỉ xin hàng và nhận chuyển kho (ẩn Đơn đặt hàng, chặn Phiếu nhập mua hàng ở chi nhánh phụ). BẬT → khi thiếu hàng người dùng chọn mỗi lần: xin chi nhánh chính hoặc đặt NCC.

9. **Vòng đời bên xin theo dõi (chốt 12/11/2026)** — 4 trạng thái chính: **Đã tiếp nhận** (kho cấp bấm "Tiếp nhận", bước riêng sau "Đã gửi"), **Đang xử lý** (đã cấp một phần/đang giao/có dòng chờ hàng về), **Đã hoàn thành** (mọi dòng đã nhận đủ hoặc đã đóng có lý do), **Từ chối** (cả phiếu, lý do bắt buộc); thêm "Đã gửi" (chờ tiếp nhận) và "Đã rút". Trạng thái phiếu suy ra từ trạng thái từng dòng: Chờ xử lý / Sẽ cấp / Đã cấp / Chờ hàng về / Từ chối (lý do) / Đã rút.
10. **"Cấp tiếp"**: khi Phiếu nhập kho hoặc điều chuyển đến làm kho cấp đủ hàng, yêu cầu đang chờ nổi lên ở tab "Cần duyệt" với nhãn "Hàng đã về"; kho cấp bấm "Cấp tiếp" MỘT lần, hệ thống sinh thêm phiếu điều chuyển nháp cho số còn thiếu.
11. **Quyền bên xin**: rút cả phiếu khi chưa được cấp (kèm lý do); rút phần còn chờ sau khi đã cấp một phần (phần đã cấp giữ nguyên, phiếu chuyển Đã hoàn thành); nhắn bổ sung và nâng mức khẩn khi đang chờ. **Rút khi kho cấp đã đặt NCC (chủ dự án hỏi 12/11/2026, ĐỀ XUẤT trong mockup, chờ duyệt)**: Đơn đặt hàng NCC và yêu cầu là hai chứng từ độc lập nên rút yêu cầu KHÔNG huỷ đơn NCC; nếu dòng chờ đã liên kết đơn ở trạng thái "Đã đặt" thì bên xin gửi "Yêu cầu rút", kho cấp xác nhận (hoặc từ chối giữ) vì kho cấp đã chịu chi phí; hàng về vẫn nhập kho cấp, không tự cấp cho phiếu đã rút.

12. **In ấn và quản lý danh sách (chủ dự án yêu cầu 12/11/2026)**: MỌI phiếu (Phiếu yêu cầu cấp hàng, Đơn đặt hàng NCC) đều có nút **In** ở danh sách và ở chi tiết, dùng `PrintDocument`/`PrintButton` + hộp chọn khổ giấy + Quản lý mẫu in (2 loại chứng từ in mới); tên chi nhánh in trên đầu phiếu khi công ty ≥ 2 chi nhánh. Hai danh sách có **lọc theo khoảng ngày/kho/NCC/mức khẩn/trạng thái, dải đếm theo trạng thái, Xuất Excel, In danh sách** (quy tắc báo cáo #287: mọi bảng kê phải có Excel và In). Mockup: https://claude.ai/artifact/Ut7h7axLUPynLqwvPbaPBi (11 màn, ĐÃ ĐĂNG, CHỜ DUYỆT).

13. **Thao tác của bên xin theo trạng thái (chốt 12/11/2026)**: HUỶ phiếu chỉ khi kho cấp CHƯA bấm Tiếp nhận (kèm lý do; phiếu "Đã gửi" còn sửa tự do); sau khi Đã tiếp nhận mà CHƯA cấp dòng nào thì không huỷ nhưng được **thêm mặt hàng** và **rút từng dòng chưa có hàng**, mỗi lần đều **báo kho cấp** (nhãn "Có cập nhật mới" ở tab Cần duyệt, dòng "Mới thêm", ghi vào diễn biến); đã cấp từ 1 dòng thì không thêm hàng (lập phiếu mới), chỉ rút được dòng đang "Chờ hàng về"; luôn nhắn bổ sung/đổi mức khẩn/ngày cần. Rút hết dòng khi chưa cấp → phiếu "Đã rút". Mockup màn 6b.
14. **Chuyển thành phiếu điều chuyển (chủ dự án yêu cầu 12/11/2026)**: kho cấp bấm MỘT nút "Chuyển thành phiếu điều chuyển" trên phiếu yêu cầu cấp hàng (kể cả liên chi nhánh), hệ thống tạo `stock_transfer` nháp mang sẵn kho gửi/nhận, mặt hàng, số cấp và gợi ý lô, liên kết hai chiều với yêu cầu; bên nhận kiểm nhận xong thì số "đã cấp" của yêu cầu tự cập nhật; dòng chưa cấp giữ "Chờ hàng về", không phải xin lại. Đây là cách người dùng thấy bước "Cấp" ở mục 5. Mockup màn 5b. (Diễn giải của AI, chờ chủ dự án xác nhận đúng ý.)

15. **Nhận hàng từ danh sách đơn (chủ dự án yêu cầu 12/11/2026)**: danh sách Đơn đặt hàng NCC có nút **Nhận hàng** (đơn "Đã đặt NCC" / "Nhận một phần") mở THẲNG Phiếu nhập kho đã điền sẵn từ đơn (NCC, kho nhận, mặt hàng, số còn thiếu; nhà cung cấp/kho khoá), không phải sang màn Nhập kho rồi tự chọn đơn; nhận vượt số còn thiếu bị chặn; danh sách Phiếu nhập kho thêm cột/bộ lọc "Từ đơn". Mockup màn 9b.

## 4. Mô hình dự kiến (chưa duyệt, chỉ để mockup bám theo)

- `stock_request` (+ `stock_request_line`): kho xin, kho cấp (tự suy ra theo cấp, không cho chọn tuỳ ý), `priority`, `needed_by`, `note`, `status` (`DRAFT` → `SUBMITTED` → `ACCEPTED` → `IN_PROGRESS` → `COMPLETED`; nhánh `REJECTED` / `CANCELLED`; trạng thái này suy ra từ dòng, dòng có `fulfil_status` `PENDING`/`ALLOCATED`/`WAITING_STOCK`/`REJECTED`/`WITHDRAWN`/`DONE`, kèm `wait_reason`, `wait_expected_date`, `wait_purchase_order_id`/`wait_child_request_id`), `parent_request_id` (chuỗi xin lên), dòng có `requested_qty`, `approved_qty`, `requester_stock_snapshot`, `line_note`. Liên kết `stock_transfer.request_id` (một yêu cầu N phiếu điều chuyển, số lượng đã cấp cộng dồn trên dòng). Thêm yêu cầu rút `withdraw_requested_at` + lý do khi cần kho cấp xác nhận.
- `purchase_order` (+ `purchase_order_line`): NCC, kho nhận, trạng thái `DRAFT` → `PENDING_APPROVAL` (nếu cần chi nhánh chính duyệt) → `APPROVED` → `ORDERED` → `PARTIALLY_RECEIVED` → `RECEIVED` / `REJECTED` / `CANCELLED`; `stock_receipt.purchase_order_id` + dòng nhận gắn dòng đơn.
- Công tắc (`tenant_setting`, chung cả công ty): `stockRequestEnabled` (Dùng yêu cầu cấp hàng), `branchPurchasingEnabled` (Cho phép chi nhánh đặt hàng NCC riêng), `branchPurchaseNeedsMainApproval` (Đơn của chi nhánh phụ cần chi nhánh chính duyệt).
- Quyền mới: `stock_request.create/read/approve`, `purchase_order.create/read/approve`; phân quyền theo Khoa/Phòng như `stock_transfer`.

## 5. Bốn câu hỏi chi nhánh (CLAUDE.md, #231)

1. Phiếu yêu cầu cấp hàng và Đơn đặt hàng: **theo chi nhánh** (kế thừa qua kho xin / kho nhận). Công nợ NCC vẫn chung cả công ty.
2. Lọc qua `requireBranchId`; chi nhánh khác tra id → 404.
3. Ngoại lệ liên chi nhánh duy nhất: bên cấp thấy phiếu yêu cầu cấp hàng đến mình + tồn lúc gửi của bên xin (chỉ số lượng). Chi nhánh chính xem được đơn đặt hàng của chi nhánh phụ chỉ khi cần duyệt hoặc ở chế độ chỉ xem theo cấu hình.
4. Công ty 1 chi nhánh: không cấp chi nhánh; chỉ còn cấp phòng ban → kho chính (và ẩn hẳn khi chỉ có 1 kho). Cần test cô lập 2 chi nhánh cùng tenant.

## 6. Câu hỏi đã trả lời (12/11/2026) và còn mở

**Đã chốt**: (1) nút "Chuyển thành phiếu điều chuyển" đúng ý, áp dụng cả xin hàng nội bộ trong chi nhánh (phiếu điều chuyển cùng chi nhánh); (2) phiếu "Đã gửi" sửa tự do, không cần thông báo kho cấp; (3) rút khi kho cấp đã đặt NCC → bên xin gửi "Yêu cầu rút", kho cấp xác nhận; (4) mặc định công tắc: Dùng yêu cầu cấp hàng BẬT, Cho phép chi nhánh đặt hàng NCC riêng BẬT, Cần chi nhánh chính duyệt TẮT; (5) công ty MỘT chi nhánh VẪN dùng "Đơn đặt hàng NCC"; (6) đơn giá dự kiến TUỲ CHỌN, có thì hiện tổng tiền cho người duyệt; (7) sổ công nợ NCC thêm cột "chi nhánh nhập" (chỉ hiện khi công ty ≥ 2 chi nhánh); (8) **nhận vượt số đặt trên Đơn đặt hàng NCC: mặc định CHẶN và báo lỗi**, cần nhận dư thì bật thêm hoặc để người có quyền duyệt xác nhận (chốt 12/11/2026); (9) **công ty một chi nhánh bỏ bước "Chờ duyệt"**: người lập tự duyệt theo quyền của mình rồi bấm "Đã gửi nhà cung cấp" (chốt 12/11/2026).

**Còn mở**: (a) chủ dự án CHƯA duyệt mockup (sẽ gửi thêm chỉnh sửa); (b) khi bên xin kiểm nhận phiếu điều chuyển thì phiếu yêu cầu cấp hàng tự "Đã hoàn thành" nếu mọi dòng đã nhận đủ/đã đóng (AI đã trả lời; thêm nút "Kiểm nhận" ở dòng "Đang giao" màn 6); riêng **nhận thiếu: phiếu yêu cầu cấp hàng CHƯA hoàn thành cho tới khi kho chính xử lý chênh lệch trên phiếu điều chuyển (chủ dự án ĐỒNG Ý 12/11/2026)**, dòng hiện "Nhận thiếu, chờ kho chính xử lý"; (c) Câu hỏi của chủ dự án về trạng thái đơn đặt hàng sau khi hàng về (AI đã trả lời ở hội thoại, chờ phản hồi): vòng đời trạng thái Đơn đặt hàng NCC và cách trạng thái yêu cầu đổi khi hàng về; yêu cầu mặc định "nhận vượt số đặt thì chặn".

## 7. Quy trình thực hiện

Mockup → chủ dự án duyệt rõ ràng ("duyệt"/"ok làm đi") → ghi DECISIONS #298 + ERD-2 → migration + core + API (kèm test cô lập tenant/chi nhánh, đột biến) → web → Chrome qua IP LAN HTTP → quét quyền → ghi tài liệu. Lộ trình dự kiến: GĐ1 Yêu cầu cấp hàng (kho phụ → kho chính → chi nhánh chính) · GĐ2 Đơn đặt hàng NCC + nhận hàng liên kết + công tắc/duyệt theo cấp.
