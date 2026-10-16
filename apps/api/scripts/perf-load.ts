import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';

/**
 * Đo tải API qua HTTP thật (S6-04: p95 < 500 ms với 10 người dùng đồng thời — docs/product/prd.md
 * mục 5, docs/product/plan.md mục 9). Script thủ công, KHÔNG chạy trong `pnpm test`/CI — cùng khuôn
 * `perf-patient-search.ts`/`perf-consultation.ts`, nhưng khác ở chỗ đi qua TOÀN BỘ stack (mạng →
 * guard → service → Prisma → Postgres → serialize), đúng thứ mà "p95 API" trong PRD muốn đo.
 *
 * Chỉ ĐỌC (GET) — an toàn chạy trên máy chủ pilot có dữ liệu thật: không tạo, sửa, xoá gì. Các GET
 * mở hồ sơ bệnh nhân/lượt khám vẫn ghi `audit_log` "xem" (đúng như người dùng thật mở) nên bảng nhật
 * ký sẽ có thêm dòng của tài khoản đo — dùng một tài khoản riêng để dễ nhận ra.
 *
 * Mỗi người dùng ảo (VU) đăng nhập MỘT phiên riêng, rồi lặp: chọn kịch bản theo trọng số → gọi →
 * nghỉ ngẫu nhiên (think time, mặc định 0,5–1,5 giây — nhịp thao tác của lễ tân/bác sĩ, không bắn
 * dồn dập). ID bệnh nhân/lượt khám lấy từ chính dữ liệu có sẵn của tenant.
 *
 * Quy ước báo cáo (để con số không tự đẹp lên):
 *  - p95 tổng hợp KHÔNG gồm đăng nhập (Argon2id cố ý chậm, chỉ xảy ra một lần mỗi phiên) — đăng nhập
 *    báo riêng một dòng.
 *  - 429 (rate limit) KHÔNG tính vào độ trễ, đếm riêng và nêu rõ: 10 nhân viên sau cùng một NAT
 *    chia chung 1 bucket `patient-lookup` 50 lần/phút (iam.module.ts) — đó là phát hiện thật nếu xảy ra.
 *  - Mọi mã lỗi khác 2xx/429 là LỖI → kết quả KHÔNG ĐẠT dù p95 thấp.
 *  - Bỏ `PERF_WARMUP_SEC` giây đầu (JIT, connection pool, cache nóng) khỏi thống kê.
 *
 * Biến môi trường:
 *   PERF_BASE_URL   (bắt buộc)  gốc API, vd http://localhost:3001 hoặc http://192.168.1.10/api (không / cuối)
 *   PERF_TENANT_ID  (bắt buộc)  tenantId của phòng khám cần đo
 *   PERF_USERNAME / PERF_PASSWORD (bắt buộc)  tài khoản có quyền đọc bệnh nhân/lịch hẹn/lượt khám/thu ngân/kho
 *   PERF_USERS (10) · PERF_DURATION_SEC (120, tối đa 600 — access token sống 15 phút) · PERF_WARMUP_SEC (10)
 *   PERF_THINK_MIN_MS (500) · PERF_THINK_MAX_MS (1500) · PERF_TARGET_P95_MS (500)
 *   PERF_OUT        (tuỳ chọn)  đường dẫn file JSON để lưu kết quả đầy đủ
 *
 * Dùng: PERF_BASE_URL=... PERF_TENANT_ID=... PERF_USERNAME=... PERF_PASSWORD=... pnpm --filter @nexamed/api run perf:load
 */

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Thiếu biến môi trường ${name} (xem chú thích đầu file scripts/perf-load.ts).`);
  return v;
}
const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} không hợp lệ.`);
  return n;
};

