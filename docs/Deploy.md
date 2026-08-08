# Deploy — Triển khai NEXAMed (On-premise & Cloud)

## Đọc trước khi làm theo bất kỳ mục nào dưới đây

NEXAMed v1 triển khai **on-premise duy nhất**, tại từng phòng khám (`docs/product/prd.md`, `CLAUDE.md`). Cloud **không phải mục tiêu triển khai của v1** — kiến trúc port/adapter đảm bảo không phải làm lại nền tảng khi cần chuyển sang cloud sau này, nhưng hiện **chưa có** nhà cung cấp, mô hình, hay quy trình cloud nào được chốt.

Việc đóng gói on-premide chính thức (`S4-05` trong `docs/product/plan.md`) **chưa bắt đầu** — tính tới `docs/CURRENT.md`, dự án đang ở Sprint 1/12. Thư mục `deploy/on-prem/` và `deploy/cloud/` mô tả trong `.claude/docs/project-structure.md` **chưa được tạo trong repo**. Tài liệu này gồm hai phần: (1) cách chạy môi trường hiện có (chỉ phục vụ dev/thử nghiệm, xem `docs/demo.md`), và (2) kiến trúc/kế hoạch đã chốt cho on-premise thật và cho khả năng lên cloud sau này — **không phải** hướng dẫn "làm theo là chạy được trên production".

Cập nhật tài liệu này ngay khi S4-05 hoàn thành với hướng dẫn on-prem thật, hoặc khi có quyết định chính thức về cloud.

---

## Phần 1 — Môi trường hiện có (dev/thử nghiệm, chưa phải deploy)

Xem `docs/demo.md` cho hướng dẫn đầy đủ (`pnpm install` → `docker compose up -d` → `pnpm db:migrate` → `pnpm dev`). `docker-compose.yml` ở gốc repo **chỉ chạy PostgreSQL cho dev local** — không có service `api`/`web`/`nginx`/`backup`, không dùng được cho triển khai thật dù ở on-prem hay cloud.

---

## Phần 2 — On-premise (mục tiêu triển khai chính thức của v1)

### Kiến trúc dự kiến

Theo `.claude/docs/project-structure.md`, `deploy/on-prem/docker-compose.yml` (chưa tạo) sẽ gồm:

| Service | Vai trò |
|---|---|
| `api` | NestJS, build từ `apps/api` |
| `web` | Build tĩnh `apps/web`, phục vụ qua nginx |
| `postgres` | PostgreSQL 18, dữ liệu duy nhất tại chỗ |
| `backup` | Chạy `pg_dump` theo lịch, ghi ra thư mục cấu hình được |

Máy chủ đặt tại phòng khám, **không giả định có internet ổn định**. Không dùng dịch vụ cloud bắt buộc cho bất kỳ phần lõi nào (nhắc lịch SMS/Zalo phải chấp nhận thất bại khi mất mạng).

### Việc cần làm trước khi có bản triển khai on-prem thật (chưa làm — S4-05, S6-01, S6-02)

- Viết `deploy/on-prem/docker-compose.yml` đầy đủ 4 service ở trên + script cài đặt tự động.
- **Đổi mật khẩu role `nexamed_app`** khỏi giá trị hard-code trong migration (`docs/DECISIONS.md` #010) — bắt buộc bằng `ALTER ROLE ... PASSWORD` ngoài version control, không dùng giá trị mẫu.
- Sao lưu tự động theo lịch (`pg_dump` ra ổ ngoài) + diễn tập phục hồi thật, đo thời gian (ADM-04, S6-01/S6-02).
- Dùng đúng Node 20 LTS trên image build (khác Node đang chạy ở máy dev, xem `docs/CURRENT.md`).
- Rà soát bảo mật theo checklist `.claude/docs/security-audit.md` (S6-03), kiểm tra không có PII/PHI lọt vào log.
- Tài liệu vận hành: cài đặt, sao lưu, phục hồi, xử lý sự cố thường gặp cho người không rành IT (S6-07); giáo án đào tạo 2 giờ (S4-06).
- Đo hiệu năng p95 API < 500ms với cấu hình máy chủ pilot thật (S6-04).

### Ràng buộc bắt buộc khi viết script/cấu hình on-prem (đã chốt, không tự đổi)

- Toàn bộ cấu hình đọc từ biến môi trường, validate bằng Zod ở `apps/api/src/config` — không đọc `process.env` rải rác, không hard-code đường dẫn tuyệt đối/tên máy chủ/giá trị riêng của một phòng khám.
- Giá trị riêng theo từng phòng khám (giờ làm việc, độ dài slot, mẫu in...) nằm ở bảng `tenant_setting`, không hard-code trong code hay compose file.
- Backup ghi ra thư mục cấu hình được, không dùng dịch vụ cloud lưu trữ ở v1.
- Không cấp `BYPASSRLS`/superuser cho role mà API runtime dùng (đã áp dụng từ S1-03, xem `docs/DECISIONS.md` #010 — giữ nguyên khi đóng gói on-prem).

---

## Phần 3 — Cloud (định hướng v3+, chưa quyết định)

**Chưa có quyết định** về nhà cung cấp cloud, mô hình triển khai (SaaS tập trung nhiều tenant hay mỗi khách một instance riêng), hay pipeline CI/CD cho cloud. Việc này phụ thuộc:

- Câu hỏi mở Q3 trong `docs/product/prd.md` (bán đứt theo cài đặt hay thuê bao theo tháng) — ảnh hưởng có cần kết nối internet định kỳ hay không.
- Nhu cầu thực tế: theo `docs/product/prd.md` phần Appendix A, cloud/đa tenant tập trung chỉ tính tới ở phase v3+, "khi có khách hàng chuỗi".
- `docs/Hybrid Authorization.md` là tài liệu định hướng phân quyền cho giai đoạn platform/đa module (Centralized Identity + Module-Specific Authorization) — **chỉ tham khảo**, chưa triển khai.

### Kiến trúc đã chuẩn bị sẵn cho hướng này (không cần làm lại nền tảng khi tới lúc)

- Mọi phụ thuộc hạ tầng (lưu file, gửi tin nhắn, ký số, cổng BHYT, phân giải danh tính bệnh nhân) đi qua port khai báo trong `packages/core/ports`; chuyển sang cloud chỉ cần thay adapter ở `apps/api/src/infrastructure/*` (ví dụ `StoragePort`: disk cục bộ → S3/MinIO; `EventBusPort`: in-memory → RabbitMQ/Kafka), không sửa service.
- Không lưu state trong RAM tiến trình (session, cache nghiệp vụ, bộ đếm) — sẵn sàng chạy nhiều instance sau load balancer.
- Mô hình multi-tenant (shared database, shared schema, cách ly bằng `tenant_id` + RLS) đã tính cho triển khai tập trung nhiều tenant từ đầu (`.claude/docs/multi-tenancy.md`). Nếu sau này có khách yêu cầu database riêng, tách bằng cách **route connection theo tenant** — không đổi mô hình cột `tenant_id` vì toàn bộ code đang dựa vào nó.

### Ràng buộc

**Không tự ý bắt đầu code hay dựng hạ tầng theo hướng cloud khi chưa có quyết định chính thức.** Theo `CLAUDE.md`: cấu trúc đã chốt (schema, ranh giới module, contract) không được tự ý thay đổi hay suy diễn — cần đổi hướng thì dừng lại, nêu vấn đề và hỏi trước.
