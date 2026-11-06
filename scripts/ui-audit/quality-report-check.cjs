/* global require, process, console, window, document */
// KIỂM trang báo cáo "Chất lượng và tuân thủ" (docs/DECISIONS.md #290) trên Chrome thật qua địa chỉ IP LAN (HTTP thường, ngữ cảnh KHÔNG bảo mật — #257).
// Gồm: menu, 3 tab đúng thứ tự (tab "Nhật ký kiểm toán" dẫn sang trang cũ), từng tab với dữ liệu thật, dữ liệu giả lập (bảng, cột chi nhánh khi nhiều chi nhánh), Excel thật + In từng tab,
// "Lượt khám chưa hoàn tất" không có bộ chọn kỳ, kỳ Tuỳ chọn nhập sai ở tab Liên thông, trạng thái lỗi (500 → khung báo lỗi có "Thử lại"), phân quyền (lễ tân/bác sĩ bị chặn), vài cỡ màn hình.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/quality-report-check.cjs
// Chuẩn bị như `lan-http-check.cjs` (README.md cùng thư mục): `pnpm dev` + `pnpm dev:lan`, đã `db:seed` VÀ khởi động lại API. Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'quality-report-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Bad Gateway|Internal Server|NOT_FOUND|SERVICE_UNAVAILABLE|ECONN|\b50[0-4]\b|\b404\b|stack/;
/** Bỏ các nhóm số để mã lỗi HTTP không khớp nhầm vào số liệu ("1.500"). */
const noDigits = (text) => text.replace(/\d[\d.,]*/g, '#');
const TABS = ['Lượt khám chưa hoàn tất', 'Liên thông đơn thuốc', 'Nhật ký kiểm toán'];

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

function mockIncomplete(multi) {
  const id = (i) => `00000000-0000-4000-8000-00000000000${i}`;
  return {
    generatedAt: new Date().toISOString(),
    asOf: '2026-11-06',
    branchCount: multi ? 3 : 1,
    summary: { staleEncounters: 2, openShifts: 1, unpaidInvoices: 4, oldestEncounterDays: 57 },
    encounters: [
      { encounterId: id(1), encounterNo: 'LK2609000001', patientCode: 'BN2026-001', patientName: 'Nguyễn Văn Thử 1', status: 'CHECKED_IN', visitDate: '2026-09-10', daysOpen: 57, doctorName: null, branchName: multi ? 'Quận 7' : 'Chi nhánh chính' },
      { encounterId: id(2), encounterNo: 'LK2609000002', patientCode: 'BN2026-002', patientName: 'Nguyễn Văn Thử 2', status: 'IN_CONSULTATION', visitDate: '2026-09-20', daysOpen: 47, doctorName: 'BS. Nguyễn Văn An', branchName: multi ? 'Quận 7' : 'Chi nhánh chính' },
    ],
    shifts: [{ shiftId: id(3), shiftNo: 'PCC2609000001', cashierName: 'Thu ngân Thử', openedAt: '2026-09-09T23:30:00.000Z', daysOpen: 57, branchName: multi ? 'Quận 7' : 'Chi nhánh chính' }],
  };
}

