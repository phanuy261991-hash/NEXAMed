# PLAN: NEXAMed v1 — Kế hoạch triển khai

**Version**: v1.0 — 07/08/2026
**Căn cứ**: `prd.md` v1.0, `CLAUDE.md`, `.claude/docs/`
**Phương án timeline**: B (pilot tuần 8, GA tuần 12) — mặc định. Nếu bạn chọn phương án A (8 tuần), xem mục 8.

---

## 1. Giả định của kế hoạch

Nếu một trong các giả định này sai, kế hoạch phải tính lại — đừng cố ép theo.

| # | Giả định | Nếu sai |
|---|---|---|
| A1 | 4 developer toàn thời gian, không chia sẻ với dự án khác | Mỗi dev thiếu = kéo dài khoảng 3 tuần |
| A2 | Không có QA và BA riêng; dev tự viết test, bạn đóng vai PO | Cần cộng 15% thời gian cho việc làm rõ yêu cầu |
| A3 | Có sẵn thiết kế cơ bản hoặc chấp nhận dùng UI component library, không cần designer | Nếu cần thiết kế riêng, cộng 2 tuần |
| A4 | Phòng khám pilot chốt xong trước tuần 3 | Mốc tuần 8 trượt tương ứng |
| A5 | Câu hỏi pháp lý Q1, Q2 trong PRD trả lời xong trước cuối tuần 2 | Rủi ro phải sửa schema trên dữ liệu thật |

**Năng lực khả dụng**: 4 dev × 12 tuần = 240 dev-day danh nghĩa. Trừ họp, code review, môi trường, nghỉ phép (~20%) còn khoảng **190 dev-day**. Tổng ước lượng công việc bên dưới là **190 dev-day**, tức là **không có dự phòng ngoài phần đệm đã ghi trong từng sprint**. Đây là kế hoạch căng, không phải kế hoạch thoải mái.

---

## 2. Phân vai

| Vai | Ký hiệu | Phụ trách chính |
|---|---|---|
| Backend nền tảng | **BE1** | Tenant/RLS, auth, audit, port/adapter, migration, triển khai |
| Backend nghiệp vụ | **BE2** | Module patient, appointment, encounter, prescription |
| Frontend chính | **FE1** | Màn hình khám, kê đơn, lịch |
| Frontend/Fullstack | **FE2** | Bệnh nhân, tiếp nhận, quản trị; hỗ trợ backend khi cần |

Quy tắc: **BE1 sở hữu các quyết định chạm nền tảng** (schema chuẩn, RLS, audit, port). Ai muốn đổi thì đề xuất, không tự sửa — theo ràng buộc trong `CLAUDE.md`.

---

## 3. Việc phải làm ngay tuần 1, song song với code

Đây là việc của bạn, không phải của dev, nhưng chặn tiến độ nếu chậm.

| # | Việc | Hạn | Chặn cái gì |
|---|---|---|---|
| T1 | Chốt câu trả lời Q1 (thời hạn lưu trữ) và Q2 (chữ ký số) trong PRD | Cuối tuần 2 | Schema `prescription`, `clinical_note`, chính sách lưu trữ |
| T2 | Lấy danh mục ICD-10 kèm tên tiếng Việt, dạng file có thể nhập máy | Cuối tuần 3 | ENC-03, chặn sprint 3 |
| T3 | Chốt phòng khám pilot, ký thoả thuận dùng thử | Cuối tuần 3 | Mốc tuần 8 |
| T4 | Khảo sát 3 sản phẩm đối thủ đang bán, viết 1 trang so sánh | Cuối tuần 2 | Rủi ro R9, có thể đổi scope |
| T5 | Xác nhận mẫu in đơn thuốc hợp lệ | Cuối tuần 6 | PRE-04 |
| T6 | Đo hiện trạng tại pilot: bấm giờ tiếp nhận và khám trong 3 ngày | Tuần 7 | Success metrics, không đo là không chứng minh được gì |
| T7 | Chuẩn bị máy chủ tại pilot (cấu hình, UPS, mạng LAN) | Cuối tuần 7 | Mốc tuần 8 |

---

## 4. Sprint 1 — Nền tảng (Tuần 1-2) · 34 dev-day

