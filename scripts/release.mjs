#!/usr/bin/env node
/**
 * Script phát hành phiên bản (docs/DECISIONS.md #236). Dùng:
 *
 *   node scripts/release.mjs <major|minor|patch|beta|X.Y.Z[-beta.N]> [--dry-run]
 *
 * Việc script làm (theo thứ tự, dừng ngay khi một bước không đạt):
 *   1. Tính số phiên bản kế tiếp từ `package.json` gốc (nguồn sự thật DUY NHẤT của số phiên bản) bằng hàm SemVer dùng chung ở `packages/core`.
 *   2. Kiểm cây làm việc git sạch, chưa có tag `v<phiên bản>`, và đã có ghi chú phát hành hợp lệ `apps/api/release-notes/<phiên bản>.json`.
 *   3. Ghi số phiên bản vào `package.json` gốc và 4 gói con, tạo commit `chore(release): v<phiên bản>` và tag `v<phiên bản>`.
 * KHÔNG tự push và KHÔNG tự dựng ảnh — in ra lệnh kế tiếp để bạn kiểm tra rồi chạy. Cần `packages/core` và `packages/shared` đã build (`pnpm --filter @nexamed/core --filter @nexamed/shared build`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const PACKAGE_FILES = ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'packages/core/package.json', 'packages/shared/package.json'];

function fail(message) {
  console.error(`Lỗi: ${message}`);
  process.exit(1);
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function loadDist(pkg) {
  const entry = join(root, 'packages', pkg, 'dist', 'index.js');
  if (!existsSync(entry)) fail(`Chưa build packages/${pkg}. Chạy: pnpm --filter @nexamed/${pkg} build`);
  return require(entry);
}

function readVersion(file) {
  const match = /"version"\s*:\s*"([^"]+)"/.exec(readFileSync(join(root, file), 'utf8'));
  if (!match) fail(`Không tìm thấy trường "version" trong ${file}`);
  return match[1];
}

function writeVersion(file, version) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  // Chỉ thay trường "version" ĐẦU TIÊN (của chính gói) — giữ nguyên định dạng và kiểu xuống dòng của file.
  writeFileSync(path, text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = args.find((a) => !a.startsWith('--'));
if (!target) fail('Thiếu tham số. Dùng: node scripts/release.mjs <major|minor|patch|beta|X.Y.Z[-beta.N]> [--dry-run]');

const { bumpVersion, compareSemver, isValidSemver, parseSemver, channelOfVersion } = loadDist('core');
const { releaseNotesSchema } = loadDist('shared');

const current = readVersion('package.json');
let next;
if (['major', 'minor', 'patch', 'beta'].includes(target)) {
  next = bumpVersion(current, target);
} else {
  if (!isValidSemver(target) || parseSemver(target).build !== null) fail(`"${target}" không phải số phiên bản SemVer hợp lệ (không kèm "+thông tin bản dựng" — mã bản dựng do bước dựng ảnh tự thêm).`);
  next = target;
}
// Chốt LẦN ĐẦU chính số hiện tại (bản nền chưa từng có tag): chỉ tạo tag, không đổi số. Mọi trường hợp khác phiên bản mới phải lớn hơn.
const firstRelease = next === current && git('tag', '--list', `v${current}`) === '';
if (!firstRelease && compareSemver(next, current) <= 0) fail(`Phiên bản mới ${next} phải lớn hơn phiên bản hiện tại ${current}.`);

for (const file of PACKAGE_FILES) {
  const v = readVersion(file);
  if (v !== current) fail(`${file} đang ở ${v}, lệch với package.json gốc (${current}). Đưa các gói về cùng một số trước khi phát hành.`);
}

const notesPath = join(root, 'apps', 'api', 'release-notes', `${next}.json`);
if (!existsSync(notesPath)) fail(`Thiếu ghi chú phát hành: apps/api/release-notes/${next}.json (nhóm "features / improvements / fixes", viết cho người dùng cuối).`);
let notes;
try {
  notes = releaseNotesSchema.parse(JSON.parse(readFileSync(notesPath, 'utf8')));
} catch (error) {
  fail(`Ghi chú phát hành ${next}.json sai định dạng: ${error.message}`);
}
if (notes.version !== next) fail(`Ghi chú phát hành ghi phiên bản ${notes.version}, khác ${next}.`);
if (notes.features.length + notes.improvements.length + notes.fixes.length === 0) fail('Ghi chú phát hành đang trống.');

if (!dryRun) {
  if (git('status', '--porcelain') !== '') fail('Cây làm việc git chưa sạch. Commit hoặc cất các thay đổi trước khi phát hành.');
  if (git('tag', '--list', `v${next}`) !== '') fail(`Đã có tag v${next}.`);
}

const channel = channelOfVersion(next);
console.log(firstRelease ? `Phiên bản: chốt lần đầu ${next}` : `Phiên bản: ${current} → ${next} (kênh ${channel === 'beta' ? 'Thử nghiệm' : 'Ổn định'})`);
if (dryRun) {
  console.log('Chế độ chạy thử (--dry-run): các kiểm tra đều đạt, chưa ghi gì.');
  process.exit(0);
}

if (!firstRelease) {
  for (const file of PACKAGE_FILES) writeVersion(file, next);
  git('add', ...PACKAGE_FILES);
  git('commit', '-m', `chore(release): v${next}`);
}
git('tag', '-a', `v${next}`, '-m', `NEXAMed ${next}`);

console.log(`\nĐã ghi phiên bản, tạo commit và tag v${next}. Bước kế tiếp (chạy tay sau khi kiểm tra):`);
console.log('  1. git push origin master --tags');
console.log(`  2. Dựng gói cài đặt: deploy/on-prem/build-and-export.ps1 -Version ${next}`);
