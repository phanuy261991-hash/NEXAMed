// Đo độ trễ khi CHUYỂN TRANG trong ứng dụng (SPA) bằng Chrome thật: với mỗi trang trong menu, đo
//  - paint: từ lúc điều hướng đến khung hình kế tiếp (chi phí dựng ngay, gồm cả tải chunk JS);
//  - content: đến khi hết khung chờ (.animate-pulse) trong vùng nội dung và có chữ;
//  - idle: đến khi mạng yên 400 ms; kèm số yêu cầu API/JS, yêu cầu API chậm nhất, thời gian chặn luồng chính (long task).
// Hai lượt: lần đầu (chunk chưa có trong cache) và lần sau (đã có), tuỳ chọn giả lập CPU chậm (CPU=4 ≈ máy văn phòng cũ).
// Chỉ GET (mở trang), không ghi dữ liệu. Dùng: node scripts/ui-audit/nav-perf-audit.cjs
// Biến môi trường: UI_AUDIT_WEB (mặc định http://localhost:4173), UI_AUDIT_USER, UI_AUDIT_PASS, CPU (hệ số làm chậm, mặc định 1),
// MAX_ROUTES (mặc định 45), ONLY (lọc theo chuỗi con của đường dẫn, phân cách bằng dấu phẩy), PLAYWRIGHT_CORE, CHROME_PATH, UI_AUDIT_OUT.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const WEB = process.env.UI_AUDIT_WEB || 'http://localhost:4173';
const CPU = Number(process.env.CPU || 1);
const MAX_ROUTES = Number(process.env.MAX_ROUTES || 45);
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const OUT = path.join(process.env.UI_AUDIT_OUT || process.cwd(), 'nav-perf-out');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const norm = (u) => u.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\?.*$/, '');
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Ghi mọi yêu cầu kèm mốc thời gian; "tracker" đặt lại cho từng lần điều hướng.
  let tracker = null;
  page.on('request', (req) => { if (tracker) tracker.start.set(req, Date.now()); });
  page.on('requestfinished', async (req) => {
    if (!tracker || !tracker.start.has(req)) return;
    const t0 = tracker.start.get(req), end = Date.now();
    let size = 0;
    try { const res = await req.response(); size = Number((res && res.headers()['content-length']) || 0); } catch { /* bỏ qua */ }
    tracker.done.push({ url: req.url(), ms: end - t0, size, type: req.resourceType(), end });
  });
  page.on('requestfailed', (req) => { if (tracker) tracker.start.delete(req); });

  // Đăng nhập
  const t0 = Date.now();
  await page.goto(WEB + '/login');
  await page.fill('#username', process.env.UI_AUDIT_USER || 'dev.admin');
  await page.fill('#password', process.env.UI_AUDIT_PASS || 'Dev@12345');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  console.log(`Đăng nhập → vào được app: ${Date.now() - t0} ms (URL ${new URL(page.url()).pathname})`);

  // Mở hết nhóm menu rồi gom đường dẫn
  for (let i = 0; i < 3; i++) {
    const closed = await page.$$('aside button[aria-expanded="false"]');
    for (const b of closed) { try { await b.click({ timeout: 800 }); } catch { /* bỏ qua */ } }
  }
  let hrefs = await page.$$eval('aside a[href^="/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
  hrefs = hrefs.filter((h) => h && !h.startsWith('/login') && !h.includes('#'));
  if (ONLY.length) hrefs = hrefs.filter((h) => ONLY.some((o) => h.includes(o)));
  hrefs = hrefs.slice(0, MAX_ROUTES);
  console.log(`Số trang đo: ${hrefs.length}`);

  await page.evaluate(() => {
    window.__longTaskMs = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTaskMs += e.duration; }).observe({ type: 'longtask', buffered: false }); } catch { /* không hỗ trợ */ }
  });
  const cdp = await ctx.newCDPSession(page);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  // Giả lập mạng có độ trễ (VPS/SaaS): NET_LATENCY_MS (độ trễ mỗi yêu cầu), NET_KBPS (băng thông tải xuống, kilobit/giây; mặc định 20000).
  const NET_LATENCY_MS = Number(process.env.NET_LATENCY_MS || 0);
  if (NET_LATENCY_MS > 0) {
    const bytesPerSec = (Number(process.env.NET_KBPS || 20000) * 1000) / 8;
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: NET_LATENCY_MS, downloadThroughput: bytesPerSec, uploadThroughput: bytesPerSec });
    console.log(`Mạng giả lập: trễ ${NET_LATENCY_MS} ms, ${process.env.NET_KBPS || 20000} kbps`);
  }
  // Chờ để tải trước lúc rảnh (D, #304) chạy xong trước khi đo; đặt 0 để đo như người dùng bấm ngay sau đăng nhập.
  const WARMUP_MS = Number(process.env.WARMUP_MS || 0);
  if (WARMUP_MS > 0) { console.log(`Chờ ${WARMUP_MS} ms cho tải trước lúc rảnh...`); await page.waitForTimeout(WARMUP_MS); }

  async function navigate(href) {
    tracker = { start: new Map(), done: [] };
    await page.evaluate(() => { window.__longTaskMs = 0; });
    const res = await page.evaluate((h) => new Promise((resolve) => {
      const prevText = ((document.querySelector('main') || document.body).innerText || '').trim();
      const t = performance.now();
      history.pushState({}, '', h);
      window.dispatchEvent(new PopStateEvent('popstate'));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const paint = performance.now() - t;
        const main = document.querySelector('main') || document.body;
        const tick = () => {
          const pulsing = main.querySelectorAll('.animate-pulse, .animate-spin').length;
          const txt = (main.innerText || '').trim();
          const hasText = txt.length > 40 && txt !== prevText;
          if (!pulsing && hasText) return resolve({ paint, content: performance.now() - t, timedOut: false });
          if (performance.now() - t > 20000) return resolve({ paint, content: performance.now() - t, timedOut: true });
          setTimeout(tick, 25);
        };
        tick();
      }));
    }), href);
    // mạng yên 400 ms
    let idleMs = 0;
    const startWait = Date.now();
    for (;;) {
      await page.waitForTimeout(100);
      const pending = [...tracker.start.keys()].filter((r) => !tracker.done.find((d) => d.url === r.url())).length;
      const last = tracker.done.length ? Math.max(...tracker.done.map((d) => d.end)) : startWait;
      if (pending === 0 && Date.now() - last >= 400) { idleMs = last - (tracker.startAt || startWait); break; }
      if (Date.now() - startWait > 20000) { idleMs = 20000; break; }
    }
    const longTask = await page.evaluate(() => window.__longTaskMs);
    const api = tracker.done.filter((d) => d.url.includes('/api/'));
    const js = tracker.done.filter((d) => d.type === 'script');
    const slowest = api.sort((a, b) => b.ms - a.ms)[0];
    return {
      href, paint: Math.round(res.paint), content: Math.round(res.content), timedOut: res.timedOut,
      nApi: api.length, nJs: js.length, jsKB: Math.round(js.reduce((s, d) => s + d.size, 0) / 1024),
      slowApi: slowest ? `${norm(new URL(slowest.url).pathname)} ${slowest.ms}ms` : '', slowApiMs: slowest ? slowest.ms : 0,
      longTask: Math.round(longTask), apiList: api.map((d) => ({ p: norm(new URL(d.url).pathname), ms: d.ms })), idleHint: idleMs,
    };
  }

  const passes = [];
  for (const name of ['lần 1 (chunk chưa có trong cache)', 'lần 2 (đã có chunk)']) {
    const rows = [];
    for (const h of hrefs) { try { rows.push(await navigate(h)); } catch (e) { rows.push({ href: h, error: String(e.message || e).slice(0, 80) }); } }
    passes.push({ name, rows });
  }

  console.log(`\nCPU làm chậm x${CPU}`);
  for (const { name, rows } of passes) {
    const ok = rows.filter((r) => !r.error);
    console.log(`\n=== ${name}: ${ok.length} trang ===`);
    console.log(`paint   p50=${pct(ok.map((r) => r.paint), 50)}ms  p95=${pct(ok.map((r) => r.paint), 95)}ms`);
    console.log(`content p50=${pct(ok.map((r) => r.content), 50)}ms  p95=${pct(ok.map((r) => r.content), 95)}ms  max=${Math.max(...ok.map((r) => r.content))}ms`);
    console.log(`API/trang p50=${pct(ok.map((r) => r.nApi), 50)}  max=${Math.max(...ok.map((r) => r.nApi))};  longTask p95=${pct(ok.map((r) => r.longTask), 95)}ms`);
    console.log('--- 12 trang chậm nhất (content) ---');
    for (const r of [...ok].sort((a, b) => b.content - a.content).slice(0, 12)) {
      console.log(`${String(r.content).padStart(6)}ms content | paint ${String(r.paint).padStart(4)} | api ${String(r.nApi).padStart(2)} | js ${String(r.nJs).padStart(2)}/${String(r.jsKB).padStart(4)}KB | long ${String(r.longTask).padStart(4)}ms | ${r.href}  ← ${r.slowApi}${r.timedOut ? '  (QUÁ HẠN)' : ''}`);
    }
    for (const r of rows.filter((x) => x.error)) console.log('LỖI', r.href, r.error);
  }

  // Tổng hợp theo endpoint (lần 2): số lần gọi, p50, p95, max
  const agg = new Map();
  for (const r of passes[1].rows.filter((x) => !x.error)) for (const a of r.apiList) { const k = a.p; if (!agg.has(k)) agg.set(k, []); agg.get(k).push(a.ms); }
  console.log('\n=== Endpoint chậm nhất (lần 2, theo p95) ===');
  for (const [k, v] of [...agg.entries()].sort((a, b) => pct(b[1], 95) - pct(a[1], 95)).slice(0, 14)) console.log(`${String(pct(v, 95)).padStart(5)}ms p95 | ${String(pct(v, 50)).padStart(4)}ms p50 | n=${String(v.length).padStart(3)} | ${k}`);
  // Endpoint bị gọi lặp nhiều nhất trên một trang (nghi trùng)
  const dup = [];
  for (const r of passes[1].rows.filter((x) => !x.error)) { const c = {}; for (const a of r.apiList) c[a.p] = (c[a.p] || 0) + 1; for (const [p, n] of Object.entries(c)) if (n >= 3) dup.push(`${r.href}: ${p} x${n}`); }
  if (dup.length) { console.log('\n=== Endpoint gọi lặp >= 3 lần trong MỘT lần chuyển trang ==='); dup.slice(0, 15).forEach((d) => console.log(d)); }

  fs.writeFileSync(path.join(OUT, `nav-perf-cpu${CPU}.json`), JSON.stringify(passes, null, 1));
  await browser.close();
})().catch((e) => { console.error('LỖI', e); process.exit(1); });
