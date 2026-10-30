import { describe, expect, it } from 'vitest';
import type { ConsultationDetailResponse, EncounterInsurance, PatientEncounterHistoryItem } from '@nexamed/shared';
import {
  buildAdminFields,
  buildSheetAdminFields,
  buildFieldGroups,
  buildMedicalRecordView,
  buildVitals,
  bundleSummary,
  computeBmi,
  formatVnNumber,
  summarizeSignatures,
  type ParaclinicalResult,
  type RecordPatientInfo,
} from './medical-record-model';

const PATIENT: RecordPatientInfo = {
  patientCode: 'BN2610000001',
  fullName: 'Nguyễn Thị Hương',
  dob: '04/03/1988',
  age: '38 tuổi',
  gender: 'Nữ',
  occupation: 'Giáo viên',
  ethnicity: 'Kinh',
  nationality: 'Việt Nam',
  nationalId: '079188004521',
  phone: '0903112455',
  address: '125/4 Nguyễn Thị Minh Khai, Bến Thành, TP. Hồ Chí Minh',
  relative: 'Trần Văn Khoa (chồng) — 0908774112',
};

const BHYT: EncounterInsurance = {
  selfPay: false,
  reason: null,
  cardNo: '079188004521',
  cardNoUnreadable: false,
  kind: null,
  validFrom: null,
  validTo: null,
  facilityCode: null,
  facilityName: null,
  benefitRate: 80,
};

const note = (content: string, extra: Partial<{ signedAt: string | null; amendmentReason: string | null; supersedesId: string | null }> = {}) => ({
  content,
  version: 1,
  signedAt: '2026-10-20T07:30:00.000Z',
  signedBy: null,
  supersedesId: null,
  amendmentReason: null,
  ...extra,
});

function detail(overrides: Partial<ConsultationDetailResponse> = {}): ConsultationDetailResponse {
  return {
    encounter: { id: 'e1', encounterNo: 'LK0042', archiveNo: 'LT2026-000042', completedAt: '2026-10-20T07:40:00.000Z', chiefComplaint: 'Ho 3 ngày' },
    patient: {
      id: 'p1',
      patientCode: 'BN1',
      fullName: 'x',
      dob: '1988-03-04',
      gender: 'female',
      phone: '0',
      personalHistory: 'Không hút thuốc',
      allergens: [{ id: 'a', name: 'Penicillin', allergenGroupName: 'Kháng sinh' }],
      conditions: [{ icd10Code: 'E11.9', icd10Name: 'Đái tháo đường type 2' }],
      familyHistoryRows: [{ id: 'f', relation: 'MOTHER', relationLabel: 'Mẹ', icd10Code: 'I10', icd10Name: 'Tăng huyết áp', ageOfOnsetYears: null }],
      version: 1,
    },
    vitalSigns: { id: 'v', encounterId: 'e1', pulse: 88, temperatureC: 38.2, bpSystolic: 118, bpDiastolic: 76, respiratoryRate: 18, spo2: 98, weightGram: 54000, heightMm: 1580, measuredAt: '2026-10-20T01:00:00.000Z', warnings: [] },
    insurance: null,
    history: [],
    diagnoses: [
      { id: 'd2', icd10Code: 'J02.9', icd10Name: 'Viêm họng cấp', type: 'SECONDARY', note: null, signedAt: '2026-10-20T07:30:00.000Z', signedBy: null, supersedesId: null, amendmentReason: null, version: 1 },
      { id: 'd1', icd10Code: 'J06.9', icd10Name: 'Nhiễm khuẩn hô hấp trên', type: 'PRIMARY', note: null, signedAt: '2026-10-20T07:30:00.000Z', signedBy: null, supersedesId: null, amendmentReason: null, version: 1 },
    ],
    clinicalNote: {
      reasonForVisit: note('Ho khan, sốt nhẹ'),
      illnessProgress: note('Khởi phát 3 ngày'),
      preliminaryDiagnosis: note('Viêm hô hấp'),
      generalExam: note('Tỉnh'),
      regionalExam: note('Phổi không rales'),
      plan: null,
      conclusion: null,
      doctorAdvice: note('Uống nhiều nước'),
      summary: null,
      prognosis: null,
      treatmentPlan: { directions: ['PRESCRIPTION', 'FOLLOW_UP'], followUpDate: '2026-10-27', version: 1, signedAt: '2026-10-20T07:30:00.000Z', signedBy: null, supersedesId: null, amendmentReason: null },
    },
    prescription: null,
    ...overrides,
  } as unknown as ConsultationDetailResponse;
}

