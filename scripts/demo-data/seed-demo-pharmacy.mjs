#!/usr/bin/env node
/**
 * Mở rộng KHO THUỐC & VẬT TƯ của công ty "Phòng khám Đa khoa Hòa Hưng" để kê đơn/chụp ảnh: thêm ~60 thuốc theo đủ nhóm, vật tư y tế, các nhà cung cấp,
 * rồi nhập kho nhiều lô (có hạn dùng; vài lô sắp hết hạn, vài mặt hàng tồn thấp để hiện cảnh báo). Chỉ gọi API HTTP; chạy lại được (mặt hàng/nhà cung cấp đã có thì bỏ qua).
 *
 * Dùng:   node scripts/demo-data/seed-demo-pharmacy.mjs
 * Biến môi trường: DEMO_API, DEMO_TENANT_ID, DEMO_ADMIN_USER, DEMO_PASSWORD (giống seed-demo-clinic.mjs).
 */
import { randomUUID } from 'node:crypto';

const API = process.env.DEMO_API ?? 'http://localhost:3001/api/v1';
const TENANT = process.env.DEMO_TENANT_ID ?? '01a1c100-5884-7bdb-8558-0981f8cbf306';
const ADMIN = process.env.DEMO_ADMIN_USER ?? 'hoangnam';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'HoaHung@2026';

let token = '';
async function call(method, path, body, ok = [200, 201]) {
  if (!token) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT, username: ADMIN, password: PASSWORD }) });
    if (!r.ok) throw new Error(`Đăng nhập thất bại (${r.status}).`);
    token = (await r.json()).data.accessToken;
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!ok.includes(res.status)) { const e = new Error(`${method} ${path} → ${res.status} ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 320)}`); e.status = res.status; throw e; }
  return json?.data !== undefined ? json.data : json;
}
const get = (path) => call('GET', path);
const log = (...a) => console.log(...a);
const vnDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (date, n) => vnDate(new Date(new Date(`${date}T12:00:00+07:00`).getTime() + n * 86_400_000));
const TODAY = vnDate();
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

// Đơn vị: Viên, Gói, Tuýp, Lọ, Chai, Hộp, Cái
const U = { V: 'DV00003', G: 'DV00010', T: 'DV00008', L: 'DV00006', C: 'DV00007', H: 'DV00009', CAI: 'DV00001' };
const MFR = ['HS00006', 'HS00001', 'HS00003', 'HS00008', 'HS00007', 'HS00005', 'HS00004', 'HS00002'];

