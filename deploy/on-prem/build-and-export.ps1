<#
.SYNOPSIS
  Build 3 ảnh Docker NEXAMed (api/web/backup) từ source và xuất ra file .tar.gz — CHẠY Ở MÁY
  DEV/CI, KHÔNG chạy ở máy khách (docs/DECISIONS.md #098).

.DESCRIPTION
  Máy khách không bao giờ nhận source code/`.git`/`docs` nội bộ — chỉ nhận ảnh Docker đã build
  sẵn (file .tar.gz) + thư mục deploy/on-prem/ đã lọc (docker-compose.yml, .env.example,
  config.example.json, install.ps1, install.sh, images/*.tar.gz). Script này build ở máy có
  source đầy đủ (dev/CI), KHÔNG chạy trên máy khách.

  Sau khi chạy xong, chép các file .tar.gz sinh ra trong -OutputDir + 5 file kể trên (KHÔNG chép
  gì khác) sang máy khách, rồi chạy install.ps1/install.sh tại đó (tự động `docker load`).

.PARAMETER Version
  Bắt buộc — nhãn phiên bản gắn cho cả 3 ảnh, ví dụ "2026.09.01" (CalVer thủ công, thêm hậu tố
  ".2" nếu build lại nhiều lần cùng ngày). Không dùng version trong package.json gốc ("0.0.0",
  không phục vụ mục đích này).

.PARAMETER OutputDir
  Thư mục chứa file .tar.gz sinh ra. Mặc định deploy/on-prem/images (đã gitignore/dockerignore).

.PARAMETER Platform
  Kiến trúc CPU đích, mặc định linux/amd64 (đúng PC Windows/đa số NAS x86_64). Chỉ đổi sang
  linux/arm64 khi có máy khách NAS ARM đã xác nhận đủ điều kiện (RAM ≥ 4GB — xem docs/Deploy.md
  Phần 0.2; case Synology DS423/RTD1619B từng gặp chỉ có 2GB RAM, chưa đạt ngưỡng này).

.EXAMPLE
  .\build-and-export.ps1 -Version 2026.09.01
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$OutputDir = "$PSScriptRoot\images",
    [string]$Platform = 'linux/amd64'
)

$ErrorActionPreference = 'Stop'

function Write-Step($text) {
    Write-Host ""
    Write-Host "==> $text" -ForegroundColor Cyan
}

# repoRoot = 2 cấp trên deploy/on-prem (KHÔNG phải 1 cấp — docker-compose.yml cũ từng dùng sai
# "context: .." resolve thành deploy/ chứ không phải gốc repo, xem docs/DECISIONS.md #098).
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path

Write-Step "Kiểm tra Docker"
& docker version --format '{{.Server.Version}}' >$null 2>$null
if (-not $?) { Write-Error "Không tìm thấy Docker đang chạy. Mở Docker Desktop rồi chạy lại." }
Write-Host "OK — repo root: $repoRoot"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$images = @(
    @{ Name = 'nexamed-api'; Dockerfile = 'apps\api\Dockerfile' }
    @{ Name = 'nexamed-web'; Dockerfile = 'apps\web\Dockerfile' }
    @{ Name = 'nexamed-backup'; Dockerfile = 'deploy\on-prem\backup\Dockerfile' }
)

$useBuildx = $Platform -ne 'linux/amd64'

foreach ($img in $images) {
    $tag = "$($img.Name):$Version"
    Write-Step "Build $tag ($($img.Dockerfile), platform=$Platform)"
    if ($useBuildx) {
        & docker buildx build --platform $Platform --load -f "$repoRoot\$($img.Dockerfile)" -t $tag $repoRoot
    } else {
        & docker build -f "$repoRoot\$($img.Dockerfile)" -t $tag $repoRoot
    }
    if (-not $?) { Write-Error "Build thất bại: $tag — xem log phía trên. Dừng lại, KHÔNG export ảnh dở." }
}

foreach ($img in $images) {
    $tag = "$($img.Name):$Version"
    $tarPath = "$OutputDir\$($img.Name)-$Version.tar"
    $gzPath = "$tarPath.gz"
    Write-Step "Xuất $tag -> $gzPath"

    & docker save -o $tarPath $tag
    if (-not $?) { Write-Error "docker save thất bại: $tag" }

    # .NET GZipStream — không phụ thuộc binary ngoài (Windows thuần không có `gzip` sẵn).
    $inStream = [System.IO.File]::OpenRead($tarPath)
    $outStream = [System.IO.File]::Create($gzPath)
    $gzipStream = New-Object System.IO.Compression.GZipStream($outStream, [System.IO.Compression.CompressionLevel]::Optimal)
    $inStream.CopyTo($gzipStream)
    $gzipStream.Dispose()
    $outStream.Dispose()
    $inStream.Dispose()
    Remove-Item $tarPath

    $sizeMb = [math]::Round((Get-Item $gzPath).Length / 1MB, 1)
    Write-Host "$($img.Name)-$Version.tar.gz — $sizeMb MB"
}

Write-Step "Hoàn tất"
Write-Host "File ảnh: $OutputDir\nexamed-{api,web,backup}-$Version.tar.gz" -ForegroundColor Green
Write-Host ""
Write-Host "Chép sang máy khách (USB/mạng nội bộ) CHỈ các file sau — KHÔNG chép source/.git/docs:" -ForegroundColor Yellow
Write-Host "  - deploy\on-prem\docker-compose.yml"
Write-Host "  - deploy\on-prem\.env.example"
Write-Host "  - deploy\on-prem\config.example.json"
Write-Host "  - deploy\on-prem\install.ps1"
Write-Host "  - deploy\on-prem\install.sh"
Write-Host "  - $OutputDir\*.tar.gz  (đặt vào thư mục images\ cạnh docker-compose.yml ở máy khách)"
Write-Host ""
Write-Host "Tại máy khách, chạy: .\install.ps1 -Version $Version  (hoặc ./install.sh --version $Version)"
