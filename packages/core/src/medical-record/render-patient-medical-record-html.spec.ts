import { describe, expect, it } from 'vitest';
import { renderPatientMedicalRecordHtml, type MedicalRecordPrintOptions, type PatientMedicalRecordDocument } from './render-patient-medical-record-html';

function buildDoc(overrides: Partial<PatientMedicalRecordDocument> = {}): PatientMedicalRecordDocument {
  return {
    clinic: { name: 'Phòng khám Test', address: '123 Đường ABC', phone: '0900000000' },
    patient: {
      patientCode: 'BN00001',
      fullName: 'Nguyễn Văn A',
      dob: '1990-01-01',
      genderLabel: 'Nam',
      phone: '0912345678',
      address: 'Hà Nội',
      nationalId: '001234567890',
      occupation: 'Kỹ sư',
      ethnicity: 'Kinh',
      nationality: 'Việt Nam',
      personalHistory: 'Không có gì đặc biệt',
      allergenNames: ['Penicillin'],
      conditionNames: ['Tăng huyết áp'],
      familyHistoryLines: ['Bố: Đái tháo đường (60 tuổi)'],
    },
    encounters: [],
    generatedAt: '2026-09-15T02:00:00.000Z',
    reason: 'Bệnh nhân yêu cầu để khám chuyên khoa',
    ...overrides,
  };
}

