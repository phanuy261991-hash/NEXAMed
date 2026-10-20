import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESCRIPTION_INFO_CONFIG, type PrescriptionPrintInfo } from '@nexamed/shared';
import { ALL_ON_PRESCRIPTION_INFO, formatWeightKg, resolvePrescriptionPrintFields } from './prescription-print-fields';

const adult: PrescriptionPrintInfo = {
  patientCode: 'BN2610003068',
  nationalId: '079188001234',
  address: { street: '12 Lê Văn Sỹ' },
  phone: '0933555666',
  weightGram: 54_000,
  ageMonths: 440,
  guardian: null,
};
const child: PrescriptionPrintInfo = { ...adult, nationalId: null, weightGram: null, ageMonths: 48, guardian: { fullName: 'Nguyễn Văn Nam', relationship: 'Bố' } };
const resolve = (over: Partial<Parameters<typeof resolvePrescriptionPrintFields>[0]> = {}) =>
  resolvePrescriptionPrintFields({ config: ALL_ON_PRESCRIPTION_INFO, kind: 'C', printInfo: adult, addressLine: '12 Lê Văn Sỹ, Phường 14', ...over });

describe('ALL_ON_PRESCRIPTION_INFO', () => {
  it('khớp mặc định ở @nexamed/shared (web chỉ có bản sao, test này chặn lệch)', () => {
    expect(ALL_ON_PRESCRIPTION_INFO).toEqual(DEFAULT_PRESCRIPTION_INFO_CONFIG);
  });
});

describe('formatWeightKg', () => {
  it.each([
    [54_000, '54 kg'],
    [56_500, '56,5 kg'],
    [3_250, '3,25 kg'],
  ])('%i g → %s', (g, text) => expect(formatWeightKg(g)).toBe(text));
});

describe('resolvePrescriptionPrintFields', () => {
  it('người lớn, đơn thường: có mã BN, CCCD, SĐT, cân nặng, địa chỉ; không giám hộ, không mục N/H', () => {
    const f = resolve();
    expect(f.patientCode).toEqual({ mode: 'value', value: 'BN2610003068' });
    expect(f.nationalId).toEqual({ mode: 'value', value: '079188001234' });
    expect(f.phone).toEqual({ mode: 'value', value: '0933555666' });
    expect(f.weight).toEqual({ mode: 'value', value: '54 kg' });
    expect(f.address).toEqual({ mode: 'value', value: '12 Lê Văn Sỹ, Phường 14' });
    expect(f.guardian).toBeNull();
    expect([f.course, f.quantityInWords, f.receiverBox]).toEqual([false, false, false]);
  });

  it('công tắc tắt → ô ẩn hẳn', () => {
    const f = resolve({ config: { ...ALL_ON_PRESCRIPTION_INFO, showPatientCode: false, showNationalId: false, showPhone: false, showWeight: false, showAddress: false } });
    expect([f.patientCode, f.nationalId, f.phone, f.weight, f.address]).toEqual(Array(5).fill({ mode: 'hidden' }));
  });

  it('chưa có CCCD: mặc định ẩn dòng; chọn "dots" thì in dòng chấm', () => {
    expect(resolve({ printInfo: child }).nationalId).toEqual({ mode: 'hidden' });
    expect(resolve({ printInfo: child, config: { ...ALL_ON_PRESCRIPTION_INFO, nationalIdWhenMissing: 'dots' } }).nationalId).toEqual({ mode: 'dots' });
    // Công tắc CCCD tắt thì dù chọn "dots" cũng không in gì.
    expect(resolve({ printInfo: child, config: { ...ALL_ON_PRESCRIPTION_INFO, showNationalId: false, nationalIdWhenMissing: 'dots' } }).nationalId).toEqual({ mode: 'hidden' });
  });

  it('cân nặng chưa đo (hoặc chưa nạp thông tin) → dòng chấm để viết tay', () => {
    expect(resolve({ printInfo: child }).weight).toEqual({ mode: 'dots' });
    expect(resolve({ printInfo: null }).weight).toEqual({ mode: 'dots' });
  });

  it('người giám hộ chỉ in cho trẻ dưới 72 tháng', () => {
    expect(resolve({ printInfo: child }).guardian).toEqual({ name: 'Nguyễn Văn Nam', relationship: 'Bố' });
    expect(resolve({ printInfo: { ...child, ageMonths: 71 } }).guardian).not.toBeNull();
    expect(resolve({ printInfo: { ...child, ageMonths: 72 } }).guardian).toBeNull();
    expect(resolve({ printInfo: adult }).guardian).toBeNull();
    expect(resolve({ printInfo: child, config: { ...ALL_ON_PRESCRIPTION_INFO, showGuardian: false } }).guardian).toBeNull();
  });

  it('trẻ dưới 72 tháng mà hồ sơ chưa ghi người thân → vẫn in dòng giám hộ (tên để chấm)', () => {
    expect(resolve({ printInfo: { ...child, guardian: null } }).guardian).toEqual({ name: null, relationship: null });
  });

  it('mục riêng đơn N/H: Đợt và số lượng bằng chữ CHỈ đơn N; ô người nhận thuốc đơn N và H; đơn C/Y và đơn in kiểu cũ không có', () => {
    expect(resolve({ kind: 'N' })).toMatchObject({ course: true, quantityInWords: true, receiverBox: true });
    expect(resolve({ kind: 'H' })).toMatchObject({ course: false, quantityInWords: false, receiverBox: true });
    for (const kind of ['C', 'Y', null] as const) expect(resolve({ kind })).toMatchObject({ course: false, quantityInWords: false, receiverBox: false });
  });

  it('tắt từng công tắc riêng của đơn N → mục đó biến mất, mục còn lại giữ nguyên', () => {
    const f = resolve({ kind: 'N', config: { ...ALL_ON_PRESCRIPTION_INFO, showCourse: false, showQuantityInWords: false } });
    expect(f).toMatchObject({ course: false, quantityInWords: false, receiverBox: true });
  });

  it('chưa nạp thông tin bệnh nhân (printInfo = null): mã BN, SĐT, CCCD ẩn, không giám hộ', () => {
    const f = resolve({ printInfo: null });
    expect([f.patientCode, f.phone, f.nationalId]).toEqual(Array(3).fill({ mode: 'hidden' }));
    expect(f.guardian).toBeNull();
  });
});
