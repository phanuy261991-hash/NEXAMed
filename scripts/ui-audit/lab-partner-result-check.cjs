/* global require, process, console, document, window, fetch */
// KIỂM giao diện "Gửi mẫu đối tác" — NHẬN kết quả PDF, duyệt, trả lại, đối tác không nhận (docs/DECISIONS.md #291 bổ sung 5) trên Chrome thật qua IP LAN (HTTP — #257).
// Cần dữ liệu thử KIEM-GM mới (mỗi mẫu chỉ dùng một lần): UI_AUDIT_RUN=<mã lần tạo>. Gửi mẫu đi dùng API (đã kiểm ở lab-partner-send-check.cjs), phần còn lại bằng giao diện.
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_RUN=<mã> UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/lab-partner-result-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const RUN = process.env.UI_AUDIT_RUN || '';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'lab-partner-result-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|LAB_PARTNER|ECONN|\b50[0-4]\b|\b404\b|stack/;
const PDF_PATH = path.join(OUT, 'KQ_BinhMinh.pdf');
fs.writeFileSync(PDF_PATH, '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const TXT_PATH = path.join(OUT, 'ghi-chu.txt');
fs.writeFileSync(TXT_PATH, 'không phải pdf');

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}
const N = (label) => (RUN ? `${label} ${RUN}` : label);
const rowOf = (page, text) => page.locator('[role=row]', { hasText: text }).first();

