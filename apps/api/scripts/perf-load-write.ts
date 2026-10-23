import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';

/**
 * Đo tải API LUỒNG GHI qua HTTP thật (S6-04 phần còn thiếu của `perf-load.ts`, vốn chỉ GỌI ĐỌC).
 * Mỗi người dùng ảo (VU) lặp MỘT LƯỢT KHÁM TRỌN VẸN như nhân viên thật: tạo bệnh nhân → tiếp nhận → sinh hiệu
 * → thu tiền → bác sĩ bắt đầu khám → chẩn đoán → ghi chú khám → kê đơn → ký đơn → hoàn tất khám. Đo độ trễ TỪNG BƯỚC
 * và cả lượt khám; chỗ tranh chấp thật (bộ đếm mã bệnh nhân/lượt khám/phiếu thu/đơn thuốc, ca thu ngân dùng chung) lộ ra ở đây.
 *
 * ⚠ GHI DỮ LIỆU THẬT — CHỈ chạy trên phòng khám THỬ/dev hoặc máy pilot đã được phép (không chạy trên dữ liệu khách đang dùng).
 * Bắt buộc `PERF_ALLOW_WRITE=yes`. Mọi bệnh nhân tạo ra có họ tên bắt đầu bằng "ZZPERF" để nhận ra/dọn. Dữ liệu lâm sàng đã ký
 * là bất biến nên KHÔNG tự xoá được — vì vậy chỉ dùng tenant thử. Tài khoản đo (tên `zzperf.*`) tự tạo nếu chưa có, dùng lại ở lần sau.
 *
 * Quy ước báo cáo giống `perf-load.ts`: bỏ `PERF_WARMUP_SEC` giây đầu; mã lỗi khác 2xx là LỖI (kèm 3 thông báo lỗi đầu tiên mỗi
 * bước để chẩn đoán); đăng nhập báo riêng. Ngưỡng p95 mặc định 500 ms áp cho từng BƯỚC (một yêu cầu), không áp cho cả lượt khám.
 *
 * Biến môi trường:
 *   PERF_BASE_URL (bắt buộc) · PERF_TENANT_ID (bắt buộc) · PERF_ALLOW_WRITE=yes (bắt buộc)
 *   PERF_ADMIN_USERNAME / PERF_ADMIN_PASSWORD (bắt buộc)  tài khoản quản trị công ty, CHỈ để tạo tài khoản đo lần đầu
 *   PERF_USERS (10) · PERF_DURATION_SEC (180, tối đa 600) · PERF_WARMUP_SEC (10) · PERF_TARGET_P95_MS (500)
 *   PERF_STEP_THINK_MIN_MS (300) · PERF_STEP_THINK_MAX_MS (900)  nghỉ giữa các bước của một lượt khám
 *   PERF_VISIT_THINK_MIN_MS (500) · PERF_VISIT_THINK_MAX_MS (1500)  nghỉ giữa hai lượt khám
 *   PERF_OUT (tuỳ chọn) file JSON lưu kết quả
 *   PERF_IDEMPOTENCY=yes  mọi POST mang header `Idempotency-Key` mới (đo chi phí của khoá chống ghi trùng, docs/DECISIONS.md #257) — so với lần chạy không đặt
 */

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Thiếu biến môi trường ${name} (xem chú thích đầu file scripts/perf-load-write.ts).`);
  return v;
}
const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} không hợp lệ.`);
  return n;
};

if (process.env.PERF_ALLOW_WRITE !== 'yes') {
  throw new Error('Script này GHI dữ liệu thật (bệnh nhân, lượt khám, phiếu thu, đơn thuốc đã ký — không xoá được). Chỉ chạy trên phòng khám thử; đặt PERF_ALLOW_WRITE=yes để xác nhận.');
}
const BASE_URL = env('PERF_BASE_URL').replace(/\/+$/, '');
const TENANT_ID = env('PERF_TENANT_ID');
const ADMIN_USERNAME = env('PERF_ADMIN_USERNAME');
const ADMIN_PASSWORD = env('PERF_ADMIN_PASSWORD');
const USERS = envInt('PERF_USERS', 10);
const DURATION_SEC = Math.min(envInt('PERF_DURATION_SEC', 180), 600);
const WARMUP_SEC = envInt('PERF_WARMUP_SEC', 10);
const TARGET_P95 = envInt('PERF_TARGET_P95_MS', 500);
const STEP_THINK: [number, number] = [envInt('PERF_STEP_THINK_MIN_MS', 300), envInt('PERF_STEP_THINK_MAX_MS', 900)];
const VISIT_THINK: [number, number] = [envInt('PERF_VISIT_THINK_MIN_MS', 500), envInt('PERF_VISIT_THINK_MAX_MS', 1500)];
const OUT = process.env.PERF_OUT;
const WITH_IDEMPOTENCY = process.env.PERF_IDEMPOTENCY === 'yes';
const PERF_PASSWORD = 'Perf@12345678';

