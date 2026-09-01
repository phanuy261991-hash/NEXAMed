<#
.SYNOPSIS
  Cài đặt NEXAMed on-premise trên một PC/máy chủ Windows tại phòng khám (S4-05).

.DESCRIPTION
  Chạy trên máy Windows đã cài Docker Desktop (WSL2 backend). KHÔNG cần source code/internet —
  chỉ cần thư mục này (deploy/on-prem/) + các file ảnh .tar.gz trong images/ (do
  build-and-export.ps1 tạo sẵn ở máy dev/CI, xem docs/DECISIONS.md #098). Script này:
    1. Kiểm tra Docker đã cài + đang chạy.
    2. Tạo .env + config.json từ file mẫu nếu chưa có, tự sinh mật khẩu/khoá mạnh.
    3. Nạp ảnh Docker đã build sẵn (docker load từ images/*.tar.gz) + khởi động toàn bộ stack
       (postgres, migrate, api, web, backup).
    4. Chờ dịch vụ api sẵn sàng (GET /health).
    5. Hướng dẫn/tạo phòng khám (tenant) + tài khoản quản trị đầu tiên.

  Chạy lại được nhiều lần an toàn (idempotent) — không tạo lại tenant nếu đã có, không sinh lại
  bí mật nếu .env đã tồn tại, KHÔNG hỏi lại/ghi đè WEB_ORIGIN + config.json.apiBaseUrl nếu đã có
  sẵn (trừ khi truyền rõ -WebOrigin — xem docs/DECISIONS.md #100, sửa bug ghi đè mất cấu hình cổng
  đã chỉnh tay để né xung đột cổng 80). Xem docs/Deploy.md Phần 2 để biết chi tiết kiến trúc/ràng buộc.

.PARAMETER Version
  Phiên bản ảnh cần nạp, ví dụ "2026.09.01" — phải khớp đúng tên file trong images/. Bỏ qua thì
  script tự dò trong images/ (chỉ tự dò được khi đúng 1 phiên bản tồn tại ở đó).

.PARAMETER TenantName
  Tên phòng khám — dùng để tạo tenant đầu tiên. Bỏ qua thì script hỏi trực tiếp (trừ khi
  -SkipTenantCreation).

.PARAMETER AdminUsername
  Tên đăng nhập tài khoản quản trị đầu tiên.

.PARAMETER AdminFullName
  Họ tên hiển thị của tài khoản quản trị đầu tiên.

.PARAMETER WebOrigin
  Địa chỉ trình duyệt nhân viên sẽ truy cập, ví dụ http://192.168.1.50 hoặc http://localhost:8080
  nếu cổng 80 bị chương trình khác chiếm. Chỉ hỏi trực tiếp ở lần cài ĐẦU TIÊN (mặc định
  http://localhost) — các lần chạy lại sau giữ nguyên giá trị đã cấu hình trừ khi truyền rõ tham số
  này (dùng khi CHỦ ĐỘNG muốn đổi địa chỉ/cổng).

.PARAMETER SkipTenantCreation
  Chỉ dựng stack, không hỏi/tạo phòng khám — dùng khi chạy lại script sau lần cài đầu (tenant đã
  có sẵn) hoặc khi muốn tự tạo tenant sau bằng tay.

.EXAMPLE
  .\install.ps1
  Chạy tương tác đầy đủ — script hỏi từng bước.

.EXAMPLE
  .\install.ps1 -TenantName "Phòng khám Đa khoa ABC" -AdminUsername "quantri" -AdminFullName "Nguyễn Văn A" -WebOrigin "http://192.168.1.50"
  Chạy không cần trả lời — dùng khi cài từ xa qua script/CI nội bộ.
#>
[CmdletBinding()]
param(
    [string]$Version,
    [string]$TenantName,
    [string]$AdminUsername,
    [string]$AdminFullName,
    [string]$WebOrigin,
    [switch]$SkipTenantCreation
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
Set-Location $here

function Write-Step($text) {
    Write-Host ""
    Write-Host "==> $text" -ForegroundColor Cyan
}

function Write-Warn2($text) {
    Write-Host "!! $text" -ForegroundColor Yellow
}

function New-RandomSecret([int]$bytes = 32) {
    # Hex — an toàn dùng trực tiếp trong URL kết nối DB / file .env, không cần escape ký tự đặc
    # biệt như base64 (+, /, =).
    # Dùng .Create()/.GetBytes() (instance method, có từ .NET 1.1) thay vì ::Fill() (static, CHỈ có
    # ở .NET Core/5+) — Windows PowerShell 5.1 chạy trên .NET Framework, không có ::Fill(), gây lỗi
    # "does not contain a method named 'Fill'" (bug thật phát hiện lúc verify install.ps1 chạy thật
    # trên PowerShell 5.1, docs/DECISIONS.md #098).
    $buffer = New-Object 'byte[]' $bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }
    -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

# ---- 1. Kiểm tra Docker ----
Write-Step "Kiểm tra Docker"
$dockerVersion = & docker version --format '{{.Server.Version}}' 2>$null
if (-not $?) {
    Write-Error "Không tìm thấy Docker đang chạy. Cài Docker Desktop (bật WSL2 lúc cài đặt), mở Docker Desktop rồi chạy lại script này."
}
Write-Host "Docker Engine $dockerVersion — OK"

& docker compose version >$null 2>$null
if (-not $?) {
    Write-Error "Docker Compose (plugin `docker compose`) không dùng được — cập nhật Docker Desktop lên bản mới."
}

# ---- 2. .env ----
Write-Step "Cấu hình .env"
$envIsNew = -not (Test-Path "$here\.env")
if ($envIsNew) {
    Copy-Item "$here\.env.example" "$here\.env"
    (Get-Content "$here\.env") `
        -replace 'POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$(New-RandomSecret 24)" `
        -replace 'NEXAMED_APP_DB_PASSWORD=.*', "NEXAMED_APP_DB_PASSWORD=$(New-RandomSecret 24)" `
        -replace 'JWT_SECRET=.*', "JWT_SECRET=$(New-RandomSecret 32)" `
        -replace 'ENCRYPTION_KEY=.*', "ENCRYPTION_KEY=$(New-RandomSecret 32)" `
        | Set-Content "$here\.env"
    Write-Host "Đã tạo .env với mật khẩu/khoá sinh ngẫu nhiên (không hiện ra màn hình — nằm trong file .env, KHÔNG chia sẻ file này)."
} else {
    Write-Host ".env đã tồn tại — giữ nguyên (không sinh lại bí mật)."
}

# WEB_ORIGIN CHỈ hỏi/ghi khi cài lần đầu (.env mới tạo) hoặc khi người dùng CHỦ ĐỘNG truyền
# -WebOrigin — các lần chạy lại sau (cập nhật phiên bản) PHẢI giữ nguyên giá trị đang chạy thật.
# BUG THẬT phát hiện lúc vận hành pilot (docs/DECISIONS.md #100): trước đây bước này luôn hỏi lại
# và ghi đè cả WEB_ORIGIN lẫn config.json.apiBaseUrl mỗi lần chạy — nếu máy đó từng phải đổi cổng
# thủ công để né xung đột cổng 80 (ví dụ IIS có sẵn trên Windows, xem mục "Xử lý sự cố thường gặp"),
# lần chạy cập nhật tiếp theo sẽ ghi đè mất giá trị đã sửa, khiến trình duyệt gọi nhầm sang cổng 80
# (IIS trả lời thay vì container web) → lỗi CORS dù mọi container vẫn "healthy" bình thường.
if ($WebOrigin) {
    (Get-Content "$here\.env") -replace 'WEB_ORIGIN=.*', "WEB_ORIGIN=$WebOrigin" | Set-Content "$here\.env"
    Write-Host "WEB_ORIGIN = $WebOrigin (theo tham số -WebOrigin truyền vào)"
} elseif ($envIsNew) {
    $answer = Read-Host "Địa chỉ IP LAN của máy này để nhân viên truy cập qua mạng nội bộ (Enter để chỉ dùng http://localhost ngay trên máy này)"
    $WebOrigin = if ($answer) { "http://$answer" } else { 'http://localhost' }
    (Get-Content "$here\.env") -replace 'WEB_ORIGIN=.*', "WEB_ORIGIN=$WebOrigin" | Set-Content "$here\.env"
    Write-Host "WEB_ORIGIN = $WebOrigin"
} else {
    $WebOrigin = ((Get-Content "$here\.env" | Where-Object { $_ -match '^WEB_ORIGIN=' }) -replace '^WEB_ORIGIN=', '').Trim()
    Write-Host "WEB_ORIGIN giữ nguyên giá trị đã cấu hình trước đó: $WebOrigin (truyền -WebOrigin nếu muốn đổi)."
}

# ---- 3. config.json ----
Write-Step "Cấu hình config.json (web)"
$configIsNew = -not (Test-Path "$here\config.json")
if ($configIsNew) {
    Copy-Item "$here\config.example.json" "$here\config.json"
}
if ($configIsNew -or $PSBoundParameters.ContainsKey('WebOrigin')) {
    $configJson = Get-Content "$here\config.json" -Raw | ConvertFrom-Json
    $configJson.apiBaseUrl = $WebOrigin
    $configJson | ConvertTo-Json | Set-Content "$here\config.json"
    Write-Host "apiBaseUrl trong config.json = $WebOrigin"
} else {
    Write-Host "config.json đã tồn tại — giữ nguyên apiBaseUrl (truyền -WebOrigin nếu muốn đổi)."
}

# ---- 4. Nạp ảnh Docker đã build sẵn + khởi động ----
Write-Step "Nạp ảnh Docker đã build sẵn"
$imagesDir = "$here\images"
if (-not (Test-Path $imagesDir)) {
    Write-Error "Không tìm thấy thư mục $imagesDir — copy các file nexamed-api-*.tar.gz/nexamed-web-*.tar.gz/nexamed-backup-*.tar.gz (do build-and-export.ps1 tạo ở máy dev/CI) vào đó trước khi chạy script này."
}

if (-not $Version) {
    # Bọc @() bắt buộc — nếu chỉ có đúng 1 kết quả, PowerShell tự "bung" pipeline thành chuỗi đơn
    # (không phải mảng 1 phần tử), khiến $found[0] sau đó lấy nhầm KÝ TỰ ĐẦU của chuỗi thay vì cả
    # chuỗi (bug thật phát hiện lúc verify: "0.0.1-test" bị đọc thành "0", docs/DECISIONS.md #098).
    $found = @(Get-ChildItem "$imagesDir\nexamed-api-*.tar*" -ErrorAction SilentlyContinue |
        ForEach-Object { $_.BaseName -replace '^nexamed-api-', '' -replace '\.tar$', '' } |
        Select-Object -Unique)
    if ($found.Count -eq 1) {
        $Version = $found[0]
        Write-Host "Tự nhận diện phiên bản: $Version"
    } elseif ($found.Count -eq 0) {
        Write-Error "Không tìm thấy file nexamed-api-*.tar(.gz) nào trong $imagesDir."
    } else {
        Write-Error "Tìm thấy nhiều phiên bản trong $imagesDir ($($found -join ', ')) — truyền rõ -Version <phiên bản> để chọn đúng."
    }
}

$imageNames = @('nexamed-api', 'nexamed-web', 'nexamed-backup')
foreach ($name in $imageNames) {
    $gz = "$imagesDir\$name-$Version.tar.gz"
    $tar = "$imagesDir\$name-$Version.tar"
    $file = if (Test-Path $gz) { $gz } elseif (Test-Path $tar) { $tar } else { $null }
    if (-not $file) {
        Write-Error "Thiếu file ảnh: $gz (hoặc $tar) — kiểm tra lại -Version hoặc copy đủ 3 file .tar.gz vào $imagesDir."
    }
    Write-Host "Nạp $file ..."
    & docker load -i $file
    if (-not $?) { Write-Error "docker load thất bại: $file — file có thể bị hỏng lúc chép qua USB/mạng, thử chép lại." }

    & docker image inspect "$name`:$Version" >$null 2>$null
    if (-not $?) { Write-Error "Đã nạp $file nhưng không thấy ảnh $name`:$Version — kiểm tra lại -Version có khớp đúng lúc build không." }
}

(Get-Content "$here\.env") -replace 'NEXAMED_VERSION=.*', "NEXAMED_VERSION=$Version" | Set-Content "$here\.env"
Write-Host "NEXAMED_VERSION = $Version (đã ghi vào .env)"

Write-Step "Khởi động stack (postgres, migrate, api, web, backup)"
& docker compose up -d
if (-not $?) { Write-Error "Khởi động thất bại — xem log phía trên (docker compose logs)." }

# ---- 5. Chờ api sẵn sàng ----
Write-Step "Chờ dịch vụ api sẵn sàng"
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    $status = & docker inspect --format='{{.State.Health.Status}}' "$(& docker compose ps -q api)" 2>$null
    if ($status -eq 'healthy') { $ready = $true; break }
    Start-Sleep -Seconds 3
    Write-Host "." -NoNewline
}
Write-Host ""
if (-not $ready) {
    Write-Warn2 "api chưa báo healthy sau 3 phút chờ — kiểm tra `docker compose logs api` và `docker compose logs migrate`. Vẫn tiếp tục hướng dẫn bên dưới, có thể phải chờ thêm hoặc xử lý lỗi trước."
} else {
    Write-Host "api đã sẵn sàng." -ForegroundColor Green
}

# ---- 6. Tạo phòng khám đầu tiên ----
if (-not $SkipTenantCreation) {
    Write-Step "Tạo phòng khám (tenant) + tài khoản quản trị đầu tiên"
    Write-Host "Bỏ qua bước này nếu phòng khám đã được tạo trước đó (chạy lại script với -SkipTenantCreation)."
    if (-not $TenantName) { $TenantName = Read-Host "Tên phòng khám (ví dụ: Phòng khám Đa khoa ABC)" }
    if (-not $AdminUsername) { $AdminUsername = Read-Host "Tên đăng nhập tài khoản quản trị đầu tiên (ví dụ: quantri)" }
    if (-not $AdminFullName) { $AdminFullName = Read-Host "Họ tên tài khoản quản trị đầu tiên" }

    if ($TenantName -and $AdminUsername -and $AdminFullName) {
        & docker compose run --rm `
            -e "TENANT_NAME=$TenantName" `
            -e "ADMIN_USERNAME=$AdminUsername" `
            -e "ADMIN_FULL_NAME=$AdminFullName" `
            migrate pnpm run db:seed:pilot-tenant
        Write-Warn2 "Chép LẠI tenantId và mật khẩu tự sinh ở trên — mật khẩu chỉ hiện ĐÚNG MỘT LẦN, không lưu lại ở đâu khác."
        Write-Host "Dán tenantId vừa in ra vào file $here\config.json (khoá tenantId), rồi chạy: docker compose restart web"
    } else {
        Write-Warn2 "Bỏ qua tạo tenant (thiếu thông tin). Tạo sau bằng tay — xem docs/Deploy.md Phần 2."
    }
}

# ---- 7. Hoàn tất ----
Write-Step "Hoàn tất"
Write-Host "Truy cập: $WebOrigin"
Write-Host ""
Write-Host "QUAN TRỌNG — để hệ thống tự chạy lại sau khi PC khởi động lại, không cần nhân viên thao tác:" -ForegroundColor Yellow
Write-Host "  1. Mở Docker Desktop -> Settings -> General -> bật 'Start Docker Desktop when you sign in'."
Write-Host "  2. Các container đã đặt restart:unless-stopped — Docker Desktop khởi động lại là cả hệ thống tự chạy lại, không cần bấm gì thêm."
Write-Host "  3. Nếu muốn PC tự đăng nhập Windows sau khi mất điện/khởi động lại (Docker Desktop cần một phiên đăng nhập để tự khởi động) — xem hướng dẫn CÓ CẢNH BÁO bảo mật ở docs/Deploy.md Phần 2 mục 'PC không có server nội bộ'. KHÔNG script tự động bước này vì liên quan mật khẩu đăng nhập Windows."
Write-Host ""
Write-Host "Xem docs/Deploy.md để biết cách sao lưu/phục hồi, xử lý sự cố thường gặp."