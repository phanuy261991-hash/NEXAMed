#!/usr/bin/env node
/**
 * Dựng dữ liệu mẫu SẠCH (tên, địa chỉ, lý do khám thật; không có chữ test/demo) cho công ty "Phòng khám Đa khoa Hòa Hưng" để CHỤP ẢNH giới thiệu phần mềm.
 * Chỉ gọi API HTTP (đúng quy tắc: không ghi CSDL bằng SQL), chạy lại nhiều lần được (bệnh nhân/ca/lịch hẹn đã có thì bỏ qua).
 *
 * Dùng:   node scripts/demo-data/seed-demo-clinic.mjs [--days=5] [--patients=170] [--no-reception]
 * Biến môi trường: DEMO_API (mặc định http://localhost:3001/api/v1), DEMO_TENANT_ID, DEMO_ADMIN_USER, DEMO_PASSWORD.
 *
 * Danh sách "Bệnh nhân trong ngày" và hàng chờ được dựng theo GIỜ HIỆN TẠI của máy (giờ chờ tính từ lúc tiếp nhận): chạy script ngay trước khi chụp,
 * tốt nhất trong giờ làm việc (08:30–17:00). Xem scripts/demo-data/README.md.
 */
import { randomUUID } from 'node:crypto';

const API = process.env.DEMO_API ?? 'http://localhost:3001/api/v1';
const TENANT = process.env.DEMO_TENANT_ID ?? '01a1c100-5884-7bdb-8558-0981f8cbf306';
const ADMIN = process.env.DEMO_ADMIN_USER ?? 'hoangnam';
const CASHIER = process.env.DEMO_CASHIER_USER ?? 'letan.thuha';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'HoaHung@2026';
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const DAYS = Number(arg('days', 5));
const TARGET_PATIENTS = Number(arg('patients', 170));
const WITH_RECEPTION = !process.argv.includes('--no-reception');
const WAITING_PER_DOCTOR = Number(arg('waiting', 8)); // số người chờ khám của MỖI bác sĩ (đã thu tiền, chưa vào khám)

// ---------- gọi API ----------
const tokens = {};
async function call(user, method, path, body, okStatuses = [200, 201]) {
  if (!tokens[user]) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: user, password: PASSWORD }) });
    if (!r.ok) throw new Error(`Đăng nhập ${user} thất bại (${r.status}). Kiểm tra DEMO_TENANT_ID/DEMO_PASSWORD.`);
    tokens[user] = (await r.json()).data.accessToken;
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[user]}` };
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!okStatuses.includes(res.status)) {
    const err = new Error(`${method} ${path} → ${res.status} ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 300)}`);
    err.status = res.status;
    err.code = json?.error?.code;
    throw err;
  }
  return json?.data !== undefined ? json.data : json;
}
const get = (user, path) => call(user, 'GET', path);
/** Đọc hết mọi trang của một danh sách có con trỏ (API chỉ trả tối đa 100 dòng/trang). */
async function getAll(user, path) {
  const out = [];
  let cursor = '';
  for (;;) {
    const page = await get(user, `${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...page.items);
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
}

// ---------- ngày giờ (giờ Việt Nam) ----------
const vnDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (date, n) => vnDate(new Date(new Date(`${date}T12:00:00+07:00`).getTime() + n * 86_400_000));
const dow = (date) => new Date(`${date}T12:00:00+07:00`).getUTCDay(); // 0 = Chủ nhật
const isoAt = (date, hhmm) => new Date(`${date}T${hhmm}:00+07:00`).toISOString();
const hhmmOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const NOW = new Date();
const TODAY = vnDate(NOW);
const NOW_MIN = toMin(hhmmOf(NOW.toISOString()));

