/* global console */
// GIAI ĐOẠN 4 — lượt khám trong ngày: đã khám xong (có đơn thuốc, một số có xét nghiệm/siêu âm đã duyệt), đang khám, đang chờ (đã thu / chưa thu), đã huỷ; lịch hẹn ngày mai.
const fs = require('fs');
const V = require('./hh-visit.cjs');

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(777);
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

// [mã thuốc, tổng số viên, số ngày, sáng, trưa, chiều, tối, lời dặn]
const RX = {
  hoHap: [['T0001', 15, 5, 1, 1, 0, 1, 'Uống khi sốt trên 38,5 độ C'], ['T0009', 5, 5, 0, 0, 0, 1], ['T0020', 15, 5, 1, 1, 0, 1]],
  hoHapNhi: [['T0001', 12, 4, 1, 1, 1, 1, 'Uống khi sốt trên 38,5 độ C, cách nhau tối thiểu 4 giờ'], ['T0020', 8, 4, 1, 0, 1, 0]],
  tangHuyetAp: [['T0016', 30, 30, 1, 0, 0, 0, 'Uống vào buổi sáng, đo huyết áp tại nhà mỗi ngày']],
  tieuDuong: [['T0014', 60, 30, 1, 0, 0, 1, 'Uống trong bữa ăn'], ['T0015', 30, 30, 1, 0, 0, 0]],
  daDay: [['T0010', 14, 14, 1, 0, 0, 0, 'Uống trước bữa ăn sáng 30 phút'], ['T0012', 28, 14, 1, 0, 0, 1]],
  moMau: [['T0018', 30, 30, 0, 0, 0, 1, 'Uống vào buổi tối']],
  dauLung: [['T0002', 20, 5, 1, 1, 0, 1, 'Uống sau ăn no'], ['T0001', 10, 5, 1, 0, 0, 1], ['T0010', 5, 5, 1, 0, 0, 0]],
  phequan: [['T0006', 3, 3, 1, 0, 0, 0, 'Uống xa bữa ăn'], ['T0021', 10, 5, 1, 0, 0, 1], ['T0020', 15, 5, 1, 1, 0, 1]],
  hong: [['T0004', 21, 7, 1, 1, 0, 1, 'Uống đủ liều, đủ ngày'], ['T0001', 10, 5, 1, 0, 0, 1], ['T0023', 14, 7, 1, 0, 0, 1]],
  hongNhi: [['T0004', 14, 7, 1, 0, 0, 1, 'Uống đủ liều, đủ ngày'], ['T0001', 8, 4, 1, 1, 1, 1]],
  diUng: [['T0008', 7, 7, 0, 0, 0, 1, 'Uống vào buổi tối'], ['T0024', 14, 7, 1, 0, 0, 1]],
  mui: [['T0009', 10, 10, 1, 0, 0, 0], ['T0008', 5, 5, 0, 0, 0, 1]],
  xoang: [['T0005', 14, 7, 1, 0, 0, 1, 'Uống đầu bữa ăn'], ['T0009', 7, 7, 1, 0, 0, 0], ['T0020', 14, 7, 1, 0, 1, 0]],
  tieuChay: [['T0013', 6, 3, 1, 0, 1, 1, 'Uống khi đi ngoài phân lỏng, tối đa 3 viên mỗi ngày'], ['T0012', 9, 3, 1, 0, 1, 1]],
};
const NOTE = (reason, progress, prelim, general, regional, plan) => ({ reason, progress, preliminary: prelim, general, regional, plan });
const SCEN = {
  noi: [
    { rx: 'hoHap', complaint: 'Ho, sổ mũi 4 ngày', vitals: { temperatureC: 37.6, pulse: 88, bpSystolic: 120, bpDiastolic: 78, spo2: 98 }, dx: ['J06.9'], note: NOTE('Ho, sổ mũi 4 ngày', 'Ho khan tăng về đêm, sổ mũi trong, sốt nhẹ về chiều.', 'Viêm hô hấp trên cấp', 'Tỉnh, tiếp xúc tốt, da niêm hồng.', 'Họng đỏ, phổi thông khí đều, không rales.', 'Điều trị triệu chứng, tái khám nếu không giảm sau 3 ngày.'), advice: 'Uống nhiều nước ấm, giữ ấm cổ họng, nghỉ ngơi.' },
    { rx: 'tangHuyetAp', complaint: 'Đau đầu, chóng mặt vài ngày nay', vitals: { pulse: 82, bpSystolic: 150, bpDiastolic: 95, spo2: 98 }, dx: ['I10'], note: NOTE('Đau đầu, chóng mặt', 'Đau đầu vùng chẩm, chóng mặt khi đứng dậy nhanh, không nôn.', 'Tăng huyết áp', 'Tỉnh, tiếp xúc tốt.', 'Tim đều, T1 T2 rõ, không âm thổi. Phổi trong.', 'Dùng thuốc hạ áp đều mỗi ngày, hạn chế muối, tái khám sau 2 tuần.'), advice: 'Giảm muối trong khẩu phần ăn, đi bộ 30 phút mỗi ngày.', orders: ['Chức năng thận (Ure, Creatinin)', 'Bộ mỡ máu (Cholesterol, Triglycerid, HDL, LDL)'] },
    { rx: 'tieuDuong', complaint: 'Khát nước nhiều, tiểu nhiều, sút cân', vitals: { pulse: 80, bpSystolic: 130, bpDiastolic: 80, spo2: 99 }, dx: ['E11.9'], note: NOTE('Uống nhiều, tiểu nhiều', 'Khát nước, tiểu nhiều về đêm, sút 3 kg trong 2 tháng.', 'Đái tháo đường type 2', 'Tỉnh, tiếp xúc tốt.', 'Tim phổi bình thường, bụng mềm.', 'Kiểm soát đường huyết, chế độ ăn giảm tinh bột, tái khám sau 1 tháng.'), advice: 'Ăn giảm tinh bột, hạn chế đồ ngọt, tập thể dục đều đặn.', orders: ['Định lượng Glucose máu', 'Định lượng HbA1c'] },
    { rx: 'daDay', complaint: 'Đau thượng vị, ợ chua', vitals: { pulse: 78, bpSystolic: 118, bpDiastolic: 76, spo2: 99 }, dx: ['K29.7'], note: NOTE('Đau thượng vị', 'Đau âm ỉ vùng thượng vị sau ăn, ợ chua, đầy bụng 2 tuần.', 'Viêm dạ dày', 'Tỉnh, thể trạng trung bình.', 'Bụng mềm, ấn đau nhẹ thượng vị, không phản ứng thành bụng.', 'Dùng thuốc ức chế acid, ăn uống điều độ, tái khám nếu không đỡ.'), advice: 'Tránh rượu bia, cà phê, đồ cay; ăn chia nhỏ nhiều bữa.' },
    { rx: 'moMau', complaint: 'Khám sức khỏe, mỡ máu cao', vitals: { pulse: 76, bpSystolic: 125, bpDiastolic: 80, spo2: 99 }, dx: ['E78.5'], note: NOTE('Kiểm tra mỡ máu', 'Xét nghiệm tại nơi làm việc cho thấy mỡ máu cao.', 'Rối loạn lipid máu', 'Tỉnh, thể trạng tốt, BMI 26.', 'Tim phổi bình thường.', 'Điều chỉnh chế độ ăn, dùng statin, kiểm tra lại mỡ máu sau 6 tuần.'), advice: 'Giảm mỡ động vật, tăng rau xanh, vận động đều đặn.', orders: ['Bộ mỡ máu (Cholesterol, Triglycerid, HDL, LDL)', 'Chức năng gan (AST, ALT)'] },
    { rx: 'dauLung', complaint: 'Đau lưng sau khi bê vật nặng', vitals: { pulse: 84, bpSystolic: 122, bpDiastolic: 78, spo2: 99 }, dx: ['M54.5'], note: NOTE('Đau lưng', 'Đau vùng thắt lưng sau khi bê vật nặng 2 ngày, đau tăng khi cúi.', 'Đau thắt lưng cấp', 'Tỉnh, đi lại được.', 'Co cứng cơ cạnh sống thắt lưng, không yếu liệt chi.', 'Dùng thuốc giảm đau chống viêm, nghỉ ngơi, tránh bê vật nặng.'), advice: 'Nằm giường cứng, chườm ấm vùng lưng, tránh cúi gập.' },
    { rx: 'phequan', complaint: 'Ho đờm, khò khè 1 tuần', vitals: { temperatureC: 37.8, pulse: 92, respiratoryRate: 22, spo2: 96 }, dx: ['J20.9'], note: NOTE('Ho đờm 1 tuần', 'Ho có đờm vàng, khò khè, mệt, sốt nhẹ.', 'Viêm phế quản cấp', 'Tỉnh, hơi mệt.', 'Phổi có ran rít, ran ngáy rải rác hai bên.', 'Kháng sinh, long đờm, tái khám sau 5 ngày.'), advice: 'Uống nhiều nước, tránh khói bụi, đeo khẩu trang khi ra đường.', orders: ['Công thức máu 18 thông số', 'X-quang ngực thẳng'] },
  ],
  nhi: [
    { rx: 'hoHapNhi', complaint: 'Sốt, ho, sổ mũi 2 ngày', vitals: { temperatureC: 38.2, pulse: 110, respiratoryRate: 26, spo2: 98 }, dx: ['J06.9'], note: NOTE('Sốt, ho 2 ngày', 'Sốt 38 – 38,5 độ C, ho, sổ mũi, bú ăn kém hơn thường ngày.', 'Viêm hô hấp trên cấp', 'Trẻ tỉnh, hơi quấy, da hồng.', 'Họng đỏ, phổi thông khí đều, không co lõm ngực.', 'Hạ sốt, vệ sinh mũi họng, tái khám nếu sốt trên 3 ngày.'), advice: 'Cho trẻ uống nhiều nước, lau mát khi sốt, vệ sinh mũi bằng nước muối sinh lý.' },
    { rx: 'hongNhi', complaint: 'Đau họng, sốt 3 ngày', vitals: { temperatureC: 38.6, pulse: 105, respiratoryRate: 24, spo2: 98 }, dx: ['J03.9'], note: NOTE('Đau họng, sốt', 'Sốt cao liên tục 3 ngày, đau họng, nuốt đau.', 'Viêm amiđan cấp', 'Trẻ tỉnh, mệt.', 'Amiđan sưng đỏ, có mủ trắng hai bên.', 'Kháng sinh đủ liều, hạ sốt, tái khám sau 3 ngày.'), advice: 'Ăn thức ăn lỏng, mềm, súc họng nước muối ấm.' },
    { rx: 'diUng', complaint: 'Hắt hơi, ngứa mũi buổi sáng', vitals: { temperatureC: 36.8, pulse: 96, spo2: 99 }, dx: ['J30.4'], note: NOTE('Hắt hơi, ngứa mũi', 'Hắt hơi thành tràng, ngứa mũi, chảy mũi trong mỗi sáng, kéo dài nhiều tuần.', 'Viêm mũi dị ứng', 'Trẻ tỉnh, thể trạng tốt.', 'Niêm mạc mũi nhợt, cuốn mũi phù nề.', 'Thuốc kháng histamin, tránh tiếp xúc dị nguyên.'), advice: 'Giặt chăn gối thường xuyên, hạn chế thú nuôi trong phòng ngủ.' },
    { rx: 'phequan', complaint: 'Ho nhiều về đêm', vitals: { temperatureC: 37.7, pulse: 108, respiratoryRate: 28, spo2: 97 }, dx: ['J20.9'], note: NOTE('Ho nhiều về đêm', 'Ho có đờm, khò khè nhẹ, sốt thoáng qua.', 'Viêm phế quản cấp', 'Trẻ tỉnh, thở nhanh nhẹ.', 'Phổi ran ngáy, ran rít rải rác.', 'Long đờm, theo dõi nhịp thở, tái khám sau 3 ngày.'), advice: 'Giữ ấm ngực, cho uống nước ấm, tránh khói thuốc.' },
  ],
  tmh: [
    { rx: 'xoang', complaint: 'Nghẹt mũi, đau nhức vùng mặt', vitals: { temperatureC: 37.4, pulse: 80, bpSystolic: 118, bpDiastolic: 76, spo2: 99 }, dx: ['J01.9'], note: NOTE('Nghẹt mũi, đau mặt', 'Nghẹt mũi, chảy mũi đục, nhức vùng trán và hai bên mũi 1 tuần.', 'Viêm xoang cấp', 'Tỉnh, tiếp xúc tốt.', 'Niêm mạc mũi phù nề, có dịch mủ ở khe giữa; ấn đau vùng xoang hàm.', 'Kháng sinh, kháng histamin, rửa mũi nước muối, tái khám sau 7 ngày.'), advice: 'Rửa mũi nước muối sinh lý 2 lần mỗi ngày, tránh bụi và khói.' },
    { rx: 'diUng', complaint: 'Hắt hơi, chảy mũi kéo dài', vitals: { temperatureC: 36.9, pulse: 76, bpSystolic: 120, bpDiastolic: 78, spo2: 99 }, dx: ['J30.4'], note: NOTE('Hắt hơi, chảy mũi', 'Hắt hơi, ngứa mũi, chảy mũi trong nhiều tuần, nặng hơn khi trời lạnh.', 'Viêm mũi dị ứng', 'Tỉnh, thể trạng tốt.', 'Niêm mạc mũi nhợt màu, cuốn mũi dưới quá phát.', 'Kháng histamin, tránh dị nguyên, tái khám sau 2 tuần.'), advice: 'Tránh bụi nhà, lông thú, phấn hoa; giữ ấm khi thời tiết lạnh.' },
    { rx: 'hong', complaint: 'Đau họng, khàn tiếng 5 ngày', vitals: { temperatureC: 37.5, pulse: 84, bpSystolic: 118, bpDiastolic: 76, spo2: 99 }, dx: ['J02.9'], note: NOTE('Đau họng, khàn tiếng', 'Đau họng, nuốt vướng, khàn tiếng, ho khan 5 ngày.', 'Viêm họng cấp', 'Tỉnh, tiếp xúc tốt.', 'Họng đỏ, thành sau họng có hạt lympho; dây thanh phù nhẹ.', 'Kháng sinh, giảm đau, nghỉ giọng, tái khám sau 5 ngày.'), advice: 'Hạn chế nói to, uống nước ấm, tránh đồ lạnh và cay.' },
    { rx: 'mui', complaint: 'Nghẹt mũi về đêm, ngủ ngáy', vitals: { temperatureC: 36.8, pulse: 78, bpSystolic: 124, bpDiastolic: 80, spo2: 98 }, dx: ['J34.2'], note: NOTE('Nghẹt mũi, ngủ ngáy', 'Nghẹt mũi kéo dài, ngủ ngáy, thức dậy khô họng.', 'Vẹo vách ngăn mũi', 'Tỉnh, tiếp xúc tốt.', 'Vách ngăn lệch sang trái, cuốn mũi phù nề.', 'Điều trị nội khoa, theo dõi, cân nhắc nội soi mũi xoang nếu không đỡ.'), advice: 'Rửa mũi thường xuyên, nằm gối cao đầu.' },
  ],
};
const DOCTOR_OF = { noi: ['bs.thanhphong', 'Khám Nội tổng quát'], nhi: ['bs.maianh', 'Khám Nhi'], tmh: ['bs.quocviet', 'Khám Tai Mũi Họng'] };
const RESULTS = {
  WBC: [7.2, 8.6, 11.4], RBC: [4.8, 4.5, 4.9], HGB: [142, 128, 150], HCT: [43, 41, 45], PLT: [265, 310, 198], GLU: [5.4, 7.8, 6.1], HbA1c: [5.6, 7.2, 6.4], AST: [28, 36, 44], ALT: [24, 41, 33],
  UREA: [4.8, 5.6, 6.9], CREA: [82, 94, 76], CHOL: [4.9, 6.1, 5.6], TG: [1.4, 2.6, 1.9], HDL: [1.3, 1.1, 0.9], LDL: [2.8, 3.9, 3.2], SG: [1.015, 1.02, 1.01], PH: [6, 6.5, 5.5],
};
const fmt = (abbr, v, decimals) => String(Number(v).toFixed(decimals)).replace('.', ',');