const BASE_URL = env('PERF_BASE_URL').replace(/\/+$/, '');
const TENANT_ID = env('PERF_TENANT_ID');
const USERNAME = env('PERF_USERNAME');
const PASSWORD = env('PERF_PASSWORD');
const USERS = envInt('PERF_USERS', 10);
const DURATION_SEC = Math.min(envInt('PERF_DURATION_SEC', 120), 600);
const WARMUP_SEC = envInt('PERF_WARMUP_SEC', 10);
const THINK_MIN = envInt('PERF_THINK_MIN_MS', 500);
const THINK_MAX = Math.max(envInt('PERF_THINK_MAX_MS', 1500), THINK_MIN);
const TARGET_P95 = envInt('PERF_TARGET_P95_MS', 500);
const OUT = process.env.PERF_OUT;

interface Sample {
  scenario: string;
  ms: number;
  status: number;
  at: number; // ms kể từ lúc bắt đầu pha đo
}

interface Scenario {
  name: string;
  weight: number;
  /** Trả đường dẫn (kèm query) hoặc null nếu thiếu dữ liệu nền để gọi. */
  path: (ctx: Ctx) => string | null;
}

interface Ctx {
  today: string;
  patientIds: string[];
  encounterIds: string[];
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SEARCH_TERMS = ['nguyen', 'tran', 'le', 'pham', 'hoang', 'vu', '09', '03'];

const SCENARIOS: Scenario[] = [
  { name: 'GET /reception/list (danh sách tiếp nhận)', weight: 14, path: (c) => `/reception/list?date=${c.today}` },
  { name: 'GET /appointments (lưới lịch hẹn theo ngày)', weight: 12, path: (c) => `/appointments?date=${c.today}&limit=100` },
  { name: 'GET /billing/invoices (thu ngân trong ngày)', weight: 10, path: (c) => `/billing/invoices?date=${c.today}` },
  { name: 'GET /patients/:id (hồ sơ bệnh nhân)', weight: 12, path: (c) => (c.patientIds.length ? `/patients/${pick(c.patientIds)}` : null) },
  { name: 'GET /patients?q= (tìm bệnh nhân)', weight: 12, path: () => `/patients?q=${pick(SEARCH_TERMS)}&limit=20` },
  { name: 'GET /encounters/:id/consultation (màn khám)', weight: 12, path: (c) => (c.encounterIds.length ? `/encounters/${pick(c.encounterIds)}/consultation` : null) },
  { name: 'GET /encounters/by-patient/:id/history (lịch sử khám)', weight: 6, path: (c) => (c.patientIds.length ? `/encounters/by-patient/${pick(c.patientIds)}/history` : null) },
  { name: 'GET /icd10?q= (tìm mã bệnh)', weight: 8, path: () => `/icd10?q=${pick(['viem', 'sot', 'dau', 'ho', 'tang huyet'])}` },
  { name: 'GET /drugs?q= (tìm thuốc)', weight: 8, path: () => `/drugs?q=${pick(['para', 'amox', 'vitamin', 'a'])}` },
  { name: 'GET /inventory/balances (tồn kho)', weight: 4, path: () => '/inventory/balances' },
  { name: 'GET /auth/me', weight: 2, path: () => '/auth/me' },
];
const TOTAL_WEIGHT = SCENARIOS.reduce((s, x) => s + x.weight, 0);
const pickScenario = (): Scenario => {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const s of SCENARIOS) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return SCENARIOS[0]!;
};

/** Ngày hôm nay theo giờ Việt Nam (UTC+7 cố định) — không dùng ngày UTC của máy chạy script. */
function vietnamToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Phần JSON phản hồi mà script đọc ({data,meta} / {error}) — chỉ khai các trường dùng tới. */
interface ApiJson {
  data?: {
    accessToken?: string;
    items?: Array<{ id?: string; encounterId?: string }>;
    nextCursor?: string | null;
    version?: string;
    build?: string;
  };
  error?: unknown;
  retryAfterSec?: number;
}

