# Deploy — Triển khai NEXAMed (On-premise & Cloud)

## Đọc trước khi làm theo bất kỳ mục nào dưới đây

NEXAMed v1 triển khai **on-premise duy nhất**, tại từng phòng khám (`docs/product/prd.md`, `CLAUDE.md`). Cloud **không phải mục tiêu triển khai của v1** — kiến trúc port/adapter đảm bảo không phải làm lại nền tảng khi cần chuyển sang cloud sau này, nhưng hiện **chưa có** nhà cung cấp, mô hình, hay quy trình cloud nào được chốt.

**S4-05 (đóng gói on-premise) đã xong** (2026-09-01) — `deploy/on-prem/` có đủ `docker-compose.yml`, Dockerfile cho `api`/`web`, script backup, script cài đặt `install.ps1` (Windows PC). Tài liệu này gồm hai phần: (1) cách chạy môi trường hiện có cho dev/thử nghiệm (xem `docs/demo.md`, khác hẳn Phần 2 dưới đây), và (2) hướng dẫn triển khai on-premise thật + kiến trúc cho khả năng lên cloud sau này.

Cập nhật tài liệu này ngay khi có thay đổi kiến trúc triển khai, hoặc khi có quyết định chính thức về cloud.

---

## Phần 0 — Ba khái niệm phải nắm trước (chốt 2026-08-25, `docs/DECISIONS.md` #074)

Ghi lại để không phải suy luận lại mỗi lần bàn chuyện triển khai.

### 0.1. `tenant` là gì — chi nhánh hay công ty?

> **Đọc cả hai phần**: mục này mô tả **HIỆN TRẠNG v1** trước, rồi tới **HƯỚNG MỞ RỘNG đã chốt** (`#075`) ở cuối mục. Hai phần nói khác nhau về vai trò của `tenant` là **có chủ ý**, không phải mâu thuẫn — hiện tại chưa có khái niệm chi nhánh, tương lai `tenant` sẽ là công ty chứa nhiều chi nhánh.

**HIỆN TẠI (v1): `tenant` = MỘT CƠ SỞ KHÁM BỆNH ĐỘC LẬP VỀ DỮ LIỆU** (`.claude/docs/multi-tenancy.md`: "một tenant = một phòng khám"; `docs/product/prd.md` Appendix B: "đơn vị cách ly dữ liệu"). Nó **không** phải pháp nhân/công ty, cũng **không** phải một tầng tổ chức có cấp trên.

Hệ quả trực tiếp — **hiện KHÔNG tồn tại tầng "công ty/tập đoàn" nào, cũng KHÔNG có khái niệm "chi nhánh"**. Ở trạng thái v1 hôm nay, một chủ sở hữu có 3 chi nhánh thì buộc phải chạy **3 tenant hoàn toàn tách biệt**, không có gì nối chúng lại:

| Tình huống | Cách hệ thống hiện tại xử lý |
|---|---|
| Công ty A có 3 phòng khám ở 3 quận | 3 tenant riêng (3 `tenant_id` khác nhau) |
| Bệnh nhân khám chi nhánh 1 rồi sang chi nhánh 2 | **2 hồ sơ `patient` độc lập** — chi nhánh 2 KHÔNG thấy tiền sử ở chi nhánh 1 (`multi-tenancy.md` ràng buộc #6) |
| Bác sĩ làm việc ở cả 2 chi nhánh | **2 tài khoản riêng**, đăng nhập riêng từng nơi |
| Danh mục dịch vụ, giá, Khoa/Phòng | Nhập riêng cho từng chi nhánh, không dùng chung |
| Báo cáo tổng hợp toàn công ty | **Chưa có** — không có tầng nào để tổng hợp lên |

Đây là **giới hạn có chủ ý của v1**, không phải thiếu sót: PRD câu hỏi **Q6** ("có cần hỗ trợ nhiều chi nhánh của cùng một chủ ngay ở v1 không?") vẫn đang treo, và mức data scope `branch` đã được ghi rõ là **chưa triển khai** (`prd.md` mục 4.6). Phần "hồ sơ bệnh nhân dùng chung liên chi nhánh" nằm ở phase **v3+** (Appendix A, điều kiện: "khi có khách hàng chuỗi").

#### Hướng mở rộng ĐÃ CHỐT (2026-08-25, `docs/DECISIONS.md` #075) — đọc trước khi thiết kế bất kỳ thứ gì liên quan tới địa điểm

Khi có khách hàng chuỗi thật, **không** đi theo hướng "mỗi chi nhánh một tenant" ở trên. Hướng đã chốt là **mô hình B**: `tenant` trở thành **CÔNG TY**, chi nhánh là bảng `branch` **bên trong** tenant.

```
tenant (Công ty ABC)          ← đơn vị cách ly dữ liệu (RLS) vẫn ở đây
  ├─ branch A (Q1)            ← chi nhánh: thêm sau, khi có khách chuỗi
  ├─ branch B (Q7)
  ├─ patient  → dùng chung toàn công ty, MỘT mã BN duy nhất
  └─ encounter/appointment → gắn `branch_id` (diễn ra tại một chi nhánh cụ thể)
```

**Ràng buộc bắt buộc cho code viết từ nay** (chưa thêm bảng/cột nào, nhưng không được viết ngược hướng):

| Ràng buộc | Lý do |
|---|---|
| **CẤM giả định "1 tenant = 1 địa điểm vật lý"** | Tương lai một tenant có nhiều chi nhánh nhiều địa chỉ — ví dụ địa chỉ in trên phiếu phải lấy theo chi nhánh của lượt khám, không phải thuộc tính duy nhất của tenant |
| **`code_sequence` GIỮ NGUYÊN theo `(tenant_id, prefix)`** | Đã chốt "mã BN duy nhất toàn công ty" → thiết kế hiện tại **đã đúng hướng**, không phải sửa. Tuyệt đối không đổi sang sinh mã theo chi nhánh |
| **`patient` KHÔNG cần `branch_id`** | Bệnh nhân thuộc công ty, không thuộc chi nhánh — khám ở đâu cũng thấy đủ tiền sử |
| **`encounter`/`appointment`/`invoice` SẼ cần `branch_id`** | Diễn ra tại một chi nhánh cụ thể |
| **`room`/`floor`/`exam_station`/`department` sẽ gắn thêm `branch_id`** | Phòng ốc thuộc về một chi nhánh vật lý |
| **Scope `branch` chèn giữa `department` và `global`** | Đúng như `.claude/docs/security-audit.md` đã dự trù, không đổi 4 mức hiện có |

**Ràng buộc HẠ TẦNG — quan trọng nhất, không phải chuyện schema**: mô hình B đòi hỏi cả công ty dùng chung **MỘT database**, tức hạ tầng **tập trung** (VPS/cloud/máy chủ trung tâm). Nếu mỗi chi nhánh đặt một máy chủ riêng tại chỗ thì **về mặt vật lý không thể gộp chung một tenant**. → **Khách chuỗi buộc phải chấp nhận hạ tầng tập trung**; khách một cơ sở vẫn on-prem bình thường. Phải nói rõ điều này với khách chuỗi **trước khi ký hợp đồng**.

**Vì sao chốt hướng sớm dù chưa code**: chi phí phụ thuộc hoàn toàn vào thời điểm — chốt trước khi bán thì chỉ là thêm tầng vào schema (migration forward-only, backfill "chi nhánh mặc định"); chốt sau khi khách đã chạy nhiều cài đặt riêng thì phải **merge nhiều database thành một**, xử lý mã trùng (hai chi nhánh chạy riêng chắc chắn sinh `patient_code` trùng nhau vì sequence theo tenant) và gánh rủi ro nhầm bệnh nhân khi gộp dữ liệu y tế.

**Đã chuẩn bị sẵn để mở rộng sau này, không phải làm lại**: cột `patient.global_patient_ref` (luôn `null` ở v1) + `PatientIdentityPort` (adapter v1 `SameTenantPatientIdentityAdapter` trả chính `patient.id`) — khi cần dùng chung hồ sơ liên chi nhánh thì viết adapter mới, không đụng schema. Nếu cần tầng "công ty" thật (báo cáo tổng hợp, nhân viên dùng chung tài khoản) thì phải thêm mới — kèm mức scope `branch` và cân nhắc mô hình ở `docs/Hybrid Authorization.md` (SSO tập trung + phân quyền theo module).

**Quy đổi thực tế ở v1**: mỗi bản cài đặt (một máy chủ) phục vụ đúng một `tenant` — tenant nạp runtime qua `apps/web/public/config.json` (`docs/DECISIONS.md` #020). Nhiều chi nhánh = nhiều bản cài đặt độc lập.

### 0.2. Ranh giới thật không phải "on-premise vs cloud" mà là **single-tenant vs multi-tenant**

Thuật ngữ "on-premise" chỉ *vị trí vật lý của máy chủ*, nhưng thứ quyết định cách viết code là câu hỏi khác: **một tiến trình API phục vụ 1 tenant hay nhiều tenant?**

| | Máy chủ tại phòng khám | NAS nội bộ | VPS khách thuê | **SaaS thật** |
|---|---|---|---|---|
| Số tenant / tiến trình | 1 | 1 | 1 | **Nhiều** |
| Ai kiểm soát máy chủ | Khách | Khách | Khách (root) | **Nhà cung cấp** |
| Cưỡng chế license bằng kỹ thuật | Không | Không | Không | **Có** |
| `tenantId` lấy từ đâu | `config.json` | `config.json` | `config.json` | **subdomain/JWT** |
| Rủi ro cache rò xuyên tenant | Không | Không | Không | **CÓ** ⚠️ |
| Bắt buộc internet | Không | Không | **Có** | Có |
| Bắt buộc HTTPS/TLS | Nên có | Nên có | **Bắt buộc** | **Bắt buộc** |

**Ba cột đầu đều là "single-tenant deployment" — giống nhau về mọi mặt ảnh hưởng tới code.** NAS và VPS **không cần thay đổi một dòng code nào** so với máy chủ đặt tại phòng khám, và mọi quyết định đã chốt cho on-prem vẫn đúng nguyên (ví dụ #072: kích hoạt gói chuyên khoa bằng script, không dùng license/DRM — vì khách kiểm soát máy chủ nên không cưỡng chế được, đúng cho cả 3 cột).

**Chỉ cột SaaS mới đổi bản chất**, và đây là nơi tập trung rủi ro nguy hiểm nhất — xem Phần 3 và `docs/product/multi-specialty-analysis.md` mục 5: cache/state không khoá theo `tenantId` là vô hại suốt nhiều năm single-tenant, rồi rò dữ liệu y tế xuyên tenant ngay ngày đầu lên SaaS.

**Lưu ý riêng cho NAS** (Synology/QNAP): cần (1) hỗ trợ Docker — Container Manager/Container Station, (2) RAM ≥ 4 GB, (3) RAID **không phải** backup, vẫn phải có `pg_dump` ra ổ ngoài theo ADM-04. Image `postgres:18` và Node 20 đều có bản `arm64` nên **về nguyên tắc** chạy được trên NAS CPU ARM, nhưng **dự án chưa từng kiểm chứng thật trên NAS** — phải chạy thử trên đúng model trước khi cam kết với khách.

**Lưu ý riêng cho VPS**: khác biệt so với máy tại chỗ nằm ở vận hành, không ở code — bắt buộc TLS (dữ liệu y tế đi qua internet công cộng), và chi phí vận hành tăng **tuyến tính theo số khách** nếu bạn quản lý nhiều VPS (khác SaaS chỉ một hệ thống). Ai chịu trách nhiệm vận hành/sao lưu VPS là đúng câu hỏi **Q4** đang treo trong PRD.

### 0.3. Cấu hình nào phải chạy lại sau khi restart máy chủ?

| Loại cấu hình | Ví dụ | Sau khi tắt/bật lại server |
|---|---|---|
| **Dữ liệu trong DB** | `tenant.enabled_specialties` (gói chuyên khoa, #072), `tenant_setting`, danh mục, tài khoản | **Còn nguyên** — chạy script MỘT lần lúc khởi tạo là xong |
| **Biến môi trường** | `.env`: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `STORAGE_DIR` | **Còn** (file nằm trên đĩa), chỉ được đọc lại lúc khởi động |
| **State trong RAM tiến trình** | — | **Mất** — nên `.claude/docs/project-structure.md` **cấm** giữ state kiểu này |

Dữ liệu DB bền vững nhờ named volume (`postgres_data` trong `docker-compose.yml`), nằm ngoài vòng đời container — container bị xoá/tạo lại vẫn giữ nguyên dữ liệu.

**Hai trường hợp DUY NHẤT phải chạy lại script khởi tạo** (ví dụ script bật gói chuyên khoa):
1. Khôi phục DB từ bản sao lưu **cũ hơn** thời điểm chạy script.
2. Volume bị xoá — `docker compose down -v` (cờ `-v` xoá volume) hoặc xoá thủ công.

Phân biệt với `syncRolePermissionsForAllTenants()` (`apps/api/src/main.ts`) — hàm này **cố ý chạy mỗi lần khởi động** vì idempotent, tự vá `role_permission` còn thiếu cho tenant cũ khi có permission mới. Script kích hoạt gói chuyên khoa thì **không** đưa vào bootstrap: "khách này mua gói nào" là quyết định thương mại theo hợp đồng, hệ thống không tự suy ra được.

---

## Phần 1 — Môi trường hiện có (dev/thử nghiệm, chưa phải deploy)

Xem `docs/demo.md` cho hướng dẫn đầy đủ (`pnpm install` → `docker compose up -d` → `pnpm db:migrate` → `pnpm dev`). `docker-compose.yml` ở gốc repo **chỉ chạy PostgreSQL cho dev local** — không có service `api`/`web`/`nginx`/`backup`, không dùng được cho triển khai thật dù ở on-prem hay cloud.

---

## Phần 2 — On-premise (mục tiêu triển khai chính thức của v1)

### 2.0. Hai trường hợp phần cứng — CÙNG một `docker-compose.yml`

Theo Phần 0.2: "on-prem" gồm 3 kiểu máy chủ vật lý khác nhau nhưng **giống nhau về code/hạ tầng** (đều single-tenant). Ở mức triển khai thực tế, dự án hỗ trợ tường minh 2 trường hợp:

| | **PC thường tại phòng khám** (chưa có server nội bộ) | **NAS/máy chủ chuyên dụng** |
|---|---|---|
| Hệ điều hành | Windows + Docker Desktop (WSL2 backend) | Linux (Container Manager Synology, Container Station QNAP, hoặc Docker Engine thuần) |
| Script cài đặt | `deploy/on-prem/install.ps1` | `deploy/on-prem/install.sh` |
| `docker-compose.yml`/Dockerfile | **Y hệt nhau** — không có bản riêng cho từng trường hợp | |
| Tự chạy lại sau khi máy khởi động lại | Cần Docker Desktop tự khởi động — xem 2.4 (có đánh đổi bảo mật, KHÔNG tự động hoá bằng script) | Tự động hoàn toàn (Docker chạy như dịch vụ hệ thống) |

Chọn theo phần cứng khách hàng thật đang có — không phải chọn kiến trúc code khác nhau.

### 2.1. Kiến trúc — 5 service

`deploy/on-prem/docker-compose.yml`:

| Service | Vai trò | Ảnh |
|---|---|---|
| `postgres` | PostgreSQL 18, dữ liệu duy nhất tại chỗ (named volume `postgres_data`) | `postgres:18` |
| `migrate` | Chạy MỘT LẦN mỗi lúc `docker compose up` rồi thoát: `prisma migrate deploy` → đổi mật khẩu role `nexamed_app` → seed danh mục toàn cục. Idempotent — an toàn khi máy khởi động lại chạy lại từ đầu | build từ `apps/api/Dockerfile` |
| `api` | NestJS, healthcheck `GET /health` | build từ `apps/api/Dockerfile` (dùng chung ảnh với `migrate`, khác `command:`) |
| `web` | Build tĩnh `apps/web`, phục vụ qua nginx + reverse-proxy `/api/*` sang `api` (cùng origin, không cần CORS/mở thêm cổng) | build từ `apps/web/Dockerfile` |
| `backup` | `pg_dump -Fc` hằng ngày (giờ cấu hình được) ra thư mục ngoài container, tự dọn bản quá hạn giữ | build từ `deploy/on-prem/backup/Dockerfile` |

Máy chủ đặt tại phòng khám, **không giả định có internet ổn định** sau lúc build ảnh xong — build ảnh lần đầu CẦN internet (tải gói qua `apt`/`pnpm`), chạy hằng ngày thì không.

`api`/`migrate` dùng CHUNG một Dockerfile (không tách ảnh riêng) — cố ý, để không phải build/đồng bộ 2 ảnh mỗi lần đổi code.

### 2.2. Bí mật & mật khẩu — luồng thật

1. Migration tạo role `nexamed_app` với mật khẩu HARD-CODE (`docs/DECISIONS.md` #010) — chỉ dùng được cho dev.
2. `migrate` chạy `pnpm run db:rotate-app-password` (`apps/api/scripts/rotate-app-role-password.ts`) ngay sau `db:deploy` — đổi mật khẩu role đó sang giá trị ngẫu nhiên mạnh đọc từ `NEXAMED_APP_DB_PASSWORD` trong `.env`.
3. `install.ps1`/`install.sh` tự sinh `POSTGRES_PASSWORD`/`NEXAMED_APP_DB_PASSWORD`/`JWT_SECRET`/`ENCRYPTION_KEY` (hex ngẫu nhiên mạnh, `RandomNumberGenerator`/`openssl rand`) vào `.env` nếu file đó chưa tồn tại — không cần tự nghĩ/gõ tay.
4. Tạo phòng khám (tenant) + tài khoản quản trị đầu tiên: `apps/api/scripts/seed-pilot-tenant.ts` (`db:seed:pilot-tenant`) — script sản xuất, KHÁC `seed-dev-tenant.ts` (chỉ dev, tên/mật khẩu hard-code). Không truyền `ADMIN_PASSWORD` thì tự sinh mật khẩu mạnh, in ra ĐÚNG MỘT LẦN, bắt đổi ngay lần đăng nhập đầu (`mustChangePassword`, đã có từ #063).

`.env`/`config.json` (2 file thật, không commit — xem `.gitignore`) nằm cạnh `docker-compose.yml` tại `deploy/on-prem/`.

### 2.3. Cách chạy

**PC Windows** (chưa có server nội bộ — ưu tiên trường hợp này trước, theo yêu cầu triển khai thật đầu tiên):
```powershell
cd deploy\on-prem
.\install.ps1
```
Script hỏi: IP LAN (hoặc Enter để chỉ dùng `http://localhost` ngay trên máy đó), rồi Tên phòng khám/Tên đăng nhập/Họ tên quản trị viên đầu tiên. Chạy lại an toàn (`-SkipTenantCreation` nếu chỉ muốn khởi động lại stack, không tạo thêm tenant).

**Linux/NAS**:
```bash
cd deploy/on-prem
./install.sh
```
Tương đương, dùng `read`/tham số dòng lệnh (`--tenant-name`, `--admin-username`...) thay vì `-Param`.

**Chạy tay (không qua script cài đặt)** — copy `.env.example`→`.env`, `config.example.json`→`config.json`, tự điền giá trị, rồi:
```bash
docker compose build
docker compose up -d
docker compose run --rm -e TENANT_NAME="..." -e ADMIN_USERNAME="..." -e ADMIN_FULL_NAME="..." migrate pnpm run db:seed:pilot-tenant
```

### 2.4. PC không có server nội bộ — tự chạy lại sau khi khởi động lại, không cần nhân viên thao tác

Container đều đặt `restart: unless-stopped` — MỘT KHI Docker Desktop đã chạy, cả stack tự khởi động lại theo đúng thứ tự (`depends_on`/`condition: service_healthy`), không cần bấm gì. Vấn đề còn lại CHỈ là: **làm sao Docker Desktop tự chạy sau khi PC khởi động lại**, vì Docker Desktop (khác Docker Engine trên Linux) thường cần một phiên đăng nhập Windows đang mở mới tự khởi động được.

- **Bước an toàn, nên làm luôn**: Docker Desktop → Settings → General → bật "Start Docker Desktop when you sign in". `install.ps1` nhắc bước này ở cuối, KHÔNG tự động sửa file cấu hình nội bộ của Docker Desktop (khác phiên bản lưu khác chỗ, tự sửa dễ hỏng).
- **Muốn PC tự đăng nhập Windows sau khi mất điện/khởi động lại (không cần nhân viên gõ mật khẩu Windows)**: dùng tính năng đăng nhập tự động của Windows (tài khoản Windows cục bộ riêng, không phải tài khoản Microsoft — cấu hình qua `netplwiz` hoặc registry `AutoAdminLogon`). **Đánh đổi bảo mật thật**: ai bật được nguồn điện/khởi động lại PC đó sẽ vào thẳng được màn hình đã đăng nhập Windows (không phải đăng nhập NEXAMed — ứng dụng vẫn yêu cầu JWT như bình thường, nhưng PC mất lớp bảo vệ đăng nhập Windows). **KHÔNG script hoá bước này** — nếu phòng khám chấp nhận đánh đổi, cấu hình thủ công + xác nhận rõ với chủ phòng khám trước khi bật, ưu tiên: (a) đặt PC ở khu vực có kiểm soát ra vào, (b) dùng tài khoản Windows cục bộ RIÊNG chỉ để chạy Docker Desktop (không phải tài khoản làm việc hằng ngày của nhân viên), (c) vẫn khoá màn hình bằng mật khẩu Windows sau khi không dùng máy dù đã auto-login lúc khởi động.

### 2.5. Còn treo — chưa làm ở phiên S4-05 này (thuộc S6-01/S6-02/S6-03/S6-04/S6-07)

- Sao lưu **tự động theo LỊCH thật + cảnh báo khi thất bại** — `deploy/on-prem/backup/` mới có lịch cố định hằng ngày + log thất bại ra `docker logs`, CHƯA có cơ chế cảnh báo chủ động (email/SMS) khi backup lỗi liên tục.
- **Diễn tập phục hồi thật** (xoá sạch DB thử nghiệm, khôi phục từ bản `pg_dump`, đo thời gian) — chưa làm, làm trước khi pilot ngừng dùng sổ giấy (điều kiện GA).
- Rà soát bảo mật theo checklist `.claude/docs/security-audit.md` đầy đủ (S6-03) — S4-05 chỉ đảm bảo các ràng buộc đã chốt từ trước (không superuser cho role app, không log PII...) không bị phá vỡ lúc đóng gói, chưa phải audit toàn diện.
- Đo hiệu năng p95 API trên cấu hình máy chủ pilot THẬT (S6-04) — trước đó chỉ đo trên máy dev.
- Tài liệu vận hành đầy đủ (S6-07: xử lý sự cố thường gặp cho người không rành IT) — tài liệu này (Phần 2) mới đủ cho người cài đặt kỹ thuật; `docs/pilot-onboarding.md` (S4-06) là tài liệu cho NHÂN VIÊN phòng khám (không phải người cài đặt).

### Ràng buộc bắt buộc khi viết script/cấu hình on-prem (đã chốt, không tự đổi)

- Toàn bộ cấu hình đọc từ biến môi trường, validate bằng Zod ở `apps/api/src/config` — không đọc `process.env` rải rác, không hard-code đường dẫn tuyệt đối/tên máy chủ/giá trị riêng của một phòng khám.
- Giá trị riêng theo từng phòng khám (giờ làm việc, độ dài slot, mẫu in...) nằm ở bảng `tenant_setting`, không hard-code trong code hay compose file.
- Backup ghi ra thư mục cấu hình được (`BACKUP_HOST_DIR` trong `.env`, nên trỏ ổ đĩa khác ổ chứa `postgres_data`), không dùng dịch vụ cloud lưu trữ ở v1.
- Không cấp `BYPASSRLS`/superuser cho role mà API runtime dùng (đã áp dụng từ S1-03, xem `docs/DECISIONS.md` #010 — giữ nguyên khi đóng gói on-prem, `migrate` chỉ dùng role đặc quyền `nexamed` cho ĐÚNG các bước cần, không phải role runtime).

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
