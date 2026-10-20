import { describe, expect, it } from 'vitest';
import { blockingInteropProblems, buildGuiDonThuocPayload, checkInteropReadiness, computeFollowUpDays, toGatewayDate, toGatewayDateTime, toGatewayGender, type InteropSubmissionInput } from './submission';

const base = (over: Partial<InteropSubmissionInput> = {}): InteropSubmissionInput => ({
  kind: 'C',
  nationalCode: '790010000043-C',
  prescribedAt: new Date('2026-10-16T02:42:05.000Z'), // 09:42:05 giờ Việt Nam
  patient: {
    fullName: 'Lê Quang Huy',
    dob: '1978-03-12',
    gender: 'male',
    phone: '0933 555 666',
    nationalId: '079178001234',
    insuranceNumber: null,
    address: '12 Trần Thái Tông, Dịch Vọng, Hà Nội',
    weightGram: 62_500,
    ageMonths: 580,
    guardian: { fullName: null, phone: null, address: null },
  },
  diagnoses: [{ code: 'J20.9', name: 'Viêm phế quản cấp, không đặc hiệu', note: null }],
  conclusion: 'Theo dõi tại nhà',
  doctorLicenseNo: '004567/HNO-CCHN',
  doctorAdvice: 'Uống sau ăn.',
  followUpDays: 7,
  treatmentFormCode: '1',
  dosePeriod: null,
  herbalDoses: null,
  herbalInstruction: null,
  items: [
    { isFreeText: false, drugName: 'Amoxicillin 500mg', drugNationalCode: 'A'.repeat(20), activeIngredient: 'Amoxicillin', unitName: 'Viên', quantity: 14, doseSummary: 'Sáng 1 - Tối 1', durationDays: 7, instruction: 'sau ăn' },
  ],
  ...over,
});