// [tên, [[hoạt chất, mg trên 1 đơn vị], ...], dạng bào chế, đơn vị, nhóm, đường dùng, giá nhập, giá bán, cách dùng, tồn tối thiểu]
const DRUGS = [
  // Kháng sinh
  ['Cefixim 200mg', [['Cefixim', 200]], 'F02', 'V', 'N01', 'U01', 4200, 6500, 'Uống sau ăn, ngày 2 lần', 100],
  ['Cefpodoxim 100mg', [['Cefpodoxim proxetil', 100]], 'F01', 'V', 'N01', 'U01', 5800, 8500, 'Uống trong bữa ăn', 100],
  ['Ciprofloxacin 500mg', [['Ciprofloxacin', 500]], 'F01', 'V', 'N01', 'U01', 1900, 3200, 'Uống sau ăn, uống nhiều nước', 100],
  ['Levofloxacin 500mg', [['Levofloxacin', 500]], 'F01', 'V', 'N01', 'U01', 3600, 5500, 'Uống cách xa bữa ăn 2 giờ', 100],
  ['Clarithromycin 500mg', [['Clarithromycin', 500]], 'F01', 'V', 'N01', 'U01', 6800, 9800, 'Uống sau ăn', 100],
  ['Metronidazol 250mg', [['Metronidazol', 250]], 'F01', 'V', 'N01', 'U01', 450, 900, 'Uống trong bữa ăn', 100],
  ['Doxycyclin 100mg', [['Doxycyclin', 100]], 'F02', 'V', 'N01', 'U01', 700, 1400, 'Uống sau ăn, không nằm ngay sau uống', 100],
  ['Amoxicillin 250mg gói', [['Amoxicillin', 250]], 'F06', 'G', 'N01', 'U01', 1500, 2600, 'Pha với nước, uống sau ăn', 100],
  // Giảm đau, hạ sốt, kháng viêm
  ['Paracetamol 250mg gói', [['Paracetamol', 250]], 'F06', 'G', 'N02', 'U01', 900, 1800, 'Pha với nước, cách nhau tối thiểu 4 giờ', 150],
  ['Meloxicam 7.5mg', [['Meloxicam', 7.5]], 'F01', 'V', 'N02', 'U01', 350, 800, 'Uống sau ăn no', 100],
  ['Celecoxib 200mg', [['Celecoxib', 200]], 'F02', 'V', 'N02', 'U01', 2200, 3800, 'Uống sau ăn', 100],
  ['Etoricoxib 60mg', [['Etoricoxib', 60]], 'F01', 'V', 'N02', 'U01', 3400, 5200, 'Uống sau ăn', 100],
  ['Naproxen 500mg', [['Naproxen', 500]], 'F01', 'V', 'N02', 'U01', 1300, 2400, 'Uống sau ăn no', 100],
  // Cơ xương khớp
  ['Eperison 50mg', [['Eperison hydroclorid', 50]], 'F01', 'V', 'N03', 'U01', 1100, 2200, 'Uống sau ăn', 100],
  ['Methocarbamol 500mg', [['Methocarbamol', 500]], 'F01', 'V', 'N03', 'U01', 900, 1900, 'Uống sau ăn', 100],
  ['Colchicin 1mg', [['Colchicin', 1]], 'F01', 'V', 'N03', 'U01', 600, 1200, 'Uống theo chỉ định, không tự tăng liều', 60],
  // Chống dị ứng
  ['Fexofenadin 180mg', [['Fexofenadin hydroclorid', 180]], 'F01', 'V', 'N04', 'U01', 2600, 4200, 'Uống một lần mỗi ngày', 100],
  ['Desloratadin 5mg', [['Desloratadin', 5]], 'F01', 'V', 'N04', 'U01', 1700, 3000, 'Uống một lần mỗi ngày', 100],
  ['Chlorpheniramin 4mg', [['Clorpheniramin maleat', 4]], 'F01', 'V', 'N04', 'U01', 80, 250, 'Uống tối, có thể gây buồn ngủ', 200],
  // Hô hấp
  ['Montelukast 10mg', [['Montelukast', 10]], 'F01', 'V', 'N07', 'U01', 3900, 6000, 'Uống buổi tối', 100],
  ['Ambroxol 30mg', [['Ambroxol hydroclorid', 30]], 'F01', 'V', 'N07', 'U01', 300, 700, 'Uống sau ăn', 150],
  ['Carbocistein 375mg', [['Carbocistein', 375]], 'F02', 'V', 'N07', 'U01', 1400, 2500, 'Uống sau ăn', 100],
  ['Dextromethorphan 15mg', [['Dextromethorphan hydrobromid', 15]], 'F01', 'V', 'N07', 'U01', 250, 600, 'Uống khi ho khan', 150],
  ['Terbutalin 2.5mg', [['Terbutalin sulfat', 2.5]], 'F01', 'V', 'N07', 'U01', 400, 900, 'Uống theo chỉ định', 100],
  // Tim mạch
  ['Bisoprolol 5mg', [['Bisoprolol fumarat', 5]], 'F01', 'V', 'N08', 'U01', 1200, 2300, 'Uống buổi sáng', 100],
  ['Nifedipin 20mg', [['Nifedipin', 20]], 'F01', 'V', 'N08', 'U01', 700, 1500, 'Uống sau ăn, không nghiền', 100],
  ['Perindopril 4mg', [['Perindopril arginin', 4]], 'F01', 'V', 'N08', 'U01', 2600, 4300, 'Uống buổi sáng trước ăn', 100],
  ['Telmisartan 40mg', [['Telmisartan', 40]], 'F01', 'V', 'N08', 'U01', 2800, 4600, 'Uống một lần mỗi ngày', 100],
  ['Rosuvastatin 10mg', [['Rosuvastatin calci', 10]], 'F01', 'V', 'N08', 'U01', 2900, 4800, 'Uống buổi tối', 100],
  ['Simvastatin 20mg', [['Simvastatin', 20]], 'F01', 'V', 'N08', 'U01', 900, 1800, 'Uống buổi tối', 100],
  ['Clopidogrel 75mg', [['Clopidogrel bisulfat', 75]], 'F01', 'V', 'N08', 'U01', 3100, 5000, 'Uống sau ăn, đều mỗi ngày', 100],
  ['Furosemid 40mg', [['Furosemid', 40]], 'F01', 'V', 'N08', 'U01', 250, 650, 'Uống buổi sáng', 100],
  ['Spironolacton 25mg', [['Spironolacton', 25]], 'F01', 'V', 'N08', 'U01', 900, 1800, 'Uống sau ăn', 100],
  ['Aspirin 81mg', [['Acid acetylsalicylic', 81]], 'F01', 'V', 'N08', 'U01', 450, 1000, 'Uống sau ăn no', 100],
  // Tiêu hoá
  ['Pantoprazol 40mg', [['Pantoprazol natri', 40]], 'F01', 'V', 'N09', 'U01', 2100, 3600, 'Uống trước ăn sáng 30 phút', 100],
  ['Lansoprazol 30mg', [['Lansoprazol', 30]], 'F02', 'V', 'N09', 'U01', 2400, 4000, 'Uống trước ăn 30 phút', 100],
  ['Rabeprazol 20mg', [['Rabeprazol natri', 20]], 'F01', 'V', 'N09', 'U01', 2700, 4400, 'Uống trước ăn 30 phút', 100],
  ['Sucralfat 1g gói', [['Sucralfat', 1000]], 'F06', 'G', 'N09', 'U01', 3300, 5200, 'Uống trước ăn 1 giờ', 100],
  ['Alverin 40mg', [['Alverin citrat', 40]], 'F01', 'V', 'N09', 'U01', 220, 600, 'Uống khi đau quặn bụng', 150],
  ['Simethicon 80mg', [['Simethicon', 80]], 'F03', 'V', 'N09', 'U01', 600, 1300, 'Nhai sau ăn', 100],
  ['Diosmectit 3g gói', [['Diosmectit', 3000]], 'F06', 'G', 'N09', 'U01', 2100, 3500, 'Pha với nước, uống xa các thuốc khác', 150],
  ['Racecadotril 100mg', [['Racecadotril', 100]], 'F02', 'V', 'N09', 'U01', 3600, 5600, 'Uống trước bữa ăn', 100],
  ['Oresol gói', [['Natri clorid', 3.5]], 'F06', 'G', 'N09', 'U01', 1200, 2500, 'Pha đúng lượng nước, uống từng ngụm', 150],
  // Nội tiết
  ['Glimepirid 2mg', [['Glimepirid', 2]], 'F01', 'V', 'N10', 'U01', 900, 1800, 'Uống cùng bữa ăn sáng', 100],
  ['Sitagliptin 50mg', [['Sitagliptin phosphat', 50]], 'F01', 'V', 'N10', 'U01', 8200, 12500, 'Uống một lần mỗi ngày', 60],
  ['Levothyroxin 100mcg', [['Levothyroxin natri', 0.1]], 'F01', 'V', 'N10', 'U01', 700, 1500, 'Uống lúc đói buổi sáng', 60],
  // Thần kinh, tiền đình
  ['Betahistin 16mg', [['Betahistin dihydroclorid', 16]], 'F01', 'V', 'N05', 'U01', 1300, 2400, 'Uống trong bữa ăn', 100],
  ['Flunarizin 5mg', [['Flunarizin dihydroclorid', 5]], 'F01', 'V', 'N05', 'U01', 500, 1100, 'Uống buổi tối', 100],
  ['Gabapentin 300mg', [['Gabapentin', 300]], 'F02', 'V', 'N05', 'U01', 1800, 3200, 'Uống theo chỉ định, không tự ngưng', 60],
  // Vitamin, khoáng chất
  ['Vitamin B1 + B6 + B12', [['Thiamin nitrat', 100], ['Pyridoxin hydroclorid', 200], ['Cyanocobalamin', 0.2]], 'F01', 'V', 'N15', 'U01', 700, 1500, 'Uống sau ăn', 150],
  ['Calci carbonat + Vitamin D3', [['Calci carbonat', 1250], ['Cholecalciferol', 0.003]], 'F01', 'V', 'N15', 'U01', 1400, 2600, 'Uống sau ăn', 100],
  ['Sắt fumarat + Acid folic', [['Sắt fumarat', 162], ['Acid folic', 0.75]], 'F02', 'V', 'N15', 'U01', 1100, 2200, 'Uống sau ăn, tránh uống cùng trà', 100],
  ['Acid folic 5mg', [['Acid folic', 5]], 'F01', 'V', 'N15', 'U01', 200, 500, 'Uống sau ăn', 100],
  ['Kẽm gluconat 70mg', [['Kẽm gluconat', 70]], 'F01', 'V', 'N15', 'U01', 800, 1600, 'Uống sau ăn', 100],
  // Tiết niệu
  ['Tamsulosin 0.4mg', [['Tamsulosin hydroclorid', 0.4]], 'F02', 'V', 'N16', 'U01', 2800, 4500, 'Uống sau bữa ăn tối', 60],
  // Dùng ngoài, tai mũi họng, mắt
  ['Betamethason 0.064% kem', [['Betamethason dipropionat', 0.64]], 'F12', 'T', 'N13', 'U13', 14000, 24000, 'Thoa mỏng ngày 2 lần', 30],
  ['Clotrimazol 1% kem', [['Clotrimazol', 10]], 'F12', 'T', 'N13', 'U13', 9500, 17000, 'Thoa vùng da bị bệnh ngày 2 lần', 30],
  ['Mupirocin 2% mỡ', [['Mupirocin', 20]], 'F12', 'T', 'N13', 'U13', 31000, 52000, 'Thoa ngày 2–3 lần, không quá 10 ngày', 30],
  ['Acyclovir 5% kem', [['Acyclovir', 50]], 'F12', 'T', 'N13', 'U13', 16000, 28000, 'Thoa ngày 5 lần', 30],
  ['Natri clorid 0.9% nhỏ mắt, mũi', [['Natri clorid', 9]], 'F11', 'L', 'N12', 'U07', 2800, 6000, 'Nhỏ 2–3 giọt mỗi lần', 60],
  ['Tobramycin 0.3% nhỏ mắt', [['Tobramycin', 3]], 'F11', 'L', 'N12', 'U07', 21000, 38000, 'Nhỏ 1–2 giọt, ngày 4 lần', 30],
  ['Xylometazolin 0.1% xịt mũi', [['Xylometazolin hydroclorid', 1]], 'F13', 'L', 'N12', 'U09', 18000, 32000, 'Xịt mỗi bên mũi 1–2 nhát, tối đa 5 ngày', 30],
];