async function timedFetch(path: string, token: string | null, init?: RequestInit): Promise<{ ms: number; status: number; json: ApiJson | null }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const text = await res.text(); // đọc hết body — thời gian phản hồi gồm cả tải payload
  const ms = performance.now() - t0;
  let json: ApiJson | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* body không phải JSON — giữ null */
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') ?? 0);
    (json ??= {}).retryAfterSec = wait;
  }
  return { ms, status: res.status, json };
}

async function login(): Promise<{ token: string; ms: number }> {
  // Đăng nhập giới hạn 10 lần/phút/IP (iam.module.ts) — đủ cho 10 VU nếu bucket đang trống; nếu vừa
  // chạy script/đăng nhập trước đó thì chờ bucket hồi rồi thử lại.
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await timedFetch('/auth/login', null, { method: 'POST', body: JSON.stringify({ tenantId: TENANT_ID, username: USERNAME, password: PASSWORD }) });
    if (r.status === 200 && r.json?.data?.accessToken) return { token: r.json.data.accessToken, ms: r.ms };
    if (r.status === 429) {
      await sleep(Math.max(r.json?.retryAfterSec ?? 0, 15) * 1000);
      continue;
    }
    throw new Error(`Đăng nhập thất bại (HTTP ${r.status}): ${JSON.stringify(r.json?.error ?? r.json)}`);
  }
  throw new Error('Đăng nhập bị giới hạn tốc độ (429) quá 6 lần liên tiếp — đợi 1 phút rồi chạy lại, hoặc dùng ít PERF_USERS hơn.');
}

/** Lấy ID thật từ dữ liệu có sẵn để các kịch bản mở-chi-tiết có cái để mở. */
async function discover(token: string, today: string): Promise<Ctx> {
  const ctx: Ctx = { today, patientIds: [], encounterIds: [] };
  const patients = await timedFetch('/patients?limit=100&sort=created_desc', token);
  if (patients.status === 200) ctx.patientIds = (patients.json?.data?.items ?? []).map((p) => p.id ?? "").filter(Boolean);
  // Lượt khám: gom từ lịch sử khám của vài bệnh nhân đầu (màn khám cần id lượt khám có thật).
  // Quét tối đa MAX_SCAN bệnh nhân (mới nhất trước, rồi các trang cũ hơn) cho tới khi đủ lượt khám.
  const MAX_SCAN = 300;
  const scanned = new Set<string>();
  const scan = async (ids: string[]) => {
    for (const pid of ids) {
      if (scanned.size >= MAX_SCAN || ctx.encounterIds.length >= 40) return;
      if (scanned.has(pid)) continue;
      scanned.add(pid);
      const h = await timedFetch(`/encounters/by-patient/${pid}/history?limit=5`, token);
      if (h.status !== 200) continue;
      for (const it of h.json?.data?.items ?? []) if (it?.encounterId) ctx.encounterIds.push(it.encounterId);
    }
  };
  // Bệnh nhân lâu năm (tạo sớm nhất) thường có lịch sử khám nhất — quét trước, rồi mới tới các hồ sơ mới.
  const oldest = await timedFetch('/patients?limit=100&sort=created_asc', token);
  if (oldest.status === 200) await scan((oldest.json?.data?.items ?? []).map((p) => p.id ?? "").filter(Boolean));
  await scan(ctx.patientIds);
  let cursor: string | null = patients.json?.data?.nextCursor ?? null;
  while (cursor && scanned.size < MAX_SCAN && ctx.encounterIds.length < 40) {
    const page = await timedFetch(`/patients?limit=100&sort=created_desc&cursor=${cursor}`, token);
    if (page.status !== 200) break;
    await scan((page.json?.data?.items ?? []).map((p) => p.id ?? "").filter(Boolean));
    cursor = page.json?.data?.nextCursor ?? null;
  }
  return ctx;
}

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return NaN;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(idx, 0)]!;
}

interface Stats {
  n: number;
  ok: number;
  rateLimited: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}
