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
    archiveNo: 'LT2026-000042',
    encounterNo: 'LK0042',
    visitTypeLabel: 'Tái khám',
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

describe('renderEncounterMedicalRecordHtml — tờ khám theo mẫu MS 15/BV-01', () => {
  it('tờ 1 có mục I–IV đúng thứ tự mẫu, rồi trang "Tổng kết bệnh án" có 6 mục', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    const titles = ['Hành chính', 'Lý do vào viện', 'Hỏi bệnh', 'Khám bệnh'];
    const positions = titles.map((t) => html.indexOf(`</span> ${t}</th>`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const numeral of ['I', 'II', 'III', 'IV']) expect(html).toContain(`<span class="rec-num">${numeral}</span>`);
    const summaryTitles = ['Diễn biến', 'Cận lâm sàng', 'Chẩn đoán ra viện', 'Phương pháp điều trị', 'Tình trạng ra viện', 'Hướng điều trị tiếp'];
    const summaryAt = html.indexOf('Tổng kết bệnh án');
    expect(summaryAt).toBeGreaterThan(html.indexOf('</span> Khám bệnh</th>'));
    const sp = summaryTitles.map((t) => html.indexOf(`</span> ${t}</th>`));
    expect(sp.every((p) => p > summaryAt)).toBe(true);
    expect([...sp].sort((a, b) => a - b)).toEqual(sp);
    expect(html).toContain('MS: 15/BV-01');
  });

  it('KHÔNG còn khung 10 mục của Quyết định 4069 và không còn nhãn "Số bệnh án"', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    for (const old of ['Các xét nghiệm cận lâm sàng', '</span> Tiên lượng</th>', '</span> Tóm tắt bệnh án</th>', 'Lời dặn · Hẹn tái khám', 'Số bệnh án']) expect(html).not.toContain(old);
  });

  it('mục I đủ 13 mục theo số thứ tự mẫu; Nơi làm việc và Chẩn đoán nơi giới thiệu in "—" (hệ thống chưa lưu)', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    for (const s of ['1. Họ và tên (in hoa)', 'NGUYỄN THỊ HƯƠNG', '2. Sinh ngày', '04/03/1988', '>Tuổi<', '7. Địa chỉ', '125/4 Nguyễn Thị Minh Khai', '11. Người nhà khi cần báo tin', 'Trần Văn Khoa (chồng)', '12. Đến khám bệnh lúc', 'Khoa Nội', 'BS. Trần Văn Bình']) expect(html).toContain(s);
    expect(html).toContain('<td class="label">8. Nơi làm việc</td><td>—</td>');
    expect(html).toContain('<td class="label">13. Chẩn đoán của nơi giới thiệu</td><td>—</td>');
  });

  it('hàng mã đầu tờ: Số ngoại trú = mã phiếu khám, Số lưu trữ, Hồ sơ = mã bệnh nhân, nhãn Khám mới/Tái khám', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    expect(html).toContain('<span class="k">Số ngoại trú</span><br><strong>LK0042</strong>');
    expect(html).toContain('<span class="k">Số lưu trữ</span><br><strong>LT2026-000042</strong>');
    expect(html).toContain('<span class="k">Hồ sơ (mã bệnh nhân)</span><br><strong>BN2610000001</strong>');
    expect(html).toContain('<span class="k">Loại khám</span><br><strong>Tái khám</strong>');
  });

  it('lượt khám cũ chưa có Số lưu trữ hoặc Loại tiếp nhận → gạch ngang, không in "null"', () => {
    const html = renderEncounterMedicalRecordHtml(base({ record: { ...base().record, archiveNo: null, visitTypeLabel: null } }));
    expect(html).toContain('<span class="k">Số lưu trữ</span><br><strong>—</strong>');
    expect(html).toContain('<span class="k">Loại khám</span><br><strong>—</strong>');
    expect(html).not.toContain('null');
  });

  it('"9. Đối tượng" suy ra từ thẻ BHYT: công tắc tắt → —; tự chi trả → Thu phí; có thẻ (kể cả không giải mã được) → BHYT', () => {
    const obj = (html: string) => /9\. Đối tượng<\/td><td>([^<]*)<\/td>/.exec(html)?.[1];
    const ins = (over: object) => ({ selfPay: false, cardNo: null, cardNoUnreadable: false, kind: null, validFrom: null, validTo: null, benefitRate: null, facilityName: null, ...over });
    expect(obj(renderEncounterMedicalRecordHtml(base({ insurance: null })))).toBe('—');
    expect(obj(renderEncounterMedicalRecordHtml(base({ insurance: ins({ selfPay: true }) })))).toBe('Thu phí');
    expect(obj(renderEncounterMedicalRecordHtml(base({ insurance: ins({ cardNo: '079188004521', kind: 'NEW_12' }) })))).toBe('BHYT');
    expect(obj(renderEncounterMedicalRecordHtml(base({ insurance: ins({ cardNoUnreadable: true }) })))).toBe('BHYT');
  });

  it('"Điều trị ngoại trú": từ = ngày khám, đến = ngày hẹn tái khám nếu có, không thì bằng ngày khám', () => {
    expect(renderEncounterMedicalRecordHtml(base())).toContain('Từ ngày 20/10/2026 đến ngày 20/10/2026');
    const withFollowUp = renderEncounterMedicalRecordHtml(base({ treatment: { ...base().treatment!, followUpDate: '2026-10-27' } }));
    expect(withFollowUp).toContain('Từ ngày 20/10/2026 đến ngày 27/10/2026');
  });

  it('Tổng kết: diễn biến lấy Tóm tắt, rơi về quá trình bệnh lý khi chưa có Tóm tắt; "Tình trạng ra viện" lấy ô Tiên lượng đã đổi tên', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    expect(html).toContain('Quá trình bệnh lý và diễn biến lâm sàng</p><p class="note-section">Tóm tắt ngắn');
    const noSummary = renderEncounterMedicalRecordHtml(base({ notes: { ...base().notes, summary: '' } }));
    expect(noSummary).toContain('Quá trình bệnh lý và diễn biến lâm sàng</p><p class="note-section">Khởi phát 3 ngày');
    expect(html).toContain('Tình trạng người bệnh khi kết thúc khám</p><p class="note-section">Tiên lượng tốt');
  });

  it('"Đã xử lý" liệt kê thuốc đã kê kèm số lượng', () => {
    expect(renderEncounterMedicalRecordHtml(base({ prescriptionItems: rx }))).toContain('Paracetamol 500 mg × 10 VIEN');
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
    // Sinh ngày và Tuổi là HAI ô riêng (mẫu có ô "Tuổi" riêng) — không ghép chung một ô.
    expect(age('1988-10-21')).toContain('<td class="label">2. Sinh ngày</td><td>21/10/1988</td><td class="label">Tuổi</td><td>37</td>');
    expect(age('1988-10-20')).toContain('<td class="label">2. Sinh ngày</td><td>20/10/1988</td><td class="label">Tuổi</td><td>38</td>');
    expect(age('1988-10-19')).toContain('<td class="label">2. Sinh ngày</td><td>19/10/1988</td><td class="label">Tuổi</td><td>38</td>');
  });

  it('mục trống in "Chưa ghi." thay vì để trắng', () => {
    const html = renderEncounterMedicalRecordHtml(base({ notes: { reason: '', illness: '', preliminaryDiagnosis: '', generalExam: '', regionalExam: '', summary: '', prognosis: '', advice: '' } }));
    // Các ô văn bản: lý do, bệnh lý, toàn thân, bộ phận, chẩn đoán ban đầu (tờ 1); diễn biến, tình trạng ra viện, lời dặn (Tổng kết).
    expect((html.match(/Chưa ghi\./g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it('mục IV có CẢ "4. Chẩn đoán ban đầu" dạng chữ (bác sĩ nhập bắt buộc) lẫn "6. Chẩn đoán khi ra viện" kèm mã ICD-10', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    expect(html).toContain('4. Chẩn đoán ban đầu');
    expect(html).toContain('Viêm đường hô hấp trên');
    expect(html).toContain('6. Chẩn đoán khi ra viện');
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

  it('chữ ký bác sĩ + thời điểm ký ở cuối tờ khám VÀ cuối trang Tổng kết (không có ô Giám đốc bệnh viện của mẫu nội trú)', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    expect(html).toMatch(/Bác sĩ khám bệnh[\s\S]*BS\. Trần Văn Bình[\s\S]*20\/10\/2026 14:30/);
    expect((html.match(/class="sign-box"/g) ?? []).length).toBe(2);
    expect(html).not.toContain('Giám đốc');
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
    expect(off).not.toContain('079188004521');
    const opts: MedicalRecordPrintOptions = { header: { showClinicName: true, showAddress: true, showPhone: true, showTaxCode: false, showDivider: true }, title: null, footerNote: null, insurance: { show: true, whenSelfPay: 'hide' } };
    const on = renderEncounterMedicalRecordHtml(base({ insurance }), opts);
    expect(on).toContain('10. BHYT giá trị đến · Số thẻ BHYT');
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
  it('không có kết quả và không có đơn → chỉ tờ khám + trang Tổng kết (1 trang phụ)', () => {
    const html = renderEncounterMedicalRecordHtml(base());
    expect(pageBreaks(html)).toBe(1);
    expect(html).toContain('Không có kết quả cận lâm sàng.');
  });

  it('mỗi kết quả đã duyệt có MỘT trang phiếu riêng, đơn thuốc một trang: tổng trang phụ = Tổng kết + N + 1', () => {
    const html = renderEncounterMedicalRecordHtml(base({ paraclinicalResults: [cls('Công thức máu'), cls('Sinh hoá máu')], prescriptionItems: rx }));
    expect(pageBreaks(html)).toBe(4);
    expect(html).toContain('Phiếu kết quả xét nghiệm');
    expect(html).toContain('Đơn thuốc</div>');
  });

  it('mục IV.3 của tờ khám tóm tắt kết quả và nói phiếu đầy đủ ở các trang sau', () => {
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

  it('mọi phiếu kết quả/đơn thuốc mang lại tên bệnh nhân và Số lưu trữ để khỏi lẫn tờ', () => {
    const html = renderEncounterMedicalRecordHtml(base({ paraclinicalResults: [cls('Công thức máu')], prescriptionItems: rx }));
    expect((html.match(/Nguyễn Thị Hương · Mã BN BN2610000001 · Số lưu trữ LT2026-000042/g) ?? []).length).toBe(2);
  });
});

describe('renderEncounterMedicalRecordHtml — bộ hồ sơ theo bản mẫu in Bệnh án (#272)', () => {
  const header = { showClinicName: true, showAddress: true, showPhone: true, showTaxCode: false, showDivider: true };
  const options = (bundle: { includeParaclinical: boolean; includePrescriptions: boolean }): MedicalRecordPrintOptions => ({ header, title: null, footerNote: null, bundle });
  const full = () => base({ paraclinicalResults: [cls('Công thức máu'), cls('Sinh hoá máu')], prescriptionItems: rx });
  const ATTACHED = 'kèm theo ở các trang sau';

  it('không có tuỳ chọn bundle (hoặc bật hết) → kèm hết: Tổng kết + 2 phiếu + đơn = 4 trang phụ, tờ khám nhắc "kèm theo ở các trang sau"', () => {
    for (const html of [renderEncounterMedicalRecordHtml(full()), renderEncounterMedicalRecordHtml(full(), options({ includeParaclinical: true, includePrescriptions: true }))]) {
      expect(pageBreaks(html)).toBe(4);
      expect(html).toContain('Phiếu kết quả xét nghiệm');
      expect(html).toContain('Đơn thuốc</div>');
      expect(html).toContain(ATTACHED);
    }
  });

  it('tắt "Phiếu kết quả cận lâm sàng": không còn trang phiếu, tờ khám vẫn TÓM TẮT kết quả nhưng bỏ câu "kèm theo ở các trang sau"; đơn thuốc còn', () => {
    const html = renderEncounterMedicalRecordHtml(full(), options({ includeParaclinical: false, includePrescriptions: true }));
    expect(pageBreaks(html)).toBe(2);
    expect(html).not.toContain('Phiếu kết quả xét nghiệm');
    expect(html).not.toContain(ATTACHED);
    expect(html).toContain('Công thức máu');
    expect(html).toContain('Bạch cầu tăng nhẹ');
    expect(html).toContain('Đơn thuốc</div>');
  });

  it('tắt "Đơn thuốc": không còn trang đơn, nhưng thuốc vẫn nằm ở mục "Đã xử lý" của tờ khám; phiếu kết quả còn', () => {
    const html = renderEncounterMedicalRecordHtml(full(), options({ includeParaclinical: true, includePrescriptions: false }));
    expect(pageBreaks(html)).toBe(3);
    expect(html).not.toContain('Đơn thuốc</div>');
    expect(html).toContain('Paracetamol 500 mg × 10 VIEN');
    expect(html).toContain('Phiếu kết quả xét nghiệm');
    expect(html).toContain(ATTACHED);
  });

  it('tắt cả hai: chỉ còn tờ khám + trang Tổng kết (1 trang phụ); tờ khám và Tổng kết KHÔNG tắt được', () => {
    const html = renderEncounterMedicalRecordHtml(full(), options({ includeParaclinical: false, includePrescriptions: false }));
    expect(pageBreaks(html)).toBe(1);
    expect(html).toContain('Tổng kết bệnh án');
    expect(html).toContain('MS: 15/BV-01');
    expect(html).not.toContain('Phiếu kết quả xét nghiệm');
    expect(html).not.toContain('Đơn thuốc</div>');
  });
});
