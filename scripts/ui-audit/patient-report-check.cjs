/* global require, process, console, window, document */
// KIỂM trang báo cáo "Bệnh nhân" (docs/DECISIONS.md #287) trên Chrome thật qua địa chỉ IP LAN (HTTP thường, ngữ cảnh KHÔNG bảo mật — #257).
// Gồm: menu, 3 tab đúng thứ tự, từng tab với dữ liệu thật (KPI, khung, nhãn), tab "Bệnh nhân không quay lại" với dữ liệu giả lập (bảng, cột chi nhánh khi nhiều chi nhánh, link "Xem"),
// Excel thật + In từng tab, kỳ Tuỳ chọn nhập sai, trạng thái lỗi (500 → khung báo lỗi có "Thử lại"), phân quyền (lễ tân/bác sĩ bị chặn), vài cỡ màn hình.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/patient-report-check.cjs
// Chuẩn bị như `lan-http-check.cjs` (README.md cùng thư mục): `pnpm dev` + `pnpm dev:lan`, đã `db:seed`. Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'patient-report-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Bad Gateway|Internal Server|NOT_FOUND|SERVICE_UNAVAILABLE|ECONN|\b50[0-4]\b|\b404\b|stack/;
/** Bỏ các nhóm số để mã lỗi HTTP không khớp nhầm vào số liệu ("1.500"). */
const noDigits = (text) => text.replace(/\d[\d.,]*/g, '#');
const TABS = ['Bệnh nhân mới và cũ', 'Tuổi, giới và địa bàn', 'Bệnh nhân không quay lại'];

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

async function waitReport(page, groupName) {
  try {
    await page.getByRole('group', { name: groupName }).or(page.locator('h2:has-text("Không có")')).first().waitFor({ timeout: 25000 });
    return true;
  } catch {
    return false;
  }
}

async function openTab(page, name) {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.waitForLoadState('networkidle');
}