Mục tiêu: mọi ràng buộc trong `CLAUDE.md` được ép bằng code và CI, không bằng lời nhắc.

| ID | Việc | Est | Người | Phụ thuộc |
|---|---|---|---|---|
| S1-01 | Khởi tạo monorepo pnpm, cấu trúc thư mục theo `project-structure.md`, ESLint boundary rules, CI | 3 | BE1 | — |
| S1-02 | Prisma schema nền: bộ 8 cột bắt buộc, base model, quy ước migration, `code_sequence` | 3 | BE1 | S1-01 |
| S1-03 | Tenant context: middleware set `app.current_tenant_id`, RLS policy, unit of work | 5 | BE1 | S1-02 |
| S1-04 | Auth: JWT + refresh rotation, Argon2id, khoá tài khoản, 5 vai trò, RBAC guard | 5 | BE2 | S1-02 |
| S1-05 | Audit log: interceptor ghi trong cùng transaction, bảng append-only, quyền DB | 4 | BE2 | S1-03 |
| S1-06 | `packages/core`: khung entity, lớp lỗi + mã lỗi, `ports/` 6 interface, adapter no-op, đăng ký DI | 3 | BE1 | S1-01 |
| S1-07 | Test harness cách ly tenant: testcontainers Postgres, helper tạo 2 tenant, template test | 3 | BE2 | S1-03 |
| S1-08 | Web: app shell, router, provider, luồng đăng nhập, layout, design token | 5 | FE1 | S1-04 |
| S1-09 | Web: api client sinh từ OpenAPI, TanStack Query setup với cache key có `tenantId`, xử lý lỗi chung | 3 | FE2 | S1-08 |

**Gate cuối sprint 1** — không đạt thì không sang sprint 2:
- [ ] CI fail khi `packages/core` import NestJS/Prisma/React
- [ ] CI fail khi migration tạo bảng thiếu một trong 8 cột bắt buộc (viết script kiểm tra)
- [ ] Test cách ly tenant chạy được: đăng nhập tenant A gọi ID của tenant B trả 404
- [ ] Mọi thao tác ghi mẫu đều sinh dòng `audit_log`; rollback audit thì rollback cả thao tác

---

## 5. Sprint 2 — Bệnh nhân + Đặt lịch (Tuần 3-4) · 34 dev-day

| ID | Việc | PRD | Est | Người |
|---|---|---|---|---|
| S2-01 | Module `patient`: CRUD, mã hoá `national_id` + cột hash, `global_patient_ref` để null | PAT-01 | 4 | BE2 |
| S2-02 | Tìm kiếm bệnh nhân: index, tìm không dấu, phân trang cursor, đo với 50k bản ghi | PAT-02 | 3 | BE2 |
| S2-03 | Chống trùng: chặn trùng CCCD, cảnh báo trùng tên + ngày sinh | PAT-03 | 2 | BE2 |
| S2-04 | Lưu thẻ BHYT (mã hoá số thẻ), hiển thị, không tính chi trả | PAT-05 | 2 | BE2 |
| S2-05 | Module `appointment`: exclusion constraint chống trùng giờ, service bắt lỗi constraint | APP-02, 03 | 4 | BE1 |
| S2-06 | Huỷ lịch có lý do, ghi audit; walk-in tạo lịch + check-in trong một transaction | APP-04, 06 | 3 | BE1 |
| S2-07 | Module `tenant`: tài khoản, vai trò, cấu hình phòng khám (giờ làm, slot, phòng) | ADM-01, 02 | 4 | BE1 |
| S2-08 | Web: danh sách + form + chi tiết bệnh nhân, luồng chống trùng | PAT-01→03 | 5 | FE2 |
| S2-09 | Web: lịch dạng lưới theo bác sĩ và ngày, thao tác đặt/huỷ/kéo thả | APP-01 | 5 | FE1 |
| S2-10 | Test cách ly tenant cho toàn bộ endpoint mới + vá lỗi | — | 2 | BE2 |

**Gate cuối sprint 2**:
- [ ] Hai phiên đặt lịch đồng thời cùng khung giờ: một thành công, một trả `APPOINTMENT_SLOT_CONFLICT` (test cụ thể, không chỉ chạy tay)
- [ ] Tìm kiếm bệnh nhân trên 50.000 bản ghi trả về dưới 1 giây
- [ ] Không endpoint nào trả danh sách bệnh nhân thiếu lọc `tenant_id`

