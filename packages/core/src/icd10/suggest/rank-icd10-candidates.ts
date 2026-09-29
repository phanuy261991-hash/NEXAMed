import { stripVietnameseDiacritics } from '../../search/strip-vietnamese-diacritics';
import { canonicalizeToneMarks, tokenizeVietnamese } from './split-diagnosis-phrases';

export interface Icd10SuggestionCandidate {
  code: string;
  nameVi: string;
  /** `null` = dùng được cho mọi giới. */
  genderRestriction: 'male' | 'female' | null;
  /** `false` = dòng cấp nhóm/khối (ví dụ "K29"), không dùng làm chẩn đoán trực tiếp. */
  isBillable: boolean;
}

/** Lý do hiện gợi ý — ưu tiên `PHRASE_HISTORY` (đã học đúng cụm từ này) > `HISTORY` (mã bác sĩ hay dùng) > `MATCH`. */
export type Icd10SuggestionReason = 'PHRASE_HISTORY' | 'HISTORY' | 'MATCH';

export interface RankedIcd10Candidate<T extends Icd10SuggestionCandidate> {
  candidate: T;
  score: number;
  reason: Icd10SuggestionReason;
  /** Số lần dùng đi kèm `reason` (`PHRASE_HISTORY`/`HISTORY`); `null` khi `MATCH`. */
  usageCount: number | null;
}

export interface RankIcd10Options {
  /** Giới tính bệnh nhân — mã có `genderRestriction` KHÁC giá trị này bị loại; `null`/khác nam-nữ loại mọi mã bị hạn chế giới. */
  patientGender: string | null;
  /** Số lần chính bác sĩ đã dùng từng mã (12 tháng, từ `diagnosis` đã ký). */
  doctorCodeUsage?: Readonly<Record<string, number>>;
  /** Số lần bác sĩ chọn từng mã cho ĐÚNG cụm từ này (bảng "học cụm từ → mã"). */
  phraseCodeUsage?: Readonly<Record<string, number>>;
  /** Số mã trả về, mặc định 3. */
  limit?: number;
}

const DEFAULT_LIMIT = 3;
const UNSPECIFIED_BONUS = 6;
const PHRASE_CONTIGUOUS_BONUS = 12;
const EXTRA_WORD_PENALTY = 0.9;
const MISSING_TOKEN_PENALTY = 18;
const ACCENTLESS_MATCH_WEIGHT = 0.8;
// Mã "chung nhất" của 1 bệnh (bác sĩ không nêu chi tiết thì chọn nhóm này trước): "không xác định",
// "không kèm biến chứng", "không biến chứng".
// Tên mã CHÍNH LÀ cụm bác sĩ gõ (sau khi bỏ chú thích trong ngoặc, chữ "Bệnh" đầu câu và đuôi "không xác
// định"/"khác") — ví dụ "Ho" cho "ho", "Sốt, không xác định" cho "sốt", khác "Ho gà"/"Sốt rét".
const EXACT_NAME_BONUS = 20;
// Mã 3 ký tự (I10, R05, R51) là dòng "cả bệnh" không chia nhỏ hơn — ưu tiên hơn mã con có dấu chấm khi
// bác sĩ chỉ nêu tên bệnh chung. Không quyết định một mình: cần khớp từ khoá + không lọt bộ lọc.
const GENERAL_CODE_BONUS = 10;
const NUMERIC_TOKEN = /^\d+$/;
const UNSPECIFIED_NAME =/không xác định|không kèm|không biến chứng/i;

/** Các từ của tên mã sau khi bỏ chú thích ngoặc, "Bệnh" đầu câu và đuôi "không xác định"/"khác". */
function coreNameWords(nameVi: string): string[] {
  const withoutNotes = nameVi.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').toLowerCase();
  const withoutTail = withoutNotes.replace(/[\s,;]*(?:không xác định|khác)\s*$/u, '');
  const words = tokenizeVietnamese(withoutTail).map(canonicalizeToneMarks);
  return words[0] === canonicalizeToneMarks('bệnh') ? words.slice(1) : words;
}

function hasToneOrMark(word: string): boolean {
  return stripVietnameseDiacritics(word) !== word.normalize('NFC');
}

