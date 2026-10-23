/* global require, process, console, __dirname, fetch */
// KIỂM MÔ HÌNH ON-PREM LAN trên Chrome thật (docs/DECISIONS.md #257, quy tắc ở CLAUDE.md + .claude/docs/coding-standards.md "Triển khai on-prem LAN"): máy trạm mở `http://<IP máy chủ>`
// — HTTP thường, trình duyệt coi là ngữ cảnh KHÔNG bảo mật (khác `localhost`), nên các API chỉ có ở HTTPS (`crypto.randomUUID`, `navigator.clipboard`...) không tồn tại. Kịch bản:
//   1. xác nhận đúng là ngữ cảnh không bảo mật (không phải localhost);
//   2. đăng nhập + tải lại trang giữ được phiên (cookie làm mới `Secure=false` qua HTTP);
//   3. QUÉT mọi route tĩnh của router, bắt lỗi JS trang (`pageerror`) kiểu "is not a function" / "not defined" — dấu hiệu dùng API chỉ-có-ở-HTTPS không dự phòng;
//   4. thao tác chọn thuốc ở "Đơn thuốc mẫu" (nơi từng gọi thẳng `crypto.randomUUID`).
// Chuẩn bị: API chạy (`pnpm dev` hoặc `node dist/main.js`, cổng 3001) và Vite PHỤ có proxy `/api` giống nginx của gói on-prem, nghe mọi địa chỉ:
//   VITE_DEV_API_PROXY=http://localhost:3001 pnpm exec vite --host 0.0.0.0 --port 5174
// `playwright-core` cài ở thư mục tạm (README.md cùng thư mục). Chạy:
//   PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core node scripts/ui-audit/lan-http-check.cjs
// Biến môi trường: UI_AUDIT_WEB (mặc định http://<IPv4 LAN đầu tiên của máy>:5174), UI_AUDIT_USE_SERVER_CONFIG=1 (dùng config.json của máy chủ), UI_AUDIT_TENANT (id công ty; mặc định tenant trong config.json), UI_AUDIT_USER/PASS, CHROME_PATH.
// Kỳ vọng: tất cả ĐẠT (thoát 0).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

// Ưu tiên dải LAN thật (192.168.x / 10.x) trước dải 172.16–31 (thường là card ảo của WSL/Hyper-V/Docker trên máy dev).
function lanIPv4() {
  const all = Object.values(os.networkInterfaces()).flatMap((infos) => infos ?? []).filter((i) => i.family === 'IPv4' && !i.internal);
  const rank = (a) => (/^192\.168\./.test(a) ? 0 : /^10\./.test(a) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 9);
  return all.map((i) => i.address).filter((a) => rank(a) < 9).sort((a, b) => rank(a) - rank(b))[0] ?? null;
}
const ip = lanIPv4();
const WEB = process.env.UI_AUDIT_WEB || (ip ? `http://${ip}:5174` : null);
if (!WEB) {
  console.error('Không tìm thấy địa chỉ LAN của máy — đặt UI_AUDIT_WEB=http://<IP>:5174');
  process.exit(2);
}
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

// Lấy mọi đường dẫn tĩnh (không có tham số) khai báo trong router
const src = fs.readFileSync(path.join(__dirname, '../../apps/web/src/app/router.tsx'), 'utf8');
const paths = [...src.matchAll(/path: '([^':*]+)'/g)].map((m) => m[1]).filter((p) => !['/login', '/change-password', '/choose-branch', '/'].includes(p));
const routes = [...new Set(paths.map((p) => (p.startsWith('/') ? p : '/' + p)))];

