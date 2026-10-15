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
    [string]$Platform = 'linux/amd64',
    [switch]$AllowUnreleased
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

# Phiên bản phần mềm (docs/DECISIONS.md #236): SemVer, KHÔNG kèm "+thông tin bản dựng" (mã bản dựng tự sinh bên dưới). Kênh suy từ số: có "-beta." → beta, còn lại → stable.
if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$') {
    Write-Error "-Version '$Version' không phải số phiên bản SemVer hợp lệ (ví dụ 0.9.0 hoặc 0.10.0-beta.1). Phát hành bằng: node scripts/release.mjs <major|minor|patch|beta>."
}
$channel = if ($Version -match '-beta\.') { 'beta' } else { 'stable' }

# Số phiên bản dựng PHẢI trùng package.json gốc (nguồn sự thật, do `node scripts/release.mjs` ghi) và đã có tag v<phiên bản> — để số hiển thị trên giao diện luôn khớp đúng bản phát hành,
# không phải số gõ tay ở dòng lệnh. Dựng thử không phát hành: thêm -AllowUnreleased.
$rootVersion = ((Get-Content "$repoRoot\package.json" -Raw | ConvertFrom-Json).version)
if (-not $AllowUnreleased) {
    if ($Version -ne $rootVersion) {
        Write-Error "-Version $Version khác phiên bản trong package.json gốc ($rootVersion). Phát hành trước bằng: node scripts/release.mjs <major|minor|patch|beta>, hoặc dựng thử bằng -AllowUnreleased."
    }
    $tagFound = (& git -C $repoRoot tag --list "v$Version" 2>$null)
    if (-not $tagFound) {
        Write-Error "Chưa có tag v$Version. Chốt phát hành trước bằng: node scripts/release.mjs $Version, hoặc dựng thử bằng -AllowUnreleased."
    }
}

# Mã bản dựng = SỐ THỨ TỰ BẢN DỰNG = tổng số commit của nhánh hiện tại (`git rev-list --count HEAD`), ví dụ 127 → hiển thị "0.9.0 · bản dựng 127", SemVer đầy đủ 0.9.0+127 (docs/DECISIONS.md #236).
# Cùng một commit luôn ra cùng một số (không cần bộ đếm riêng); số tăng dần nên đọc là biết bản nào mới hơn. Cần clone ĐẦY ĐỦ lịch sử (clone nông đếm sai).
$shallow = (& git -C $repoRoot rev-parse --is-shallow-repository 2>$null)
if ($shallow -eq 'true') { Write-Error "Kho git đang là bản clone nông (shallow) nên không đếm đúng số bản dựng. Chạy: git fetch --unshallow" }
$buildId = (& git -C $repoRoot rev-list --count HEAD 2>$null)
if (-not $buildId) { Write-Error "Không đếm được số commit để đánh số bản dựng — kiểm tra thư mục có phải kho git." }
$dirty = (& git -C $repoRoot status --porcelain 2>$null)
if ($dirty) { Write-Host "Cảnh báo: cây làm việc git còn thay đổi chưa commit — KHÔNG nên giao bản này cho khách." -ForegroundColor Yellow }
if (-not $AllowUnreleased) {
    # Bản giao khách phải dựng đúng từ commit đã gắn tag v<phiên bản> và cây sạch — số phiên bản ứng với đúng một commit (truy vết nguồn khi khách báo lỗi).
    $tagCommit = (& git -C $repoRoot rev-list -n 1 "v$Version" 2>$null)
    $headCommit = (& git -C $repoRoot rev-parse HEAD 2>$null)
    if ($tagCommit -ne $headCommit) { Write-Error "HEAD không phải commit của tag v$Version — checkout đúng tag (git checkout v$Version) rồi dựng lại, hoặc dựng thử bằng -AllowUnreleased." }
    if ($dirty) { Write-Error "Cây làm việc git chưa sạch — commit hoặc cất thay đổi rồi dựng lại, hoặc dựng thử bằng -AllowUnreleased." }
}
Write-Host "Phiên bản: $Version+$buildId (kênh $channel)"

$images = @(
    @{ Name = 'nexamed-api'; Dockerfile = 'apps\api\Dockerfile'; VersionArgs = $true }
    @{ Name = 'nexamed-web'; Dockerfile = 'apps\web\Dockerfile'; VersionArgs = $true }
    @{ Name = 'nexamed-backup'; Dockerfile = 'deploy\on-prem\backup\Dockerfile'; VersionArgs = $false }
    # Trình cài đặt/nâng cấp (docs/DECISIONS.md #238): chạy trên máy khách lúc cài/nâng cấp, điều khiển Docker qua docker.sock.
    @{ Name = 'nexamed-setup'; Dockerfile = 'apps\setup\Dockerfile'; VersionArgs = $false }
)