const item: PatientEncounterHistoryItem = {
  encounterId: 'e1',
  encounterNo: 'LK0042',
  archiveNo: 'LT2026-000042',
  status: 'COMPLETED',
  checkedInAt: '2026-10-20T01:15:00.000Z',
  examTypeName: null,
  receptionTypeCode: null,
  doctorName: 'BS. Trần Văn Bình',
  departmentName: 'Khoa Nội',
  reason: null,
  clinical: null,
  billing: null,
  branchName: 'Chi nhánh Quận 1',
  isOtherBranch: false,
  billingHidden: false,
  insurance: null,
};

const cls = (over: Partial<ParaclinicalResult> = {}): ParaclinicalResult => ({
  itemId: 'i1',
  serviceName: 'Tổng phân tích tế bào máu',
  serviceKind: 'LAB',
  signedAt: '2026-10-20T03:05:00.000Z',
  indicators: [],
  descriptionText: null,
  conclusionText: 'Bạch cầu tăng nhẹ',
  imageCount: 0,
  ...over,
});

describe('số và BMI', () => {
  it('định dạng số kiểu Việt, bỏ phần thập phân thừa', () => {
    expect(formatVnNumber(36.8)).toBe('36,8');
    expect(formatVnNumber(54)).toBe('54');
    expect(formatVnNumber(158, 0)).toBe('158');
  });

  it('BMI = kg / m² làm tròn 1 chữ số; thiếu cân nặng hoặc chiều cao → null', () => {
    expect(computeBmi(54000, 1580)).toBe(21.6);
    expect(computeBmi(null, 1580)).toBeNull();
    expect(computeBmi(54000, null)).toBeNull();
    expect(computeBmi(54000, 0)).toBeNull();
  });
});

describe('buildVitals — luôn đủ 8 ô, thiếu thì gạch ngang', () => {
  it('đủ chỉ số', () => {
    const v = buildVitals(detail().vitalSigns);
    expect(v.map((x) => x.label)).toEqual(['Mạch', 'Nhiệt độ', 'Huyết áp', 'Nhịp thở', 'SpO₂', 'Cân nặng', 'Chiều cao', 'BMI']);
    expect(v.find((x) => x.label === 'Nhiệt độ')?.value).toBe('38,2 °C');
    expect(v.find((x) => x.label === 'Huyết áp')?.value).toBe('118/76 mmHg');
    expect(v.find((x) => x.label === 'Cân nặng')?.value).toBe('54 kg');
    expect(v.find((x) => x.label === 'Chiều cao')?.value).toBe('158 cm');
    expect(v.find((x) => x.label === 'BMI')?.value).toBe('21,6');
  });

  it('chưa đo gì → 8 ô gạch ngang', () => {
    const v = buildVitals(null);
    expect(v).toHaveLength(8);
    expect(v.every((x) => x.value === '—')).toBe(true);
  });

  it('chỉ có tâm thu (thiếu tâm trương) → huyết áp gạch ngang, không in "118/null"', () => {
    const base = detail().vitalSigns!;
    expect(buildVitals({ ...base, bpDiastolic: null }).find((x) => x.label === 'Huyết áp')?.value).toBe('—');
  });
});