function mockNotReturning(multi) {
  const base = { generatedAt: new Date().toISOString(), from: '2026-09-01', to: '2026-09-30', branchCount: multi ? 3 : 1 };
  const item = (i, over) => ({
    patientId: `00000000-0000-4000-8000-00000000000${i}`,
    patientCode: `BN2026-00${i}`,
    patientName: `Nguyễn Văn Thử ${i}`,
    phone: `09012345${i}0`,
    encounterId: `00000000-0000-4000-8000-0000000001${i}0`,
    visitDate: '2026-09-12',
    dueDate: '2026-09-20',
    overdueDays: 47,
    doctorName: 'BS. Nguyễn Văn An',
    branchName: multi ? 'Quận 7' : 'Chi nhánh chính',
    reminderCount: 0,
    lastReminderResult: null,
    ...over,
  });
  return {
    ...base,
    summary: { patients: 3, reminded: 2, markedNotReturning: 1, avgOverdueDays: 40 },
    totalCount: 3,
    items: [item(1, { dueDate: '2026-09-07', overdueDays: 60, reminderCount: 1, lastReminderResult: 'NOT_RETURNING' }), item(2), item(3, { reminderCount: 2, lastReminderResult: 'REACHED' })],
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls += 1;
    };
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  try {
    await login(page, process.env.UI_AUDIT_USER || 'dev.admin', process.env.UI_AUDIT_PASS || 'Dev@12345');
    check('ngữ cảnh KHÔNG bảo mật (mô hình on-prem LAN HTTP)', (await page.evaluate(() => window.isSecureContext)) === false, WEB);

    // ── Menu và 3 tab ──
    await page.goto(WEB + '/');
    await page.waitForLoadState('networkidle');
    const group = page.getByRole('button', { name: 'Báo cáo', exact: true });
    if (await group.count()) await group.first().click();
    check('menu "Bệnh nhân" có trong nhóm Báo cáo', (await page.getByRole('link', { name: 'Bệnh nhân', exact: true }).count()) > 0);
    await page.getByRole('link', { name: 'Bệnh nhân', exact: true }).first().click();
    await page.getByRole('tab', { name: TABS[0] }).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    check('mở đúng trang', page.url().includes('/reports/patients'), page.url());
    check('tiêu đề "Bệnh nhân"', (await page.getByRole('heading', { name: 'Bệnh nhân', level: 1, exact: true }).count()) === 1);
    const tabNames = (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim());
    check('đủ 3 tab đúng thứ tự', JSON.stringify(tabNames) === JSON.stringify(TABS), tabNames.join(' | '));
    const kinds = (await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
    check('bộ chọn Kỳ: 7 ngày, Tháng này, Tháng trước, Quý, Tuỳ chọn', JSON.stringify(kinds) === JSON.stringify(['7 ngày', 'Tháng này', 'Tháng trước', 'Quý', 'Tuỳ chọn']), kinds.join(' | '));
    check('không có chú thích duyệt mockup trong giao diện', (await page.locator('text=/TRƯỜNG MỚI|mockup|hint-placeholder/i').count()) === 0);

    // ── Tab 1: dữ liệu thật ──
    await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Quý', exact: true }).click();
    const ok1 = await waitReport(page, 'Số liệu bệnh nhân mới và cũ');
    check('Bệnh nhân mới và cũ: có số liệu hoặc trạng thái trống rõ ràng', ok1);
    const kpi1 = page.getByRole('group', { name: 'Số liệu bệnh nhân mới và cũ' });
    if (await kpi1.count()) {
      const t = (await kpi1.innerText()).replace(/\s+/g, ' ');
      check('4 KPI đúng nhãn', ['Bệnh nhân có khám', 'Bệnh nhân mới', 'Bệnh nhân cũ', 'Lượt mỗi bệnh nhân'].every((s) => t.includes(s)), t.slice(0, 200));
      const titles = (await page.locator('section h2').allInnerTexts()).map((s) => s.trim());
      check('3 khung: Theo tháng, Số lượt khám của mỗi bệnh nhân, Bệnh nhân cũ quay lại sau', ['Theo tháng', 'Số lượt khám của mỗi bệnh nhân', 'Bệnh nhân cũ quay lại sau'].every((s) => titles.includes(s)), titles.join(' | '));
      const freq = await page.locator('[role="table"][aria-label="Số lượt khám của mỗi bệnh nhân"] [role="row"]').allInnerTexts();
      check('phân bố số lượt có đủ 4 dòng (1, 2, 3, từ 4 lượt)', freq.length === 5 && /Từ 4 lượt/.test(freq[4]), freq.map((r) => r.replace(/\s+/g, ' ')).join(' / '));
      const gap = await page.locator('[role="table"][aria-label="Bệnh nhân cũ quay lại sau"] [role="row"]').allInnerTexts();
      check('khoảng quay lại có đủ 5 dòng', gap.length === 6 && /Trên 1 năm/.test(gap[5]), String(gap.length));
    }
    check('không lộ chữ kỹ thuật', !FORBIDDEN.test(noDigits(await page.locator('main, body').first().innerText())));
    await page.screenshot({ path: path.join(OUT, 'tab1.png'), fullPage: true });

    // ── Tab 2 và Tab 3: dữ liệu thật ──
    for (const [tab, groupName, label, fileRe] of [
      [TABS[0], 'Số liệu bệnh nhân mới và cũ', 'Bệnh nhân mới', /^benh-nhan-moi-va-cu-/],
      [TABS[1], 'Số liệu tuổi, giới và địa bàn', 'Chưa ghi tỉnh/thành', /^tuoi-gioi-dia-ban-/],
      [TABS[2], 'Số liệu bệnh nhân không quay lại', 'Quá hạn chưa quay lại', /^benh-nhan-khong-quay-lai-/],
    ]) {
      await openTab(page, tab);
      await waitReport(page, groupName);
      const hasKpi = (await page.getByRole('group', { name: groupName }).count()) === 1;
      const empty = (await page.locator('h2:has-text("Không có")').count()) > 0;
      check(`tab "${tab}" hiện số liệu hoặc trạng thái trống rõ ràng`, hasKpi || empty, hasKpi ? (await page.getByRole('group', { name: groupName }).innerText()).replace(/\s+/g, ' ').slice(0, 140) : 'trống');
      if (hasKpi) check(`tab "${tab}" có nhãn "${label}"`, (await page.getByRole('group', { name: groupName }).innerText()).includes(label));
      check(`tab "${tab}" không lộ chữ kỹ thuật`, !FORBIDDEN.test(noDigits(await page.locator('main, body').first().innerText())));
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
      const f = path.join(OUT, `tab-${tab.replace(/[\s,]+/g, '-')}.xlsx`);
      await dl.saveAs(f);
      check(`tab "${tab}" tải Excel thật`, fs.statSync(f).size > 2000 && fileRe.test(dl.suggestedFilename()), dl.suggestedFilename());
      await page.evaluate(() => {
        window.__printCalls = 0;
      });
      await page.getByRole('button', { name: 'In' }).first().click();
      await page.waitForFunction(() => window.__printCalls > 0, null, { timeout: 15000 });
      check(`tab "${tab}" nút In gọi hộp in của trình duyệt`, (await page.evaluate(() => window.__printCalls)) === 1);
      check(`tab "${tab}" bản in có tiêu đề`, (await page.evaluate(() => document.body.textContent || '')).toLowerCase().includes(tab.toLowerCase()));
      await page.screenshot({ path: path.join(OUT, `tab-${tab.replace(/[\s,]+/g, '-')}.png`), fullPage: true });
    }
    {
      await openTab(page, TABS[1]);
      await waitReport(page, 'Số liệu tuổi, giới và địa bàn');
      const titles = (await page.locator('section h2').allInnerTexts()).map((s) => s.trim());
      const expectBlocks = ['Theo khoảng tuổi và giới', 'Theo tỉnh/thành', 'Phường/xã có nhiều bệnh nhân nhất'];
      check('Tuổi giới địa bàn: đủ 3 khung', (await page.getByRole('group', { name: 'Số liệu tuổi, giới và địa bàn' }).count()) === 0 || expectBlocks.every((s) => titles.includes(s)), titles.join(' | '));
      const rows = await page.locator('[role="table"][aria-label="Bệnh nhân theo khoảng tuổi và giới"] [role="row"]').count();
      check('bảng khoảng tuổi có 7 khoảng + đầu + dòng cộng', rows === 0 || rows === 9, String(rows));
    }

    // ── Tab 3: dữ liệu giả lập (bảng, cột chi nhánh, link Xem) ──
    await openTab(page, TABS[2]);
    for (const multi of [false, true]) {
      await page.route('**/api/v1/reports/patients/not-returning?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockNotReturning(multi) }) }));
      await Promise.all([page.waitForResponse((r) => /reports\/patients\/not-returning\?/.test(r.url()), { timeout: 15000 }), page.getByRole('button', { name: 'Làm mới' }).click()]);
      const table = page.locator('[role="table"][aria-label="Bệnh nhân không quay lại"]');
      await table.getByText('Nguyễn Văn Thử 1').waitFor({ timeout: 15000 });
      await page.waitForTimeout(400);
      const headers = (await table.locator('[role="columnheader"]').allInnerTexts()).map((t) => t.trim().toUpperCase());
      const expectHeaders = ['BỆNH NHÂN', 'ĐIỆN THOẠI', ...(multi ? ['CHI NHÁNH'] : []), 'BÁC SĨ', 'NGÀY KHÁM', 'NGÀY HẸN', 'QUÁ HẠN', 'LẦN NHẮC GẦN NHẤT', ''];
      check(`bảng ${multi ? 'nhiều chi nhánh có' : 'một chi nhánh KHÔNG có'} cột Chi nhánh`, JSON.stringify(headers) === JSON.stringify(expectHeaders), headers.join(' | '));
      const first = (await table.locator('[role="row"]').nth(1).innerText()).replace(/\s+/g, ' ');
      check('dòng 1: tên, mã, điện thoại, ngày dạng dd/mm/yyyy, quá hạn, kết quả nhắc', ['Nguyễn Văn Thử 1', 'BN2026-001', '12/09/2026', '07/09/2026', '60 ngày', '1 lần · Bệnh nhân không tái khám', 'Xem'].every((s) => first.includes(s)), first);
      const third = (await table.locator('[role="row"]').nth(2).innerText()).replace(/\s+/g, ' ');
      check('dòng chưa nhắc ghi "Chưa nhắc"', third.includes('Chưa nhắc'), third);
      const href = await table.locator('a:has-text("Xem")').first().getAttribute('href');
      check('link "Xem" mở hồ sơ bệnh nhân', /^\/patients\/00000000-0000-4000-8000-000000000001$/.test(href || ''), href);
      const kpi = (await page.getByRole('group', { name: 'Số liệu bệnh nhân không quay lại' }).innerText()).replace(/\s+/g, ' ');
      check('KPI: 3 bệnh nhân, đã nhắc 2, chưa nhắc 1, đã ghi không tái khám 1, quá hạn TB 40 ngày', ['3', '2', '1 chưa nhắc lần nào', '40 ngày'].every((s) => kpi.includes(s)), kpi);
    }
    await page.screenshot({ path: path.join(OUT, 'tab3-mock.png'), fullPage: true });
    await page.unroute('**/api/v1/reports/patients/not-returning?*');

    // ── Kỳ tuỳ chọn nhập sai → báo ngay, không gọi máy chủ ──
    await openTab(page, TABS[0]);
    let calls = 0;
    page.on('request', (r) => {
      if (/reports\/patients\/new-returning\?/.test(r.url())) calls += 1;
    });
    await page.getByRole('button', { name: 'Tuỳ chọn' }).click();
    await page.fill('#report-period-from', '30/09/2026');
    await page.fill('#report-period-to', '01/09/2026');
    await page.waitForTimeout(900);
    const before = calls;
    await page.waitForTimeout(900);
    const errText = await page.getByRole('alert').first().innerText();
    check('khoảng ngày ngược báo lỗi tiếng Việt và không gọi máy chủ', /trước hoặc bằng/.test(errText) && calls === before, errText);
    await page.getByRole('button', { name: 'Tháng này' }).click();

    // ── Trạng thái lỗi ──
    await page.route('**/api/v1/reports/patients/new-returning?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error TypeError' } }) }));
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await page.waitForSelector('button:has-text("Thử lại")', { timeout: 15000 });
    check('lỗi 500 → khung báo lỗi có "Thử lại", không lộ chữ kỹ thuật', !FORBIDDEN.test(noDigits(await page.locator('body').innerText())));
    await page.unroute('**/api/v1/reports/patients/new-returning?*');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await page.getByRole('group', { name: 'Số liệu bệnh nhân mới và cũ' }).or(page.locator('h2:has-text("Không có")')).first().waitFor({ timeout: 15000 });
    check('bấm "Thử lại" tải lại được', true);

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [768, 1024], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const tab of TABS) {
        await openTab(page, tab);
        await page.waitForTimeout(500);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${w}×${h} · ${tab}: trang không cuộn ngang`, over <= 1, `lệch ${over}px`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  } catch (err) {
    check('kịch bản chạy hết không ngoại lệ', false, String(err && err.message ? err.message : err).slice(0, 300));
    await page.screenshot({ path: path.join(OUT, 'loi.png') }).catch(() => undefined);
  }

  // ── Phân quyền: lễ tân và bác sĩ không có quyền ──
  for (const user of ['rl.receptionist', 'rl.doctor']) {
    const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    try {
      await login(p, user, '12345678');
      await p.goto(WEB + '/reports/patients');
      await p.waitForLoadState('networkidle');
      const text = await p.locator('body').innerText();
      check(`${user}: không mở được trang, có thông báo tiếng Việt và lối về`, !(await p.getByRole('tab', { name: TABS[0] }).count()) && /không có quyền/i.test(text) && !FORBIDDEN.test(noDigits(text)), text.replace(/\s+/g, ' ').slice(0, 120));
    } catch (e) {
      check(`${user}: kiểm quyền`, false, String(e.message).slice(0, 200));
    } finally {
      await p.context().close();
    }
  }

  check('không có lỗi JS trên trang', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} đạt`);
  await browser.close();
  process.exit(ok === results.length ? 0 : 1);
})();
