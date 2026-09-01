<#
.SYNOPSIS
  Cài đặt NEXAMed on-premise trên một PC/máy chủ Windows tại phòng khám (S4-05).

.DESCRIPTION
  Chạy trên máy Windows đã cài Docker Desktop (WSL2 backend). Script này:
    1. Kiểm tra Docker đã cài + đang chạy.
    2. Tạo .env + config.json từ file mẫu nếu chưa có, tự sinh mật khẩu/khoá mạnh.
    3. Build + khởi động toàn bộ stack (postgres, migrate, api, web, backup).
    4. Chờ dịch vụ api sẵn sàng (GET /health).
    5. Hướng dẫn/tạo phòng khám (tenant) + tài khoản quản trị đầu tiên.

  Chạy lại được nhiều lần an toàn (idempotent) — không tạo lại tenant nếu đã có, không sinh lại
  bí mật nếu .env đã tồn tại. Xem docs/Deploy.md Phần 2 để biết chi tiết kiến trúc/ràng buộc.

.PARAMETER TenantName
  Tên phòng khám — dùng để tạo tenant đầu tiên. Bỏ qua thì script hỏi trực tiếp (trừ khi
  -SkipTenantCreation).

.PARAMETER AdminUsername
  Tên đăng nhập tài khoản quản trị đầu tiên.

.PARAMETER AdminFullName
  Họ tên hiển thị của tài khoản quản trị đầu tiên.

.PARAMETER WebOrigin
  Địa chỉ trình duyệt nhân viên sẽ truy cập, ví dụ http://192.168.1.50 hoặc http://localhost nếu
  chỉ dùng ngay trên máy này. Mặc định http://localhost.

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
    $buffer = New-Object 'byte[]' $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
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
if (-not (Test-Path "$here\.env")) {
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

if (-not $WebOrigin) {
    $answer = Read-Host "Địa chỉ IP LAN của máy này để nhân viên truy cập qua mạng nội bộ (Enter để chỉ dùng http://localhost ngay trên máy này)"
    if ($answer) { $WebOrigin = "http://$answer" } else { $WebOrigin = 'http://localhost' }
}
(Get-Content "$here\.env") -replace 'WEB_ORIGIN=.*', "WEB_ORIGIN=$WebOrigin" | Set-Content "$here\.env"
Write-Host "WEB_ORIGIN = $WebOrigin"

# ---- 3. config.json ----
Write-Step "Cấu hình config.json (web)"
if (-not (Test-Path "$here\config.json")) {
    Copy-Item "$here\config.example.json" "$here\config.json"
}
$configJson = Get-Content "$here\config.json" -Raw | ConvertFrom-Json
$configJson.apiBaseUrl = $WebOrigin
$configJson | ConvertTo-Json | Set-Content "$here\config.json"
Write-Host "apiBaseUrl trong config.json = $WebOrigin"

# ---- 4. Build + khởi động ----
Write-Step "Build ảnh Docker (lần đầu có thể mất 5-15 phút tuỳ máy)"
& docker compose build
if (-not $?) { Write-Error "Build ảnh thất bại — xem log phía trên." }

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