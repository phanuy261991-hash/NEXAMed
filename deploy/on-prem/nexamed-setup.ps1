<#
.SYNOPSIS
  Mở TRÌNH CÀI ĐẶT/NÂNG CẤP NEXAMed trên máy Windows (docs/DECISIONS.md #238).

.DESCRIPTION
  Script này chỉ là "cửa bật": kiểm tra Docker, nạp ảnh của trình cài đặt từ thư mục images, chạy container
  `nexamed-setup` (trang web hướng dẫn) rồi mở trình duyệt. Mọi câu hỏi và việc cài/nâng cấp thật nằm trong trang web đó.
  Dùng cho CẢ cài mới lẫn nâng cấp: giải nén gói mới đè lên thư mục cũ rồi chạy lại lệnh này.

.PARAMETER Version
  Phiên bản gói cần dùng. Bỏ qua thì tự dò trong images (lấy bản mới nhất).

.PARAMETER Port
  Cổng của trình cài đặt trên máy (mặc định 8090). Chỉ mở trên chính máy này (127.0.0.1).

.PARAMETER NoBrowser
  Không tự mở trình duyệt.
#>
[CmdletBinding()]
param(
    [string]$Version = '',
    [int]$Port = 8090,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }

$here = $PSScriptRoot
Set-Location $here

# ---- 1. Docker ----
Write-Step 'Kiểm tra Docker'
$dockerVersion = $null
try { $dockerVersion = (& docker version --format '{{.Server.Version}}' 2>$null) } catch { }
if (-not $dockerVersion) {
    Write-Host ''
    Write-Host 'Chưa dùng được Docker trên máy này.' -ForegroundColor Red
    Write-Host '  1. Tải và cài Docker Desktop cho Windows (docker.com), hoặc Container Manager nếu là NAS Synology.'
    Write-Host '  2. Mở Docker Desktop và đợi biểu tượng chuyển sang trạng thái đang chạy.'
    Write-Host '  3. Chạy lại lệnh này.'
    exit 1
}
Write-Host "OK - Docker $dockerVersion"

# ---- 2. Nạp ảnh trình cài đặt ----
Write-Step 'Chuẩn bị trình cài đặt'
$imagesDir = Join-Path $here 'images'
if (-not $Version -and (Test-Path (Join-Path $here 'VERSION'))) { $Version = (Get-Content (Join-Path $here 'VERSION') -Raw).Trim() }
if (-not $Version) {
    $found = @()
    if (Test-Path $imagesDir) {
        $found = @(Get-ChildItem $imagesDir -Filter 'nexamed-setup-*.tar*' | ForEach-Object { $_.Name -replace '^nexamed-setup-', '' -replace '\.tar(\.gz)?$', '' } | Sort-Object { [version]($_ -replace '[^0-9.].*$', '') } -Descending)
    }
    if ($found.Count -gt 0) { $Version = $found[0] }
}
if (-not $Version) {
    Write-Host 'Không thấy file nexamed-setup-<phiên bản>.tar.gz trong thư mục images. Giải nén đầy đủ gói cài đặt rồi chạy lại.' -ForegroundColor Red
    exit 1
}
$image = "nexamed-setup:$Version"
& docker image inspect $image *> $null
if ($LASTEXITCODE -ne 0) {
    $file = @("$imagesDir\nexamed-setup-$Version.tar.gz", "$imagesDir\nexamed-setup-$Version.tar") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $file) { Write-Host "Thiếu file ảnh nexamed-setup-$Version trong thư mục images." -ForegroundColor Red; exit 1 }
    Write-Host "Nạp $file ..."
    & docker load -i $file
    if ($LASTEXITCODE -ne 0) { Write-Host 'Nạp ảnh thất bại.' -ForegroundColor Red; exit 1 }
}
Write-Host "OK - $image"

# ---- 3. Thông tin máy cho container ----
# Docker Desktop chỉ nhận đường dẫn dạng /c/Users/... khi Compose chạy từ trong container.
$drive = $here.Substring(0, 1).ToLower()
$hostDir = "/$drive" + ($here.Substring(2) -replace '\\', '/')
$ips = @()
try {
    $ips = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.IPv4Address } | ForEach-Object { $_.IPv4Address.IPAddress })
    $others = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback|Docker|VirtualBox|VMware' } | ForEach-Object { $_.IPAddress })
    $ips = @($ips + $others | Select-Object -Unique)
} catch { }

& docker rm -f nexamed-setup *> $null

Write-Step 'Khởi động trình cài đặt'
$runArgs = @(
    'run', '--rm', '--name', 'nexamed-setup',
    '-p', "127.0.0.1:${Port}:8090",
    '-v', '//var/run/docker.sock:/var/run/docker.sock',
    '-v', "${here}:/work",
    '-e', "HOST_INSTALL_DIR=$hostDir",
    '-e', "HOST_INSTALL_DIR_DISPLAY=$here",
    '-e', "HOST_IPS=$($ips -join ',')",
    '-e', "SETUP_VERSION=$Version",
    '-e', "SETUP_IMAGE=$image",
    $image
)
# Start-Process nối tham số bằng dấu cách, không tự đặt dấu nháy: đường dẫn có dấu cách phải bọc tay.
$argLine = ($runArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
$proc = Start-Process -FilePath 'docker' -ArgumentList $argLine -NoNewWindow -PassThru

# Chờ trang sẵn sàng rồi mở trình duyệt.
$url = "http://localhost:$Port"
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { break }
    try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready = $true; break } catch { }
}
if ($ready) {
    Write-Host ''
    Write-Host "Trình cài đặt đã sẵn sàng: $url" -ForegroundColor Green
    Write-Host 'Giữ cửa sổ này mở trong lúc cài. Cài xong trình cài đặt tự đóng.'
    if (-not $NoBrowser) { Start-Process $url }
} elseif (-not $proc.HasExited) {
    Write-Host "Trình cài đặt chưa phản hồi. Thử mở $url sau ít giây." -ForegroundColor Yellow
}
$proc.WaitForExit()
exit $proc.ExitCode
