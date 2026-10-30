import { describe, expect, it } from 'vitest';
import { renderEncounterMedicalRecordHtml, type EncounterMedicalRecordDocument, type MedicalRecordPrintOptions } from './render-patient-medical-record-html';

const base = (over: Partial<EncounterMedicalRecordDocument> = {}): EncounterMedicalRecordDocument => ({
  clinic: { name: 'Phòng khám Sao Mai', address: '12 Lê Lợi, Quận 1', phone: '0281234567', taxCode: '0312345678' },
  patient: {
    patientCode: 'BN2610000001',
    fullName: 'Nguyễn Thị Hương',
    dob: '1988-03-04',
    genderLabel: 'Nữ',
    phone: '0903112455',
    address: '125/4 Nguyễn Thị Minh Khai, Bến Thành, TP. Hồ Chí Minh',
    nationalId: '079188004521',
    occupation: 'Giáo viên',
    ethnicity: 'Kinh',
    nationality: 'Việt Nam',
    personalHistory: 'Không hút thuốc',
    allergenNames: ['Penicillin'],
    conditionNames: ['Đái tháo đường type 2'],
    familyHistoryLines: ['Mẹ: Tăng huyết áp'],
    relative: 'Trần Văn Khoa (chồng) — 0908774112',
  },
  record: {
    recordNo: 'BA2026-000042',
    encounterNo: 'LK0042',
    checkedInAt: '2026-10-20T01:15:00.000Z',
    doctorName: 'BS. Trần Văn Bình',
    departmentName: 'Khoa Nội',
    branchName: null,
    signedAt: '2026-10-20T07:30:00.000Z',
  },
  insurance: null,
  vitalSigns: { measuredAt: '2026-10-20T01:20:00.000Z', pulse: 88, temperatureC: 38.2, bpSystolic: 118, bpDiastolic: 76, respiratoryRate: 18, spo2: 98, weightGram: 54000, heightMm: 1580 },
  diagnoses: [
    { icd10Code: 'J02.9', icd10Name: 'Viêm họng cấp', type: 'SECONDARY', note: null },
    { icd10Code: 'J06.9', icd10Name: 'Nhiễm khuẩn hô hấp trên', type: 'PRIMARY', note: null },
  ],
  notes: { reason: 'Ho khan, sốt nhẹ', illness: 'Khởi phát 3 ngày', preliminaryDiagnosis: 'Viêm đường hô hấp trên', generalExam: 'Tỉnh', regionalExam: 'Phổi không rales', summary: 'Tóm tắt ngắn', prognosis: 'Tiên lượng tốt', advice: 'Uống nhiều nước' },
  treatment: { directionLabels: ['Kê đơn thuốc', 'Hẹn tái khám'], content: 'Điều trị triệu chứng', advice: '', followUpDateLabel: 'Thứ Ba, 27/10/2026' },
  paraclinicalResults: [],
  prescriptionItems: [],
  generatedAt: '2026-10-30T03:00:00.000Z',
  reason: 'Giao hồ sơ cho bệnh nhân',
  ...over,
});

const cls = (name: string, abnormal = false) => ({
  itemId: `i-${name}`,
  serviceName: name,
  serviceKind: 'LAB' as const,
  signedAt: '2026-10-20T03:05:00.000Z',
  indicators: [{ name: 'Bạch cầu (WBC)', valueText: '11,4', referenceText: '4,0 – 10,0', unit: 'G/L', abnormal }],
  descriptionText: null,
  conclusionText: 'Bạch cầu tăng nhẹ',
  imageCount: 0,
});
const rx = [{ drugName: 'Paracetamol 500 mg', doseSummary: 'Sáng 1 - Chiều 1', durationDays: 5, quantity: 10, unitCode: 'VIEN', instruction: 'Uống sau ăn' }];
const pageBreaks = (html: string): number => (html.match(/class="page-break"/g) ?? []).length;

