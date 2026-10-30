/**
 * "Gợi ý theo cơ quan" ở ô "Kết quả khám bộ phận" (mockup đã chốt https://claude.ai/artifact/R6oTbDuS7fczynmib7V5BT, 30/10/2026): bác sĩ chọn các cơ quan cần khám, hệ thống chèn sẵn dòng tiêu đề
 * ("Tuần hoàn: ") vào CUỐI ô để bác sĩ gõ tiếp. Dữ liệu vẫn là MỘT khối chữ như trước — không thêm trường nào. Danh sách 10 cơ quan lấy đúng mục "2. Các cơ quan" của mẫu Nội khoa 01/BV-01
 * (Thông tư 32/2023/TT-BYT, Phụ lục XXVIII). Phần logic thuần, không đụng React để kiểm bằng unit test.
 */

export interface OrganSystem {
  key: string;
  label: string;
}

export const ORGAN_SYSTEMS: readonly OrganSystem[] = [
  { key: 'circulatory', label: 'Tuần hoàn' },
  { key: 'respiratory', label: 'Hô hấp' },
  { key: 'digestive', label: 'Tiêu hoá' },
  { key: 'urogenital', label: 'Thận – Tiết niệu – Sinh dục' },
  { key: 'nervous', label: 'Thần kinh' },
  { key: 'musculoskeletal', label: 'Cơ – Xương – Khớp' },
  { key: 'ent', label: 'Tai – Mũi – Họng' },
  { key: 'dental', label: 'Răng – Hàm – Mặt' },
  { key: 'eye', label: 'Mắt' },
  { key: 'endocrine', label: 'Nội tiết – dinh dưỡng và các bệnh lý khác' },
];

export const ORGAN_KEYS: readonly string[] = ORGAN_SYSTEMS.map((o) => o.key);

const headingOf = (label: string): string => `${label}:`;

/** Một dòng có phải đang bắt đầu bằng tiêu đề của cơ quan này không ("Hô hấp: …"). */
function lineStartsWithHeading(line: string, label: string): boolean {
  return line.trimStart().startsWith(headingOf(label));
}

/** Các cơ quan đã có tiêu đề trong ô (để hộp chọn làm mờ, không chèn lần hai). */
export function organsPresent(text: string): Set<string> {
  const lines = text.split('\n');
  return new Set(ORGAN_SYSTEMS.filter((o) => lines.some((l) => lineStartsWithHeading(l, o.label))).map((o) => o.key));
}

/**
 * Chèn tiêu đề các cơ quan đã chọn vào CUỐI ô, mỗi cơ quan một dòng "Tuần hoàn: ". Bỏ qua cơ quan đã có trong ô, giữ đúng thứ tự của mẫu (không theo thứ tự bấm).
 * `caret` = vị trí con trỏ sau dấu hai chấm của dòng tiêu đề ĐẦU TIÊN vừa chèn, để bác sĩ gõ tiếp ngay; không chèn gì thì `caret` = cuối ô.
 */
export function insertOrganHeadings(text: string, selectedKeys: readonly string[]): { text: string; caret: number } {
  const present = organsPresent(text);
  const toAdd = ORGAN_SYSTEMS.filter((o) => selectedKeys.includes(o.key) && !present.has(o.key));
  if (toAdd.length === 0) return { text, caret: text.length };
  const prefix = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  const lines = toAdd.map((o) => `${headingOf(o.label)} `);
  const caret = prefix.length + lines[0]!.length;
  return { text: prefix + lines.join('\n'), caret };
}

/**
 * Khi lưu: bỏ các dòng CHỈ có tiêu đề cơ quan mà bác sĩ chưa gõ gì ("Hô hấp:"), để bản ký không chứa dòng rỗng (chủ dự án chốt 30/10/2026). Dòng có chữ sau dấu hai chấm, và mọi dòng khác,
 * giữ nguyên. Nếu có dòng bị bỏ thì cắt khoảng trắng/dòng trống thừa ở cuối.
 */
export function stripEmptyOrganHeadings(text: string): string {
  const empty = new Set(ORGAN_SYSTEMS.map((o) => headingOf(o.label)));
  const lines = text.split('\n');
  const kept = lines.filter((l) => !empty.has(l.trim()));
  if (kept.length === lines.length) return text;
  return kept.join('\n').replace(/\s+$/, '');
}