interface Sample {
  step: string;
  ms: number;
  status: number;
  at: number;
}
interface ApiJson {
  data?: Record<string, unknown> & { accessToken?: string; items?: Array<Record<string, unknown>>; version?: number; id?: string };
  error?: { code?: string; message?: string };
  retryAfterSec?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const between = ([a, b]: [number, number]) => a + Math.random() * Math.max(b - a, 0);
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

async function call(path: string, token: string | null, init?: RequestInit): Promise<{ ms: number; status: number; json: ApiJson | null }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(WITH_IDEMPOTENCY && init?.method === 'POST' && token ? { 'idempotency-key': randomUUID() } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json: ApiJson | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* không phải JSON */
  }
  if (res.status === 429) (json ??= {}).retryAfterSec = Number(res.headers.get('retry-after') ?? 0);
  return { ms, status: res.status, json };
}

async function login(username: string, password: string): Promise<{ status: number; token?: string; ms: number }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await call('/auth/login', null, { method: 'POST', body: JSON.stringify({ tenantId: TENANT_ID, username, password }) });
    if (r.status === 200 && r.json?.data?.accessToken) return { status: 200, token: r.json.data.accessToken, ms: r.ms };
    if (r.status === 429) {
      await sleep(Math.max(r.json?.retryAfterSec ?? 0, 15) * 1000);
      continue;
    }
    return { status: r.status, ms: r.ms };
  }
  throw new Error('Đăng nhập bị giới hạn tốc độ (429) quá nhiều lần — đợi 1 phút rồi chạy lại hoặc giảm PERF_USERS.');
}

