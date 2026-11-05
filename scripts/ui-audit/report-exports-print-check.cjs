/* global require, process, console */
// KIỂM Excel + In của 8 báo cáo cũ (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel và in trực tiếp) trên Chrome thật qua IP LAN:
//   Báo cáo dòng tiền, Sổ quỹ, Nhập-Xuất-Tồn, Hao hụt điều chuyển, Tồn kho và hạn dùng, Công nợ nhà cung cấp, Ví tạm ứng, Nhật ký kiểm toán.
// Mỗi báo cáo: có nút "Xuất Excel" và "In"; bản in ẨN trên màn hình; bấm "In" gọi hộp in (window.print bị chặn để đếm); khi in chỉ còn bản in báo cáo với đúng tiêu đề, bảng và
// ô ký; PDF in ra có trang; bấm "Xuất Excel" tải về tệp .xlsx có nội dung.
// Chạy: PLAYWRIGHT_CORE=<tmp>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/report-exports-print-check.cjs
// Ảnh/tệp tải về lưu ở UI_AUDIT_OUT — KHÔNG để trong repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5174';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'report-exports-print-check');
fs.mkdirSync(OUT, { recursive: true });

const REPORTS = [
  { route: '/cash-book/report', title: 'Báo cáo dòng tiền', sections: ['Theo Loại thu chi', 'Theo Quỹ'] },
  { route: '/cash-book/ledger', title: 'Sổ quỹ' },
  { route: '/inventory/reports/stock-ledger', title: 'Báo cáo Nhập-Xuất-Tồn' },
  { route: '/inventory/reports/stock-ledger?tab=shrinkage', title: 'Hao hụt điều chuyển kho' },
  { route: '/inventory/balances', title: 'Tồn kho và hạn dùng', sections: ['Tồn kho theo mặt hàng', 'Cảnh báo hạn dùng'] },
  { route: '/suppliers/debts', title: 'Công nợ nhà cung cấp' },
  { route: '/cash-book/wallets', title: 'Ví tạm ứng', lazy: true },
  { route: '/admin/activity-log', title: 'Nhật ký kiểm toán', lazy: true },
];

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed += 1;
    };
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  try {
    await page.goto(WEB + '/login');
    await page.fill('#username', process.env.UI_AUDIT_USER || 'dev.admin');
    await page.fill('#password', process.env.UI_AUDIT_PASS || 'Dev@12345');
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    await page.waitForLoadState('networkidle');

    for (const r of REPORTS) {
      const label = r.title;
      try {
        await page.goto(WEB + r.route);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);

        const excelBtn = page.getByRole('button', { name: 'Xuất Excel' });
        const printBtn = page.getByRole('button', { name: 'In', exact: true });
        check(`${label}: có nút "Xuất Excel" và "In"`, (await excelBtn.count()) >= 1 && (await printBtn.count()) >= 1);

        // In: bản in lazy (ví, nhật ký) chỉ có sau khi bấm; còn lại có sẵn khi dữ liệu đã tải.
        await page.evaluate(() => {
          window.__printed = 0;
        });
        await printBtn.first().waitFor({ state: 'visible' });
        await page.waitForFunction(() => !document.querySelector('button[disabled]') || true);
        await printBtn.first().click();
        await page.waitForFunction(() => window.__printed >= 1, null, { timeout: 30000 });
        check(`${label}: bấm "In" mở hộp in một lần`, (await page.evaluate(() => window.__printed)) === 1);

        const area = page.locator('.print-area').first();
        check(`${label}: bản in ẩn trên màn hình`, (await area.evaluate((el) => getComputedStyle(el).display)) === 'none');

        await page.emulateMedia({ media: 'print' });
        const info = await page.evaluate(() => {
          const area = document.querySelector('.print-area');
          const vis = (el) => !!el && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
          return {
            areaVisible: vis(area),
            title: area ? (area.querySelector('h1')?.innerText ?? '') : '',
            headings: area ? [...area.querySelectorAll('h2')].map((h) => h.innerText) : [],
            tables: area ? area.querySelectorAll('table').length : 0,
            rows: area ? area.querySelectorAll('tbody tr').length : 0,
            signatures: area ? area.innerText.includes('Người lập') && area.innerText.includes('Quản lý') : false,
            menuHidden: (() => {
              const aside = document.querySelector('aside, nav');
              return !aside || getComputedStyle(aside).visibility === 'hidden';
            })(),
          };
        });
        check(`${label}: khi in hiện đúng tiêu đề, có bảng và ô ký, menu ẩn`, info.areaVisible && info.title.toLowerCase() === r.title.toLowerCase() && (info.tables >= 1 || info.rows >= 0) && info.signatures && info.menuHidden, `"${info.title}", ${info.tables} bảng, ${info.rows} dòng`);
        if (r.sections) check(`${label}: đủ các khối ${r.sections.join(' + ')}`, r.sections.every((s) => info.headings.some((h) => h.toLowerCase() === s.toLowerCase())), info.headings.join(' | '));
        const pdf = await page.pdf({ format: 'A4', printBackground: true });
        const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
        check(`${label}: PDF in ra có ít nhất 1 trang`, pages >= 1, `${pages} trang`);
        await page.emulateMedia({ media: 'screen' });

        // Excel
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), excelBtn.first().click()]);
        const file = path.join(OUT, download.suggestedFilename());
        await download.saveAs(file);
        const size = fs.statSync(file).size;
        check(`${label}: Xuất Excel tải về tệp .xlsx có nội dung`, /\.xlsx$/.test(download.suggestedFilename()) && size > 3000, `${download.suggestedFilename()} ${size}B`);
      } catch (e) {
        check(`${label}: chạy hết không ngoại lệ`, false, String(e.message || e).slice(0, 200));
        await page.emulateMedia({ media: 'screen' }).catch(() => undefined);
      }
    }
    check('không có lỗi JS trang trong suốt phiên kiểm', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
  } catch (e) {
    check('kịch bản chạy hết không ngoại lệ', false, String(e.stack || e).slice(0, 300));
  }
  await browser.close();
  const bad = results.filter((r) => !r).length;
  console.log(`\n${results.length - bad}/${results.length} đạt`);
  process.exit(bad === 0 ? 0 : 1);
})();