describe('buildAdminFields', () => {
  const enc = { archiveNo: 'LT2026-000042', encounterNo: 'LK0042', checkedInAt: '2026-10-20T01:15:00.000Z', doctorName: 'BS. Bình', departmentName: 'Khoa Nội', branchName: 'CN Q1', insurance: null };

  it('Số lưu trữ đứng đầu; tách khỏi mã phiếu khám; giờ vào khám theo giờ Việt Nam', () => {
    const f = buildAdminFields(PATIENT, enc, false);
    expect(f[0]).toEqual({ label: 'Số lưu trữ', value: 'LT2026-000042' });
    expect(f[1]).toEqual({ label: 'Mã phiếu khám', value: 'LK0042' });
    expect(f.find((x) => x.label === 'Vào khám lúc')?.value).toBe('20/10/2026 08:15');
  });

  it('lượt khám cũ chưa có Số lưu trữ → gạch ngang (không rỗng, không "null")', () => {
    expect(buildAdminFields(PATIENT, { ...enc, archiveNo: null }, false)[0]?.value).toBe('—');
  });

  it('công ty 1 chi nhánh: KHÔNG có ô Chi nhánh; từ 2 chi nhánh: có', () => {
    expect(buildAdminFields(PATIENT, enc, false).some((x) => x.label === 'Chi nhánh')).toBe(false);
    expect(buildAdminFields(PATIENT, enc, true).find((x) => x.label === 'Chi nhánh')?.value).toBe('CN Q1');
  });

  it('công tắc BHYT tắt (insurance=null) → không có Đối tượng/Số thẻ; bật → có; tự chi trả → Thu phí', () => {
    expect(buildAdminFields(PATIENT, enc, false).some((x) => x.label === 'Đối tượng')).toBe(false);
    const withCard = buildAdminFields(PATIENT, { ...enc, insurance: BHYT }, false);
    expect(withCard.find((x) => x.label === 'Đối tượng')?.value).toBe('BHYT');
    expect(withCard.find((x) => x.label === 'Số thẻ BHYT')?.value).toBe('079188004521');
    const selfPay = buildAdminFields(PATIENT, { ...enc, insurance: { ...BHYT, selfPay: true, cardNo: null } }, false);
    expect(selfPay.find((x) => x.label === 'Đối tượng')?.value).toBe('Thu phí');
    expect(selfPay.find((x) => x.label === 'Số thẻ BHYT')?.value).toBe('—');
  });

  it('thẻ có nhưng KHÔNG giải mã được → "Không đọc được", không bao giờ in nhầm thành Thu phí (#262)', () => {
    const f = buildAdminFields(PATIENT, { ...enc, insurance: { ...BHYT, cardNo: null, cardNoUnreadable: true } }, false);
    expect(f.find((x) => x.label === 'Đối tượng')?.value).toBe('BHYT');
    expect(f.find((x) => x.label === 'Số thẻ BHYT')?.value).toBe('Không đọc được');
  });

  it('địa chỉ và người cần báo tin chiếm 2 ô', () => {
    const f = buildAdminFields(PATIENT, enc, false);
    expect(f.find((x) => x.label === 'Địa chỉ')?.wide).toBe(true);
    expect(f.find((x) => x.label === 'Khi cần báo tin cho')?.wide).toBe(true);
  });
});

