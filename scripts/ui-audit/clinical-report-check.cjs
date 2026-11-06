/* global require, process, console, window, document */
// KIỂM trang báo cáo "Chuyên môn" (docs/DECISIONS.md #287) trên Chrome thật qua địa chỉ IP LAN (HTTP thường, ngữ cảnh KHÔNG bảo mật — #257).
// Gồm: menu, 3 tab đúng thứ tự (tab "Dịch vụ đã dùng" dẫn sang Doanh thu), từng tab với dữ liệu thật, tab Cận lâm sàng với dữ liệu giả lập (bảng chờ quá hạn, cột chi nhánh khi nhiều chi nhánh),
// Excel thật + In từng tab, kỳ Tuỳ chọn nhập sai, trạng thái lỗi (500 → khung báo lỗi có "Thử lại"), phân quyền (lễ tân/bác sĩ bị chặn), vài cỡ màn hình.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/clinical-report-check.cjs
// Chuẩn bị như `lan-http-check.cjs` (README.md cùng thư mục): `pnpm dev` + `pnpm dev:lan`, đã `db:seed`. Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'clinical-report-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Bad Gateway|Internal Server|NOT_FOUND|SERVICE_UNAVAILABLE|ECONN|\b50[0-4]\b|\b404\b|stack/;
/** Bỏ các nhóm số để mã lỗi HTTP không khớp nhầm vào số liệu ("1.500"). */
const noDigits = (text) => text.replace(/\d[\d.,]*/g, '#');
const TABS = ['Cơ cấu chẩn đoán ICD-10', 'Dịch vụ đã dùng', 'Cận lâm sàng'];

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

