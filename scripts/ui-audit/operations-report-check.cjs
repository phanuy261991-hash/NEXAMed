/* global require, process, console, window, document */
// KIỂM nhóm báo cáo "Khám bệnh và vận hành" (docs/DECISIONS.md #287) trên Chrome thật qua địa chỉ IP LAN (HTTP thường, ngữ cảnh KHÔNG bảo mật — #257).
// Gồm: menu, 6 tab, Sổ khám bệnh (bảng đúng cột mockup, lọc, cuộn tải thêm, Excel thật, In), Giờ cao điểm (bản đồ nhiệt đúng màu/số mockup bằng dữ liệu giả lập, 4 KPI, hai bảng),
// 4 tab còn lại với dữ liệu thật, kỳ Tuỳ chọn nhập sai, trạng thái lỗi (500 → khung báo lỗi có "Thử lại", không lộ chữ kỹ thuật), phân quyền (lễ tân/bác sĩ bị chặn), vài cỡ màn hình.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/operations-report-check.cjs
// Chuẩn bị như `lan-http-check.cjs` (README.md cùng thư mục): `pnpm dev` + `pnpm dev:lan`, đã `db:seed`. Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5174';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'operations-report-check');
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = /TypeError|undefined|Unexpected|Failed to fetch|Bad Request|Bad Gateway|Internal Server|NOT_FOUND|SERVICE_UNAVAILABLE|ECONN|\b50[0-4]\b|\b404\b|stack/;

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

/** Báo cáo giờ cao điểm giả lập đúng số liệu của mockup (Thứ Hai 9h = 36 lượt là ô đậm nhất). */
function mockPeakHours() {
  const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const base = [8, 22, 30, 26, 14, 6, 10, 20, 24, 16, 9, 4, 1];
  const factor = [1, 0.95, 0.9, 0.92, 1, 0.8, 0.35];
  const days = factor.map((f, i) => {
    const counts = base.map((b) => Math.round(b * f * 1.14));
    return { isoDow: i + 1, counts, total: counts.reduce((a, b) => a + b, 0) };
  });
  days[0].counts[2] = 36;
  days[0].total = days[0].counts.reduce((a, b) => a + b, 0);
  const totalVisits = days.reduce((s, d) => s + d.total, 0);
  return {
    generatedAt: new Date().toISOString(),
    from: '2026-10-01',
    to: '2026-10-31',
    branchCount: 1,
    hours,
    days,
    totalVisits,
    peak: { isoDow: 1, hour: 9, count: 36 },
    quietestDay: { isoDow: 7, total: days[6].total },
    waiting: {
      measuredCount: 1284,
      averageMinutes: 17,
      over30Count: 182,
      over30Percent: 14.2,
      slots: [
        { label: '07–09h', visits: 150, averageMinutes: 9, over30Percent: 2 },
        { label: '09–11h', visits: 410, averageMinutes: 24, over30Percent: 22 },
        { label: '11–13h', visits: 190, averageMinutes: 14, over30Percent: 8 },
        { label: '13–15h', visits: 260, averageMinutes: 16, over30Percent: 12 },
        { label: '15–17h', visits: 190, averageMinutes: 15, over30Percent: 9 },
        { label: '17–19h', visits: 84, averageMinutes: 8, over30Percent: 1 },
      ],
      distribution: [
        { label: '0–10 phút', count: 470, percent: 36.6 },
        { label: '10–20 phút', count: 400, percent: 31.2 },
        { label: '20–30 phút', count: 232, percent: 18.1 },
        { label: '30–45 phút', count: 124, percent: 9.7 },
        { label: 'Trên 45 phút', count: 58, percent: 4.5 },
      ],
    },
  };
}

