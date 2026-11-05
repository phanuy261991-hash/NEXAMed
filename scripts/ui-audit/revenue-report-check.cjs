/* global require, process, console, window, document */
// KIỂM trang báo cáo "Doanh thu" (docs/DECISIONS.md #287) trên Chrome thật qua địa chỉ IP LAN (HTTP thường, ngữ cảnh KHÔNG bảo mật — #257).
// Gồm: menu, 5 tab đúng thứ tự mockup, tab Theo kỳ (kỳ + "Gom theo", 5 KPI, biểu đồ cột đôi, bảng 10 cột, cột "So kỳ trước"), 4 tab còn lại với dữ liệu thật, Excel thật + In từng tab,
// kỳ Tuỳ chọn nhập sai, trạng thái lỗi (500 → khung báo lỗi có "Thử lại", không lộ chữ kỹ thuật), phân quyền (lễ tân/bác sĩ bị chặn), vài cỡ màn hình.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/revenue-report-check.cjs
// Chuẩn bị như `lan-http-check.cjs` (README.md cùng thư mục): `pnpm dev` + `pnpm dev:lan`, đã `db:seed`. Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5174';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'revenue-report-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Bad Gateway|Internal Server|NOT_FOUND|SERVICE_UNAVAILABLE|ECONN|\b50[0-4]\b|\b404\b|stack/;
/** Văn bản đã bỏ các nhóm số (số tiền, mã phiếu) để mã lỗi HTTP không khớp nhầm vào "1.500.000". */
const noDigits = (text) => text.replace(/\d[\d.,]*/g, '#');

/** Màu tính ra của một phần tử dưới dạng rgb(r, g, b): Chrome trả `oklch(...)` cho màu Tailwind nên vẽ ra canvas 1px để quy đổi. */
async function rgbOf(locator) {
  return locator.evaluate((el) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d');
    g.fillStyle = getComputedStyle(el).color;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
  });
}

/** Chờ tab hiện số liệu (nhóm KPI) hoặc trạng thái trống; trả về true nếu có trong 25 giây. */
async function waitReport(page, groupName) {
  try {
    await page.getByRole('group', { name: groupName }).or(page.locator('h2:has-text("Chưa có"), h2:has-text("Không có")')).first().waitFor({ timeout: 25000 });
    return true;
  } catch {
    return false;
  }
}

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

/** Báo cáo theo kỳ giả lập đúng số liệu của mockup (10 tháng, tháng 10 Ghi nhận 842,6 triệu / Thực thu 791,35 triệu). */
function mockByPeriod() {
  const M = [[610.0, 585.0], [540.0, 520.0], [702.0, 689.0], [735.0, 718.0], [768.0, 751.0], [760.0, 748.0], [790.0, 771.0], [812.0, 799.0], [777.0, 740.0], [842.6, 791.35]];
  const rows = M.map(([g, t], i) => {
    const G = Math.round(g * 1e6);
    const T = Math.round(t * 1e6);
    const a = Math.round((G * 0.4) / 1000) * 1000;
    const b = Math.round((G * 0.31) / 1000) * 1000;
    const c = Math.round((G * 0.22) / 1000) * 1000;
    const prev = i > 0 ? M[i - 1][1] : null;
    return {
      key: `2026-${String(i + 1).padStart(2, '0')}-01`,
      label: `T${i + 1}/2026`,
      byGroup: { EXAM: a, PARACLINICAL: b, DRUG: c, PACKAGE: G - a - b - c },
      recognized: G,
      discount: Math.round((G * 0.015) / 1000) * 1000,
      refunded: Math.round((G * 0.004) / 1000) * 1000,
      collected: T,
      net: T,
      netDeltaPercent: prev === null ? null : Math.round(((t - prev) / prev) * 1000) / 10,
    };
  });
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  return {
    generatedAt: new Date().toISOString(),
    from: '2026-01-01',
    to: '2026-10-31',
    branchCount: 1,
    groupBy: 'month',
    rows,
    totals: {
      byGroup: { EXAM: sum((r) => r.byGroup.EXAM), PARACLINICAL: sum((r) => r.byGroup.PARACLINICAL), DRUG: sum((r) => r.byGroup.DRUG), PACKAGE: sum((r) => r.byGroup.PACKAGE) },
      recognized: sum((r) => r.recognized),
      discount: sum((r) => r.discount),
      refunded: sum((r) => r.refunded),
      collected: sum((r) => r.collected),
      net: sum((r) => r.net),
    },
  };
}