function summarize(samples: Sample[]): Stats {
  const ok = samples.filter((s) => s.status >= 200 && s.status < 300);
  const ms = ok.map((s) => s.ms).sort((a, b) => a - b);
  return {
    n: samples.length,
    ok: ok.length,
    rateLimited: samples.filter((s) => s.status === 429).length,
    errors: samples.filter((s) => !(s.status >= 200 && s.status < 300) && s.status !== 429).length,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    p99: percentile(ms, 99),
    max: ms.length ? ms[ms.length - 1]! : NaN,
  };
}
const f = (n: number) => (Number.isNaN(n) ? '   -  ' : n.toFixed(0).padStart(6));

async function main() {
  console.log(`Đo tải API: ${USERS} người dùng ảo, ${DURATION_SEC}s (bỏ ${WARMUP_SEC}s đầu), think ${THINK_MIN}-${THINK_MAX}ms → ${BASE_URL}`);
  const ver = await timedFetch('/system/version', null).catch(() => null);
  const verData = ver?.json?.data;
  if (verData?.version) console.log(`Phiên bản máy chủ: ${verData.version}${verData.build ? ` · bản dựng ${verData.build}` : ''}`);

  // 1) Mỗi VU đăng nhập phiên riêng (song song — đúng cảnh 10 người cùng mở máy đầu ca).
  const logins = await Promise.all(Array.from({ length: USERS }, () => login()));
  const loginMs = logins.map((l) => l.ms).sort((a, b) => a - b);
  console.log(`Đăng nhập ${USERS} phiên xong: p50 ${f(percentile(loginMs, 50))} ms, max ${f(loginMs[loginMs.length - 1]!)} ms (báo riêng, không tính vào p95)`);

  const ctx = await discover(logins[0]!.token, vietnamToday());
  console.log(`Dữ liệu nền: ${ctx.patientIds.length} bệnh nhân, ${ctx.encounterIds.length} lượt khám để mở chi tiết.`);
  if (ctx.patientIds.length === 0) console.log('  ⚠ Tenant chưa có bệnh nhân — các kịch bản mở hồ sơ/màn khám bị bỏ qua, kết quả KHÔNG đại diện.');
  else if (ctx.patientIds.length < 20 || ctx.encounterIds.length < 10) console.log('  ⚠ Dữ liệu ít — độ trễ thực tế trên phòng khám đã dùng lâu có thể cao hơn.');

  // 2) Pha đo.
  const samples: Sample[] = [];
  const skipped = new Map<string, number>();
  const start = performance.now();
  const endAt = start + DURATION_SEC * 1000;
  let aborted: string | null = null;

  const vu = async (token: string) => {
    while (performance.now() < endAt && !aborted) {
      const sc = pickScenario();
      const path = sc.path(ctx);
      if (!path) {
        skipped.set(sc.name, (skipped.get(sc.name) ?? 0) + 1);
      } else {
        try {
          const r = await timedFetch(path, token);
          samples.push({ scenario: sc.name, ms: r.ms, status: r.status, at: performance.now() - start });
          if (r.status === 401) aborted = 'Token hết hạn/bị từ chối (401) giữa chừng — rút ngắn PERF_DURATION_SEC.';
        } catch (e) {
          samples.push({ scenario: sc.name, ms: 0, status: 0, at: performance.now() - start });
          console.log(`  lỗi mạng ở ${sc.name}: ${(e as Error).message}`);
        }
      }
      await sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
    }
  };
  await Promise.all(logins.map((l) => vu(l.token)));
  if (aborted) throw new Error(aborted);

  // 3) Thống kê (bỏ pha khởi động).
  const measured = samples.filter((s) => s.at >= WARMUP_SEC * 1000);
  const all = summarize(measured);
  console.log('\nKịch bản'.padEnd(58) + '     n    ok   429   lỗi   p50   p95   p99   max');
  const perScenario: Record<string, Stats> = {};
  for (const sc of SCENARIOS) {
    const st = summarize(measured.filter((s) => s.scenario === sc.name));
    perScenario[sc.name] = st;
    if (st.n === 0) continue;
    console.log(`${sc.name.padEnd(57)}${String(st.n).padStart(6)}${String(st.ok).padStart(6)}${String(st.rateLimited).padStart(6)}${String(st.errors).padStart(6)} ${f(st.p50)}${f(st.p95)}${f(st.p99)}${f(st.max)}`);
  }
  console.log(`${'TỔNG HỢP (không gồm đăng nhập)'.padEnd(57)}${String(all.n).padStart(6)}${String(all.ok).padStart(6)}${String(all.rateLimited).padStart(6)}${String(all.errors).padStart(6)} ${f(all.p50)}${f(all.p95)}${f(all.p99)}${f(all.max)}`);

  // Yêu cầu chậm nhất kèm thời điểm: tập trung đầu pha đo = nhiễu khởi động, rải đều = chậm thật.
  const slowest = [...measured].filter((s) => s.status >= 200 && s.status < 300).sort((a, b) => b.ms - a.ms).slice(0, 5);
  if (slowest.length) {
    console.log('\n5 yêu cầu chậm nhất (giây kể từ lúc bắt đầu đo):');
    for (const s of slowest) console.log(`  ${s.ms.toFixed(0).padStart(5)} ms  @${(s.at / 1000).toFixed(0).padStart(4)}s  ${s.scenario}`);
  }

  const elapsed = (Math.min(performance.now(), endAt) - start) / 1000;
  console.log(`\nThông lượng: ${(samples.length / elapsed).toFixed(1)} yêu cầu/giây (cả pha khởi động). Máy chạy script: ${cpus().length} CPU, ${(totalmem() / 1024 ** 3).toFixed(1)} GB RAM.`);
  for (const [name, n] of skipped) console.log(`  ⚠ Bỏ qua ${n} lần "${name}" vì thiếu dữ liệu nền.`);
  if (all.rateLimited > 0) {
    console.log(`  ⚠ ${all.rateLimited} yêu cầu bị rate limit (429) — không tính vào độ trễ. Nếu pilot có ~${USERS} máy dùng chung 1 IP, tìm bệnh nhân (50 lần/phút/IP) có thể chặn nhầm người dùng thật.`);
  }

  const failures: string[] = [];
  if (all.ok === 0) failures.push('không có yêu cầu thành công nào');
  if (all.p95 >= TARGET_P95) failures.push(`p95 tổng hợp ${all.p95.toFixed(0)}ms ≥ ${TARGET_P95}ms`);
  if (all.errors > 0) failures.push(`${all.errors} yêu cầu lỗi (không phải 2xx/429)`);
  const slow = SCENARIOS.filter((sc) => perScenario[sc.name]!.n > 0 && perScenario[sc.name]!.p95 >= TARGET_P95).map((sc) => sc.name);
  const verdict = failures.length === 0 ? `ĐẠT — p95 ${all.p95.toFixed(0)}ms < ${TARGET_P95}ms, 0 lỗi` : `KHÔNG ĐẠT — ${failures.join('; ')}`;
  console.log(`\nKết quả: ${verdict}`);
  if (slow.length) console.log(`Kịch bản có p95 riêng ≥ ${TARGET_P95}ms: ${slow.join('; ')}`);

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), baseUrl: BASE_URL, users: USERS, durationSec: DURATION_SEC, warmupSec: WARMUP_SEC, thinkMs: [THINK_MIN, THINK_MAX], server: verData ?? null, data: { patients: ctx.patientIds.length, encounters: ctx.encounterIds.length }, login: { p50: percentile(loginMs, 50), max: loginMs[loginMs.length - 1] }, overall: all, perScenario, verdict }, null, 2));
    console.log(`Đã lưu kết quả: ${OUT}`);
  }
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
