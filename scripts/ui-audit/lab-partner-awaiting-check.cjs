/* global require, process, console, window, document, fetch, FormData, Blob */
// KIỂM khối "Kết quả đối tác chờ duyệt" ở màn khám và Tổng quan bác sĩ (docs/DECISIONS.md #291 bổ sung 6) trên Chrome thật qua IP LAN (HTTP — #257).
// Cần dữ liệu thử KIEM-GM mới do seed tạo (bác sĩ của các lượt khám = tài khoản đăng nhập): UI_AUDIT_RUN=<mã>, UI_AUDIT_ENC_NGOC / UI_AUDIT_ENC_KHOI = id lượt khám.
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_RUN=<mã> UI_AUDIT_ENC_NGOC=<id> UI_AUDIT_ENC_KHOI=<id> UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/lab-partner-awaiting-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const RUN = process.env.UI_AUDIT_RUN || '';
const ENC_NGOC = process.env.UI_AUDIT_ENC_NGOC || '';
const ENC_KHOI = process.env.UI_AUDIT_ENC_KHOI || '';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'lab-partner-awaiting-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|ECONN|\b50[0-4]\b|\b404\b|stack/;
const N = (label) => `${label} ${RUN}`;

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

async function api() {
  const tenant = (await (await fetch(WEB + '/config.json')).json()).tenantId;
  const lg = await (await fetch(WEB + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: tenant, username: USER, password: PASS }) })).json();
  const auth = { authorization: `Bearer ${lg.data.accessToken}` };
  const json = { ...auth, 'content-type': 'application/json' };
  return { auth, json };
}

