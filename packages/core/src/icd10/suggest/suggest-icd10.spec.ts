import { describe, expect, it } from 'vitest';
import { buildAbbreviationLookup, type AbbreviationEntry } from './clinical-abbreviations';
import { rankIcd10Candidates, type Icd10SuggestionCandidate } from './rank-icd10-candidates';
import { canonicalizeToneMarks, splitDiagnosisPhrases as splitPhrases } from './split-diagnosis-phrases';

// 11 mục mặc định seed ở migration `seed_icd10_abbreviation_catalog` — dữ liệu thật nằm ở DB (#206), hàm thuần chỉ nhận danh sách đã đọc sẵn.
const DEFAULT_ABBREVIATIONS: AbbreviationEntry[] = [
  { abbreviation: 'tha', expansion: 'tăng huyết áp' },
  { abbreviation: 'đtđ', expansion: 'đái tháo đường' },
  { abbreviation: 'dtd', expansion: 'đái tháo đường' },
  { abbreviation: 'type', expansion: 'típ' },
  { abbreviation: 'tip', expansion: 'típ' },
  { abbreviation: 'sxh', expansion: 'sốt xuất huyết' },
  { abbreviation: 'vpq', expansion: 'viêm phế quản' },
  { abbreviation: 'rlth', expansion: 'rối loạn tiêu hóa' },
  { abbreviation: 'nktn', expansion: 'nhiễm trùng tiết niệu' },
  { abbreviation: 'gerd', expansion: 'trào ngược dạ dày thực quản' },
  { abbreviation: 'cảm', expansion: 'viêm mũi họng cấp tính' },
];
const lookupAbbreviation = buildAbbreviationLookup(DEFAULT_ABBREVIATIONS);
const splitDiagnosisPhrases = (text: string) => splitPhrases(text, lookupAbbreviation);

function c(code: string, nameVi: string, genderRestriction: 'male' | 'female' | null = null, isBillable = true): Icd10SuggestionCandidate {
  return { code, nameVi, genderRestriction, isBillable };
}

// Tên thật lấy từ danh mục ICD-10 BYT đã seed (cách thử của 4 ca lỗi ô tìm cũ).
const CATALOG: Icd10SuggestionCandidate[] = [
  c('E10.9', 'Bệnh đái tháo đường típ 1, không kèm biến chứng'),
  c('E11.2', 'Bệnh đái tháo đường típ 2, kèm biến chứng thận'),
  c('E11.9', 'Bệnh đái tháo đường típ 2, không kèm biến chứng'),
  c('G61.8', 'Bệnh lý viêm đa dây thần kinh khác'),
  c('K29', 'Viêm dạ dày và/hoặc tá tràng', null, false),
  c('K29.1', 'Viêm dạ dày cấp tính khác'),
  c('K29.7', 'Viêm dạ dày, không xác định'),
  c('N94.6', 'Đau bụng kinh, không xác định', 'female'),
  c('R10.1', 'Đau khu trú bụng trên'),
  c('R10.4', 'Đau bụng khác và/hoặc không xác định'),
  c('I10', 'Bệnh tăng huyết áp vô căn (nguyên phát)'),
  c('I15.9', 'Tăng huyết áp thứ phát, không xác định'),
  c('J02.9', 'Viêm họng cấp tính, không xác định'),
  c('K30', 'Rối loạn tiêu hóa chức năng [không do loét]'),
  c('B01.9', 'Bệnh thủy đậu không biến chứng'),
];

function codes(text: string, patientGender: string | null, extra: Partial<Parameters<typeof rankIcd10Candidates>[2]> = {}): string[] {
  const phrase = splitDiagnosisPhrases(text)[0]!;
  return rankIcd10Candidates(phrase.tokens, CATALOG, { patientGender, ...extra }).map((r) => r.candidate.code);
}

