/* global require, process, console */
// KIỂM dòng "N chỉ số ngoài khoảng" ở Tổng quan bác sĩ (docs/DECISIONS.md #286 bổ sung) trên Chrome thật qua IP LAN. Tài khoản bác sĩ dev có thể không có kết quả chưa xem, nên kịch bản lấy
// phản hồi THẬT của máy chủ rồi thay khối `unseenResults` bằng hai dòng giả lập (một có 3 chỉ số ngoài khoảng, một không có), để kiểm phần hiển thị: dòng có chỉ số hiện chữ đỏ
// "3 chỉ số ngoài khoảng", dòng không có thì không hiện gì thêm, đúng chính tả số ít/nhiều, không lộ chữ kỹ thuật.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/doctor-abnormal-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5174';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'doctor-abnormal-check');
fs.mkdirSync(OUT, { recursive: true });
const USER = process.env.UI_AUDIT_USER || 'rl.doctor';
const PASS = process.env.UI_AUDIT_PASS || '12345678';

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  try {
    await page.route('**/api/v1/reports/dashboard/doctor', async (route) => {
      const real = await route.fetch();
      const body = await real.json();
      body.data.unseenResults = {
        count: 2,
        items: [
          { name: 'Công thức máu', patientName: 'Nguyễn Thị Mai', resultedAt: '2026-11-05T02:10:00.000Z', abnormalCount: 3 },
          { name: 'Đường huyết lúc đói', patientName: 'Trần Văn Bình', resultedAt: '2026-11-05T02:40:00.000Z', abnormalCount: 0 },
        ],
        moreCount: 0,
      };
      await route.fulfill({ response: real, json: body });
    });
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    await page.goto(WEB + '/');
    await page.getByRole('heading', { name: 'Kết quả mới chưa xem' }).waitFor({ timeout: 20000 }).catch(() => undefined);
    const list = page.getByRole('list', { name: 'Kết quả mới chưa xem' });
    await list.waitFor({ timeout: 20000 });
    const text = await list.innerText();
    check('dòng có chỉ số bất thường hiện "3 chỉ số ngoài khoảng"', /Công thức máu[\s\S]*Nguyễn Thị Mai[\s\S]*3 chỉ số ngoài khoảng/.test(text), text.replace(/\s+/g, ' '));
    check('dòng không có chỉ số bất thường KHÔNG hiện chữ ngoài khoảng', !/Trần Văn Bình[^\n]*ngoài khoảng/.test(text));
    const red = await page.locator('span', { hasText: '3 chỉ số ngoài khoảng' }).first().evaluate((el) => getComputedStyle(el).color);
    check('chữ "ngoài khoảng" tô màu đỏ (rose-700)', /rgb\(190, 18, 60\)|oklch\(0\.51\d* 0\.22\d* 16\.9/.test(red), red);
    check('không lộ chữ kỹ thuật', !/undefined|NaN|abnormalCount|null/.test(text));
    await page.screenshot({ path: path.join(OUT, 'tong-quan-bac-si-chi-so.png') });
    check('không có lỗi JS trang', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
  } catch (e) {
    check('kịch bản chạy hết không ngoại lệ', false, String(e.stack || e).slice(0, 300));
  }
  await browser.close();
  const bad = results.filter((r) => !r).length;
  console.log(`\n${results.length - bad}/${results.length} đạt`);
  process.exit(bad === 0 ? 0 : 1);
})();
