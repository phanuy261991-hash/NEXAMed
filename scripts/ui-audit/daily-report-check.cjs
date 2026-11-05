/* global require, process, console, __dirname */
// KIỂM "Báo cáo ngày" + "Trung tâm báo cáo" trên Chrome thật qua địa chỉ IP LAN (HTTP thường, ngữ cảnh KHÔNG bảo mật — docs/DECISIONS.md #257, #287).
// Gồm: nhóm menu "Báo cáo", Trung tâm báo cáo (tìm, mở), trang Báo cáo ngày (hôm nay/hôm qua, tờ in hiện sẵn, nút Làm mới/Xuất Excel/In), tải Excel thật,
// bản in thật (PDF: 1 trang cho 1 chi nhánh, 4 trang cho 3 chi nhánh — dùng phản hồi giả lập vì tenant dev chỉ có 1 chi nhánh), trạng thái lỗi (500 → khung báo lỗi có "Thử lại",
// không lộ chữ kỹ thuật), phân quyền (lễ tân không mở được trang), xem trước ở Quản lý mẫu in, vài cỡ màn hình.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/daily-report-check.cjs
// Chuẩn bị như `lan-http-check.cjs` (README.md cùng thư mục). Ảnh chụp lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5174';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'daily-report-check');
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

function branch(id, name, k) {
  const visits = { received: 86 * k, newCount: 31 * k, returnCount: 55 * k, completed: 79 * k, stillOpen: 5, cancelled: 1, noShow: 1 };
  const collection = {
    byMethod: [
      { methodCode: 'CASH', methodName: 'Tiền mặt', paymentCount: 41, amount: 28_450_000 * k },
      { methodCode: 'TRANSFER', methodName: 'Chuyển khoản', paymentCount: 33, amount: 22_180_000 * k },
    ],
    collectedCount: 74,
    collectedAmount: 50_630_000 * k,
    refundedCount: 1,
    refundedAmount: 850_000,
    netAmount: 50_630_000 * k - 850_000,
  };
  const recognized = { total: 61_530_000 * k, byGroup: { EXAM: 24_700_000 * k, PARACLINICAL: 19_900_000 * k, DRUG: 13_530_000 * k, PACKAGE: 3_400_000 * k } };
  const unpaid = { invoiceCount: 6, amount: 4_850_000 };
  const shifts = [{ shiftNo: `PCC-${id}`, label: 'Ca sáng', cashierName: 'Nguyễn Thị Hoa', openedAt: '2026-11-04T00:30:00.000Z', closedAt: '2026-11-04T05:05:00.000Z', status: 'CLOSED', expectedCash: 13_250_000, countedCash: 13_230_000, discrepancy: -20_000 }];
  const counterVouchers = { incomeAmount: 0, expenseAmount: 1_200_000 };
  return { branchId: id, branchName: name, visits, collection, recognized, unpaid, shifts, counterVouchers };
}