(async () => {
  const ctx = await V.context();
    const patients = JSON.parse(fs.readFileSync('hh-patients.json', 'utf-8'));
  const pool = shuffle(patients);
  const takeFor = (group) => {
    const ok = (p) => (group === 'nhi' ? p.age < 16 : p.age >= 16);
    const i = pool.findIndex(ok);
    return i >= 0 ? pool.splice(i, 1)[0] : pool.splice(0, 1)[0];
  };
  const reception = ['letan.thuha', 'letan.ngoctram'];
  const results = { done: 0, consult: 0, waiting: 0, unpaid: 0, cancelled: 0, failed: [] };
  let recIdx = 0;
  let payIdx = 0;
  const nextRec = () => reception[recIdx++ % 2];
  const nextPay = () => (payIdx++ % 10 < 7 ? 'CASH' : 'BANK_TRANSFER');
  for (const u of reception) await V.api(u, 'POST', '/cashier-shifts/open', { openingFloatActual: 2000000 }).catch(() => null);

  const labFlow = async (doctor, enc, orders, recept) => {
    const placed = await V.api(doctor, 'PUT', `/encounters/${enc.id}/clinical-orders`, { items: orders.map((n) => ({ performance: 'IN_HOUSE', technicalServiceId: ctx.services[n].id, quantity: 1 })) });
    const order = placed.order || placed;
    await V.payInvoice(recept, enc.id, nextPay());
    const labItems = order.items.filter((i) => ctx.services[orders.find((n) => ctx.services[n].id === i.technicalServiceId)].serviceKind === 'LAB');
    if (labItems.length) {
      const open = await V.api('xn.minhkhang', 'POST', `/paraclinical/lab/orders/${order.id}/specimen-collection/open`, {});
      const tubes = open.state.tubes;
      await V.api('xn.minhkhang', 'POST', '/paraclinical/lab/specimen-tubes/collect', { tubes: tubes.map((t) => ({ tubeId: t.id, via: 'MANUAL' })) });
    }
    const imaging = order.items.filter((i) => !labItems.includes(i));
    if (imaging.length) await V.api(doctor, 'POST', '/paraclinical/imaging/start', { itemIds: imaging.map((i) => i.id) });
    const svcOf = (item) => ctx.services[orders.find((n) => ctx.services[n].id === item.technicalServiceId)];
    const labSections = [];
    for (const item of labItems) {
      const svc = svcOf(item);
      const detail = await V.api('hoangnam', 'GET', `/technical-services/${svc.id}`);
      const pickIdx = rand() < 0.65 ? 0 : (rand() < 0.5 ? 1 : 2);
      const values = (detail.indicators || []).map((ind) => {
        const abbr = ind.abbreviation || ind.indicatorAbbreviation;
        const base = RESULTS[abbr];
        const text = base ? fmt(abbr, base[pickIdx], ind.decimals ?? 1) : ['Âm tính', 'Vết'][rand() < 0.8 ? 0 : 1];
        return { indicatorId: ind.indicatorId || ind.id, valueText: text };
      });
      labSections.push({ itemId: item.id, values });
    }
    if (labSections.length) {
      const body = { sections: labSections, submit: true };
      await V.api('xn.minhkhang', 'PUT', `/paraclinical/lab/items/${labSections[0].itemId}/result`, body);
      await V.api(doctor, 'POST', `/paraclinical/lab/items/${labSections[0].itemId}/result/approve`, body);
    }
    for (const item of imaging) {
      const svc = svcOf(item);
      const text = /Siêu âm/.test(svc.name)
        ? ['Gan kích thước bình thường, bờ đều, echo đồng nhất. Không thấy khối khu trú. Túi mật thành mỏng, không sỏi. Lách, tụy, hai thận bình thường. Không có dịch ổ bụng.', 'Gan nhiễm mỡ độ 1. Túi mật thành mỏng, không sỏi. Lách, tụy, hai thận bình thường. Không có dịch ổ bụng.']
        : ['Hai phế trường sáng đều. Không thấy tổn thương nhu mô phổi. Bóng tim không to. Hai góc sườn hoành nhọn.', 'Rốn phổi đậm nhẹ hai bên. Không thấy đông đặc nhu mô. Bóng tim không to. Hai góc sườn hoành nhọn.'];
      const sectionsBody = { sections: [{ itemId: item.id, values: [], descriptionText: text[rand() < 0.6 ? 0 : 1], conclusionText: /Siêu âm/.test(svc.name) ? 'Hiện không ghi nhận bất thường rõ rệt trên siêu âm.' : 'Phim X-quang ngực thẳng chưa thấy bất thường.' }], submit: true };
      await V.api(doctor, 'PUT', `/paraclinical/imaging/items/${item.id}/result`, sectionsBody);
      await V.api(doctor, 'POST', `/paraclinical/imaging/items/${item.id}/result/approve`, sectionsBody);
    }
  };

  const fullVisit = async (group, withOrders) => {
    const p = takeFor(group);
    const [doctor, examName] = DOCTOR_OF[group];
    const sc = pick(SCEN[group].filter((s) => !!s.orders === withOrders).length ? SCEN[group].filter((s) => !!s.orders === withOrders) : SCEN[group]);
    const recept = nextRec();
    try {
      const enc = await V.receive(ctx, { receptionist: recept, patient: p, doctor, examName, complaint: sc.complaint, vitals: { ...sc.vitals, weightGram: group === 'nhi' ? between(12, 38) * 1000 : between(48, 78) * 1000, heightMm: group === 'nhi' ? between(95, 150) * 10 : between(152, 176) * 10 }, pay: nextPay(), source: pick(['Tự đến', 'Tự đến', 'Người quen giới thiệu', 'Đặt hẹn qua điện thoại']) });
      await V.start(doctor, enc.id);
      await V.note(doctor, enc.id, sc.note);
      await V.diagnoses(doctor, enc.id, sc.dx.map((c, i) => ({ icd10Code: c, type: i === 0 ? 'PRIMARY' : 'SECONDARY' })));
      const rx = await V.prescribe(doctor, enc.id, ctx, RX[sc.rx], sc.advice);
      await V.sign(doctor, enc.id, rx.version);
      if (withOrders && sc.orders) await labFlow(doctor, enc, sc.orders, recept);
      await V.complete(doctor, enc.id);
      results.done += 1;
      return { ...p, enc: enc.id, doctor };
    } catch (e) { results.failed.push(`${p.fullName}: ${e.message.slice(0, 350)}`); return null; }
  };

  // 16 lượt đã khám xong (6 có xét nghiệm/siêu âm/X-quang đã duyệt)
  const plan = [['noi', true], ['noi', true], ['noi', true], ['noi', true], ['noi', true], ['nhi', false], ['noi', false], ['tmh', false], ['nhi', false], ['tmh', false], ['noi', false], ['tmh', false], ['nhi', false], ['noi', false], ['tmh', false], ['nhi', false]];
  for (const [g, o] of (process.env.HH_TRIAL ? plan.slice(0, Number(process.env.HH_TRIAL)) : plan)) await fullVisit(g, o);
  if (process.env.HH_TRIAL) { console.log('thử:', results.done, 'xong;', results.failed.length, 'lỗi'); results.failed.forEach((f) => console.log('  ✗', f)); return; }
  console.log('đã khám xong:', results.done, 'lỗi:', results.failed.length);
  results.failed.slice(0, 4).forEach((f) => console.log('  ✗', f));

  // 6 lượt đang khám (đã nhận khám, bác sĩ đang ghi bệnh án)
  for (const g of ['noi', 'noi', 'nhi', 'tmh', 'nhi', 'tmh']) {
    const p = takeFor(g); const [doctor, examName] = DOCTOR_OF[g]; const sc = pick(SCEN[g]);
    try {
      const enc = await V.receive(ctx, { receptionist: nextRec(), patient: p, doctor, examName, complaint: sc.complaint, vitals: sc.vitals, pay: nextPay() });
      await V.start(doctor, enc.id);
      await V.note(doctor, enc.id, sc.note);
      results.consult += 1;
    } catch (e) { results.failed.push(`${p.fullName} (đang khám): ${e.message.slice(0, 300)}`); }
  }
  // 12 lượt đang chờ (đã thu tiền) + 4 lượt chưa thu
  for (let i = 0; i < 16; i += 1) {
    const g = pick(['noi', 'noi', 'nhi', 'tmh']); const p = takeFor(g); const [doctor, examName] = DOCTOR_OF[g]; const sc = pick(SCEN[g]);
    const paid = i < 12;
    try {
      await V.receive(ctx, { receptionist: nextRec(), patient: p, doctor, examName, complaint: sc.complaint, vitals: sc.vitals, pay: paid ? nextPay() : null });
      if (paid) results.waiting += 1; else results.unpaid += 1;
    } catch (e) { results.failed.push(`${p.fullName} (chờ): ${e.message.slice(0, 300)}`); }
  }
  // 3 lượt huỷ
  for (const reason of ['Bệnh nhân có việc đột xuất, xin hẹn lại', 'Bệnh nhân không muốn chờ lâu nên về trước', 'Đăng ký nhầm chuyên khoa, đã đăng ký lại']) {
    const g = pick(['noi', 'tmh']); const p = takeFor(g); const [doctor, examName] = DOCTOR_OF[g];
    try {
      const enc = await V.receive(ctx, { receptionist: 'letan.thuha', patient: p, doctor, examName, complaint: 'Khám bệnh', pay: null });
      await V.api('letan.thuha', 'POST', `/encounters/${enc.id}/cancel`, { cancelReason: reason, version: enc.version });
      results.cancelled += 1;
    } catch (e) { results.failed.push(`${p.fullName} (huỷ): ${e.message.slice(0, 300)}`); }
  }
  // 8 lịch hẹn: 5 cho ngày mai, 3 cho chiều nay (người đã có hồ sơ, chưa có lượt khám hôm nay)
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const at = (d, h, m) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const apptSlots = [[tomorrow, 8, 0], [tomorrow, 8, 30], [tomorrow, 9, 15], [tomorrow, 14, 0], [tomorrow, 15, 30], [new Date(), 16, 0], [new Date(), 16, 30], [new Date(), 17, 0]];
  let appts = 0;
  for (const [d, h, m] of apptSlots) {
    const g = pick(['noi', 'noi', 'tmh', 'nhi']); const p = takeFor(g); const [doctor] = DOCTOR_OF[g];
    try {
      await V.api(nextRec(), 'POST', '/appointments', { doctorId: ctx.users[doctor].id, fullName: p.fullName, phone: p.phone, reason: pick(['Tái khám theo hẹn', 'Khám sức khỏe định kỳ', 'Khám theo lịch hẹn qua điện thoại', 'Đặt hẹn qua website']), scheduledAt: at(d, h, m), durationMinutes: 15, source: pick(['phone', 'online', 'phone']) });
      appts += 1;
    } catch (e) { results.failed.push(`${p.fullName} (hẹn): ${e.message.slice(0, 260)}`); }
  }
  console.log('lịch hẹn:', appts);
  console.log(JSON.stringify({ done: results.done, consult: results.consult, waiting: results.waiting, unpaid: results.unpaid, cancelled: results.cancelled, failed: results.failed.length }));
  results.failed.forEach((f) => console.log('  ✗', f));
})().catch((e) => { console.error('LỖI', e.message.slice(0, 500)); process.exit(1); });
