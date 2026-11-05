/* global require, process, console, window, document */
// KIỂM trang báo cáo "Bác sĩ" (docs/DECISIONS.md #287) trên Chrome thật qua địa chỉ IP LAN (HTTP thường, ngữ cảnh KHÔNG bảo mật — #257).
// Gồm: menu, 3 tab đúng thứ tự mockup, tab Hiệu suất (5 KPI, bảng 11 cột, thanh doanh thu, dòng cộng, màu, link "Xem" mở Sổ khám bệnh đã lọc bác sĩ + kỳ) bằng dữ liệu giả lập đúng số liệu mockup,
// lọc Khoa, 2 tab còn lại với dữ liệu thật, Excel thật + In từng tab, kỳ Tuỳ chọn nhập sai, trạng thái lỗi (500 → khung báo lỗi có "Thử lại"), phân quyền (lễ tân/bác sĩ bị chặn), vài cỡ màn hình.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/doctor-report-check.cjs
// Chuẩn bị như `lan-http-check.cjs` (README.md cùng thư mục): `pnpm dev` + `pnpm dev:lan`, đã `db:seed`. Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5174';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'doctor-report-check');
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
    await page.getByRole('group', { name: groupName }).or(page.locator('h2:has-text("Không có"), h2:has-text("Chưa có")')).first().waitFor({ timeout: 25000 });
    return true;
  } catch {
    return false;
  }
}