// Vật tư y tế: [tên, đơn vị, giá nhập, giá bán (0 = chỉ dùng nội bộ), số đăng ký, tồn tối thiểu]
const SUPPLIES = [
  ['Găng tay y tế không bột (hộp 100 chiếc)', 'H', 95000, 0, 'GP-VT-0127', 10],
  ['Khẩu trang y tế 4 lớp (hộp 50 cái)', 'H', 38000, 0, 'GP-VT-0214', 10],
  ['Bơm tiêm vô trùng 5ml', 'CAI', 780, 0, 'GP-VT-0331', 200],
  ['Bông gòn y tế 100g', 'G', 21000, 0, 'GP-VT-0408', 10],
  ['Gạc vô trùng 10x10cm (gói 10 miếng)', 'G', 9500, 0, 'GP-VT-0415', 40],
  ['Băng keo cá nhân (hộp 100 miếng)', 'H', 42000, 65000, 'GP-VT-0522', 10],
  ['Cồn y tế 70 độ (chai 500ml)', 'C', 28000, 45000, 'GP-VT-0609', 10],
  ['Povidone iod 10% (chai 100ml)', 'C', 19000, 32000, 'GP-VT-0634', 10],
  ['Que thử đường huyết (hộp 50 que)', 'H', 210000, 290000, 'GP-VT-0718', 6],
  ['Đè lưỡi gỗ vô trùng (hộp 100 cái)', 'H', 32000, 0, 'GP-VT-0803', 6],
  ['Ống nghiệm EDTA (hộp 100 ống)', 'H', 85000, 0, 'GP-VT-0911', 6],
  ['Giấy in điện tim (cuộn)', 'CAI', 24000, 0, 'GP-VT-1004', 10],
];

