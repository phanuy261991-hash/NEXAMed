/* global require, process, console, window, document */
// KIỂM tệp PDF kết quả của đối tác ở màn kết quả cận lâm sàng và bản in (docs/DECISIONS.md #291 bổ sung 7) trên Chrome thật.
// Không cần dữ liệu thử: chặn phản hồi `GET .../items/:id/result` và trả một phiếu có tệp đính kèm là PDF (và một ảnh để so sánh).
//   PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5173 UI_AUDIT_OUT=<thư mục tạm> node scripts/ui-audit/lab-partner-pdf-attachment-check.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const USER = process.env.UI_AUDIT_USER || 'dev.admin';
const PASS = process.env.UI_AUDIT_PASS || 'Dev@12345';
const OUT = process.env.UI_AUDIT_OUT || path.join(os.tmpdir(), 'lab-partner-pdf-attachment-check');
fs.mkdirSync(OUT, { recursive: true });

const ITEM = '0198a000-0000-7000-8000-000000000001';
const PDF_URL = '/api/v1/files/pdf-token-thu';
const IMG_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#334155"/></svg>');

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? '  → ' + detail : ''}`);
}

function form(images) {
  return {
    orderNo: 'CLS2611000001',
    encounterId: '0198a000-0000-7000-8000-000000000002',
    encounterNo: 'KB2611000001',
    patientName: 'Nguyễn Thị Hoa',
    patientCode: 'BN000001',
    patientGender: 'female',
    patientDob: '1990-05-12',
    patientPhone: null,
    ageYears: 36,
    registeredAt: '2026-11-10T01:00:00.000Z',
    doctorName: 'BS. Lê Thanh Phong',
    collectedAt: '2026-11-10T01:10:00.000Z',
    bucket: 'COMPLETED',
    sections: [
      {
        itemId: ITEM,
        technicalServiceId: '0198a000-0000-7000-8000-000000000003',
        code: 'XN01',
        name: 'Định lượng TSH',
        serviceKind: 'LAB',
        resultType: 'BOTH',
        specimenTypeName: 'Huyết thanh',
        departmentName: null,
        categoryName: 'SINH HOÁ',
        status: 'COMPLETED',
        indicators: [],
        descriptionText: 'Kết quả do đối tác gửi về.',
        conclusionText: 'Trong giới hạn bình thường.',
        images,
      },
    ],
    performedById: null,
    performedByName: 'KTV Minh Khang',
    resultedAt: '2026-11-10T03:00:00.000Z',
    approverId: null,
    approvers: [],
    signedAt: '2026-11-10T04:00:00.000Z',
    signedByName: 'BS. Lê Thanh Phong',
    amendment: null,
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    window.print = () => {};
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  let images = [{ id: '0198a000-0000-7000-8000-0000000000a1', fileName: 'KQ_BinhMinh.pdf', contentType: 'application/pdf', url: PDF_URL }];
  const wrap = (f) => JSON.stringify({ data: { form: f } });
  await page.route(`**/api/v1/paraclinical/lab/items/${ITEM}/result`, (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: wrap(form(images)) });
  });

  try {
    await page.goto(WEB + '/login');
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    await page.waitForLoadState('networkidle');

    // ── Màn kết quả: chỉ có PDF ──
    await page.goto(`${WEB}/paraclinical/lab/items/${ITEM}`);
    const panel = page.getByRole('complementary', { name: 'Tệp PDF kết quả' });
    await panel.waitFor({ timeout: 20000 });
    const link = panel.getByRole('link', { name: /Xem tệp PDF kết quả/ });
    check('màn kết quả: hiện khối "Tệp PDF kết quả" với liên kết xem tệp', (await link.count()) === 1);
    const href = await link.getAttribute('href');
    const target = await link.getAttribute('target');
    check('liên kết trỏ tới tệp PDF và mở ở tab mới', !!href && href.includes('pdf-token-thu') && target === '_blank', `${href} ${target}`);
    check('PDF KHÔNG bị vẽ thành thẻ ảnh hỏng', (await page.locator('img[src*="pdf-token-thu"]').count()) === 0);
    check('xét nghiệm không có khối "Hình ảnh đính kèm"', (await page.getByRole('complementary', { name: 'Hình ảnh đính kèm' }).count()) === 0);
    await page.screenshot({ path: path.join(OUT, '01-man-ket-qua-pdf.png') });

    // ── Bản in ──
    await page.getByRole('button', { name: /In phiếu kết quả/ }).first().click();
    await page.waitForTimeout(1500);
    const bodyText = await page.locator('body').innerText();
    const printedNote = (await page.getByText('Kèm tệp PDF kết quả của đối tác xét nghiệm').count()) > 0;
    check('bản in: có dòng "Kèm tệp PDF kết quả của đối tác xét nghiệm"', printedNote, printedNote ? '' : bodyText.slice(0, 120));
    check('bản in: không có thẻ ảnh của tệp PDF', (await page.locator('img[src*="pdf-token-thu"]').count()) === 0);

    // ── PDF + ảnh cùng phiếu: chỉ ảnh được vẽ ──
    images = [
      { id: '0198a000-0000-7000-8000-0000000000a1', fileName: 'KQ.pdf', contentType: 'application/pdf', url: PDF_URL },
      { id: '0198a000-0000-7000-8000-0000000000a2', fileName: 'anh.svg', contentType: 'image/svg+xml', url: IMG_URL },
    ];
    await page.goto(`${WEB}/paraclinical/lab/items/${ITEM}`);
    await page.getByRole('complementary', { name: 'Tệp PDF kết quả' }).waitFor({ timeout: 20000 });
    check('PDF cùng ảnh: vẫn một liên kết PDF, không thẻ ảnh cho PDF', (await page.getByRole('link', { name: /Xem tệp PDF kết quả/ }).count()) === 1 && (await page.locator('img[src*="pdf-token-thu"]').count()) === 0);

    // ── Không có tệp: không hiện khối ──
    images = [];
    await page.goto(`${WEB}/paraclinical/lab/items/${ITEM}`);
    await page.getByText('Định lượng TSH').first().waitFor({ timeout: 20000 });
    check('không có tệp: không hiện khối PDF', (await page.getByRole('complementary', { name: 'Tệp PDF kết quả' }).count()) === 0);

    check('không có lỗi JS trong trang', jsErrors.length === 0, jsErrors.join(' | ').slice(0, 200));
  } catch (err) {
    check('kịch bản chạy hết không ngoại lệ', false, String(err.message || err).slice(0, 300));
    await page.screenshot({ path: path.join(OUT, 'loi.png') }).catch(() => {});
  } finally {
    await browser.close();
  }

  const pass = results.filter(Boolean).length;
  console.log(`\nKẾT QUẢ: ${pass}/${results.length}`);
  process.exit(pass === results.length ? 0 : 1);
})();