describe('renderEncounterMedicalRecordHtml — tờ khám theo mẫu bệnh án ngoại trú', () => {
  it('đủ 10 mục I–X theo đúng thứ tự mẫu', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    const titles = ['Hành chính', 'Lý do đến khám', 'Hỏi bệnh', 'Khám bệnh', 'Các xét nghiệm cận lâm sàng', 'Tóm tắt bệnh án', 'Chẩn đoán', 'Điều trị', 'Tiên lượng', 'Lời dặn · Hẹn tái khám'];
    const positions = titles.map((t) => html.indexOf(`</span> ${t}</th>`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const numeral of ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']) expect(html).toContain(`<span class="rec-num">${numeral}</span>`);
  });

  it('mục I có Số bệnh án, mã lượt khám, họ tên, địa chỉ và người cần báo tin', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    for (const s of ['BA2026-000042', 'LK0042', 'Nguyễn Thị Hương', '125/4 Nguyễn Thị Minh Khai', 'Trần Văn Khoa (chồng)', 'Khoa Nội', 'BS. Trần Văn Bình']) expect(html).toContain(s);
  });

  it('lượt khám cũ chưa có Số bệnh án → gạch ngang, không in "null"', () => {
    const html = renderEncounterMedicalRecordHtml(base({ record: { ...base().record, recordNo: null } }));
    expect(html).toContain('<td class="label">Số bệnh án</td><td>—</td>');
    expect(html).not.toContain('null');
  });

  it('mọi mốc thời gian theo giờ VIỆT NAM (UTC+7), kể cả khi qua nửa đêm', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    expect(html).toContain('20/10/2026 08:15'); // 01:15Z
    expect(html).toContain('20/10/2026 14:30'); // chữ ký 07:30Z
    const midnight = renderEncounterMedicalRecordHtml(base({ record: { ...base().record, checkedInAt: '2026-10-19T18:30:00.000Z' } }));
    expect(midnight).toContain('20/10/2026 01:30'); // 18:30Z hôm trước = 01:30 ngày hôm sau ở Việt Nam
  });

  it('tính tuổi theo ngày sinh nhật: chưa tới sinh nhật thì chưa tăng tuổi', () => {
    const at = '2026-10-20T01:00:00.000Z';
    const age = (dob: string) => renderEncounterMedicalRecordHtml(base({ patient: { ...base().patient, dob }, record: { ...base().record, checkedInAt: at } }));
    expect(age('1988-10-21')).toContain('1988 · 37 tuổi');
    expect(age('1988-10-20')).toContain('1988 · 38 tuổi');
    expect(age('1988-10-19')).toContain('1988 · 38 tuổi');
  });

  it('mục trống in "Chưa ghi." thay vì để trắng', () => {
    const html = renderEncounterMedicalRecordHtml(base({ notes: { reason: '', illness: '', preliminaryDiagnosis: '', generalExam: '', regionalExam: '', summary: '', prognosis: '', advice: '' } }));
    // 8 mục văn bản: lý do, bệnh lý, chẩn đoán sơ bộ, khám toàn thân, khám bộ phận, tóm tắt, tiên lượng, lời dặn.
    expect((html.match(/Chưa ghi\./g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it('mục VII có CẢ chẩn đoán sơ bộ dạng chữ (bác sĩ nhập bắt buộc) lẫn danh sách mã ICD-10', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    expect(html).toContain('Chẩn đoán sơ bộ');
    expect(html).toContain('Viêm đường hô hấp trên');
    expect(html).toContain('Chẩn đoán (ICD-10)');
    expect(html.indexOf('Viêm đường hô hấp trên')).toBeLessThan(html.indexOf('J06.9'));
  });

  it('chẩn đoán chính xếp trước chẩn đoán kèm theo', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    expect(html.indexOf('J06.9')).toBeLessThan(html.indexOf('J02.9'));
  });

  it('chống chèn HTML ở mọi trường văn bản', () => {
    const html = renderEncounterMedicalRecordHtml(
      base({ notes: { ...base().notes, reason: '<script>alert(1)</script>', summary: '<img src=x onerror=1>' }, patient: { ...base().patient, fullName: 'A <b>B</b>' } }),
    );
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('A <b>B</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('chữ ký bác sĩ + thời điểm ký ở cuối tờ khám', () => {
    expect(renderEncounterMedicalRecordHtml(base())).toMatch(/Bác sĩ khám bệnh[\s\S]*BS\. Trần Văn Bình[\s\S]*20\/10\/2026 14:30/);
  });

  it('KHÔNG có tiền/chi phí trong bộ hồ sơ', () => {
    expect(renderEncounterMedicalRecordHtml(base({ paraclinicalResults: [cls('Công thức máu')], prescriptionItems: rx }))).not.toMatch(/đồng|₫|Thành tiền|Đã thu|Chưa thu/);
  });

  it('dòng Chi nhánh chỉ khi công ty nhiều chi nhánh', () => {
    expect(renderEncounterMedicalRecordHtml(base())).not.toContain('Chi nhánh');
    expect(renderEncounterMedicalRecordHtml(base({ record: { ...base().record, branchName: 'Chi nhánh Quận 1' } }))).toContain('Chi nhánh Quận 1');
  });

  it('thẻ BHYT chỉ in khi ô tích bật (và công tắc tổng bật → có insurance)', () => {
    const insurance = { selfPay: false, cardNo: '079188004521', cardNoUnreadable: false, kind: 'NEW_12' as const, validFrom: null, validTo: '2026-12-31T00:00:00.000Z', benefitRate: 80, facilityName: null };
    const off = renderEncounterMedicalRecordHtml(base({ insurance }), undefined);
    expect(off).not.toContain('Thẻ BHYT');
    const opts: MedicalRecordPrintOptions = { header: { showClinicName: true, showAddress: true, showPhone: true, showTaxCode: false, showDivider: true }, title: null, footerNote: null, insurance: { show: true, whenSelfPay: 'hide' } };
    const on = renderEncounterMedicalRecordHtml(base({ insurance }), opts);
    expect(on).toContain('Thẻ BHYT');
    expect(on).toContain('079188004521');
  });

  it('thẻ có nhưng không giải mã được → KHÔNG in nhầm "Tự chi trả" (#262)', () => {
    const opts: MedicalRecordPrintOptions = { header: { showClinicName: true, showAddress: true, showPhone: true, showTaxCode: false, showDivider: true }, title: null, footerNote: null, insurance: { show: true, whenSelfPay: 'selfPay' } };
    const html = renderEncounterMedicalRecordHtml(base({ insurance: { selfPay: false, cardNo: null, cardNoUnreadable: true, kind: null, validFrom: null, validTo: null, benefitRate: null, facilityName: null } }), opts);
    expect(html).not.toContain('Tự chi trả');
  });

  it('tiêu đề và ghi chú cuối theo bản mẫu in của phòng khám', () => {
    const opts: MedicalRecordPrintOptions = { header: { showClinicName: false, showAddress: false, showPhone: false, showTaxCode: false, showDivider: false }, title: 'Hồ sơ khám bệnh', footerNote: 'Giữ phiếu này khi tái khám', insurance: undefined };
    const html = renderEncounterMedicalRecordHtml(base(), opts);
    expect(html).toContain('Hồ sơ khám bệnh');
    expect(html).toContain('Giữ phiếu này khi tái khám');
    expect(html).not.toContain('Phòng khám Sao Mai');
  });
});

describe('renderEncounterMedicalRecordHtml — bộ hồ sơ: tờ khám + phiếu kết quả + đơn thuốc', () => {
  it('chỉ tờ khám khi không có kết quả và không có đơn → 0 trang phụ', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    expect(pageBreaks(html)).toBe(0);
    expect(html).toContain('Không có kết quả cận lâm sàng.');
  });

  it('mỗi kết quả đã duyệt có MỘT trang phiếu riêng, đơn thuốc một trang: tổng trang phụ = N + 1', () => {
    const html = renderEncounterMedicalRecordHtml(base({ paraclinicalResults: [cls('Công thức máu'), cls('Sinh hoá máu')], prescriptionItems: rx }));
    expect(pageBreaks(html)).toBe(3);
    expect(html).toContain('Phiếu kết quả xét nghiệm');
    expect(html).toContain('Đơn thuốc</div>');
  });

  it('mục V của tờ khám tóm tắt kết quả và nói phiếu đầy đủ ở các trang sau', () => {
    const html = renderEncounterMedicalRecordHtml(base({ paraclinicalResults: [cls('Công thức máu')] }));
    expect(html).toContain('Phiếu kết quả đầy đủ kèm theo ở các trang sau.');
    expect(html).toContain('Bạch cầu tăng nhẹ');
  });

  it('chỉ số vượt mức in đậm + gạch chân ở phiếu kết quả', () => {
    const html = renderEncounterMedicalRecordHtml(base({ paraclinicalResults: [cls('Công thức máu', true)] }));
    expect(html).toContain('<td class="abnormal">11,4</td>');
  });

  it('đơn thuốc: kèm mã đơn quốc gia, chẩn đoán, lời dặn và hẹn tái khám', () => {
    const html = renderEncounterMedicalRecordHtml(base({ prescriptionItems: rx, prescriptionDocuments: [{ kind: 'C', nationalCode: '79001-0000428-C' }] }));
    expect(html).toContain('79001-0000428-C');
    expect(html).toContain('Paracetamol 500 mg');
    expect(html).toContain('J06.9 Nhiễm khuẩn hô hấp trên');
    expect(html).toMatch(/Đơn thuốc<\/div>[\s\S]*Lời dặn:<\/strong> Uống nhiều nước[\s\S]*Hẹn tái khám:<\/strong> Thứ Ba, 27\/10\/2026/);
  });

  it('không kê đơn thì KHÔNG có trang đơn thuốc', () => {
    expect(renderEncounterMedicalRecordHtml(base())).not.toContain('Đơn thuốc</div>');
  });

  it('mọi trang phụ mang lại tên bệnh nhân và Số bệnh án để khỏi lẫn tờ', () => {
    const html = renderEncounterMedicalRecordHtml(base({ paraclinicalResults: [cls('Công thức máu')], prescriptionItems: rx }));
    expect((html.match(/Nguyễn Thị Hương · Mã BN BN2610000001 · Số bệnh án BA2026-000042/g) ?? []).length).toBe(2);
  });
});