const SUPPLIERS = [
  ['Công ty TNHH Dược phẩm Hoàng Gia', '0312984576', '028 3822 5416', '128 Nguyễn Thị Nghĩa, Phường Bến Thành, Thành phố Hồ Chí Minh', 'Chị Phạm Thu Hương'],
  ['Công ty Cổ phần Dược Sài Gòn Việt', '0309712458', '028 3930 7741', '47 Nguyễn Đình Chiểu, Phường Võ Thị Sáu, Thành phố Hồ Chí Minh', 'Anh Lê Quốc Bảo'],
  ['Công ty TNHH Phân phối Dược Minh Long', '0314025687', '028 3844 1206', '215 Lê Văn Sỹ, Phường Nhiêu Lộc, Thành phố Hồ Chí Minh', 'Chị Trần Ngọc Diệp'],
  ['Công ty TNHH Thiết bị Y tế Minh An', '0313557901', '028 3811 9032', '9 Hồ Văn Huê, Phường Phú Nhuận, Thành phố Hồ Chí Minh', 'Anh Võ Thanh Sơn'],
];
// nhóm thuốc → chỉ số nhà cung cấp trong danh sách (0 = Nam Phương có sẵn)
const GROUP_SUPPLIER = { N01: 'NP', N08: 'NP', N02: 0, N03: 0, N04: 0, N07: 0, N09: 1, N10: 1, N15: 1, N16: 1, N05: 2, N12: 2, N13: 2 };

