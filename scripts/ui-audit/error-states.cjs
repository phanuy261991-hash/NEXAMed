/* global require, process, console */
// Kiểm CÁC TRẠNG THÁI LỖI của giao diện trên Chrome thật (docs/DECISIONS.md #255, ui-guidelines mục 17/17b): URL lạ → màn "Không mở được trang này"; lưu bệnh nhân gặp 503 →
// hộp thông báo hệ thống và dữ liệu form còn nguyên; mất mạng → hộp; lỗi nghiệp vụ 409 → hiện tại chỗ KHÔNG bật hộp; thông điệp tiếng Anh của máy chủ → câu tiếng Việt chuẩn hoá;
// hết phiên → lời nhắn ở màn đăng nhập (chỉ một lần); mã khởi động không tải được → khung báo tĩnh; bình thường → khung ẩn. Kỳ vọng: 15/15 đạt.
// Chuẩn bị giống layout-audit.cjs (README.md cùng thư mục): `pnpm dev` (web 5173 + API 3001), tenant dev, `playwright-core` cài ở thư mục tạm + PLAYWRIGHT_CORE.
// Biến môi trường: PLAYWRIGHT_CORE, CHROME_PATH, UI_AUDIT_WEB, UI_AUDIT_USER, UI_AUDIT_PASS, UI_AUDIT_OUT (nơi lưu ảnh chụp — mặc định thư mục tạm của hệ điều hành, KHÔNG để trong repo).
// Chạy: node scripts/ui-audit/error-states.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const OUT = path.join(process.env.UI_AUDIT_OUT || require('os').tmpdir(), 'nexamed-error-shots');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Bad Gateway|Internal Server|NOT_FOUND|SERVICE_UNAVAILABLE|ECONN|\b50[0-4]\b|\b404\b|stack/;

