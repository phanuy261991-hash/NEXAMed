import { describe, expect, it } from 'vitest';
import { renderPatientMedicalRecordHtml, type PatientMedicalRecordDocument } from './render-patient-medical-record-html';

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
              { drugName: 'Paracetamol 500mg', dose: '1 viên', frequency: '2 lần/ngày', durationDays: 5, quantity: 10, instruction: 'Sau ăn' },
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
});