async function login(page, user, pass) {
  await page.goto(WEB + '/login');
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

async function apiSendAll(user, pass) {
  const tenant = (await (await fetch(WEB + '/config.json')).json()).tenantId;
  const lg = await (await fetch(WEB + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: tenant, username: user, password: pass }) })).json();
  const H = { 'content-type': 'application/json', authorization: `Bearer ${lg.data.accessToken}` };
  const pend = (await (await fetch(WEB + '/api/v1/lab-partner-dispatch/pending?q=' + encodeURIComponent(RUN), { headers: H })).json()).data.items;
  const partner = pend[0].options[0].supplierId;
  const ids = pend.filter((r) => r.options.some((o) => o.supplierId === partner)).map((r) => r.itemId);
  const r = await fetch(WEB + '/api/v1/lab-partner-dispatch', { method: 'POST', headers: H, body: JSON.stringify({ supplierId: partner, itemIds: ids }) });
  return { status: r.status, count: ids.length };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  try {
    check('có mã lần tạo dữ liệu thử (UI_AUDIT_RUN)', RUN !== '');
    const sent = await apiSendAll(process.env.UI_AUDIT_USER || 'dev.admin', process.env.UI_AUDIT_PASS || 'Dev@12345');
    check('gửi sẵn các mẫu thử cho đối tác (API)', sent.status === 200 && sent.count >= 4, `${sent.count} mẫu, HTTP ${sent.status}`);

    await login(page, process.env.UI_AUDIT_USER || 'dev.admin', process.env.UI_AUDIT_PASS || 'Dev@12345');
    await page.goto(WEB + '/paraclinical/partner');
    await page.getByRole('button', { name: /^Đã gửi chờ kết quả/ }).click();
    await rowOf(page, N('Trương Bích Ngọc')).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    const sentHeader = await page.locator('[role=row]').first().innerText();
    check('tab "Đã gửi": có cột Thao tác và ô tích chọn', /THAO TÁC/i.test(sentHeader) && (await rowOf(page, N('Trương Bích Ngọc')).getByRole('checkbox').count()) === 1);
    await page.screenshot({ path: path.join(OUT, '01-da-gui.png') });

    // ── Nhận kết quả: lỗi đầu vào ──
    await rowOf(page, N('Trương Bích Ngọc')).getByRole('button', { name: 'Nhận kết quả' }).click();
    const dlg = page.getByRole('dialog', { name: 'Nhận kết quả từ đối tác' });
    await dlg.waitFor({ timeout: 10000 });
    await dlg.getByRole('button', { name: /^Lưu kết quả/ }).click();
    check('không chọn tệp: báo lỗi tiếng Việt, hộp còn mở', /Chọn tệp PDF/.test(await dlg.innerText()) && (await dlg.isVisible()));
    await dlg.locator('input[type=file]').setInputFiles(TXT_PATH);
    check('chọn tệp không phải PDF: báo "Chỉ nhận tệp PDF"', /Chỉ nhận tệp PDF/.test(await dlg.innerText()));
    await dlg.locator('input[type=file]').setInputFiles(PDF_PATH);
    check('chọn PDF: hiện tên tệp và dung lượng', /KQ_BinhMinh\.pdf/.test(await dlg.innerText()) && /KB/.test(await dlg.innerText()));
    // tích thêm mẫu của Cao Minh Khôi (cùng đối tác) để một tệp gắn hai dịch vụ
    await dlg.locator('[role=row]', { hasText: N('Cao Minh Khôi') }).getByRole('checkbox').check();
    check('nút lưu đếm đủ 2 mẫu', /\(2\)/.test(await dlg.getByRole('button', { name: /^Lưu kết quả/ }).innerText()));
    await page.screenshot({ path: path.join(OUT, '02-hop-nhan.png') });

    // lỗi 422 và mạng giữ nguyên tệp + lựa chọn
    await page.route('**/api/v1/lab-partner-dispatch/results', (route) => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'X', message: 'Một tệp kết quả chỉ gắn cho các mẫu của cùng một đối tác.' } }) }));
    await dlg.getByRole('button', { name: /^Lưu kết quả/ }).click();
    await page.waitForTimeout(600);
    const t422 = await dlg.innerText();
    check('lỗi 422: thông báo tiếng Việt tại chỗ, tệp và lựa chọn còn nguyên', /cùng một đối tác/.test(t422) && /KQ_BinhMinh\.pdf/.test(t422) && /\(2\)/.test(t422));
    await page.unroute('**/api/v1/lab-partner-dispatch/results');
    await page.route('**/api/v1/lab-partner-dispatch/results', (route) => route.abort('connectionreset'));
    await dlg.getByRole('button', { name: /^Lưu kết quả/ }).click();
    await page.waitForTimeout(1200);
    const bodyNet = await page.locator('body').innerText();
    check('mất mạng: có thông báo tiếng Việt, không lộ mã lỗi', !FORBIDDEN.test(bodyNet.replace(/Lưu kết quả/g, '')) && /(mạng|kết nối|Không lưu được)/i.test(bodyNet));
    await page.unroute('**/api/v1/lab-partner-dispatch/results');
    const sysDlg = page.getByRole('dialog').filter({ hasText: 'Chưa kết nối được máy chủ' });
    if ((await sysDlg.count()) > 0) await sysDlg.last().getByRole('button', { name: 'Đóng' }).last().click();
    await page.waitForTimeout(300);
    check('sau lỗi mạng: hộp nhận vẫn mở, tệp và lựa chọn còn nguyên', (await dlg.isVisible().catch(() => false)) && /KQ_BinhMinh\.pdf/.test(await dlg.innerText()) && /\(2\)/.test(await dlg.innerText()));

    // ── Lưu thật ──
    await page.screenshot({ path: path.join(OUT, '02b-truoc-luu.png') });
    console.log('   (hộp nhận đang mở:', await dlg.isVisible().catch(() => false), '— nút Đóng:', await page.getByRole('button', { name: 'Đóng' }).count(), ')');
    const resp = page.waitForResponse((r) => r.url().endsWith('/lab-partner-dispatch/results') && r.request().method() === 'POST', { timeout: 20000 });
    await dlg.getByRole('button', { name: /^Lưu kết quả/ }).click();
    const rr = await resp;
    check('lưu kết quả thật (200)', rr.status() === 200, `HTTP ${rr.status()}`);
    await page.waitForLoadState('networkidle');
    const notice = await page.getByRole('status').first().innerText().catch(() => '');
    check('thông báo: đã nhận 2 mẫu, chờ bác sĩ duyệt', /Đã nhận kết quả 2 mẫu/.test(notice) && /chờ bác sĩ duyệt/.test(notice), notice);
    check('hai mẫu rời tab "Đã gửi" (danh sách tự làm mới)', await page.locator('[role=row]', { hasText: N('Trương Bích Ngọc') }).first().waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false));

    // ── Chấm số ở menu + tab "Đã có kết quả" mặc định "Chờ duyệt" ──
    await page.waitForTimeout(500);
    const menuText = await page.getByRole('link', { name: /Gửi mẫu đối tác/ }).innerText();
    check('menu "Gửi mẫu đối tác" có chấm số chờ duyệt cho bác sĩ/quản lý', /\d/.test(menuText), menuText.replace(/\s+/g, ' '));
    await page.getByRole('button', { name: /^Đã có kết quả/ }).click();
    await rowOf(page, N('Trương Bích Ngọc')).waitFor({ timeout: 15000 });
    const filterText = await page.getByRole('group', { name: 'Lọc kết quả theo trạng thái duyệt' }).innerText();
    check('lọc "Chờ duyệt" là mặc định và có số đếm', /Chờ duyệt\s*\d+/.test(filterText), filterText.replace(/\s+/g, ' '));
    const doneRowText = await rowOf(page, N('Trương Bích Ngọc')).innerText();
    check('dòng kết quả: gửi lúc, nhận lúc, thời gian trả, "Chờ duyệt", nút "Xem và duyệt"', /Chờ duyệt/.test(doneRowText) && /Xem và duyệt/.test(doneRowText) && /phút|giờ/.test(doneRowText), doneRowText.replace(/\s+/g, ' ').slice(0, 200));
    await page.screenshot({ path: path.join(OUT, '03-cho-duyet.png') });

    // ── Xem PDF + duyệt + sang ca kế tiếp ──
    await rowOf(page, N('Trương Bích Ngọc')).getByRole('button', { name: 'Xem và duyệt' }).click();
    const rd = page.getByRole('dialog', { name: 'Kết quả của đối tác' });
    await rd.waitFor({ timeout: 10000 });
    const src = await rd.locator('iframe').getAttribute('src');
    const fileRes = await page.request.get(WEB + src);
    check('PDF mở được qua đường dẫn ký (200, application/pdf)', fileRes.status() === 200 && (fileRes.headers()['content-type'] || '').includes('application/pdf'), `HTTP ${fileRes.status()}`);
    check('hộp duyệt có nút "Duyệt & xem kết quả kế tiếp" khi còn ca chờ', (await rd.getByRole('button', { name: 'Duyệt & xem kết quả kế tiếp' }).count()) === 1);
    const box = await rd.locator('iframe').boundingBox();
    const dbox = await rd.locator('div.rounded-lg').first().boundingBox();
    check('khung PDF đủ lớn: cao ≥ 550px và chiếm ≥ 60% bề ngang hộp', !!box && !!dbox && box.height >= 550 && box.width / dbox.width >= 0.6, box ? `${Math.round(box.width)}×${Math.round(box.height)} trong hộp ${Math.round(dbox.width)}px` : '');
    await page.screenshot({ path: path.join(OUT, '04a-pdf-mac-dinh.png') });
    await rd.getByRole('button', { name: 'Phóng to PDF' }).click();
    const zbox = await rd.locator('iframe').boundingBox();
    check('"Phóng to PDF": khung PDF chiếm trọn bề ngang hộp', !!zbox && !!dbox && zbox.width / dbox.width >= 0.9, zbox ? `${Math.round(zbox.width)}px` : '');
    await page.screenshot({ path: path.join(OUT, '04b-pdf-phong-to.png') });
    await rd.getByRole('button', { name: 'Thu nhỏ PDF' }).click();
    await rd.locator('#lrd-conclusion').fill('Không có bất thường');
    await page.screenshot({ path: path.join(OUT, '04-hop-duyet.png') });
    await rd.getByRole('button', { name: 'Duyệt & xem kết quả kế tiếp' }).click();
    await page.waitForTimeout(1200);
    const nextText = await rd.innerText().catch(() => '');
    check('duyệt xong tự mở ca chờ duyệt kế tiếp (đúng bệnh nhân còn lại)', new RegExp(N('Cao Minh Khôi')).test(nextText), nextText.replace(/\s+/g, ' ').slice(0, 120));
    await rd.getByRole('button', { name: 'Duyệt kết quả' }).click();
    await page.waitForTimeout(1200);
    check('duyệt ca cuối: hộp đóng, thông báo đã duyệt', !(await rd.isVisible().catch(() => false)) && /Đã duyệt kết quả/.test(await page.getByRole('status').first().innerText().catch(() => '')));
    await page.getByRole('button', { name: /^Đã duyệt/ }).click();
    await rowOf(page, N('Trương Bích Ngọc')).waitFor({ timeout: 10000 });
    const approvedText = await rowOf(page, N('Trương Bích Ngọc')).innerText();
    check('lọc "Đã duyệt": hai ca đã duyệt, nút đổi thành "Xem PDF"', /Đã duyệt/.test(approvedText) && /Xem PDF/.test(approvedText) && (await page.locator('[role=row]', { hasText: N('Cao Minh Khôi') }).count()) >= 1);

    // ── Nhận rồi TRẢ LẠI kỹ thuật viên (mẫu HbA1c của Ngô Văn Tín) ──
    await page.getByRole('button', { name: /^Đã gửi chờ kết quả/ }).click();
    const tinHb = page.locator('[role=row]', { hasText: N('Ngô Văn Tín') }).filter({ hasText: 'HbA1c' }).first();
    await tinHb.waitFor({ timeout: 15000 });
    await tinHb.getByRole('button', { name: 'Nhận kết quả' }).click();
    await dlg.waitFor({ timeout: 10000 });
    await dlg.locator('input[type=file]').setInputFiles(PDF_PATH);
    await dlg.getByRole('button', { name: /^Lưu kết quả/ }).click();
    await page.getByRole('button', { name: /^Đã có kết quả/ }).click();
    await page.getByRole('button', { name: /^Chờ duyệt/ }).click();
    const tinDone = page.locator('[role=row]', { hasText: N('Ngô Văn Tín') }).first();
    await tinDone.waitFor({ timeout: 15000 });
    await tinDone.getByRole('button', { name: 'Xem và duyệt' }).click();
    await rd.waitFor({ timeout: 10000 });
    await rd.getByRole('button', { name: 'Trả lại kỹ thuật viên…' }).click();
    const reasonDlg = page.getByRole('dialog').filter({ hasText: 'Trả lại kỹ thuật viên' }).last();
    await reasonDlg.getByRole('textbox').fill('Tệp thiếu trang cuối');
    await reasonDlg.getByRole('button', { name: 'Trả lại', exact: true }).click();
    await page.waitForTimeout(1200);
    check('trả lại KTV: thông báo, mẫu về "Đã gửi chờ kết quả"', /Đã trả kết quả lại kỹ thuật viên/.test(await page.getByRole('status').first().innerText().catch(() => '')));
    await page.getByRole('button', { name: /^Đã gửi chờ kết quả/ }).click();
    await page.locator('[role=row]', { hasText: N('Ngô Văn Tín') }).filter({ hasText: 'HbA1c' }).first().waitFor({ timeout: 15000 });
    check('mẫu đã trả lại hiện lại ở tab "Đã gửi"', true);

    // ── Đối tác KHÔNG NHẬN mẫu (TSH của Ngô Văn Tín) ──
    const tinTsh = page.locator('[role=row]', { hasText: N('Ngô Văn Tín') }).filter({ hasText: 'TSH' }).first();
    await tinTsh.getByRole('button', { name: /Thao tác khác/ }).click({ force: true });
    await page.getByRole('menuitem', { name: /Đối tác không nhận mẫu/ }).click();
    const rej = page.getByRole('dialog').filter({ hasText: 'Đối tác không nhận mẫu' }).last();
    await rej.getByRole('textbox').fill('Mẫu tán huyết, đối tác yêu cầu lấy lại');
    await rej.getByRole('button', { name: 'Trả về chờ gửi' }).click();
    await page.waitForTimeout(1200);
    check('đối tác không nhận: thông báo và mẫu rời tab "Đã gửi"', /Đã trả mẫu về/.test(await page.getByRole('status').first().innerText().catch(() => '')) && (await page.locator('[role=row]', { hasText: N('Ngô Văn Tín') }).filter({ hasText: 'TSH' }).count()) === 0);
    await page.getByRole('button', { name: /^Chờ gửi/ }).click();
    await page.locator('[role=row]', { hasText: N('Ngô Văn Tín') }).filter({ hasText: 'TSH' }).first().waitFor({ timeout: 15000 });
    check('mẫu bị từ chối quay lại "Chờ gửi"', true);

    // ── Phiếu giao mẫu trong hộp "Gửi mẫu đi" ──
    await page.locator('[role=row]', { hasText: N('Ngô Văn Tín') }).filter({ hasText: 'TSH' }).first().getByRole('checkbox').check();
    await page.getByRole('button', { name: /^Gửi mẫu đi \(/ }).click();
    const sd = page.getByRole('dialog', { name: 'Gửi mẫu đi' });
    await sd.waitFor({ timeout: 10000 });
    check('hộp "Gửi mẫu đi": nhãn "Gửi lúc" và ô "Người gửi" chỉ đọc', /Gửi lúc/.test(await sd.innerText()) && (await sd.locator('#lp-user').getAttribute('readonly')) !== null);
    const slipBtn = sd.getByRole('button', { name: 'In phiếu giao mẫu' });
    check('có nút "In phiếu giao mẫu"', (await slipBtn.count()) === 1 && !(await slipBtn.isDisabled()));
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await slipBtn.click();
    await page.waitForTimeout(300);
    const slipText = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).map((e) => (e.children.length === 0 ? e.textContent : '')).join(' '));
    check('bản in có tiêu đề, tên mẫu, hai ô ký và KHÔNG có giá trả', /Phiếu giao mẫu xét nghiệm/.test(slipText) && /bên giao/.test(slipText) && /bên nhận/.test(slipText) && !/90\.000|150\.000/.test(slipText.slice(slipText.indexOf('Phiếu giao mẫu xét nghiệm'))));
    await page.keyboard.press('Escape');

    // ── Vai trò: bác sĩ duyệt được, điều dưỡng chỉ xem ──
    for (const [user, canApproveExpected] of [['rl.doctor', true], ['rl.nurse', false]]) {
      const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const p2 = await c2.newPage();
      await login(p2, user, '12345678');
      await p2.goto(WEB + '/paraclinical/partner');
      await p2.getByRole('button', { name: /^Đã có kết quả/ }).click();
      await p2.getByRole('button', { name: /^Tất cả/ }).click();
      await p2.waitForTimeout(1500);
      const txt = await p2.locator('main').innerText();
      check(`${user}: ${canApproveExpected ? 'thấy "Xem PDF"/"Xem và duyệt"' : 'chỉ thấy "Xem PDF", không có nút duyệt'}`, canApproveExpected ? /Xem PDF|Xem và duyệt/.test(txt) : /Xem PDF/.test(txt) && !/Xem và duyệt/.test(txt) && !/GIÁ TRẢ/i.test(txt));
      await c2.close();
    }

    for (const [w, h] of [[1280, 720], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.getByRole('button', { name: /^Đã có kết quả/ }).click();
      await page.waitForTimeout(300);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`cỡ ${w}×${h}: trang không cuộn ngang`, over <= 1, `lệch ${over}px`);
    }
    check('không có lỗi JavaScript', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
    const csp = consoleErrors.filter((e) => /Content Security Policy|Refused to/i.test(e));
    check('không có lỗi CSP khi nhúng PDF', csp.length === 0, csp.slice(0, 1).join(' | '));
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