---

## 6. Sprint 3 — Tiếp nhận + Khám bệnh (Tuần 5-6) · 31 dev-day

Sprint rủi ro nhất. Nếu trượt, mốc pilot tuần 8 trượt theo.

| ID | Việc | PRD | Est | Người |
|---|---|---|---|---|
| S3-01 | Nhập và chuẩn hoá danh mục ICD-10, seed, tìm kiếm theo mã và tên tiếng Việt không dấu | ENC-03 | 5 | BE1 |
| S3-02 | State machine `encounter` trong `packages/core` + unit test cho mọi cạnh hợp lệ và không hợp lệ | ENC | 3 | BE2 |
| S3-03 | Check-in: tạo encounter, snapshot thẻ BHYT, hàng đợi theo giờ đến | REC-01 | 3 | BE2 |
| S3-04 | Sinh hiệu: nhập, ngưỡng cảnh báo cấu hình được, lưu số nguyên (gram, mm) | REC-02, 03 | 3 | BE2 |
| S3-05 | API màn hình khám: gộp tiền sử, dị ứng, sinh hiệu trong một request, tối ưu index | ENC-01 | 3 | BE1 |
| S3-06 | Web: màn hình khám — bố cục tiền sử + nhập liệu, tối ưu cho 1366×768 | ENC-01 | 6 | FE1 |
| S3-07 | Web: ghi chú SOAP và chọn chẩn đoán ICD-10 (autocomplete, gợi ý mã hay dùng) | ENC-02, 03 | 3 | FE1 |
| S3-08 | Web: màn hình tiếp nhận và nhập sinh hiệu | REC-01→03 | 3 | FE2 |
| S3-09 | Test + đo hiệu năng màn hình khám (< 2 giây với bệnh nhân có 20 lần khám cũ) | — | 2 | BE2 |

**Gate cuối sprint 3**:
- [ ] Chạy được đầu-cuối: đặt lịch → check-in → sinh hiệu → khám → có chẩn đoán ICD-10
- [ ] Bác sĩ tìm ra mã ICD-10 cho 10 bệnh thường gặp trong dưới 10 giây mỗi mã (thử với người thật, không phải dev)
- [ ] Màn hình khám tải dưới 2 giây

---

## 7. Sprint 4 — Kê đơn + Pilot (Tuần 7-8) · 30 dev-day

| ID | Việc | PRD | Est | Người |
|---|---|---|---|---|
| S4-01 | Module `prescription`: kê đơn, liều, số ngày, tính số lượng | PRE-01 | 5 | BE2 |
| S4-02 | Cảnh báo trùng hoạt chất và đối chiếu dị ứng; cảnh báo mềm ghi lý do vào audit | PRE-02, 03 | 3 | BE2 |
| S4-03 | Danh mục thuốc: cấu trúc bảng, nhập từ file, màn hình quản lý | PRE-01 | 3 | FE2 |
| S4-04 | In đơn: mẫu theo T5, CSS print, xem trước, in thử trên máy in thật | PRE-04 | 4 | FE1 |
| S4-05 | Đóng gói on-premise: docker-compose, script cài đặt, nginx, kiểm tra sức khoẻ dịch vụ | — | 4 | BE1 |
| S4-06 | Dữ liệu khởi tạo cho pilot, tài liệu hướng dẫn sử dụng, giáo án đào tạo 2 giờ | — | 3 | FE2 |
| S4-07 | **Cài đặt tại pilot, đào tạo, trực hỗ trợ 2 ngày đầu** | — | 3 | BE1 + FE1 |
| S4-08 | Đệm cho lỗi phát sinh | — | 5 | Cả nhóm |

**Mốc tuần 8 — Pilot**. Điều kiện bàn giao:
- [ ] Chạy được toàn bộ luồng trên máy chủ tại phòng khám, không cần internet
- [ ] Đã đo hiện trạng (T6) và có số liệu gốc
- [ ] Nhân viên phòng khám tự thao tác được sau đào tạo 2 giờ
- [ ] Có sao lưu thủ công hằng ngày (tự động để sprint 6) và đã thử phục hồi một lần
- [ ] **Pilot chạy song song sổ giấy** — chưa bỏ giấy