async function openTab(page, name) {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.waitForLoadState('networkidle');
}

async function overflowX(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
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

    // ── Menu và 5 tab ──
    await page.goto(WEB + '/');
    await page.waitForLoadState('networkidle');
    const group = page.getByRole('button', { name: 'Báo cáo', exact: true });
    if (await group.count()) await group.first().click();
    check('menu "Doanh thu" có trong nhóm Báo cáo', (await page.getByRole('link', { name: 'Doanh thu', exact: true }).count()) > 0);
    await page.getByRole('link', { name: 'Doanh thu', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Theo kỳ' }).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    check('mở đúng trang', page.url().includes('/reports/revenue'), page.url());
    check('tiêu đề "Doanh thu"', (await page.getByRole('heading', { name: 'Doanh thu', level: 1, exact: true }).count()) === 1);
    const tabNames = (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim());
    check('đủ 5 tab đúng thứ tự mockup', JSON.stringify(tabNames) === JSON.stringify(['Theo kỳ', 'Theo nhóm và dịch vụ', 'Theo phương thức', 'Phiếu chưa thu', 'Theo thu ngân và chốt ca']), tabNames.join(' | '));

    // ── Theo kỳ: bộ chọn đúng mockup ──
    const kindButtons = (await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
    check('bộ chọn Kỳ có Tháng này, Quý, Năm 2026, Tuỳ chọn', ['Tháng này', 'Quý', 'Năm 2026', 'Tuỳ chọn'].every((k) => kindButtons.includes(k)), kindButtons.join(' | '));
    const groupBy = (await page.getByRole('group', { name: 'Gom doanh thu theo' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
    check('bộ chọn "Gom theo" có Ngày, Tuần, Tháng, Quý', JSON.stringify(groupBy) === JSON.stringify(['Ngày', 'Tuần', 'Tháng', 'Quý']), groupBy.join(' | '));
    check('mặc định Năm và gom theo Tháng (như mockup)', (await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Năm 2026' }).getAttribute('aria-pressed')) === 'true' && (await page.getByRole('group', { name: 'Gom doanh thu theo' }).getByRole('button', { name: 'Tháng' }).getAttribute('aria-pressed')) === 'true');

    // Dữ liệu giả lập đúng số liệu của mockup để so khớp con số, bố cục và màu.
    await page.route('**/api/v1/reports/revenue/by-period?*', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockByPeriod() }) }));
    await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Quý', exact: true }).click();
    await page.locator('[role="table"][aria-label="Doanh thu theo kỳ"]').getByText('842.600.000').first().waitFor({ timeout: 15000 });
    const kpiText = (await page.getByRole('group', { name: 'Số liệu doanh thu theo kỳ' }).innerText()).replace(/\s+/g, ' ');
    check('5 KPI đúng nhãn mockup', ['Tổng ghi nhận', 'Thực thu', 'Chênh lệch', 'Chiết khấu đã cho', 'Hoàn tiền', 'Đã trừ chiết khấu', 'Thu trừ hoàn tiền', 'Chưa thu hoặc thu kỳ khác', 'Đã nằm trong ghi nhận', 'Đã trừ khỏi thực thu'].every((s) => kpiText.includes(s)), kpiText.slice(0, 200));
    const kpiGroup = page.getByRole('group', { name: 'Số liệu doanh thu theo kỳ' });
    const netColor = await rgbOf(kpiGroup.locator('> div', { hasText: /^Thực thu/ }).locator('> div').nth(1));
    const refundColor = await rgbOf(kpiGroup.locator('> div', { hasText: /^Hoàn tiền/ }).locator('> div').nth(1));
    check('KPI "Thực thu" màu xanh lục, "Hoàn tiền" màu đỏ', netColor === 'rgb(0, 122, 85)' && refundColor === 'rgb(199, 0, 54)', `${netColor} | ${refundColor}`);
    const svg = page.locator('svg[role="img"]');
    check('biểu đồ cột đôi: 10 cặp cột (20 cột) và nhãn T1…T10', (await svg.locator('rect').count()) === 20 && (await svg.locator('text', { hasText: /^T10\/2026$/ }).count()) === 1);
    check('cột Ghi nhận xám và cột Thực thu xanh lục', await svg.locator('rect[fill="#94a3b8"]').count() === 10 && (await svg.locator('rect[fill="#047857"]').count()) === 10);
    const table = page.locator('[role="table"][aria-label="Doanh thu theo kỳ"]');
    const headers = (await table.locator('[role="columnheader"]').allInnerTexts()).map((t) => t.trim().toUpperCase());
    check('bảng đủ 10 cột đúng mockup', JSON.stringify(headers) === JSON.stringify(['THÁNG', 'KHÁM BỆNH', 'CẬN LÂM SÀNG', 'THUỐC VÀ VẬT TƯ', 'GÓI DỊCH VỤ', 'TỔNG GHI NHẬN', 'CHIẾT KHẤU', 'HOÀN TIỀN', 'THỰC THU', 'SO KỲ TRƯỚC']), headers.join(' | '));
    const lastRow = (await table.locator('[role="row"]').nth(10).innerText()).replace(/\s+/g, ' ');
    check('dòng T10/2026: ghi nhận 842.600.000, thực thu 791.350.000, so tháng trước ▲ 6,9%', lastRow.includes('T10/2026') && lastRow.includes('842.600.000') && lastRow.includes('791.350.000') && lastRow.includes('▲ 6,9%'), lastRow);
    const firstRow = (await table.locator('[role="row"]').nth(1).innerText()).replace(/\s+/g, ' ');
    check('dòng T1/2026: "So kỳ trước" là "—"', firstRow.includes('T1/2026') && firstRow.trim().endsWith('—'), firstRow);
    const downCell = await rgbOf(table.locator('[role="cell"]:has-text("▼")').first().locator('span'));
    check('mức giảm tô đỏ (T2: ▼ 11,1%)', downCell === 'rgb(199, 0, 54)', downCell);
    const footer = (await table.locator('[role="row"]').last().innerText()).replace(/\s+/g, ' ');
    check('dòng cộng ghi "Cộng 10 tháng"', footer.includes('Cộng 10 tháng'), footer.slice(0, 80));
    check('có hai nhãn nhóm cột "GHI NHẬN · theo ngày khám" và "THỰC THU · theo ngày thu"', (await page.locator('text=/GHI NHẬN · theo ngày khám, đã trừ chiết khấu/').count()) === 1 && (await page.locator('text=/THỰC THU · theo ngày thu/').count()) === 1);
    check('không có chú thích duyệt mockup trong giao diện', (await page.locator('text=/TRƯỜNG MỚI|mockup|hint-placeholder/i').count()) === 0);
    await page.screenshot({ path: path.join(OUT, 'theo-ky.png'), fullPage: true });
    await page.unroute('**/api/v1/reports/revenue/by-period?*');
    await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Năm 2026', exact: true }).click();
    await page.waitForLoadState('networkidle');

    // Dữ liệu thật: đổi cách gom đều tải lại được và giữ nguyên bộ lọc
    for (const g of ['Ngày', 'Tuần', 'Quý', 'Tháng']) {
      await page.getByRole('group', { name: 'Gom doanh thu theo' }).getByRole('button', { name: g, exact: true }).click();
      const ok = await waitReport(page, 'Số liệu doanh thu theo kỳ');
      const rowCount = await page.locator('[role="table"][aria-label="Doanh thu theo kỳ"] [role="row"]').count();
      check(`gom theo ${g}: tải được số liệu thật hoặc trạng thái trống rõ ràng`, ok, `${rowCount - 2} dòng`);
    }

    // Excel + In (dữ liệu thật)
    const [dl0] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
    const f0 = path.join(OUT, 'theo-ky.xlsx');
    await dl0.saveAs(f0);
    check('tải Excel Theo kỳ thật', fs.statSync(f0).size > 2000 && /^doanh-thu-theo-ky-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl0.suggestedFilename()), dl0.suggestedFilename());
    await page.evaluate(() => {
      window.__printCalls = 0;
    });
    await page.getByRole('button', { name: 'In' }).first().click();
    await page.waitForFunction(() => window.__printCalls > 0, null, { timeout: 15000 });
    check('nút In gọi hộp in của trình duyệt', (await page.evaluate(() => window.__printCalls)) === 1);
    check('bản in có tiêu đề "Doanh thu theo kỳ"', /doanh thu theo kỳ/i.test(await page.evaluate(() => document.body.textContent || '')));

    // ── 4 tab còn lại với dữ liệu thật ──
    await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Năm 2026' }).click();
    const cases = [
      ['Theo nhóm và dịch vụ', 'Số liệu doanh thu theo nhóm', 'Tổng ghi nhận', /^doanh-thu-theo-dich-vu-/],
      ['Theo phương thức', 'Số liệu doanh thu theo phương thức', 'Thực thu', /^doanh-thu-theo-phuong-thuc-/],
      ['Phiếu chưa thu', 'Số liệu phiếu chưa thu', 'Phiếu chưa thu', /^phieu-chua-thu-/],
      ['Theo thu ngân và chốt ca', 'Số liệu doanh thu theo thu ngân', 'Số ca thu ngân', /^doanh-thu-theo-thu-ngan-/],
    ];
    for (const [tab, groupName, label, fileRe] of cases) {
      await openTab(page, tab);
      await waitReport(page, groupName);
      const hasKpi = (await page.getByRole('group', { name: groupName }).count()) === 1;
      const empty = (await page.locator('h2:has-text("Chưa có"), h2:has-text("Không có")').count()) > 0;
      check(`tab "${tab}" hiện số liệu hoặc trạng thái trống rõ ràng`, hasKpi || empty, hasKpi ? (await page.getByRole('group', { name: groupName }).innerText()).replace(/\s+/g, ' ').slice(0, 140) : 'trống');
      if (hasKpi) check(`tab "${tab}" có nhãn "${label}"`, (await page.getByRole('group', { name: groupName }).innerText()).includes(label));
      const body = await page.locator('main, body').first().innerText();
      check(`tab "${tab}" không lộ chữ kỹ thuật`, !FORBIDDEN.test(noDigits(body)));
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
      const f = path.join(OUT, `tab-${tab.replace(/\s+/g, '-')}.xlsx`);
      await dl.saveAs(f);
      check(`tab "${tab}" tải Excel thật`, fs.statSync(f).size > 2000 && fileRe.test(dl.suggestedFilename()), dl.suggestedFilename());
      await page.evaluate(() => {
        window.__printCalls = 0;
      });
      await page.getByRole('button', { name: 'In' }).first().click();
      await page.waitForFunction(() => window.__printCalls > 0, null, { timeout: 15000 });
      check(`tab "${tab}" nút In`, true);
      await page.screenshot({ path: path.join(OUT, `tab-${tab.replace(/\s+/g, '-')}.png`), fullPage: true });
    }

    // ── Kỳ tuỳ chọn nhập sai → báo ngay, không gọi máy chủ ──
    await openTab(page, 'Theo kỳ');
    let calls = 0;
    page.on('request', (r) => {
      if (/reports\/revenue\/by-period\?/.test(r.url())) calls += 1;
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
    await page.route('**/api/v1/reports/revenue/by-period?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error TypeError' } }) }));
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await page.waitForSelector('button:has-text("Thử lại")', { timeout: 15000 });
    check('lỗi 500 → khung báo lỗi có "Thử lại", không lộ chữ kỹ thuật', !FORBIDDEN.test(noDigits(await page.locator('body').innerText())));
    await page.unroute('**/api/v1/reports/revenue/by-period?*');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await page.getByRole('group', { name: 'Số liệu doanh thu theo kỳ' }).or(page.getByRole('heading', { name: 'Chưa có doanh thu trong kỳ' })).first().waitFor({ timeout: 15000 });
    check('bấm "Thử lại" tải lại được', true);

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [768, 1024], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const tab of ['Theo kỳ', 'Theo nhóm và dịch vụ', 'Phiếu chưa thu', 'Theo thu ngân và chốt ca']) {
        await openTab(page, tab);
        await page.waitForTimeout(400);
        const over = await overflowX(page);
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
      await p.goto(WEB + '/reports/revenue');
      await p.waitForLoadState('networkidle');
      const text = await p.locator('body').innerText();
      check(`${user}: không mở được trang, có thông báo tiếng Việt và lối về`, !(await p.getByRole('tab', { name: 'Theo kỳ' }).count()) && /không có quyền/i.test(text) && !FORBIDDEN.test(text), text.replace(/\s+/g, ' ').slice(0, 120));
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