// ---------- chạy ----------
log(`Mở rộng kho thuốc & vật tư · hôm nay ${TODAY}`);
const warehouse = (await get('/warehouses')).items[0];

// 1) Nhà cung cấp
const supplierList = (await get('/suppliers?limit=100')).items;
const supplierIds = {};
supplierIds.NP = supplierList.find((s) => s.code === 'NCC00001' || s.name.includes('Nam Phương'))?.id;
const ensureSupplier = async (s) => {
  const found = supplierList.find((x) => x.name === s[0]);
  if (found) return found.id;
  const c = await call('POST', '/suppliers', { name: s[0], taxCode: s[1], phone: s[2], address: s[3], contactName: s[4] });
  log('Đã thêm nhà cung cấp', s[0]);
  return c.id;
};
const extraIds = [];
for (const s of SUPPLIERS) extraIds.push(await ensureSupplier(s));
supplierIds[0] = extraIds[0]; supplierIds[1] = extraIds[1]; supplierIds[2] = extraIds[2]; supplierIds.SUP = extraIds[3];

// 2) Hoạt chất còn thiếu
const ingredientCatalog = (await get('/reference-catalog/ACTIVE_INGREDIENT?includeInactive=true')).items;
const ingCode = new Map(ingredientCatalog.map((i) => [i.name.toLowerCase(), i.code]));
let nextIng = Math.max(0, ...ingredientCatalog.map((i) => Number(i.code.replace(/\D/g, '')) || 0)) + 1;
const needIng = [...new Set(DRUGS.flatMap((d) => d[1].map((x) => x[0])))];
for (const name of needIng) {
  if (ingCode.has(name.toLowerCase())) continue;
  const code = `HC${String(nextIng++).padStart(5, '0')}`;
  await call('POST', '/reference-catalog', { category: 'ACTIVE_INGREDIENT', code, name, sortOrder: 0 }, [200, 201]);
  ingCode.set(name.toLowerCase(), code);
}
log(`Hoạt chất: ${ingCode.size} mục.`);

