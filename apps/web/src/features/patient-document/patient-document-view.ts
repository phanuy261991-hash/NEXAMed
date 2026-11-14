import {
  type PatientDocument,
  type PatientDocumentAccess,
  type PatientDocumentCategory,
  type PatientDocumentSource,
} from '@nexamed/shared';
import { PATIENT_DOCUMENT_CATEGORY_LABEL, patientDocumentGroupOf } from './patient-document-constants';

/** Phần thuần của tab "Hình ảnh & Tài liệu" (docs/DECISIONS.md #299) — tách khỏi component để kiểm bằng unit test. */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1).replace('.', ',')} MB`;
  return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`;
}

/** "2026-11-13" → "13/11/2026". */
export function formatIsoDateVi(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "2026-11-13T02:42:00Z" → "13/11/2026 09:42" theo giờ Việt Nam. */
export function formatDateTimeVi(iso: string): string {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Tên ngắn của loại tệp ở dòng phụ dưới ảnh (ví dụ "Cận lâm sàng · 2,1 MB"). */
export const CATEGORY_SHORT_LABEL: Record<PatientDocumentCategory, string> = {
  PARACLINICAL: 'Cận lâm sàng',
  CLINICAL_PHOTO: 'Ảnh lâm sàng',
  CONTRACT: 'Giấy tờ',
  OTHER: 'Khác',
};

/** Nhãn nguồn ở góc ảnh; tệp tải tay không có nhãn. */
export function sourceBadge(source: PatientDocumentSource): string | null {
  switch (source) {
    case 'PARACLINICAL_IMAGE':
    case 'LAB_PARTNER_RESULT':
      return 'Từ kết quả CLS';
    case 'INSURANCE_CARD':
      return 'Từ thẻ BHYT';
    case 'PATIENT_PHOTO':
      return 'Từ hồ sơ';
    default:
      return null;
  }
}

/** Cột "Nguồn" của bảng (mockup màn 3, 11): "Tải lên tay · Ảnh lâm sàng", "Kết quả CLS · Siêu âm ổ bụng", "Từ thẻ BHYT", "Từ hồ sơ". */
export function sourceText(doc: Pick<PatientDocument, 'source' | 'category' | 'sourceLabel'>): string {
  switch (doc.source) {
    case 'UPLOAD':
      return `Tải lên tay · ${PATIENT_DOCUMENT_CATEGORY_LABEL[doc.category]}`;
    case 'PARACLINICAL_IMAGE':
    case 'LAB_PARTNER_RESULT':
      return doc.sourceLabel ? `Kết quả CLS · ${doc.sourceLabel}` : 'Kết quả CLS';
    case 'INSURANCE_CARD':
      return 'Từ thẻ BHYT';
    case 'PATIENT_PHOTO':
      return 'Từ hồ sơ';
  }
}

/** Dòng tham chiếu kết quả cận lâm sàng mở được phiếu kết quả (nút "Mở kết quả"); các dòng khác thì không. */
export function canOpenResult(doc: Pick<PatientDocument, 'sourceRef'>): boolean {
  return doc.sourceRef !== null;
}

export function tileMeta(doc: Pick<PatientDocument, 'category' | 'sizeBytes'>): string {
  return `${CATEGORY_SHORT_LABEL[doc.category]} · ${formatBytes(doc.sizeBytes)}`;
}

export interface DayGroup {
  date: string;
  items: PatientDocument[];
  totalBytes: number;
}

/** Gom theo ngày tải (thư mục "ngày"). Danh sách vào đã sắp mới nhất trước nên giữ nguyên thứ tự. */
export function groupByUploadDate(items: readonly PatientDocument[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.uploadDate) {
      last.items.push(item);
      last.totalBytes += item.sizeBytes;
    } else {
      groups.push({ date: item.uploadDate, items: [item], totalBytes: item.sizeBytes });
    }
  }
  return groups;
}

export const PERIOD_OPTIONS = [
  { value: '', label: 'Mọi thời gian' },
  { value: '30', label: '30 ngày gần nhất' },
  { value: '90', label: '3 tháng gần nhất' },
  { value: '365', label: '12 tháng gần nhất' },
];

/** Loại tệp người dùng được phép TẢI LÊN (theo quyền của từng nhóm). */
export function uploadableCategories(access: PatientDocumentAccess, all: readonly PatientDocumentCategory[]): PatientDocumentCategory[] {
  return all.filter((c) => access[patientDocumentGroupOf(c)].upload);
}

export function canEditDocument(doc: Pick<PatientDocument, 'readOnly' | 'category'>, access: PatientDocumentAccess): boolean {
  return !doc.readOnly && access[patientDocumentGroupOf(doc.category)].upload;
}

export function canDeleteDocument(doc: Pick<PatientDocument, 'readOnly' | 'category'>, access: PatientDocumentAccess): boolean {
  return !doc.readOnly && access[patientDocumentGroupOf(doc.category)].delete;
}

const ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'pdf', 'dcm'];

/** Kiểm sơ bộ ở trình duyệt (máy chủ vẫn kiểm lại bằng magic byte). Trả câu lỗi tiếng Việt hoặc null nếu hợp lệ. */
export function validateFileForUpload(file: { name: string; size: number }, maxBytes: number): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ACCEPTED_EXTENSIONS.includes(ext)) return 'Chỉ nhận ảnh JPG, PNG, tệp PDF hoặc DICOM';
  if (file.size === 0) return 'Tệp rỗng, hãy chọn tệp khác';
  if (file.size > maxBytes) return `Tệp ${formatBytes(file.size)} vượt quá ${Math.round(maxBytes / (1024 * 1024))} MB, chọn tệp nhỏ hơn`;
  return null;
}

/** Loại tệp gợi ý khi vừa chọn: ảnh → Ảnh lâm sàng, còn lại → Khác (người dùng đổi được từng tệp). */
export function suggestCategory(fileName: string, uploadable: readonly PatientDocumentCategory[]): PatientDocumentCategory | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const preferred: PatientDocumentCategory = ['jpg', 'jpeg', 'png'].includes(ext) ? 'CLINICAL_PHOTO' : 'OTHER';
  if (uploadable.includes(preferred)) return preferred;
  return uploadable[0] ?? null;
}