async function login(page) {
  await page.goto(WEB + '/login');
  await page.fill('#username', process.env.UI_AUDIT_USER || 'dev.admin');
  await page.fill('#password', process.env.UI_AUDIT_PASS || 'Dev@12345');
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

async function fillPatientForm(page) {
  await page.goto(WEB + '/patients/new');
  await page.waitForSelector('#fullName', { timeout: 15000 });
  await page.fill('#fullName', 'Bệnh nhân kiểm thử lỗi');
  await page.fill('#phone', '0912345678');
  await page.fill('#dob', '01/01/1990');
  await page.click('#gender');
  await page.getByRole('option', { name: 'Nam', exact: true }).first().click();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const newPage = async (w = 1440, h = 900) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', () => {});
    return { ctx, page };
  };

  // S1. Đường dẫn lạ -> màn thông báo (không 404), trong khung ứng dụng
  {
    const { ctx, page } = await newPage();
    await login(page);
    await page.goto(WEB + '/duong-dan-khong-co-that');
    await page.waitForSelector('#app-error-title', { timeout: 15000 });
    const title = (await page.textContent('#app-error-title'))?.trim();
    const text = await page.evaluate(() => document.body.innerText);
    check('S1 URL lạ: tiêu đề thông báo', title === 'Không mở được trang này', title);
    check('S1 URL lạ: không còn chữ "404"/"Không tìm thấy trang"', !/404|Không tìm thấy trang/.test(text));
    check('S1 URL lạ: có nút "Về trang chủ" và "Quay lại trang trước", thanh bên còn nguyên', (await page.getByRole('button', { name: 'Về trang chủ' }).isVisible()) && (await page.getByRole('button', { name: 'Quay lại trang trước' }).isVisible()) && (await page.locator('nav').count()) > 0);
    await page.screenshot({ path: path.join(OUT, 'S1-url-la.png') });
    await ctx.close();
  }

  // S2. Lưu bệnh nhân gặp lỗi 503 -> hộp thông báo, dữ liệu đang nhập còn nguyên
  {
    const { ctx, page } = await newPage();
    await login(page);
    await fillPatientForm(page);
    await page.route('**/api/v1/patients', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Hệ thống đang khởi động hoặc tạm thời không truy cập được. Vui lòng thử lại sau ít phút.' } }) }) : route.continue()));
    await page.click('button[type=submit]');
    await page.waitForSelector('[role=dialog]', { timeout: 10000 });
    const dialogText = await page.locator('[role=dialog]').innerText();
    check('S2 lỗi 503: hộp thông báo "Hệ thống tạm thời không truy cập được"', /Hệ thống tạm thời không truy cập được/.test(dialogText));
    check('S2 lỗi 503: nói rõ dữ liệu đang nhập còn nguyên', /vẫn còn nguyên/.test(dialogText));
    check('S2 lỗi 503: không lọt mã/lỗi thô', !FORBIDDEN.test(dialogText), dialogText.replace(/\s+/g, ' ').slice(0, 80));
    await page.screenshot({ path: path.join(OUT, 'S2-loi-503.png') });
    await page.getByRole('button', { name: 'Đóng', exact: true }).first().click();
    await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 5000 });
    check('S2 sau khi đóng hộp: dữ liệu đã nhập VẪN CÒN trong form', (await page.inputValue('#fullName')) === 'Bệnh nhân kiểm thử lỗi' && (await page.inputValue('#phone')) === '0912345678');
    await ctx.close();
  }

  // S3. Mất mạng khi lưu -> hộp thông báo "Không kết nối được máy chủ"
  {
    const { ctx, page } = await newPage();
    await login(page);
    await fillPatientForm(page);
    await page.route('**/api/v1/patients', (route) => (route.request().method() === 'POST' ? route.abort('connectionrefused') : route.continue()));
    await page.click('button[type=submit]');
    await page.waitForSelector('[role=dialog]', { timeout: 10000 });
    const t = await page.locator('[role=dialog]').innerText();
    check('S3 mất mạng: hộp thông báo "Không kết nối được máy chủ"', /Không kết nối được máy chủ/.test(t));
    check('S3 mất mạng: không lọt chữ thô', !FORBIDDEN.test(t));
    await ctx.close();
  }

  // S4. Lỗi NGHIỆP VỤ 409 tiếng Việt -> hiện TẠI CHỖ, KHÔNG bật hộp
  {
    const { ctx, page } = await newPage();
    await login(page);
    await fillPatientForm(page);
    await page.route('**/api/v1/patients', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'PATIENT_DUPLICATE', message: 'Số điện thoại này đã có hồ sơ bệnh nhân.' } }) }) : route.continue()));
    await page.click('button[type=submit]');
    await page.waitForSelector('text=Số điện thoại này đã có hồ sơ bệnh nhân.', { timeout: 10000 });
    check('S4 lỗi nghiệp vụ 409: hiện tại chỗ và KHÔNG có hộp thông báo hệ thống', (await page.locator('[role=dialog]').count()) === 0);
    await ctx.close();
  }

  // S5. Máy chủ trả thông điệp TIẾNG ANH/kỹ thuật -> giao diện chỉ hiện câu tiếng Việt chuẩn hoá
  {
    const { ctx, page } = await newPage();
    await login(page);
    await fillPatientForm(page);
    await page.route('**/api/v1/patients', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Validation failed (uuid is expected)' } }) }) : route.continue()));
    await page.click('button[type=submit]');
    await page.waitForSelector('text=Dữ liệu gửi lên chưa hợp lệ', { timeout: 10000 });
    const text = await page.evaluate(() => document.body.innerText);
    check('S5 thông điệp tiếng Anh của máy chủ bị thay bằng câu tiếng Việt', !/Validation failed|uuid/.test(text) && /Dữ liệu gửi lên chưa hợp lệ/.test(text));
    await ctx.close();
  }

  // S6. Hết phiên -> màn đăng nhập có lời giải thích
  {
    const { ctx, page } = await newPage();
    await login(page);
    await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Phiên đăng nhập không hợp lệ.' } }) }));
    await page.route('**/api/v1/patients?*', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Token hết hạn.' } }) }));
    await page.click('a[href="/patients"]').catch(async () => { await page.evaluate(() => { window.history.pushState({}, '', '/patients'); window.dispatchEvent(new PopStateEvent('popstate')); }); });
    await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 15000 });
    await page.waitForSelector('#username', { timeout: 10000 });
    const t = await page.evaluate(() => document.body.innerText);
    check('S6 hết phiên: về màn đăng nhập kèm "Phiên làm việc đã hết hạn"', /Phiên làm việc đã hết hạn/.test(t));
    await page.screenshot({ path: path.join(OUT, 'S6-het-phien.png') });
    await page.reload();
    await page.waitForSelector('#username', { timeout: 10000 });
    const t2 = await page.evaluate(() => document.body.innerText);
    check('S6 lời nhắn chỉ hiện MỘT lần (tải lại không còn)', !/Phiên làm việc đã hết hạn/.test(t2));
    await ctx.close();
  }

  // S7. Mã khởi động không tải được -> khung báo tĩnh (trước đây trang trắng)
  {
    const { ctx, page } = await newPage();
    await page.route('**/src/app/main.tsx*', (route) => route.abort());
    await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#boot-fallback:not([hidden])', { timeout: 8000 });
    const t = await page.evaluate(() => document.body.innerText);
    check('S7 mã khởi động hỏng: khung báo "Không tải được ứng dụng" thay trang trắng', /Không tải được ứng dụng/.test(t) && /Tải lại trang/.test(t));
    await page.screenshot({ path: path.join(OUT, 'S7-khung-tinh.png') });
    await ctx.close();
  }

  // S8. Ứng dụng bình thường: khung tĩnh KHÔNG hiện
  {
    const { ctx, page } = await newPage();
    await page.goto(WEB + '/login');
    await page.waitForSelector('#username', { timeout: 15000 });
    check('S8 bình thường: khung báo tĩnh ẩn', await page.locator('#boot-fallback').isHidden());
    await ctx.close();
  }

  await browser.close();
  const bad = results.filter((r) => !r).length;
  console.log(`\nTổng: ${results.length - bad}/${results.length} đạt`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('Lỗi chạy:', e.message); process.exit(2); });