// 3) Thuốc + vật tư
const existing = (await call('GET', '/drugs?limit=100')).items;
let cursor = existing.length === 100 ? existing[existing.length - 1].id : null;
const allExisting = [...existing];
while (cursor) { const p = await call('GET', `/drugs?limit=100&cursor=${cursor}`); allExisting.push(...p.items); cursor = p.items.length === 100 ? p.items[p.items.length - 1].id : null; }
const byName = new Map(allExisting.map((d) => [d.name.toLowerCase(), d]));
const created = [];
let idx = 0;
for (const [name, ings, form, unit, group, route, cost, sell, usage, min] of DRUGS) {
  idx++;
  if (byName.has(name.toLowerCase())) continue;
  const body = {
    name, itemType: 'MEDICINE', isBatchManaged: true, baseUnitCode: U[unit], defaultSellPrice: sell, drugGroupCode: group, routeCode: route,
    manufacturerCode: MFR[idx % MFR.length], minStockAlert: min, controlType: 'NORMAL', isPrescriptionOnly: !['N12', 'N13', 'N15'].includes(group),
    isSplittable: !['F02', 'F06', 'F12', 'F11', 'F13'].includes(form), registrationNumber: `VD-${20000 + idx * 137}-${19 + (idx % 6)}`, dosageForm: form, countryOfOrigin: 'QG00001',
    usageInstruction: usage, ingredients: ings.map(([n, mg]) => ({ activeIngredientCode: ingCode.get(n.toLowerCase()), strengthValue: Math.round(mg * 1000), strengthUnitCode: 'MG' })),
  };
  try { const d = await call('POST', '/drugs', body); created.push({ ...d, _cost: cost, _group: group, _min: min }); }
  catch (e) { log('  (không tạo được thuốc)', name, e.message.slice(0, 200)); }
}
log(`Thuốc: đã thêm ${created.length} mặt hàng mới.`);
const supplyGroup = 'CONSUMABLE';
let sIdx = 0;
const createdSupplies = [];
for (const [name, unit, cost, sell, reg, min] of SUPPLIES) {
  sIdx++;
  if (byName.has(name.toLowerCase())) continue;
  const body = { name, itemType: 'SUPPLY', isBatchManaged: true, baseUnitCode: U[unit], drugGroupCode: supplyGroup, manufacturerCode: MFR[(sIdx + 3) % MFR.length], minStockAlert: min, registrationNumber: reg, supplyUsageNature: 'SINGLE_USE', internalUseOnly: sell === 0, ...(sell ? { defaultSellPrice: sell } : {}) };
  try { const d = await call('POST', '/drugs', body); createdSupplies.push({ ...d, _cost: cost, _group: 'SUP', _min: min }); }
  catch (e) { log('  (không tạo được vật tư)', name, e.message.slice(0, 200)); }
}
log(`Vật tư: đã thêm ${createdSupplies.length} mặt hàng mới.`);