/** Hiệu suất giả lập đúng số liệu của mockup: 8 bác sĩ, tháng 10/2026, tổng 842.600.000. */
function mockPerformance() {
  const D = [
    ['BS. Nguyễn Văn An', 'Nội', 262, 13, 190.4, 58, 88, 41],
    ['BS. Trần Thị Bình', 'Nhi', 248, 15, 168.9, 47, 93, 52],
    ['BS. Lê Minh Châu', 'Nội', 231, 11, 151.3, 52, 85, 38],
    ['BS. Phạm Quốc Dũng', 'Tai Mũi Họng', 172, 12, 118.7, 39, 76, 29],
    ['BS. Hoàng Thị Em', 'Da liễu', 143, 14, 96.5, 31, 82, 45],
    ['BS. Vũ Đức Phong', 'Sản', 118, 18, 82.1, 66, 64, 57],
    ['BS. Đặng Thu Giang', 'Nhi', 74, 16, 24.2, 44, 90, 49],
    ['BS. Bùi Khánh Hà', 'Nội', 36, 12, 10.5, 29, 71, 22],
  ];
  const rows = D.map((d, i) => ({
    doctorId: `00000000-0000-4000-8000-00000000000${i + 1}`,
    doctorName: d[0],
    departmentId: null,
    departmentName: d[1],
    rank: i + 1,
    visits: d[2],
    avgMinutes: d[3],
    revenue: Math.round(d[4] * 1e6),
    revenuePerVisit: Math.round((d[4] * 1e6) / d[2]),
    clsPercent: d[5],
    drugPercent: d[6],
    followUpPercent: d[7],
  }));
  return {
    generatedAt: new Date().toISOString(),
    from: '2026-10-01',
    to: '2026-10-31',
    branchCount: 3,
    rows,
    totals: { doctorCount: 8, visits: 1284, visitsPerDoctor: 160, avgMinutes: 13, revenue: 842_600_000, revenuePerVisit: 656_250, clsPercent: 47, drugPercent: 84, followUpPercent: 42 },
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

    // ── Menu và 3 tab ──
    await page.goto(WEB + '/');
    await page.waitForLoadState('networkidle');
    const group = page.getByRole('button', { name: 'Báo cáo', exact: true });
    if (await group.count()) await group.first().click();
    check('menu "Bác sĩ" có trong nhóm Báo cáo', (await page.getByRole('link', { name: 'Bác sĩ', exact: true }).count()) > 0);
    await page.getByRole('link', { name: 'Bác sĩ', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Hiệu suất theo bác sĩ' }).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    check('mở đúng trang', page.url().includes('/reports/doctors'), page.url());
    check('tiêu đề "Bác sĩ"', (await page.getByRole('heading', { name: 'Bác sĩ', level: 1, exact: true }).count()) === 1);
    const tabNames = (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim());
    check('đủ 3 tab đúng thứ tự mockup', JSON.stringify(tabNames) === JSON.stringify(['Hiệu suất theo bác sĩ', 'Cơ cấu kê đơn và chỉ định', 'Giờ làm việc và lượt khám']), tabNames.join(' | '));
    const kinds = (await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
    check('bộ chọn Kỳ đúng mockup: 7 ngày, Tháng này, Tháng trước, Quý, Tuỳ chọn', JSON.stringify(kinds) === JSON.stringify(['7 ngày', 'Tháng này', 'Tháng trước', 'Quý', 'Tuỳ chọn']), kinds.join(' | '));
    check('có bộ lọc Khoa với "Tất cả khoa"', (await page.locator('#doctor-report-department').inputValue().catch(() => '')) .includes('Tất cả khoa') || (await page.locator('#doctor-report-department').innerText().catch(() => '')).includes('Tất cả khoa'));

    // ── Hiệu suất: dữ liệu giả lập đúng mockup ──
    await page.route('**/api/v1/reports/doctors/performance?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockPerformance() }) }));
    await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Quý', exact: true }).click();
    const table = page.locator('[role="table"][aria-label="Hiệu suất theo bác sĩ"]');
    await table.getByText('BS. Nguyễn Văn An').waitFor({ timeout: 15000 });
    const kpiText = (await page.getByRole('group', { name: 'Số liệu hiệu suất bác sĩ' }).innerText()).replace(/\s+/g, ' ');
    check('5 KPI đúng nhãn và số mockup', ['Bác sĩ có khám', '8', 'trong 3 chi nhánh', 'Lượt khám mỗi bác sĩ', '160', 'Thời gian khám', '13 phút', 'Doanh thu một lượt', '656.250', 'Có chỉ định cận lâm sàng', '47%'].every((s) => kpiText.includes(s)), kpiText.slice(0, 220));
    const headers = (await table.locator('[role="columnheader"]').allInnerTexts()).map((t) => t.trim().toUpperCase());
    check('bảng đủ 11 cột đúng mockup', JSON.stringify(headers) === JSON.stringify(['#', 'BÁC SĨ', 'KHOA', 'LƯỢT KHÁM', 'PHÚT / LƯỢT', 'DOANH THU SINH RA ▼', 'MỘT LƯỢT', 'CÓ CLS', 'CÓ THUỐC', 'HẸN TÁI KHÁM', '']), headers.join(' | '));
    const first = (await table.locator('[role="row"]').nth(1).innerText()).replace(/\s+/g, ' ');
    check('dòng 1: BS. Nguyễn Văn An, Nội, 262 lượt, 13 phút, 190.400.000, một lượt 726.718, 58% / 88% / 41%', ['1', 'BS. Nguyễn Văn An', 'Nội', '262', '13', '190.400.000', '726.718', '58%', '88%', '41%', 'Xem'].every((s) => first.includes(s)), first);
    const last = (await table.locator('[role="row"]').nth(8).innerText()).replace(/\s+/g, ' ');
    check('dòng 8: BS. Bùi Khánh Hà, 36 lượt, 10.500.000', ['8', 'BS. Bùi Khánh Hà', '36', '10.500.000', '29%', '71%', '22%'].every((s) => last.includes(s)), last);
    const footer = (await table.locator('[role="row"]').last().innerText()).replace(/\s+/g, ' ');
    check('dòng cộng: "Cộng 8 bác sĩ", 1.284, 13, 842.600.000, 656.250, 47% / 84% / 42%', ['Cộng 8 bác sĩ', '1.284', '13', '842.600.000', '656.250', '47%', '84%', '42%'].every((s) => footer.includes(s)), footer);
    const bars = await table.locator('div.bg-emerald-700').evaluateAll((els) => els.map((el) => Math.round(parseFloat(el.style.width))));
    check('thanh doanh thu: dòng đầu 100%, dòng cuối ~6% (10,5 trên 190,4)', bars[0] === 100 && bars[7] === 6 && bars.every((w, i) => i === 0 || w <= bars[i - 1]), bars.join(','));
    const revColor = await rgbOf(table.locator('[role="row"]').nth(1).locator('span.text-emerald-700').first());
    check('số doanh thu sinh ra màu xanh lục', revColor === 'rgb(0, 122, 85)', revColor);
    check('khung bảng ghi "Xếp theo doanh thu sinh ra" và tên "Bác sĩ, tháng/ngày"', (await page.locator('text=Xếp theo doanh thu sinh ra').count()) === 1 && (await page.locator('section h2', { hasText: /^Bác sĩ, / }).count()) === 1);
    check('không có chú thích duyệt mockup trong giao diện', (await page.locator('text=/TRƯỜNG MỚI|mockup|hint-placeholder/i').count()) === 0);
    const href = await table.locator('a:has-text("Xem")').first().getAttribute('href');
    check('link "Xem" mang bác sĩ và kỳ', /^\/reports\/operations\?doctorId=00000000-0000-4000-8000-000000000001&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/.test(href || ''), href);
    await page.screenshot({ path: path.join(OUT, 'hieu-suat.png'), fullPage: true });
    // "Xem" mở Sổ khám bệnh đã lọc đúng kỳ (bác sĩ giả lập không có trong danh sách → ô bác sĩ rơi về mặc định, không lỗi)
    await table.locator('a:has-text("Xem")').first().click();
    await page.getByRole('tab', { name: 'Sổ khám bệnh' }).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    check('bấm "Xem" mở Sổ khám bệnh, ô Từ ngày đúng kỳ của báo cáo', page.url().includes('/reports/operations') && (await page.locator('#visit-book-from').inputValue()).length === 10, await page.locator('#visit-book-from').inputValue());
    await page.goBack();
    await page.getByRole('tab', { name: 'Hiệu suất theo bác sĩ' }).waitFor({ timeout: 20000 });
    await page.unroute('**/api/v1/reports/doctors/performance?*');

    // ── Dữ liệu thật: Hiệu suất + lọc Khoa ──
    await page.getByRole('group', { name: 'Kỳ của báo cáo' }).getByRole('button', { name: 'Quý', exact: true }).click();
    const okReal = await waitReport(page, 'Số liệu hiệu suất bác sĩ');
    check('Hiệu suất thật: có số liệu hoặc trạng thái trống rõ ràng', okReal);
    const hasRows = (await page.locator('[role="table"][aria-label="Hiệu suất theo bác sĩ"] [role="row"]').count()) > 2;
    if (hasRows) {
      await page.locator('#doctor-report-department').click();
      const options = await page.locator('[role="listbox"] [role="option"], [role="option"]').allInnerTexts();
      check('danh sách Khoa có "Tất cả khoa" và ít nhất một Khoa cụ thể', options.length >= 2 && options[0].includes('Tất cả khoa'), options.slice(0, 4).join(' | '));
      if (options.length >= 2) {
        await page.locator('[role="option"]').nth(1).click();
        await page.waitForLoadState('networkidle');
        const okFilter = await waitReport(page, 'Số liệu hiệu suất bác sĩ');
        check('chọn một Khoa → báo cáo tải lại (số liệu hoặc trống rõ ràng)', okFilter);
        const [dlF] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
        const fF = path.join(OUT, 'hieu-suat-khoa.xlsx');
        await dlF.saveAs(fF);
        check('Excel khi đang lọc Khoa tải được', fs.statSync(fF).size > 2000, dlF.suggestedFilename());
        await page.locator('#doctor-report-department').click();
        await page.locator('[role="option"]').first().click();
        await page.waitForLoadState('networkidle');
      }
    }

    // Excel + In (dữ liệu thật) cho Hiệu suất
    const [dl0] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
    const f0 = path.join(OUT, 'hieu-suat.xlsx');
    await dl0.saveAs(f0);
    check('tải Excel Hiệu suất thật', fs.statSync(f0).size > 2000 && /^hieu-suat-bac-si-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl0.suggestedFilename()), dl0.suggestedFilename());
    await page.evaluate(() => {
      window.__printCalls = 0;
    });
    await page.getByRole('button', { name: 'In' }).first().click();
    await page.waitForFunction(() => window.__printCalls > 0, null, { timeout: 15000 });
    check('Hiệu suất: nút In gọi hộp in của trình duyệt', (await page.evaluate(() => window.__printCalls)) === 1);
    check('bản in có tiêu đề "Hiệu suất theo bác sĩ"', /hiệu suất theo bác sĩ/i.test(await page.evaluate(() => document.body.textContent || '')));

    // ── 2 tab còn lại với dữ liệu thật ──
    const cases = [
      ['Cơ cấu kê đơn và chỉ định', 'Số liệu cơ cấu kê đơn và chỉ định', 'Dòng thuốc mỗi đơn', /^co-cau-ke-don-chi-dinh-/],
      ['Giờ làm việc và lượt khám', 'Số liệu giờ làm việc và lượt khám', 'Tỉ lệ sử dụng', /^gio-lam-viec-luot-kham-/],
    ];
    for (const [tab, groupName, label, fileRe] of cases) {
      await openTab(page, tab);
      await waitReport(page, groupName);
      const hasKpi = (await page.getByRole('group', { name: groupName }).count()) === 1;
      const empty = (await page.locator('h2:has-text("Không có"), h2:has-text("Chưa có")').count()) > 0;
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
      check(`tab "${tab}" nút In`, true);
      await page.screenshot({ path: path.join(OUT, `tab-${tab.replace(/\s+/g, '-')}.png`), fullPage: true });
    }
    check('tab Cơ cấu có hai khung "Thuốc kê nhiều nhất" và "Chỉ định cận lâm sàng nhiều nhất"', await (async () => {
      await openTab(page, 'Cơ cấu kê đơn và chỉ định');
      await waitReport(page, 'Số liệu cơ cấu kê đơn và chỉ định');
      const titles = (await page.locator('section h2').allInnerTexts()).map((t) => t.trim());
      return titles.includes('Thuốc kê nhiều nhất') && titles.includes('Chỉ định cận lâm sàng nhiều nhất');
    })());

    // ── Kỳ tuỳ chọn nhập sai → báo ngay, không gọi máy chủ ──
    await openTab(page, 'Hiệu suất theo bác sĩ');
    let calls = 0;
    page.on('request', (r) => {
      if (/reports\/doctors\/performance\?/.test(r.url())) calls += 1;
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
    await page.route('**/api/v1/reports/doctors/performance?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error TypeError' } }) }));
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await page.waitForSelector('button:has-text("Thử lại")', { timeout: 15000 });
    check('lỗi 500 → khung báo lỗi có "Thử lại", không lộ chữ kỹ thuật', !FORBIDDEN.test(noDigits(await page.locator('body').innerText())));
    await page.unroute('**/api/v1/reports/doctors/performance?*');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await page.getByRole('group', { name: 'Số liệu hiệu suất bác sĩ' }).or(page.locator('h2:has-text("Không có")')).first().waitFor({ timeout: 15000 });
    check('bấm "Thử lại" tải lại được', true);

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [768, 1024], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const tab of ['Hiệu suất theo bác sĩ', 'Cơ cấu kê đơn và chỉ định', 'Giờ làm việc và lượt khám']) {
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
      await p.goto(WEB + '/reports/doctors');
      await p.waitForLoadState('networkidle');
      const text = await p.locator('body').innerText();
      check(`${user}: không mở được trang, có thông báo tiếng Việt và lối về`, !(await p.getByRole('tab', { name: 'Hiệu suất theo bác sĩ' }).count()) && /không có quyền/i.test(text) && !FORBIDDEN.test(noDigits(text)), text.replace(/\s+/g, ' ').slice(0, 120));
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
