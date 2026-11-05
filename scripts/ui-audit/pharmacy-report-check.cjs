/* global require, process, console, window, document */
// KIỂM trang báo cáo "Thuốc và vật tư" (docs/DECISIONS.md #287) trên Chrome thật qua địa chỉ IP LAN (HTTP thường, ngữ cảnh KHÔNG bảo mật — #257).
// Gồm: menu, 7 tab đúng thứ tự mockup, 4 tab kho chuyển sang trang cũ, tab Lãi gộp (4 KPI, bảng 8 cột, thanh biên, dòng cộng, màu, lọc Loại gửi đúng tham số) bằng dữ liệu giả lập đúng số liệu mockup,
// tab Đã phát và Kiểm soát đặc biệt với dữ liệu thật, Excel thật + In từng tab, kỳ Tuỳ chọn nhập sai, trạng thái lỗi (500 → khung báo lỗi có "Thử lại"), phân quyền (lễ tân/bác sĩ bị chặn), vài cỡ màn hình.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/pharmacy-report-check.cjs
// Chuẩn bị như `lan-http-check.cjs` (README.md cùng thư mục): `pnpm dev` + `pnpm dev:lan`, đã `db:seed`. Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5174';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'pharmacy-report-check');
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

async function waitReport(page, groupName) {
  try {
    await page.getByRole('group', { name: groupName }).or(page.locator('h2:has-text("Không có"), h2:has-text("Chưa có"), h2:has-text("Chưa bán"), h2:has-text("Chưa phát")')).first().waitFor({ timeout: 25000 });
    return true;
  } catch {
    return false;
  }
}