async function openTab(page, name) {
  await page.getByRole('tab', { name }).click();
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

    // ── Menu và 6 tab ──
    await page.goto(WEB + '/');
    await page.waitForLoadState('networkidle');
    const group = page.getByRole('button', { name: 'Báo cáo', exact: true });
    if (await group.count()) await group.first().click();
    check('menu "Khám bệnh và vận hành" có trong nhóm Báo cáo', (await page.getByRole('link', { name: 'Khám bệnh và vận hành' }).count()) > 0);
    await page.getByRole('link', { name: 'Khám bệnh và vận hành' }).first().click();
    await page.getByRole('tab', { name: 'Sổ khám bệnh' }).waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    check('mở đúng trang', page.url().includes('/reports/operations'), page.url());
    check('tiêu đề "Khám bệnh và vận hành"', (await page.getByRole('heading', { name: 'Khám bệnh và vận hành', level: 1, exact: true }).count()) === 1);
    const tabNames = await page.getByRole('tab').allInnerTexts();
    check('đủ 6 tab đúng thứ tự mockup', JSON.stringify(tabNames.map((t) => t.trim())) === JSON.stringify(['Sổ khám bệnh', 'Giờ cao điểm', 'Thời gian chờ', 'Huỷ và không đến', 'Tái khám', 'Nguồn đặt lịch']), tabNames.join(' | '));

    // ── Sổ khám bệnh ──
    // Mở rộng khoảng ngày để có dữ liệu thật của tenant dev.
    await page.fill('#visit-book-from', '06/11/2025');
    await page.fill('#visit-book-to', '05/11/2026');
    await page.waitForLoadState('networkidle');
    await page.locator('[role="table"][aria-label="Sổ khám bệnh"]').or(page.getByText(/Không có lượt khám nào/)).first().waitFor({ timeout: 20000 });
    const hasRows = (await page.locator('[role="table"][aria-label="Sổ khám bệnh"] [role="row"]').count()) > 1;
    check('Sổ khám bệnh có dữ liệu thật của tenant dev', hasRows);
    if (hasRows) {
      const headers = (await page.locator('[role="table"][aria-label="Sổ khám bệnh"] [role="columnheader"]').allInnerTexts()).map((t) => t.trim());
      check('cột bảng đúng mockup', ['STT', 'Ngày khám', 'Số lượt khám', 'Mã bệnh nhân', 'Họ tên', 'Tuổi', 'Giới'].every((h, i) => headers[i]?.toUpperCase() === h.toUpperCase()) && headers.some((h) => /Chẩn đoán chính/i.test(h)) && headers.some((h) => /Thành tiền/i.test(h)), headers.join(' | '));
      const footer = (await page.locator('text=/Đang hiển thị/').first().innerText()).replace(/\s+/g, ' ');
      check('chân bảng "Đang hiển thị X / Y dòng"', /Đang hiển thị \d[\d.]* \/ \d[\d.]* dòng/.test(footer), footer);
      const excelLabel = (await page.getByRole('button', { name: /Xuất Excel/ }).first().innerText()).replace(/\s+/g, ' ');
      check('nút Xuất Excel ghi số dòng như mockup', /Xuất Excel \(\d[\d.]* dòng\)/.test(excelLabel), excelLabel);
      const firstRowLink = await page.locator('[role="table"][aria-label="Sổ khám bệnh"] a:has-text("Xem")').first().getAttribute('href');
      check('link "Xem" trỏ tới lượt khám', /^\/encounters\/[0-9a-f-]{36}$/.test(firstRowLink || ''), firstRowLink);
      check('không có dòng chú thích duyệt mockup ("Cuộn để tải thêm")', (await page.locator('text=Cuộn để tải thêm').count()) === 0);

      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).first().click()]);
      const file = path.join(OUT, 'so-kham-benh.xlsx');
      await download.saveAs(file);
      check('tải Excel Sổ khám bệnh thật', fs.statSync(file).size > 2000 && /so-kham-benh-2025-11-06-2026-11-05\.xlsx$/.test(download.suggestedFilename()), download.suggestedFilename());

      await page.getByRole('button', { name: 'In' }).first().click();
      await page.waitForFunction(() => window.__printCalls > 0, null, { timeout: 30000 });
      check('nút In gọi hộp in của trình duyệt sau khi tải đủ dữ liệu', (await page.evaluate(() => window.__printCalls)) === 1);
      const printText = await page.evaluate(() => document.body.textContent || '');
      check('bản in có tiêu đề và cột Sổ khám bệnh', /sổ khám bệnh/i.test(printText) && /thành tiền/i.test(printText));
      await page.screenshot({ path: path.join(OUT, 'so-kham-benh.png'), fullPage: false });

      // Lọc bác sĩ + tìm kiếm
      await page.fill('#visit-book-q', 'zzzzkhongco');
      await page.getByText('Không có lượt khám nào khớp bộ lọc').waitFor({ timeout: 15000 });
      check('lọc không khớp → trạng thái trống có hướng dẫn', true);
      await page.fill('#visit-book-q', '');
      await page.locator('[role="table"][aria-label="Sổ khám bệnh"]').first().waitFor({ timeout: 15000 });

      // Bộ lọc chẩn đoán: mở, tìm, chọn, bỏ lọc
      await page.click('#visit-book-icd');
      await page.getByPlaceholder('Gõ mã ICD-10 hoặc tên bệnh...').fill('J06');
      await page.waitForSelector('button:has-text("J06")', { timeout: 15000 });
      await page.locator('button:has-text("J06")').first().click();
      await page.waitForLoadState('networkidle');
      const icdLabel = (await page.locator('#visit-book-icd').innerText()).trim();
      check('chọn mã ICD-10 từ danh mục', /^J06/.test(icdLabel), icdLabel);
      await page.getByRole('button', { name: 'Bỏ lọc chẩn đoán' }).click();
      await page.waitForLoadState('networkidle');
      check('bỏ lọc chẩn đoán về "Tất cả mã ICD-10"', (await page.locator('#visit-book-icd').innerText()).includes('Tất cả mã ICD-10'));
    }

    // ── Giờ cao điểm: dữ liệu giả lập đúng mockup ──
    await page.route('**/api/v1/reports/operations/peak-hours*', async (route) => {
      if (route.request().url().includes('/export')) return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockPeakHours() }) });
    });
    await openTab(page, 'Giờ cao điểm');
    await page.waitForSelector('[role="table"][aria-label="Lượt khám theo thứ và giờ tiếp nhận"]', { timeout: 15000 });
    const kpiText = (await page.getByRole('group', { name: 'Số liệu giờ cao điểm' }).innerText()).replace(/\s+/g, ' ');
    check('4 KPI đúng mockup', ['Giờ cao điểm', 'Thứ Hai 9h', '36 lượt trong một giờ', 'Chờ trung bình', '17 phút', 'Chờ quá 30 phút', '14,2%', '182 trên 1.284 lượt', 'Ngày ít khách nhất', 'Chủ nhật'].every((s) => kpiText.includes(s)), kpiText);
    const heat = page.locator('[role="table"][aria-label="Lượt khám theo thứ và giờ tiếp nhận"]');
    check('bản đồ nhiệt đủ 7 thứ × 13 giờ', (await heat.locator('[role="row"] [role="cell"][title]').count()) === 7 * 13);
    const darkest = await heat.locator('[role="cell"][title="Thứ Hai 9h: 36 lượt"]').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
    check('ô đậm nhất xanh đậm chữ trắng (rgb 30,58,138)', darkest.bg === 'rgb(30, 58, 138)' && darkest.fg === 'rgb(255, 255, 255)', JSON.stringify(darkest));
    const lightest = await heat.locator('[role="cell"][title="Thứ Hai 9h: 36 lượt"]').evaluate((el) => el.parentElement.querySelectorAll('[role="cell"][title]')[12].style.background);
    check('ô ít khách có màu nhạt hơn nhiều', /rgb\(2[0-4]\d/.test(lightest), lightest);
    const cards = (await page.locator('section h2').allInnerTexts()).map((t) => t.trim());
    check('có đủ 3 khung đúng tên mockup', ['Lượt khám theo thứ và giờ tiếp nhận', 'Chờ theo khung giờ', 'Phân bố thời gian chờ'].every((c) => cards.includes(c)), cards.join(' | '));
    const rose = await page.locator('text=22%').first().evaluate((el) => ({ own: getComputedStyle(el).color, body: getComputedStyle(document.body).color }));
    check('khung giờ chờ > 30 phút từ 20% tô đỏ (khác màu chữ thường)', rose.own !== rose.body, JSON.stringify(rose));
    check('chú thích khung bản đồ nhiệt ghi tháng', (await page.locator('text=/Tháng 10\\/2026 · số lượt|\\d{2}\\/\\d{2}\\/\\d{4} – \\d{2}\\/\\d{2}\\/\\d{4} · số lượt/').count()) > 0);
    await page.screenshot({ path: path.join(OUT, 'gio-cao-diem.png'), fullPage: true });

    // Excel + In ở Giờ cao điểm dùng dữ liệu THẬT (bỏ giả lập cho route export đã tự continue)
    const [peakDownload] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
    const peakFile = path.join(OUT, 'gio-cao-diem.xlsx');
    await peakDownload.saveAs(peakFile);
    check('tải Excel Giờ cao điểm thật', fs.statSync(peakFile).size > 2000, peakDownload.suggestedFilename());
    await page.evaluate(() => {
      window.__printCalls = 0;
    });
    await page.getByRole('button', { name: 'In' }).first().click();
    await page.waitForFunction(() => window.__printCalls > 0, null, { timeout: 10000 });
    check('nút In ở Giờ cao điểm', true);

    // Kỳ tuỳ chọn nhập sai → báo ngay, không gọi máy chủ
    let peakCalls = 0;
    page.on('request', (r) => {
      if (/reports\/operations\/peak-hours\?/.test(r.url())) peakCalls += 1;
    });
    await page.getByRole('button', { name: 'Tuỳ chọn' }).click();
    check('kỳ Tuỳ chọn hiện hai ô ngày', (await page.locator('#report-period-from').count()) === 1 && (await page.locator('#report-period-to').count()) === 1);
    await page.fill('#report-period-from', '30/09/2026');
    await page.fill('#report-period-to', '01/09/2026');
    // Lúc gõ dở có trạng thái tạm hợp lệ nên có gọi máy chủ; chỉ đo từ khi khoảng đã ở trạng thái NGƯỢC.
    await page.waitForTimeout(900);
    const before = peakCalls;
    await page.waitForTimeout(900);
    const errText = await page.getByRole('alert').first().innerText();
    check('khoảng ngày ngược báo lỗi tiếng Việt và không gọi máy chủ', /trước hoặc bằng/.test(errText) && peakCalls === before, errText);
    await page.getByRole('button', { name: 'Tháng trước' }).click();
    await page.unroute('**/api/v1/reports/operations/peak-hours*');

    // ── 4 tab còn lại với dữ liệu thật ──
    const cases = [
      ['Thời gian chờ', 'Số liệu thời gian chờ', 'Chờ trung bình'],
      ['Huỷ và không đến', 'Số liệu huỷ và không đến', 'Lượt khám đã huỷ'],
      ['Tái khám', 'Số liệu tái khám', 'Hẹn tái khám trong kỳ'],
      ['Nguồn đặt lịch', 'Số liệu nguồn đặt lịch', 'Lịch hẹn trong kỳ'],
    ];
    await page.getByRole('button', { name: 'Quý' }).click();
    for (const [tab, group, label] of cases) {
      await openTab(page, tab);
      await page.waitForTimeout(800);
      const hasKpi = (await page.getByRole('group', { name: group }).count()) === 1;
      const empty = (await page.locator('h2:has-text("Không có"), h2:has-text("Chưa đo được")').count()) > 0;
      check(`tab "${tab}" hiện số liệu hoặc trạng thái trống rõ ràng`, hasKpi || empty, hasKpi ? (await page.getByRole('group', { name: group }).innerText()).replace(/\s+/g, ' ').slice(0, 120) : 'trống');
      if (hasKpi) check(`tab "${tab}" có nhãn "${label}"`, (await page.getByRole('group', { name: group }).innerText()).includes(label));
      const body = await page.locator('main, body').first().innerText();
      check(`tab "${tab}" không lộ chữ kỹ thuật`, !FORBIDDEN.test(body));
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Xuất Excel/ }).click()]);
      const f = path.join(OUT, `tab-${tab.replace(/\s+/g, '-')}.xlsx`);
      await dl.saveAs(f);
      check(`tab "${tab}" tải Excel thật`, fs.statSync(f).size > 2000, dl.suggestedFilename());
      await page.screenshot({ path: path.join(OUT, `tab-${tab.replace(/\s+/g, '-')}.png`), fullPage: true });
    }

    // ── Trạng thái lỗi ──
    await openTab(page, 'Giờ cao điểm');
    await page.route('**/api/v1/reports/operations/peak-hours?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error TypeError' } }) }));
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await page.waitForSelector('button:has-text("Thử lại")', { timeout: 15000 });
    const errBody = await page.locator('body').innerText();
    check('lỗi 500 → khung báo lỗi có "Thử lại", không lộ chữ kỹ thuật', !FORBIDDEN.test(errBody));
    await page.unroute('**/api/v1/reports/operations/peak-hours?*');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await page.locator('[role="table"][aria-label="Lượt khám theo thứ và giờ tiếp nhận"]').or(page.getByText('Không có lượt khám nào trong kỳ')).first().waitFor({ timeout: 15000 });
    check('bấm "Thử lại" tải lại được', true);

    // ── Cỡ màn hình ──
    for (const [w, h] of [[1280, 720], [768, 1024], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const tab of ['Sổ khám bệnh', 'Giờ cao điểm', 'Huỷ và không đến']) {
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
      await p.goto(WEB + '/reports/operations');
      await p.waitForLoadState('networkidle');
      const text = await p.locator('body').innerText();
      check(`${user}: không mở được trang, có thông báo tiếng Việt và lối về`, !(await p.getByRole('tab', { name: 'Sổ khám bệnh' }).count()) && /không có quyền/i.test(text) && !FORBIDDEN.test(text), text.replace(/\s+/g, ' ').slice(0, 100));
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
