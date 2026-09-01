<#
.SYNOPSIS
  Build 3 ảnh Docker NEXAMed (api/web/backup) và gom sẵn TOÀN BỘ file cần gửi máy khách vào 1
  thư mục duy nhất — CHẠY Ở MÁY DEV/CI, KHÔNG chạy ở máy khách (docs/DECISIONS.md #098).

.DESCRIPTION
  Sau khi chạy xong, thư mục -PackageDir (mặc định deploy/on-prem/package) chứa ĐẦY ĐỦ và CHỈ
  đúng những gì máy khách cần — không có source code/`.git`/`docs` nội bộ nào trong đó. Chỉ cần
  chép NGUYÊN thư mục này (zip lại hoặc copy cả thư mục) sang máy khách, không cần tự nhặt file.

.PARAMETER Version
  Bắt buộc — nhãn phiên bản gắn cho cả 3 ảnh, ví dụ "2026.09.01" (ngày hôm nay, thêm hậu tố ".2"
  nếu build lại nhiều lần cùng ngày).

.PARAMETER PackageDir
  Thư mục gói cài đặt hoàn chỉnh, sẵn sàng chép sang máy khách. Mặc định deploy/on-prem/package
  (đã gitignore/dockerignore).

.PARAMETER Platform
  Kiến trúc CPU đích, mặc định linux/amd64 (đúng PC Windows/đa số NAS x86_64). Chỉ đổi sang
  linux/arm64 khi có máy khách NAS ARM đã xác nhận đủ điều kiện (RAM ≥ 4GB).

.EXAMPLE
  .\build-and-export.ps1 -Version 2026.09.01
  Xong thì chép nguyên thư mục deploy\on-prem\package sang máy khách.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$PackageDir = "$PSScriptRoot\package",
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

$imagesDir = "$PackageDir\images"
New-Item -ItemType Directory -Force -Path $imagesDir | Out-Null

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
    $tarPath = "$imagesDir\$($img.Name)-$Version.tar"
    $gzPath = "$tarPath.gz"
    Write-Step "Xuất $tag -> package\images\$($img.Name)-$Version.tar.gz"

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

Write-Step "Gom file cài đặt vào $PackageDir"
Copy-Item "$PSScriptRoot\docker-compose.yml" $PackageDir -Force
Copy-Item "$PSScriptRoot\.env.example" $PackageDir -Force
Copy-Item "$PSScriptRoot\config.example.json" $PackageDir -Force
Copy-Item "$PSScriptRoot\install.ps1" $PackageDir -Force
Copy-Item "$PSScriptRoot\install.cmd" $PackageDir -Force
Copy-Item "$PSScriptRoot\install.sh" $PackageDir -Force
Write-Host "Đã copy: docker-compose.yml, .env.example, config.example.json, install.ps1, install.cmd, install.sh"

Write-Step "HOÀN TẤT"
Write-Host "Thư mục sẵn sàng chép sang máy khách: $PackageDir" -ForegroundColor Green
Write-Host "(chỉ chứa file cần thiết — KHÔNG có source code/.git/docs nội bộ nào)" -ForegroundColor Green
Write-Host ""
Write-Host "Bước tiếp theo:" -ForegroundColor Yellow
Write-Host "  1. Nén thư mục $PackageDir thành 1 file .zip (chuột phải -> Send to -> Compressed folder), hoặc copy nguyên thư mục."
Write-Host "  2. Chép file .zip (hoặc thư mục) sang máy khách qua USB/mạng nội bộ."
Write-Host "  3. Tại máy khách: giải nén rồi double-click install.cmd (hoặc mở PowerShell trong thư mục đó, chạy .\install.cmd) — tránh lỗi Execution Policy chặn .ps1 chưa ký."
