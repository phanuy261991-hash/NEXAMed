/* global console */
// GIAI ĐOẠN 1 — nền của Phòng khám Đa khoa Hòa Hưng: hồ sơ phòng khám, chi nhánh, khoa/phòng, ca làm việc, danh mục dùng chung, nhân sự. Chạy lại được (bỏ qua mục đã có).
const { state, call, raw, login } = require('./hh-lib.cjs');
const ADMIN = ['hoangnam', 'HoaHung@2026'];
const STAFF_PASSWORD = 'HoaHung@2026';

(async () => {
  state.token = (await login(...ADMIN)).accessToken;

  // 1. Hồ sơ phòng khám + chi nhánh
  const profile = await call('GET', '/clinic-profile');
  await call('PATCH', '/clinic-profile', {
    version: profile.version,
    name: 'Phòng khám Đa khoa Hòa Hưng',
    phone: '028 3930 4417',
    email: 'lienhe@phongkhamhoahung.vn',
    website: 'www.phongkhamhoahung.vn',
    address: '86 Nguyễn Đình Chiểu, Phường Võ Thị Sáu, Thành phố Hồ Chí Minh',
    taxCode: '0316482957',
    licenseNo: '0412/SYT-GPHĐ',
    facilityCode: '79231',
    professionalInChargeName: 'BS.CKI Nguyễn Thanh Phong',
    bankName: 'Ngân hàng TMCP Á Châu (ACB)',
    bankAccountName: 'PHONG KHAM DA KHOA HOA HUNG',
    bankAccountNumber: '20418735',
  }).catch((e) => console.log('hồ sơ phòng khám:', e.message.slice(0, 200)));
  const branches = await call('GET', '/branches');
  const b0 = branches.items ? branches.items[0] : branches[0];
  await call('PATCH', `/branches/${b0.id}`, { version: b0.version, address: '86 Nguyễn Đình Chiểu, Phường Võ Thị Sáu, Thành phố Hồ Chí Minh', phone: '028 3930 4417', facilityCode: '79231' }).catch((e) => console.log('chi nhánh:', e.message.slice(0, 200)));
  console.log('✓ hồ sơ phòng khám + chi nhánh');

  const list = async (p) => { const d = await call('GET', p); return d.items || d; };
  const ensureByName = async (listPath, createPath, body, extra = {}) => {
    const rows = await list(listPath);
    const found = rows.find((r) => r.name === body.name);
    if (found) return found;
    return call('POST', createPath, { ...body, ...extra });
  };

  // 2. Khoa / phòng / tầng
  const depts = {};
  for (const n of ['Khoa Khám bệnh', 'Khoa Nội tổng quát', 'Khoa Nhi', 'Khoa Tai Mũi Họng', 'Khoa Xét nghiệm', 'Khoa Chẩn đoán hình ảnh']) {
    const d = await ensureByName('/departments', '/departments', { name: n, participatesInQueue: !/Xét nghiệm|hình ảnh/.test(n) });
    depts[n] = d.id;
  }
  const floors = {};
  for (const n of ['Tầng trệt', 'Tầng 1']) floors[n] = (await ensureByName('/floors', '/floors', { name: n })).id;
  const rooms = {};
  for (const [n, f] of [['Phòng khám Nội 1', 'Tầng trệt'], ['Phòng khám Nhi', 'Tầng trệt'], ['Phòng khám Tai Mũi Họng', 'Tầng 1'], ['Phòng siêu âm', 'Tầng 1'], ['Phòng xét nghiệm', 'Tầng trệt'], ['Phòng X-quang', 'Tầng 1']]) {
    rooms[n] = (await ensureByName('/rooms', '/rooms', { name: n, floorId: floors[f] })).id;
  }
  console.log('✓ khoa/phòng/tầng', Object.keys(depts).length, Object.keys(rooms).length);

  // 3. Ca làm việc
  for (const s of [
    { name: 'Ca sáng', startTime: '07:30', endTime: '11:30', color: 'teal', sortOrder: 1 },
    { name: 'Ca chiều', startTime: '13:30', endTime: '17:30', color: 'amber', sortOrder: 2 },
    { name: 'Ca tối', startTime: '17:30', endTime: '20:00', color: 'blue', sortOrder: 3 },
  ]) await ensureByName('/work-shifts', '/work-shifts', s);

  // 4. Danh mục dùng chung
  const cat = async (category, names, extra = (n) => ({})) => {  // extra(n) có thể trả { code }
    const existing = await list(`/reference-catalog/${category}`);
    const out = {};
    for (const n of names) {
      const f = existing.find((r) => r.name === n);
      out[n] = f ? f : await call('POST', '/reference-catalog', { category, name: n, ...extra(n) });
    }
    return out;
  };
  await cat('RECEPTION_TYPE', ['Khám mới', 'Tái khám', 'Khám theo hẹn'], (n) => ({ code: { 'Khám mới': 'KHAM_MOI', 'Tái khám': 'TAI_KHAM', 'Khám theo hẹn': 'THEO_HEN' }[n] }));
  await cat('EXAM_FORM', ['Khám thường', 'Khám theo yêu cầu'], (n) => ({ code: { 'Khám thường': 'THUONG', 'Khám theo yêu cầu': 'THEO_YEU_CAU' }[n] }));
  await cat('PATIENT_SOURCE', ['Tự đến', 'Người quen giới thiệu', 'Đặt hẹn qua điện thoại', 'Đặt hẹn trực tuyến'], (n) => ({ code: { 'Tự đến': 'TU_DEN', 'Người quen giới thiệu': 'GIOI_THIEU', 'Đặt hẹn qua điện thoại': 'HEN_DIEN_THOAI', 'Đặt hẹn trực tuyến': 'HEN_TRUC_TUYEN' }[n] }));
  await cat('STAFF_POSITION', ['Bác sĩ', 'Điều dưỡng', 'Lễ tân - Thu ngân', 'Kỹ thuật viên xét nghiệm']);
  await cat('ACADEMIC_TITLE', ['Bác sĩ', 'Bác sĩ chuyên khoa I', 'Thạc sĩ - Bác sĩ', 'Điều dưỡng']);
  await cat('SPECIMEN_TYPE', ['Máu toàn phần (EDTA)', 'Huyết thanh', 'Nước tiểu']);
  await cat('MANUFACTURER', ['Dược Hậu Giang', 'Traphaco', 'Imexpharm', 'Stada Việt Nam', 'Sanofi Việt Nam', 'Domesco', 'Pymepharco', 'Mekophar']);
  const units = {};
  for (const u of await list('/reference-catalog/UNIT')) units[u.name] = u.code;
  for (const need of ['Lượt', 'Hộp', 'Vỉ', 'Chai', 'Gói', 'Tuýp']) {
    if (!units[need]) units[need] = (await call('POST', '/reference-catalog', { category: 'UNIT', name: need })).code;
  }
  console.log('✓ danh mục dùng chung; đơn vị:', JSON.stringify(Object.fromEntries(['Lượt', 'Viên', 'Hộp', 'Vỉ', 'Chai', 'Gói', 'Tuýp', 'Ống', 'Lọ'].map((k) => [k, units[k]]))));

  // 5. Dịch vụ khám (EXAM_TYPE) + giá
  const examTypes = {};
  const existingEx = await list('/reference-catalog/EXAM_TYPE');
  for (const [n, price, code] of [['Khám Nội tổng quát', 150000, 'KHAM_NOI'], ['Khám Nhi', 150000, 'KHAM_NHI'], ['Khám Tai Mũi Họng', 150000, 'KHAM_TMH'], ['Tái khám', 80000, 'TAI_KHAM_DV']]) {
    const f = existingEx.find((r) => r.name === n);
    examTypes[n] = f || (await call('POST', '/reference-catalog', { category: 'EXAM_TYPE', code, name: n, examTypePrices: [{ priceTypeCode: 'THUONG', unitCode: units['Lượt'], amount: price, effectiveFrom: '2026-01-01' }] }));
  }
  console.log('✓ dịch vụ khám', Object.keys(examTypes).join(', '));

  // 6. Nhân sự
  const roles = Object.fromEntries((await list('/roles')).map((r) => [r.name, r.id]));
  const existingUsers = await list('/users');
  const staff = [
    { username: 'bs.thanhphong', fullName: 'Nguyễn Thanh Phong', displayName: 'BS. Thanh Phong', role: 'doctor', gender: 'male', dob: '1978-04-12', phone: '0903 217 458', licenseNo: '0034521/HCM-CCHN', dept: 'Khoa Nội tổng quát', room: 'Phòng khám Nội 1', title: 'Bác sĩ chuyên khoa I', pos: 'Bác sĩ' },
    { username: 'bs.maianh', fullName: 'Trần Thị Mai Anh', displayName: 'BS. Mai Anh', role: 'doctor', gender: 'female', dob: '1984-09-23', phone: '0918 442 760', licenseNo: '0041873/HCM-CCHN', dept: 'Khoa Nhi', room: 'Phòng khám Nhi', title: 'Bác sĩ chuyên khoa I', pos: 'Bác sĩ' },
    { username: 'bs.quocviet', fullName: 'Phạm Quốc Việt', displayName: 'BS. Quốc Việt', role: 'doctor', gender: 'male', dob: '1981-01-30', phone: '0937 589 124', licenseNo: '0052296/HCM-CCHN', dept: 'Khoa Tai Mũi Họng', room: 'Phòng khám Tai Mũi Họng', title: 'Thạc sĩ - Bác sĩ', pos: 'Bác sĩ' },
    { username: 'letan.thuha', fullName: 'Đặng Thu Hà', displayName: 'Thu Hà', role: 'receptionist', gender: 'female', dob: '1993-06-18', phone: '0978 305 612', dept: 'Khoa Khám bệnh', pos: 'Lễ tân - Thu ngân' },
    { username: 'letan.ngoctram', fullName: 'Võ Ngọc Trâm', displayName: 'Ngọc Trâm', role: 'receptionist', gender: 'female', dob: '1996-11-05', phone: '0392 718 440', dept: 'Khoa Khám bệnh', pos: 'Lễ tân - Thu ngân' },
    { username: 'dd.kimngan', fullName: 'Lê Thị Kim Ngân', displayName: 'ĐD. Kim Ngân', role: 'nurse', gender: 'female', dob: '1990-02-14', phone: '0909 664 281', dept: 'Khoa Khám bệnh', pos: 'Điều dưỡng', title: 'Điều dưỡng' },
    { username: 'xn.minhkhang', fullName: 'Bùi Minh Khang', displayName: 'KTV. Minh Khang', role: 'lab_technician', gender: 'male', dob: '1991-08-09', phone: '0982 156 903', dept: 'Khoa Xét nghiệm', room: 'Phòng xét nghiệm', pos: 'Kỹ thuật viên xét nghiệm' },
  ];
  const positions = Object.fromEntries((await list('/reference-catalog/STAFF_POSITION')).map((r) => [r.name, r.code]));
  const titles = Object.fromEntries((await list('/reference-catalog/ACADEMIC_TITLE')).map((r) => [r.name, r.code]));
  const userIds = {};
  for (const s of staff) {
    const f = existingUsers.find((u) => u.username === s.username);
    if (f) { userIds[s.username] = f.id; continue; }
    const body = {
      username: s.username, password: STAFF_PASSWORD, fullName: s.fullName, displayName: s.displayName, phone: s.phone, gender: s.gender, dob: s.dob,
      email: `${s.username.replace(/\./g, '')}@phongkhamhoahung.vn`, mustChangePassword: false, roleIds: [roles[s.role]],
      departmentId: depts[s.dept], positionCode: positions[s.pos], employmentStatusCode: 'ACTIVE', employmentTypeCode: 'FULL_TIME',
      ...(s.room ? { defaultRoomId: rooms[s.room] } : {}), ...(s.licenseNo ? { licenseNo: s.licenseNo, licenseIssuedAt: '2012-07-20', licenseIssuedPlace: 'Sở Y tế Thành phố Hồ Chí Minh', canSignMedicalRecord: true } : {}),
      ...(s.title ? { academicTitleCode: titles[s.title] } : {}),
    };
    const u = await call('POST', '/users', body);
    userIds[s.username] = u.id;
  }
  console.log('✓ nhân sự', Object.keys(userIds).join(', '));
  console.log('XONG GIAI ĐOẠN 1');
})().catch((e) => { console.error('LỖI', e.message); process.exit(1); });