describe('renderPatientMedicalRecordHtml', () => {
  it('chứa thông tin hành chính và tiền sử', () => {
    const html = renderPatientMedicalRecordHtml(buildDoc());
    expect(html).toContain('Nguyễn Văn A');
    expect(html).toContain('BN00001');
    expect(html).toContain('Penicillin');
    expect(html).toContain('Tăng huyết áp');
    expect(html).toContain('Bố: Đái tháo đường (60 tuổi)');
    expect(html).toContain('Bệnh nhân yêu cầu để khám chuyên khoa');
  });

  it('hiện thông báo rỗng khi bệnh nhân chưa có lượt khám nào', () => {
    const html = renderPatientMedicalRecordHtml(buildDoc());
    expect(html).toContain('chưa có lượt khám nào đã hoàn tất');
  });

  describe('kết quả cận lâm sàng đã duyệt', () => {
    const encounterBase = {
      encounterNo: 'KB-2610-000001',
      checkedInAt: '2026-10-06T01:30:00.000Z',
      doctorName: 'Trần Thị B',
      chiefComplaint: null,
      vitalSigns: null,
      diagnoses: [],
      clinicalNoteSections: [],
      prescriptionItems: [],
      signedAt: null,
    };

    it('không có kết quả → không in mục "Cận lâm sàng" (bệnh án cũ giữ nguyên)', () => {
      const html = renderPatientMedicalRecordHtml(buildDoc({ encounters: [{ ...encounterBase }] }));
      expect(html).not.toContain('<h3>Cận lâm sàng</h3>');
      const withEmpty = renderPatientMedicalRecordHtml(buildDoc({ encounters: [{ ...encounterBase, paraclinicalResults: [] }] }));
      expect(withEmpty).not.toContain('<h3>Cận lâm sàng</h3>');
    });

    it('xét nghiệm: bảng chỉ số, chỉ số vượt mức in đậm + gạch chân, in sau ghi chú khám và trước đơn thuốc', () => {
      const html = renderPatientMedicalRecordHtml(
        buildDoc({
          encounters: [
            {
              ...encounterBase,
              paraclinicalResults: [
                {
                  serviceName: 'Tổng phân tích tế bào máu',
                  serviceKind: 'LAB',
                  signedAt: '2026-10-06T03:12:00.000Z',
                  indicators: [
                    { name: 'Bạch cầu (WBC)', valueText: '12,5', referenceText: '4,0 - 10,0', unit: 'G/L', abnormal: true },
                    { name: 'Hồng cầu (RBC)', valueText: '4,6', referenceText: '3,8 - 5,2', unit: 'T/L', abnormal: false },
                  ],
                  descriptionText: null,
                  conclusionText: 'Bạch cầu tăng nhẹ',
                  imageCount: 0,
                },
              ],
            },
          ],
        }),
      );
      expect(html).toContain('<h3>Cận lâm sàng</h3>');
      expect(html).toContain('Tổng phân tích tế bào máu');
      expect(html).toContain('Xét nghiệm');
      expect(html).toContain('<td class="abnormal">12,5</td>');
      expect(html).toContain('<td>4,6</td>');
      expect(html).toContain('<strong>Nhận xét:</strong> Bạch cầu tăng nhẹ');
      expect(html.indexOf('Cận lâm sàng')).toBeGreaterThan(html.indexOf('Ghi chú khám'));
      expect(html.indexOf('Cận lâm sàng')).toBeLessThan(html.indexOf('<h3>Đơn thuốc</h3>'));
    });

    it('chẩn đoán hình ảnh: mô tả + kết luận + số ảnh, không bảng chỉ số; escape nội dung', () => {
      const html = renderPatientMedicalRecordHtml(
        buildDoc({
          encounters: [
            {
              ...encounterBase,
              paraclinicalResults: [
                { serviceName: 'Siêu âm <ổ bụng>', serviceKind: 'IMAGING', signedAt: '2026-10-06T04:00:00.000Z', indicators: [], descriptionText: 'Gan sáng', conclusionText: 'Gan nhiễm mỡ độ I', imageCount: 2 },
              ],
            },
          ],
        }),
      );
      expect(html).toContain('Siêu âm &lt;ổ bụng&gt;');
      expect(html).toContain('<strong>Mô tả hình ảnh:</strong> Gan sáng');
      expect(html).toContain('<strong>Kết luận:</strong> Gan nhiễm mỡ độ I');
      expect(html).toContain('Có 2 hình ảnh đính kèm');
      expect(html).not.toContain('Khoảng tham chiếu');
    });
  });

  it('render đủ nội dung một lượt khám: sinh hiệu/chẩn đoán/ghi chú/đơn thuốc', () => {
    const html = renderPatientMedicalRecordHtml(
      buildDoc({
        encounters: [
          {
            encounterNo: 'KB-2609-000123',
            checkedInAt: '2026-09-10T01:30:00.000Z',
            doctorName: 'Trần Thị B',
            chiefComplaint: 'Đau đầu',
            vitalSigns: {
              measuredAt: '2026-09-10T01:35:00.000Z',
              pulse: 80,
              temperatureC: 37,
              bpSystolic: 120,
              bpDiastolic: 80,
              respiratoryRate: 18,
              spo2: 98,
              weightGram: 60000,
              heightMm: 1650,
            },
            diagnoses: [{ icd10Code: 'R51', icd10Name: 'Đau đầu', type: 'PRIMARY', note: null }],
            clinicalNoteSections: [{ label: 'Lý do khám', content: 'Đau đầu 2 ngày' }],
            prescriptionItems: [
              { drugName: 'Paracetamol 500mg', doseSummary: 'Sáng 1 - Tối 1', durationDays: 5, quantity: 10, unitCode: 'VIEN', instruction: 'Sau ăn' },
            ],
            signedAt: '2026-09-10T02:00:00.000Z',
          },
        ],
      }),
    );
    expect(html).toContain('KB-2609-000123');
    expect(html).toContain('Trần Thị B');
    expect(html).toContain('Bệnh chính');
    expect(html).toContain('Đau đầu');
    expect(html).toContain('Paracetamol 500mg');
    expect(html).toContain('120/80 mmHg');
  });

  it('escape HTML trong nội dung do người dùng nhập (chống XSS trong PDF)', () => {
    const html = renderPatientMedicalRecordHtml(buildDoc({ reason: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  describe('tuỳ chọn trình bày theo bản mẫu in (Quản lý mẫu in, #211)', () => {
    const options = (overrides: Partial<MedicalRecordPrintOptions> = {}): MedicalRecordPrintOptions => ({
      header: { showClinicName: true, showAddress: true, showPhone: true, showTaxCode: false, showDivider: true },
      title: null,
      footerNote: null,
      ...overrides,
    });

    it('không truyền tuỳ chọn = bố cục mặc định như trước (tên + địa chỉ + SĐT, tiêu đề mặc định, không MST/ghi chú)', () => {
      const html = renderPatientMedicalRecordHtml(buildDoc({ clinic: { name: 'Phòng khám Test', address: '123 Đường ABC', phone: '0900000000', taxCode: '0312345678' } }));
      expect(html).toContain('Phòng khám Test');
      expect(html).toContain('123 Đường ABC · 0900000000');
      expect(html).toContain('Bệnh án bệnh nhân');
      expect(html).not.toContain('MST');
      expect(html).not.toContain('footer-note"');
    });

    it('bật Mã số thuế → in "MST: …" cùng dòng địa chỉ/SĐT', () => {
      const html = renderPatientMedicalRecordHtml(buildDoc({ clinic: { name: 'PK', address: 'ĐC', phone: '09', taxCode: '0312345678' } }), options({ header: { showClinicName: true, showAddress: true, showPhone: true, showTaxCode: true, showDivider: true } }));
      expect(html).toContain('ĐC · 09 · MST: 0312345678');
    });

    it('tắt tên/địa chỉ/SĐT/đường kẻ → không in phần đó, bỏ viền dưới đầu trang', () => {
      const html = renderPatientMedicalRecordHtml(buildDoc(), options({ header: { showClinicName: false, showAddress: false, showPhone: false, showTaxCode: false, showDivider: false } }));
      expect(html).not.toContain('<div class="clinic-name">');
      expect(html).not.toContain('123 Đường ABC');
      expect(html).toContain('style="border-bottom: none;"');
    });

    it('tiêu đề tuỳ chỉnh thay tiêu đề mặc định (và được escape); ghi chú cuối in trước dòng "Xuất lúc"', () => {
      const html = renderPatientMedicalRecordHtml(buildDoc(), options({ title: 'HỒ SƠ <b>KHÁM</b>', footerNote: 'Giữ bí mật y khoa' }));
      expect(html).toContain('HỒ SƠ &lt;b&gt;KHÁM&lt;/b&gt;');
      expect(html).not.toContain('Bệnh án bệnh nhân');
      expect(html.indexOf('Giữ bí mật y khoa')).toBeGreaterThan(-1);
      expect(html.indexOf('Giữ bí mật y khoa')).toBeLessThan(html.indexOf('Xuất lúc'));
    });
  });

  describe('Điều trị & Hẹn tái khám (#222)', () => {
    const encounter = {
      encounterNo: 'KB-2610-000002',
      checkedInAt: '2026-10-08T01:30:00.000Z',
      doctorName: 'Trần Thị B',
      chiefComplaint: null,
      vitalSigns: null,
      diagnoses: [],
      clinicalNoteSections: [{ label: 'Kết luận', content: 'Viêm phế quản cấp, chưa biến chứng' }],
      prescriptionItems: [],
      signedAt: null,
    };

    it('in mục "Điều trị" đủ hướng điều trị, nội dung điều trị, lời dặn, hẹn tái khám; Kết luận nằm trong ghi chú khám', () => {
      const html = renderPatientMedicalRecordHtml(
        buildDoc({
          encounters: [
            {
              ...encounter,
              treatment: { directionLabels: ['Kê đơn thuốc', 'Hẹn tái khám'], content: 'Kháng sinh 7 ngày', advice: 'Giữ ấm <b>tránh</b> khói bụi', followUpDateLabel: 'Thứ Năm, 15/10/2026' },
            },
          ],
        }),
      );
      expect(html).toContain('<h3>Điều trị</h3>');
      expect(html).toContain('<strong>Hướng điều trị:</strong> Kê đơn thuốc; Hẹn tái khám');
      expect(html).toContain('<strong>Nội dung điều trị:</strong> Kháng sinh 7 ngày');
      expect(html).toContain('Giữ ấm &lt;b&gt;tránh&lt;/b&gt; khói bụi');
      expect(html).toContain('<strong>Hẹn tái khám:</strong> Thứ Năm, 15/10/2026');
      expect(html).toContain('<strong>Kết luận:</strong> Viêm phế quản cấp, chưa biến chứng');
    });

    it('chỉ in dòng có nội dung; không có gì thì bỏ cả mục (bệnh án cũ giữ nguyên)', () => {
      const partial = renderPatientMedicalRecordHtml(
        buildDoc({ encounters: [{ ...encounter, treatment: { directionLabels: [], content: '', advice: 'Uống thuốc đúng giờ', followUpDateLabel: null } }] }),
      );
      expect(partial).toContain('<strong>Lời dặn bác sĩ:</strong> Uống thuốc đúng giờ');
      expect(partial).not.toContain('Hướng điều trị:');
      expect(partial).not.toContain('Hẹn tái khám:');
      const empty = renderPatientMedicalRecordHtml(buildDoc({ encounters: [{ ...encounter, treatment: { directionLabels: [], content: '  ', advice: '', followUpDateLabel: null } }] }));
      expect(empty).not.toContain('<h3>Điều trị</h3>');
      const absent = renderPatientMedicalRecordHtml(buildDoc({ encounters: [{ ...encounter }] }));
      expect(absent).not.toContain('<h3>Điều trị</h3>');
    });

    it('giữ xuống dòng của lời dặn nhiều dòng (CSS pre-line trên .note-section)', () => {
      const html = renderPatientMedicalRecordHtml(
        buildDoc({ encounters: [{ ...encounter, treatment: { directionLabels: [], content: '', advice: 'Uống thuốc đúng giờ.\nTái khám nếu sốt cao.', followUpDateLabel: null } }] }),
      );
      expect(html).toContain('Uống thuốc đúng giờ.\nTái khám nếu sốt cao.');
      expect(html).toMatch(/\.note-section\s*\{[^}]*white-space:\s*pre-line/);
    });
  });
});
