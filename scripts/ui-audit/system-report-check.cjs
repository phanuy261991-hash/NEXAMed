/* global require, process, console, window, document */
// KIỂM trang báo cáo "Toàn hệ thống" (docs/DECISIONS.md #287) trên Chrome thật qua địa chỉ IP LAN (HTTP thường, ngữ cảnh KHÔNG bảo mật — #257).
// Gồm: menu, 4 tab đúng thứ tự mockup, bộ chọn Kỳ 7 nút, tab So sánh chi nhánh (5 KPI kèm so kỳ trước, bảng 9 cột, dòng cộng, màu, biểu đồ đường 3 chuỗi khác nét, cơ cấu theo nhóm, Cần chú ý,
// bấm tên chi nhánh → xem riêng) bằng dữ liệu giả lập đúng số liệu mockup, Xếp hạng/Tổng hợp tháng/Khám chéo bằng dữ liệu thật, Excel thật + In từng tab, kỳ Tuỳ chọn nhập sai, lỗi 500 → "Thử lại",
// phân quyền (lễ tân/bác sĩ bị chặn), vài cỡ màn hình.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/system-report-check.cjs
// Chuẩn bị như `lan-http-check.cjs` (README.md cùng thư mục): `pnpm dev` + `pnpm dev:lan`, đã `db:seed`. Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5174';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'system-report-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Bad Gateway|Internal Server|NOT_FOUND|SERVICE_UNAVAILABLE|ECONN|\b50[0-4]\b|\b404\b|stack/;
/** Bỏ các nhóm số để mã lỗi HTTP không khớp nhầm vào số tiền ("1.500.000"). */
const noDigits = (text) => text.replace(/\d[\d.,]*/g, '#');

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

/** Màu tính ra dưới dạng rgb(r, g, b): Chrome trả `oklch(...)` cho màu Tailwind nên vẽ ra canvas 1px để quy đổi. */
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

async function waitReport(page, groupName) {
  try {
    await page.getByRole('group', { name: groupName }).or(page.locator('h2:has-text("Không có"), h2:has-text("Chưa có"), h2:has-text("Cần xem")')).first().waitFor({ timeout: 25000 });
    return true;
  } catch {
    return false;
  }
}