/** Đăng nhập tài khoản đo; chưa có (401) thì tạo bằng quyền quản trị rồi đăng nhập lại. */
async function ensureUser(adminToken: string, roleId: string, username: string, fullName: string): Promise<{ token: string; ms: number; userId: string }> {
  let r = await login(username, PERF_PASSWORD);
  if (r.status !== 200) {
    const created = await call('/users', adminToken, {
      method: 'POST',
      body: JSON.stringify({ username, password: PERF_PASSWORD, fullName, displayName: fullName, roleIds: [roleId], canSignMedicalRecord: true }),
    });
    if (created.status !== 200 && created.status !== 201) throw new Error(`Không tạo được tài khoản đo ${username} (HTTP ${created.status}): ${JSON.stringify(created.json?.error)}`);
    r = await login(username, PERF_PASSWORD);
    if (r.status !== 200) throw new Error(`Đăng nhập tài khoản đo ${username} thất bại (HTTP ${r.status}).`);
  }
  const me = await call('/auth/me', r.token!);
  const userId = String((me.json?.data as { userId?: string; id?: string } | undefined)?.userId ?? (me.json?.data as { id?: string } | undefined)?.id ?? '');
  if (!userId) throw new Error(`Không đọc được userId của ${username} từ /auth/me.`);
  return { token: r.token!, ms: r.ms, userId };
}

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return NaN;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(idx, 0)]!;
}
function summarize(samples: Sample[]) {
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

const STEPS = [
  'POST /patients (tạo hồ sơ bệnh nhân)',
  'POST /reception/direct (tiếp nhận + sinh phiếu thu)',
  'POST /reception/encounters/:id/vital-signs (sinh hiệu)',
  'GET /billing/invoices/:encounterId (mở phiếu thu)',
  'POST /billing/invoices/:encounterId/pay (thu tiền)',
  'POST /encounters/:id/start (bắt đầu khám)',
  'PUT /encounters/:id/diagnoses (chẩn đoán)',
  'PUT /encounters/:id/clinical-note (ghi chú khám)',
  'PUT /encounters/:id/prescription-items (kê đơn)',
  'POST /encounters/:id/prescription/sign (ký đơn)',
  'POST /encounters/:id/complete (hoàn tất khám)',
] as const;
type StepName = (typeof STEPS)[number];

async function main() {
  console.log(`Đo tải LUỒNG GHI: ${USERS} người dùng ảo, ${DURATION_SEC}s (bỏ ${WARMUP_SEC}s đầu) → ${BASE_URL}`);
  const ver = await call('/system/version', null).catch(() => null);
  const verData = ver?.json?.data as { version?: string; build?: string } | undefined;
  if (verData?.version) console.log(`Phiên bản máy chủ: ${verData.version}${verData.build ? ` · bản dựng ${verData.build}` : ''}`);

  // 1) Chuẩn bị (không tính vào số đo): quản trị tạo/lấy tài khoản đo, lấy danh sách vai trò + thuốc.
  const admin = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  if (admin.status !== 200) throw new Error(`Đăng nhập quản trị thất bại (HTTP ${admin.status}).`);
  const rolesRes = await call('/roles', admin.token!);
  const roleList = (Array.isArray(rolesRes.json?.data) ? rolesRes.json?.data : rolesRes.json?.data?.items ?? []) as Array<{ id: string; name: string }>;
  const doctorRole = roleList.find((r) => r.name === 'doctor');
  const receptionistRole = roleList.find((r) => r.name === 'receptionist');
  if (!doctorRole || !receptionistRole) throw new Error('Không tìm thấy vai trò doctor/receptionist.');
  const reception = await ensureUser(admin.token!, receptionistRole.id, 'zzperf.letan', 'ZZPERF Lễ tân');
  const doctors: Array<{ token: string; userId: string }> = [];
  const doctorLoginMs: number[] = [];
  for (let i = 1; i <= USERS; i++) {
    const d = await ensureUser(admin.token!, doctorRole.id, `zzperf.bs${String(i).padStart(2, '0')}`, `ZZPERF Bác sĩ ${i}`);
    doctors.push(d);
    doctorLoginMs.push(d.ms);
  }
  doctorLoginMs.sort((a, b) => a - b);
  console.log(`Chuẩn bị xong: 1 lễ tân + ${USERS} bác sĩ đo (đăng nhập bác sĩ p50 ${f(percentile(doctorLoginMs, 50))} ms — báo riêng).`);

  const drugsRes = await call('/drugs?q=a', reception.token);
  const drugIds = ((drugsRes.json?.data?.items ?? (Array.isArray(drugsRes.json?.data) ? drugsRes.json?.data : [])) as Array<{ id?: string }>).map((d) => d.id ?? '').filter(Boolean);
  if (drugIds.length === 0) console.log('  ⚠ Không có thuốc trong danh mục — bước kê đơn/ký đơn sẽ bị bỏ qua.');

  // 2) Pha đo.
  const samples: Sample[] = [];
  const errorSamples = new Map<string, Map<string, number>>();
  const visits: Array<{ ms: number; ok: boolean; at: number }> = [];
  const start = performance.now();
  const endAt = start + DURATION_SEC * 1000;
  let aborted: string | null = null;

  const record = (step: StepName, r: { ms: number; status: number; json: ApiJson | null }) => {
    samples.push({ step, ms: r.ms, status: r.status, at: performance.now() - start });
    if (!(r.status >= 200 && r.status < 300) && r.status !== 429) {
      const key = `HTTP ${r.status} ${r.json?.error?.code ?? ''} ${r.json?.error?.message ?? ''}`.trim().slice(0, 160);
      const m = errorSamples.get(step) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + 1);
      errorSamples.set(step, m);
    }
    if (r.status === 401) aborted = 'Token hết hạn/bị từ chối (401) giữa chừng — rút ngắn PERF_DURATION_SEC.';
    return r.status >= 200 && r.status < 300;
  };
  const pause = () => sleep(between(STEP_THINK));
  const num = (v: unknown, fallback = 1) => (typeof v === 'number' ? v : fallback);

  async function visit(doc: { token: string; userId: string }): Promise<boolean> {
    const rec = reception.token;
    const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
    const patient = await call('/patients', rec, {
      method: 'POST',
      body: JSON.stringify({ fullName: `ZZPERF Bệnh nhân ${tag}`, dob: '1990-01-01', gender: 'female', phone: '09' + Math.floor(10_000_000 + Math.random() * 89_999_999), nationalId: '079' + Math.floor(100_000_000 + Math.random() * 899_999_999) }),
    });
    if (!record(STEPS[0], patient)) return false;
    const patientId = String(patient.json!.data!.id);
    await pause();

    const direct = await call('/reception/direct', rec, {
      method: 'POST',
      body: JSON.stringify({ patientId, doctorId: doc.userId, checkedInAt: new Date().toISOString(), services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }], receptionTypeCode: 'RT_NEW', examFormCode: 'EF_NORMAL' }),
    });
    if (!record(STEPS[1], direct)) return false;
    const encounterId = String(direct.json!.data!.id);
    await pause();

    if (!record(STEPS[2], await call(`/reception/encounters/${encounterId}/vital-signs`, doc.token, { method: 'POST', body: JSON.stringify({ pulse: 80, temperatureC: 36.8, bpSystolic: 120, bpDiastolic: 80, spo2: 98, weightGram: 60_000, heightMm: 1_650 }) }))) return false;
    await pause();

    const invoice = await call(`/billing/invoices/${encounterId}`, rec);
    if (!record(STEPS[3], invoice)) return false;
    await pause();
    const pay = await call(`/billing/invoices/${encounterId}/pay`, rec, { method: 'POST', body: JSON.stringify({ method: 'CASH', version: num(invoice.json?.data?.version) }) });
    if (!record(STEPS[4], pay)) return false;
    await pause();

    const startRes = await call(`/encounters/${encounterId}/start`, doc.token, { method: 'POST', body: JSON.stringify({ version: num(direct.json?.data?.version) }) });
    if (!record(STEPS[5], startRes)) return false;
    await pause();

    if (!record(STEPS[6], await call(`/encounters/${encounterId}/diagnoses`, doc.token, { method: 'PUT', body: JSON.stringify({ diagnoses: [{ icd10Code: 'A00', type: 'PRIMARY' }] }) }))) return false;
    await pause();

    const section = (content: string) => ({ content });
    if (!record(STEPS[7], await call(`/encounters/${encounterId}/clinical-note`, doc.token, { method: 'PUT', body: JSON.stringify({ reasonForVisit: section('Sốt, ho 2 ngày'), illnessProgress: section('Sốt nhẹ, ho khan'), preliminaryDiagnosis: section('Viêm đường hô hấp'), generalExam: section('Tỉnh, tiếp xúc tốt'), regionalExam: section('Họng đỏ'), plan: section('Uống thuốc, tái khám nếu sốt cao') }) }))) return false;
    await pause();

    if (drugIds.length > 0) {
      const items = await call(`/encounters/${encounterId}/prescription-items`, doc.token, { method: 'PUT', body: JSON.stringify({ items: [{ drugId: pick(drugIds), doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 1, durationDays: 3 }] }) });
      if (!record(STEPS[8], items)) return false;
      await pause();
      if (!record(STEPS[9], await call(`/encounters/${encounterId}/prescription/sign`, doc.token, { method: 'POST', body: JSON.stringify({ version: num(items.json?.data?.version) }) }))) return false;
      await pause();
    }

    const cur = await call(`/encounters/${encounterId}/consultation`, doc.token);
    const encVersion = num((cur.json?.data as { encounter?: { version?: number }; version?: number } | undefined)?.encounter?.version ?? (cur.json?.data as { version?: number } | undefined)?.version, num(startRes.json?.data?.version));
    return record(STEPS[10], await call(`/encounters/${encounterId}/complete`, doc.token, { method: 'POST', body: JSON.stringify({ version: encVersion }) }));
  }

  const vu = async (doc: { token: string; userId: string }) => {
    while (performance.now() < endAt && !aborted) {
      const t0 = performance.now();
      let ok = false;
      try {
        ok = await visit(doc);
      } catch (e) {
        console.log(`  lỗi mạng/bất ngờ: ${(e as Error).message}`);
      }
      visits.push({ ms: performance.now() - t0, ok, at: t0 - start });
      await sleep(between(VISIT_THINK));
    }
  };
  await Promise.all(doctors.map((d) => vu(d)));
  if (aborted) throw new Error(aborted);

  // 3) Thống kê.
  const measured = samples.filter((s) => s.at >= WARMUP_SEC * 1000);
  const all = summarize(measured);
  console.log('\nBước'.padEnd(58) + '     n    ok   429   lỗi   p50   p95   p99   max');
  const perStep: Record<string, ReturnType<typeof summarize>> = {};
  for (const step of STEPS) {
    const st = summarize(measured.filter((s) => s.step === step));
    perStep[step] = st;
    if (st.n === 0) continue;
    console.log(`${step.padEnd(57)}${String(st.n).padStart(6)}${String(st.ok).padStart(6)}${String(st.rateLimited).padStart(6)}${String(st.errors).padStart(6)} ${f(st.p50)}${f(st.p95)}${f(st.p99)}${f(st.max)}`);
  }
  console.log(`${'TỔNG HỢP các bước (không gồm đăng nhập)'.padEnd(57)}${String(all.n).padStart(6)}${String(all.ok).padStart(6)}${String(all.rateLimited).padStart(6)}${String(all.errors).padStart(6)} ${f(all.p50)}${f(all.p95)}${f(all.p99)}${f(all.max)}`);

  const doneVisits = visits.filter((v) => v.at >= WARMUP_SEC * 1000);
  const okVisits = doneVisits.filter((v) => v.ok);
  const visitMs = okVisits.map((v) => v.ms).sort((a, b) => a - b);
  const elapsedMin = (Math.min(performance.now(), endAt) - start) / 60000;
  console.log(`\nLượt khám trọn vẹn: ${okVisits.length}/${doneVisits.length} thành công (~${(visits.filter((v) => v.ok).length / elapsedMin).toFixed(1)} lượt/phút); thời gian cả lượt p50 ${(percentile(visitMs, 50) / 1000).toFixed(1)}s, p95 ${(percentile(visitMs, 95) / 1000).toFixed(1)}s (gồm thời gian nghỉ giả lập giữa các bước).`);

  if (errorSamples.size) {
    console.log('\nLỗi theo bước (tối đa 3 loại/bước):');
    for (const [step, m] of errorSamples) for (const [msg, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) console.log(`  ${n.toString().padStart(4)} × ${step} → ${msg}`);
  }
  console.log(`\nMáy chạy script: ${cpus().length} CPU, ${(totalmem() / 1024 ** 3).toFixed(1)} GB RAM.`);

  const failures: string[] = [];
  if (all.ok === 0) failures.push('không có yêu cầu thành công nào');
  if (all.p95 >= TARGET_P95) failures.push(`p95 tổng hợp ${all.p95.toFixed(0)}ms ≥ ${TARGET_P95}ms`);
  if (all.errors > 0) failures.push(`${all.errors} yêu cầu lỗi (không phải 2xx/429)`);
  const slow = STEPS.filter((s) => perStep[s]!.n > 0 && perStep[s]!.p95 >= TARGET_P95);
  console.log(`\nKết quả: ${failures.length === 0 ? `ĐẠT — p95 ${all.p95.toFixed(0)}ms < ${TARGET_P95}ms, 0 lỗi` : `KHÔNG ĐẠT — ${failures.join('; ')}`}`);
  if (slow.length) console.log(`Bước có p95 riêng ≥ ${TARGET_P95}ms: ${slow.join('; ')}`);

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), baseUrl: BASE_URL, users: USERS, durationSec: DURATION_SEC, warmupSec: WARMUP_SEC, server: verData ?? null, overall: all, perStep, visits: { ok: okVisits.length, total: doneVisits.length, p50ms: percentile(visitMs, 50), p95ms: percentile(visitMs, 95) }, errors: Object.fromEntries([...errorSamples].map(([k, v]) => [k, Object.fromEntries(v)])) }, null, 2));
    console.log(`Đã lưu kết quả: ${OUT}`);
  }
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