function mockParaclinical(multi) {
  const id = (i) => `00000000-0000-4000-8000-00000000000${i}`;
  const overdue = (i, over) => ({
    orderItemId: id(i),
    encounterId: id(i),
    patientCode: `BN2026-00${i}`,
    patientName: `Nguyễn Văn Thử ${i}`,
    serviceName: 'Công thức máu',
    kind: 'LAB',
    branchName: multi ? 'Quận 7' : 'Chi nhánh chính',
    orderedAt: '2026-09-10T02:05:00.000Z',
    turnaroundMinutes: 60,
    waitedMinutes: 3 * 24 * 60 + 240,
    ...over,
  });
  return {
    generatedAt: new Date().toISOString(),
    from: '2026-09-01',
    to: '2026-09-30',
    branchCount: multi ? 3 : 1,
    summary: { ordered: 40, inHouse: 34, external: 6, completed: 28, pending: 6, avgMinutes: 52, overdue: 5, overdueOpen: 3, lateCompleted: 2 },
    byKind: [
      { kind: 'LAB', ordered: 25, inHouse: 22, external: 3, completed: 18, avgMinutes: 68, overdue: 4 },
      { kind: 'IMAGING', ordered: 10, inHouse: 8, external: 2, completed: 8, avgMinutes: 20, overdue: 1 },
      { kind: 'FUNCTIONAL', ordered: 3, inHouse: 3, external: 0, completed: 2, avgMinutes: null, overdue: 0 },
      { kind: 'OTHER', ordered: 2, inHouse: 1, external: 1, completed: 0, avgMinutes: null, overdue: 0 },
    ],
    topServices: [{ name: 'Công thức máu', kind: 'LAB', ordered: 12, completed: 9, avgMinutes: 61, overdue: 3 }],
    overdueItems: [overdue(1, {}), overdue(2, { serviceName: 'Siêu âm bụng', kind: 'IMAGING', waitedMinutes: 125 }), overdue(3, {})],
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
    check('menu "Chuyên môn" có trong nhóm Báo cáo', (await page.getByRole('link', { name: 'Chuyên môn', exact: true }).count()) > 0);
    await page.getByRole('link', { name: 'Chuyên môn', exact: true }).first().click();
    await page.getByRole('tab', { name: TABS[0] }).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    check('mở đúng trang', page.url().includes('/reports/clinical'), page.url());
    check('tiêu đề "Chuyên môn"', (await page.getByRole('heading', { name: 'Chuyên môn', level: 1, exact: true }).count()) === 1);
    const tabNames = (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim());
    check('đủ 3 tab đúng thứ tự', JSON.stringify(tabNames) === JSON.stringify(TABS), tabNames.join(' | '));
    const kinds = (await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
    check('bộ chọn Kỳ: 7 ngày, Tháng này, Tháng trước, Quý, Tuỳ chọn', JSON.stringify(kinds) === JSON.stringify(['7 ngày', 'Tháng này', 'Tháng trước', 'Quý', 'Tuỳ chọn']), kinds.join(' | '));
    check('không có chú thích duyệt mockup trong giao diện', (await page.locator('text=/TRƯỜNG MỚI|mockup|hint-placeholder/i').count()) === 0);

    // ── Tab 1: dữ liệu thật ──
    await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Quý', exact: true }).click();
    const ok1 = await waitReport(page, 'Số liệu cơ cấu chẩn đoán ICD-10');
    check('Cơ cấu chẩn đoán: có số liệu hoặc trạng thái trống rõ ràng', ok1);
    const kpi1 = page.getByRole('group', { name: 'Số liệu cơ cấu chẩn đoán ICD-10' });
    if (await kpi1.count()) {
      const t = (await kpi1.innerText()).replace(/\s+/g, ' ');
      check('4 KPI đúng nhãn', ['Lượt khám hoàn tất', 'Có chẩn đoán chính', 'Chưa có chẩn đoán', 'Số mã bệnh'].every((s) => t.includes(s)), t.slice(0, 200));
      const titles = (await page.locator('section h2').allInnerTexts()).map((s) => s.trim());
      check('2 khung: Bệnh hay gặp, Theo chương ICD-10', ['Bệnh hay gặp', 'Theo chương ICD-10'].every((s) => titles.includes(s)), titles.join(' | '));
    }
    check('không lộ chữ kỹ thuật', !FORBIDDEN.test(noDigits(await page.locator('main, body').first().innerText())));

    // ── Tab "Dịch vụ đã dùng" dẫn sang Doanh thu ──
    await page.getByRole('tab', { name: TABS[1], exact: true }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/reports/revenue'), { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    check('tab "Dịch vụ đã dùng" mở Doanh thu → Theo nhóm và dịch vụ', page.url().includes('/reports/revenue') && page.url().includes('tab=by-service'), page.url());
    await page.goBack();
    await page.getByRole('tab', { name: TABS[0] }).waitFor({ timeout: 20000 });

    // ── Excel + In: từng tab có nội dung riêng ──
    for (const [tab, groupName, fileRe] of [
      [TABS[0], 'Số liệu cơ cấu chẩn đoán ICD-10', /^co-cau-chan-doan-icd10-/],
      [TABS[2], 'Số liệu cận lâm sàng', /^can-lam-sang-/],
    ]) {
      await openTab(page, tab);
      await waitReport(page, groupName);
      const hasKpi = (await page.getByRole('group', { name: groupName }).count()) === 1;
      const empty = (await page.locator('h2:has-text("Không có")').count()) > 0;
      check(`tab "${tab}" hiện số liệu hoặc trạng thái trống rõ ràng`, hasKpi || empty, hasKpi ? (await page.getByRole('group', { name: groupName }).innerText()).replace(/\s+/g, ' ').slice(0, 140) : 'trống');
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

    // ── Cận lâm sàng: dữ liệu giả lập ──
    await openTab(page, TABS[2]);
    for (const multi of [false, true]) {
      await page.route('**/api/v1/reports/clinical/paraclinical?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockParaclinical(multi) }) }));
      await Promise.all([page.waitForResponse((r) => /reports\/clinical\/paraclinical\?/.test(r.url()), { timeout: 15000 }), page.getByRole('button', { name: 'Làm mới' }).click()]);
      const table = page.locator('[role="table"][aria-label="Chỉ định đang chờ đã quá hạn"]');
      await table.getByText('Nguyễn Văn Thử 1').waitFor({ timeout: 15000 });
      await page.waitForTimeout(400);
      const kpi = (await page.getByRole('group', { name: 'Số liệu cận lâm sàng' }).innerText()).replace(/\s+/g, ' ');
      check('KPI: 40 chỉ định, đã trả 28, trung bình 52 phút, quá hạn 5 (2 trả muộn · 3 đang chờ)', ['40', '34 tại phòng khám · 6 ra ngoài', '28', '6 chưa trả', '52 phút', '2 trả muộn · 3 đang chờ'].every((s) => kpi.includes(s)), kpi.slice(0, 220));
      const headers = (await table.locator('[role="columnheader"]').allInnerTexts()).map((t) => t.trim().toUpperCase());
      const expectHeaders = ['BỆNH NHÂN', 'DỊCH VỤ', ...(multi ? ['CHI NHÁNH'] : []), 'HẠN TRẢ', 'ĐÃ CHỜ'];
      check(`bảng chờ quá hạn ${multi ? 'nhiều chi nhánh có' : 'một chi nhánh KHÔNG có'} cột Chi nhánh`, JSON.stringify(headers) === JSON.stringify(expectHeaders), headers.join(' | '));
      const first = (await table.locator('[role="row"]').nth(1).innerText()).replace(/\s+/g, ' ');
      check('dòng 1: tên, mã, dịch vụ, hạn trả 1 giờ, đã chờ 3 ngày 4 giờ', ['Nguyễn Văn Thử 1', 'BN2026-001', 'Công thức máu', '1 giờ', '3 ngày 4 giờ'].every((s) => first.includes(s)), first);
      const kindTable = page.locator('[role="table"][aria-label="Cận lâm sàng theo nhóm dịch vụ"]');
      const kindText = (await kindTable.innerText()).replace(/\s+/g, ' ');
      check('bảng theo nhóm có đủ 4 nhóm và dòng Cộng', ['Xét nghiệm', 'Chẩn đoán hình ảnh', 'Thăm dò chức năng', 'Chỉ định ngoài (tên tự do)', 'Cộng'].every((s) => kindText.includes(s)), kindText.slice(0, 160));
    }
    await page.screenshot({ path: path.join(OUT, 'cls-mock.png'), fullPage: true });
    await page.unroute('**/api/v1/reports/clinical/paraclinical?*');

    // ── Kỳ tuỳ chọn nhập sai → báo ngay, không gọi máy chủ ──
    await openTab(page, TABS[0]);
    let calls = 0;
    page.on('request', (r) => {
      if (/reports\/clinical\/diagnoses\?/.test(r.url())) calls += 1;
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
    await page.route('**/api/v1/reports/clinical/diagnoses?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error TypeError' } }) }));
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await page.waitForSelector('button:has-text("Thử lại")', { timeout: 15000 });
    check('lỗi 500 → khung báo lỗi có "Thử lại", không lộ chữ kỹ thuật', !FORBIDDEN.test(noDigits(await page.locator('body').innerText())));
    await page.unroute('**/api/v1/reports/clinical/diagnoses?*');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await page.getByRole('group', { name: 'Số liệu cơ cấu chẩn đoán ICD-10' }).or(page.locator('h2:has-text("Không có")')).first().waitFor({ timeout: 15000 });
    check('bấm "Thử lại" tải lại được', true);

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [768, 1024], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const tab of [TABS[0], TABS[2]]) {
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
      await p.goto(WEB + '/reports/clinical');
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