/** Tổng quan giả lập đúng số liệu mockup: 3 chi nhánh, tháng 10/2026, so với tháng 09/2026. */
function mockOverview() {
  const ids = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3'];
  const names = ['Quận 1', 'Quận 7', 'Thủ Đức'];
  const dates = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const base = [12, 8, 4.6];
  const rows = [
    { visits: 612, newPatients: 148, recognized: 410_200_000, collected: 388_600_000, unpaidAmount: 18_400_000, unpaidCount: 7, averageWaitMinutes: 14, followUpArrivalPercent: 74, drugMargin: 51_300_000 },
    { visits: 431, newPatients: 104, recognized: 276_900_000, collected: 259_300_000, unpaidAmount: 17_600_000, unpaidCount: 6, averageWaitMinutes: 19, followUpArrivalPercent: 69, drugMargin: 31_900_000 },
    { visits: 241, newPatients: 60, recognized: 155_500_000, collected: 143_450_000, unpaidAmount: 12_200_000, unpaidCount: 5, averageWaitMinutes: 22, followUpArrivalPercent: 63, drugMargin: 13_280_000 },
  ].map((r, i) => ({ branchId: ids[i], branchName: names[i], ...r }));
  const kpi = (value, previous) => ({ value, previous, percent: Math.round(((value - previous) / previous) * 1000) / 10, direction: value >= previous ? 'up' : 'down' });
  return {
    generatedAt: new Date().toISOString(),
    from: '2026-10-01',
    to: '2026-10-31',
    branchCount: 3,
    previousFrom: '2026-09-01',
    previousTo: '2026-09-30',
    kpis: {
      recognized: kpi(842_600_000, 777_270_000),
      collected: kpi(791_350_000, 740_270_000),
      visits: kpi(1284, 1220),
      newPatients: kpi(312, 319),
      unpaidAmount: 48_200_000,
      unpaidCount: 18,
    },
    rows,
    totals: { visits: 1284, newPatients: 312, recognized: 842_600_000, collected: 791_350_000, unpaidAmount: 48_200_000, unpaidCount: 18, averageWaitMinutes: 18, followUpArrivalPercent: 71, drugMargin: 96_480_000 },
    daily: { dates, series: ids.map((id, i) => ({ branchId: id, branchName: names[i], values: dates.map((_, d) => Math.round(base[i] * 1_000_000 * (1 + 0.15 * Math.sin(d / 2 + i)))) })) },
    groups: [
      { group: 'EXAM', amount: 318_400_000, sharePercent: 40.2 },
      { group: 'PARACLINICAL', amount: 246_700_000, sharePercent: 31.2 },
      { group: 'DRUG', amount: 172_250_000, sharePercent: 21.8 },
      { group: 'PACKAGE', amount: 54_000_000, sharePercent: 6.8 },
    ],
    groupTotal: 791_350_000,
    alerts: [
      { kind: 'OPEN_SHIFTS', branchId: ids[2], branchName: 'Thủ Đức', text: '2 ca thu ngân chưa chốt từ hôm qua', count: 2 },
      { kind: 'OVERDUE_UNPAID', branchId: ids[1], branchName: 'Quận 7', text: '14 phiếu chưa thu quá 3 ngày', count: 14 },
      { kind: 'EXPIRING_BATCHES', branchId: ids[0], branchName: 'Quận 1', text: '6 lô thuốc hết hạn trong 30 ngày', count: 6 },
      { kind: 'LONG_WAIT', branchId: ids[2], branchName: 'Thủ Đức', text: 'Thời gian chờ trung bình 22 phút, cao nhất hệ thống', count: 22 },
    ],
  };
}