describe('buildGuiDonThuocPayload — đúng tên trường tài liệu QĐ 808 (mục VII)', () => {
  it('đơn C đủ dữ liệu: đúng tập khoá, kiểu và định dạng (giờ VN, d/m/Y, giới tính số, loại đơn chữ thường)', () => {
    const p = buildGuiDonThuocPayload(base());
    expect(Object.keys(p).sort()).toEqual(
      ['can_nang', 'chan_doan', 'dia_chi', 'gioi_tinh', 'hinh_thuc_dieu_tri', 'ho_ten_benh_nhan', 'loai_don_thuoc', 'loi_dan', 'luu_y', 'ma_dinh_danh_cong_dan', 'ma_don_thuoc', 'ngay_gio_ke_don', 'ngay_sinh_benh_nhan', 'ngay_tai_kham', 'so_dien_thoai_nguoi_kham_benh', 'thong_tin_don_thuoc'].sort(),
    );
    expect(p).toMatchObject({
      loai_don_thuoc: 'c',
      ma_don_thuoc: '790010000043-C',
      ho_ten_benh_nhan: 'Lê Quang Huy',
      ngay_sinh_benh_nhan: '12/03/1978',
      gioi_tinh: 2,
      can_nang: 62.5,
      hinh_thuc_dieu_tri: 1,
      ngay_tai_kham: 7,
      ngay_gio_ke_don: '2026-10-16 09:42:05',
      so_dien_thoai_nguoi_kham_benh: '0933555666',
      ma_dinh_danh_cong_dan: '079178001234',
    });
    expect(p.chan_doan).toEqual([{ ma_chan_doan: 'J20.9', ten_chan_doan: 'Viêm phế quản cấp, không đặc hiệu', ket_luan: 'Theo dõi tại nhà' }]);
    expect(p.thong_tin_don_thuoc[0]).toEqual({ ma_thuoc: 'A'.repeat(20), biet_duoc: 'Amoxicillin', ten_thuoc: 'Amoxicillin 500mg', don_vi_tinh: 'Viên', so_luong: 14, cach_dung: 'Sáng 1 - Tối 1, 7 ngày, sau ăn' });
    expect(Object.keys(p.thong_tin_don_thuoc[0]!).sort()).toEqual(['biet_duoc', 'cach_dung', 'don_vi_tinh', 'ma_thuoc', 'so_luong', 'ten_thuoc']);
    expect(p).not.toHaveProperty('signature');
    expect(p).not.toHaveProperty('dot_dung_thuoc');
  });

  it('đơn N/H có đợt dùng thuốc, KHÔNG có hình thức điều trị; đơn Y có số thang, biệt dược = tên dược liệu, lời dặn gộp cách sắc', () => {
    const n = buildGuiDonThuocPayload(base({ kind: 'N', nationalCode: '790010000044-N', treatmentFormCode: '1', dosePeriod: { number: 1, from: '2026-10-16', to: '2026-10-18' } }));
    expect(n.loai_don_thuoc).toBe('n');
    expect(n.dot_dung_thuoc).toEqual([{ dot: 1, tu_ngay: '16/10/2026', den_ngay: '18/10/2026' }]);
    expect(n).not.toHaveProperty('hinh_thuc_dieu_tri');

    const y = buildGuiDonThuocPayload(
      base({ kind: 'Y', nationalCode: '790010000045-Y', dosePeriod: { number: 1, from: '2026-10-16', to: '2026-10-25' }, herbalDoses: 7, herbalInstruction: 'Sắc 3 chén còn 1 chén.', items: [{ ...base().items[0]!, drugName: 'Cao khô Actiso', activeIngredient: 'Cynara' }] }),
    );
    expect(y.dot_dung_thuoc).toEqual([{ dot: 1, tu_ngay: '16/10/2026', den_ngay: '25/10/2026', so_thang_thuoc: 7 }]);
    expect(y.thong_tin_don_thuoc[0]!.biet_duoc).toBe('Cao khô Actiso');
    expect(y.loi_dan).toBe('Uống sau ăn.\nSắc 3 chén còn 1 chén.');
  });

  it('trẻ dưới 72 tháng: có người giám hộ dạng "Họ tên, SĐT, địa chỉ"; người lớn thì không gửi dù có thông tin người thân', () => {
    const guardian = { fullName: 'Lê Thị Hoa', phone: '0912345678', address: '23 Nguyễn Trãi' };
    const child = buildGuiDonThuocPayload(base({ patient: { ...base().patient, ageMonths: 48, guardian } }));
    expect(child.thong_tin_nguoi_giam_ho).toBe('Lê Thị Hoa, 0912345678, 23 Nguyễn Trãi');
    expect(buildGuiDonThuocPayload(base({ patient: { ...base().patient, guardian } }))).not.toHaveProperty('thong_tin_nguoi_giam_ho');
  });

  it('trường tuỳ chọn sai định dạng thì BỎ khỏi gói (CCCD không đủ 12 số, thẻ BHYT khác 10 ký tự, SĐT ngắn); thẻ BHYT đúng 10 ký tự thì gửi', () => {
    const p = buildGuiDonThuocPayload(base({ patient: { ...base().patient, nationalId: '123456789', insuranceNumber: 'GD4797912345678', phone: '123', weightGram: null }, followUpDays: null }));
    for (const k of ['ma_dinh_danh_cong_dan', 'ma_so_the_bao_hiem_y_te', 'so_dien_thoai_nguoi_kham_benh', 'can_nang', 'ngay_tai_kham']) expect(p).not.toHaveProperty(k);
    expect(buildGuiDonThuocPayload(base({ patient: { ...base().patient, insuranceNumber: 'GD12345678' } })).ma_so_the_bao_hiem_y_te).toBe('GD12345678');
  });

  it('cắt theo giới hạn độ dài của tài liệu', () => {
    const p = buildGuiDonThuocPayload(base({ doctorAdvice: 'x'.repeat(3000), patient: { ...base().patient, fullName: 'N'.repeat(600) } }));
    expect(p.ho_ten_benh_nhan).toHaveLength(500);
    expect(p.loi_dan).toHaveLength(2000);
    expect(p.luu_y).toHaveLength(2000);
  });
});

