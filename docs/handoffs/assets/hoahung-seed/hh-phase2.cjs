/* global console */
// GIAI ĐOẠN 2 — thuốc + nhập kho, nhà cung cấp, chỉ số xét nghiệm và dịch vụ kỹ thuật (xét nghiệm, siêu âm, X-quang, điện tim). Chạy lại được.
const { state, call, login } = require('./hh-lib.cjs');
const list = async (p) => { const d = await call('GET', p); return d.items || d; };

(async () => {
  state.token = (await login('hoangnam', 'HoaHung@2026')).accessToken;
  const unit = Object.fromEntries((await list('/reference-catalog/UNIT')).map((u) => [u.name, u.code]));
  const mf = Object.fromEntries((await list('/reference-catalog/MANUFACTURER')).map((m) => [m.name, m.code]));
  const group = Object.fromEntries((await list('/reference-catalog/DRUG_GROUP')).map((g) => [g.code, g.code]));

  // ---- Thuốc ----
  // [mã, tên, hoạt chất, hàm lượng, đơn vị cơ sở, nhóm, đường dùng, nhà sản xuất, giá bán, giá nhập, chỉ kê đơn, hướng dẫn]
  const DRUGS = [
    ['T0001', 'Paracetamol 500mg', 'Paracetamol', '500mg', 'Viên', 'N02', 'U01', 'Domesco', 600, 350, false, 'Uống sau ăn, cách nhau tối thiểu 4 – 6 giờ'],
    ['T0002', 'Ibuprofen 400mg', 'Ibuprofen', '400mg', 'Viên', 'N02', 'U01', 'Imexpharm', 1300, 800, false, 'Uống sau ăn no'],
    ['T0003', 'Diclofenac 50mg', 'Diclofenac natri', '50mg', 'Viên', 'N02', 'U01', 'Mekophar', 800, 450, true, 'Uống sau ăn no'],
    ['T0004', 'Amoxicillin 500mg', 'Amoxicillin', '500mg', 'Viên', 'N01', 'U01', 'Imexpharm', 1500, 900, true, 'Uống đủ liều, đủ ngày'],
    ['T0005', 'Amoxicillin + Acid clavulanic 625mg', 'Amoxicillin + Acid clavulanic', '500mg + 125mg', 'Viên', 'N01', 'U01', 'Pymepharco', 7000, 4800, true, 'Uống đầu bữa ăn'],
    ['T0006', 'Azithromycin 500mg', 'Azithromycin', '500mg', 'Viên', 'N01', 'U01', 'Pymepharco', 9500, 6200, true, 'Uống xa bữa ăn'],
    ['T0007', 'Cefuroxim 500mg', 'Cefuroxim axetil', '500mg', 'Viên', 'N01', 'U01', 'Stada Việt Nam', 8500, 5600, true, 'Uống sau ăn'],
    ['T0008', 'Cetirizin 10mg', 'Cetirizin dihydroclorid', '10mg', 'Viên', 'N04', 'U01', 'Stada Việt Nam', 1200, 650, false, 'Uống vào buổi tối'],
    ['T0009', 'Loratadin 10mg', 'Loratadin', '10mg', 'Viên', 'N04', 'U01', 'Imexpharm', 1000, 550, false, 'Uống 1 viên mỗi ngày'],
    ['T0010', 'Omeprazol 20mg', 'Omeprazol', '20mg', 'Viên', 'N09', 'U01', 'Mekophar', 1800, 1000, true, 'Uống trước bữa ăn sáng 30 phút'],
    ['T0011', 'Esomeprazol 40mg', 'Esomeprazol', '40mg', 'Viên', 'N09', 'U01', 'Dược Hậu Giang', 6500, 4300, true, 'Uống trước bữa ăn sáng 30 phút'],
    ['T0012', 'Domperidon 10mg', 'Domperidon', '10mg', 'Viên', 'N09', 'U01', 'Traphaco', 1100, 600, false, 'Uống trước bữa ăn 15 – 30 phút'],
    ['T0013', 'Loperamid 2mg', 'Loperamid hydroclorid', '2mg', 'Viên', 'N09', 'U01', 'Domesco', 700, 380, false, 'Uống khi đi ngoài phân lỏng'],
    ['T0014', 'Metformin 850mg', 'Metformin hydroclorid', '850mg', 'Viên', 'N10', 'U01', 'Stada Việt Nam', 1300, 700, true, 'Uống trong hoặc sau bữa ăn'],
    ['T0015', 'Gliclazid 80mg', 'Gliclazid', '80mg', 'Viên', 'N10', 'U01', 'Pymepharco', 1600, 900, true, 'Uống trước bữa ăn sáng'],
    ['T0016', 'Amlodipin 5mg', 'Amlodipin besilat', '5mg', 'Viên', 'N08', 'U01', 'Domesco', 1100, 600, true, 'Uống vào buổi sáng'],
    ['T0017', 'Losartan 50mg', 'Losartan kali', '50mg', 'Viên', 'N08', 'U01', 'Stada Việt Nam', 2200, 1300, true, 'Uống 1 lần mỗi ngày'],
    ['T0018', 'Atorvastatin 20mg', 'Atorvastatin calci', '20mg', 'Viên', 'N08', 'U01', 'Pymepharco', 2800, 1700, true, 'Uống vào buổi tối'],
    ['T0019', 'Prednisolon 5mg', 'Prednisolon', '5mg', 'Viên', 'N25', 'U01', 'Mekophar', 400, 220, true, 'Uống sau ăn sáng'],
    ['T0020', 'Bromhexin 8mg', 'Bromhexin hydroclorid', '8mg', 'Viên', 'N07', 'U01', 'Traphaco', 600, 320, false, 'Uống sau ăn'],
    ['T0021', 'Acetylcystein 200mg', 'Acetylcystein', '200mg', 'Gói', 'N07', 'U01', 'Dược Hậu Giang', 2500, 1500, false, 'Hòa tan với nửa ly nước rồi uống'],
    ['T0022', 'Cinnarizin 25mg', 'Cinnarizin', '25mg', 'Viên', 'N05', 'U01', 'Traphaco', 900, 480, false, 'Uống sau ăn, tránh lái xe sau khi dùng'],
    ['T0023', 'Vitamin C 500mg', 'Acid ascorbic', '500mg', 'Viên', 'N15', 'U01', 'Domesco', 700, 380, false, 'Uống sau ăn'],
    ['T0024', 'Salbutamol 2mg', 'Salbutamol sulfat', '2mg', 'Viên', 'N07', 'U01', 'Mekophar', 700, 380, true, 'Uống khi khó thở, tối đa 3 lần mỗi ngày'],
  ];
  // Hoạt chất (danh mục) + nước sản xuất + dạng bào chế
  const aiExisting = await list('/reference-catalog/ACTIVE_INGREDIENT');
  const aiCode = {};
  for (const row of DRUGS) {
    for (const nm of row[2].split(' + ')) {
      if (aiCode[nm]) continue;
      const f = aiExisting.find((x) => x.name === nm);
      aiCode[nm] = (f || (await call('POST', '/reference-catalog', { category: 'ACTIVE_INGREDIENT', name: nm }))).code;
    }
  }
  const countries = await list('/reference-catalog/COUNTRY_OF_ORIGIN');
  const vn = (countries.find((c) => /Việt Nam/.test(c.name)) || (await call('POST', '/reference-catalog', { category: 'COUNTRY_OF_ORIGIN', name: 'Việt Nam' }))).code;
  const FORM = { 'Viên': 'F01', 'Gói': 'F06' };
  const existing = await list('/drugs?limit=200');
  const drugIds = {};
  let seq = 0;
  for (const [code, name, ai, conc, base, grp, route, maker, price, cost, rx, usage] of DRUGS) {
    seq += 1;
    const concs = conc.split(' + ');
    const ingredients = ai.split(' + ').map((nm, i) => ({ activeIngredientCode: aiCode[nm], strengthValue: Math.round(parseFloat(concs[i].replace('mg', '').replace(',', '.')) * 1000), strengthUnitCode: 'MG' }));
    let d = existing.find((x) => x.code === code);
    if (!d) {
      d = await call('POST', '/drugs', {
        code, name, itemType: 'MEDICINE', isBatchManaged: true, baseUnitCode: unit[base], defaultSellPrice: price,
        manufacturerCode: mf[maker], manufacturer: maker, isPrescriptionOnly: rx, activeIngredient: ai, concentration: conc, usageInstruction: usage, ingredients, registrationNumber: `VD-${20100 + seq * 137}-${[16, 17, 18, 19, 20, 21][seq % 6]}`, dosageForm: base === 'Gói' ? 'F06' : (/Amoxicillin 500|Omeprazol|Esomeprazol|Acetylcystein/.test(name) ? 'F02' : 'F01'), countryOfOrigin: vn,
        ...(grp ? { drugGroupCode: grp } : {}), ...(route ? { routeCode: route } : {}), minStockAlert: 50,
      });
    }
    drugIds[code] = { id: d.id, base, cost, name };
  }
  console.log('✓ thuốc', Object.keys(drugIds).length);

  // ---- Nhà cung cấp + nhập kho ----
  const sup = (await list('/suppliers')).find((s) => s.name === 'Công ty TNHH Dược phẩm Nam Phương')
    || (await call('POST', '/suppliers', { name: 'Công ty TNHH Dược phẩm Nam Phương', taxCode: '0302147589', phone: '028 3847 2210', address: '212 Nguyễn Thị Minh Khai, Phường Xuân Hòa, Thành phố Hồ Chí Minh', contactName: 'Ông Trương Văn Hải' }));
  const wh = (await list('/warehouses'))[0];
  const stocked = await call('GET', `/inventory/receipts?limit=5`).then((d) => (d.items || d).length).catch(() => 0);
  if (stocked === 0) {
    const lines = Object.entries(drugIds).map(([code, d], i) => ({
      drugId: d.id, unitCode: unit[d.base], quantity: d.base === 'Viên' ? 1000 + (i % 4) * 500 : 400, unitCost: d.cost,
      batchNo: `${['2504', '2506', '2509', '2511'][i % 4]}${String(10 + i)}`, expiryDate: `${2027 + (i % 3)}-${String(3 + (i % 9)).padStart(2, '0')}-28`,
    }));
    const receipt = await call('POST', '/inventory/receipts', { warehouseId: wh.id, supplierId: sup.id, receiptType: 'PURCHASE', note: 'Nhập thuốc đầu kỳ', supplierInvoiceNo: 'NP-0014286', lines });
    await call('POST', `/inventory/receipts/${receipt.id}/approve`, { version: receipt.version });
    console.log('✓ nhập kho', lines.length, 'dòng');
  } else console.log('• đã có phiếu nhập, bỏ qua');

  // ---- Chỉ số xét nghiệm ----
  const idxExisting = await list('/lab-indicators');
  const R = (low, high, sex = 'ANY') => ({ sex, lowValue: low, highValue: high, lowInclusive: true, highInclusive: true });
  const INDICATORS = [
    ['WBC', 'Số lượng bạch cầu', 'G/L', 1, [R(4, 10)]],
    ['RBC', 'Số lượng hồng cầu', 'T/L', 2, [R(4.2, 5.9, 'MALE'), R(3.8, 5.2, 'FEMALE')]],
    ['HGB', 'Huyết sắc tố', 'g/L', 0, [R(130, 175, 'MALE'), R(120, 155, 'FEMALE')]],
    ['HCT', 'Hematocrit', '%', 1, [R(40, 52, 'MALE'), R(36, 47, 'FEMALE')]],
    ['PLT', 'Số lượng tiểu cầu', 'G/L', 0, [R(150, 400)]],
    ['GLU', 'Glucose', 'mmol/L', 1, [R(3.9, 6.4)]],
    ['HbA1c', 'HbA1c', '%', 1, [R(4, 6)]],
    ['AST', 'AST (GOT)', 'U/L', 0, [R(0, 40)]],
    ['ALT', 'ALT (GPT)', 'U/L', 0, [R(0, 40)]],
    ['UREA', 'Ure', 'mmol/L', 1, [R(2.5, 7.5)]],
    ['CREA', 'Creatinin', 'µmol/L', 0, [R(62, 106, 'MALE'), R(44, 80, 'FEMALE')]],
    ['CHOL', 'Cholesterol toàn phần', 'mmol/L', 2, [R(0, 5.2)]],
    ['TG', 'Triglycerid', 'mmol/L', 2, [R(0, 1.7)]],
    ['HDL', 'HDL-Cholesterol', 'mmol/L', 2, [R(1, 3)]],
    ['LDL', 'LDL-Cholesterol', 'mmol/L', 2, [R(0, 3.4)]],
    ['SG', 'Tỷ trọng', '', 3, [R(1.005, 1.03)]],
    ['PH', 'pH', '', 1, [R(5, 8)]],
  ];
  const idx = {};
  for (const [abbr, name, u, dec, refs] of INDICATORS) {
    const f = idxExisting.find((x) => x.abbreviation === abbr);
    idx[abbr] = (f || (await call('POST', '/lab-indicators', { name, abbreviation: abbr, unit: u || undefined, valueType: 'NUMBER', decimals: dec, references: refs }))).id;
  }
  const CHOICES = ['Âm tính', 'Vết', '1+', '2+', '3+'];
  for (const [abbr, name] of [['PRO', 'Protein niệu'], ['GLUN', 'Glucose niệu'], ['LEU', 'Bạch cầu niệu']]) {
    const f = idxExisting.find((x) => x.abbreviation === abbr);
    idx[abbr] = (f || (await call('POST', '/lab-indicators', { name, abbreviation: abbr, valueType: 'CHOICE', choiceOptions: CHOICES, references: [{ sex: 'ANY', normalText: 'Âm tính' }] }))).id;
  }
  console.log('✓ chỉ số xét nghiệm', Object.keys(idx).length);

  // ---- Dịch vụ kỹ thuật ----
  const spec = Object.fromEntries((await list('/reference-catalog/SPECIMEN_TYPE')).map((s) => [s.name, s.code]));
  const cats = Object.fromEntries((await list('/reference-catalog/TECH_SERVICE_CATEGORY')).map((c) => [c.name, c.code]));
  const depts = Object.fromEntries((await list('/departments')).map((d) => [d.name, d.id]));
  const lượt = unit['Lượt'];
  const price = (amount) => [{ priceTypeCode: 'THUONG', unitCode: lượt, amount, effectiveFrom: '2026-01-01' }];
  const SERVICES = [
    { name: 'Công thức máu 18 thông số', shortName: 'CTM', serviceKind: 'LAB', categoryCode: cats['Huyết học'], specimenTypeCode: spec['Máu toàn phần (EDTA)'], departmentId: depts['Khoa Xét nghiệm'], turnaroundMinutes: 60, resultType: 'INDICATORS', prices: price(75000), ind: ['WBC', 'RBC', 'HGB', 'HCT', 'PLT'] },
    { name: 'Định lượng Glucose máu', shortName: 'Glucose', serviceKind: 'LAB', categoryCode: cats['Sinh hoá'], specimenTypeCode: spec['Huyết thanh'], departmentId: depts['Khoa Xét nghiệm'], turnaroundMinutes: 60, resultType: 'INDICATORS', prices: price(40000), ind: ['GLU'] },
    { name: 'Định lượng HbA1c', shortName: 'HbA1c', serviceKind: 'LAB', categoryCode: cats['Sinh hoá'], specimenTypeCode: spec['Máu toàn phần (EDTA)'], departmentId: depts['Khoa Xét nghiệm'], turnaroundMinutes: 120, resultType: 'INDICATORS', prices: price(150000), ind: ['HbA1c'] },
    { name: 'Chức năng gan (AST, ALT)', shortName: 'Gan', serviceKind: 'LAB', categoryCode: cats['Sinh hoá'], specimenTypeCode: spec['Huyết thanh'], departmentId: depts['Khoa Xét nghiệm'], turnaroundMinutes: 90, resultType: 'INDICATORS', prices: price(80000), ind: ['AST', 'ALT'] },
    { name: 'Chức năng thận (Ure, Creatinin)', shortName: 'Thận', serviceKind: 'LAB', categoryCode: cats['Sinh hoá'], specimenTypeCode: spec['Huyết thanh'], departmentId: depts['Khoa Xét nghiệm'], turnaroundMinutes: 90, resultType: 'INDICATORS', prices: price(80000), ind: ['UREA', 'CREA'] },
    { name: 'Bộ mỡ máu (Cholesterol, Triglycerid, HDL, LDL)', shortName: 'Mỡ máu', serviceKind: 'LAB', categoryCode: cats['Sinh hoá'], specimenTypeCode: spec['Huyết thanh'], departmentId: depts['Khoa Xét nghiệm'], turnaroundMinutes: 90, resultType: 'INDICATORS', prices: price(160000), ind: ['CHOL', 'TG', 'HDL', 'LDL'] },
    { name: 'Tổng phân tích nước tiểu', shortName: 'TPT nước tiểu', serviceKind: 'LAB', categoryCode: cats['Nước tiểu'], specimenTypeCode: spec['Nước tiểu'], departmentId: depts['Khoa Xét nghiệm'], turnaroundMinutes: 45, resultType: 'INDICATORS', prices: price(50000), ind: ['SG', 'PH', 'PRO', 'GLUN', 'LEU'] },
    { name: 'Siêu âm ổ bụng tổng quát', shortName: 'Siêu âm bụng', serviceKind: 'IMAGING', categoryCode: cats['Siêu âm'], departmentId: depts['Khoa Chẩn đoán hình ảnh'], resultType: 'NARRATIVE', prices: price(150000), ind: [] },
    { name: 'X-quang ngực thẳng', shortName: 'X-quang ngực', serviceKind: 'IMAGING', categoryCode: cats['X-quang'], departmentId: depts['Khoa Chẩn đoán hình ảnh'], resultType: 'NARRATIVE', prices: price(120000), ind: [] },
    { name: 'Điện tim đồ (ECG)', shortName: 'ECG', serviceKind: 'FUNCTIONAL', departmentId: depts['Khoa Chẩn đoán hình ảnh'], resultType: 'NARRATIVE', prices: price(80000), ind: [] },
  ];
  const svcExisting = await list('/technical-services?limit=100');
  for (const s of SERVICES) {
    if (svcExisting.find((x) => x.name === s.name)) continue;
    const { ind, ...rest } = s;
    await call('POST', '/technical-services', { ...rest, isPerformedInHouse: true, indicators: ind.map((a) => ({ indicatorId: idx[a] })) });
  }
  console.log('✓ dịch vụ kỹ thuật', SERVICES.length);
  console.log('XONG GIAI ĐOẠN 2');
})().catch((e) => { console.error('LỖI', e.message.slice(0,0) + e.message); process.exit(1); });
