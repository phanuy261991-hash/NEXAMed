/* global require, process, console */
// DEMO trực quan (cửa sổ Chrome hiện thật, thao tác chậm) cho "Gửi mẫu đối tác" giai đoạn 1 (docs/DECISIONS.md #291): mở dịch vụ gửi đối tác, xem giá từng đối tác, đổi mặc định, đổi giá thấy lãi đổi,
// đổi phút/giờ. KHÔNG lưu gì (đóng form không lưu). Chạy: PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 node scripts/ui-audit/lab-partner-demo.cjs
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:5173';
const PAUSE = Number(process.env.DEMO_PAUSE || 1800);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, slowMo: 450, args: ['--window-size=1440,900', '--window-position=60,40'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const page = await ctx.newPage();
  const say = async (msg) => {
    console.log('▶ ' + msg);
    await page.waitForTimeout(PAUSE);
  };

  await page.goto(WEB + '/login');
  await page.fill('#username', 'dev.admin');
  await page.fill('#password', 'Dev@12345');
  await page.press('#password', 'Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await say('Đăng nhập xong');

  await page.goto(WEB + '/admin/catalog-paraclinical');
  await page.getByRole('button', { name: 'Đối tác xét nghiệm' }).waitFor({ timeout: 30000 });
  await say('Danh mục Cận lâm sàng: có mục "Đối tác xét nghiệm" (công tắc đang bật)');
  await page.getByRole('button', { name: 'Đối tác xét nghiệm' }).click();
  await say('Danh sách đối tác: mã DT, cột "Dịch vụ" (số dịch vụ có giá trả) và "Còn nợ"');

  await page.getByRole('button', { name: 'Dịch vụ kỹ thuật' }).first().click();
  const search = page.getByPlaceholder(/Tìm/).first();
  await search.fill('XN gửi đối tác kiểm');
  await page.waitForTimeout(1200);
  // Chỉ dịch vụ ĐANG DÙNG (các dịch vụ thử cũ đã ngưng và gỡ đối tác).
  const row = page.locator('[role="row"], tr').filter({ hasText: 'XN gửi đối tác kiểm' }).filter({ hasText: 'Đang dùng' }).first();
  await row.waitFor({ timeout: 20000 });
  await say('Dịch vụ xét nghiệm đã cấu hình "Gửi đối tác"');
  await row.getByRole('button', { name: 'Sửa' }).first().click();
  await page.getByRole('dialog').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  if (process.env.DEMO_SHOT) await page.screenshot({ path: process.env.DEMO_SHOT });
  await page.getByText('Giá trả bên thứ ba theo từng đối tác').scrollIntoViewIfNeeded();
  await say('Form dịch vụ: "Nơi thực hiện" = Gửi đối tác, bảng giá trả theo TỪNG đối tác');

  const priceInputs = page.locator('input[id^="ts-partner-"]:not(#ts-partner-add)');
  const n = await priceInputs.count();
  console.log('   số đối tác trong bảng:', n);
  await say('Mỗi đối tác một giá riêng; cột "Giá niêm yết" là giá khách trả, dòng "Lãi" tính theo từng đối tác');

  if (n >= 2) {
    await page.getByRole('button', { name: 'Đặt mặc định' }).first().click();
    await say('Đặt đối tác khác làm MẶC ĐỊNH: nhãn "Mặc định" chuyển dòng');
    await priceInputs.nth(0).click();
    await priceInputs.nth(0).fill('180000');
    await say('Đổi giá trả của đối tác thứ nhất → dòng "Lãi" đổi theo ngay');
    await priceInputs.nth(1).fill('120000');
    await say('Đổi giá của đối tác thứ hai → lãi khác nhau giữa hai đối tác');
  }

  await page.locator('#ts-tat').scrollIntoViewIfNeeded();
  await say('Ô "Thời gian trả kết quả": đang theo GIỜ');
  await page.locator('#ts-tat-unit').click();
  await page.getByRole('option', { name: 'Phút' }).click();
  await say('Chọn đơn vị "Phút": số tự quy đổi (24 giờ = 1440 phút)');
  await page.locator('#ts-tat-unit').click();
  await page.getByRole('option', { name: 'Giờ' }).click();
  await say('Chọn lại "Giờ": quay về 24 giờ');

  console.log('Demo xong — các thay đổi KHÔNG được lưu. Cửa sổ giữ mở 60 giây để bạn xem lại.');
  await page.waitForTimeout(60000);
  await browser.close();
})().catch((e) => {
  console.error('LỖI demo:', e.message);
  process.exit(1);
});