/**
 * Xếp hạng ứng viên ICD-10 cho MỘT cụm bệnh. Hàm thuần (không I/O) — lấy ứng viên từ DB là việc của
 * repository, hàm này chỉ chấm điểm/lọc/sắp xếp/cắt còn tối đa `limit` mã, kèm lý do.
 *
 * Quy tắc: (1) loại mã sai giới tính/mã nhóm; (2) khớp từng từ của cụm với tên ICD — đúng dấu đủ điểm,
 * người gõ KHÔNG dấu thì khớp bản đã bỏ dấu với điểm thấp hơn, người ĐÃ gõ dấu bắt buộc đúng dấu ("dạ
 * dày" không khớp "đa dây"); thiếu từ nào thì trừ điểm, cụm cho phép thiếu tối đa 1 từ khi có ≥ 4 từ;
 * (3) cụm liền mạch trong tên +, mã "chung nhất" (không xác định/không kèm biến chứng) +, tên dài dư từ −; (4) cộng theo lịch sử dùng mã
 * của bác sĩ và (mạnh hơn) theo cụm từ đã học.
 */
export function rankIcd10Candidates<T extends Icd10SuggestionCandidate>(
  tokens: readonly string[],
  candidates: readonly T[],
  options: RankIcd10Options,
): RankedIcd10Candidate<T>[] {
  if (tokens.length === 0) {
    return [];
  }
  const limit = options.limit ?? DEFAULT_LIMIT;
  const allowedMisses = tokens.length >= 4 ? 1 : 0;
  const phraseNormalized = tokens.join(' ');
  const phraseStripped = stripVietnameseDiacritics(phraseNormalized);
  const ranked: RankedIcd10Candidate<T>[] = [];

  for (const candidate of candidates) {
    if (!candidate.isBillable) {
      continue;
    }
    if (candidate.genderRestriction !== null && candidate.genderRestriction !== options.patientGender) {
      continue;
    }
    const nameWords = tokenizeVietnamese(candidate.nameVi).map(canonicalizeToneMarks);
    const nameWordsStripped = nameWords.map(stripVietnameseDiacritics);

    let matchWeight = 0;
    let misses = 0;
    for (const token of tokens) {
      if (nameWords.includes(token)) {
        matchWeight += 1;
      } else if (!hasToneOrMark(token) && nameWordsStripped.includes(token)) {
        matchWeight += ACCENTLESS_MATCH_WEIGHT;
      } else if (NUMERIC_TOKEN.test(token)) {
        // Số phân biệt bệnh ("típ 1" ≠ "típ 2", "độ 3") — thiếu là loại luôn, không được dung sai.
        misses = Number.POSITIVE_INFINITY;
        break;
      } else {
        misses += 1;
      }
    }
    // Mã bác sĩ ĐÃ học cho đúng cụm này được giữ dù tên mã không chứa từ khoá ("cảm" → J06.9).
    const phraseUsage = options.phraseCodeUsage?.[candidate.code] ?? 0;
    if (misses > allowedMisses && phraseUsage === 0) {
      continue;
    }
    // Cụm đã học coi như khớp đủ — bác sĩ đã xác nhận đúng cụm này ↔ đúng mã này, không phạt thiếu từ khoá.
    const countedMisses = phraseUsage > 0 ? 0 : misses;
    const effectiveMatchWeight = phraseUsage > 0 ? tokens.length : matchWeight;

    let score = (effectiveMatchWeight / tokens.length) * 60 - countedMisses * MISSING_TOKEN_PENALTY;
    if (nameWords.join(' ').includes(phraseNormalized) || nameWordsStripped.join(' ').includes(phraseStripped)) {
      score += PHRASE_CONTIGUOUS_BONUS;
    }
    if (UNSPECIFIED_NAME.test(candidate.nameVi)) {
      score += UNSPECIFIED_BONUS;
    }
    if (coreNameWords(candidate.nameVi).join(' ') === phraseNormalized) {
      score += EXACT_NAME_BONUS;
    }
    if (!candidate.code.includes('.')) {
      score += GENERAL_CODE_BONUS;
    }
    score -= Math.max(0, nameWords.length - tokens.length) * EXTRA_WORD_PENALTY;

    const doctorUsage = options.doctorCodeUsage?.[candidate.code] ?? 0;
    score += Math.min(40, 10 * Math.log2(1 + doctorUsage));
    // Liên kết cụm ↔ mã do CHÍNH bác sĩ xác nhận là tín hiệu mạnh nhất, vượt cả lịch sử dùng mã chung.
    score += Math.min(60, 30 * Math.log2(1 + phraseUsage));

    ranked.push({
      candidate,
      score,
      reason: phraseUsage > 0 ? 'PHRASE_HISTORY' : doctorUsage > 0 ? 'HISTORY' : 'MATCH',
      usageCount: phraseUsage > 0 ? phraseUsage : doctorUsage > 0 ? doctorUsage : null,
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.candidate.code.localeCompare(b.candidate.code));
  return ranked.slice(0, limit);
}
