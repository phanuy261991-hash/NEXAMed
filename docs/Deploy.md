# Deploy — Triển khai NEXAMed (On-premise & Cloud)

## Đọc trước khi làm theo bất kỳ mục nào dưới đây

NEXAMed v1 triển khai **on-premise duy nhất**, tại từng phòng khám (`docs/product/prd.md`, `CLAUDE.md`). Cloud **không phải mục tiêu triển khai của v1** — kiến trúc port/adapter đảm bảo không phải làm lại nền tảng khi cần chuyển sang cloud sau này, nhưng hiện **chưa có** nhà cung cấp, mô hình, hay quy trình cloud nào được chốt.

**S4-05 (đóng gói on-premise) đã xong** (2026-09-01, sửa lại mô hình phân phối ở `docs/DECISIONS.md` #098) — `deploy/on-prem/` có đủ `docker-compose.yml` (tham chiếu ảnh `image:`, không tự build), Dockerfile cho `api`/`web`/`backup`, script build+export `build-and-export.ps1` (chạy ở máy dev/CI), script cài đặt `install.ps1`/`install.sh` (chạy ở máy khách, chỉ nạp ảnh). Tài liệu này gồm hai phần: (1) cách chạy môi trường hiện có cho dev/thử nghiệm (xem `docs/demo.md`, khác hẳn Phần 2 dưới đây), và (2) hướng dẫn triển khai on-premise thật + kiến trúc cho khả năng lên cloud sau này.

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
| `migrate` | Chạy MỘT LẦN mỗi lúc `docker compose up` rồi thoát: `prisma migrate deploy` → đổi mật khẩu role `nexamed_app` → seed danh mục toàn cục. Idempotent — an toàn khi máy khởi động lại chạy lại từ đầu | `nexamed-api:${NEXAMED_VERSION}` — build sẵn ở máy dev/CI từ `apps/api/Dockerfile`, nạp bằng `docker load` (xem 2.1b) |
| `api` | NestJS, healthcheck `GET /health` | `nexamed-api:${NEXAMED_VERSION}` (dùng chung ảnh với `migrate`, khác `command:`) |
| `web` | Build tĩnh `apps/web`, phục vụ qua nginx + reverse-proxy `/api/*` sang `api` (cùng origin, không cần CORS/mở thêm cổng) | `nexamed-web:${NEXAMED_VERSION}` — build sẵn ở máy dev/CI từ `apps/web/Dockerfile` |
| `backup` | `pg_dump -Fc` hằng ngày (giờ cấu hình được) ra thư mục ngoài container, tự dọn bản quá hạn giữ | `nexamed-backup:${NEXAMED_VERSION}` — build sẵn ở máy dev/CI từ `deploy/on-prem/backup/Dockerfile` |

Máy chủ đặt tại phòng khám **KHÔNG BAO GIỜ cần internet, kể cả lần cài đầu tiên** — ảnh đã build sẵn ở máy khác, máy khách chỉ `docker load` (xem 2.1b). Đây cũng là cách duy nhất đảm bảo máy khách không bao giờ nhận được mã nguồn (`.ts`/`.git`/`docs` nội bộ) — chỉ nhận ảnh Docker đã build.

`api`/`migrate` dùng CHUNG một Dockerfile lúc build → CHUNG một ảnh `nexamed-api` lúc chạy (không tách ảnh riêng) — cố ý, để không phải build/đồng bộ 2 ảnh mỗi lần đổi code.

### 2.1b. Hai giai đoạn — build ở máy dev/CI, chỉ nạp ảnh ở máy khách (`docs/DECISIONS.md` #098)

Mã nguồn `.ts`, lịch sử `.git`, và tài liệu nội bộ là tài sản trí tuệ, **tuyệt đối không được lộ cho máy khách**. Vì vậy triển khai on-prem đi qua đúng 2 giai đoạn tách biệt:

- **Giai đoạn A — Build & export** (máy dev/CI, có source đầy đủ): `deploy/on-prem/build-and-export.ps1` build 3 ảnh (`nexamed-api`/`nexamed-web`/`nexamed-backup`), `docker save` ra `.tar.gz`, rồi **tự gom sẵn mọi file cần thiết vào 1 thư mục duy nhất `deploy/on-prem/package/`** — không phải tự nhặt file nào cả. KHÔNG chạy bước này ở máy khách.
- **Giai đoạn B — Cài đặt tại máy khách**: chỉ cần chép NGUYÊN thư mục `package/` đó sang — `install.ps1`/`install.sh` bên trong tự `docker load` các ảnh rồi `docker compose up -d`. Máy khách **không có** bất kỳ file `.ts`/`.git`/`docs` nào trên đĩa — làm theo hướng dẫn từng bước ở mục 2.3.

### 2.2. Bí mật & mật khẩu — luồng thật

1. Migration tạo role `nexamed_app` với mật khẩu HARD-CODE (`docs/DECISIONS.md` #010) — chỉ dùng được cho dev.
2. `migrate` chạy `pnpm run db:rotate-app-password` (`apps/api/scripts/rotate-app-role-password.ts`) ngay sau `db:deploy` — đổi mật khẩu role đó sang giá trị ngẫu nhiên mạnh đọc từ `NEXAMED_APP_DB_PASSWORD` trong `.env`.
3. `install.ps1`/`install.sh` tự sinh `POSTGRES_PASSWORD`/`NEXAMED_APP_DB_PASSWORD`/`JWT_SECRET`/`ENCRYPTION_KEY` (hex ngẫu nhiên mạnh, `RandomNumberGenerator`/`openssl rand`) vào `.env` nếu file đó chưa tồn tại — không cần tự nghĩ/gõ tay.
4. Tạo phòng khám (tenant) + tài khoản quản trị đầu tiên: `apps/api/scripts/seed-pilot-tenant.ts` (`db:seed:pilot-tenant`) — script sản xuất, KHÁC `seed-dev-tenant.ts` (chỉ dev, tên/mật khẩu hard-code). Không truyền `ADMIN_PASSWORD` thì tự sinh mật khẩu mạnh, in ra ĐÚNG MỘT LẦN, bắt đổi ngay lần đăng nhập đầu (`mustChangePassword`, đã có từ #063).

`.env`/`config.json` (2 file thật, không commit — xem `.gitignore`) nằm cạnh `docker-compose.yml` tại `deploy/on-prem/`.

### 2.3. Cách chạy — hướng dẫn từng bước (đã verify thật)

#### PHẦN 1 — Trên máy DEV (đóng gói)

**Bước 1.** Mở PowerShell, vào thư mục dự án:
```powershell
cd C:\Projects\NEXAMed\deploy\on-prem
```

**Bước 2.** Chạy lệnh đóng gói (thay ngày hôm nay vào `-Version`):
```powershell
.\build-and-export.ps1 -Version 2026.09.02
```
Đợi vài phút (build lần đầu lâu hơn, lần sau có cache Docker nên nhanh). Xong sẽ có thư mục **`deploy\on-prem\package\`** chứa ĐẦY ĐỦ mọi thứ cần thiết — không cần tự tìm/gom file gì thêm.

**Bước 3.** Nén thư mục đó lại: chuột phải vào `package` → **Send to → Compressed (zipped) folder**.

#### PHẦN 2 — Chuyển sang máy KHÁCH

Chép file `package.zip` sang máy khách bằng USB hoặc qua mạng nội bộ.

#### PHẦN 3 — Trên máy KHÁCH (cài lần đầu)

**Bước 1.** Cài **Docker Desktop** (nếu máy chưa có) — tải tại docker.com, cài xong mở lên, đợi chạy ổn định (icon cá voi ở khay hệ thống).

**Bước 2.** Giải nén `package.zip`. **Lưu ý**: có thể Windows tạo thêm 1 thư mục con trùng tên khi giải nén (`package\package\...`) — sau khi giải nén, gõ `dir` kiểm tra có thấy `install.ps1` ngay trong thư mục đang đứng không; nếu không thấy mà thấy 1 thư mục con thì `cd` thêm vào đó.

**Bước 3.** Mở PowerShell, vào đúng thư mục có `install.ps1` (xác nhận bằng `dir`), rồi chạy:
```powershell
.\install.ps1
```

**Bước 4.** Script hỏi lần lượt — trả lời rồi Enter:
- *IP LAN của máy này* → Enter để bỏ qua nếu chỉ dùng ngay trên máy đó, hoặc gõ IP nếu muốn máy khác trong phòng khám cùng truy cập được.
- *Tên phòng khám*
- *Tên đăng nhập quản trị* (ví dụ `quantri`)
- *Họ tên quản trị viên*

**Bước 5.** Script tự chạy xong hết (nạp ảnh, khởi động, tạo tài khoản). Cuối cùng in ra:
- `tenantId` — 1 dãy mã
- **Mật khẩu** — chỉ hiện đúng 1 lần, **chụp màn hình hoặc chép lại ngay**

**Bước 6.** Mở file `config.json` (cùng thư mục) bằng Notepad, dán `tenantId` vừa in ra vào, lưu lại. Rồi chạy:
```powershell
docker compose restart web
```

**Bước 7.** Mở trình duyệt, vào địa chỉ đã chọn ở Bước 4 (ví dụ `http://localhost`), đăng nhập bằng tài khoản + mật khẩu vừa tạo. Hệ thống bắt đổi mật khẩu ngay lần đầu.

Linux/NAS: y hệt các bước trên, chỉ đổi `.\install.ps1` thành `./install.sh` (dùng `--tenant-name`/`--admin-username`... nếu muốn truyền sẵn, không cần trả lời tương tác).

#### Xử lý sự cố thường gặp (đã gặp thật, không phải giả định)

- **`.\install.ps1 : The term '.\install.ps1' is not recognized...`** → đang đứng sai thư mục, thường do giải nén `.zip` tạo thêm 1 lớp thư mục con trùng tên. Gõ `dir` xem có thư mục con nào không, `cd` vào đó rồi thử lại.
- **`ports are not available: exposing port TCP 0.0.0.0:80 ... forbidden by its access permissions`** (lúc "Khởi động stack") → cổng 80 trên máy đó đang bị chương trình khác chiếm (rất phổ biến trên Windows, ví dụ IIS). Sửa:
  1. Mở `.env` (Notepad), đổi `WEB_HTTP_PORT=80` thành `WEB_HTTP_PORT=8080`.
  2. Mở `config.json` (Notepad), đổi `"apiBaseUrl"` thêm cổng mới, ví dụ `"http://localhost:8080"`.
  3. **Chạy lại `.\install.ps1`** (KHÔNG chạy `docker compose up -d` trực tiếp — xem lý do ở mục ngay dưới).
  4. Truy cập bằng địa chỉ có kèm cổng: `http://localhost:8080`.
- **Đã lỡ chạy `docker compose up -d` trực tiếp (không qua `install.ps1`) để khắc phục sự cố ở trên, giờ không thấy `tenantId`/mật khẩu đâu cả** → bình thường, vì bước tạo tài khoản quản trị CHỈ nằm trong `install.ps1` (Bước 5), không nằm trong lệnh `docker compose up -d` thuần. Chạy lại `.\install.ps1` — vì `.env`/`config.json` đã có sẵn nên script tự bỏ qua phần tạo lại, chạy thẳng tới đúng bước hỏi tạo tài khoản.

### 2.3b. Cập nhật bản mới lên hệ thống đang chạy

**Trên máy DEV**

**Bước 1.** Đảm bảo code mới đã có trên máy dev (đã sửa/pull xong).

**Bước 2.**
```powershell
cd C:\Projects\NEXAMed\deploy\on-prem
.\build-and-export.ps1 -Version 2026.09.05
```
(đổi số ngày cho đúng — mỗi lần cập nhật nên đặt version mới, KHÔNG lặp lại version cũ, để tránh nhầm lẫn với bản đang chạy)

**Bước 3.** Nén thư mục `package` mới thành `.zip`.

**Chuyển sang máy KHÁCH** — chép `.zip` sang máy khách như lần đầu (USB/mạng nội bộ).

**Trên máy KHÁCH — áp dụng bản mới**

**Bước 1.** Giải nén file `.zip` mới **vào ĐÚNG thư mục đã cài lần trước** (nơi đang có sẵn `.env`/`config.json`), cho phép ghi đè khi được hỏi. **An toàn** — file mới KHÔNG đụng tới `.env`/`config.json` thật (2 file này không nằm trong gói, chỉ có `.env.example`/`config.example.json` làm mẫu), nên mật khẩu/`tenantId` hiện tại giữ nguyên.

**Từ `docs/DECISIONS.md` #100**: trước đây `install.ps1`/`install.sh` vẫn hỏi lại "Địa chỉ IP LAN của máy này" và ghi đè `WEB_ORIGIN`/`config.json.apiBaseUrl` ở MỌI lần chạy (kể cả lần cập nhật này) — nếu máy đó từng phải đổi cổng thủ công để né xung đột cổng 80 (mục "Xử lý sự cố thường gặp" ngay dưới), lần cập nhật sẽ ghi đè mất giá trị đã sửa, gây lỗi CORS dù mọi container vẫn `healthy`. Đã sửa: **giữ nguyên `WEB_ORIGIN`/`apiBaseUrl` ở mọi lần chạy sau lần cài đầu**, chỉ đổi khi truyền rõ `-WebOrigin`/`--web-origin`. Không cần làm gì thêm nếu dùng bản cài từ commit chứa #100 trở đi.

**Bước 2.** (Khuyên làm trước khi cập nhật, đề phòng) — sao lưu tay 1 bản trước khi đổi:
```powershell
docker compose exec postgres pg_dump -U nexamed -d nexamed -Fc -f /tmp/truoc-cap-nhat.dump
docker compose cp postgres:/tmp/truoc-cap-nhat.dump .\truoc-cap-nhat.dump
```

**Bước 3.** Chạy lệnh cập nhật — **luôn chỉ định rõ `-Version`** (tránh máy tự đoán nhầm nếu còn giữ cả file ảnh phiên bản cũ):
```powershell
.\install.ps1 -Version 2026.09.05 -SkipTenantCreation
```
`-SkipTenantCreation` **bắt buộc** ở bước cập nhật — nếu quên, script sẽ hỏi tạo phòng khám mới, có thể tạo nhầm 1 tenant thứ hai.

**Bước 4.** Script tự: nạp ảnh mới → khởi động lại → **`migrate` tự áp mọi thay đổi cấu trúc dữ liệu mới** (nếu có) → đợi `api` healthy. Xong là dùng được ngay, không mất dữ liệu cũ.

**Bước 5.** Mở lại trình duyệt, F5 kiểm tra tính năng mới hoạt động đúng.

**Lưu ý dọn dẹp**: sau vài lần cập nhật, thư mục `images\` trên máy khách có thể tồn đọng nhiều bản `.tar.gz` cũ — xoá bớt các file phiên bản cũ không dùng nữa (không ảnh hưởng gì, chỉ là file đã nạp xong rồi) để đỡ chiếm ổ đĩa.

### 2.3c. Sao lưu & khôi phục (backup/restore) — đã diễn tập thật (S6-02, `docs/DECISIONS.md` #099)

#### Cấu hình sao lưu tự động

Mở `.env`:
```
BACKUP_HOUR=19
BACKUP_RETENTION_DAYS=14
BACKUP_HOST_DIR=./backup-data
```
- `BACKUP_HOUR`: giờ chạy backup mỗi ngày (0-23) — **là giờ UTC, không phải giờ Việt Nam**. Muốn 2h sáng giờ VN thì đặt `19` (lùi 7 tiếng).
- `BACKUP_RETENTION_DAYS`: giữ bao nhiêu ngày trước khi tự xoá bản cũ.
- `BACKUP_HOST_DIR`: **quan trọng nhất** — mặc định lưu ngay trên ổ đĩa của PC đó, CÙNG ổ với dữ liệu thật. Nếu ổ đĩa hỏng thì mất cả 2. Nên đổi trỏ sang ổ khác/ổ ngoài/máy khác trong mạng nội bộ, ví dụ `D:\NEXAMed-backup` hoặc `\\192.168.1.100\backup-nexamed`. Sửa xong: `docker compose restart backup`.

Sửa xong `.env`, chạy lại:
```powershell
docker compose restart backup
```

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

**Bước 5.** Bật lại và kiểm tra:
```powershell
docker compose start api web
```
Đăng nhập lại bằng tài khoản/mật khẩu đã có TRƯỚC lúc backup (không phải tài khoản mới) — dữ liệu đúng như thời điểm tạo file backup đó.

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
| `docker compose restart <service>` | Khởi động lại đúng 1 service (không đụng service khác) | Sau khi sửa `.env` chỉ ảnh hưởng 1 service — ví dụ sửa `BACKUP_HOUR` thì `docker compose restart backup` |
| `docker compose stop <service>` / `start <service>` | Tắt/bật tạm 1 service, giữ nguyên container (không xoá) | Tắt `api`/`web` tạm thời lúc khôi phục dữ liệu (mục 2.3c) |
| `docker compose exec <service> <lệnh>` | Chạy 1 lệnh BÊN TRONG container đang chạy | Chạy `psql`, `pg_dump`, `pg_restore` trực tiếp trong container `postgres` |
| `docker compose cp <nguồn> <đích>` | Copy file giữa máy thật và container (2 chiều) | Đưa file backup vào container để restore, hoặc lấy file backup ra |
| `docker load -i <file>.tar.gz` | Nạp 1 ảnh Docker đã build sẵn từ file `.tar.gz` | `install.ps1` tự làm — chỉ cần biết khi làm tay/gỡ lỗi |
| `docker images` | Liệt kê mọi ảnh Docker đang có trên máy | Kiểm tra đã nạp đúng ảnh/đúng phiên bản chưa |
| `docker image inspect <tên>:<version>` | Xem chi tiết 1 ảnh — dùng để xác nhận đã nạp đúng | Nghi ngờ nạp sai/thiếu ảnh |
| `docker ps -a` | Liệt kê MỌI container (kể cả đã dừng) trên máy, không riêng dự án này | Tìm container nào đó đã tắt, hoặc kiểm tra cổng bị chiếm |

### 2.4. PC không có server nội bộ — tự chạy lại sau khi khởi động lại, không cần nhân viên thao tác

Container đều đặt `restart: unless-stopped` — MỘT KHI Docker Desktop đã chạy, cả stack tự khởi động lại theo đúng thứ tự (`depends_on`/`condition: service_healthy`), không cần bấm gì. Vấn đề còn lại CHỈ là: **làm sao Docker Desktop tự chạy sau khi PC khởi động lại**, vì Docker Desktop (khác Docker Engine trên Linux) thường cần một phiên đăng nhập Windows đang mở mới tự khởi động được.

- **Bước an toàn, nên làm luôn**: Docker Desktop → Settings → General → bật "Start Docker Desktop when you sign in". `install.ps1` nhắc bước này ở cuối, KHÔNG tự động sửa file cấu hình nội bộ của Docker Desktop (khác phiên bản lưu khác chỗ, tự sửa dễ hỏng).
- **Muốn PC tự đăng nhập Windows sau khi mất điện/khởi động lại (không cần nhân viên gõ mật khẩu Windows)**: dùng tính năng đăng nhập tự động của Windows (tài khoản Windows cục bộ riêng, không phải tài khoản Microsoft — cấu hình qua `netplwiz` hoặc registry `AutoAdminLogon`). **Đánh đổi bảo mật thật**: ai bật được nguồn điện/khởi động lại PC đó sẽ vào thẳng được màn hình đã đăng nhập Windows (không phải đăng nhập NEXAMed — ứng dụng vẫn yêu cầu JWT như bình thường, nhưng PC mất lớp bảo vệ đăng nhập Windows). **KHÔNG script hoá bước này** — nếu phòng khám chấp nhận đánh đổi, cấu hình thủ công + xác nhận rõ với chủ phòng khám trước khi bật, ưu tiên: (a) đặt PC ở khu vực có kiểm soát ra vào, (b) dùng tài khoản Windows cục bộ RIÊNG chỉ để chạy Docker Desktop (không phải tài khoản làm việc hằng ngày của nhân viên), (c) vẫn khoá màn hình bằng mật khẩu Windows sau khi không dùng máy dù đã auto-login lúc khởi động.

### 2.5. Còn treo — chưa làm ở phiên S4-05 này (thuộc S6-01/S6-02/S6-03/S6-04/S6-07)

- Sao lưu **tự động theo LỊCH thật + cảnh báo khi thất bại** — `deploy/on-prem/backup/` mới có lịch cố định hằng ngày + log thất bại ra `docker logs`, CHƯA có cơ chế cảnh báo chủ động (email/SMS) khi backup lỗi liên tục.
- **Diễn tập phục hồi thật — ĐÃ LÀM MỘT PHẦN** (01/09/2026, `docs/DECISIONS.md` #099): xác nhận restore hoạt động đúng, phát hiện + sửa 1 bug thật chặn hoàn toàn (xem mục 2.3c). Chưa làm: đo thời gian phục hồi thật trên máy chủ pilot thật (chỉ mới đo trên máy dev), chưa lặp lại diễn tập định kỳ (nên làm lại mỗi khi có thay đổi schema lớn).
- Rà soát bảo mật theo checklist `.claude/docs/security-audit.md` đầy đủ (S6-03) — S4-05 chỉ đảm bảo các ràng buộc đã chốt từ trước (không superuser cho role app, không log PII...) không bị phá vỡ lúc đóng gói, chưa phải audit toàn diện.
- Đo hiệu năng p95 API trên cấu hình máy chủ pilot THẬT (S6-04) — trước đó chỉ đo trên máy dev.
- Tài liệu vận hành đầy đủ (S6-07: xử lý sự cố thường gặp cho người không rành IT) — tài liệu này (Phần 2) mới đủ cho người cài đặt kỹ thuật; `docs/pilot-onboarding.md` (S4-06) là tài liệu cho NHÂN VIÊN phòng khám (không phải người cài đặt).

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

### Kiến trúc đã chuẩn bị sẵn cho hướng này (không cần làm lại nền tảng khi tới lúc)

- Mọi phụ thuộc hạ tầng (lưu file, gửi tin nhắn, ký số, cổng BHYT, phân giải danh tính bệnh nhân) đi qua port khai báo trong `packages/core/ports`; chuyển sang cloud chỉ cần thay adapter ở `apps/api/src/infrastructure/*` (ví dụ `StoragePort`: disk cục bộ → S3/MinIO; `EventBusPort`: in-memory → RabbitMQ/Kafka), không sửa service.
- Không lưu state trong RAM tiến trình (session, cache nghiệp vụ, bộ đếm) — sẵn sàng chạy nhiều instance sau load balancer.
- Mô hình multi-tenant (shared database, shared schema, cách ly bằng `tenant_id` + RLS) đã tính cho triển khai tập trung nhiều tenant từ đầu (`.claude/docs/multi-tenancy.md`). Nếu sau này có khách yêu cầu database riêng, tách bằng cách **route connection theo tenant** — không đổi mô hình cột `tenant_id` vì toàn bộ code đang dựa vào nó.

### Ràng buộc

**Không tự ý bắt đầu code hay dựng hạ tầng theo hướng cloud khi chưa có quyết định chính thức.** Theo `CLAUDE.md`: cấu trúc đã chốt (schema, ranh giới module, contract) không được tự ý thay đổi hay suy diễn — cần đổi hướng thì dừng lại, nêu vấn đề và hỏi trước.