describe('buildAbbreviationLookup', () => {
  it('mở rộng đúng viết tắt, không tự bỏ dấu để khớp', () => {
    expect(lookupAbbreviation('tha')).toBe('tăng huyết áp');
    expect(lookupAbbreviation('đtđ')).toBe('đái tháo đường');
    expect(lookupAbbreviation('dtd')).toBe('đái tháo đường');
    expect(lookupAbbreviation('cam')).toBeNull();
    expect(lookupAbbreviation('constructor')).toBeNull();
  });

  it('chuẩn hoá khoá (hoa/thường, khoảng trắng, NFD) và bỏ mục rỗng', () => {
    const lookup = buildAbbreviationLookup([
      { abbreviation: '  THA ', expansion: ' tăng huyết áp ' },
      { abbreviation: 'đtđ'.normalize('NFD'), expansion: 'đái tháo đường' },
      { abbreviation: '', expansion: 'bị bỏ' },
      { abbreviation: 'xyz', expansion: '   ' },
    ]);
    expect(lookup('tha')).toBe('tăng huyết áp');
    expect(lookup('đtđ')).toBe('đái tháo đường');
    expect(lookup('xyz')).toBeNull();
  });

  it('danh sách rỗng (chưa có mục nào / đã ẩn hết) thì không mở rộng gì', () => {
    const phrase = splitPhrases('THA', buildAbbreviationLookup([]))[0]!;
    expect(phrase.expandedText).toBeNull();
    expect(phrase.phraseKey).toBe('tha');
  });
});

describe('splitDiagnosisPhrases', () => {
  it('tách theo dấu phẩy/chấm phẩy/+/xuống dòng/"và" và mở rộng viết tắt', () => {
    const phrases = splitDiagnosisPhrases('Viêm họng cấp, sốt; THA + táo bón\nho và sổ mũi');
    // Giới hạn 5 cụm — cụm thứ 6 ("sổ mũi") bị bỏ.
    expect(phrases.map((p) => p.raw)).toEqual(['Viêm họng cấp', 'sốt', 'THA', 'táo bón', 'ho']);
    expect(phrases.find((p) => p.raw === 'THA')?.expandedText).toBe('tăng huyết áp');
    expect(phrases.find((p) => p.raw === 'sốt')?.expandedText).toBeNull();
  });

  it('bỏ tiền tố TD/Theo dõi/Nghi và gắn followUp, nhưng KHÔNG cắt "tdcs" (không có khoảng trắng)', () => {
    const td = splitDiagnosisPhrases('TD sốt xuất huyết')[0]!;
    expect(td.followUp).toBe(true);
    expect(td.phraseKey).toBe('sot xuat huyet');
    expect(splitDiagnosisPhrases('nghi ngờ viêm phổi')[0]?.followUp).toBe(true);
    expect(splitDiagnosisPhrases('tdcs')[0]?.followUp).toBe(false);
    expect(splitDiagnosisPhrases('? viêm ruột thừa')[0]?.followUp).toBe(true);
  });

  it('giữ nguyên "kèm" trong cụm và giới hạn 5 cụm', () => {
    expect(splitDiagnosisPhrases('đái tháo đường kèm biến chứng thận')).toHaveLength(1);
    expect(splitDiagnosisPhrases('a, b, c, d, e, f, g')).toHaveLength(5);
  });

  it('phraseKey không dấu, viết thường, đã mở rộng viết tắt', () => {
    expect(splitDiagnosisPhrases('ĐTĐ type 2')[0]?.phraseKey).toBe('dai thao duong tip 2');
  });

  it('chuẩn hoá dấu thanh kiểu cũ/mới về cùng dạng', () => {
    expect(canonicalizeToneMarks('hoá')).toBe(canonicalizeToneMarks('hóa'));
    expect(canonicalizeToneMarks('thuỷ')).toBe(canonicalizeToneMarks('thủy'));
    expect(canonicalizeToneMarks('dạ')).not.toBe(canonicalizeToneMarks('đa'));
  });
});

