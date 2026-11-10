/* global console */
// GIAI ĐOẠN 3 — 80 hồ sơ bệnh nhân (tên Việt thông dụng, địa chỉ thật theo danh mục tỉnh/phường, CCCD đúng cấu trúc 12 số, người nhà cho trẻ em). Xác định (cùng hạt giống → cùng dữ liệu). Chạy lại thì bỏ qua người đã có.
const fs = require('fs');
const { state, call, login } = require('./hh-lib.cjs');
const list = async (p) => { const d = await call('GET', p); return d.items || d; };
const TOTAL = Number(process.env.HH_N || 80);

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20261109);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const weighted = (pairs) => { const total = pairs.reduce((s, p) => s + p[1], 0); let r = rand() * total; for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; } return pairs[0][0]; };

const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const FAMILY = [['Nguyễn', 30], ['Trần', 14], ['Lê', 10], ['Phạm', 8], ['Hoàng', 5], ['Huỳnh', 5], ['Phan', 4], ['Vũ', 4], ['Võ', 4], ['Đặng', 4], ['Bùi', 3], ['Đỗ', 3], ['Hồ', 2], ['Ngô', 2], ['Dương', 1], ['Lý', 1]];
const MID = { male: ['Văn', 'Hữu', 'Quốc', 'Minh', 'Đức', 'Thanh', 'Công', 'Gia', 'Anh', 'Trọng', 'Hoàng', 'Tuấn'], female: ['Thị', 'Ngọc', 'Thu', 'Kim', 'Mai', 'Thanh', 'Bích', 'Hoài', 'Phương', 'Diệu', 'Khánh', 'Hồng'] };
const GIVEN = {
  male: ['Hùng', 'Dũng', 'Nam', 'Phong', 'Khoa', 'Tuấn', 'Bình', 'Hải', 'Long', 'Sơn', 'Thắng', 'Việt', 'Trung', 'Khang', 'Đạt', 'Hiếu', 'Phúc', 'Lộc', 'Tài', 'Quân', 'Huy', 'Toàn', 'Kiệt', 'Nghĩa', 'Thịnh', 'Tâm', 'Hoàng', 'Bảo'],
  female: ['Lan', 'Hoa', 'Linh', 'Trang', 'Hương', 'Nhung', 'Thảo', 'Hạnh', 'Ngân', 'Vy', 'Yến', 'Nga', 'Phượng', 'Uyên', 'Trâm', 'Nhi', 'Châu', 'My', 'Oanh', 'Dung', 'Hằng', 'Quyên', 'Thủy', 'Loan', 'Tâm', 'Anh', 'Ngọc', 'Chi'],
};
const STREETS = ['Nguyễn Đình Chiểu', 'Cách Mạng Tháng Tám', 'Lý Chính Thắng', 'Trần Quốc Thảo', 'Võ Văn Tần', 'Nam Kỳ Khởi Nghĩa', 'Điện Biên Phủ', 'Hai Bà Trưng', 'Nguyễn Thị Minh Khai', 'Lê Văn Sỹ', 'Phan Đăng Lưu', 'Hoàng Văn Thụ', 'Trường Chinh', 'Cộng Hòa', 'Lý Thái Tổ', 'Sư Vạn Hạnh', 'Nguyễn Văn Cừ', 'Trần Hưng Đạo', 'Lê Quang Định', 'Bạch Đằng', 'Nguyễn Trãi', 'Pasteur', 'Võ Thị Sáu', 'Huỳnh Văn Bánh', 'Phan Xích Long', 'Nguyễn Kiệm', 'Lê Văn Việt', 'Đinh Tiên Hoàng', 'Nơ Trang Long', 'Xô Viết Nghệ Tĩnh'];
const MOBILE = ['090', '093', '089', '070', '079', '077', '076', '078', '091', '094', '088', '083', '084', '085', '081', '082', '097', '098', '096', '086', '032', '033', '034', '035', '036', '037', '038', '039'];
const PROVINCE_ID = { 'Thành phố Hồ Chí Minh': '079', 'Thành phố Hà Nội': '001', 'Tỉnh Đồng Nai': '075', 'Thành phố Cần Thơ': '092', 'Tỉnh Tây Ninh': '072', 'Thành phố Đà Nẵng': '048', 'Tỉnh Khánh Hòa': '056', 'Tỉnh Nghệ An': '040' };
const pad = (n, l = 2) => String(n).padStart(l, '0');
const phone = () => `${pick(MOBILE)}${pad(between(0, 9999999), 7)}`;