---

## 8. Sprint 5 — Ký, đính chính, vá lỗi (Tuần 9-10) · 33 dev-day

Phần đệm lỗi ở sprint này lớn có chủ ý. Nếu pilot ít lỗi, dùng phần dư làm các mục P1.

| ID | Việc | PRD | Est | Người |
|---|---|---|---|---|
| S5-01 | **Vá lỗi và điều chỉnh từ pilot** (ưu tiên cao nhất, cắt việc khác nếu cần) | — | 12 | Cả nhóm |
| S5-02 | Ký hồ sơ khám và đơn thuốc: `signed_at`, `signed_by`, gọi `SignaturePort` no-op, khoá sửa | ENC-04 | 3 | BE2 |
| S5-03 | Đính chính: tạo bản mới `supersedes_id` + lý do bắt buộc, soft-delete bản cũ | ENC-04 | 3 | BE2 |
| S5-04 | Web: luồng đính chính và màn hình lịch sử sửa đổi (ai, gì, lúc nào, lý do) | ENC-05 | 5 | FE1 |
| S5-05 | Màn hình nhật ký hoạt động: lọc theo bệnh nhân, theo người dùng, theo khoảng thời gian | ADM-03 | 4 | FE2 |
| S5-06 | Gộp hồ sơ trùng (P1) | PAT-04 | 4 | BE2 |
| S5-07 | Tự đánh dấu không đến theo ngưỡng cấu hình (P1) | APP-05 | 2 | BE1 |

**Gate cuối sprint 5**:
- [ ] Bản ghi đã ký không sửa được qua API, kể cả gọi trực tiếp (có test)
- [ ] Chuỗi đính chính hiển thị đầy đủ, không mất bản gốc
- [ ] Mọi lần xem hồ sơ bệnh nhân đều có dòng trong nhật ký

---

## 9. Sprint 6 — Triển khai và GA (Tuần 11-12) · 28 dev-day

| ID | Việc | PRD | Est | Người |
|---|---|---|---|---|
| S6-01 | Sao lưu tự động theo lịch, ghi ra ổ ngoài, cảnh báo khi sao lưu thất bại | ADM-04 | 4 | BE1 |
| S6-02 | **Diễn tập phục hồi**: xoá sạch DB thử nghiệm và khôi phục từ bản sao lưu, tính thời gian | ADM-04 | 2 | BE1 |
| S6-03 | Rà soát bảo mật theo checklist trong `security-audit.md`; kiểm tra không có PII trong log | — | 3 | BE2 |
| S6-04 | Đo hiệu năng: p95 < 500 ms với 10 người dùng đồng thời trên cấu hình máy chủ pilot | — | 3 | BE1 |
| S6-05 | Lưu nháp offline cho form khám (P1) | ENC-06 | 4 | FE1 |
| S6-06 | Xuất bệnh án một bệnh nhân ra PDF (P1) | ADM-05 | 3 | FE2 |
| S6-07 | Tài liệu vận hành: cài đặt, sao lưu, phục hồi, xử lý sự cố thường gặp | — | 3 | FE2 |
| S6-08 | Đệm + checklist GA | — | 6 | Cả nhóm |

**Mốc tuần 12 — GA v1**. Điều kiện:
- [ ] Pilot ngừng dùng sổ giấy, chạy hoàn toàn trên hệ thống ít nhất 5 ngày làm việc
- [ ] Đạt các chỉ số ở mục 5 của PRD: tiếp nhận < 90 giây, hồ sơ khám < 3 phút, ICD-10 > 95%, đơn in > 90%
- [ ] Sao lưu tự động chạy đúng 7 ngày liên tiếp, phục hồi thử thành công
- [ ] Không lỗi nghiêm trọng nào chưa xử lý (mất dữ liệu, sai bệnh nhân, rò rỉ giữa tenant)
- [ ] Có tài liệu cài đặt để triển khai khách hàng thứ hai mà không cần dev có mặt

---

## 10. Phương án A — nếu bắt buộc giữ mốc 8 tuần

Cắt khỏi v1 các mục sau, tổng khoảng 40 dev-day:

| Cắt | Hệ quả chấp nhận |
|---|---|
| PAT-04 gộp hồ sơ | Hồ sơ trùng xử lý thủ công, tồn đọng dần |
| APP-05 tự đánh dấu không đến | Lễ tân đánh dấu tay |
| REC-04 màn hình hàng đợi chung | Mỗi người tự xem trên máy mình |
| ENC-06 lưu nháp offline | Mất mạng giữa ca khám thì mất phần đang nhập — **rủi ro thật, cần cân nhắc kỹ** |
| ADM-05 xuất PDF bệnh án | In từ trình duyệt |
| ADM-04 sao lưu tự động | Chuyển thành sao lưu thủ công theo quy trình — **không khuyến nghị cắt** |

Ba mục **không được cắt** dù chọn phương án nào: RLS và test cách ly tenant, nhật ký hoạt động, cơ chế đính chính bệnh án. Cắt ba mục này thì sản phẩm không dùng được cho mục đích y tế.

Nếu chọn phương án A, GA tuần 8 chỉ nên hiểu là "pilot mở rộng", không nhận khách hàng trả tiền cho tới khi có sao lưu tự động và đã diễn tập phục hồi.

---

## 11. Nhịp làm việc và kiểm soát

| Hoạt động | Tần suất | Nội dung |
|---|---|---|
| Standup | Hằng ngày, 10 phút | Chặn ở đâu, không báo cáo tiến độ dài dòng |
| Rà mốc | Cuối mỗi sprint | Chạy gate checklist; không đạt thì cắt scope sprint sau, không dồn nợ |
| Kiểm điểm giữa chặng | **Cuối tuần 4** | Quyết định giữ phương án B hay chuyển A. Đây là điểm quyết định, không phải hình thức |
| Review với pilot | Hằng tuần từ tuần 8 | Ngồi cạnh lễ tân và bác sĩ quan sát, không hỏi qua điện thoại |

**Định nghĩa hoàn thành** cho mọi task:
- [ ] Có test tự động (unit cho logic trong `core`, integration cho endpoint chạm DB)
- [ ] Endpoint chạm dữ liệu bệnh nhân có test cách ly tenant
- [ ] Không vi phạm ràng buộc trong `CLAUDE.md` (CI kiểm được phần lớn)
- [ ] Đã code review bởi một người khác
- [ ] Nếu đụng schema: có migration và đã cập nhật `.claude/docs/data-model.md` trong cùng PR

---

## 12. Cảnh báo sớm

Các dấu hiệu cần dừng lại và tính lại kế hoạch, thay vì cố chạy tiếp:

| Dấu hiệu | Ngưỡng | Hành động |
|---|---|---|
| Sprint 1 không qua gate | Cuối tuần 2 | Lùi mọi mốc một sprint; nền tảng sai thì sửa sau đắt gấp nhiều lần |
| Danh mục ICD-10 chưa có | Cuối tuần 3 | Chuyển S3-01 lên đầu sprint 3 và cắt một mục P1 để bù |
| Sprint 3 trượt quá 20% | Cuối tuần 6 | Chuyển sang phương án A ngay, đừng chờ tới tuần 8 |
| Bác sĩ ở pilot mất trên 5 phút mỗi ca khám | Tuần 9 | Dừng thêm tính năng, dành trọn sprint 5 tối ưu luồng nhập liệu |
| Phát hiện rò rỉ dữ liệu giữa tenant | Bất cứ lúc nào | Dừng phát triển, xử lý trước mọi việc khác |

---

## 13. Sau GA

| Việc | Thời điểm |
|---|---|
| Theo dõi pilot thêm 4 tuần, thu số liệu cho mục 5 PRD | Tuần 13-16 |
| Triển khai khách hàng thứ hai, đo thời gian cài đặt (mục tiêu dưới 1 ngày) | Tuần 14+ |
| Kiểm điểm sau dự án: so ước lượng với thực tế từng sprint, ghi lại để ước lượng v1.1 chính xác hơn | Tuần 13 |
| Bắt đầu v1.1 (gộp hồ sơ, xuất PDF, nhắc lịch) | Sau 4 tuần pilot ổn định |

---

## 14. Lịch sử phiên bản

| Version | Ngày | Thay đổi |
|---|---|---|
| v1.0 | 07/08/2026 | Bản đầu tiên, dựng từ PRD v1.0 theo phương án timeline B |
