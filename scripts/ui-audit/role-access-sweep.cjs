/* global require, process, console, __dirname */
// QUÉT QUYỀN THEO VAI TRÒ trên Chrome thật (docs/DECISIONS.md #260): với MỖI vai trò mặc định, đăng nhập rồi mở MỌI route tĩnh của router; báo những trang mà người dùng VÀO ĐƯỢC
// (không phải trang "Không có quyền truy cập") nhưng bên trong lại gặp API trả 403/5xx hoặc hiện khung lỗi "Không tải được…". Đó là lớp lỗi "menu/route cho vào nhưng API từ chối theo
// phạm vi" (vd. lễ tân có `cashier_shift.read` ở phạm vi cá nhân nhưng danh sách phiếu chốt ca chỉ cho quản lý). Đánh dấu thêm trang có mục trong thanh bên (ưu tiên sửa).
// Chuẩn bị: một công ty có sẵn tài khoản `rl.<vai trò>` mật khẩu 12345678 (xem DECISIONS #260) — dựng bằng stack on-prem thử hoặc `pnpm dev`. Biến môi trường:
//   UI_AUDIT_WEB (mặc định http://localhost:5173), PLAYWRIGHT_CORE, CHROME_PATH, UI_AUDIT_ROLES ("receptionist,doctor,..."), UI_AUDIT_PASS (12345678), UI_AUDIT_ONLY (lọc route chứa chuỗi).
// Chạy: node scripts/ui-audit/role-access-sweep.cjs   → in bảng lỗi; thoát 1 nếu còn trang lỗi chưa được miễn trừ ở EXPECTED_DENIED.
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const PASS = process.env.UI_AUDIT_PASS || '12345678';
const ROLES = (process.env.UI_AUDIT_ROLES || 'receptionist,doctor,nurse,lab_technician,imaging_technician,clinic_admin,system_admin').split(',');
const ONLY = process.env.UI_AUDIT_ONLY || '';

// Route tĩnh (không tham số) khai báo trong router
const src = fs.readFileSync(path.join(__dirname, '../../apps/web/src/app/router.tsx'), 'utf8');
const paths = [...src.matchAll(/path: '([^':*]+)'/g)].map((m) => m[1]).filter((p) => !['/login', '/change-password', '/choose-branch', '/'].includes(p));
const routes = [...new Set(paths.map((p) => (p.startsWith('/') ? p : '/' + p)))].filter((r) => !ONLY || r.includes(ONLY));

const ERROR_TEXT = /Không tải được|Không thể tải|Đã xảy ra lỗi|Tải dữ liệu thất bại/;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const findings = [];
  for (const role of ROLES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', () => {});
    let current = null;
    const bad = new Map();
    page.on('response', (res) => {
      const url = res.url();
      if (!current || !url.includes('/api/v1/')) return;
      const s = res.status();
      if (s === 403 || s >= 500) {
        const p = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '').split('?')[0];
        bad.set(`${res.request().method()} ${p} -> ${s}`, true);
      }
    });
    await page.goto(WEB + '/login');
    await page.fill('#username', `rl.${role}`);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    try {
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    } catch {
      console.log(`[${role}] KHÔNG đăng nhập được — bỏ qua`);
      await ctx.close();
      continue;
    }
    await page.waitForLoadState('networkidle');
    // Mở hết nhóm trong thanh bên để biết những liên kết nào thật sự hiện cho vai trò này
    for (let i = 0; i < 3; i += 1) {
      const toggles = page.locator('nav button[aria-expanded="false"]');
      const n = await toggles.count();
      for (let k = 0; k < n; k += 1) await toggles.nth(k).click({ timeout: 1000 }).catch(() => {});
    }
    const menuHrefs = new Set(await page.$$eval('nav a[href]', (as) => as.map((a) => new URL(a.href).pathname)));

    for (const route of routes) {
      bad.clear();
      current = route;
      await page.goto(WEB + route, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(500);
      const denied = (await page.locator('#access-denied-title').count()) > 0;
      if (denied) continue; // route chặn đúng cách bằng trang "không có quyền"
      // Bỏ khung báo tĩnh `#boot-fallback` (luôn nằm sẵn trong trang, ẩn; chứa chữ "Không tải được ứng dụng") — nếu không mọi trang đều bị báo nhầm.
      const text = await page.evaluate(() => {
        const clone = (document.querySelector('main') || document.body).cloneNode(true);
        clone.querySelectorAll('#boot-fallback').forEach((e) => e.remove());
        return clone.innerText ?? clone.textContent ?? '';
      });
      const banner = ERROR_TEXT.exec(text)?.[0] ?? null;
      const alerts = await page.$$eval('[role=alert]', (els) => els.filter((e) => !e.closest('#boot-fallback')).map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 90)));
      if (bad.size > 0 || banner || alerts.length > 0) {
        findings.push({ role, route, inMenu: menuHrefs.has(route), apis: [...bad.keys()], banner: banner ?? alerts[0] ?? '' });
      }
    }
    await ctx.close();
  }
  await browser.close();

  if (findings.length === 0) {
    console.log(`\nKhông trang nào (của ${ROLES.length} vai trò × ${routes.length} route) vừa cho vào vừa lỗi quyền. ĐẠT.`);
    return;
  }
  console.log(`\nCÓ ${findings.length} trang CHO VÀO nhưng gặp lỗi quyền/máy chủ:\n`);
  for (const f of findings) {
    console.log(`- [${f.role}] ${f.route}${f.inMenu ? '  (CÓ trong thanh bên)' : ''}`);
    for (const a of f.apis) console.log(`      ${a}`);
    if (f.banner) console.log(`      khung lỗi: ${f.banner}`);
  }
  process.exitCode = 1;
})().catch((e) => {
  console.error('LỖI KỊCH BẢN:', e.message);
  process.exit(2);
});
