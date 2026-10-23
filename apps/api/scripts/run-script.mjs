// Chạy một script TypeScript cần DI của NestJS (vd. `NestFactory.createApplicationContext(AppModule)`):
//   pnpm --filter @nexamed/api run script:run scripts/ten-script.ts [tham số...]
//
// KHÔNG dùng `tsx`: esbuild không phát `design:paramtypes` nên DI của Nest âm thầm thành `undefined`. `@swc-node/register` cũng không
// dùng được (import vòng giữa các service lỗi "before initialization" ở dạng CommonJS của swc). Ở đây biên dịch bằng chính `tsc` như bản
// production (docs/DECISIONS.md #252) vào `.scripts-dist` (có build tăng dần nên lần sau nhanh) rồi chạy bằng `node`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [scriptArg, ...scriptArgs] = process.argv.slice(2);

if (!scriptArg) {
  console.error('Cách dùng: pnpm --filter @nexamed/api run script:run scripts/ten-script.ts [tham số...]');
  process.exit(2);
}
const scriptPath = resolve(apiDir, scriptArg);
const rel = relative(apiDir, scriptPath);
if (rel.startsWith('..') || !rel.startsWith(`scripts${sep}`) || !rel.endsWith('.ts') || !existsSync(scriptPath)) {
  console.error(`Chỉ chạy được file .ts nằm trong apps/api/scripts (đang nhận: ${scriptArg}).`);
  process.exit(2);
}

// Cấu hình tạm chỉ gồm script được chọn (tsc tự theo import) — KHÔNG quét cả thư mục scripts: các script cũ chạy bằng `tsx` nên
// chưa từng được kiểm kiểu và có thể có lỗi kiểu không liên quan.
const outDir = join(apiDir, '.scripts-dist');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'tsconfig.run.json'),
  JSON.stringify({
    extends: '../tsconfig.json',
    compilerOptions: { outDir: '.', rootDir: '..', incremental: true, tsBuildInfoFile: './.tsbuildinfo' },
    include: ['../src/**/*.d.ts'],
    files: [`../${rel.split(sep).join('/')}`],
  }),
);

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const build = spawnSync(process.execPath, [tsc, '-p', join(outDir, 'tsconfig.run.json')], { cwd: apiDir, stdio: 'inherit' });
if (build.status !== 0) {
  console.error('Biên dịch thất bại — sửa lỗi kiểu ở trên rồi chạy lại.');
  process.exit(build.status ?? 1);
}

const compiled = join(apiDir, '.scripts-dist', rel.replace(/\.ts$/, '.js'));
const run = spawnSync(process.execPath, [compiled, ...scriptArgs], { cwd: apiDir, stdio: 'inherit' });
process.exit(run.status ?? 1);