function mockInterop(multi) {
  const id = (i) => `00000000-0000-4000-8000-00000000000${i}`;
  return {
    generatedAt: new Date().toISOString(),
    from: '2026-09-01',
    to: '2026-09-30',
    branchCount: multi ? 3 : 1,
    summary: { total: 40, sent: 34, pending: 4, failed: 2, sentPercent: 85, oldestUnsentDays: 55 },
    byDoctor: [
      { doctorName: 'BS. Nguyễn Văn An', total: 25, sent: 19, pending: 4, failed: 2 },
      { doctorName: 'BS. Trần Thị Bình', total: 15, sent: 15, pending: 0, failed: 0 },
    ],
    problemTotal: 6,
    problems: [
      { submissionId: id(1), encounterId: id(1), encounterNo: 'LK2609000011', patientCode: 'BN2026-011', patientName: 'Nguyễn Văn Thử 11', doctorName: 'BS. Nguyễn Văn An', nationalCode: '123456789012-C', status: 'PENDING', attempts: 0, lastHttpStatus: null, errors: ['Chưa đủ dữ liệu để gửi'], signedAt: '2026-09-12T02:30:00.000Z', nextAttemptAt: null, branchName: multi ? 'Quận 7' : 'Chi nhánh chính' },
      { submissionId: id(2), encounterId: id(2), encounterNo: 'LK2609000012', patientCode: 'BN2026-012', patientName: 'Nguyễn Văn Thử 12', doctorName: 'BS. Nguyễn Văn An', nationalCode: '123456789013-C', status: 'FAILED', attempts: 3, lastHttpStatus: 400, errors: ['Mã thuốc không hợp lệ', 'Thiếu tuổi bệnh nhân'], signedAt: '2026-09-13T02:30:00.000Z', nextAttemptAt: null, branchName: multi ? 'Quận 7' : 'Chi nhánh chính' },
    ],
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
    check('menu "Chất lượng và tuân thủ" có trong nhóm Báo cáo', (await page.getByRole('link', { name: 'Chất lượng và tuân thủ', exact: true }).count()) > 0);
    await page.getByRole('link', { name: 'Chất lượng và tuân thủ', exact: true }).first().click();
    await page.getByRole('tab', { name: TABS[0] }).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    check('mở đúng trang', page.url().includes('/reports/quality'), page.url());
    check('tiêu đề "Chất lượng và tuân thủ"', (await page.getByRole('heading', { name: 'Chất lượng và tuân thủ', level: 1, exact: true }).count()) === 1);
    const tabNames = (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim());
    check('đủ 3 tab đúng thứ tự', JSON.stringify(tabNames) === JSON.stringify(TABS), tabNames.join(' | '));
    check('không có chú thích duyệt mockup trong giao diện', (await page.locator('text=/TRƯỜNG MỚI|mockup|hint-placeholder/i').count()) === 0);

    // ── Tab 1: không có bộ chọn kỳ, có dòng "Tình trạng đến hôm nay" ──
    check('tab "Lượt khám chưa hoàn tất" KHÔNG có bộ chọn kỳ, có "Tình trạng đến hôm nay"', (await page.getByRole('group', { name: 'Kỳ của báo cáo' }).count()) === 0 && (await page.locator('text=Tình trạng đến hôm nay').count()) >= 1);
    const ok1 = await waitReport(page, 'Số liệu lượt khám chưa hoàn tất');
    check('Lượt khám chưa hoàn tất (dữ liệu thật): có số liệu hoặc trạng thái "Không có gì tồn đọng"', ok1 || (await page.locator('h2:has-text("Không có gì tồn đọng")').count()) > 0);
    const kpi1 = page.getByRole('group', { name: 'Số liệu lượt khám chưa hoàn tất' });
    if (await kpi1.count()) {
      const t = (await kpi1.innerText()).replace(/\s+/g, ' ');
      check('4 KPI đúng nhãn', ['Lượt khám treo', 'Ca thu ngân chưa đóng', 'Phiếu chưa thu', 'Treo lâu nhất'].every((s) => t.includes(s)), t.slice(0, 200));
    }
    check('không lộ chữ kỹ thuật', !FORBIDDEN.test(noDigits(await page.locator('main, body').first().innerText())));

    // Dữ liệu giả lập: một chi nhánh và nhiều chi nhánh
    for (const multi of [false, true]) {
      await page.route('**/api/v1/reports/quality/incomplete*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockIncomplete(multi) }) }));
      await Promise.all([page.waitForResponse((r) => /reports\/quality\/incomplete/.test(r.url()), { timeout: 15000 }), page.getByRole('button', { name: 'Làm mới' }).click()]);
      const table = page.locator('[role="table"][aria-label="Lượt khám treo"]');
      await table.getByText('Nguyễn Văn Thử 1', { exact: true }).waitFor({ timeout: 15000 });
      await page.waitForTimeout(400);
      const headers = (await table.locator('[role="columnheader"]').allInnerTexts()).map((t) => t.trim().toUpperCase());
      const expectHeaders = ['MÃ LƯỢT KHÁM', 'BỆNH NHÂN', ...(multi ? ['CHI NHÁNH'] : []), 'BÁC SĨ', 'TIẾP NHẬN', 'TRẠNG THÁI', 'ĐÃ TREO'];
      check(`bảng lượt treo ${multi ? 'nhiều chi nhánh có' : 'một chi nhánh KHÔNG có'} cột Chi nhánh`, JSON.stringify(headers) === JSON.stringify(expectHeaders), headers.join(' | '));
      const first = (await table.locator('[role="row"]').nth(1).innerText()).replace(/\s+/g, ' ');
      check('dòng 1: mã, tên, mã BN, ngày dd/mm/yyyy, Chờ khám, 57 ngày', ['LK2609000001', 'Nguyễn Văn Thử 1', 'BN2026-001', '10/09/2026', 'Chờ khám', '57 ngày'].every((s) => first.includes(s)), first);
      const shift = (await page.locator('[role="table"][aria-label="Ca thu ngân chưa đóng"] [role="row"]').nth(1).innerText()).replace(/\s+/g, ' ');
      check('ca thu ngân: mã ca, thu ngân, mở lúc theo giờ Việt Nam', ['PCC2609000001', 'Thu ngân Thử', '57 ngày'].every((s) => shift.includes(s)) && /10\/09\/2026/.test(shift), shift);
      const kpi = (await page.getByRole('group', { name: 'Số liệu lượt khám chưa hoàn tất' }).innerText()).replace(/\s+/g, ' ');
      check('KPI: 2 lượt treo, 1 ca, 4 phiếu chưa thu, treo lâu nhất 57 ngày', ['2', '1', '4', '57 ngày'].every((s) => kpi.includes(s)), kpi.slice(0, 200));
      check('có liên kết sang báo cáo Doanh thu → Phiếu chưa thu', (await page.locator('a[href="/reports/revenue?tab=unpaid"]').count()) === 1);
    }
    await page.screenshot({ path: path.join(OUT, 'incomplete-mock.png'), fullPage: true });
    await page.unroute('**/api/v1/reports/quality/incomplete*');
    await Promise.all([page.waitForResponse((r) => /reports\/quality\/incomplete/.test(r.url()), { timeout: 15000 }), page.getByRole('button', { name: 'Làm mới' }).click()]);

    // ── Excel + In: tab 1 ──
    {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
      const f = path.join(OUT, 'tab1.xlsx');
      await dl.saveAs(f);
      check('tab Lượt khám chưa hoàn tất tải Excel thật', fs.statSync(f).size > 2000 && /^luot-kham-chua-hoan-tat/.test(dl.suggestedFilename()), dl.suggestedFilename());
      await page.evaluate(() => {
        window.__printCalls = 0;
      });
      await page.getByRole('button', { name: 'In' }).first().click();
      await page.waitForFunction(() => window.__printCalls > 0, null, { timeout: 15000 });
      check('tab Lượt khám chưa hoàn tất: nút In và bản in có tiêu đề', (await page.evaluate(() => window.__printCalls)) === 1 && (await page.evaluate(() => document.body.textContent || '')).toLowerCase().includes('lượt khám chưa hoàn tất'));
    }

    // ── Tab 2: Liên thông (dữ liệu thật + giả lập) ──
    await openTab(page, TABS[1]);
    await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Quý', exact: true }).click();
    const ok2 = await waitReport(page, 'Số liệu liên thông đơn thuốc');
    check('Liên thông (dữ liệu thật): có số liệu hoặc trạng thái trống rõ ràng', ok2);
    check('Liên thông không lộ chữ kỹ thuật', !FORBIDDEN.test(noDigits(await page.locator('main, body').first().innerText())));
    {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
      const f = path.join(OUT, 'tab2.xlsx');
      await dl.saveAs(f);
      check('tab Liên thông tải Excel thật', fs.statSync(f).size > 2000 && /^lien-thong-don-thuoc-/.test(dl.suggestedFilename()), dl.suggestedFilename());
      await page.evaluate(() => {
        window.__printCalls = 0;
      });
      await page.getByRole('button', { name: 'In' }).first().click();
      await page.waitForFunction(() => window.__printCalls > 0, null, { timeout: 15000 });
      check('tab Liên thông: nút In và bản in có tiêu đề', (await page.evaluate(() => window.__printCalls)) === 1 && (await page.evaluate(() => document.body.textContent || '')).toLowerCase().includes('liên thông đơn thuốc'));
    }
    for (const multi of [false, true]) {
      await page.route('**/api/v1/reports/quality/interop*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockInterop(multi) }) }));
      await Promise.all([page.waitForResponse((r) => /reports\/quality\/interop/.test(r.url()), { timeout: 15000 }), page.getByRole('button', { name: 'Làm mới' }).click()]);
      const table = page.locator('[role="table"][aria-label="Đơn thuốc chờ gửi hoặc bị cổng từ chối"]');
      await table.getByText('Nguyễn Văn Thử 11', { exact: true }).waitFor({ timeout: 15000 });
      await page.waitForTimeout(400);
      const headers = (await table.locator('[role="columnheader"]').allInnerTexts()).map((t) => t.trim().toUpperCase());
      const expectHeaders = ['MÃ LƯỢT KHÁM', 'BỆNH NHÂN', ...(multi ? ['CHI NHÁNH'] : []), 'BÁC SĨ', 'KÝ LÚC', 'TRẠNG THÁI', 'THỬ', 'LỖI'];
      check(`bảng đơn tồn ${multi ? 'nhiều chi nhánh có' : 'một chi nhánh KHÔNG có'} cột Chi nhánh`, JSON.stringify(headers) === JSON.stringify(expectHeaders), headers.join(' | '));
      const second = (await table.locator('[role="row"]').nth(2).innerText()).replace(/\s+/g, ' ');
      check('dòng cổng từ chối: trạng thái, 3 lần, hai lỗi nguyên văn', ['Cổng từ chối', '3 lần', 'Mã thuốc không hợp lệ; Thiếu tuổi bệnh nhân'].every((s) => second.includes(s)), second);
      const kpi = (await page.getByRole('group', { name: 'Số liệu liên thông đơn thuốc' }).innerText()).replace(/\s+/g, ' ');
      check('KPI: 40 đơn, đã gửi 34 (85%), chờ gửi 4 tồn 55 ngày, cổng từ chối 2', ['40', '34', '85%', '4', 'tồn cũ nhất 55 ngày', '2'].every((s) => kpi.includes(s)), kpi.slice(0, 220));
      const dr = (await page.locator('[role="table"][aria-label="Liên thông đơn thuốc theo bác sĩ"]').innerText()).replace(/\s+/g, ' ');
      check('bảng theo bác sĩ có dòng Cộng 40', dr.includes('BS. Nguyễn Văn An') && dr.includes('Cộng') && dr.includes('40'), dr.slice(0, 160));
    }
    await page.screenshot({ path: path.join(OUT, 'interop-mock.png'), fullPage: true });
    await page.unroute('**/api/v1/reports/quality/interop*');

    // ── Tab "Nhật ký kiểm toán" dẫn sang trang cũ ──
    await page.getByRole('tab', { name: TABS[2], exact: true }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/admin/activity-log'), { timeout: 15000 });
    check('tab "Nhật ký kiểm toán" mở trang nhật ký hoạt động', page.url().includes('/admin/activity-log'), page.url());
    await page.goBack();
    await page.getByRole('tab', { name: TABS[0] }).waitFor({ timeout: 20000 });

    // ── Kỳ tuỳ chọn nhập sai (tab Liên thông) → báo ngay, không gọi máy chủ ──
    await openTab(page, TABS[1]);
    let calls = 0;
    page.on('request', (r) => {
      if (/reports\/quality\/interop\?/.test(r.url())) calls += 1;
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

    // ── Trạng thái lỗi (cả hai tab) ──
    for (const [tab, route, groupName] of [
      [TABS[1], 'interop', 'Số liệu liên thông đơn thuốc'],
      [TABS[0], 'incomplete', 'Số liệu lượt khám chưa hoàn tất'],
    ]) {
      await openTab(page, tab);
      await page.route(`**/api/v1/reports/quality/${route}*`, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error TypeError' } }) }));
      await page.getByRole('button', { name: 'Làm mới' }).click();
      // Lỗi 5xx được thử lại 3 lần (backoff 1+2+4 giây, App.tsx) rồi mới hiện khung lỗi nên chờ rộng hơn 15 giây.
      await page.waitForSelector('button:has-text("Thử lại")', { timeout: 40000 });
      check(`${tab}: lỗi 500 → khung báo lỗi có "Thử lại", không lộ chữ kỹ thuật`, !FORBIDDEN.test(noDigits(await page.locator('body').innerText())));
      await page.unroute(`**/api/v1/reports/quality/${route}*`);
      await page.getByRole('button', { name: 'Thử lại' }).click();
      await page.getByRole('group', { name: groupName }).or(page.locator('h2:has-text("Không có")')).first().waitFor({ timeout: 15000 });
      check(`${tab}: bấm "Thử lại" tải lại được`, true);
    }

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [768, 1024], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const tab of [TABS[0], TABS[1]]) {
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
      await p.goto(WEB + '/reports/quality');
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