(async () => {
  state.token = (await login('letan.thuha', 'HoaHung@2026')).accessToken;
  const provinces = await list('/geo/provinces');
  const hcm = provinces.find((p) => p.name === 'Thành phố Hồ Chí Minh');
  const wardsHcm = (await list(`/geo/wards?provinceCode=${hcm.code}`)).map((w) => w.name);
  const others = {};
  for (const n of ['Tỉnh Đồng Nai', 'Thành phố Cần Thơ', 'Tỉnh Tây Ninh', 'Thành phố Hà Nội']) {
    const p = provinces.find((x) => x.name === n);
    if (p) others[n] = (await list(`/geo/wards?provinceCode=${p.code}`)).map((w) => w.name);
  }
  const occ = (await list('/reference-catalog/OCCUPATION')).map((o) => o.code);
  const adminTok = state.token;
  // Dị nguyên (danh mục) để gán cho một số hồ sơ — tạo bằng tài khoản quản lý
  state.token = (await login('hoangnam', 'HoaHung@2026')).accessToken;
  const groups = await list('/allergen-groups');
  const gDrug = groups.find((g) => g.name === 'Thuốc') || (await call('POST', '/allergen-groups', { name: 'Thuốc' }));
  const gFood = groups.find((g) => g.name === 'Thực phẩm') || (await call('POST', '/allergen-groups', { name: 'Thực phẩm' }));
  const al = await list('/allergens');
  const allergen = {};
  for (const [n, g] of [['Penicillin', gDrug], ['Sulfonamid', gDrug], ['Aspirin', gDrug], ['Hải sản', gFood], ['Đậu phộng', gFood]]) {
    allergen[n] = (al.find((a) => a.name === n) || (await call('POST', '/allergens', { allergenGroupId: g.id, name: n }))).id;
  }
  state.token = adminTok;

  const existing = new Set();
  for (let page = 1; page <= 3; page += 1) {
    const d = await call('GET', `/patients?limit=100`).catch(() => ({ items: [] }));
    for (const p of d.items || []) existing.add(p.fullName);
    break;
  }
  const today = new Date();
  const ageBands = [['child', 12, 1, 12], ['teen', 6, 13, 17], ['adult', 48, 18, 59], ['elder', 14, 60, 82]];
  const plan = [];
  for (const [band, n, lo, hi] of ageBands) for (let i = 0; i < n; i += 1) plan.push({ band, age: between(lo, hi) });
  const mixed = shuffle(plan.slice(0, TOTAL));
  plan.length = 0; mixed.forEach((m) => plan.push(m));
  const used = new Set(existing);
  const out = [];
  let created = 0;
  for (const slot of plan.slice(0, TOTAL)) {
    const gender = rand() < 0.48 ? 'male' : 'female';
    let name = '';
    for (let tries = 0; tries < 20; tries += 1) {
      name = `${weighted(FAMILY)} ${pick(MID[gender])} ${pick(GIVEN[gender])}`;
      if (!used.has(name)) break;
    }
    used.add(name);
    const bm = between(1, 12); const bd = between(1, 28);
    let birthYear = today.getFullYear() - slot.age;
    const hadBirthday = bm < today.getMonth() + 1 || (bm === today.getMonth() + 1 && bd <= today.getDate());
    if (!hadBirthday) birthYear -= 1;
    const dob = `${birthYear}-${pad(bm)}-${pad(bd)}`;
    const isHcm = rand() < 0.78;
    const provName = isHcm ? 'Thành phố Hồ Chí Minh' : pick(Object.keys(others));
    const ward = isHcm ? pick(wardsHcm) : pick(others[provName] || wardsHcm);
    const body = {
      fullName: name, dob, gender, phone: phone(),
      ethnicity: rand() < 0.96 ? '1' : '6', nationality: 'VNM', occupation: slot.band === 'child' ? undefined : (slot.band === 'teen' ? 'HSSV' : pick(occ)),
      address: { street: `${between(2, 480)}${rand() < 0.3 ? '/' + between(1, 40) : ''} ${pick(STREETS)}`, ward, province: provName },
    };
    if (slot.age >= 18) {
      const century = birthYear >= 2000 ? (gender === 'male' ? 2 : 3) : (gender === 'male' ? 0 : 1);
      body.nationalId = `${PROVINCE_ID[provName]}${century}${pad(birthYear % 100)}${pad(between(0, 999999), 6)}`;
      body.nationalIdIssuedAt = `${between(2021, 2025)}-${pad(between(1, 12))}-${pad(between(1, 28))}`;
      body.nationalIdIssuedPlace = 'Cục Cảnh sát quản lý hành chính về trật tự xã hội';
    } else {
      const parentGender = rand() < 0.6 ? 'female' : 'male';
      const family = name.split(' ')[0];
      body.relativeFullName = `${family} ${pick(MID[parentGender])} ${pick(GIVEN[parentGender])}`;
      body.relativeRelationship = parentGender === 'female' ? 'Mẹ' : 'Bố';
      body.relativePhone = phone();
      body.relativeAddress = `${body.address.street}, ${ward}, ${provName}`;
    }
    // Bệnh nền / dị ứng: người lớn tuổi hơn có tỷ lệ cao hơn
    if (slot.age >= 40 && rand() < 0.4) {
      const c = pick([['I10', 'Tăng huyết áp', 'đang dùng Amlodipin 5mg mỗi sáng'], ['E11', 'Đái tháo đường type 2', 'đang dùng Metformin 850mg'], ['E78', 'Rối loạn mỡ máu', 'đang dùng Atorvastatin 20mg']]);
      body.conditionCodes = [c[0]];
      body.personalHistory = `${c[1]} ${between(2, 9)} năm, ${c[2]}.`;
    } else if (slot.age < 18 && rand() < 0.15) {
      body.conditionCodes = ['J45'];
      body.personalHistory = 'Hen phế quản, thỉnh thoảng lên cơn khi thay đổi thời tiết.';
    }
    if (rand() < 0.12) {
      const a = pick(['Penicillin', 'Sulfonamid', 'Aspirin', 'Hải sản', 'Đậu phộng']);
      body.allergenIds = [allergen[a]];
      body.allergyNote = a === 'Penicillin' ? 'Nổi mề đay sau khi uống Penicillin.' : a === 'Hải sản' ? 'Nổi ban, ngứa sau khi ăn tôm, cua.' : `Dị ứng ${a.toLowerCase()}.`;
    }
    try {
      const p = await call('POST', '/patients', Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
      created += 1;
      out.push({ id: p.id, code: p.patientCode, fullName: name, dob, gender, age: slot.age, phone: body.phone, nationalId: body.nationalId || null });
    } catch (e) {
      console.log('✗', name, e.message.slice(0, 260));
      if (/conditionCodes|ICD|icd10/i.test(e.message)) { delete body.conditionCodes; }
    }
  }
  fs.writeFileSync('hh-patients.json', JSON.stringify(out, null, 1));
  console.log(`✓ đã tạo ${created}/${TOTAL} hồ sơ → hh-patients.json`);
})().catch((e) => { console.error('LỖI', e.message); process.exit(1); });