// 4) Nhập kho: mỗi nhà cung cấp một phiếu, lô có hạn dùng thật
const lot = (name, n) => `${strip(name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}${String(24 + (n % 2)).padStart(2, '0')}${String(1 + ((n * 5) % 12)).padStart(2, '0')}${'ABC'[n % 3]}`;
const expiryFor = (n) => `${2027 + (n % 2)}-${String(1 + ((n * 7) % 12)).padStart(2, '0')}-${String(10 + ((n * 3) % 18)).padStart(2, '0')}`;
const groups = {};
[...created, ...createdSupplies].forEach((d, n) => {
  const sup = d._group === 'SUP' ? supplierIds.SUP : supplierIds[GROUP_SUPPLIER[d._group]] ?? supplierIds.NP;
  (groups[sup] ??= []).push({ d, n });
});
let receipts = 0;
for (const [supplierId, items] of Object.entries(groups)) {
  const lines = items.map(({ d, n }) => {
    const low = n % 11 === 3; // vài mặt hàng nhập ít, dưới mức tồn tối thiểu
    const qty = low ? Math.max(5, Math.floor(d._min * 0.45)) : d._min * (6 + (n % 6)) ;
    return { drugId: d.id, unitCode: d.baseUnitCode, quantity: qty, unitCost: d._cost, batchNo: lot(d.name, n), expiryDate: expiryFor(n) };
  });
  for (let i = 0; i < lines.length; i += 25) {
    const r = await call('POST', '/inventory/receipts', { warehouseId: warehouse.id, supplierId, receiptType: 'PURCHASE', occurredAt: new Date(Date.now() - (3 + receipts) * 86_400_000).toISOString(), note: 'Nhập hàng theo đơn đặt', supplierInvoiceNo: `HD${String(4300 + receipts * 17)}`, lines: lines.slice(i, i + 25) });
    await call('POST', `/inventory/receipts/${r.id}/approve`, { version: r.version }, [200, 201]);
    receipts++;
  }
}
log(`Phiếu nhập: đã lập và duyệt ${receipts} phiếu.`);

// 5) Vài lô sắp hết hạn của thuốc có sẵn (để trang "Cảnh báo hạn dùng" có dữ liệu) — chỉ làm khi chưa có
const warn = await get('/inventory/expiry-warnings?limit=50');
if ((warn.expiringSoonCount ?? 0) < 4) {
  const pick = ['Paracetamol 500mg', 'Ibuprofen 400mg', 'Vitamin C 500mg', 'Loperamid 2mg', 'Cetirizin 10mg', 'Amoxicillin 500mg'];
  const lines = pick.map((n) => byName.get(n.toLowerCase())).filter(Boolean).map((d, i) => ({ drugId: d.id, unitCode: d.baseUnitCode, quantity: 120 + i * 40, unitCost: Math.max(100, Math.round((d.lastPurchaseUnitCost ?? 500))), batchNo: `LH25${String(4 + i).padStart(2, '0')}${'AB'[i % 2]}`, expiryDate: addDays(TODAY, 5 + i * 5) }));
  if (lines.length) {
    const r = await call('POST', '/inventory/receipts', { warehouseId: warehouse.id, supplierId: supplierIds.NP, receiptType: 'PURCHASE', occurredAt: new Date(Date.now() - 40 * 86_400_000).toISOString(), note: 'Nhập bổ sung', supplierInvoiceNo: 'NP-0098', lines });
    await call('POST', `/inventory/receipts/${r.id}/approve`, { version: r.version }, [200, 201]);
    log(`Đã nhập ${lines.length} lô sắp hết hạn.`);
  }
}
const bal = (await get('/inventory/balances?limit=100')).items;
log(`Xong. Tồn kho hiện có ${bal.length}+ mặt hàng (trang đầu).`);
