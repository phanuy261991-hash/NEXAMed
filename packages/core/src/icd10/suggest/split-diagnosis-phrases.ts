import { stripVietnameseDiacritics } from '../../search/strip-vietnamese-diacritics';
import { lookupClinicalAbbreviation } from './clinical-abbreviations';

/** Tối đa bao nhiêu cụm bệnh được xử lý từ 1 ô "Chẩn đoán" — chặn tải khi bác sĩ dán cả đoạn dài. */
export const MAX_DIAGNOSIS_PHRASES = 5;

export interface DiagnosisPhrase {
  /** Cụm gốc bác sĩ gõ (đã cắt khoảng trắng đầu/cuối), dùng để hiển thị. */
  raw: string;
  /** Cụm có tiền tố "TD/Theo dõi/Nghi" — vẫn tra mã theo phần bệnh còn lại, chỉ gắn nhãn cho bác sĩ thấy. */
  followUp: boolean;
  /** Từ đã chuẩn hoá vị trí dấu thanh (xem `canonicalizeToneMarks`) sau khi mở rộng viết tắt — dùng để so khớp. */
  tokens: string[];
  /** Cụm sau khi mở rộng viết tắt, dạng đọc được (NFC). Luôn có, dù có mở rộng hay không. */
  displayText: string;
  /** `displayText` CHỈ khi có ít nhất 1 từ viết tắt được mở rộng, ngược lại `null` (UI chỉ hiện dòng "hiểu là:" khi có). */
  expandedText: string | null;
  /** Khoá không dấu, viết thường ("dai thao duong tip 2") — khoá bảng "học cụm từ → mã" và khoá tra DB. */
  phraseKey: string;
}

/**
 * Chuẩn hoá vị trí dấu thanh kiểu cũ/mới về cùng 1 dạng ("hoá" ≡ "hóa", "thuỷ" ≡ "thủy"): tách 5 dấu
 * thanh (huyền/sắc/ngã/hỏi/nặng) ra cuối từ, GIỮ NGUYÊN dấu mũ/trăng/móc — nên "dạ dày" vẫn khác
 * "đa dây". Kết quả ở dạng NFD, chỉ để so sánh nội bộ, không dùng để hiển thị.
 */
const TONE_MARKS = /[̣̀́̃̉]/g;
export function canonicalizeToneMarks(word: string): string {
  const decomposed = word.normalize('NFD');
  let tones = '';
  const base = decomposed.replace(TONE_MARKS, (mark) => {
    tones += mark;
    return '';
  });
  return base + tones;
}

/** Tách từ theo mọi ký tự không phải chữ/số (Unicode), viết thường, dạng NFC. */
export function tokenizeVietnamese(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '');
}

const PHRASE_SEPARATOR = /[,;\n+/]|\s+và\s+/i;
// Tiền tố phải theo sau bởi khoảng trắng — "tdcs" không phải "td cs". "?" đứng đầu cũng là nghi ngờ.
const FOLLOW_UP_PREFIX = /^(?:(?:td|theo dõi|nghi ngờ|nghi)\s+|\?\s*)/i;

/**
 * Tách câu "Chẩn đoán" tự do thành từng cụm bệnh: cắt theo dấu phẩy/chấm phẩy/xuống dòng/"+"/"/"/" và ",
 * bỏ tiền tố theo dõi, mở rộng viết tắt (`lookupClinicalAbbreviation`). KHÔNG tách theo "kèm" — tên ICD
 * dùng chính từ đó ("...kèm biến chứng thận"). Hàm thuần, không I/O.
 */
export function splitDiagnosisPhrases(text: string): DiagnosisPhrase[] {
  const phrases: DiagnosisPhrase[] = [];
  for (const piece of text.split(PHRASE_SEPARATOR)) {
    const raw = piece.trim();
    if (raw === '') {
      continue;
    }
    const core = raw.replace(FOLLOW_UP_PREFIX, '').trim();
    const followUp = core.length !== raw.length;
    let didExpand = false;
    const displayWords = tokenizeVietnamese(core).map((word) => {
      const expansion = lookupClinicalAbbreviation(word);
      if (expansion === null) {
        return word;
      }
      didExpand = true;
      return expansion;
    });
    const displayText = displayWords.join(' ');
    const tokens = tokenizeVietnamese(displayText).map(canonicalizeToneMarks);
    if (tokens.length === 0) {
      continue;
    }
    phrases.push({
      raw,
      followUp,
      tokens,
      displayText,
      expandedText: didExpand ? displayText : null,
      phraseKey: stripVietnameseDiacritics(displayText),
    });
    if (phrases.length >= MAX_DIAGNOSIS_PHRASES) {
      break;
    }
  }
  return phrases;
}
