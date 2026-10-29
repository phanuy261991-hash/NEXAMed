#!/usr/bin/env node
/**
 * Chạy giao diện dev để mở bằng ĐỊA CHỈ IP LAN qua HTTP thường (mô hình on-prem, `.claude/docs/coding-standards.md` mục "Triển khai on-prem LAN").
 *
 * Việc cần làm tay trước đây (và hay quên khôi phục): bỏ `apiBaseUrl` khỏi `apps/web/public/config.json` (để /api đi CÙNG nguồn gốc qua proxy của Vite, như nginx),
 * đặt `VITE_DEV_API_PROXY`, chạy Vite với `--host 0.0.0.0`, rồi trả `config.json` về như cũ. Lệnh này làm trọn gói và TỰ khôi phục khi thoát
 * (Ctrl+C, đóng terminal, lỗi). Nếu lần trước bị tắt đột ngột (mất điện, kill -9) thì lần chạy kế tiếp khôi phục từ file sao lưu trước khi làm gì khác.
 *
 * Dùng:   pnpm dev:lan          (API phải đang chạy: `pnpm dev` hoặc `pnpm --filter @nexamed/api dev`)
 * Biến:   LAN_WEB_PORT (mặc định 5174, không đổi cổng 5173 của `pnpm dev`), LAN_API_TARGET (mặc định http://localhost:3001)
 * Kiểm tự động trên trang này:  scripts/ui-audit/lan-http-check.cjs
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'apps/web/public/config.json');
const backupPath = `${configPath}.lan-backup`;
const port = process.env.LAN_WEB_PORT || '5174';
const apiTarget = process.env.LAN_API_TARGET || 'http://localhost:3001';

/** Bản `config.json` cho chế độ LAN: giữ mọi khoá khác, BỎ `apiBaseUrl` (rỗng = cùng nguồn gốc). */
export function lanConfigText(originalText) {
  const config = JSON.parse(originalText);
  delete config.apiBaseUrl;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function restore() {
  if (!existsSync(backupPath)) return;
  renameSync(backupPath, configPath);
  console.log('[dev:lan] Đã khôi phục apps/web/public/config.json.');
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

async function warnIfApiDown() {
  try {
    await fetch(apiTarget, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.warn(`[dev:lan] CẢNH BÁO: chưa kết nối được API ở ${apiTarget} — chạy \`pnpm dev\` (hoặc API riêng) trước, nếu không đăng nhập sẽ lỗi.`);
  }
}

async function main() {
  if (existsSync(backupPath)) {
    console.log('[dev:lan] Lần chạy trước bị tắt đột ngột — khôi phục cấu hình cũ trước.');
    restore();
  }
  if (!existsSync(configPath)) {
    console.error('[dev:lan] Không thấy apps/web/public/config.json (sao chép từ config.example.json và điền tenantId trước).');
    return 1;
  }
  let lanConfig;
  try {
    lanConfig = lanConfigText(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(`[dev:lan] config.json không phải JSON hợp lệ: ${err.message}`);
    return 1;
  }

  copyFileSync(configPath, backupPath);
  let restored = false;
  const restoreOnce = () => {
    if (restored) return;
    restored = true;
    try {
      restore();
    } catch (err) {
      console.error(`[dev:lan] KHÔNG khôi phục được config.json — chép tay từ ${backupPath}: ${err.message}`);
    }
  };
  process.on('exit', restoreOnce);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));

  writeFileSync(configPath, lanConfig);
  await warnIfApiDown();

  // shell: true vì pnpm là .cmd trên Windows; lệnh cố định, không ghép đầu vào người dùng (cổng chỉ nhận chữ số).
  if (!/^\d{2,5}$/.test(port)) {
    console.error('[dev:lan] LAN_WEB_PORT phải là số.');
    return 1;
  }
  const child = spawn(`pnpm --filter @nexamed/web exec vite --host 0.0.0.0 --port ${port} --strictPort`, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VITE_DEV_API_PROXY: apiTarget },
  });
  const addresses = lanAddresses();
  console.log('\n[dev:lan] Mở bằng HTTP thường (KHÔNG localhost):');
  for (const ip of addresses) console.log(`          http://${ip}:${port}`);
  if (addresses.length === 0) console.log('          (không thấy địa chỉ LAN — kiểm tra mạng)');
  console.log('[dev:lan] Ctrl+C để dừng — config.json sẽ tự trả về như cũ.\n');

  return await new Promise((done) => {
    child.on('exit', (code) => done(code ?? 0));
    child.on('error', (err) => {
      console.error(`[dev:lan] Không chạy được Vite: ${err.message}`);
      done(1);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then((code) => {
    process.exitCode = code;
  });
}