describe('buildSheetAdminFields — mục I đủ 13 ô theo số thứ tự mẫu MS 15/BV-01', () => {
  const enc = { checkedInAt: '2026-10-20T01:15:00.000Z', insurance: null as EncounterInsurance | null };

  it('đủ 13 ô đánh số 1…13 theo đúng thứ tự mẫu', () => {
    const f = buildSheetAdminFields(PATIENT, enc);
    expect(f.map((x) => Number.parseInt(x.label, 10)).filter((n) => !Number.isNaN(n))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(f[0]).toEqual({ label: '1. Họ và tên (in hoa)', value: 'NGUYỄN THỊ HƯƠNG', wide: true });
    // Sinh ngày và Tuổi là hai ô riêng, không ghép chung một chuỗi.
    expect(f[1]).toEqual({ label: '2. Sinh ngày', value: '04/03/1988' });
    expect(f[2]).toEqual({ label: 'Tuổi', value: '38 tuổi' });
    expect(f.find((x) => x.label.startsWith('12.'))?.value).toBe('20/10/2026 08:15');
  });

  it('Nơi làm việc và Chẩn đoán nơi giới thiệu: hệ thống chưa lưu → gạch ngang', () => {
    const f = buildSheetAdminFields(PATIENT, enc);
    expect(f.find((x) => x.label.startsWith('8.'))?.value).toBe('—');
    expect(f.find((x) => x.label.startsWith('13.'))?.value).toBe('—');
  });

  it('địa chỉ, BHYT và người nhà chiếm 2 ô', () => {
    const f = buildSheetAdminFields(PATIENT, enc);
    for (const n of ['7.', '10.', '11.']) expect(f.find((x) => x.label.startsWith(n))?.wide).toBe(true);
  });

  it('Đối tượng suy từ thẻ BHYT: công tắc tắt → —; có thẻ → BHYT kèm số thẻ + hạn; tự chi trả → Thu phí; không giải mã được → BHYT + "Không đọc được"', () => {
    const obj = (insurance: EncounterInsurance | null) => buildSheetAdminFields(PATIENT, { ...enc, insurance });
    expect(obj(null).find((x) => x.label.startsWith('9.'))?.value).toBe('—');
    expect(obj(null).find((x) => x.label.startsWith('10.'))?.value).toBe('—');
    const withCard = obj({ ...BHYT, validTo: '2026-12-31T00:00:00.000Z' });
    expect(withCard.find((x) => x.label.startsWith('9.'))?.value).toBe('BHYT');
    expect(withCard.find((x) => x.label.startsWith('10.'))?.value).toBe('079188004521 · đến 31/12/2026');
    const selfPay = obj({ ...BHYT, selfPay: true, cardNo: null });
    expect(selfPay.find((x) => x.label.startsWith('9.'))?.value).toBe('Thu phí');
    expect(selfPay.find((x) => x.label.startsWith('10.'))?.value).toBe('—');
    const unreadable = obj({ ...BHYT, cardNo: null, cardNoUnreadable: true });
    expect(unreadable.find((x) => x.label.startsWith('9.'))?.value).toBe('BHYT');
    expect(unreadable.find((x) => x.label.startsWith('10.'))?.value).toBe('Không đọc được');
  });
});

describe('summarizeSignatures — mốc ký gốc và vết đính chính', () => {
  it('chưa đính chính: mốc ký = mốc sớm nhất, không có dòng vết', () => {
    const r = summarizeSignatures(detail());
    expect(r.signedAt).toBe('2026-10-20T07:30:00.000Z');
    expect(r.amendNote).toBeNull();
  });

  it('đã đính chính chẩn đoán: giữ mốc ký GỐC, hiện nhãn mục đã đính chính + ngày mới nhất', () => {
    const d = detail({
      diagnoses: [
        { id: 'd1', icd10Code: 'J06.9', icd10Name: 'x', type: 'PRIMARY', note: null, signedAt: '2026-10-22T03:00:00.000Z', signedBy: null, supersedesId: 'old', amendmentReason: 'Nhầm mã', version: 2 },
      ],
    });
    const r = summarizeSignatures(d);
    expect(r.signedAt).toBe('2026-10-20T07:30:00.000Z');
    expect(r.amendNote).toBe('Có đính chính: Chẩn đoán (mới nhất 22/10/2026)');
  });

  it('nhiều mục đính chính: liệt kê mỗi mục một lần', () => {
    const d = detail({
      clinicalNote: {
        ...detail().clinicalNote,
        conclusion: note('Kết luận mới', { signedAt: '2026-10-23T03:00:00.000Z', amendmentReason: 'Bổ sung', supersedesId: 's' }),
        summary: note('Tóm tắt mới', { signedAt: '2026-10-24T03:00:00.000Z', amendmentReason: 'Bổ sung', supersedesId: null }),
      },
    });
    const r = summarizeSignatures(d);
    expect(r.amendNote).toBe('Có đính chính: Kết luận, Tóm tắt bệnh án (mới nhất 24/10/2026)');
  });

  it('không có mục nào được ký → rơi về mốc hoàn tất lượt khám', () => {
    const unsigned = note('x', { signedAt: null });
    const d = detail({
      diagnoses: [],
      clinicalNote: { ...detail().clinicalNote, reasonForVisit: unsigned, illnessProgress: null, preliminaryDiagnosis: null, generalExam: null, regionalExam: null, doctorAdvice: null, treatmentPlan: null },
    });
    expect(summarizeSignatures(d).signedAt).toBe('2026-10-20T07:40:00.000Z');
  });
});

describe('buildMedicalRecordView', () => {
  const base = { item, detail: detail(), paraclinical: [cls()], patient: PATIENT, showBranch: false };

  it('chẩn đoán chính xếp trước chẩn đoán kèm theo', () => {
    const v = buildMedicalRecordView(base);
    expect(v.diagnoses.map((d) => [d.code, d.primary])).toEqual([
      ['J06.9', true],
      ['J02.9', false],
    ]);
  });

  it('chẩn đoán sơ bộ dạng chữ có mặt trong hồ sơ và trong bảng trường dữ liệu', () => {
    const v = buildMedicalRecordView(base);
    expect(v.preliminaryDiagnosis).toBe('Viêm hô hấp');
    const row = buildFieldGroups(v, 'BS.').find((g) => g.title === 'Chẩn đoán')?.rows[0];
    expect(row).toMatchObject({ field: 'Chẩn đoán sơ bộ', value: 'Viêm hô hấp' });
  });

  it('Tóm tắt/Tiên lượng chưa ghi → chuỗi rỗng (giao diện tự hiện "chưa ghi")', () => {
    const v = buildMedicalRecordView(base);
    expect(v.summary).toBe('');
    expect(v.prognosis).toBe('');
  });

  it('Tóm tắt/Tiên lượng đã ghi → hiện đúng nội dung', () => {
    const d = detail({ clinicalNote: { ...detail().clinicalNote, summary: note('Tóm tắt ngắn'), prognosis: note('Tiên lượng tốt') } });
    const v = buildMedicalRecordView({ ...base, detail: d });
    expect(v.summary).toBe('Tóm tắt ngắn');
    expect(v.prognosis).toBe('Tiên lượng tốt');
  });

  it('lý do khám: ưu tiên ghi chú đã ký, rơi về lý do tiếp nhận khi chưa có', () => {
    expect(buildMedicalRecordView(base).reason).toBe('Ho khan, sốt nhẹ');
    const d = detail({ clinicalNote: { ...detail().clinicalNote, reasonForVisit: null } });
    expect(buildMedicalRecordView({ ...base, detail: d }).reason).toBe('Ho 3 ngày');
  });

  it('hẹn tái khám chỉ hiện khi đã chọn hướng "Hẹn tái khám"', () => {
    expect(buildMedicalRecordView(base).followUp).toBe('Thứ Ba, 27/10/2026');
    const d = detail({ clinicalNote: { ...detail().clinicalNote, treatmentPlan: { ...detail().clinicalNote.treatmentPlan!, directions: ['PRESCRIPTION'] } } });
    expect(buildMedicalRecordView({ ...base, detail: d }).followUp).toBeNull();
  });

  it('tiền sử, dị ứng và gia đình lấy từ hồ sơ bệnh nhân', () => {
    const v = buildMedicalRecordView(base);
    expect(v.conditions).toEqual([{ code: 'E11.9', name: 'Đái tháo đường type 2' }]);
    expect(v.allergies).toEqual(['Penicillin']);
    expect(v.familyHistory).toEqual(['Mẹ: I10 Tăng huyết áp']);
    expect(v.personalHistoryNote).toBe('Không hút thuốc');
  });

  it('Số lưu trữ lấy từ danh sách lịch sử, rơi về chi tiết lượt khám; lượt cũ chưa có thì null', () => {
    expect(buildMedicalRecordView(base).archiveNo).toBe('LT2026-000042');
    expect(buildMedicalRecordView({ ...base, item: { ...item, archiveNo: null }, detail: detail({ encounter: { ...detail().encounter, archiveNo: null } as never }) }).archiveNo).toBeNull();
  });

  it('mã hồ sơ = mã bệnh nhân; nhãn Khám mới/Tái khám lấy từ Loại tiếp nhận, không có thì null', () => {
    expect(buildMedicalRecordView(base).patientCode).toBe('BN2610000001');
    expect(buildMedicalRecordView(base).visitTypeLabel).toBeNull();
    expect(buildMedicalRecordView({ ...base, visitTypeLabel: 'Tái khám' }).visitTypeLabel).toBe('Tái khám');
  });

  it('"Điều trị ngoại trú": từ = ngày khám, đến = ngày hẹn tái khám nếu có, không thì bằng ngày khám', () => {
    expect(buildMedicalRecordView(base).treatmentPeriod).toBe('Từ ngày 20/10/2026 đến ngày 27/10/2026');
    const d = detail({ clinicalNote: { ...detail().clinicalNote, treatmentPlan: { ...detail().clinicalNote.treatmentPlan!, directions: ['PRESCRIPTION'] } } });
    expect(buildMedicalRecordView({ ...base, detail: d }).treatmentPeriod).toBe('Từ ngày 20/10/2026 đến ngày 20/10/2026');
  });

  it('KHÔNG có bất kỳ trường tiền nào trong hồ sơ bệnh án', () => {
    expect(JSON.stringify(buildMedicalRecordView({ ...base, item: { ...item, billing: { netAmount: 150000, paymentState: 'PAID' } } }))).not.toMatch(/netAmount|paymentState|150000/);
  });
});

describe('bundleSummary — bộ hồ sơ in chỉ kể thứ thật sự có', () => {
  const sealed = { signedAt: '2026-10-20T07:30:00.000Z', documents: [] } as unknown as ConsultationDetailResponse['prescription'];
  it('chỉ tờ khám', () => {
    expect(bundleSummary({ cls: [], prescription: null })).toBe('Tờ khám theo mẫu');
  });
  it('tờ khám + phiếu kết quả + đơn thuốc đã ký', () => {
    expect(bundleSummary({ cls: [cls(), cls({ itemId: 'i2' })], prescription: sealed })).toBe('Tờ khám theo mẫu + 2 phiếu kết quả + 1 đơn thuốc');
  });
  it('đơn thuốc còn nháp (chưa ký) không tính vào bộ hồ sơ', () => {
    expect(bundleSummary({ cls: [], prescription: { signedAt: null, documents: [] } as unknown as ConsultationDetailResponse['prescription'] })).toBe('Tờ khám theo mẫu');
  });
  it('đơn tách thành nhiều đơn pháp lý (C/N/H) → đếm đúng số đơn', () => {
    const three = { signedAt: '2026-10-20T07:30:00.000Z', documents: [{ kind: 'C', nationalCode: 'a' }, { kind: 'N', nationalCode: 'b' }, { kind: 'H', nationalCode: 'c' }] } as unknown as ConsultationDetailResponse['prescription'];
    expect(bundleSummary({ cls: [], prescription: three })).toBe('Tờ khám theo mẫu + 3 đơn thuốc');
  });
});

describe('buildFieldGroups — bảng "Theo trường dữ liệu"', () => {
  const view = buildMedicalRecordView({ item, detail: detail(), paraclinical: [cls()], patient: PATIENT, showBranch: false });
  const groups = buildFieldGroups(view, 'BS. Trần Văn Bình');
  const rowOf = (title: string, field: string) => groups.find((g) => g.title === title)?.rows.find((r) => r.field === field);

  it('nhóm Lượt khám có Số ngoại trú, Số lưu trữ, mã hồ sơ; không còn nhãn "Số bệnh án"', () => {
    const labels = groups.find((g) => g.title === 'Lượt khám')!.rows.map((r) => r.field);
    expect(labels.slice(0, 4)).toEqual(['Số ngoại trú (mã phiếu khám)', 'Số lưu trữ', 'Hồ sơ (mã bệnh nhân)', 'Loại khám']);
    expect(JSON.stringify(groups)).not.toContain('Số bệnh án');
  });

  it('ô Tiên lượng đổi nhãn thành "Tình trạng người bệnh khi kết thúc khám"', () => {
    expect(rowOf('Ghi chú khám', 'Tình trạng người bệnh khi kết thúc khám')).toBeDefined();
    expect(rowOf('Ghi chú khám', 'Tiên lượng')).toBeUndefined();
  });

  it('đủ các nhóm theo thứ tự mockup', () => {
    expect(groups.map((g) => g.title)).toEqual(['Lượt khám', 'Hành chính bệnh nhân', 'Sinh hiệu', 'Ghi chú khám', 'Chẩn đoán', 'Cận lâm sàng', 'Điều trị và đơn thuốc']);
  });

  it('không trường nào mang nhãn "mới" (đó là chú thích mockup, không phải nội dung sản phẩm)', () => {
    expect(groups.flatMap((g) => g.rows).some((r) => 'isNew' in r)).toBe(false);
    expect(JSON.stringify(groups)).not.toMatch(/TRƯỜNG MỚI|"MỚI"/);
  });

  it('mục tuỳ chọn chưa ghi: giá trị và người ghi đều gạch ngang, không kèm câu giải thích nào', () => {
    const r = rowOf('Ghi chú khám', 'Tóm tắt bệnh án')!;
    expect(r.value).toBe('—');
    expect(r.who).toEqual({ name: '—', time: '' });
  });

  it('không ô nào chứa câu chú thích kiểu "dùng chung mọi lượt khám" / "không chặn hoàn tất khám"', () => {
    expect(JSON.stringify(groups)).not.toMatch(/Dùng chung|không chặn|Từ cân nặng/);
  });

  it('mục bác sĩ đã ký: người ghi là bác sĩ, thời điểm theo giờ Việt Nam', () => {
    expect(rowOf('Ghi chú khám', 'Lý do đến khám')?.who).toEqual({ name: 'BS. Trần Văn Bình', time: '20/10/2026 14:30' });
  });

  it('hành chính bệnh nhân: ghi rõ "dùng chung mọi lượt khám", không phải do bác sĩ ký', () => {
    expect(rowOf('Hành chính bệnh nhân', 'Họ và tên')?.who.name).toBe('Hồ sơ bệnh nhân');
  });

  it('BMI do hệ thống tính; các chỉ số khác do điều dưỡng ghi', () => {
    expect(rowOf('Sinh hiệu', 'BMI')?.who.name).toBe('Hệ thống tính');
    expect(rowOf('Sinh hiệu', 'Mạch')?.who.name).toBe('Điều dưỡng');
  });

  it('chẩn đoán đã đính chính: thời điểm kèm dòng vết đính chính', () => {
    const d = detail({ diagnoses: [{ id: 'd1', icd10Code: 'J06.9', icd10Name: 'x', type: 'PRIMARY', note: null, signedAt: '2026-10-22T03:00:00.000Z', signedBy: null, supersedesId: 'o', amendmentReason: 'Nhầm', version: 2 }] });
    const v = buildMedicalRecordView({ item, detail: d, paraclinical: [], patient: PATIENT, showBranch: false });
    const icdRow = buildFieldGroups(v, 'BS. A').find((g) => g.title === 'Chẩn đoán')?.rows.find((r) => r.field === 'Chẩn đoán chính');
    expect(icdRow?.who.time).toContain('Có đính chính: Chẩn đoán');
  });

  it('không lộ tên bảng/cột kỹ thuật ở bất kỳ ô nào', () => {
    expect(JSON.stringify(groups)).not.toMatch(/encounter\.|patient\.|clinical_note|vital_sign|_id\b|archive_no/);
  });

  it('công ty 1 chi nhánh: không có dòng Chi nhánh trong nhóm Lượt khám', () => {
    expect(rowOf('Lượt khám', 'Chi nhánh')).toBeUndefined();
  });

  it('không có cận lâm sàng → bỏ hẳn nhóm Cận lâm sàng (không hiện bảng rỗng)', () => {
    const v = buildMedicalRecordView({ item, detail: detail(), paraclinical: [], patient: PATIENT, showBranch: false });
    expect(buildFieldGroups(v, 'BS.').some((g) => g.title === 'Cận lâm sàng')).toBe(false);
  });
});