// ---------- số giả lập có thể lặp lại (cùng ngày cho cùng kết quả) ----------
function rng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h ^= h >>> 16) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const shuffle = (r, arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ageOf = (dob) => TODAY.slice(0, 4) - dob.slice(0, 4) - (TODAY.slice(5) < dob.slice(5) ? 1 : 0);
const log = (...a) => console.log(...a);

// ---------- dữ liệu nguồn ----------
const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Trương', 'Đinh', 'Lâm', 'Mai'];
const DEM_NAM = ['Văn', 'Minh', 'Quốc', 'Hữu', 'Đức', 'Anh', 'Thanh', 'Công', 'Gia', 'Tuấn', 'Hoàng', 'Ngọc'];
const DEM_NU = ['Thị', 'Ngọc', 'Thu', 'Thanh', 'Kim', 'Bích', 'Hoài', 'Phương', 'Diệu', 'Mỹ'];
const TEN_NAM = ['An', 'Bình', 'Cường', 'Dũng', 'Đạt', 'Hải', 'Hiếu', 'Hùng', 'Huy', 'Khang', 'Khoa', 'Kiên', 'Long', 'Nam', 'Nghĩa', 'Phát', 'Phong', 'Phúc', 'Quân', 'Quang', 'Sơn', 'Tài', 'Thắng', 'Thành', 'Thịnh', 'Tiến', 'Toàn', 'Trung', 'Tú', 'Việt', 'Vinh'];
const TEN_NU = ['Anh', 'Chi', 'Dung', 'Giang', 'Hà', 'Hạnh', 'Hoa', 'Hương', 'Lan', 'Linh', 'Loan', 'Mai', 'My', 'Ngân', 'Nhung', 'Oanh', 'Phượng', 'Quyên', 'Thảo', 'Thủy', 'Trang', 'Trâm', 'Uyên', 'Vy', 'Yến'];
const STREETS = ['Nguyễn Trãi', 'Lê Lợi', 'Điện Biên Phủ', 'Cách Mạng Tháng 8', 'Hai Bà Trưng', 'Nguyễn Thị Minh Khai', 'Võ Văn Tần', 'Lý Thường Kiệt', 'Trần Hưng Đạo', 'Phan Đăng Lưu', 'Nguyễn Văn Cừ', 'Huỳnh Văn Bánh', 'Lê Văn Sỹ', 'Quang Trung', 'Phạm Văn Đồng', 'Nguyễn Oanh', 'Lạc Long Quân', 'Tô Hiến Thành', 'Bạch Đằng', 'Sư Vạn Hạnh'];
const PHONE_PREFIX = ['090', '093', '089', '070', '076', '077', '078', '079', '081', '082', '083', '084', '085', '086', '096', '097', '098', '032', '033', '034', '035', '036', '037', '038', '039'];
const PROVINCE_CODE = { 'Thành phố Hồ Chí Minh': '079', 'Thành phố Cần Thơ': '092', 'Tỉnh Tây Ninh': '072', 'Tỉnh Đồng Nai': '075' };
const JOBS_ADULT = ['NV_VP', 'KINH_DOANH', 'CONG_NHAN', 'LDTD', 'NOI_TRO', 'CCVC', 'NONG_DAN', 'KHAC'];

// Lý do khám theo khoa, chẩn đoán ICD-10 (chỉ dùng mã có trong danh mục BYT) và ghi chú khám ngắn
const DEPT = {
  'Khoa Nội tổng quát': {
    svc: { code: 'KHAM_NOI', name: 'Khám Nội tổng quát', price: 150000 },
    reasons: ['Đau thượng vị, ợ chua sau ăn', 'Đau đầu, chóng mặt, huyết áp cao hơn thường lệ', 'Mệt mỏi, ăn uống kém hai tuần', 'Đau lưng, mỏi vai gáy sau giờ làm', 'Khát nước nhiều, sụt cân', 'Ho kéo dài, đau tức ngực nhẹ', 'Đau bụng âm ỉ, đầy hơi', 'Khám sức khoẻ định kỳ', 'Tái khám tăng huyết áp', 'Mất ngủ, hồi hộp kéo dài'],
    dx: [['I10', 'Tăng huyết áp'], ['K29.7', 'Viêm dạ dày'], ['E11.9', 'Đái tháo đường type 2'], ['M54.5', 'Đau thắt lưng'], ['J06.9', 'Nhiễm trùng hô hấp trên cấp'], ['K30', 'Khó tiêu chức năng']],
  },
  'Khoa Tai Mũi Họng': {
    svc: { code: 'KHAM_TMH', name: 'Khám Tai Mũi Họng', price: 150000 },
    reasons: ['Đau họng, nuốt vướng ba ngày', 'Nghẹt mũi kéo dài, chảy mũi sau', 'Ù tai, nghe kém từng đợt', 'Viêm xoang tái phát, đau vùng trán', 'Ngứa họng, ho về đêm', 'Chảy máu mũi tái diễn', 'Khàn tiếng hơn một tuần', 'Hắt hơi, ngứa mũi theo mùa'],
    dx: [['J02.9', 'Viêm họng cấp'], ['J30.4', 'Viêm mũi dị ứng'], ['J01.9', 'Viêm xoang cấp'], ['J03.9', 'Viêm amidan cấp']],
  },
  'Khoa Nhi': {
    svc: { code: 'KHAM_NHI', name: 'Khám Nhi', price: 150000 },
    reasons: ['Bé sốt nhẹ, bú kém hai ngày', 'Ho có đờm, sổ mũi bảy ngày', 'Đau bụng quanh rốn, biếng ăn', 'Khám trước tiêm ngừa theo lịch', 'Nổi mẩn đỏ ngứa trên da', 'Sốt cao về chiều, quấy khóc', 'Ho đờm, khò khè về đêm', 'Tiêu chảy hai ngày, nôn ít'],
    dx: [['J06.9', 'Nhiễm trùng hô hấp trên cấp'], ['J20.9', 'Viêm phế quản cấp'], ['R50.9', 'Sốt chưa rõ nguyên nhân'], ['A09', 'Tiêu chảy nhiễm trùng']],
  },
  'Khoa Tim mạch': {
    svc: { code: 'KHAM_TIM_MACH', name: 'Khám Tim mạch', price: 200000 },
    reasons: ['Hồi hộp, đánh trống ngực', 'Đau tức ngực khi gắng sức', 'Tăng huyết áp, theo dõi điều trị', 'Khó thở khi lên cầu thang', 'Chóng mặt, huyết áp không ổn định', 'Tái khám sau đợt điều trị'],
    dx: [['I10', 'Tăng huyết áp'], ['I25.1', 'Bệnh tim do xơ vữa động mạch vành'], ['I49.9', 'Rối loạn nhịp tim'], ['I50.9', 'Suy tim']],
  },
  'Khoa Da liễu': {
    svc: { code: 'KHAM_DA_LIEU', name: 'Khám Da liễu', price: 180000 },
    reasons: ['Nổi mụn viêm vùng mặt', 'Ngứa, nổi mề đay nhiều ngày', 'Mụn nước ở bàn tay, ngứa', 'Da khô, bong vảy, ngứa', 'Nổi ban đỏ sau tiếp xúc hoá chất', 'Rụng tóc từng mảng'],
    dx: [['L70.0', 'Mụn trứng cá'], ['L50.9', 'Mề đay'], ['L30.9', 'Viêm da'], ['L20.9', 'Viêm da cơ địa']],
  },
};
const CANCEL_REASONS = ['Bệnh nhân báo bận việc đột xuất, hẹn lại sau', 'Bệnh nhân đã đỡ, xin huỷ lịch', 'Đổi sang lịch khám khác trong tuần'];
const NOTE_BY_DEPT = (reason, dxName) => ({
  reasonForVisit: { content: reason },
  illnessProgress: { content: 'Triệu chứng xuất hiện cách đây vài ngày, tăng dần, chưa dùng thuốc điều trị.' },
  preliminaryDiagnosis: { content: dxName },
  generalExam: { content: 'Tỉnh, tiếp xúc tốt. Da niêm mạc hồng, không phù.' },
  regionalExam: { content: 'Khám theo triệu chứng, chưa ghi nhận dấu hiệu nặng.' },
  plan: { content: 'Điều trị ngoại trú, theo dõi và tái khám nếu triệu chứng không giảm.' },
  conclusion: { content: dxName },
  doctorAdvice: { content: 'Uống thuốc đúng giờ, nghỉ ngơi, tái khám ngay nếu có dấu hiệu bất thường.' },
});

// ---------- 1. Bệnh nhân ----------
async function loadPatients() {
  const all = [];
  let cursor = '';
  for (;;) {
    const page = await get(ADMIN, `/patients?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    all.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

async function ensurePatients(existing) {
  if (existing.length >= TARGET_PATIENTS) return existing;
  const r = rng('benh-nhan-hoa-hung');
  const seen = new Set(existing.map((p) => `${p.fullName}|${p.dob}`));
  const phones = new Set(existing.map((p) => p.phone));
  const places = [...new Set(existing.filter((p) => p.address).map((p) => JSON.stringify({ ward: p.address.ward, province: p.address.province })))].map((s) => JSON.parse(s));
  let made = 0;
  let guard = 0;
  while (existing.length < TARGET_PATIENTS && guard++ < 2000) {
    const kid = r() < 0.22;
    const male = r() < 0.5;
    const age = kid ? int(r, 0, 15) : int(r, 18, 82);
    let year = Number(TODAY.slice(0, 4)) - age;
    const mmdd = `${String(int(r, 1, 12)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}`;
    if (`${year}-${mmdd}` >= TODAY) year -= 1; // không sinh ngày sinh ở tương lai
    const dob = `${year}-${mmdd}`;
    const ho = pick(r, HO);
    const fullName = `${ho} ${pick(r, male ? DEM_NAM : DEM_NU)} ${pick(r, male ? TEN_NAM : TEN_NU)}`;
    if (seen.has(`${fullName}|${dob}`) || fullName.split(' ')[1] === fullName.split(' ')[2]) continue;
    let phone;
    do { phone = pick(r, PHONE_PREFIX) + String(int(r, 1000000, 9999999)); } while (phones.has(phone));
    const place = pick(r, places);
    const houseNo = r() < 0.55 ? `${int(r, 1, 480)}/${int(r, 1, 40)}` : String(int(r, 1, 480));
    const street = `${houseNo} ${pick(r, STREETS)}`;
    const body = { fullName, dob, gender: male ? 'male' : 'female', phone, address: { ward: place.ward, province: place.province, street }, ethnicity: '1', nationality: 'VNM' };
    if (!kid) {
      const code = PROVINCE_CODE[place.province] ?? '079';
      const centuryGender = (year >= 2000 ? 2 : 0) + (male ? 0 : 1);
      body.nationalId = `${code}${centuryGender}${String(year % 100).padStart(2, '0')}${String(int(r, 100000, 999999))}`;
      body.nationalIdIssuedAt = `${int(r, 2021, 2025)}-${String(int(r, 1, 12)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}`;
      body.nationalIdIssuedPlace = 'Cục Cảnh sát quản lý hành chính về trật tự xã hội';
      body.occupation = age >= 62 ? 'HUU_TRI' : pick(r, JOBS_ADULT);
    } else {
      body.occupation = age < 6 ? 'TRE_EM' : 'HSSV';
      const dad = r() < 0.5;
      body.relativeFullName = `${ho} ${pick(r, dad ? DEM_NAM : DEM_NU)} ${pick(r, dad ? TEN_NAM : TEN_NU)}`;
      body.relativeRelationship = dad ? 'Bố' : 'Mẹ';
      body.relativePhone = pick(r, PHONE_PREFIX) + String(int(r, 1000000, 9999999));
      body.relativeAddress = `${street}, ${place.ward}, ${place.province}`;
    }
    try {
      const created = await call(ADMIN, 'POST', '/patients', body);
      existing.push({ id: created.id, patientCode: created.patientCode, fullName, dob, gender: body.gender, phone, address: body.address });
      seen.add(`${fullName}|${dob}`); phones.add(phone); made++;
    } catch (e) { if (e.status !== 409 && e.status !== 400 && e.status !== 422) throw e; if (guard < 40) log('  (từ chối)', e.message.slice(0, 200)); }
  }
  log(`Bệnh nhân: tạo thêm ${made}, tổng ${existing.length}.`);
  return existing;
}

// ---------- 1b. Tài khoản, khoa, phòng, bác sĩ (chỉ tạo phần còn thiếu) ----------
async function ensureStaff() {
  const rooms = (await get(ADMIN, '/rooms')).items;
  const floorTret = rooms.find((x) => x.name === 'Phòng khám Nhi')?.floorId;
  const floor1 = rooms.find((x) => x.name === 'Phòng khám Tai Mũi Họng')?.floorId;
  const ensureNamed = async (listPath, name, createPath, body) => {
    const found = (await get(ADMIN, listPath)).items.find((x) => x.name === name);
    return found ?? (log('Đã tạo', name), await call(ADMIN, 'POST', createPath, body));
  };
  const tim = await ensureNamed('/departments', 'Khoa Tim mạch', '/departments', { name: 'Khoa Tim mạch', participatesInQueue: true });
  const dl = await ensureNamed('/departments', 'Khoa Da liễu', '/departments', { name: 'Khoa Da liễu', participatesInQueue: true });
  const roomTim = await ensureNamed('/rooms', 'Phòng khám Tim mạch', '/rooms', { name: 'Phòng khám Tim mạch', floorId: floor1 });
  const roomDl = await ensureNamed('/rooms', 'Phòng khám Da liễu', '/rooms', { name: 'Phòng khám Da liễu', floorId: floorTret });
  const roles = (await get(ADMIN, '/roles')).items;
  const roleId = (name) => roles.find((x) => x.name === name)?.id;
  const users = (await get(ADMIN, '/users?limit=100')).items;
  const mkDoctor = async (username, fullName, displayName, gender, dob, license, departmentId, defaultRoomId, phone, email) => {
    if (users.some((u) => u.username === username)) return;
    await call(ADMIN, 'POST', '/users', { username, password: PASSWORD, fullName, displayName, gender, dob, phone, email, licenseNo: license, licenseIssuedAt: '2014-06-12', licenseIssuedPlace: 'Sở Y tế Thành phố Hồ Chí Minh', academicTitleCode: 'HV00002', positionCode: 'CD00001', employmentStatusCode: 'ACTIVE', employmentTypeCode: 'FULL_TIME', canSignMedicalRecord: true, mustChangePassword: false, departmentId, defaultRoomId, roleIds: [roleId('doctor')] });
    log('Đã tạo bác sĩ', displayName);
  };
  await mkDoctor('bs.giabao', 'Võ Đức Gia Bảo', 'BS. Gia Bảo', 'male', '1981-03-17', '0037645/HCM-CCHN', tim.id, roomTim.id, '0903 517 284', 'bsgiabao@phongkhamhoahung.vn');
  await mkDoctor('bs.minhchau', 'Lê Thị Minh Châu', 'BS. Minh Châu', 'female', '1987-11-02', '0048112/HCM-CCHN', dl.id, roomDl.id, '0938 604 152', 'bsminhchau@phongkhamhoahung.vn');

  // Vai trò "Quản trị toàn quyền" = mọi quyền ở phạm vi toàn công ty; tài khoản giamdoc có thêm vai trò clinic_admin vì "Hàng đợi khám" khoá theo TÊN vai trò.
  const FULL = 'Quản trị toàn quyền';
  let full = roles.find((x) => x.name === FULL);
  if (!full) full = await call(ADMIN, 'POST', '/roles', { name: FULL });
  const matrix = await get(ADMIN, `/roles/${full.id}/permissions`);
  if (matrix.permissions.some((p) => p.dataScope !== 'global')) {
    await call(ADMIN, 'PUT', `/roles/${full.id}/permissions`, { version: matrix.role.version, entries: matrix.permissions.map((p) => ({ permissionId: p.permissionId, dataScope: 'global' })) });
    log('Đã cấp đủ quyền cho vai trò', FULL);
  }
  const wanted = [full.id, roleId('clinic_admin')];
  const boss = users.find((u) => u.username === 'giamdoc');
  if (!boss) {
    await call(ADMIN, 'POST', '/users', { username: 'giamdoc', password: PASSWORD, fullName: 'Trần Minh Quân', displayName: 'Giám đốc Minh Quân', gender: 'male', dob: '1976-05-19', phone: '0908 276 413', email: 'giamdoc@phongkhamhoahung.vn', employmentStatusCode: 'ACTIVE', employmentTypeCode: 'FULL_TIME', canSignMedicalRecord: true, mustChangePassword: false, roleIds: wanted });
    log('Đã tạo tài khoản giamdoc');
  } else if (wanted.some((id) => !(boss.roleIds ?? []).includes(id))) {
    await call(ADMIN, 'PATCH', `/users/${boss.id}`, { roleIds: wanted, version: boss.version });
    log('Đã gán vai trò cho giamdoc');
  }
}

// Hồ sơ có ngày sinh ở tương lai (do lần chạy trước) → lùi một năm.
async function fixFutureBirthdays(patients) {
  for (const p of patients.filter((x) => x.dob > TODAY)) {
    const fixed = `${Number(p.dob.slice(0, 4)) - 1}${p.dob.slice(4)}`;
    try { await call(ADMIN, 'PATCH', `/patients/${p.id}`, { dob: fixed, version: p.version }); p.dob = fixed; log('Đã sửa ngày sinh', p.fullName, fixed); } catch (e) { log('  (không sửa được ngày sinh)', e.message.slice(0, 120)); }
  }
}

// ---------- 2. Bác sĩ, ca làm việc ----------
async function loadStaff() {
  const doctors = (await get(ADMIN, '/appointments/doctors')).items;
  const depts = Object.fromEntries((await get(ADMIN, '/departments')).items.map((d) => [d.id, d.name]));
  return doctors.map((d) => ({ ...d, dept: depts[d.departmentId] })).filter((d) => DEPT[d.dept]);
}

async function ensureExamTypes() {
  const have = new Set((await get(ADMIN, '/reference-catalog/EXAM_TYPE')).items.map((i) => i.code));
  for (const d of Object.values(DEPT)) {
    if (have.has(d.svc.code)) continue;
    await call(ADMIN, 'POST', '/reference-catalog', { category: 'EXAM_TYPE', code: d.svc.code, name: d.svc.name, sortOrder: 0, examTypePrices: [{ priceTypeCode: 'THUONG', unitCode: 'DV00048', amount: d.svc.price, effectiveFrom: '2026-01-01' }] }, [200, 201]);
    log('Đã thêm dịch vụ khám', d.svc.name);
  }
}

async function ensureShifts(doctors, dates) {
  const shifts = Object.fromEntries((await get(ADMIN, '/work-shifts')).items.map((s) => [s.name, s]));
  // Mở rộng "Ca tối" đến 22:00 để phòng khám có khách buổi tối (chỉ làm một lần).
  const evening = shifts['Ca tối'];
  if (evening && evening.endTime < '22:00') {
    try { await call(ADMIN, 'PATCH', `/work-shifts/${evening.id}`, { ...pickShiftFields(evening), endTime: '22:00', version: evening.version }); log('Ca tối: 17:30–22:00'); }
    catch (e) { log('Không đổi được giờ Ca tối (bỏ qua):', e.message.slice(0, 120)); }
  }
  doctors.forEach((d, i) => d._idx = i);
  for (const d of doctors) {
    const work = dates.filter((x) => dow(x) !== 0);
    const evenings = work.filter((x) => (dow(x) + d._idx) % 2 === 0);
    for (const [name, list] of [['Ca sáng', work], ['Ca chiều', work], ['Ca tối', evenings]]) {
      if (!shifts[name] || !list.length) continue;
      await call(ADMIN, 'POST', '/work-shift-assignments/bulk', { workShiftId: shifts[name].id, workDates: list, userId: d.id });
    }
  }
  log(`Ca làm việc: đã xếp cho ${doctors.length} bác sĩ, ${dates.length} ngày.`);
}
function pickShiftFields(s) {
  const { name, code, startTime, endTime, color, restStartTime, restEndTime, restMinutes, standardWorkMinutes, sortOrder } = s;
  return { name, code, startTime, endTime, color, restStartTime, restEndTime, restMinutes, standardWorkMinutes, sortOrder };
}

async function closePending(doctors) {
  for (const d of doctors) {
    try { await call(ADMIN, 'POST', `/doctor-availability/${d.id}/close-pending`, {}, [200, 201]); } catch { /* chưa có ngày nào cần đóng */ }
  }
}

// ---------- 3. Lịch hẹn ----------
const SERVICE = (dept) => [{ examTypeCode: DEPT[dept].svc.code, examTypeName: DEPT[dept].svc.name, priceTypeCode: 'THUONG', unitCode: 'DV00048', examTypePrice: DEPT[dept].svc.price, quantity: 1 }];
const vitalsFor = (r, p) => {
  const age = ageOf(p.dob);
  if (age < 6) return { pulse: int(r, 100, 130), temperatureC: 36.5 + int(r, 0, 20) / 10, respiratoryRate: int(r, 24, 34), spo2: int(r, 97, 99), weightGram: (age * 2 + 8) * 1000 + int(r, 0, 900), heightMm: 700 + age * 60 };
  if (age < 16) return { pulse: int(r, 78, 100), temperatureC: 36.5 + int(r, 0, 15) / 10, respiratoryRate: int(r, 18, 24), spo2: int(r, 97, 99), weightGram: (age * 3 + 12) * 1000, heightMm: 900 + age * 50 };
  return { pulse: int(r, 66, 92), temperatureC: 36.4 + int(r, 0, 10) / 10, bpSystolic: int(r, 106, 148), bpDiastolic: int(r, 66, 92), respiratoryRate: int(r, 16, 20), spo2: int(r, 96, 99), weightGram: int(r, 48, 82) * 1000, heightMm: int(r, 1500, 1760) };
};

const poolFor = (dept, patients, used, r) => {
  const ok = patients.filter((p) => {
    if (used.has(p.id)) return false;
    const a = ageOf(p.dob);
    if (dept === 'Khoa Nhi') return a < 16;
    if (dept === 'Khoa Tim mạch') return a >= 40;
    if (dept === 'Khoa Da liễu') return true;
    return a >= 16;
  });
  return shuffle(r, ok);
};

async function seedAppointments(doctors, patients, dates) {
  const byDate = {};
  for (const date of dates) {
    if (dow(date) === 0) continue;
    const shiftMap = (await get(ADMIN, `/appointments/doctor-work-shifts?date=${date}`)).byDoctorId ?? {};
    const r = rng(`lich-hen-${date}`);
    const used = new Set();
    const existing = await getAll(ADMIN, `/appointments?date=${date}`);
    const idByPhone = new Map(patients.map((p) => [p.phone, p.id]));
    existing.forEach((a) => { const id = a.patientId ?? idByPhone.get(a.phone); if (id) used.add(id); });
    const made = [];
    for (const d of doctors) {
      const pool = poolFor(d.dept, patients, used, r);
      for (const w of shiftMap[d.id] ?? []) {
        for (let m = toMin(w.startTime); m + 30 <= toMin(w.endTime); m += 30) {
          if (r() > 0.84) continue; // chừa vài khung trống cho tự nhiên
          if (date === TODAY && m < NOW_MIN - 180) continue;
          const p = pool.shift();
          if (!p) break;
          used.add(p.id);
          try {
            const a = await call(ADMIN, 'POST', '/appointments', { doctorId: d.id, fullName: p.fullName, phone: p.phone, reason: pick(r, DEPT[d.dept].reasons), scheduledAt: isoAt(date, toHHMM(m)), durationMinutes: 30, source: pick(r, ['phone', 'phone', 'online', 'online', 'walk_in']) });
            made.push({ ...a, _doctor: d, _patient: p, _min: m });
          } catch (e) { if (e.status !== 409) throw e; pool.unshift(p); used.delete(p.id); }
        }
      }
    }
    byDate[date] = made;
    log(`Lịch hẹn ${date}: tạo ${made.length}.`);
  }
  return byDate;
}

// ---------- 4. Tiếp nhận hôm nay ----------
async function pay(encId) {
  const inv = await get(CASHIER, `/billing/invoices/${encId}`);
  const invoice = inv.invoice ?? inv;
  await call(CASHIER, 'POST', `/billing/invoices/${encId}/pay`, { method: 'CASH', version: invoice.version });
}
async function examine(doctor, encId, reason, dx, complete) {
  const u = doctor.username ?? DOCTOR_USER[doctor.displayName];
  const c = await get(u, `/encounters/${encId}/consultation`);
  await call(u, 'POST', `/encounters/${encId}/start`, { version: (c.encounter ?? c).version });
  if (!complete) return;
  await call(u, 'PUT', `/encounters/${encId}/diagnoses`, { diagnoses: [{ icd10Code: dx[0], type: 'PRIMARY' }] });
  await call(u, 'PUT', `/encounters/${encId}/clinical-note`, NOTE_BY_DEPT(reason, dx[1]));
  const c2 = await get(u, `/encounters/${encId}/consultation`);
  await call(u, 'POST', `/encounters/${encId}/complete`, { version: (c2.encounter ?? c2).version });
}
const DOCTOR_USER = { 'BS. Thanh Phong': 'bs.thanhphong', 'BS. Quốc Việt': 'bs.quocviet', 'BS. Mai Anh': 'bs.maianh', 'BS. Gia Bảo': 'bs.giabao', 'BS. Minh Châu': 'bs.minhchau' };

async function seedReception(doctors, patients) {
  const r = rng(`tiep-nhan-${TODAY}-${Math.floor(NOW_MIN / 30)}`);
  const todayEncounters = await getAll(ADMIN, `/reception/list?date=${TODAY}`);
  if (todayEncounters.length >= 25) { log(`Tiếp nhận hôm nay đã có ${todayEncounters.length} lượt, bỏ qua (xoá bớt hoặc chạy vào ngày khác).`); return; }
  const used = new Set(todayEncounters.map((e) => e.patientId));
  const idByPhone = new Map(patients.map((p) => [p.phone, p.id]));
  (await getAll(ADMIN, `/appointments?date=${TODAY}`)).forEach((a) => { const id = idByPhone.get(a.phone); if (id) used.add(id); });
  const base = { isPriority: false, allowsDeferredPayment: false, patientSourceCode: 'TU_DEN', examFormCode: 'THUONG' };
  const doctorsByDept = doctors;
  let rows = 0;

  const register = async (doctor, patient, minutesAgoOrAt, reason, plan) => {
    const when = typeof minutesAgoOrAt === 'string' ? isoAt(TODAY, minutesAgoOrAt) : new Date(NOW.getTime() - minutesAgoOrAt * 60_000).toISOString();
    const dx = pick(r, DEPT[doctor.dept].dx);
    const reg = await call(ADMIN, 'POST', '/reception/direct', { ...base, receptionTypeCode: r() < 0.25 ? 'TAI_KHAM' : 'KHAM_MOI', patientId: patient.id, checkedInAt: when, chiefComplaint: reason, doctorId: doctor.id, services: SERVICE(doctor.dept), ...vitalsFor(r, patient) });
    const encId = reg.encounterId ?? reg.id ?? reg.encounter?.id;
    if (plan === 'cancel') await call(ADMIN, 'POST', `/encounters/${encId}/cancel`, { cancelReason: 'Khách có việc gia đình đột xuất, xin khám lại sau', version: reg.version ?? reg.encounter?.version ?? 1 });
    else if (plan !== 'unpaid') {
      await pay(encId);
      if (plan === 'doing') await examine(doctor, encId, reason, dx, false);
      if (plan === 'done') await examine(doctor, encId, reason, dx, true);
    }
    rows++;
  };
  const nextPatient = (doctor) => { const p = poolFor(doctor.dept, patients, used, r)[0]; if (p) used.add(p.id); return p; };
  const doctorAt = (i) => doctorsByDept[i % doctorsByDept.length];

  // đã hoàn tất: rải từ 07:40 đến (bây giờ − 60 phút), tối đa 22 lượt
  const t0 = 7 * 60 + 40;
  const tEnd = Math.min(NOW_MIN - 60, 21 * 60);
  const doneCount = Math.max(0, Math.min(22, Math.floor((tEnd - t0) / 14)));
  for (let i = 0; i < doneCount; i++) {
    const doc = doctorAt(i); const p = nextPatient(doc); if (!p) continue;
    const at = Math.round(t0 + ((tEnd - t0) * i) / Math.max(1, doneCount - 1) + int(r, -4, 4));
    await register(doc, p, toHHMM(Math.max(t0, Math.min(tEnd, at))), pick(r, DEPT[doc.dept].reasons), 'done');
  }
  // đang khám: mỗi bác sĩ một người
  for (const doc of doctorsByDept) { const p = nextPatient(doc); if (p) await register(doc, p, int(r, 12, 30), pick(r, DEPT[doc.dept].reasons), 'doing'); }
  // chờ khám: 12 người đã thu tiền, đang chờ
  for (let i = 0; i < 12; i++) { const doc = doctorAt(i + 1); const p = nextPatient(doc); if (p) await register(doc, p, int(r, 3, 36), pick(r, DEPT[doc.dept].reasons), 'wait'); }
  // chờ thanh toán
  for (let i = 0; i < 4; i++) { const doc = doctorAt(i + 2); const p = nextPatient(doc); if (p) await register(doc, p, int(r, 1, 9), pick(r, DEPT[doc.dept].reasons), 'unpaid'); }
  // khách bỏ về
  for (let i = 0; i < 2; i++) { const doc = doctorAt(i + 3); const p = nextPatient(doc); if (p) await register(doc, p, int(r, 55, 95), pick(r, DEPT[doc.dept].reasons), 'cancel'); }
  log(`Tiếp nhận hôm nay: đã dựng ${rows} lượt (hoàn tất ${doneCount}).`);
}

// Dời lịch sang ngày xa nhất đã có ca (chưa có lịch hẹn nào) để không trùng khung giờ; mỗi bác sĩ một dãy giờ riêng.
const farSlot = {};
async function rescheduleFar(a) {
  let date = addDays(TODAY, DAYS + 1);
  if (dow(date) === 0) date = addDays(date, 1);
  for (let k = 0; k < 6; k++) {
    const m = (farSlot[a.doctorId] ?? 8 * 60) ;
    farSlot[a.doctorId] = m + 30 > 16 * 60 + 30 ? 8 * 60 : m + 30;
    try { await call(ADMIN, 'POST', `/appointments/${a.id}/reschedule`, { doctorId: a.doctorId, scheduledAt: isoAt(date, toHHMM(m)), version: a.version }); return true; }
    catch (e) { if (e.status !== 409) throw e; }
  }
  return false;
}

// Lịch hôm nay đã qua giờ: đủ các trạng thái — đã chuyển khám (xanh), không đến (cam), huỷ (xám), dời lịch (xám nhạt), một số để "Đã đặt" quá giờ (trễ hẹn).
async function settleTodayAppointments(doctors, patients) {
  const list = (await getAll(ADMIN, `/appointments?date=${TODAY}`)).filter((a) => a.status === 'SCHEDULED');
  if (!list.length) return;
  const r = rng(`xu-ly-lich-hom-nay-${TODAY}`);
  const docById = new Map(doctors.map((d) => [d.id, d]));
  const patByPhone = new Map(patients.map((p) => [p.phone, p]));
  const base = { isPriority: false, allowsDeferredPayment: false, patientSourceCode: 'TU_DEN', examFormCode: 'THUONG', receptionTypeCode: 'THEO_HEN' };
  const count = { arrived: 0, noShow: 0, cancelled: 0, moved: 0 };
  const doingPerDoctor = {};
  (await getAll(ADMIN, `/reception/list?date=${TODAY}`)).filter((e) => e.status === 'IN_CONSULTATION').forEach((e) => { doingPerDoctor[e.doctorId] = true; });
  for (const a of list) {
    const m = toMin(hhmmOf(a.scheduledAt));
    if (m > NOW_MIN - 3) continue; // còn ở tương lai: giữ "Đã đặt"
    const doctor = docById.get(a.doctorId); const patient = patByPhone.get(a.phone);
    if (!doctor || !patient) continue;
    const roll = r();
    try {
      if (roll < 0.58) {
        const reg = await call(ADMIN, 'POST', '/reception/check-in', { ...base, appointmentId: a.id, patientId: patient.id, version: a.version, chiefComplaint: a.reason, doctorId: doctor.id, services: SERVICE(doctor.dept), ...vitalsFor(r, patient) });
        const encId = reg.encounterId ?? reg.id ?? reg.encounter?.id;
        await pay(encId);
        const ago = NOW_MIN - m;
        if (ago > 70) await examine(doctor, encId, a.reason, pick(r, DEPT[doctor.dept].dx), true);
        else if (ago > 25 && !doingPerDoctor[doctor.id]) { doingPerDoctor[doctor.id] = true; await examine(doctor, encId, a.reason, null, false); }
        count.arrived++;
      } else if (roll < 0.7) { await call(ADMIN, 'POST', `/appointments/${a.id}/no-show`, { version: a.version }, [200, 201]); count.noShow++; }
      else if (roll < 0.8) { await call(ADMIN, 'POST', `/appointments/${a.id}/cancel`, { cancelReason: pick(r, CANCEL_REASONS), version: a.version }); count.cancelled++; }
      else if (roll < 0.9) { if (await rescheduleFar(a)) count.moved++; }
      // còn lại: để "Đã đặt" quá giờ
    } catch (e) { log('  (bỏ qua một lịch)', e.message.slice(0, 140)); }
  }
  log(`Lịch hẹn hôm nay đã qua giờ: ${count.arrived} đã chuyển khám, ${count.noShow} không đến, ${count.cancelled} huỷ, ${count.moved} dời lịch.`);
}

// Các ngày sau: một phần lịch bị huỷ / dời / đánh dấu không đến để lịch có đủ màu (chỉ làm khi ngày đó còn gần như toàn "Đã đặt").
async function diversifyFutureDays(dates) {
  for (const date of dates) {
    if (date === TODAY || dow(date) === 0) continue;
    const day = await getAll(ADMIN, `/appointments?date=${date}`);
    if (day.filter((a) => a.status !== 'SCHEDULED').length >= day.length * 0.12) continue;
    const r = rng(`da-dang-${date}`);
    const c = { cancelled: 0, moved: 0, noShow: 0 };
    for (const a of day.filter((x) => x.status === 'SCHEDULED')) {
      const roll = r();
      try {
        if (roll < 0.08) { await call(ADMIN, 'POST', `/appointments/${a.id}/cancel`, { cancelReason: pick(r, CANCEL_REASONS), version: a.version }); c.cancelled++; }
        else if (roll < 0.14) { if (await rescheduleFar(a)) c.moved++; }
        else if (roll < 0.19) { await call(ADMIN, 'POST', `/appointments/${a.id}/no-show`, { version: a.version }, [200, 201]); c.noShow++; }
      } catch { /* bỏ qua */ }
    }
    log(`Lịch hẹn ${date}: ${c.cancelled} huỷ, ${c.moved} dời, ${c.noShow} không đến.`);
  }
}

// Mỗi bác sĩ khám một người một lúc: nếu có nhiều người đang khám thì hoàn tất những người bắt đầu sớm hơn.
async function normalizeDoing(doctors) {
  const items = (await getAll(ADMIN, `/reception/list?date=${TODAY}`)).filter((e) => e.status === 'IN_CONSULTATION');
  const r = rng(`chuan-hoa-${TODAY}`);
  for (const d of doctors) {
    const mine = items.filter((e) => e.doctorId === d.id).sort((a, b) => String(a.startedAt ?? a.checkedInAt).localeCompare(String(b.startedAt ?? b.checkedInAt)));
    for (const e of mine.slice(0, -1)) {
      const u = DOCTOR_USER[d.displayName];
      const dx = pick(r, DEPT[d.dept].dx);
      try {
        await call(u, 'PUT', `/encounters/${e.encounterId}/diagnoses`, { diagnoses: [{ icd10Code: dx[0], type: 'PRIMARY' }] });
        await call(u, 'PUT', `/encounters/${e.encounterId}/clinical-note`, NOTE_BY_DEPT(e.chiefComplaint ?? 'Khám theo triệu chứng', dx[1]));
        const c = await get(u, `/encounters/${e.encounterId}/consultation`);
        await call(u, 'POST', `/encounters/${e.encounterId}/complete`, { version: (c.encounter ?? c).version });
        log('Đã hoàn tất lượt đang khám dư của', d.displayName);
      } catch (err) { log('  (không hoàn tất được)', err.message.slice(0, 140)); }
    }
  }
}

// Bổ sung người chờ khám cho tới khi mỗi bác sĩ có đủ `--waiting` người (giờ tiếp nhận trong 45 phút gần đây).
async function topUpWaiting(doctors, patients) {
  const items = await getAll(ADMIN, `/reception/list?date=${TODAY}`);
  const r = rng(`cho-kham-${TODAY}-${items.length}`);
  const used = new Set(items.map((e) => e.patientId));
  const idByPhone = new Map(patients.map((p) => [p.phone, p.id]));
  (await getAll(ADMIN, `/appointments?date=${TODAY}`)).forEach((a) => { const id = idByPhone.get(a.phone); if (id) used.add(id); });
  const base = { isPriority: false, allowsDeferredPayment: false, patientSourceCode: 'TU_DEN', examFormCode: 'THUONG' };
  let added = 0;
  for (const d of doctors) {
    const waiting = items.filter((e) => e.doctorId === d.id && e.status === 'CHECKED_IN').length;
    for (let i = waiting; i < WAITING_PER_DOCTOR; i++) {
      const p = poolFor(d.dept, patients, used, r)[0];
      if (!p) break;
      used.add(p.id);
      const reason = pick(r, DEPT[d.dept].reasons);
      const reg = await call(ADMIN, 'POST', '/reception/direct', { ...base, receptionTypeCode: r() < 0.25 ? 'TAI_KHAM' : 'KHAM_MOI', patientId: p.id, checkedInAt: new Date(NOW.getTime() - int(r, 3, 45) * 60_000).toISOString(), chiefComplaint: reason, doctorId: d.id, services: SERVICE(d.dept), ...vitalsFor(r, p) });
      await pay(reg.encounterId ?? reg.id ?? reg.encounter?.id);
      added++;
    }
  }
  log(`Hàng chờ khám: bổ sung ${added} người (mỗi bác sĩ tối thiểu ${WAITING_PER_DOCTOR} người chờ).`);
}

// ---------- chạy ----------
log(`Dựng dữ liệu mẫu: hôm nay ${TODAY} ${toHHMM(NOW_MIN)} · ${DAYS} ngày lịch hẹn · ${TARGET_PATIENTS} bệnh nhân`);
await ensureStaff();
let patients = await ensurePatients(await loadPatients());
await fixFutureBirthdays(patients);
await ensureExamTypes();
const doctors = await loadStaff();
const dates = Array.from({ length: DAYS + 2 }, (_, i) => addDays(TODAY, i));
await ensureShifts(doctors, dates);
await closePending(doctors);
await seedAppointments(doctors, patients, dates.slice(0, DAYS));
if (WITH_RECEPTION) {
  await settleTodayAppointments(doctors, patients);
  await seedReception(doctors, patients);
  await normalizeDoing(doctors);
  await topUpWaiting(doctors, patients);
}
await diversifyFutureDays(dates.slice(0, DAYS));
log('Xong. Đăng nhập bằng tài khoản toàn quyền: giamdoc / ' + PASSWORD);