describe('checkInteropReadiness — dải kiểm dữ liệu 8a', () => {
  it('đơn đủ dữ liệu → không có vấn đề', () => {
    expect(checkInteropReadiness(base())).toEqual([]);
  });

  it('đơn C thiếu mã thuốc, kê tự do, thiếu hình thức điều trị, thiếu CCHN', () => {
    const problems = checkInteropReadiness(
      base({ treatmentFormCode: null, doctorLicenseNo: null, items: [{ ...base().items[0]!, drugNationalCode: null }, { ...base().items[0]!, isFreeText: true, drugName: 'Siro ho thảo dược', drugNationalCode: null }] }),
    );
    expect(problems.map((p) => p.code)).toEqual(['DRUG_NATIONAL_CODE_MISSING', 'DRUG_NATIONAL_CODE_MISSING', 'TREATMENT_FORM_MISSING', 'DOCTOR_LICENSE_MISSING']);
    expect(problems.find((p) => p.message.includes('Siro ho thảo dược'))!.message).toContain('kê tự do, không gửi được');
    // CCHN không có trong gói nên chỉ nhắc, không chặn gửi
    expect(blockingInteropProblems(problems).map((p) => p.code)).not.toContain('DOCTOR_LICENSE_MISSING');
    expect(blockingInteropProblems(problems)).toHaveLength(3);
  });

  it('đơn N/H/Y thiếu đợt dùng thuốc; đợt sai thứ tự ngày; đơn Y thiếu số thang', () => {
    expect(checkInteropReadiness(base({ kind: 'N' })).map((p) => p.code)).toEqual(['DOSE_PERIOD_MISSING']);
    expect(checkInteropReadiness(base({ kind: 'H', dosePeriod: { number: 1, from: '2026-10-18', to: '2026-10-16' } })).map((p) => p.code)).toEqual(['DOSE_PERIOD_INVALID']);
    expect(checkInteropReadiness(base({ kind: 'Y', dosePeriod: { number: 1, from: '2026-10-16', to: '2026-10-25' } })).map((p) => p.code)).toEqual(['HERBAL_DOSES_MISSING']);
  });

  it('trẻ dưới 72 tháng thiếu SĐT người giám hộ; thiếu địa chỉ bệnh nhân; thiếu chẩn đoán; mã thuốc sai độ dài; thiếu đơn vị', () => {
    const p1 = checkInteropReadiness(base({ patient: { ...base().patient, ageMonths: 48, guardian: { fullName: 'Lê Thị Hoa', phone: null, address: '23 Nguyễn Trãi' } } }));
    expect(p1.map((p) => p.code)).toEqual(['GUARDIAN_MISSING']);
    expect(p1[0]!.message).toContain('thiếu số điện thoại');
    expect(checkInteropReadiness(base({ patient: { ...base().patient, address: '  ' }, diagnoses: [] })).map((p) => p.code)).toEqual(['PATIENT_ADDRESS_MISSING', 'DIAGNOSIS_MISSING']);
    expect(checkInteropReadiness(base({ items: [{ ...base().items[0]!, drugNationalCode: 'ABC', unitName: null }] })).map((p) => p.code)).toEqual(['DRUG_NATIONAL_CODE_INVALID', 'UNIT_MISSING']);
  });
});

describe('hàm định dạng', () => {
  it('ngày, giờ Việt Nam, giới tính, số ngày tái khám', () => {
    expect(toGatewayDate('2026-03-05')).toBe('05/03/2026');
    expect(toGatewayDateTime(new Date('2026-12-31T20:00:00.000Z'))).toBe('2027-01-01 03:00:00');
    expect([toGatewayGender('male'), toGatewayGender('female'), toGatewayGender('other')]).toEqual([2, 3, 1]);
    const at = new Date('2026-10-16T17:30:00.000Z'); // 00:30 ngày 17/10 giờ VN
    expect(computeFollowUpDays(at, '2026-10-24')).toBe(7);
    expect(computeFollowUpDays(at, '2026-10-17')).toBe(0);
    expect(computeFollowUpDays(at, '2026-10-10')).toBeNull();
    expect(computeFollowUpDays(at, null)).toBeNull();
  });
});