// Gửi các mẫu RUN cho đối tác rồi nhận kết quả (một tệp PDF) cho Trương Bích Ngọc + Cao Minh Khôi — bằng API (đã kiểm riêng ở lab-partner-result-check.cjs).
async function prepare() {
  const { auth, json } = await api();
  const pend = (await (await fetch(WEB + '/api/v1/lab-partner-dispatch/pending?q=' + encodeURIComponent(RUN), { headers: json })).json()).data.items;
  const partner = pend[0].options[0].supplierId;
  const send = await fetch(WEB + '/api/v1/lab-partner-dispatch', { method: 'POST', headers: json, body: JSON.stringify({ supplierId: partner, itemIds: pend.filter((r) => r.options.some((o) => o.supplierId === partner)).map((r) => r.itemId) }) });
  const sent = (await (await fetch(WEB + '/api/v1/lab-partner-dispatch/sent?q=' + encodeURIComponent(RUN), { headers: json })).json()).data.items;
  const ids = sent.filter((r) => r.patientName.includes(N('Trương Bích Ngọc')) || r.patientName.includes(N('Cao Minh Khôi'))).map((r) => r.itemId);
  const form = new FormData();
  form.append('data', JSON.stringify({ itemIds: ids }));
  form.append('file', new Blob(['%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'], { type: 'application/pdf' }), 'KQ_BinhMinh.pdf');
  const recv = await fetch(WEB + '/api/v1/lab-partner-dispatch/results', { method: 'POST', headers: auth, body: form });
  return { sendStatus: send.status, recvStatus: recv.status, count: ids.length };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  try {
    check('có mã dữ liệu thử và id lượt khám', RUN !== '' && ENC_NGOC !== '' && ENC_KHOI !== '');
    const prep = await prepare();
    check('chuẩn bị: gửi mẫu và nhận kết quả PDF cho 2 bệnh nhân (API)', prep.sendStatus === 200 && prep.recvStatus === 200 && prep.count === 2, JSON.stringify(prep));

    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    await page.waitForLoadState('networkidle');

    // ── Tổng quan bác sĩ ──
    await page.goto(WEB + '/');
    await page.waitForLoadState('networkidle');
    const doctorToggle = page.getByRole('button', { name: 'Bác sĩ', exact: true });
    if ((await doctorToggle.count()) > 0) await doctorToggle.click();
    const list = page.getByRole('list', { name: 'Kết quả đối tác chờ duyệt' });
    await list.waitFor({ timeout: 20000 });
    const listText = await list.innerText();
    check('Tổng quan bác sĩ: khối "Kết quả đối tác chờ duyệt" liệt kê cả hai bệnh nhân', listText.includes(N('Trương Bích Ngọc')) && listText.includes(N('Cao Minh Khôi')), listText.replace(/\s+/g, ' ').slice(0, 160));
    check('khối có nút "Xem và duyệt" và liên kết "Mở danh sách"', (await list.getByRole('button', { name: /Xem và duyệt/ }).count()) >= 2 && (await page.getByRole('link', { name: 'Mở danh sách' }).count()) >= 1);
    await page.screenshot({ path: path.join(OUT, '01-tong-quan-bac-si.png') });
    await list.locator('li', { hasText: N('Trương Bích Ngọc') }).getByRole('button', { name: /Xem và duyệt/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Kết quả của đối tác' });
    await dlg.waitFor({ timeout: 10000 });
    await dlg.getByRole('button', { name: 'Duyệt kết quả' }).click();
    await page.waitForTimeout(1500);
    check('duyệt từ Tổng quan: hộp đóng, bệnh nhân rời khối', !(await dlg.isVisible().catch(() => false)) && !(await list.innerText().catch(() => '')).includes(N('Trương Bích Ngọc')));

    // lỗi tải khối: thông báo + Thử lại
    await page.route('**/api/v1/lab-partner-dispatch/awaiting**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) }));
    await page.reload();
    await page.waitForLoadState('networkidle');
    if ((await doctorToggle.count()) > 0) await doctorToggle.click();
    await page.getByText('Không tải được kết quả đối tác chờ duyệt').first().waitFor({ timeout: 30000 }).catch(() => {});
    const dashErr = await page.locator('body').innerText();
    check('Tổng quan: tải lỗi 500 → thông báo tiếng Việt có "Thử lại", không lộ mã', /Không tải được kết quả đối tác chờ duyệt/.test(dashErr) && !/Internal Server|INTERNAL/.test(dashErr));
    await page.screenshot({ path: path.join(OUT, '02-tong-quan-loi.png') });
    await page.unroute('**/api/v1/lab-partner-dispatch/awaiting**');

    // ── Màn khám ──
    await page.goto(`${WEB}/encounters/${ENC_KHOI}`);
    await page.getByRole('tab', { name: /Chỉ định cận lâm sàng/ }).or(page.getByRole('button', { name: /Chỉ định cận lâm sàng/ })).first().click();
    const section = page.getByRole('region', { name: 'Kết quả đối tác chờ duyệt' });
    await section.waitFor({ timeout: 20000 });
    const secText = await section.innerText();
    check('màn khám (tab Chỉ định): hiện "Đã có kết quả đối tác, chờ duyệt (1)" kèm dịch vụ và đối tác', /Đã có kết quả đối tác, chờ duyệt \(1\)/.test(secText) && /TSH/.test(secText) && /Bình Minh/.test(secText), secText.replace(/\s+/g, ' ').slice(0, 160));
    check('có nút "Xem và duyệt" ngay trong màn khám', (await section.getByRole('button', { name: 'Xem và duyệt' }).count()) === 1);
    await page.screenshot({ path: path.join(OUT, '03-man-kham-chi-dinh.png') });
    // tab Kết quả cũng thấy khối này
    await page.getByRole('tab', { name: /Kết quả cận lâm sàng/ }).or(page.getByRole('button', { name: /Kết quả cận lâm sàng/ })).first().click();
    check('tab "Kết quả cận lâm sàng" cũng hiện khối chờ duyệt', await page.getByRole('region', { name: 'Kết quả đối tác chờ duyệt' }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
    await page.getByRole('region', { name: 'Kết quả đối tác chờ duyệt' }).getByRole('button', { name: 'Xem và duyệt' }).click();
    await dlg.waitFor({ timeout: 10000 });
    check('hộp duyệt mở đúng bệnh nhân từ màn khám', (await dlg.innerText()).includes(N('Cao Minh Khôi')));
    await dlg.getByRole('button', { name: 'Duyệt kết quả' }).click();
    await page.waitForTimeout(1500);
    check('duyệt trong màn khám: khối biến mất (không còn việc chờ)', (await page.getByRole('region', { name: 'Kết quả đối tác chờ duyệt' }).count()) === 0);
    await page.screenshot({ path: path.join(OUT, '04-sau-duyet.png') });

    // lượt khám khác (đã duyệt ở trên) và lỗi tải trong màn khám
    await page.route('**/api/v1/lab-partner-dispatch/awaiting**', (route) => route.abort('connectionreset'));
    await page.reload();
    await page.getByRole('tab', { name: /Chỉ định cận lâm sàng/ }).or(page.getByRole('button', { name: /Chỉ định cận lâm sàng/ })).first().click();
    await page.waitForTimeout(4000);
    const encErr = await page.locator('body').innerText();
    check('màn khám: mất mạng khi tải khối → không vỡ trang, không lộ mã lỗi', !FORBIDDEN.test(encErr.replace(/Chỉ định cận lâm sàng/g, '')) && /Chỉ định cận lâm sàng/.test(encErr));
    await page.unroute('**/api/v1/lab-partner-dispatch/awaiting**');

    check('không có lỗi JavaScript', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
  } catch (e) {
    check('kịch bản chạy hết không ngoại lệ', false, e.message.split('\n')[0]);
    await page.screenshot({ path: path.join(OUT, 'loi.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
  const pass = results.filter(Boolean).length;
  console.log(`\nKẾT QUẢ: ${pass}/${results.length} đạt. Ảnh: ${OUT}`);
  process.exit(pass === results.length ? 0 : 1);
})();