describe('rankIcd10Candidates — 4 ca lỗi của ô tìm cũ', () => {
  it('"ĐTĐ type 2" → típ 2 đứng đầu, không lẫn típ 1', () => {
    const result = codes('ĐTĐ type 2', 'male');
    expect(result[0]).toBe('E11.9');
    expect(result).not.toContain('E10.9');
  });

  it('"viêm dạ dày" (có dấu) không lẫn "viêm đa dây thần kinh"; bỏ mã nhóm K29', () => {
    const result = codes('viêm dạ dày', 'male');
    expect(result).toEqual(['K29.7', 'K29.1']);
  });

  it('"viem da day" (không dấu) vẫn ra mã đúng', () => {
    expect(codes('viem da day', 'male')[0]).toBe('K29.7');
  });

  it('"đau bụng" bệnh nhân nam ẩn mã chỉ dành cho nữ; nữ thì hiện', () => {
    expect(codes('đau bụng', 'male')).toEqual(['R10.4', 'R10.1']);
    expect(codes('đau bụng', 'female')).toContain('N94.6');
    expect(codes('đau bụng', null)).not.toContain('N94.6');
  });

  it('"THA" gợi ý cả I10 lẫn I15.9 (thứ tự ban đầu chỉ là heuristic, lịch sử của bác sĩ sẽ sắp lại)', () => {
    expect(codes('THA', 'male')).toEqual(expect.arrayContaining(['I10', 'I15.9']));
    expect(codes('THA', 'male', { doctorCodeUsage: { I10: 30 } })[0]).toBe('I10');
  });

  it('"rối loạn tiêu hoá" (dấu thanh kiểu cũ) khớp "tiêu hóa"', () => {
    expect(codes('rối loạn tiêu hoá', 'male')).toEqual(['K30']);
    expect(codes('thuỷ đậu', 'male')).toEqual(['B01.9']);
  });

  it('cụm không có trong danh mục → mảng rỗng', () => {
    expect(codes('viêm tai giữa', 'male')).toEqual([]);
  });
});

describe('rankIcd10Candidates — lịch sử dùng mã', () => {
  it('mã bác sĩ hay dùng vượt lên đầu và mang nhãn HISTORY kèm số lần', () => {
    const phrase = splitDiagnosisPhrases('viêm dạ dày')[0]!;
    const result = rankIcd10Candidates(phrase.tokens, CATALOG, { patientGender: 'male', doctorCodeUsage: { 'K29.1': 200 } });
    expect(result[0]?.candidate.code).toBe('K29.1');
    expect(result[0]).toMatchObject({ reason: 'HISTORY', usageCount: 200 });
    expect(result[1]?.reason).toBe('MATCH');
  });

  it('cụm từ đã học có nhãn PHRASE_HISTORY và ưu tiên hơn lịch sử chung', () => {
    const phrase = splitDiagnosisPhrases('viêm dạ dày')[0]!;
    const result = rankIcd10Candidates(phrase.tokens, CATALOG, {
      patientGender: 'male',
      doctorCodeUsage: { 'K29.1': 20 },
      phraseCodeUsage: { 'K29.7': 30 },
    });
    expect(result[0]).toMatchObject({ reason: 'PHRASE_HISTORY', usageCount: 30 });
    expect(result[0]?.candidate.code).toBe('K29.7');
  });

  it('mã đã học cho cụm được giữ dù tên mã không chứa từ khoá của cụm', () => {
    const phrase = splitDiagnosisPhrases('cảm cúm')[0]!;
    const withCatalog = [...CATALOG, c('J06.9', 'Nhiễm trùng đường hô hấp trên cấp tính, không xác định')];
    expect(rankIcd10Candidates(phrase.tokens, withCatalog, { patientGender: 'male' })).toEqual([]);
    const learned = rankIcd10Candidates(phrase.tokens, withCatalog, { patientGender: 'male', phraseCodeUsage: { 'J06.9': 5 } });
    expect(learned.map((r) => r.candidate.code)).toEqual(['J06.9']);
    expect(learned[0]?.reason).toBe('PHRASE_HISTORY');
  });

  it('cắt còn đúng `limit` mã', () => {
    const phrase = splitDiagnosisPhrases('đái tháo đường')[0]!;
    expect(rankIcd10Candidates(phrase.tokens, CATALOG, { patientGender: 'male', limit: 2 })).toHaveLength(2);
  });
});