/** Lãi gộp giả lập đúng số liệu của mockup: 8 mặt hàng đầu, còn 142 mặt hàng khác, tổng 172.250.000 / 75.770.000. */
function mockMargin() {
  const I = [
    ['Siro ho thảo dược 90ml', 'MEDICINE', 'Chai', 410, 70000, 42000],
    ['Omeprazol 20mg', 'MEDICINE', 'Viên', 3100, 3000, 1700],
    ['Amoxicillin 500mg', 'MEDICINE', 'Viên', 4820, 2000, 1300],
    ['Paracetamol 500mg', 'MEDICINE', 'Viên', 7350, 1000, 500],
    ['Cetirizin 10mg', 'MEDICINE', 'Viên', 2600, 2000, 1000],
    ['Vitamin C 500mg', 'MEDICINE', 'Viên', 5400, 1000, 500],
    ['Găng tay y tế', 'SUPPLY', 'Đôi', 3000, 2000, 1300],
    ['Bơm tiêm 5ml', 'SUPPLY', 'Cái', 1250, 2000, 1100],
  ]
    .map((x) => ({ n: x[0], t: x[1], u: x[2], q: x[3], s: x[3] * x[4], c: x[3] * x[5] }))
    .sort((a, b) => b.s - b.c - (a.s - a.c));
  const rows = I.map((x, i) => ({
    drugId: `00000000-0000-4000-8000-00000000000${i + 1}`,
    code: `M${i + 1}`,
    name: x.n,
    itemType: x.t,
    unitName: x.u,
    quantity: x.q,
    sell: x.s,
    cost: x.c,
    margin: x.s - x.c,
    marginPercent: Math.round(((x.s - x.c) / x.s) * 1000) / 10,
  }));
  return {
    generatedAt: new Date().toISOString(),
    from: '2026-10-01',
    to: '2026-10-31',
    branchCount: 3,
    itemType: 'ALL',
    totals: { sell: 172_250_000, cost: 75_770_000, margin: 96_480_000, marginPercent: 56, itemCount: 150 },
    rows,
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

    // ── Menu và 7 tab ──
    await page.goto(WEB + '/');
    await page.waitForLoadState('networkidle');
    const group = page.getByRole('button', { name: 'Báo cáo', exact: true });
    if (await group.count()) await group.first().click();
    check('menu "Thuốc và vật tư" có trong nhóm Báo cáo', (await page.getByRole('link', { name: 'Thuốc và vật tư', exact: true }).count()) > 0);
    await page.getByRole('link', { name: 'Thuốc và vật tư', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Đã phát', exact: true }).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    check('mở đúng trang', page.url().includes('/reports/pharmacy'), page.url());
    check('tiêu đề "Thuốc và vật tư"', (await page.getByRole('heading', { name: 'Thuốc và vật tư', level: 1, exact: true }).count()) === 1);
    const tabNames = (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim());
    check(
      'đủ 7 tab đúng thứ tự mockup',
      JSON.stringify(tabNames) === JSON.stringify(['Đã phát', 'Lãi gộp', 'Kiểm soát đặc biệt', 'Nhập-Xuất-Tồn', 'Tồn kho và hạn dùng', 'Hao hụt điều chuyển', 'Công nợ nhà cung cấp']),
      tabNames.join(' | '),
    );
    const kinds = (await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
    check('bộ chọn Kỳ đúng mockup: Tháng này, Tháng trước, Quý, Tuỳ chọn', JSON.stringify(kinds) === JSON.stringify(['Tháng này', 'Tháng trước', 'Quý', 'Tuỳ chọn']), kinds.join(' | '));
    const loai = (await page.getByRole('group', { name: 'Loại mặt hàng' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
    check('bộ lọc Loại đúng mockup: Tất cả, Thuốc, Vật tư y tế', JSON.stringify(loai) === JSON.stringify(['Tất cả', 'Thuốc', 'Vật tư y tế']), loai.join(' | '));

    // ── Lãi gộp: dữ liệu giả lập đúng mockup ──
    await openTab(page, 'Lãi gộp');
    check('bấm tab Lãi gộp ghi ?tab=margin', page.url().includes('tab=margin'), page.url());
    const marginRequests = [];
    page.on('request', (r) => {
      if (/reports\/pharmacy\/margin\?/.test(r.url())) marginRequests.push(r.url());
    });
    await page.route('**/api/v1/reports/pharmacy/margin?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockMargin() }) }));
    await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Tháng trước', exact: true }).click();
    const table = page.locator('[role="table"][aria-label="Lãi gộp theo mặt hàng"]');
    await table.getByText('Siro ho thảo dược 90ml').waitFor({ timeout: 15000 });
    const kpiText = (await page.getByRole('group', { name: 'Số liệu lãi gộp thuốc và vật tư' }).innerText()).replace(/\s+/g, ' ');
    check('4 KPI đúng nhãn và số mockup', ['Tiền bán', '172.250.000', 'sau chiết khấu', 'Giá vốn', '75.770.000', 'theo thẻ kho', 'Lãi gộp', '96.480.000', 'tiền bán trừ giá vốn', 'Biên lãi gộp', '56,0%', 'lãi gộp chia tiền bán'].every((s) => kpiText.includes(s)), kpiText.slice(0, 260));
    const headers = (await table.locator('[role="columnheader"]').allInnerTexts()).map((t) => t.trim().toUpperCase());
    check('bảng đủ 8 cột đúng mockup', JSON.stringify(headers) === JSON.stringify(['MẶT HÀNG', 'LOẠI', 'ĐVT', 'SỐ LƯỢNG', 'TIỀN BÁN', 'GIÁ VỐN', 'LÃI GỘP', 'BIÊN LÃI GỘP']), headers.join(' | '));
    const first = (await table.locator('[role="row"]').nth(1).innerText()).replace(/\s+/g, ' ');
    check('dòng 1 (lãi gộp lớn nhất): Siro ho thảo dược 90ml, Thuốc, Chai, 410, 28.700.000, 17.220.000, 11.480.000, 40,0%', ['Siro ho thảo dược 90ml', 'Thuốc', 'Chai', '410', '28.700.000', '17.220.000', '11.480.000', '40,0%'].every((s) => first.includes(s)), first);
    const second = (await table.locator('[role="row"]').nth(2).innerText()).replace(/\s+/g, ' ');
    check('dòng 2: Omeprazol 20mg, 3.100, 9.300.000, 5.270.000, 4.030.000, 43,3%', ['Omeprazol 20mg', '3.100', '9.300.000', '5.270.000', '4.030.000', '43,3%'].every((s) => second.includes(s)), second);
    const lastRow = (await table.locator('[role="row"]').nth(8).innerText()).replace(/\s+/g, ' ');
    check('dòng 8: Bơm tiêm 5ml, Vật tư, Cái', ['Bơm tiêm 5ml', 'Vật tư', 'Cái', '1.250'].every((s) => lastRow.includes(s)), lastRow);
    const footer = (await table.locator('[role="row"]').last().innerText()).replace(/\s+/g, ' ');
    check('dòng cộng tính trên tất cả: "Cộng 150 mặt hàng", 172.250.000, 75.770.000, 96.480.000, 56,0%', ['Cộng 150 mặt hàng', '172.250.000', '75.770.000', '96.480.000', '56,0%'].every((s) => footer.includes(s)), footer);
    check('khung bảng ghi "xếp theo lãi gộp" và "8 mặt hàng đầu · còn 142 mặt hàng khác"', (await page.locator('section h2', { hasText: /^Mặt hàng, xếp theo lãi gộp, / }).count()) === 1 && (await page.locator('text=8 mặt hàng đầu · còn 142 mặt hàng khác').count()) === 1);
    check('có dòng giải thích lãi gộp chưa trừ nhân sự, mặt bằng, khấu hao', (await page.locator('text=Lãi gộp chỉ tính tiền bán trừ giá vốn thuốc, vật tư. Chưa trừ nhân sự, mặt bằng, khấu hao.').count()) === 1);
    const bars = await table.locator('div.bg-teal-700').evaluateAll((els) => els.map((el) => Math.round(parseFloat(el.style.width))));
    check('thanh biên lãi gộp: mặt hàng biên cao nhất đầy thanh, mọi thanh 0–100', Math.max(...bars) === 100 && bars.every((w) => w >= 0 && w <= 100), bars.join(','));
    check('không có chú thích duyệt mockup trong giao diện', (await page.locator('text=/TRƯỜNG MỚI|mockup|hint-placeholder/i').count()) === 0);
    await page.screenshot({ path: path.join(OUT, 'lai-gop.png'), fullPage: true });

    // Lọc Loại gửi đúng tham số cho máy chủ
    marginRequests.length = 0;
    await page.getByRole('group', { name: 'Loại mặt hàng' }).getByRole('button', { name: 'Vật tư y tế', exact: true }).click();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(800);
    check('chọn "Vật tư y tế" → gửi itemType=SUPPLY', marginRequests.some((u) => u.includes('itemType=SUPPLY')), marginRequests.slice(-1)[0] || 'không có yêu cầu');
    await page.getByRole('group', { name: 'Loại mặt hàng' }).getByRole('button', { name: 'Tất cả', exact: true }).click();
    await page.waitForTimeout(500);
    await page.unroute('**/api/v1/reports/pharmacy/margin?*');

    // ── Dữ liệu thật: 3 tab của trang — Excel + In ──
    const cases = [
      ['Đã phát', 'Số liệu thuốc và vật tư đã phát', 'Mặt hàng đã phát', /^thuoc-vat-tu-da-phat-/],
      ['Lãi gộp', 'Số liệu lãi gộp thuốc và vật tư', 'Biên lãi gộp', /^lai-gop-thuoc-vat-tu-/],
      ['Kiểm soát đặc biệt', 'Số liệu thuốc kiểm soát đặc biệt', 'Lượt phát', /^thuoc-kiem-soat-dac-biet-/],
    ];
    for (const [tab, groupName, label, fileRe] of cases) {
      await openTab(page, tab);
      await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Quý', exact: true }).click();
      await waitReport(page, groupName);
      const hasKpi = (await page.getByRole('group', { name: groupName }).count()) === 1;
      const empty = (await page.locator('h2:has-text("Không có"), h2:has-text("Chưa có"), h2:has-text("Chưa bán"), h2:has-text("Chưa phát")').count()) > 0;
      check(`tab "${tab}" hiện số liệu hoặc trạng thái trống rõ ràng`, hasKpi || empty, hasKpi ? (await page.getByRole('group', { name: groupName }).innerText()).replace(/\s+/g, ' ').slice(0, 140) : 'trống');
      if (hasKpi) check(`tab "${tab}" có nhãn "${label}"`, (await page.getByRole('group', { name: groupName }).innerText()).includes(label));
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

    // Kiểm soát đặc biệt: bộ lọc Phân loại
    await openTab(page, 'Kiểm soát đặc biệt');
    const ctl = (await page.getByRole('group', { name: 'Phân loại thuốc kiểm soát đặc biệt' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
    check('bộ lọc Phân loại: Tất cả, Gây nghiện, Hướng thần, Tiền chất, Độc', JSON.stringify(ctl) === JSON.stringify(['Tất cả', 'Gây nghiện', 'Hướng thần', 'Tiền chất', 'Độc']), ctl.join(' | '));
    const controlledRequests = [];
    page.on('request', (r) => {
      if (/reports\/pharmacy\/controlled\?/.test(r.url())) controlledRequests.push(r.url());
    });
    await page.getByRole('group', { name: 'Phân loại thuốc kiểm soát đặc biệt' }).getByRole('button', { name: 'Hướng thần', exact: true }).click();
    await page.waitForTimeout(1200);
    check('chọn "Hướng thần" → gửi controlType=PSYCHOTROPIC', controlledRequests.some((u) => u.includes('controlType=PSYCHOTROPIC')), controlledRequests.slice(-1)[0] || 'không có yêu cầu');
    await page.getByRole('group', { name: 'Phân loại thuốc kiểm soát đặc biệt' }).getByRole('button', { name: 'Tất cả', exact: true }).click();

    // ── Tab kho: bấm là chuyển sang trang cũ ──
    const links = [
      ['Nhập-Xuất-Tồn', '/inventory/reports/stock-ledger'],
      ['Tồn kho và hạn dùng', '/inventory/balances'],
      ['Hao hụt điều chuyển', '/inventory/reports/stock-ledger'],
      ['Công nợ nhà cung cấp', '/suppliers/debts'],
    ];
    for (const [tab, urlPart] of links) {
      await page.goto(WEB + '/reports/pharmacy');
      await page.getByRole('tab', { name: tab, exact: true }).waitFor({ timeout: 20000 });
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.waitForURL((u) => u.pathname.includes(urlPart), { timeout: 20000 });
      await page.waitForLoadState('networkidle');
      const text = await page.locator('body').innerText();
      check(`tab "${tab}" mở trang cũ ${urlPart}, không lỗi`, page.url().includes(urlPart) && !FORBIDDEN.test(noDigits(text)), page.url());
    }

    // ── Kỳ tuỳ chọn nhập sai → báo ngay, không gọi máy chủ ──
    await page.goto(WEB + '/reports/pharmacy?tab=margin');
    await page.getByRole('tab', { name: 'Lãi gộp', exact: true }).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    let calls = 0;
    page.on('request', (r) => {
      if (/reports\/pharmacy\/margin\?/.test(r.url())) calls += 1;
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
    await page.route('**/api/v1/reports/pharmacy/margin?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error TypeError' } }) }));
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await page.waitForSelector('button:has-text("Thử lại")', { timeout: 15000 });
    check('lỗi 500 → khung báo lỗi có "Thử lại", không lộ chữ kỹ thuật', !FORBIDDEN.test(noDigits(await page.locator('body').innerText())));
    await page.unroute('**/api/v1/reports/pharmacy/margin?*');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await page.getByRole('group', { name: 'Số liệu lãi gộp thuốc và vật tư' }).or(page.locator('h2:has-text("Chưa bán")')).first().waitFor({ timeout: 15000 });
    check('bấm "Thử lại" tải lại được', true);

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [768, 1024], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const tab of ['Đã phát', 'Lãi gộp', 'Kiểm soát đặc biệt']) {
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
      await p.goto(WEB + '/reports/pharmacy');
      await p.waitForLoadState('networkidle');
      const text = await p.locator('body').innerText();
      check(`${user}: không mở được trang, có thông báo tiếng Việt và lối về`, !(await p.getByRole('tab', { name: 'Đã phát', exact: true }).count()) && /không có quyền/i.test(text) && !FORBIDDEN.test(noDigits(text)), text.replace(/\s+/g, ' ').slice(0, 120));
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
