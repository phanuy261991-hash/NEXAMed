# Deploy — Triển khai NEXAMed (On-premise & Cloud)

## Đọc trước khi làm theo bất kỳ mục nào dưới đây

NEXAMed v1 triển khai **on-premise duy nhất**, tại từng phòng khám (`docs/product/prd.md`, `CLAUDE.md`). Cloud **không phải mục tiêu triển khai của v1** — kiến trúc port/adapter đảm bảo không phải làm lại nền tảng khi cần chuyển sang cloud sau này, nhưng hiện **chưa có** nhà cung cấp, mô hình, hay quy trình cloud nào được chốt.

**S4-05 (đóng gói on-premise) đã xong** (2026-09-01, sửa lại mô hình phân phối ở `docs/DECISIONS.md` #098) — `deploy/on-prem/` có đủ `docker-compose.yml` (tham chiếu ảnh `image:`, không tự build), Dockerfile cho `api`/`web`/`backup`, script build+export `build-and-export.ps1` (chạy ở máy dev/CI), trình cài đặt/nâng cấp `nexamed-setup` (`.cmd`/`.ps1`/`.sh`, chạy ở máy khách, chỉ nạp ảnh; thay `install.*` cũ từ 15/10/2026). Tài liệu này gồm hai phần: (1) cách chạy môi trường hiện có cho dev/thử nghiệm (xem `docs/demo.md`, khác hẳn Phần 2 dưới đây), và (2) hướng dẫn triển khai on-premise thật + kiến trúc cho khả năng lên cloud sau này.

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

> **Cập nhật 13/10/2026 (`docs/DECISIONS.md` #231) — Đợt 1 của hướng này ĐÃ CODE**: bảng `branch`/`user_branch`, `branch_id` ở phòng/tầng/bàn khám/lịch hẹn/lượt khám/ca đã xếp/đơn nghỉ/đăng ký ca/đổi ca, đăng nhập chọn chi nhánh, trang "Chi nhánh". Điều chỉnh so với bảng dưới: **không thêm scope `branch`** (chi nhánh là lớp lọc riêng, xem `security-audit.md`) và `department` dùng CHUNG cả công ty (chỉ `room` thuộc chi nhánh). **Chưa bật chi nhánh thứ 2 ở khách thật** tới hết Đợt 2 (hoá đơn, quỹ, ca thu ngân, kho). Nâng cấp môi trường: `db:deploy` + `db:seed` rồi khởi động lại API (seed nạp quyền `branch.*` — thiếu bước này menu "Chi nhánh" không hiện).

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

**Lưu ý riêng cho NAS** (Synology/QNAP): cần (1) hỗ trợ Docker — Container Manager/Container Station, (2) RAM ≥ 4 GB, (3) RAID **không phải** backup, vẫn phải có `pg_dump` ra ổ ngoài theo ADM-04. Image `postgres:18` và Node 26 đều có bản `arm64` nên **về nguyên tắc** chạy được trên NAS CPU ARM, nhưng **dự án chưa từng kiểm chứng thật trên NAS** — phải chạy thử trên đúng model trước khi cam kết với khách.

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
| Lệnh cài đặt/nâng cấp | `deploy/on-prem/nexamed-setup.cmd` | `deploy/on-prem/nexamed-setup.sh` |
| `docker-compose.yml`/Dockerfile | **Y hệt nhau** — không có bản riêng cho từng trường hợp | |
| Tự chạy lại sau khi máy khởi động lại | Cần Docker Desktop tự khởi động — xem 2.4 (có đánh đổi bảo mật, KHÔNG tự động hoá bằng script) | Tự động hoàn toàn (Docker chạy như dịch vụ hệ thống) |

Chọn theo phần cứng khách hàng thật đang có — không phải chọn kiến trúc code khác nhau.

### 2.0b. Trình cài đặt/nâng cấp (từ 15/10/2026, `docs/DECISIONS.md` #238)

Cách cài và nâng cấp DUY NHẤT (đã thay `install.ps1/.cmd/.sh` cũ — chi tiết từng bước ở mục 2.3 và 2.3b): giải nén gói vào một thư mục, rồi chạy **`nexamed-setup.cmd`** (Windows, double-click) hoặc **`./nexamed-setup.sh`** (Linux/NAS/VPS). Lệnh kiểm tra Docker, nạp ảnh `nexamed-setup`, bật trang hướng dẫn: Windows tự mở trình duyệt ở `http://localhost:8090`; Linux in link kèm mã dùng một lần (`http://<IP>:8090/?key=...`), hoặc `--tunnel` để chỉ mở trên máy và vào bằng đường hầm SSH (`ssh -L 8090:localhost:8090 <tài-khoản>@<IP>`). Trong trang: kiểm tra máy → chọn kiểu (tại phòng khám / VPS HTTPS / SaaS) → thông tin → sao lưu → xem lại → cài → trang kết quả (mật khẩu tạm hiện một lần, tick "đã lưu", tải file .txt bàn giao). **Nâng cấp** = giải nén gói mới ĐÈ lên thư mục cũ (giữ `.env`, `config.json`) rồi chạy lại lệnh trên: trang tự nhận ra hệ thống đang chạy, sao lưu vào `upgrade-backups/`, nâng cấp, kiểm tra, tự quay lui nếu lỗi; sau nâng cấp có nút "Quay lui về bản cũ". Lưu ý: IP máy đổi không làm ứng dụng hỏng (`config.json.apiBaseUrl` để trống) nhưng nhân viên phải mở địa chỉ mới — nên đặt IP tĩnh trên máy (trang có hướng dẫn). Kiểu VPS cần tên miền đã trỏ về máy và cổng 80/443 mở; kiểu SaaS cần file chứng chỉ wildcard (.crt/.key). **Chưa kiểm chứng**: Let's Encrypt thật, Linux/NAS, máy Windows sạch.

### 2.1. Kiến trúc — 5 service

`deploy/on-prem/docker-compose.yml`:

| Service | Vai trò | Ảnh |
|---|---|---|
| `postgres` | PostgreSQL 18, dữ liệu duy nhất tại chỗ (named volume `postgres_data`) | `postgres:18` |
| `migrate` | Chạy MỘT LẦN mỗi lúc `docker compose up` rồi thoát: `prisma migrate deploy` → đổi mật khẩu role `nexamed_app` → seed danh mục toàn cục. Idempotent — an toàn khi máy khởi động lại chạy lại từ đầu | `nexamed-api:${NEXAMED_VERSION}` — build sẵn ở máy dev/CI từ `apps/api/Dockerfile`, nạp bằng `docker load` (xem 2.1b) |
| `api` | NestJS, healthcheck `GET /health` | `nexamed-api:${NEXAMED_VERSION}` (dùng chung ảnh với `migrate`, khác `command:`) |
| `web` | Build tĩnh `apps/web`, phục vụ qua nginx + reverse-proxy `/api/*` sang `api` (cùng origin, không cần CORS/mở thêm cổng) | `nexamed-web:${NEXAMED_VERSION}` — build sẵn ở máy dev/CI từ `apps/web/Dockerfile` |
| `backup` | `pg_dump -Fc` hằng ngày (giờ cấu hình được) ra thư mục ngoài container, tự dọn bản quá hạn giữ; **kèm đồng bộ thư mục ảnh đính kèm** (volume `api_storage`, gắn chỉ-đọc) sang `<BACKUP_HOST_DIR>/storage` | `nexamed-backup:${NEXAMED_VERSION}` — build sẵn ở máy dev/CI từ `deploy/on-prem/backup/Dockerfile` |

Máy chủ đặt tại phòng khám **KHÔNG BAO GIỜ cần internet, kể cả lần cài đầu tiên** — ảnh đã build sẵn ở máy khác, máy khách chỉ `docker load` (xem 2.1b). Đây cũng là cách duy nhất đảm bảo máy khách không bao giờ nhận được mã nguồn (`.ts`/`.git`/`docs` nội bộ) — chỉ nhận ảnh Docker đã build.

`api`/`migrate` dùng CHUNG một Dockerfile lúc build → CHUNG một ảnh `nexamed-api` lúc chạy (không tách ảnh riêng) — cố ý, để không phải build/đồng bộ 2 ảnh mỗi lần đổi code.

**S6-06 (ADM-05, xuất bệnh án PDF)** — ảnh `nexamed-api` nay cài thêm `chromium` qua apt (Debian bookworm) để `puppeteer-core` render HTML→PDF (không dùng `puppeteer` đầy đủ tự tải Chromium bundled, tránh phụ thuộc mạng lúc build — xem `docs/DECISIONS.md`). `docker-compose.yml` đặt sẵn `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` cho service `api` — người cài đặt không cần cấu hình gì thêm.

### 2.1b. Hai giai đoạn — build ở máy dev/CI, chỉ nạp ảnh ở máy khách (`docs/DECISIONS.md` #098, #238)

Mã nguồn `.ts`, lịch sử `.git`, và tài liệu nội bộ là tài sản trí tuệ, **tuyệt đối không được lộ cho máy khách**. Vì vậy triển khai on-prem đi qua đúng 2 giai đoạn tách biệt:

- **Giai đoạn A — Build & export** (máy dev/CI, có source đầy đủ): `deploy/on-prem/build-and-export.ps1` dựng 4 ảnh (`nexamed-api`, `nexamed-web`, `nexamed-backup`, `nexamed-setup`), lưu thêm ảnh bên thứ ba (`postgres:18`, `caddy:2.8-alpine`) để cài không cần Internet, nén tất cả thành `.tar.gz`, rồi **gom sẵn mọi file cần thiết vào 1 thư mục duy nhất** (`-PackageDir`) — không phải tự nhặt file nào. KHÔNG chạy bước này ở máy khách.
- **Giai đoạn B — Cài đặt tại máy khách**: chép NGUYÊN thư mục gói sang, chạy `nexamed-setup` (trình cài đặt dạng trang web) — nó tự `docker load` các ảnh rồi `docker compose up -d`. Máy khách **không có** bất kỳ file `.ts`/`.git`/`docs` nào trên đĩa. Cùng một lệnh dùng cho cài mới và nâng cấp — xem mục 2.3 và 2.3b.

### 2.2. Bí mật & mật khẩu — luồng thật

1. Migration tạo role `nexamed_app` với mật khẩu HARD-CODE (`docs/DECISIONS.md` #010) — chỉ dùng được cho dev.
2. `migrate` chạy `pnpm run db:rotate-app-password` (`apps/api/scripts/rotate-app-role-password.ts`) ngay sau `db:deploy` — đổi mật khẩu role đó sang giá trị ngẫu nhiên mạnh đọc từ `NEXAMED_APP_DB_PASSWORD` trong `.env`.
3. Trình cài đặt `nexamed-setup` tự sinh `POSTGRES_PASSWORD`/`NEXAMED_APP_DB_PASSWORD`/`JWT_SECRET`/`ENCRYPTION_KEY` (hex ngẫu nhiên mạnh, `crypto.randomBytes`) vào `.env` nếu file đó chưa tồn tại; các lần chạy sau giữ nguyên (mất khoá mã hoá là mất dữ liệu đã mã hoá) — không cần tự nghĩ/gõ tay.
4. Tạo phòng khám (tenant) + tài khoản quản trị đầu tiên: `apps/api/scripts/seed-pilot-tenant.ts` (`db:seed:pilot-tenant`) — script sản xuất, KHÁC `seed-dev-tenant.ts` (chỉ dev, tên/mật khẩu hard-code). Trình cài đặt sinh mật khẩu tạm (dạng `XXXX-XXXX-XXXX`) và truyền qua biến môi trường `ADMIN_PASSWORD` (không nằm trên dòng lệnh); script in thêm một dòng `NEXAMED_RESULT {json}` cho máy đọc. Mật khẩu hiện ĐÚNG MỘT LẦN ở trang kết quả, bắt đổi ngay lần đăng nhập đầu (`mustChangePassword`, đã có từ #063).

`.env`/`config.json` (2 file thật, không commit — xem `.gitignore`) nằm cạnh `docker-compose.yml` tại `deploy/on-prem/`.

Biến tuỳ chọn (không có trong `.env` mới cài, thêm khi cần): `LOGIN_IP_LIMIT_PER_MINUTE` — trần đăng nhập theo IP mỗi phút (mặc định 60 bản một công ty, 30 SaaS; xem 2.3e). Nâng cấp lên bản có khoá chống ghi trùng và khoá đăng nhập thông minh chạy thêm 2 migration (`20261023100000`, `20261023110000`) tự động qua service `migrate` — không cần thao tác tay.

### 2.3. Cách chạy — hướng dẫn từng bước (cách duy nhất, từ 15/10/2026, `docs/DECISIONS.md` #238)

`install.ps1`/`install.cmd`/`install.sh` cũ đã BỎ — mọi cài đặt và nâng cấp đi qua trình cài đặt `nexamed-setup`. Đã kiểm chứng thật bằng Docker và Chrome: cài kiểu "Tại phòng khám" (Windows và từ container Linux), cài kiểu SaaS, nâng cấp, quay lui, tự quay lui khi nâng cấp lỗi. **Đã kiểm chứng thêm**: nâng cấp một hệ thống cài bằng script `install.*` CŨ (mục 2.3b) và lệnh đặt lại mật khẩu quản trị trên ảnh Docker thật. **Chưa kiểm chứng**: xin chứng chỉ Let's Encrypt thật (kiểu VPS), máy Linux/NAS thật, máy Windows sạch.

#### PHẦN 1 — Trên máy DEV (đóng gói)

Cần: Docker Desktop đang chạy, Git, PowerShell, Internet (lần đầu, để tải `postgres:18` và `caddy`), khoảng 10 GB trống, 10 đến 20 phút.

**Bước 1. Chốt phiên bản** (bản giao khách; dựng thử thì bỏ bước này và thêm `-AllowUnreleased` ở bước 2). Xem mục 2.3a:
```powershell
node scripts/release.mjs 0.9.0
```

**Bước 2. Dựng gói.** Chạy trong PowerShell hoặc Command Prompt của Windows (KHÔNG chạy trong Git Bash), từ thư mục `deploy\on-prem`, và luôn ghi rõ `-PackageDir`:
```powershell
cd C:\Projects\NEXAMed\deploy\on-prem
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-and-export.ps1 -Version 0.9.0 -PackageDir C:\NEXAMed-package
```
Bản giao khách bị từ chối nếu `-Version` khác `package.json`, chưa có tag `v0.9.0`, HEAD không phải commit của tag, hoặc cây git chưa sạch. Dựng thử: thêm `-AllowUnreleased` và dùng số bất kỳ (ví dụ `0.9.1-beta.1`). Đặt `-PackageDir` ngoài repo.

Kết quả: thư mục gói gồm `images/` (6 file `.tar.gz`: api, web, backup, setup, postgres, caddy), `docker-compose.yml`, `.env.example`, `config.example.json`, `nexamed-setup.cmd`, `nexamed-setup.ps1`, `nexamed-setup.sh`. Không có source code.

**Bước 3.** Nén thư mục gói thành `.zip` (chuột phải, Send to, Compressed folder) và chép sang máy khách (USB hoặc mạng nội bộ).

#### PHẦN 2 — Trên máy KHÁCH, Windows (cài lần đầu)

**Bước 1.** Cài **Docker Desktop** (docker.com), mở lên và đợi biểu tượng chạy ổn định. Máy chưa có Docker thì lệnh ở bước 3 in hướng dẫn cài rồi dừng.

**Bước 2.** Giải nén `.zip` vào một thư mục CỐ ĐỊNH (ví dụ `C:\NEXAMed`), KHÔNG xoá thư mục này sau khi cài — `.env` (khoá hệ thống) và `config.json` nằm trong đó. Lưu ý Windows có thể tạo thêm một thư mục con trùng tên: gõ `dir` kiểm tra thấy `nexamed-setup.cmd` ngay trong thư mục đang đứng, nếu không thì `cd` vào thư mục con.

**Bước 3.** Double-click **`nexamed-setup.cmd`**. Lệnh kiểm tra Docker, nạp ảnh trình cài đặt và tự mở trình duyệt ở `http://localhost:8090`. Giữ cửa sổ lệnh mở trong lúc cài.

**Bước 4.** Làm theo trang: kiểm tra máy → chọn kiểu triển khai ("Tại phòng khám") → điền tên phòng khám, quản trị viên, địa chỉ truy cập → chọn thư mục sao lưu và giờ chạy → xem lại → Cài đặt.

**Bước 5.** Trang kết quả hiện địa chỉ, tên đăng nhập và **mật khẩu tạm (chỉ hiện một lần)**. Tải file bàn giao `.txt`, tick "đã lưu", bấm Hoàn tất (trình cài đặt tự đóng). Người dùng bị bắt đổi mật khẩu ở lần đăng nhập đầu.

**Bước 6.** Docker Desktop, Settings, General, bật "Start Docker Desktop when you sign in" để hệ thống tự chạy lại khi máy khởi động lại (xem mục 2.4).

#### PHẦN 3 — Linux / NAS / VPS

Giải nén gói, rồi chạy `chmod +x nexamed-setup.sh && ./nexamed-setup.sh`. Lệnh in link dạng `http://<IP>:8090/?key=<mã>` (cổng chỉ mở tạm, cần mã, tự đóng khi cài xong); mở link đó bằng trình duyệt trên máy tính của bạn rồi làm như Phần 2. Không muốn mở cổng ra ngoài: `./nexamed-setup.sh --tunnel`, rồi từ máy tính chạy `ssh -L 8090:localhost:8090 <tài-khoản>@<IP>` và vào `http://localhost:8090`. Tuỳ chọn: `--version <phiên bản>`, `--port <cổng>`.
- **Kiểu "VPS"** cần tên miền đã trỏ về máy (bản ghi A) và cổng 80, 443 mở từ Internet; Caddy tự xin và gia hạn chứng chỉ HTTPS.
- **Kiểu "SaaS"** cần file chứng chỉ wildcard `.crt` và `.key` (bao `*.tên-miền` và `tên-miền`), tải lên ngay trong trang; sau khi cài có bước kích hoạt OTP cho người vận hành.

#### Quên mật khẩu quản trị (không còn ai đăng nhập được)

Làm trên chính máy chủ, trong THƯ MỤC CÀI ĐẶT (nơi có `docker-compose.yml` và `.env`), khi hệ thống đang chạy. Mở Command Prompt/PowerShell (Windows) hoặc terminal (Linux/NAS) tại thư mục đó rồi chạy:

```
docker compose run --rm -e ADMIN_USERNAME=quantri migrate pnpm run db:reset-admin-password
```

- Thay `quantri` bằng tên đăng nhập cần đặt lại (đúng chữ hoa/thường).
- Lệnh in ra mật khẩu tạm dạng `XXXX-XXXX-XXXX` — **chỉ hiện một lần**, chép ngay. Đăng nhập bằng mật khẩu đó, hệ thống bắt đổi mật khẩu mới ngay lần đầu.
- Muốn tự đặt mật khẩu: thêm `-e NEW_PASSWORD=<mật-khẩu-từ-12-ký-tự>` trước chữ `migrate` (mật khẩu hiện trong lịch sử lệnh; vẫn bị bắt đổi ở lần đăng nhập đầu).
- Hệ thống có nhiều công ty (SaaS): thêm `-e TENANT_ID=<mã công ty>` (lệnh báo lỗi và liệt kê mã nếu thiếu).
- Lệnh còn xoá khoá tạm do nhập sai nhiều lần, **đăng xuất mọi phiên đang mở** của tài khoản đó, và ghi vào nhật ký hoạt động (không có người thực hiện, vì làm tại máy chủ). Chỉ chạm đúng một tài khoản của một công ty.
- Lỗi thường gặp: "Không có tài khoản ..." (sai tên đăng nhập); "đang bị vô hiệu hoá" (tài khoản đã bị tắt, cần quản trị viên khác bật lại, hoặc đặt lại cho tài khoản quản trị còn hoạt động).
- An ninh: ai ngồi được tại máy chủ và chạy được Docker thì đặt lại được mật khẩu — đây là lý do máy chủ phải đặt nơi an toàn và hạn chế người có tài khoản quản trị hệ điều hành.

#### Xử lý sự cố thường gặp

- **Cổng 80 bị chiếm** (rất phổ biến trên Windows, ví dụ IIS): bước "Kiểm tra máy" báo vàng và tự đề xuất cổng 8080; nhân viên gõ thêm `:8080` sau địa chỉ.
- **Mở lại `nexamed-setup` thấy "Hệ thống đã là bản mới nhất" nhưng lần cài trước bị lỗi giữa chừng (chưa tạo phòng khám, giao diện chưa chạy):** bản trình cài đặt trước 24/10/2026 coi `.env` là dấu hiệu "đã cài". Dùng bản mới (nhận ra lần cài dở, hiện khung "Lần cài trước chưa xong" và cho nhập lại thông tin để cài tiếp, khoá bí mật được giữ) — `docs/DECISIONS.md` #261.
- **`nexamed-setup.cmd` chạy nhưng trình duyệt không tự mở:** trang cài đặt vẫn chạy — mở tay `http://127.0.0.1:8090` (cổng đã đổi bằng `-Port` thì dùng cổng đó). Nguyên nhân ở bản trước 24/10/2026: script chờ trang bằng `localhost` nên PowerShell 5.1 thử IPv6 trước và hết thời hạn (`docs/DECISIONS.md` #261).
- **Cài báo lỗi "Cổng web … đang bị chương trình khác trên máy dùng"** (hoặc lỗi Docker `ports are not available … bind: Only one usage of each socket address`): có chương trình khác (thường Apache/XAMPP `httpd` trên 8080, IIS trên 80) đang giữ cổng web đã chọn. Trên trang cài đặt bấm **Sửa thông tin**, đổi sang cổng trống (ví dụ 8081), rồi cài lại — khoá bí mật đã sinh được giữ nguyên. Tìm chương trình đang chiếm: `netstat -ano | findstr :8080` rồi tra PID trong Task Manager. Bản trình cài đặt trước 24/10/2026 có lỗi bỏ qua cổng mới sau khi lỗi (`docs/DECISIONS.md` #261): với bản cũ phải đóng cửa sổ `nexamed-setup.cmd` rồi chạy lại để có phiên mới.
- **Router không giữ được IP cố định cho máy:** ứng dụng vẫn chạy khi IP đổi (`config.json.apiBaseUrl` để trống), nhưng nhân viên phải mở địa chỉ IP mới. Nên đặt IP tĩnh trên máy; bước "Thông tin" có mục "Xem hướng dẫn" (tìm dải DHCP của router, chọn IP ngoài dải, đặt trong Windows).
- **Cài lỗi giữa chừng:** trang hiện bước lỗi kèm nguyên nhân; sửa nguyên nhân rồi bấm **Thử lại** (tiếp tục từ bước lỗi, không làm lại bước đã xong, không sinh lại khoá hệ thống). Lỗi "phòng khám đã được tạo ở lần cài trước" nghĩa là lần cài trước đã chạy tới bước tạo phòng khám; muốn cài lại từ đầu phải xoá dữ liệu cũ (`docker compose down -v` trong thư mục cài đặt) rồi chạy lại.
- **Lỡ đóng trang trước khi lưu mật khẩu tạm, hoặc quản trị viên quên mật khẩu:** mật khẩu cũ không xem lại được nhưng ĐẶT LẠI được, không cần cài lại. Có quản trị viên khác đăng nhập được thì đặt lại ở "Danh mục quản lý tài khoản"; không còn ai đăng nhập được thì dùng lệnh ở mục "Quên mật khẩu quản trị" ngay dưới.
- **`nexamed-setup.cmd` báo chưa có Docker hoặc Docker chưa chạy:** làm theo 3 bước nó in ra (cài Docker Desktop, mở và đợi chạy, chạy lại lệnh).
- **Chạy lại `nexamed-setup` trên thư mục đã cài:** trang tự chuyển sang chế độ nâng cấp (mục 2.3b), KHÔNG cài lại và không đụng dữ liệu.

### 2.3a. Phát hành một phiên bản (SemVer, từ 15/10/2026, `docs/DECISIONS.md` #236)

Số phiên bản người dùng thấy (hộp "Giới thiệu", chân trang đăng nhập) chỉ đổi khi BẠN chủ động phát hành, không đổi theo commit hay lần dựng. Quy trình trên máy dev:

**Yêu cầu máy dựng (máy dev/CI, từ 22/10/2026, `docs/DECISIONS.md` #253):** Node **26.x** (LTS từ 28/10/2026; Node 20 đã hết hỗ trợ bảo mật từ 30/04/2026), pnpm **9.15.9** (`packageManager`), Docker. Ảnh Docker tự mang Node 26 bên trong (API `node:26-bookworm-slim`, trình cài đặt `node:26-alpine`, web chỉ là nginx) nên **máy khách chỉ cần Docker, KHÔNG phải cài Node**. Ảnh Node 26 không còn `corepack` nên các Dockerfile cài pnpm bằng `npm install -g pnpm@9.15.9` (đừng đổi lại `corepack enable`). **Nâng một hệ thống đang chạy ảnh Node 20 lên bản dựng Node 26** làm như một lần cập nhật bình thường (mục 2.3b): dữ liệu, mật khẩu đã băm và dữ liệu mã hoá không đổi; không có bước nào riêng cho Node.

1. **Viết ghi chú phát hành** cho số sắp phát hành: `apps/api/release-notes/<phiên bản>.json` (nhóm `features` / `improvements` / `fixes`, viết cho người dùng cuối, không phải nhật ký kỹ thuật). Commit file này. `build-and-export.ps1` chép mọi file ghi chú vào thư mục `release-notes/` của gói; khi NÂNG CẤP, bước "Bản đang chạy và bản mới" của trình cài đặt hiện "Có gì mới trong bản Y" (ghi chú của bản sắp cài; gói cũ không có thư mục này, hoặc thiếu ghi chú của bản đó, thì không hiện gì và không chặn nâng cấp), còn trang "Cập nhật phần mềm" trong ứng dụng hiện ghi chú của bản đang chạy (`docs/DECISIONS.md` #271).
2. **Chốt phiên bản:** `node scripts/release.mjs <major|minor|patch|beta|X.Y.Z[-beta.N]>` (cần `packages/core` và `packages/shared` đã build; thêm `--dry-run` để chỉ kiểm tra). Script từ chối nếu cây git chưa sạch, số mới không lớn hơn số cũ, đã có tag, hoặc thiếu/ sai ghi chú phát hành. Nó ghi cùng một số vào `package.json` gốc và 4 gói con, tạo commit `chore(release): vX.Y.Z` và tag `vX.Y.Z`. Lần đầu chốt chính số hiện có (chưa có tag) dùng `node scripts/release.mjs 0.9.0` (chỉ tạo tag). Không tự push: kiểm tra rồi `git push origin master --tags`.
3. **Dựng gói:** `deploy/on-prem/build-and-export.ps1 -Version X.Y.Z -PackageDir <thư mục>` — chạy trong PowerShell/Command Prompt (qua `powershell -File` thì `-PackageDir` bắt buộc ghi rõ). Lệnh đầy đủ ở mục 2.3 Phần 1. Script từ chối nếu `-Version` khác `package.json`, HEAD không phải commit của tag `vX.Y.Z`, hoặc cây git chưa sạch (dựng thử không phát hành: `-AllowUnreleased`). Số bản dựng = số commit của nhánh (`git rev-list --count HEAD`), cần clone đầy đủ lịch sử.
4. Giao khách như mục 2.3b. Trong ứng dụng: hộp "Giới thiệu" hiện `X.Y.Z`, kênh (Ổn định/Thử nghiệm), ngày phát hành, ghi chú; thông tin kỹ thuật hiện `X.Y.Z · bản dựng N` và phiên bản cơ sở dữ liệu thật.

Quy ước số: **patch** (`0.9.0 → 0.9.1`) chỉ sửa lỗi; **minor** (`→ 0.10.0`) thêm tính năng không phá vỡ; **major** (`→ 1.0.0`) bản chính thức hoặc thay đổi lớn; **beta** (`0.10.0-beta.1`) kênh thử nghiệm. Hiện `0.9.0`, lên `1.0.0` sau khi qua pilot. Máy dev hiển thị cùng số nhưng kênh "Phát triển" và không có số bản dựng.

**Kiểm tra bản mới trong ứng dụng (bước 2, #236):** đặt `RELEASE_SERVER_URL` trong `.env` (địa chỉ HTTPS của máy chủ phát hành, nơi đặt `manifest.json`) rồi khởi động lại `api`; để trống thì trang "Cập nhật phần mềm" báo chưa cấu hình. Chỉ kiểm tra và hiển thị — chưa tự cập nhật; cập nhật vẫn theo mục 2.3b. Cần `db:seed` một lần để có quyền `software_update.read`.

### 2.3b. Cập nhật bản mới lên hệ thống đang chạy

> **Đã kiểm chứng (15/10/2026, Docker thật + Chrome):** nâng cấp bản cũ lên bản mới bằng trình cài đặt (tự sao lưu `pg_dump` trước, nạp ảnh, đổi `NEXAMED_VERSION`, `compose up -d` để `migrate` áp thay đổi cấu trúc, kiểm tra sức khoẻ); nút "Quay lui về bản cũ" khôi phục đúng dữ liệu; bản mới báo sai phiên bản thì **tự quay lui**. Cũng đã diễn tập nâng cấp trên bản sao DB với gói cũ (`2026.10.14` → `2026.10.15`, dữ liệu nguyên vẹn). **Hệ thống cài bằng `install.ps1/.sh` cũ cũng nâng cấp được** (đã diễn tập 15/10/2026 với bản `2026.10.15` cài bằng script cũ, có tạo phòng khám: trình mới nhận ra qua `.env`, giữ nguyên tên dự án Docker nên nhận đúng dữ liệu cũ, đăng nhập bằng mật khẩu cũ vẫn được sau nâng cấp, nút Quay lui về bản cũ chạy đúng). Để chắc, lần đầu vẫn nên **sao lưu tay trước** (Bước 2 bên dưới). Gói có file `VERSION` ở gốc để trình cài đặt biết đâu là bản mới ngay cả khi file ảnh cũ còn sót trong `images/` (số phiên bản kiểu ngày `2026.10.15` của bản cài cũ lớn hơn SemVer `0.9.0` khi so theo số).

**Trên máy DEV:** dựng gói với số phiên bản MỚI như mục 2.3 Phần 1 (KHÔNG dùng lại số cũ, để không nhầm với bản đang chạy), nén và chép sang máy khách.

**Trên máy KHÁCH:**

**Bước 1.** Giải nén `.zip` mới **vào ĐÚNG thư mục đã cài** (nơi có sẵn `.env`, `config.json`), cho phép ghi đè khi được hỏi. An toàn: gói không chứa `.env`/`config.json` thật (chỉ có `.env.example`/`config.example.json` làm mẫu), nên mật khẩu, khoá hệ thống và `tenantId` hiện tại giữ nguyên.

**Bước 2.** (Khuyên làm trước khi nâng cấp lần đầu, đề phòng) sao lưu tay một bản:
```powershell
docker compose exec postgres pg_dump -U nexamed -d nexamed -Fc -f /tmp/truoc-cap-nhat.dump
docker compose cp postgres:/tmp/truoc-cap-nhat.dump .\truoc-cap-nhat.dump
```

**Bước 3.** Chạy lại `nexamed-setup.cmd` (Windows) hoặc `./nexamed-setup.sh` (Linux/NAS). Trang tự nhận ra hệ thống đang chạy và hiện "Bản đang chạy và bản mới". Bấm **Nâng cấp**.

**Bước 4.** Trang tự làm: sao lưu vào thư mục `upgrade-backups/` (trong thư mục cài đặt) → nạp ảnh mới → áp thay đổi cấu trúc dữ liệu và khởi động lại → kiểm tra sức khoẻ. Nâng cấp mất vài phút, nhân viên không dùng được trong lúc này. Lỗi lúc khởi động bản mới hoặc ở bước kiểm tra sức khoẻ thì hệ thống tự quay về bản cũ và hiện nguyên nhân; sao lưu thất bại hoặc thiếu file ảnh thì dừng ngay, chưa đổi gì.

**Bước 5.** Xong, trang báo "Đã nâng cấp lên bản X". Nếu sau đó phát hiện vấn đề, bấm **Quay lui về bản cũ** ở chính trang này (hoặc chạy lại `nexamed-setup`: màn "Bản đang chạy" vẫn có nút này cho lần nâng cấp gần nhất): khôi phục dữ liệu về lúc trước khi nâng cấp — dữ liệu nhập SAU lần nâng cấp sẽ mất. Cấu hình (`.env`, `config.json`) không đổi.

Quyền hạn mới và danh mục mặc định của bản mới được áp tự động: dịch vụ `migrate` chạy `db:deploy`, đổi mật khẩu role app và `db:seed` mỗi lần `compose up`, nên không cần chạy thêm lệnh nào.

### 2.3c. Sao lưu & khôi phục (backup/restore) — đã diễn tập thật (S6-02, `docs/DECISIONS.md` #099)

#### Cấu hình sao lưu tự động

**Đổi giờ chạy, số ngày giữ, bật/tắt và "Sao lưu ngay" trên giao diện** (docs/DECISIONS.md #217): đăng nhập tài khoản có quyền `system_backup` (mặc định **Quản trị hệ thống** và **Quản lý phòng khám**) → **Quản trị → Cấu hình hệ thống → Sao lưu dữ liệu**.

- **Trạng thái**: lần sao lưu gần nhất thành công/lỗi (kèm lý do) và nút **Sao lưu ngay** (chạy trong vài chục giây, không cần khởi động lại).
- **Cấu hình** (bấm bút chì để sửa, rồi **Lưu**): *Tự động sao lưu hằng ngày* (bật/tắt), *Giờ chạy* theo **giờ Việt Nam** (hệ thống tự quy đổi sang giờ máy chủ), *Số ngày giữ bản sao lưu*. Áp dụng ngay cho lần chạy kế tiếp.
- Mục này **chỉ hiện ở bản cài tại chỗ có dịch vụ `backup`**; máy dev/bản cloud tự ẩn.

Trong `.env` vẫn còn các biến sau, nhưng `BACKUP_HOUR`/`BACKUP_RETENTION_DAYS` **chỉ là giá trị khởi tạo lần đầu** (sau đó giao diện là nguồn đúng, sửa `.env` không còn tác dụng):
```
BACKUP_HOUR=19
BACKUP_RETENTION_DAYS=14
BACKUP_HOST_DIR=./backup-data
```
- `BACKUP_HOUR`: giá trị khởi tạo giờ chạy — **giờ UTC, không phải giờ Việt Nam**. Muốn 2h sáng giờ VN thì đặt `19` (lùi 7 tiếng).
- `BACKUP_RETENTION_DAYS`: giá trị khởi tạo số ngày giữ bản cũ.
- `BACKUP_HOST_DIR`: **quan trọng nhất** và **không đổi được trên giao diện** (giao diện chỉ hiển thị) — mặc định lưu ngay trên ổ đĩa của PC đó, CÙNG ổ với dữ liệu thật. Nếu ổ đĩa hỏng thì mất cả 2. Nên đổi trỏ sang ổ khác/ổ ngoài/máy khác trong mạng nội bộ, ví dụ `D:\NEXAMed-backup` hoặc `\\192.168.1.100\backup-nexamed`. Sửa `.env` xong chạy:
```powershell
docker compose restart backup
```

#### Sao lưu thư mục ảnh (docs/DECISIONS.md #216)

Ảnh đính kèm kết quả cận lâm sàng (siêu âm, X-quang...), ảnh đại diện bệnh nhân và logo phòng khám KHÔNG nằm trong database nên file `.dump` không giữ được chúng. Cùng lịch với sao lưu database, dịch vụ `backup` đồng bộ thư mục ảnh sang `<BACKUP_HOST_DIR>/storage` (cạnh các file `.dump`):

- **Tăng dần, không nén, không đổi ảnh**: chỉ chép file mới (ảnh trong hệ thống không bao giờ bị sửa hay xoá), nên mỗi ngày chỉ tốn thêm đúng dung lượng ảnh mới. Ảnh giữ nguyên bản gốc.
- **Không bị dọn theo `BACKUP_RETENTION_DAYS`** — đó là kho dữ liệu chứ không phải bản chụp theo ngày; thư mục này lớn dần theo số ảnh, nhớ để ý dung lượng ổ đích. Ước lượng thô để tham khảo (kiểm lại theo thực tế): 50 ca siêu âm/ngày, mỗi ca 2 ảnh ~1 MB ≈ 30 GB/năm.
- Ảnh được chép **trước** database, nên mọi ảnh mà bản `.dump` nhắc tới đều đã có trong bản sao.
- Nếu chép ảnh lỗi (hoặc quên gắn volume `api_storage` vào dịch vụ `backup`) thì lần chạy đó bị tính là THẤT BẠI: banner cảnh báo cho quản trị viên hiện lên dù database vẫn được lưu.
- **Bản cài cũ (trước 07/10/2026)**: cập nhật `docker-compose.yml` mới (dịch vụ `backup` có thêm `api_storage:/data/storage:ro` và `STORAGE_DIR`) và nạp ảnh `nexamed-backup` mới, rồi `docker compose up -d backup`. Lần chạy đầu sẽ chép toàn bộ ảnh đang có.

#### Khôi phục từ 1 file backup — đã test thật (giả lập "PC hỏng hoàn toàn")

Dùng khi: máy chủ hỏng phải cài lại từ đầu, hoặc lỡ tay xoá/hỏng dữ liệu cần khôi phục lại đúng thời điểm đã backup.

**Bước 1.** Cài đặt máy (mới hoặc cài lại) bình thường theo mục 2.3 tới khi `api` báo healthy — **CHƯA cần tạo tenant** (bỏ qua bước 4 hỏi tạo phòng khám, hoặc cứ tạo rồi restore sẽ ghi đè lên).

**Bước 2.** Tắt tạm `api`/`web` (tránh có kết nối đang ghi dữ liệu trong lúc khôi phục):
```powershell
docker compose stop api web
```

**Bước 3.** Xoá sạch dữ liệu hiện có trong database (schema trống, giữ nguyên vai trò/quyền hệ thống):
```powershell
docker compose exec postgres psql -U nexamed -d nexamed -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

**Bước 4.** Copy file backup (`.dump`) vào container rồi khôi phục — thay đúng tên file backup của anh:
```powershell
docker compose cp .\ten-file-backup.dump postgres:/tmp/restore.dump
docker compose exec postgres pg_restore -U nexamed -d nexamed --no-owner /tmp/restore.dump
```
Chạy xong không có dòng nào bắt đầu bằng `pg_restore: error:` là thành công.

**Bước 4b.** Khôi phục thư mục ảnh đính kèm — chép bản sao `storage` trong thư mục backup vào container `api` (làm SAU Bước 4, trước khi bật lại `api`/`web`; chép được cả khi `api` đang dừng từ Bước 2 — đã kiểm chứng):
```powershell
docker compose cp .\backup-data\storage\. api:/data/storage/
```
Thay `.\backup-data` bằng đúng đường dẫn `BACKUP_HOST_DIR` đang dùng (ví dụ `D:\NEXAMed-backup\storage\.`). **Nhớ giữ dấu `\.` ở cuối** — nó có nghĩa "chép NỘI DUNG thư mục"; thiếu thì ảnh bị chép thành một thư mục con `storage` thừa bên trong và hệ thống không tìm thấy ảnh.

Kiểm tra sau khi chép — số file trong container phải bằng số file trong bản sao:
```powershell
docker compose exec api sh -c "find /data/storage -type f | wc -l"
(Get-ChildItem .\backup-data\storage -Recurse -File).Count
```
Bỏ qua bước này thì kết quả (chữ) vẫn đủ nhưng các ảnh đính kèm sẽ hiện ảnh vỡ.

> **Yên tâm khi cài lại**: ngay sau khi cài máy mới, dịch vụ `backup` tự chạy một lần trên thư mục ảnh còn TRỐNG. Việc đó KHÔNG làm mất bản sao cũ vì sao lưu chỉ chép thêm file mới, không bao giờ xoá file đã có ở thư mục đích. Chỉ cần đừng tự tay xoá `backup-data\storage`.

**Bước 5.** Bật lại và kiểm tra:
```powershell
docker compose start api web
```
Đăng nhập lại bằng tài khoản/mật khẩu đã có TRƯỚC lúc backup (không phải tài khoản mới) — dữ liệu đúng như thời điểm tạo file backup đó.

#### Diễn tập khôi phục ảnh — kịch bản "máy hỏng, cài lại" (đã chạy thật 07/10/2026, `docs/DECISIONS.md` #216)

Chạy bằng ảnh Docker `nexamed-backup` thật + `docker compose` (Postgres tạm, volume `api_storage` tạm), thư mục backup ở ổ máy thật:

1. Máy chạy bình thường có 5 ảnh (kết quả CĐHA, ảnh đại diện, logo) → dịch vụ `backup` chạy: `ảnh: xong (5 file, 936K)`, thư mục `backup-data\storage` có đủ 5 file cạnh file `.dump`.
2. **Máy hỏng**: `docker compose down -v` (xoá container + mọi volume) — chỉ còn thư mục `backup-data`.
3. **Cài lại**: `docker compose up -d` → volume ảnh mới TRỐNG (0 file); dịch vụ `backup` chạy ngay trên máy trống nhưng bản sao vẫn nguyên 5 file (không bị xoá theo).
4. **Khôi phục** bằng đúng lệnh ở Bước 4b (`docker compose cp .\backup-data\storage\. api:/data/storage/`) → thoát mã 0.
5. **Đối chiếu sha256 từng file** với trước khi hỏng: **giống hệt 5/5**. Khởi động lại `backup` sau đó vẫn bình thường (`ảnh: xong (5 file)`).

Chưa diễn tập: máy khách thật (NAS), dung lượng ảnh lớn (hàng chục GB — thời gian chép), và phục hồi đồng thời DB + ảnh trên cùng một máy khách thật qua đủ Bước 1-5.

**Nếu gặp lỗi `pg_restore: error: ... function unaccent(text) does not exist`** — chỉ xảy ra khi restore đúng 1 file backup được tạo TRƯỚC ngày 2026-09-01 (trước khi vá lỗi #099). Chạy thêm lệnh này 1 lần rồi thử lại Bước 4:
```powershell
docker compose exec postgres psql -U nexamed -d nexamed -c "CREATE OR REPLACE FUNCTION nexamed_unaccent_lower(input text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT lower(replace(replace(public.unaccent(input), 'đ', 'd'), 'Đ', 'D')) $$;"
```

### 2.3d. Các lệnh Docker cần biết — tra cứu nhanh

| Lệnh | Ý nghĩa | Khi nào dùng |
|---|---|---|
| `docker compose ps` | Liệt kê container đang chạy + trạng thái (`healthy`/`starting`/`exited`) | Kiểm tra nhanh hệ thống có đang chạy đúng không |
| `docker compose logs <service>` | Xem log của 1 service (`api`/`web`/`postgres`/`migrate`/`backup`) | Có lỗi, cần xem chi tiết vì sao — ví dụ `docker compose logs api` |
| `docker compose logs -f <service>` | Như trên nhưng xem log LIÊN TỤC (không tự thoát) | Theo dõi trực tiếp lúc đang thao tác, `Ctrl+C` để thoát |
| `docker compose up -d` | Khởi động (hoặc khởi động lại nếu đã đổi cấu hình/ảnh) toàn bộ 5 service, chạy nền | Sau khi sửa `.env`/nạp ảnh mới, hoặc khởi động lần đầu trong ngày |
| `docker compose down` | Dừng và XOÁ container (KHÔNG xoá dữ liệu — `postgres_data` là volume riêng, vẫn còn) | Muốn dừng hẳn hệ thống (bảo trì, chuyển máy) |
| `docker compose down -v` | Như trên nhưng **XOÁ LUÔN CẢ DỮ LIỆU** (volume) | **CHỈ dùng khi cố ý xoá sạch để làm lại từ đầu** — không dùng nhầm, mất hết dữ liệu bệnh nhân |
| `docker compose restart <service>` | Khởi động lại đúng 1 service (không đụng service khác) | Sau khi sửa `.env` chỉ ảnh hưởng 1 service — ví dụ sửa `BACKUP_HOST_DIR` thì `docker compose restart backup` |
| `docker compose stop <service>` / `start <service>` | Tắt/bật tạm 1 service, giữ nguyên container (không xoá) | Tắt `api`/`web` tạm thời lúc khôi phục dữ liệu (mục 2.3c) |
| `docker compose exec <service> <lệnh>` | Chạy 1 lệnh BÊN TRONG container đang chạy | Chạy `psql`, `pg_dump`, `pg_restore` trực tiếp trong container `postgres` |
| `docker compose cp <nguồn> <đích>` | Copy file giữa máy thật và container (2 chiều) | Đưa file backup vào container để restore, hoặc lấy file backup ra |
| `docker load -i <file>.tar.gz` | Nạp 1 ảnh Docker đã build sẵn từ file `.tar.gz` | `nexamed-setup` tự làm — chỉ cần biết khi làm tay/gỡ lỗi |
| `docker images` | Liệt kê mọi ảnh Docker đang có trên máy | Kiểm tra đã nạp đúng ảnh/đúng phiên bản chưa |
| `docker image inspect <tên>:<version>` | Xem chi tiết 1 ảnh — dùng để xác nhận đã nạp đúng | Nghi ngờ nạp sai/thiếu ảnh |
| `docker ps -a` | Liệt kê MỌI container (kể cả đã dừng) trên máy, không riêng dự án này | Tìm container nào đó đã tắt, hoặc kiểm tra cổng bị chiếm |

### 2.3e. Mạng nội bộ (LAN, HTTP thường): máy trạm truy cập, tường lửa, IP, khoá đăng nhập (23/10/2026, `docs/DECISIONS.md` #257–#259)

Mô hình giao hàng chính: máy chủ đặt trong mạng nội bộ phòng khám, nhân viên mở trình duyệt ở máy trạm vào **`http://<IP máy chủ>`** (thêm `:<cổng>` nếu cổng web khác 80). **HTTP thường, KHÔNG HTTPS, có thể không có Internet.** Phần mềm đã được kiểm theo đúng mô hình này (stack Docker thật, máy trạm thật trong LAN): không phụ thuộc tài nguyên ngoài Internet, giao diện gọi máy chủ qua chính địa chỉ đang mở (`apiBaseUrl` rỗng, nginx chuyển `/api`) nên **đổi IP máy chủ không phải sửa cấu hình ứng dụng** — nhân viên chỉ cần mở địa chỉ mới; cookie phiên `COOKIE_SECURE=false` (chỉ đặt `true` khi có HTTPS thật phía trước).

**1. Tường lửa Windows (máy chủ là PC Windows chạy Docker Desktop).** Nếu máy trạm không vào được dù máy chủ vào bình thường: tường lửa đang chặn cổng web với mạng ở hồ sơ "Public" (hay gặp với Wi-Fi). Mở cổng cho đúng mạng nội bộ — chạy PowerShell **với quyền Administrator** trên máy chủ (đổi `80` nếu dùng cổng khác):

```powershell
New-NetFirewallRule -DisplayName "NEXAMed web (LAN) 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -RemoteAddress LocalSubnet -Profile Any -Action Allow
# Gỡ khi không cần nữa:  Remove-NetFirewallRule -DisplayName "NEXAMed web (LAN)"
```

`-RemoteAddress LocalSubnet` chỉ cho máy cùng mạng con vào, không mở ra Internet. Kiểm bằng cách mở `http://<IP máy chủ>` từ MỘT máy khác. Nên đặt IP cố định (hoặc "DHCP reservation" ở router) cho máy chủ để địa chỉ không đổi theo ngày.

**2. IP của máy trạm trong nhật ký.** Trên **PC Windows chạy Docker Desktop**, cơ chế chuyển tiếp cổng của Docker Desktop làm máy chủ ứng dụng thấy MỌI máy trạm là cùng một IP của cổng mạng Docker (thường dạng `172.x.0.1`; đo thật 23/10/2026 với máy trạm `192.168.3.27`). Hệ quả: cột IP trong nhật ký đăng nhập không phân biệt được máy trạm, và mọi giới hạn tính theo IP bị cả phòng khám dùng chung — phần mềm đã tính đến việc này (giới hạn theo tài khoản/người dùng, mục 3). Trên **Linux/NAS (Docker Engine)** IP máy trạm được giữ nguyên (cần `TRUST_PROXY_HOPS=1`, trình cài đặt đã đặt).

**3. Giới hạn tần suất đăng nhập (#258).** Đăng nhập: tối đa **10 lần/phút cho mỗi tài khoản** (không phụ thuộc IP) cộng trần theo IP + công ty, mặc định **60 lần/phút** ở bản một công ty (đủ cho cả phòng khám đăng nhập đầu ca). Tra cứu bệnh nhân: 50 lần/phút **cho mỗi người dùng**. Gặp lỗi "thao tác quá nhanh" (429) hiếm khi cần chỉnh; nếu phòng khám rất đông, đặt `LOGIN_IP_LIMIT_PER_MINUTE=<số>` trong `.env` rồi `docker compose up -d` (chỉ ảnh hưởng trần IP, không đổi giới hạn theo tài khoản).

**4. Khoá đăng nhập và "máy quen" (#259).** Nhập sai mật khẩu 5 lần từ một máy sẽ khoá tạm tài khoản (5, rồi 15, rồi 30 phút, sau đó khoá vĩnh viễn). Để người khác gõ sai không làm tê liệt tài khoản của bạn: trình duyệt đã **đăng nhập đúng ít nhất một lần** được nhận là **máy quen** — khoá do máy lạ gây ra không chặn máy quen, và đăng nhập đúng từ máy quen sẽ tự gỡ khoá. Vì vậy: (a) mỗi nhân viên nên đăng nhập một lần bằng trình duyệt thường dùng của mình (không dùng cửa sổ ẩn danh); (b) xoá cookie/dữ liệu trình duyệt, đổi trình duyệt hay đổi mật khẩu thì máy đó thành máy lạ (đăng nhập lại một lần để thành máy quen); (c) tài khoản đang bị khoá mà nhân viên chỉ có máy mới → quản trị viên mở khoá ở "Quản trị → Tài khoản" (quyền `user_account.unlock`), hoặc dùng lệnh đặt lại mật khẩu quản trị (mục 2.3). Máy quen gõ sai 10 lần chỉ bị khoá 15 phút, không bao giờ khoá vĩnh viễn.

**5. Kiểm sau khi cài/nâng cấp (5 phút, nên làm một lần).** Từ MỘT máy trạm khác máy chủ: mở `http://<IP máy chủ>` → đăng nhập → tải lại trang (phải vẫn đăng nhập) → vào Kê đơn/Đơn thuốc mẫu và chọn một thuốc (trước đây từng hỏng ở HTTP LAN vì trình duyệt không cấp `crypto.randomUUID`, nay đã có dự phòng) → thử in/xuất PDF. Trên máy dev có công cụ tự động: `scripts/ui-audit/lan-http-check.cjs` (quét mọi trang qua địa chỉ LAN, xem đầu tệp để biết cách dựng Vite phụ và biến môi trường).

### 2.3f. Khoá mã hoá hệ thống: cất khoá, khoá không khớp, xoay khoá (24/10/2026, `docs/DECISIONS.md` #262)

`ENCRYPTION_KEY` trong `.env` mã hoá số CCCD, số thẻ BHYT, mật khẩu cổng liên thông và bí mật OTP. **Bản sao lưu tự động KHÔNG chứa khoá** (có chủ đích: để lộ bản sao lưu vẫn không lộ dữ liệu). Mất khoá = các thông tin đó không đọc lại được và không có cách lấy lại.

**1. Cất khoá ngay lúc cài.** Trang "Hoàn tất" của bộ cài có hộp "Cất khoá hệ thống": tải file `NEXAMed-khoa-he-thong.txt` (chứa khoá + mã kiểm dạng `7F3A-91C2` + cách khôi phục) và cất ở NƠI KHÁC máy chủ (USB, két). Không gửi qua Zalo/nhóm chat. Hệ thống đã cài từ trước: copy dòng `ENCRYPTION_KEY=...` trong `.env` ra nơi an toàn; mã kiểm hiện ở cảnh báo khi khoá lệch.

**2. Cảnh báo "Khoá hệ thống KHÔNG khớp với dữ liệu đã lưu"** (đỏ ở đầu trang, chỉ quản trị thấy): thường do khôi phục sao lưu sang máy mới mà thiếu `.env` gốc. Trong lúc lệch: CCCD/thẻ BHYT hiện "Không đọc được", hệ thống từ chối lưu CCCD/thẻ BHYT mới (409), mọi việc khác bình thường. **ĐỪNG nhập lại CCCD/thẻ BHYT để "sửa".** Cách xử lý: tìm file khoá, sửa dòng `ENCRYPTION_KEY=` trong `.env` cho đúng, `docker compose restart api`. Mã kiểm trong cảnh báo cho biết khoá nào đang chạy (đối chiếu với file khoá). Không có file khoá: dữ liệu mã hoá KHÔNG khôi phục được — liên hệ đơn vị hỗ trợ trước khi làm bất cứ điều gì khác (đừng tự sửa cơ sở dữ liệu).

**3. Xoay khoá** (đổi khoá định kỳ hoặc khi nghi lộ khoá). Làm ngoài giờ khám, hệ thống sẽ tắt vài phút:
```
# 1. SAO LƯU TRƯỚC: đăng nhập tài khoản quản trị, Cấu hình hệ thống → Sao lưu dữ liệu → bấm "Sao lưu ngay", đợi báo thành công
docker compose stop api web                                          # 2. tắt ứng dụng
docker compose run --rm -e OLD_ENCRYPTION_KEY=<khoá hiện tại> -e GENERATE_NEW_KEY=yes -e DRY_RUN=yes migrate pnpm run db:rotate-encryption-key     # 3. chạy thử, chỉ báo cáo
docker compose run --rm -e OLD_ENCRYPTION_KEY=<khoá hiện tại> -e NEW_ENCRYPTION_KEY=<khoá mới> -e CONFIRMED_BACKUP=yes migrate pnpm run db:rotate-encryption-key   # 4. xoay thật
```
Rồi sửa `ENCRYPTION_KEY=` trong `.env` thành khoá MỚI, cất file khoá mới, `docker compose up -d`. Lệnh mã hoá lại CCCD, thẻ BHYT (kể cả bản chụp ở lượt khám), mật khẩu liên thông, OTP người vận hành trong MỘT giao dịch (lỗi giữa chừng không đổi gì); giá trị không giải mã được bằng khoá cũ làm lệnh DỪNG (kiểm lại khoá cũ; `-e ALLOW_UNREADABLE=yes` để bỏ qua). Liên kết ảnh đã ký cũ hết hiệu lực. Quên sửa `.env` sau khi xoay: ứng dụng báo "Khoá hệ thống không khớp" ngay.

**4. Quyền file `.env` trên Windows.** `nexamed-setup.cmd` khoá quyền `.env` (chỉ SYSTEM, Administrators và người chạy lệnh) mỗi lần mở và sau khi cài xong. Người dùng Windows khác không phải Administrator sẽ không đọc được file này — đúng chủ đích.

### 2.4. PC không có server nội bộ — tự chạy lại sau khi khởi động lại, không cần nhân viên thao tác

Container đều đặt `restart: unless-stopped` — MỘT KHI Docker Desktop đã chạy, cả stack tự khởi động lại theo đúng thứ tự (`depends_on`/`condition: service_healthy`), không cần bấm gì. Vấn đề còn lại CHỈ là: **làm sao Docker Desktop tự chạy sau khi PC khởi động lại**, vì Docker Desktop (khác Docker Engine trên Linux) thường cần một phiên đăng nhập Windows đang mở mới tự khởi động được.

- **Bước an toàn, nên làm luôn**: Docker Desktop → Settings → General → bật "Start Docker Desktop when you sign in". Trình cài đặt nhắc bước này ở trang kết quả ở cuối, KHÔNG tự động sửa file cấu hình nội bộ của Docker Desktop (khác phiên bản lưu khác chỗ, tự sửa dễ hỏng).
- **Muốn PC tự đăng nhập Windows sau khi mất điện/khởi động lại (không cần nhân viên gõ mật khẩu Windows)**: dùng tính năng đăng nhập tự động của Windows (tài khoản Windows cục bộ riêng, không phải tài khoản Microsoft — cấu hình qua `netplwiz` hoặc registry `AutoAdminLogon`). **Đánh đổi bảo mật thật**: ai bật được nguồn điện/khởi động lại PC đó sẽ vào thẳng được màn hình đã đăng nhập Windows (không phải đăng nhập NEXAMed — ứng dụng vẫn yêu cầu JWT như bình thường, nhưng PC mất lớp bảo vệ đăng nhập Windows). **KHÔNG script hoá bước này** — nếu phòng khám chấp nhận đánh đổi, cấu hình thủ công + xác nhận rõ với chủ phòng khám trước khi bật, ưu tiên: (a) đặt PC ở khu vực có kiểm soát ra vào, (b) dùng tài khoản Windows cục bộ RIÊNG chỉ để chạy Docker Desktop (không phải tài khoản làm việc hằng ngày của nhân viên), (c) vẫn khoá màn hình bằng mật khẩu Windows sau khi không dùng máy dù đã auto-login lúc khởi động.

### 2.5. Còn treo — chưa làm ở phiên S4-05 này (thuộc S6-01/S6-02/S6-03/S6-04/S6-07)

- ~~Sao lưu tự động theo LỊCH thật + cảnh báo khi thất bại~~ **ĐÃ LÀM XONG (14/09/2026, S6-01, `docs/DECISIONS.md` #141)** — `backup.sh` ghi trạng thái (JSON, atomic) sau mỗi lần chạy ra volume dùng chung `backup_status_data`; `GET /api/v1/backup-status` (chỉ `clinic_admin`) đọc qua `BackupStatusPort`; banner đỏ toàn cục (`BackupStatusBanner.tsx`, lazy) hiện khi lần chạy gần nhất thất bại HOẶC quá 30 giờ chưa có lần thành công nào. Không phải email/SMS thật (v1: qua banner trong app, cùng tinh thần ADM-06 break-glass) — `BACKUP_STATUS_FILE` tuỳ chọn, máy dev không đặt thì banner tự tắt, không cảnh báo giả.
- **Diễn tập phục hồi thật — ĐÃ LÀM MỘT PHẦN** (01/09/2026, `docs/DECISIONS.md` #099): xác nhận restore hoạt động đúng, phát hiện + sửa 1 bug thật chặn hoàn toàn (xem mục 2.3c). Chưa làm: đo thời gian phục hồi thật trên máy chủ pilot thật (chỉ mới đo trên máy dev), chưa lặp lại diễn tập định kỳ (nên làm lại mỗi khi có thay đổi schema lớn).
- Rà soát bảo mật theo checklist `.claude/docs/security-audit.md` đầy đủ (S6-03) — S4-05 chỉ đảm bảo các ràng buộc đã chốt từ trước (không superuser cho role app, không log PII...) không bị phá vỡ lúc đóng gói, chưa phải audit toàn diện.
- Đo hiệu năng p95 API trên cấu hình máy chủ pilot THẬT (S6-04) — công cụ đo đã có (16/10/2026), hướng dẫn chạy ở mục 2.5a ngay dưới; còn thiếu lần chạy trên máy pilot thật.
- Tài liệu vận hành đầy đủ (S6-07: xử lý sự cố thường gặp cho người không rành IT) — tài liệu này (Phần 2) mới đủ cho người cài đặt kỹ thuật; `docs/pilot-onboarding.md` (S4-06) là tài liệu cho NHÂN VIÊN phòng khám (không phải người cài đặt).

### 2.5a. Đo hiệu năng p95 trên máy chủ pilot (S6-04)

Mục tiêu (PRD mục 5): p95 thời gian phản hồi API < 500 ms với 10 người dùng đồng thời. Công cụ: `apps/api/scripts/perf-load.ts` — chỉ GỌI ĐỌC (không tạo/sửa/xoá dữ liệu), nên chạy được trên dữ liệu thật; các lần mở hồ sơ/lượt khám vẫn để lại dòng "xem" trong nhật ký hoạt động, vì vậy dùng một tài khoản riêng (ví dụ `perf.do`) có quyền đọc bệnh nhân, lịch hẹn, lượt khám, thu ngân, kho.

- **Chạy từ máy nào**: một máy KHÁC trong cùng mạng LAN với máy chủ (đúng điều kiện nhân viên dùng thật; chạy ngay trên máy chủ sẽ tranh CPU với chính ứng dụng và cho số không đại diện). Cần Node 20 và mã nguồn (`pnpm install`).
- **Lệnh** (đặt `PERF_BASE_URL` là địa chỉ người dùng vẫn mở, không có `/` ở cuối và không có `/api`):
  `PERF_BASE_URL=http://192.168.1.10 PERF_TENANT_ID=<tenantId> PERF_USERNAME=<tài khoản đo> PERF_PASSWORD=<mật khẩu> PERF_DURATION_SEC=300 PERF_OUT=ket-qua.json pnpm --filter @nexamed/api run perf:load`
- **Giờ chạy**: lúc phòng khám vắng (đo tải do script tạo ra, không cộng thêm người thật), rồi lặp lại một lần trong giờ cao điểm để biết ảnh hưởng của người dùng thật. Đăng nhập giới hạn 10 lần/phút/IP nên đợi 1 phút giữa hai lần chạy (script tự chờ nếu bị 429).
- **Đọc kết quả**: `ĐẠT` khi p95 tổng hợp < 500 ms VÀ không có lỗi (mã khác 2xx/429). Dòng đăng nhập báo riêng (Argon2id cố ý chậm, chỉ xảy ra một lần mỗi phiên). Số 429 được đếm riêng, KHÔNG tính vào độ trễ — nếu có, đó là giới hạn tốc độ theo IP đang chặn người dùng chung một địa chỉ (xem `iam.module.ts`). Mục "5 yêu cầu chậm nhất" cho biết chậm tập trung đầu phiên (nhiễu khởi động) hay rải đều (chậm thật).
- **Ghi lại**: dán dòng "TỔNG HỢP" và thông số máy chủ (CPU, RAM, ổ đĩa, số bệnh nhân/lượt khám) vào `docs/GA-checklist.md` mục 2, dòng "p95 API".

### 2.5b. Đo tải LUỒNG GHI (bổ sung cho S6-04, 22/10/2026)

`perf:load` chỉ đọc nên không phản ánh lúc nhiều người cùng tiếp nhận/kê đơn/thu tiền (tranh chấp bộ đếm mã, ca thu ngân, khoá dòng). Công cụ: `apps/api/scripts/perf-load-write.ts` (`pnpm --filter @nexamed/api run perf:load:write`) — mỗi người dùng ảo lặp MỘT LƯỢT KHÁM TRỌN VẸN (tạo bệnh nhân → tiếp nhận → sinh hiệu → thu tiền → bắt đầu khám → chẩn đoán → ghi chú → kê đơn → ký đơn → hoàn tất) và báo p50/p95/p99 TỪNG BƯỚC. **GHI DỮ LIỆU THẬT và dữ liệu lâm sàng đã ký không xoá được → CHỈ chạy trên phòng khám THỬ** (bắt buộc `PERF_ALLOW_WRITE=yes`; bệnh nhân tạo ra có họ tên bắt đầu `ZZPERF`; tài khoản đo `zzperf.letan`/`zzperf.bs01…` tự tạo bằng tài khoản quản trị `PERF_ADMIN_USERNAME`/`PERF_ADMIN_PASSWORD`). Biến môi trường khác như `perf:load` + `PERF_STEP_THINK_*`/`PERF_VISIT_THINK_*`. Điều kiện nền: danh mục có thuốc, ICD-10 `A00`, chi nhánh có mã cơ sở KCB nếu khuôn mã đơn thuốc dùng `[Mã cơ sở KCB]` (xem DECISIONS #248), đang có ca thu ngân nếu phòng khám bắt buộc. Ngưỡng `ĐẠT`: p95 tổng hợp < 500 ms và 0 lỗi.

**Dữ liệu đo không xoá được → dùng công ty thử dùng một lần** (22/10/2026, #252): trên máy dev chạy `pnpm --filter @nexamed/api run db:seed:dev-tenant` (mỗi lần tạo một công ty mới + `dev.admin`, không đụng `config.json`), rồi đặt `PERF_TENANT_ID` bằng id in ra. Công ty mới chưa có thuốc nên bước kê đơn/ký đơn bị bỏ qua — thêm thuốc trước nếu muốn đo đủ luồng. Script tự chờ rồi thử lại khi gặp 429 khi đăng nhập.

### Ràng buộc bắt buộc khi viết script/cấu hình on-prem (đã chốt, không tự đổi)

- Toàn bộ cấu hình đọc từ biến môi trường, validate bằng Zod ở `apps/api/src/config` — không đọc `process.env` rải rác, không hard-code đường dẫn tuyệt đối/tên máy chủ/giá trị riêng của một phòng khám.
- Giá trị riêng theo từng phòng khám (giờ làm việc, độ dài slot, mẫu in...) nằm ở bảng `tenant_setting`, không hard-code trong code hay compose file.
- Backup ghi ra thư mục cấu hình được (`BACKUP_HOST_DIR` trong `.env`, nên trỏ ổ đĩa khác ổ chứa `postgres_data`), không dùng dịch vụ cloud lưu trữ ở v1.
- Không cấp `BYPASSRLS`/superuser cho role mà API runtime dùng (đã áp dụng từ S1-03, xem `docs/DECISIONS.md` #010 — giữ nguyên khi đóng gói on-prem, `migrate` chỉ dùng role đặc quyền `nexamed` cho ĐÚNG các bước cần, không phải role runtime).
- **Không chuyển source code/`.git`/tài liệu nội bộ (`.claude/docs/`, `docs/DECISIONS.md`, `docs/CURRENT.md`...) sang máy khách dưới bất kỳ hình thức nào** (`docs/DECISIONS.md` #098) — chỉ chuyển ảnh Docker đã build sẵn (`images/*.tar.gz`) + đúng danh sách file ở bảng 2.1b. Mọi thay đổi ở `deploy/on-prem/` sau này phải giữ nguyên ranh giới build (máy dev/CI) ⇸ chạy (máy khách) này.

---

## Phần 3 — Cloud (định hướng v3+, chưa quyết định)

**Chưa có quyết định** về nhà cung cấp cloud, mô hình triển khai (SaaS tập trung nhiều tenant hay mỗi khách một instance riêng), hay pipeline CI/CD cho cloud. Việc này phụ thuộc:

- Câu hỏi mở Q3 trong `docs/product/prd.md` (bán đứt theo cài đặt hay thuê bao theo tháng) — ảnh hưởng có cần kết nối internet định kỳ hay không.
- Nhu cầu thực tế: theo `docs/product/prd.md` phần Appendix A, cloud/đa tenant tập trung chỉ tính tới ở phase v3+, "khi có khách hàng chuỗi".
- `docs/Hybrid Authorization.md` là tài liệu định hướng phân quyền cho giai đoạn platform/đa module (Centralized Identity + Module-Specific Authorization) — **chỉ tham khảo**, chưa triển khai.

### 3.0. Chế độ SaaS — đã code (15/10/2026, `docs/DECISIONS.md` #237), CHƯA có hạ tầng thật

Phần mã đã có; chưa dựng hạ tầng. **Bản on-prem/VPS riêng/NAS KHÔNG bị ảnh hưởng và không đổi bước triển khai nào** (mặc định `DEPLOYMENT_MODE=single`, `config.json` có `tenantId`).

**Cách hoạt động**: mỗi công ty một tên miền phụ `<mã>.<tên miền gốc>`; khu quản trị ở `admin.<tên miền gốc>`. Thêm khách mới = tạo công ty ở khu quản trị (thêm một dòng trong DB) — KHÔNG phải tạo DNS/chứng chỉ riêng.

**Hạ tầng cấu hình MỘT lần** (cần chọn nhà cung cấp tên miền/máy chủ trong nước — chưa chọn): (1) DNS wildcard `*.tenmien.vn` trỏ về máy chủ; (2) chứng chỉ HTTPS wildcard `*.tenmien.vn` (thường xin bằng DNS-01, tự gia hạn); (3) reverse proxy (nginx) chuyển nguyên header `Host` và `/api` về API; web phục vụ cùng tên miền phụ.

**Cấu hình ứng dụng**: `DEPLOYMENT_MODE=saas`, `PLATFORM_BASE_DOMAIN=tenmien.vn`, tuỳ chọn `PLATFORM_ADMIN_SUBDOMAIN` (mặc định `admin`), `COOKIE_SECURE=true`; `config.json` của web chỉ cần `{ "apiBaseUrl": "" }` (mẫu `apps/web/public/config.saas.example.json`). Chạy `db:deploy` + `db:seed`, rồi tạo người vận hành: `OPERATOR_USERNAME=... OPERATOR_FULL_NAME=... pnpm --filter @nexamed/api run db:seed:platform-operator` (in mật khẩu + bí mật OTP MỘT lần — thêm vào ứng dụng xác thực).

**Thay chứng chỉ wildcard khi sắp hết hạn** (kiểu SaaS cài bằng `nexamed-setup`; chưa có màn hình riêng, làm tay 2 phút): (1) trong thư mục cài đặt, ghi đè hai file `certs/fullchain.crt` (chứng chỉ, gồm cả chuỗi trung gian) và `certs/privkey.key` (khoá riêng, không đặt mật khẩu) bằng bản mới — chứng chỉ mới vẫn phải bao `*.<tên miền gốc>` và `<tên miền gốc>`, khoá phải khớp; (2) chạy `docker compose restart caddy` trong thư mục đó (Caddy chỉ đọc file lúc khởi động; mất vài giây, các công ty bị gián đoạn rất ngắn); (3) kiểm tra bằng trình duyệt: mở `https://admin.<tên miền gốc>` xem ổ khoá và ngày hết hạn của chứng chỉ. Sai file thì Caddy không chạy: xem `docker compose logs caddy`, đặt lại bản cũ và restart lại. Kiểu VPS dùng Caddy tự xin và gia hạn chứng chỉ nên không cần làm gì.

**Chạy thử trên máy phát triển**: API với `DEPLOYMENT_MODE=saas PLATFORM_BASE_DOMAIN=localhost COOKIE_SECURE=false`; web `VITE_DEV_API_PROXY=http://localhost:<cổng API> pnpm exec vite`; mở `http://admin.localhost:5173` (khu quản trị) và `http://<mã>.localhost:5173` (công ty).
### Kiến trúc đã chuẩn bị sẵn cho hướng này (không cần làm lại nền tảng khi tới lúc)

- Mọi phụ thuộc hạ tầng (lưu file, gửi tin nhắn, ký số, cổng BHYT, phân giải danh tính bệnh nhân) đi qua port khai báo trong `packages/core/ports`; chuyển sang cloud chỉ cần thay adapter ở `apps/api/src/infrastructure/*` (ví dụ `StoragePort`: disk cục bộ → S3/MinIO; `EventBusPort`: in-memory → RabbitMQ/Kafka), không sửa service.
- Không lưu state trong RAM tiến trình (session, cache nghiệp vụ, bộ đếm) — sẵn sàng chạy nhiều instance sau load balancer.
- Mô hình multi-tenant (shared database, shared schema, cách ly bằng `tenant_id` + RLS) đã tính cho triển khai tập trung nhiều tenant từ đầu (`.claude/docs/multi-tenancy.md`). Nếu sau này có khách yêu cầu database riêng, tách bằng cách **route connection theo tenant** — không đổi mô hình cột `tenant_id` vì toàn bộ code đang dựa vào nó.

### Ràng buộc

**Không tự ý bắt đầu code hay dựng hạ tầng theo hướng cloud khi chưa có quyết định chính thức.** Theo `CLAUDE.md`: cấu trúc đã chốt (schema, ranh giới module, contract) không được tự ý thay đổi hay suy diễn — cần đổi hướng thì dừng lại, nêu vấn đề và hỏi trước.