# Ảnh bên thứ ba đi kèm gói để cài KHÔNG cần Internet: cơ sở dữ liệu và Caddy (HTTPS cho kiểu VPS/SaaS). Phải KHỚP tag trong docker-compose.yml.
$thirdParty = @(
    @{ Ref = 'postgres:18'; File = 'third-party-postgres' }
    @{ Ref = 'caddy:2.8-alpine'; File = 'third-party-caddy' }
)

$useBuildx = $Platform -ne 'linux/amd64'

foreach ($img in $images) {
    $tag = "$($img.Name):$Version"
    Write-Step "Build $tag ($($img.Dockerfile), platform=$Platform)"
    $versionArgs = @()
    if ($img.VersionArgs) {
        $versionArgs = @('--build-arg', "APP_VERSION=$Version", '--build-arg', "BUILD_ID=$buildId", '--build-arg', "RELEASE_CHANNEL=$channel")
    }
    if ($useBuildx) {
        & docker buildx build --platform $Platform --load -f "$repoRoot\$($img.Dockerfile)" -t $tag @versionArgs $repoRoot
    } else {
        & docker build -f "$repoRoot\$($img.Dockerfile)" -t $tag @versionArgs $repoRoot
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

foreach ($tp in $thirdParty) {
    Write-Step "Xuất $($tp.Ref) -> package\images\$($tp.File).tar.gz"
    & docker image inspect $tp.Ref *> $null
    if ($LASTEXITCODE -ne 0) {
        & docker pull --platform $Platform $tp.Ref
        if (-not $?) { Write-Error "Không tải được ảnh $($tp.Ref) — cần Internet ở máy dựng gói." }
    }
    $tarPath = "$imagesDir\$($tp.File).tar"
    $gzPath = "$tarPath.gz"
    & docker save -o $tarPath $tp.Ref
    if (-not $?) { Write-Error "docker save thất bại: $($tp.Ref)" }
    $inStream = [System.IO.File]::OpenRead($tarPath)
    $outStream = [System.IO.File]::Create($gzPath)
    $gzipStream = New-Object System.IO.Compression.GZipStream($outStream, [System.IO.Compression.CompressionLevel]::Optimal)
    $inStream.CopyTo($gzipStream)
    $gzipStream.Dispose()
    $outStream.Dispose()
    $inStream.Dispose()
    Remove-Item $tarPath
    Write-Host "$($tp.File).tar.gz — $([math]::Round((Get-Item $gzPath).Length / 1MB, 1)) MB"
}

Write-Step "Gom file cài đặt vào $PackageDir"
Copy-Item "$PSScriptRoot\docker-compose.yml" $PackageDir -Force
Copy-Item "$PSScriptRoot\.env.example" $PackageDir -Force
Copy-Item "$PSScriptRoot\config.example.json" $PackageDir -Force
Copy-Item "$PSScriptRoot\nexamed-setup.ps1" $PackageDir -Force
Copy-Item "$PSScriptRoot\nexamed-setup.cmd" $PackageDir -Force
Copy-Item "$PSScriptRoot\nexamed-setup.sh" $PackageDir -Force
Write-Host "Đã copy: docker-compose.yml, .env.example, config.example.json, nexamed-setup.ps1, nexamed-setup.cmd, nexamed-setup.sh"

Write-Step "HOÀN TẤT"
Write-Host "Thư mục sẵn sàng chép sang máy khách: $PackageDir" -ForegroundColor Green
Write-Host "(chỉ chứa file cần thiết — KHÔNG có source code/.git/docs nội bộ nào)" -ForegroundColor Green
Write-Host ""
Write-Host "Bước tiếp theo:" -ForegroundColor Yellow
Write-Host "  1. Nén thư mục $PackageDir thành 1 file .zip (chuột phải -> Send to -> Compressed folder), hoặc copy nguyên thư mục."
Write-Host "  2. Chép file .zip (hoặc thư mục) sang máy khách qua USB/mạng nội bộ."
Write-Host "  3. Tại máy khách: giải nén vào một thư mục cố định rồi double-click nexamed-setup.cmd (Windows) hoặc chạy ./nexamed-setup.sh (Linux/NAS). Trình cài đặt mở trang hướng dẫn trên trình duyệt; chạy lại đúng lệnh đó để nâng cấp."
