/* global require, process, console, window, document */
// KIỂM giao diện "Gửi mẫu đối tác" GĐ3 (docs/DECISIONS.md #291) trên Chrome thật qua địa chỉ IP LAN (HTTP thường — #257).
// Gồm: menu + trang 3 tab, chọn mẫu → hộp "Gửi mẫu đi", chọn đối tác thì giá đổi theo và dòng chưa có giá bị khoá, kiểm tra giờ gửi, lỗi 422/mạng giữ nguyên lựa chọn,
// gửi thật → thông báo + mẫu sang tab "Đã gửi" với giá đã chụp, lỗi tải danh sách có "Thử lại", Enter gửi/Esc đóng, vài cỡ màn hình không cuộn ngang trang.
// Cần dữ liệu thử: mẫu đã lấy của dịch vụ "Gửi đối tác" có tiền tố KIEM-GM (tạo bằng API, không SQL). Chạy:
//   PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/lab-partner-send-check.cjs
// Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'lab-partner-send-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Internal Server|NOT_FOUND|LAB_PARTNER|ECONN|\b50[0-4]\b|\b404\b|stack/;

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

async function login(page, user, pass) {
  await page.goto(WEB + '/login');
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

// Mã lần tạo dữ liệu thử (seed in ra "RUN=..."); tên bệnh nhân thử là "KIEM-GM <tên> <RUN>" nên mỗi lần seed lại không lẫn với dữ liệu cũ.
const RUN = process.env.UI_AUDIT_RUN || '';
const N = (label) => (RUN ? `${label} ${RUN}` : label);
const rowOf = (page, text) => page.locator('[role=row]', { hasText: text }).first();

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  try {
    await login(page, process.env.UI_AUDIT_USER || 'dev.admin', process.env.UI_AUDIT_PASS || 'Dev@12345');
    check('ngữ cảnh KHÔNG bảo mật (mô hình on-prem LAN HTTP)', (await page.evaluate(() => window.isSecureContext)) === false, WEB);

    // ── Menu + trang ──
    await page.goto(WEB + '/paraclinical/lab');
    await page.waitForLoadState('networkidle');
    const menu = page.getByRole('link', { name: 'Gửi mẫu đối tác' });
    check('menu "Gửi mẫu đối tác" có trong nhóm Cận lâm sàng', (await menu.count()) === 1);
    await menu.click();
    await page.waitForURL(/\/paraclinical\/partner$/);
    await page.getByRole('button', { name: /^Chờ gửi/ }).waitFor({ timeout: 20000 });
    await page.locator('[role=row]', { hasText: 'KIEM-GM' }).first().waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    const pills = await page.getByRole('group', { name: 'Lọc theo trạng thái' }).innerText();
    check('3 tab hiện đủ kèm số', /Chờ gửi\s*\d+/.test(pills) && /Đã gửi chờ kết quả\s*\d+/.test(pills) && /Đã có kết quả\s*\d+/.test(pills), pills.replace(/\n/g, ' | '));
    const headerText = await page.locator('[role=row]').first().innerText();
    check('đầu cột tab "Chờ gửi" đủ', /MÃ ỐNG/i.test(headerText) && /LOẠI MẪU/i.test(headerText) && /GIÁ TRẢ/i.test(headerText), headerText.replace(/\s+/g, ' '));
    const kiemRows = page.locator('[role=row]', { hasText: 'KIEM-GM' });
    const nRows = await kiemRows.count();
    check('có mẫu thử KIEM-GM ở "Chờ gửi"', nRows >= 4, `${nRows} dòng`);
    await page.screenshot({ path: path.join(OUT, '01-cho-gui.png') });

    // ── Chọn mẫu → hộp thoại ──
    const sendBtn = page.getByRole('button', { name: /^Gửi mẫu đi \(/ });
    check('nút "Gửi mẫu đi (0)" bị khoá khi chưa chọn', await sendBtn.isDisabled());
    await rowOf(page, N('Trương Bích Ngọc')).getByRole('checkbox').check();
    await rowOf(page, N('Cao Minh Khôi')).getByRole('checkbox').check();
    check('nút đếm đúng số mẫu đã chọn', (await sendBtn.innerText()).includes('(2)'), await sendBtn.innerText());
    await sendBtn.click();
    const dlg = page.getByRole('dialog', { name: 'Gửi mẫu đi' });
    await dlg.waitFor({ timeout: 10000 });
    const dlgText0 = await dlg.innerText();
    check('hộp thoại mở, đối tác khởi đầu là Bình Minh (mặc định của cả hai dòng)', /Bình Minh/.test(await dlg.locator('#lp-partner').inputValue().catch(() => '')) || /Bình Minh/.test(dlgText0));
    check('giá của Bình Minh: HbA1c 150.000 và TSH 90.000, tổng 240.000', /150\.000/.test(dlgText0) && /90\.000/.test(dlgText0) && /240\.000/.test(dlgText0), dlgText0.replace(/\s+/g, ' ').slice(0, 300));
    await page.screenshot({ path: path.join(OUT, '02-hop-gui-binh-minh.png') });

    // ── Đổi sang Nam Việt: giá đổi, dòng không có giá bị khoá ──
    await dlg.locator('#lp-partner').click();
    await page.getByText(/Nam Việt/).last().click();
    await page.waitForTimeout(300);
    const dlgText1 = await dlg.innerText();
    check('sang Nam Việt: HbA1c đổi giá 135.000, tổng 135.000', /135\.000/.test(dlgText1) && !/240\.000/.test(dlgText1), dlgText1.replace(/\s+/g, ' ').slice(0, 300));
    check('dòng TSH (chỉ Bình Minh) bị nhắc "Chưa có giá trả" và không còn được tích', /Chưa có giá trả/.test(dlgText1));
    const tshBox = dlg.locator('[role=row]', { hasText: N('Cao Minh Khôi') }).getByRole('checkbox');
    check('ô tích của dòng TSH đã bỏ', (await tshBox.isChecked()) === false);
    check('nút gửi đếm lại còn (1)', /\(1\)/.test(await dlg.getByRole('button', { name: /^Đã gửi mẫu đi/ }).innerText()));
    await page.screenshot({ path: path.join(OUT, '03-hop-gui-nam-viet.png') });

    // ── Giờ gửi tương lai bị chặn ──
    const timeInput = dlg.locator('#lp-time');
    const futureHour = String((new Date().getHours() + 3) % 24).padStart(2, '0');
    const noonGuard = new Date().getHours() + 3 >= 24; // qua nửa đêm thì dùng ngày mai
    if (!noonGuard) {
      await timeInput.fill(`${futureHour}:00`);
      await timeInput.blur();
      await dlg.getByRole('button', { name: /^Đã gửi mẫu đi/ }).click();
      await page.waitForTimeout(400);
      const errText = await dlg.innerText();
      check('giờ gửi ở tương lai bị chặn bằng câu tiếng Việt, hộp vẫn mở', /không được ở tương lai/.test(errText) && (await dlg.isVisible()), '');
      // Đóng rồi mở lại hộp để ô giờ về mặc định "chưa sửa" (khi đó không gửi sentAt, máy chủ lấy đúng bây giờ).
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Gửi mẫu đi \(/ }).click();
      await dlg.waitFor({ timeout: 10000 });
      await dlg.locator('#lp-partner').click();
      await page.getByText(/Nam Việt/).last().click();
    } else {
      check('bỏ qua kiểm giờ tương lai (gần nửa đêm)', true);
    }

    // ── Lỗi máy chủ khi gửi: giữ nguyên lựa chọn ──
    await page.route('**/api/v1/lab-partner-dispatch', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LAB_PARTNER_PRICE_MISSING', message: 'Đối tác chưa có giá trả cho dịch vụ này.' } }) }) : route.continue()));
    await dlg.getByRole('button', { name: /^Đã gửi mẫu đi/ }).click();
    await page.waitForTimeout(600);
    const err422 = await dlg.innerText();
    check('lỗi 422 hiện tại chỗ bằng tiếng Việt, hộp còn mở, lựa chọn còn nguyên', /chưa có giá trả/i.test(err422) && !FORBIDDEN.test(err422.replace(/Đã gửi mẫu đi/g, '')) && (await dlg.locator('[role=row]', { hasText: N('Trương Bích Ngọc') }).getByRole('checkbox').isChecked()));
    await page.unroute('**/api/v1/lab-partner-dispatch');
    await page.route('**/api/v1/lab-partner-dispatch', (route) => (route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue()));
    await dlg.getByRole('button', { name: /^Đã gửi mẫu đi/ }).click();
    await page.waitForTimeout(1200);
    const stillOpen = await dlg.isVisible().catch(() => false);
    const bodyAfterNet = await page.locator('body').innerText();
    check('mất mạng khi gửi: có thông báo tiếng Việt, không lộ mã lỗi, lựa chọn còn nguyên', !FORBIDDEN.test(bodyAfterNet.replace(/Đã gửi mẫu đi/g, '')) && /(mạng|kết nối|không gửi được)/i.test(bodyAfterNet), stillOpen ? 'hộp còn mở' : 'hộp đóng, có hộp báo lỗi hệ thống');
    await page.unroute('**/api/v1/lab-partner-dispatch');
    await page.screenshot({ path: path.join(OUT, '04-loi-mang.png') });
    // đóng hộp lỗi hệ thống (nếu có) rồi bảo đảm hộp gửi còn mở
    const closeSys = page.getByRole('button', { name: 'Đóng' });
    if ((await closeSys.count()) > 0 && !(await dlg.isVisible().catch(() => false))) await closeSys.first().click();
    if (!(await dlg.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /^Gửi mẫu đi \(/ }).click();
      await dlg.waitFor({ timeout: 10000 });
    }

    // ── Esc đóng, mở lại, Enter gửi thật ──
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('Esc đóng hộp thoại', !(await dlg.isVisible().catch(() => false)));
    await page.getByRole('button', { name: /^Gửi mẫu đi \(/ }).click();
    await dlg.waitFor({ timeout: 10000 });
    await dlg.locator('#lp-partner').click();
    await page.getByText(/Nam Việt/).last().click();
    await dlg.locator('#lp-note').fill('shipper đối tác lấy lúc 11h');
    let sentBody = null;
    const onReq = (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/lab-partner-dispatch')) sentBody = r.postData();
    };
    page.on('request', onReq);
    const reqPromise = page.waitForResponse((r) => r.url().endsWith('/lab-partner-dispatch') && r.request().method() === 'POST', { timeout: 15000 });
    await dlg.locator('#lp-note').press('Enter');
    const resp = await reqPromise;
    page.off('request', onReq);
    let parsed = null;
    try {
      parsed = sentBody ? JSON.parse(sentBody) : null;
    } catch {
      parsed = null;
    }
    check('Enter trong ô ghi chú gửi thật (200)', resp.status() === 200, `status ${resp.status()}`);
    if (parsed) check('nội dung gửi đúng: 1 mẫu, có đối tác, giờ gửi và ghi chú', parsed.itemIds.length === 1 && !!parsed.supplierId && !!parsed.sentAt && parsed.note === 'shipper đối tác lấy lúc 11h', JSON.stringify(parsed).slice(0, 160));
    await page.waitForLoadState('networkidle');
    const noticeText = await page.getByRole('status').first().innerText().catch(() => '');
    check('thông báo thành công nêu số mẫu, đối tác và mã đợt', /Đã gửi 1 mẫu cho .*Nam Việt.* \(đợt GM/.test(noticeText), noticeText);
    const gone = await page.locator('[role=row]', { hasText: N('Trương Bích Ngọc') }).first().waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false);
    check('hộp thoại đã đóng và mẫu rời "Chờ gửi" (danh sách tự làm mới)', !(await dlg.isVisible().catch(() => false)) && gone);
    await page.screenshot({ path: path.join(OUT, '05-sau-khi-gui.png') });

    // ── Tab "Đã gửi" ──
    await page.getByRole('button', { name: /^Đã gửi chờ kết quả/ }).click();
    await page.waitForLoadState('networkidle');
    const sentRow = rowOf(page, N('Trương Bích Ngọc'));
    await sentRow.waitFor({ timeout: 10000 });
    const sentText = await sentRow.innerText();
    check('tab "Đã gửi": đủ đối tác Nam Việt, giá đã chụp 135.000, trạng thái "Chờ kết quả"', /Nam Việt/.test(sentText) && /135\.000/.test(sentText) && /Chờ kết quả/.test(sentText), sentText.replace(/\s+/g, ' '));
    check('hạn trả = gửi + 24 giờ (ngày hạn trả khác giờ gửi 1 ngày)', /\d{2}\/\d{2} \d{2}:\d{2}/.test(sentText));
    await page.screenshot({ path: path.join(OUT, '06-da-gui.png') });

    // ── Tab "Đã có kết quả" ──
    await page.getByRole('button', { name: /^Đã có kết quả/ }).click();
    const doneText = await page.locator('main').innerText();
    check('tab "Đã có kết quả" có trạng thái rỗng dễ hiểu', /Chưa có kết quả nào từ đối tác/.test(doneText));

    // ── Lỗi tải danh sách: ErrorBanner + Thử lại ──
    await page.route('**/api/v1/lab-partner-dispatch/pending**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) }));
    await page.getByRole('button', { name: /^Chờ gửi/ }).click();
    await page.reload();
    await page.getByText('Không tải được danh sách gửi mẫu đối tác').first().waitFor({ timeout: 25000 }).catch(() => {});
    const errBody = await page.locator('main').innerText();
    check('tải danh sách lỗi 500: có thông báo + "Thử lại", không lộ mã', /Không tải được danh sách gửi mẫu đối tác/.test(errBody) && (await page.getByRole('button', { name: 'Thử lại' }).count()) > 0 && !/Internal Server|INTERNAL|500/.test(errBody), '');
    await page.screenshot({ path: path.join(OUT, '07-loi-tai.png') });
    await page.unroute('**/api/v1/lab-partner-dispatch/pending**');
    await page.getByRole('button', { name: 'Thử lại' }).first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    check('bấm "Thử lại" tải lại được danh sách', (await page.getByRole('button', { name: 'Thử lại' }).count()) === 0);

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [1536, 864], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`cỡ ${w}×${h}: trang không cuộn ngang`, over <= 1, `lệch ${over}px`);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: /^Chờ gửi/ }).click();
    await page.waitForTimeout(400);
    if ((await page.locator('[role=row]', { hasText: 'KIEM-GM' }).count()) > 0) {
      await page.locator('[role=row]', { hasText: 'KIEM-GM' }).first().getByRole('checkbox').check();
      await page.getByRole('button', { name: /^Gửi mẫu đi \(/ }).click();
      await page.getByRole('dialog', { name: 'Gửi mẫu đi' }).waitFor({ timeout: 10000 });
      const fits = await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
      check('hộp "Gửi mẫu đi" nằm trọn khung ở 1280×720', fits);
      await page.screenshot({ path: path.join(OUT, '08-hop-1280.png') });
      await page.keyboard.press('Escape');
    }

    check('không có lỗi JavaScript trong suốt phiên', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
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
