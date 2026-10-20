import { describe, expect, it } from 'vitest';
import type { EncounterInteropKind, InteropProblemDto } from '@nexamed/shared';
import { draftFromKind, draftToValue, draftsEqual, summarizeMissing, validateDraft, EMPTY_KIND_DRAFT } from './interop-info-view';

const emptyInfo = { treatmentFormCode: null, dosePeriodNumber: null, doseFrom: null, doseTo: null, herbalDoses: null, herbalInstruction: null };
const kindN = (info: Partial<EncounterInteropKind['info']> = {}): EncounterInteropKind => ({
  kind: 'N',
  nationalCode: null,
  submissionStatus: 'NONE',
  editable: true,
  info: { ...emptyInfo, ...info },
  suggested: { dosePeriodNumber: 1, doseFrom: '2026-10-21', doseTo: '2026-10-23' },
});

const problem = (code: string, kind: 'C' | 'N' | 'H' | 'Y', message = code, required = true): InteropProblemDto => ({ code, kind, message, required });

describe('draftFromKind', () => {
  it('ô đợt dùng thuốc chưa nhập thì lấy gợi ý tự điền', () => {
    expect(draftFromKind(kindN())).toMatchObject({ dosePeriodNumber: '1', doseFrom: '2026-10-21', doseTo: '2026-10-23' });
  });

  it('giá trị đã lưu thắng gợi ý', () => {
    expect(draftFromKind(kindN({ dosePeriodNumber: 3, doseFrom: '2026-10-25', doseTo: '2026-10-30' }))).toMatchObject({ dosePeriodNumber: '3', doseFrom: '2026-10-25', doseTo: '2026-10-30' });
  });

  it('đơn C không có ô đợt dùng thuốc', () => {
    const c: EncounterInteropKind = { ...kindN(), kind: 'C', info: { ...emptyInfo, treatmentFormCode: '2' }, suggested: { dosePeriodNumber: null, doseFrom: null, doseTo: null } };
    expect(draftFromKind(c)).toEqual({ ...EMPTY_KIND_DRAFT, treatmentFormCode: '2' });
  });
});

describe('draftToValue', () => {
  it('chỉ giữ ô thuộc loại đơn: C chỉ hình thức điều trị, N không có số thang', () => {
    const draft = { treatmentFormCode: '1', dosePeriodNumber: '2', doseFrom: '2026-10-21', doseTo: '2026-10-25', herbalDoses: '7', herbalInstruction: 'sắc uống' };
    expect(draftToValue('C', draft)).toEqual({ treatmentFormCode: '1', dosePeriodNumber: null, doseFrom: null, doseTo: null, herbalDoses: null, herbalInstruction: null });
    expect(draftToValue('N', draft)).toEqual({ treatmentFormCode: null, dosePeriodNumber: 2, doseFrom: '2026-10-21', doseTo: '2026-10-25', herbalDoses: null, herbalInstruction: null });
    expect(draftToValue('Y', draft)).toEqual({ treatmentFormCode: null, dosePeriodNumber: 2, doseFrom: '2026-10-21', doseTo: '2026-10-25', herbalDoses: 7, herbalInstruction: 'sắc uống' });
  });

  it('ô trống hoặc không phải số dương thành null', () => {
    expect(draftToValue('Y', { ...EMPTY_KIND_DRAFT, dosePeriodNumber: '0', herbalDoses: 'abc', herbalInstruction: '   ' })).toEqual({
      treatmentFormCode: null,
      dosePeriodNumber: null,
      doseFrom: null,
      doseTo: null,
      herbalDoses: null,
      herbalInstruction: null,
    });
  });
});

describe('validateDraft', () => {
  it('đến ngày trước từ ngày là lỗi', () => {
    expect(validateDraft('N', { ...EMPTY_KIND_DRAFT, doseFrom: '2026-10-25', doseTo: '2026-10-21' })).toContain('không được trước');
  });
  it('số thang không hợp lệ chỉ lỗi với đơn Y', () => {
    expect(validateDraft('Y', { ...EMPTY_KIND_DRAFT, herbalDoses: '0' })).toContain('Số thang thuốc');
    expect(validateDraft('N', { ...EMPTY_KIND_DRAFT, herbalDoses: '0' })).toBeNull();
  });
  it('hợp lệ thì null', () => {
    expect(validateDraft('N', { ...EMPTY_KIND_DRAFT, dosePeriodNumber: '1', doseFrom: '2026-10-21', doseTo: '2026-10-21' })).toBeNull();
  });
});

describe('draftsEqual', () => {
  it('so từng ô', () => {
    expect(draftsEqual(EMPTY_KIND_DRAFT, { ...EMPTY_KIND_DRAFT })).toBe(true);
    expect(draftsEqual(EMPTY_KIND_DRAFT, { ...EMPTY_KIND_DRAFT, doseTo: '2026-10-21' })).toBe(false);
  });
});

describe('summarizeMissing', () => {
  it('gộp theo mã vấn đề, kèm loại đơn, bỏ nhắc nhở không chặn', () => {
    const text = summarizeMissing([
      problem('TREATMENT_FORM_MISSING', 'C'),
      problem('DRUG_NATIONAL_CODE_MISSING', 'C', 'Thiếu mã thuốc quốc gia: Siro'),
      problem('DRUG_NATIONAL_CODE_MISSING', 'N', 'Thiếu mã thuốc quốc gia: Morphin'),
      problem('GUARDIAN_MISSING', 'C'),
      problem('DOCTOR_LICENSE_MISSING', 'C', 'Bác sĩ chưa có chứng chỉ hành nghề.', false),
    ]);
    expect(text).toBe('hình thức điều trị (đơn C), mã thuốc quốc gia, thông tin người giám hộ');
  });

  it('không thiếu gì thì rỗng', () => {
    expect(summarizeMissing([problem('DOCTOR_LICENSE_MISSING', 'C', 'x', false)])).toBe('');
  });
});