// Lỗi JS nghi do thiếu API chỉ-có-ở-HTTPS (loại trừ lỗi nghiệp vụ/mạng thường gặp).
const SECURE_CONTEXT_ERROR = /is not a function|is not defined|Cannot read properties of undefined|secure context|only available (in|on) secure/i;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  let currentRoute = '(đăng nhập)';
  page.on('pageerror', (e) => pageErrors.push({ route: currentRoute, message: e.message }));

  // Cấu hình giống gói on-prem: `apiBaseUrl` rỗng = cùng nguồn gốc (proxy `/api` của Vite phụ đóng vai nginx).
  // UI_AUDIT_USE_SERVER_CONFIG=1: dùng NGUYÊN `config.json` do máy chủ phục vụ (kiểm gói on-prem thật qua nginx, không ghi đè).
  if (process.env.UI_AUDIT_USE_SERVER_CONFIG !== '1') {
    let tenantId = process.env.UI_AUDIT_TENANT;
    if (!tenantId) {
      const local = process.env.UI_AUDIT_LOCAL_WEB || 'http://localhost:5173';
      tenantId = (await (await fetch(`${local}/config.json`)).json()).tenantId;
    }
    await page.route('**/config.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: '', tenantId }) }));
  }

  await page.goto(WEB + '/login');
  const env = await page.evaluate(() => ({ origin: location.origin, secure: window.isSecureContext, hasRandomUUID: typeof crypto.randomUUID === 'function', hasClipboard: typeof navigator.clipboard !== 'undefined' }));
  check('đang ở ngữ cảnh KHÔNG bảo mật (HTTP qua địa chỉ LAN, không phải localhost)', env.secure === false && !/localhost|127\.0\.0\.1/.test(env.origin), JSON.stringify(env));

  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.press('#password', 'Enter');
  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    check('đăng nhập qua HTTP LAN', true);
  } catch {
    check('đăng nhập qua HTTP LAN', false, 'không vào được sau khi đăng nhập');
    process.exit(1);
  }
  await page.waitForLoadState('networkidle');
  await page.reload();
  await page.waitForLoadState('networkidle');
  check('tải lại trang vẫn giữ phiên (cookie làm mới hoạt động qua HTTP, Secure=false)', !new URL(page.url()).pathname.startsWith('/login'), page.url());

  // Quét route: không lỗi JS kiểu thiếu API chỉ-có-ở-HTTPS
  for (const r of routes) {
    currentRoute = r;
    await page.goto(WEB + r, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(350);
  }
  currentRoute = '(sau quét)';
  const suspicious = pageErrors.filter((e) => SECURE_CONTEXT_ERROR.test(e.message));
  check(`quét ${routes.length} route: không có lỗi JS do thiếu API chỉ-có-ở-HTTPS`, suspicious.length === 0, suspicious.slice(0, 3).map((e) => `${e.route}: ${e.message}`).join(' | '));

  // Chọn thuốc ở "Đơn thuốc mẫu" (từng gọi thẳng crypto.randomUUID)
  currentRoute = '/admin/prescription-templates (chọn thuốc)';
  const before = pageErrors.length;
  await page.goto(WEB + '/admin/prescription-templates');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Thêm mẫu mới' }).first().click();
  const picker = page.locator('input[placeholder^="Gõ tên thuốc"]').first();
  await picker.waitFor({ timeout: 10000 });
  await picker.click();
  await picker.fill('a');
  await page.waitForTimeout(1500);
  const options = page.locator('[role=option]');
  if ((await options.count()) > 0) {
    await options.first().click();
    await page.waitForTimeout(800);
    const added = (await page.locator('[aria-label^="Xoá "]').count()) > 0;
    check('chọn thuốc trong "Đơn thuốc mẫu" thêm được dòng thuốc, không lỗi JS', pageErrors.length === before && added, pageErrors.slice(before).map((e) => e.message).join(' | '));
  } else {
    console.log('BỎ QUA  chọn thuốc: công ty này chưa có thuốc để chọn (đặt UI_AUDIT_TENANT sang công ty có thuốc)');
  }

  await ctx.close();
  await browser.close();
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} đạt`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('LỖI KỊCH BẢN:', e.message);
  process.exit(2);
});