async function openTab(page, name) {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.waitForLoadState('networkidle');
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
    await page.evaluate(() => {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('nexamed.reportScope.')).forEach((k) => localStorage.removeItem(k));
      } catch {
        /* bỏ qua */
      }
    });

    // ── Menu và 4 tab ──
    await page.goto(WEB + '/');
    await page.waitForLoadState('networkidle');
    const group = page.getByRole('button', { name: 'Báo cáo', exact: true });
    if (await group.count()) await group.first().click();
    check('menu "Toàn hệ thống" có trong nhóm Báo cáo', (await page.getByRole('link', { name: 'Toàn hệ thống', exact: true }).count()) > 0);
    await page.getByRole('link', { name: 'Toàn hệ thống', exact: true }).first().click();
    await page.getByRole('tab', { name: 'So sánh chi nhánh', exact: true }).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    check('mở đúng trang', page.url().includes('/reports/system'), page.url());
    check('tiêu đề "Toàn hệ thống"', (await page.getByRole('heading', { name: 'Toàn hệ thống', level: 1, exact: true }).count()) === 1);
    const tabNames = (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim());
    check('đủ 4 tab đúng thứ tự mockup', JSON.stringify(tabNames) === JSON.stringify(['So sánh chi nhánh', 'Xếp hạng', 'Tổng hợp tháng', 'Khám chéo chi nhánh']), tabNames.join(' | '));
    const kinds = (await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
    check('bộ chọn Kỳ đúng mockup: Hôm nay, 7 ngày, Tháng này, Tháng trước, Quý, Năm (ghi năm), Tuỳ chọn', JSON.stringify(kinds) === JSON.stringify(['Hôm nay', '7 ngày', 'Tháng này', 'Tháng trước', 'Quý', 'Năm 2026', 'Tuỳ chọn']), kinds.join(' | '));
    const scopeButtons = (await page.getByRole('group', { name: /Phạm vi/ }).getByRole('button').allInnerTexts().catch(() => [])).map((t) => t.trim());
    check('phạm vi mặc định là "Tất cả chi nhánh" (chưa từng chọn)', (await page.getByRole('button', { name: 'Tất cả chi nhánh', exact: true }).getAttribute('aria-pressed').catch(() => null)) === 'true', scopeButtons.join(' | '));

    // ── So sánh chi nhánh: dữ liệu giả lập đúng mockup ──
    const requests = [];
    page.on('request', (r) => {
      if (/reports\/system\/overview\?/.test(r.url())) requests.push(r.url());
    });
    await page.route('**/api/v1/reports/system/overview?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockOverview() }) }));
    await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Tháng trước', exact: true }).click();
    const table = page.locator('[role="table"][aria-label="So sánh chi nhánh"]');
    await table.getByText('Thủ Đức').waitFor({ timeout: 15000 });
    const kpiText = (await page.getByRole('group', { name: 'Số liệu toàn hệ thống' }).innerText()).replace(/\s+/g, ' ');
    check(
      '5 KPI đúng nhãn, số và so kỳ trước như mockup',
      ['Ghi nhận', '842.600.000', '▲ 8,4% so với kỳ trước', 'Thực thu', '791.350.000', '▲ 6,9% so với kỳ trước', 'Lượt khám', '1.284', '▲ 5,2% so với kỳ trước', 'Bệnh nhân mới', '312', '▼ 2,2% so với kỳ trước', 'Chờ thu', '48.200.000', '18 phiếu'].every((s) => kpiText.includes(s)),
      kpiText.slice(0, 300),
    );
    const caption = (await page.locator('p:has-text("Đang xem:")').innerText()).replace(/\s+/g, ' ');
    check('dòng "Đang xem": tên 3 chi nhánh, kỳ và kỳ so sánh', ['Quận 1, Quận 7, Thủ Đức', '01/10/2026 – 31/10/2026', 'so với 01/09/2026 – 30/09/2026'].every((s) => caption.includes(s)), caption);
    const headers = (await table.locator('[role="columnheader"]').allInnerTexts()).map((t) => t.trim().toUpperCase());
    check('bảng đủ 9 cột đúng mockup', JSON.stringify(headers) === JSON.stringify(['CHI NHÁNH', 'LƯỢT KHÁM', 'BN MỚI', 'GHI NHẬN', 'THỰC THU', 'CHỜ THU', 'CHỜ TB (PHÚT)', 'TÁI KHÁM ĐÃ ĐẾN', 'LÃI GỘP THUỐC']), headers.join(' | '));
    const first = (await table.locator('[role="row"]').nth(1).innerText()).replace(/\s+/g, ' ');
    check('dòng Quận 1: 612, 148, 410.200.000, 388.600.000, 18.400.000, 14, 74%, 51.300.000', ['Quận 1', '612', '148', '410.200.000', '388.600.000', '18.400.000', '14', '74%', '51.300.000'].every((s) => first.includes(s)), first);
    const third = (await table.locator('[role="row"]').nth(3).innerText()).replace(/\s+/g, ' ');
    check('dòng Thủ Đức: 241, 60, 155.500.000, 143.450.000, 12.200.000, 22, 63%, 13.280.000', ['Thủ Đức', '241', '60', '155.500.000', '143.450.000', '12.200.000', '22', '63%', '13.280.000'].every((s) => third.includes(s)), third);
    const footer = (await table.locator('[role="row"]').last().innerText()).replace(/\s+/g, ' ');
    check('dòng cộng: "Cộng 3 chi nhánh", 1.284, 312, 842.600.000, 791.350.000, 48.200.000, 96.480.000', ['Cộng 3 chi nhánh', '1.284', '312', '842.600.000', '791.350.000', '48.200.000', '96.480.000'].every((s) => footer.includes(s)), footer);
    const realColor = await rgbOf(table.locator('[role="row"]').nth(1).locator('span.text-emerald-700').first());
    check('số thực thu màu xanh lục', realColor === 'rgb(0, 122, 85)', realColor);
    check('ghi chú "Bấm tên chi nhánh để xem riêng"', (await page.locator('text=Bấm tên chi nhánh để xem riêng').count()) === 1);
    check('có khung "Thực thu theo ngày, từng chi nhánh" với đơn vị Triệu đồng', (await page.locator('section h2', { hasText: 'Thực thu theo ngày, từng chi nhánh' }).count()) === 1);
    const lines = await page.locator('svg[aria-label^="Thực thu theo ngày"] polyline').evaluateAll((els) => els.map((el) => ({ stroke: el.getAttribute('stroke'), dash: el.getAttribute('stroke-dasharray') })));
    check('biểu đồ đường 3 chuỗi, mỗi chuỗi một màu và một kiểu nét khác nhau', lines.length === 3 && new Set(lines.map((l) => l.stroke)).size === 3 && new Set(lines.map((l) => l.dash)).size === 3, JSON.stringify(lines));
    const legend = (await page.locator('section[aria-label="Thực thu theo ngày, từng chi nhánh"]').innerText()).replace(/\s+/g, ' ');
    check('chú giải biểu đồ ghi tên 3 chi nhánh', ['Quận 1', 'Quận 7', 'Thủ Đức'].every((s) => legend.includes(s)));
    const groupsText = (await page.locator('section[aria-label="Cơ cấu thực thu theo nhóm"]').innerText()).replace(/\s+/g, ' ');
    check('cơ cấu theo nhóm: 4 nhóm đúng số mockup, tổng 791.350.000', ['Khám bệnh', '318.400.000', 'Cận lâm sàng', '246.700.000', 'Thuốc và vật tư', '172.250.000', 'Gói dịch vụ', '54.000.000', '791.350.000'].every((s) => groupsText.includes(s)), groupsText.slice(0, 200));
    const alertsText = (await page.locator('section[aria-label="Cần chú ý"]').innerText()).replace(/\s+/g, ' ');
    check(
      'Cần chú ý: 4 dòng đúng nội dung mockup và có liên kết "Xem"',
      ['Thủ Đức', '2 ca thu ngân chưa chốt từ hôm qua', 'Quận 7', '14 phiếu chưa thu quá 3 ngày', 'Quận 1', '6 lô thuốc hết hạn trong 30 ngày', 'Thời gian chờ trung bình 22 phút, cao nhất hệ thống'].every((s) => alertsText.includes(s)) &&
        (await page.locator('section[aria-label="Cần chú ý"] a:has-text("Xem")').count()) === 4,
      alertsText.slice(0, 200),
    );
    const hrefs = await page.locator('section[aria-label="Cần chú ý"] a:has-text("Xem")').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    check('liên kết "Xem" dẫn tới trang thật', JSON.stringify(hrefs) === JSON.stringify(['/billing/cashier-shifts', '/reports/revenue?tab=unpaid', '/inventory/balances', '/reports/operations?tab=waiting']), JSON.stringify(hrefs));
    check('không có chú thích duyệt mockup trong giao diện', (await page.locator('text=/TRƯỜNG MỚI|mockup|hint-placeholder/i').count()) === 0);
    await page.screenshot({ path: path.join(OUT, 'so-sanh-chi-nhanh.png'), fullPage: true });

    // Bấm tên chi nhánh → xem riêng chi nhánh đó
    requests.length = 0;
    await table.getByRole('button', { name: 'Quận 7', exact: true }).click();
    await page.waitForTimeout(1000);
    check('bấm tên chi nhánh → gửi scope=pick đúng chi nhánh', requests.some((u) => u.includes('scope=pick') && u.includes('branchIds=00000000-0000-4000-8000-0000000000a2')), requests.slice(-1)[0] || 'không có yêu cầu');
    await page.getByRole('button', { name: 'Tất cả chi nhánh', exact: true }).click();
    await page.waitForTimeout(500);
    await page.unroute('**/api/v1/reports/system/overview?*');

    // ── Dữ liệu thật: 4 tab — Excel + In ──
    const cases = [
      ['So sánh chi nhánh', 'Số liệu toàn hệ thống', 'Chờ thu', /^toan-he-thong-so-sanh-chi-nhanh-/],
      ['Xếp hạng', null, null, /^toan-he-thong-xep-hang-/],
      ['Tổng hợp tháng', 'Số liệu tổng hợp tháng', 'Lãi gộp thuốc', /^toan-he-thong-tong-hop-thang-/],
      ['Khám chéo chi nhánh', 'Số liệu khám chéo chi nhánh', 'Tỉ lệ khám chéo', /^toan-he-thong-kham-cheo-chi-nhanh-/],
    ];
    for (const [tab, groupName, label, fileRe] of cases) {
      await openTab(page, tab);
      if (tab !== 'Tổng hợp tháng') await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Quý', exact: true }).click();
      if (groupName) await waitReport(page, groupName);
      else await page.locator('section h2, h2:has-text("Chưa có")').first().waitFor({ timeout: 25000 }).catch(() => undefined);
      await page.waitForLoadState('networkidle');
      const hasKpi = groupName ? (await page.getByRole('group', { name: groupName }).count()) === 1 : (await page.locator('section h2').count()) > 0;
      const empty = (await page.locator('h2:has-text("Không có"), h2:has-text("Chưa có"), h2:has-text("Cần xem")').count()) > 0;
      check(`tab "${tab}" hiện số liệu hoặc trạng thái trống rõ ràng`, hasKpi || empty, hasKpi && groupName ? (await page.getByRole('group', { name: groupName }).innerText()).replace(/\s+/g, ' ').slice(0, 140) : empty ? 'trống' : 'có khung');
      if (groupName && hasKpi) check(`tab "${tab}" có nhãn "${label}"`, (await page.getByRole('group', { name: groupName }).innerText()).includes(label));
      check(`tab "${tab}" không lộ chữ kỹ thuật`, !FORBIDDEN.test(noDigits(await page.locator('main, body').first().innerText())));
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
      const f = path.join(OUT, `tab-${tab.replace(/\s+/g, '-')}.xlsx`);
      await dl.saveAs(f);
      check(`tab "${tab}" tải Excel thật`, fs.statSync(f).size > 2000 && fileRe.test(dl.suggestedFilename()), dl.suggestedFilename());
      await page.evaluate(() => {
        window.__printCalls = 0;
      });
      await page.getByRole('button', { name: 'In' }).first().click();
      await page.waitForFunction(() => window.__printCalls > 0, null, { timeout: 15000 });
      check(`tab "${tab}" nút In gọi hộp in của trình duyệt`, (await page.evaluate(() => window.__printCalls)) === 1);
      await page.screenshot({ path: path.join(OUT, `tab-${tab.replace(/\s+/g, '-')}.png`), fullPage: true });
    }

    // Xếp hạng: ba loại
    await openTab(page, 'Xếp hạng');
    await page.getByRole('group', { name: 'Loại xếp hạng' }).waitFor({ timeout: 15000 });
    const rankKinds = (await page.getByRole('group', { name: 'Loại xếp hạng' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
    check('Xếp hạng có 3 loại: Dịch vụ, Bác sĩ, Thuốc và vật tư', JSON.stringify(rankKinds) === JSON.stringify(['Dịch vụ', 'Bác sĩ', 'Thuốc và vật tư']), rankKinds.join(' | '));
    for (const kind of ['Bác sĩ', 'Thuốc và vật tư', 'Dịch vụ']) {
      await page.getByRole('group', { name: 'Loại xếp hạng' }).getByRole('button', { name: kind, exact: true }).click();
      await page.waitForTimeout(500);
      const body = await page.locator('main, body').first().innerText();
      check(`Xếp hạng "${kind}": có bảng hoặc trạng thái trống, không lộ chữ kỹ thuật`, (await page.locator('[role="table"]').count()) > 0 || /Chưa có|Chưa bán/.test(body) ? !FORBIDDEN.test(noDigits(body)) : false);
    }

    // Tổng hợp tháng: bộ chọn tháng gửi đúng tham số
    await openTab(page, 'Tổng hợp tháng');
    const monthRequests = [];
    page.on('request', (r) => {
      if (/reports\/system\/monthly\?/.test(r.url())) monthRequests.push(r.url());
    });
    const monthInput = page.locator('#system-report-month');
    await monthInput.waitFor({ timeout: 15000 });
    check('có ô chọn Tháng (mặc định tháng trước)', (await monthInput.count()) === 1 && /Tháng \d{2}\/\d{4}/.test((await monthInput.inputValue().catch(() => '')) || (await monthInput.innerText().catch(() => ''))));
    await monthInput.click();
    const monthOptionsText = await page.locator('[role="option"]').allInnerTexts();
    check('danh sách tháng có từ 12 tháng trở lên, mới nhất trước', monthOptionsText.length >= 12 && /Tháng \d{2}\/\d{4}/.test(monthOptionsText[0]), `${monthOptionsText.length} tháng; đầu: ${monthOptionsText[0]}`);
    monthRequests.length = 0;
    await page.locator('[role="option"]').nth(2).click();
    await page.waitForTimeout(1500);
    check('chọn tháng khác → gửi tham số month', monthRequests.some((u) => /month=\d{4}-\d{2}/.test(u)), monthRequests.slice(-1)[0] || 'không có yêu cầu');

    // Khám chéo: chỉ xem một chi nhánh → báo cần từ hai chi nhánh
    await openTab(page, 'Khám chéo chi nhánh');
    await page.getByRole('button', { name: 'Chi nhánh đang làm', exact: true }).click();
    await page.waitForTimeout(1500);
    check('Khám chéo ở phạm vi một chi nhánh → "Cần xem từ hai chi nhánh"', (await page.locator('h2:has-text("Cần xem từ hai chi nhánh")').count()) === 1);
    await page.getByRole('button', { name: 'Tất cả chi nhánh', exact: true }).click();
    await page.waitForTimeout(800);

    // ── Kỳ tuỳ chọn nhập sai → báo ngay, không gọi máy chủ ──
    await openTab(page, 'So sánh chi nhánh');
    let calls = 0;
    page.on('request', (r) => {
      if (/reports\/system\/overview\?/.test(r.url())) calls += 1;
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
    await page.route('**/api/v1/reports/system/overview?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error TypeError' } }) }));
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await page.waitForSelector('button:has-text("Thử lại")', { timeout: 15000 });
    check('lỗi 500 → khung báo lỗi có "Thử lại", không lộ chữ kỹ thuật', !FORBIDDEN.test(noDigits(await page.locator('body').innerText())));
    await page.unroute('**/api/v1/reports/system/overview?*');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await page.getByRole('group', { name: 'Số liệu toàn hệ thống' }).or(page.locator('h2:has-text("Không có")')).first().waitFor({ timeout: 20000 });
    check('bấm "Thử lại" tải lại được', true);

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [768, 1024], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const tab of ['So sánh chi nhánh', 'Xếp hạng', 'Tổng hợp tháng', 'Khám chéo chi nhánh']) {
        await openTab(page, tab);
        await page.waitForTimeout(600);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${w}×${h} · ${tab}: trang không cuộn ngang`, over <= 1, `lệch ${over}px`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  } catch (err) {
    check('kịch bản chạy hết không ngoại lệ', false, String(err && err.message ? err.message : err).slice(0, 300));
    await page.screenshot({ path: path.join(OUT, 'loi.png') }).catch(() => undefined);
  }

  // ── Phân quyền: lễ tân và bác sĩ không có quyền xem báo cáo toàn công ty ──
  for (const user of ['rl.receptionist', 'rl.doctor']) {
    const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    try {
      await login(p, user, '12345678');
      await p.goto(WEB + '/reports/system');
      await p.waitForLoadState('networkidle');
      const text = await p.locator('body').innerText();
      check(`${user}: không mở được trang, có thông báo tiếng Việt và lối về`, !(await p.getByRole('tab', { name: 'So sánh chi nhánh', exact: true }).count()) && /không có quyền/i.test(text) && !FORBIDDEN.test(noDigits(text)), text.replace(/\s+/g, ' ').slice(0, 120));
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
