/* global require, process, console, fetch */
// Kiểm KHOÁ CHỐNG GHI TRÙNG trên Chrome thật (docs/DECISIONS.md #257): mô phỏng đúng kịch bản "mạng đứt SAU KHI máy chủ đã ghi xong" — lần bấm Lưu đầu tiên được máy chủ xử lý
// thật nhưng phản hồi bị cắt trước khi tới trình duyệt; người dùng đóng hộp thông báo rồi bấm Lưu lại. Thao tác thử: thêm nhà cung cấp (biểu mẫu không có lớp chặn trùng riêng; màn
// bệnh nhân thì đã có cảnh báo "nghi trùng hồ sơ" PAT-03 chặn lần bấm lại nên không chứng minh được khoá). Kỳ vọng: CHỈ MỘT nhà cung cấp, hai yêu cầu mang CÙNG Idempotency-Key,
// lần hai được trả lại kết quả cũ (header Idempotent-Replayed), hộp thông báo hệ thống cho phép "bấm thử lại" (không còn dặn kiểm tra trước). Kỳ vọng: tất cả ĐẠT.
// Chuẩn bị như README.md cùng thư mục: `pnpm dev` (web 5173 + API 3001), `playwright-core` ở thư mục tạm + PLAYWRIGHT_CORE. NÊN chạy trên công ty thử dùng một lần (tạo hồ sơ thật):
//   UI_AUDIT_TENANT=<id công ty thử> node scripts/ui-audit/idempotency-retry.cjs
// (script ghi đè /config.json của web bằng UI_AUDIT_TENANT; bỏ trống = tenant trong config.json hiện có). Biến khác: PLAYWRIGHT_CORE, CHROME_PATH, UI_AUDIT_WEB, UI_AUDIT_API, UI_AUDIT_USER, UI_AUDIT_PASS.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const API = process.env.UI_AUDIT_API || 'http://localhost:3001';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const TENANT = process.env.UI_AUDIT_TENANT || '';

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

async function apiToken(tenantId) {
  const res = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, username: USER, password: PASS }) });
  return (await res.json()).data.accessToken;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});

  let tenantId = TENANT;
  if (TENANT) {
    await page.route('**/config.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: API, tenantId: TENANT }) }));
  } else {
    tenantId = (await (await fetch(`${WEB}/config.json`)).json()).tenantId;
  }

  await page.goto(WEB + '/login');
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');

  const stamp = Date.now().toString().slice(-8);
  const fullName = `ZZIDEM NCC ${stamp}`;
  await page.goto(WEB + '/suppliers');
  await page.getByRole('button', { name: 'Thêm nhà cung cấp' }).first().click();
  await page.waitForSelector('#supplier-name', { timeout: 15000 });
  await page.fill('#supplier-name', fullName);

  const posts = [];
  let first = true;
  await page.route('**/api/v1/suppliers', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const key = req.headers()['idempotency-key'] ?? null;
    if (first) {
      first = false;
      // Máy chủ XỬ LÝ THẬT yêu cầu đầu rồi ta cắt phản hồi: đúng "đã ghi xong nhưng mạng đứt trước khi trả lời".
      const response = await route.fetch();
      posts.push({ key, status: response.status(), replayed: response.headers()['idempotent-replayed'] ?? null, cut: true });
      return route.abort('connectionreset');
    }
    const response = await route.fetch();
    posts.push({ key, status: response.status(), replayed: response.headers()['idempotent-replayed'] ?? null, cut: false });
    return route.fulfill({ response });
  });

  const submit = () => page.locator('form button[type=submit]').click();
  await submit();
  await page.waitForSelector('[role=dialog]:has-text("Chưa kết nối được máy chủ")', { timeout: 15000 });
  const dialogText = await page.locator('[role=dialog]:has-text("Chưa kết nối được máy chủ")').innerText();
  check('mất phản hồi: hộp "Chưa kết nối được máy chủ" hiện ra', /Chưa kết nối được máy chủ/.test(dialogText));
  check('hộp cho phép BẤM THỬ LẠI và nói rõ không ghi trùng (không còn dặn kiểm tra trước)', /Bấm lại là an toàn/.test(dialogText) && /không ghi trùng/.test(dialogText) && !/kiểm tra lại dữ liệu/.test(dialogText), dialogText.replace(/\s+/g, ' ').slice(0, 140));
  await page.locator('[role=dialog]:has-text("Chưa kết nối được máy chủ")').getByText('Đóng', { exact: true }).click();
  await page.waitForSelector('[role=dialog]:has-text("Chưa kết nối được máy chủ")', { state: 'detached', timeout: 5000 });
  check('đóng hộp: dữ liệu đã nhập còn nguyên trong form', (await page.inputValue('#supplier-name')) === fullName);

  await submit();
  await page.waitForSelector('#supplier-name', { state: 'detached', timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle');

  check('hai yêu cầu cùng mang Idempotency-Key là UUID', posts.length === 2 && !!posts[0].key && posts[0].key === posts[1].key && /^[0-9a-f-]{36}$/.test(posts[0].key ?? ''), JSON.stringify(posts));
  check('lần 1 máy chủ ghi thật (200), lần 2 được TRẢ LẠI kết quả cũ (200 + Idempotent-Replayed)', posts[0]?.status === 200 && posts[1]?.status === 200 && posts[0]?.replayed === null && posts[1]?.replayed === 'true');

  const token = await apiToken(tenantId);
  const found = await (await fetch(`${API}/api/v1/suppliers?limit=200`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const count = (found?.data?.items ?? []).filter((x) => x.name === fullName).length;
  check('CHỈ MỘT nhà cung cấp được tạo', count === 1, `tìm thấy ${count}`);

  await ctx.close();
  await browser.close();
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} đạt`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('LỖI KỊCH BẢN:', e.message);
  process.exit(2);
});