function threeBranchReport() {
  const branches = [
    branch('00000000-0000-4000-8000-000000000001', 'Quận 1', 1),
    branch('00000000-0000-4000-8000-000000000002', 'Quận 7', 2),
    branch('00000000-0000-4000-8000-000000000003', 'Thủ Đức', 1),
  ];
  const sum = (f) => branches.reduce((s, b) => s + f(b), 0);
  const totals = {
    visits: { received: sum((b) => b.visits.received), newCount: sum((b) => b.visits.newCount), returnCount: sum((b) => b.visits.returnCount), completed: sum((b) => b.visits.completed), stillOpen: 15, cancelled: 3, noShow: 3 },
    collection: { byMethod: [{ methodCode: 'CASH', methodName: 'Tiền mặt', paymentCount: 123, amount: sum((b) => b.collection.byMethod[0].amount) }], collectedCount: 222, collectedAmount: sum((b) => b.collection.collectedAmount), refundedCount: 3, refundedAmount: 2_550_000, netAmount: sum((b) => b.collection.netAmount) },
    recognized: { total: sum((b) => b.recognized.total), byGroup: { EXAM: sum((b) => b.recognized.byGroup.EXAM), PARACLINICAL: sum((b) => b.recognized.byGroup.PARACLINICAL), DRUG: sum((b) => b.recognized.byGroup.DRUG), PACKAGE: sum((b) => b.recognized.byGroup.PACKAGE) } },
    unpaid: { invoiceCount: 18, amount: 14_550_000 },
    counterVouchers: { incomeAmount: 0, expenseAmount: 3_600_000 },
    shiftDiscrepancy: -60_000,
  };
  return { generatedAt: new Date().toISOString(), date: '2026-11-04', branches, totals };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  try {
    await login(page, process.env.UI_AUDIT_USER || 'dev.admin', process.env.UI_AUDIT_PASS || 'Dev@12345');
    check('ngữ cảnh KHÔNG bảo mật (mô hình on-prem LAN HTTP)', (await page.evaluate(() => window.isSecureContext)) === false, WEB);

    // ── Menu và Trung tâm báo cáo ──
    const groupBtn = page.getByRole('button', { name: 'Báo cáo', exact: true });
    check('nhóm menu "Báo cáo" có mặt', (await groupBtn.count()) === 1);
    if ((await page.getByRole('link', { name: 'Báo cáo ngày' }).count()) === 0) await groupBtn.click();
    check('nhóm có mục "Trung tâm báo cáo" và "Báo cáo ngày"', (await page.getByRole('link', { name: 'Trung tâm báo cáo' }).count()) === 1 && (await page.getByRole('link', { name: 'Báo cáo ngày' }).count()) === 1);

    await page.getByRole('link', { name: 'Trung tâm báo cáo' }).click();
    await page.waitForURL('**/reports');
    await page.getByRole('heading', { name: 'Trung tâm báo cáo' }).waitFor();
    const bodyText = await page.locator('main, body').first().innerText();
    check('trung tâm liệt kê Báo cáo ngày kèm "Excel · In"', /Báo cáo ngày/.test(bodyText) && /Excel · In/.test(bodyText));
    check('trung tâm KHÔNG hiện cột mã số hay trạng thái Mới/Có sẵn', !/\b1\.1\b|Có sẵn|Cần tra văn bản/.test(bodyText));
    await page.fill('#report-search', 'nhap xuat');
    check('ô tìm bỏ dấu: "nhap xuat" ra Nhập-Xuất-Tồn, mất Báo cáo ngày', (await page.getByText('Nhập-Xuất-Tồn').count()) >= 1 && (await page.getByText('Lượt khám, tiền thu theo phương thức').count()) === 0);
    await page.fill('#report-search', 'zzzkhongco');
    check('tìm không có kết quả → thông báo, không trang trắng', (await page.getByText('Không có báo cáo nào khớp từ khoá.').count()) === 1);
    await page.fill('#report-search', '');
    await page.screenshot({ path: path.join(OUT, 'trung-tam-bao-cao.png') });
    await page.getByRole('link', { name: 'Mở' }).first().click();
    await page.waitForURL('**/reports/daily');

    // ── Báo cáo ngày ──
    await page.getByRole('heading', { name: 'Báo cáo ngày' }).waitFor();
    await page.waitForSelector('.print-sheet', { timeout: 15000 });
    check('Báo cáo ngày hiện tờ in sẵn trên màn hình', (await page.locator('.print-sheet').count()) === 1);
    const todayBtn = await page.getByRole('button', { name: /Hôm nay ·/ }).textContent();
    const yBtn = await page.getByRole('button', { name: /Hôm qua ·/ }).textContent();
    check('hai nút ngày có ngày/tháng', /\d\d\/\d\d/.test(todayBtn) && /\d\d\/\d\d/.test(yBtn), `${todayBtn} | ${yBtn}`);
    check('đủ nút Làm mới, Xuất Excel, In', (await page.getByRole('button', { name: 'Làm mới' }).count()) === 1 && (await page.getByRole('button', { name: 'Xuất Excel' }).count()) === 1 && (await page.getByRole('button', { name: 'In', exact: true }).count()) === 1);
    check('tờ in một chi nhánh: có Lượt khám, Tiền thu theo phương thức, Ghi nhận theo nhóm, Các ca thu ngân', (await page.locator('.print-sheet h2').allInnerTexts()).length === 4);
    await page.screenshot({ path: path.join(OUT, 'bao-cao-ngay-hom-nay.png') });

    await page.getByRole('button', { name: /Hôm qua ·/ }).click();
    await page.waitForLoadState('networkidle');
    const [dd, mm] = (yBtn.match(/(\d\d)\/(\d\d)/) || []).slice(1);
    check('bấm "Hôm qua" → tiêu đề tờ in đổi sang ngày hôm qua', new RegExp(`Báo cáo ngày ${dd}/${mm}/\\d{4}`, 'i').test(await page.locator('.print-sheet h1').first().innerText()));

    // Tải Excel thật
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Xuất Excel' }).click()]);
    const file = path.join(OUT, download.suggestedFilename());
    await download.saveAs(file);
    const size = fs.statSync(file).size;
    check('Xuất Excel tải đúng tên bao-cao-ngay-YYYY-MM-DD.xlsx và có nội dung', /^bao-cao-ngay-\d{4}-\d\d-\d\d\.xlsx$/.test(download.suggestedFilename()) && size > 3000, `${download.suggestedFilename()} ${size}B`);

    // Bản in thật: một chi nhánh → 1 trang
    await page.emulateMedia({ media: 'print' });
    const visibleInPrint = await page.evaluate(() => {
      const vis = (el) => getComputedStyle(el).visibility !== 'hidden';
      return { sheet: vis(document.querySelector('.print-sheet')), sidebar: vis(document.querySelector('aside, nav')) };
    });
    check('khi in chỉ còn tờ báo cáo, menu ẩn', visibleInPrint.sheet === true && visibleInPrint.sidebar === false);
    const pdf1 = await page.pdf({ format: 'A4', printBackground: true });
    const pages1 = (pdf1.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    check('PDF in một chi nhánh gồm đúng 1 trang', pages1 === 1, `${pages1} trang`);
    await page.emulateMedia({ media: 'screen' });

    // ── Phạm vi "Tất cả chi nhánh" trên API THẬT (tenant dev có từ 2 chi nhánh) — trả lại "Chi nhánh đang làm" ngay sau đó vì lựa chọn được nhớ theo tài khoản ──
    if ((await page.getByRole('button', { name: 'Tất cả chi nhánh' }).count()) === 1) {
      await page.getByRole('button', { name: 'Tất cả chi nhánh' }).click();
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('.print-sheet');
      const realSheets = await page.locator('.print-sheet').count();
      const realText = await page.locator('.print-sheet').first().innerText();
      check('"Tất cả chi nhánh" (API thật): có trang tổng rồi mỗi chi nhánh một trang', realSheets >= 3 && /Cộng \d+ chi nhánh/.test(realText) && new RegExp('Trang 1/' + realSheets).test(realText), realSheets + ' tờ');
      await page.getByRole('button', { name: 'Chi nhánh đang làm' }).click();
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('.print-sheet');
    }

    // ── Nhiều chi nhánh (giả lập phản hồi) ──
    const report3 = threeBranchReport();
    await page.route('**/api/v1/reports/daily?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: report3, meta: {} }) }));
    await page.route('**/api/v1/reports/daily', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: report3, meta: {} }) }));
    await page.reload();
    await page.waitForSelector('.print-sheet');
    check('3 chi nhánh → 4 tờ (1 tổng + 3 chi nhánh)', (await page.locator('.print-sheet').count()) === 4);
    const sheetText = await page.locator('.print-sheet').first().innerText();
    check('trang tổng có bảng chi nhánh, dòng "Cộng 3 chi nhánh", "Trang 1/4"', /Cộng 3 chi nhánh/.test(sheetText) && /Trang 1\/4/.test(sheetText) && /Quận 7/.test(sheetText));
    check('dòng báo "Tờ in gồm 1 trang tổng và 3 trang chi nhánh."', (await page.getByText('Tờ in gồm 1 trang tổng và 3 trang chi nhánh.').count()) === 1);
    check('lệch két âm hiển thị dấu trừ thật', /−20\.000/.test(await page.locator('.print-sheet').nth(1).innerText()));
    await page.screenshot({ path: path.join(OUT, 'bao-cao-ngay-3-chi-nhanh.png'), fullPage: true });
    await page.emulateMedia({ media: 'print' });
    const pdf4 = await page.pdf({ format: 'A4', printBackground: true });
    const pages4 = (pdf4.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    check('PDF in 3 chi nhánh gồm đúng 4 trang (ngắt trang giữa các tờ)', pages4 === 4, `${pages4} trang`);
    await page.emulateMedia({ media: 'screen' });
    await page.unroute('**/api/v1/reports/daily?**');
    await page.unroute('**/api/v1/reports/daily');

    // ── Lỗi tải: 500 → khung báo lỗi, giữ nút Thử lại, không lộ chữ kỹ thuật ──
    let fail = true;
    await page.route('**/api/v1/reports/daily?**', (route) => (fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }) }) : route.continue()));
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await page.getByRole('alert').first().waitFor({ timeout: 30000 });
    const alertText = await page.getByRole('alert').first().innerText();
    check('lỗi 500 → khung báo lỗi tiếng Việt có "Thử lại", không lộ mã/chữ kỹ thuật', /Thử lại/.test(alertText) && !FORBIDDEN.test(alertText), alertText.replace(/\s+/g, ' '));
    fail = false;
    await page.getByRole('button', { name: 'Thử lại' }).first().click();
    await page.waitForSelector('.print-sheet', { timeout: 15000 });
    check('bấm "Thử lại" sau khi hết lỗi → báo cáo hiện lại', (await page.locator('.print-sheet').count()) >= 1);
    await page.unroute('**/api/v1/reports/daily?**');

    // ── Xem trước ở Quản lý mẫu in ──
    await page.goto(WEB + '/admin/print-templates');
    await page.waitForLoadState('networkidle');
    const hasReportGroup = (await page.getByText('Báo cáo', { exact: true }).count()) >= 1;
    check('Quản lý mẫu in có chứng từ "Báo cáo"', hasReportGroup);

    // ── Cỡ màn hình nhỏ ──
    for (const [w, h] of [[1280, 720], [768, 1024]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(WEB + '/reports/daily');
      await page.waitForSelector('.print-sheet');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${w}×${h}: trang không tràn ngang`, overflow <= 1, `lệch ${overflow}px`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // ── Phân quyền: lễ tân không có daily_report.read ──
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await ctx2.newPage();
    try {
      await login(p2, 'rl.receptionist', '12345678');
      await p2.goto(WEB + '/reports/daily');
      await p2.waitForLoadState('networkidle');
      const t = await p2.locator('body').innerText();
      check('lễ tân mở /reports/daily → màn không có quyền, không có tờ báo cáo', (await p2.locator('.print-sheet').count()) === 0 && /quyền/i.test(t) && !FORBIDDEN.test(t));
      check('lễ tân không thấy mục "Báo cáo ngày" ở menu', (await p2.getByRole('link', { name: 'Báo cáo ngày' }).count()) === 0);
    } catch (e) {
      check('phân quyền lễ tân (cần tài khoản rl.receptionist)', false, String(e.message).slice(0, 120));
    }
    await ctx2.close();

    check('không có lỗi JS trang trong suốt phiên kiểm', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
  } catch (e) {
    check('kịch bản chạy hết không ngoại lệ', false, String(e.stack || e).slice(0, 400));
  }
  await browser.close();
  const bad = results.filter((r) => !r).length;
  console.log(`\n${results.length - bad}/${results.length} đạt`);
  process.exit(bad === 0 ? 0 : 1);
})();
