import { z } from 'zod';

/**
 * Tab "Hình ảnh & Tài liệu" của hồ sơ bệnh nhân (docs/DECISIONS.md #299, docs/product/patient-documents-plan.md).
 * Nơi tổng hợp DUY NHẤT mọi hình ảnh/tài liệu gắn bệnh nhân: tệp tải tay (UPLOAD) và dòng THAM CHIẾU chỉ đọc lấy từ nơi khác (kết quả cận lâm sàng đã duyệt kể cả PDF đối tác,
 * ảnh thẻ BHYT, ảnh đại diện) — giai đoạn 2, máy chủ tự đối chiếu với nguồn mỗi lần mở tab, không nhân đôi tệp.
 */

/** Dung lượng tối đa mỗi tệp tải lên: 15 MB (trình duyệt tự thu nhỏ ảnh quá lớn trước khi gửi). */
export const PATIENT_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
export const PATIENT_DOCUMENT_FOLDER_NAME_MAX = 60;
export const PATIENT_DOCUMENT_DISPLAY_NAME_MAX = 200;
export const PATIENT_DOCUMENT_NOTE_MAX = 1000;

export const PATIENT_DOCUMENT_CATEGORIES = ['PARACLINICAL', 'CLINICAL_PHOTO', 'CONTRACT', 'OTHER'] as const;
export const patientDocumentCategorySchema = z.enum(PATIENT_DOCUMENT_CATEGORIES);
export type PatientDocumentCategory = z.infer<typeof patientDocumentCategorySchema>;

export const PATIENT_DOCUMENT_CATEGORY_LABEL: Record<PatientDocumentCategory, string> = {
  PARACLINICAL: 'Kết quả cận lâm sàng',
  CLINICAL_PHOTO: 'Ảnh lâm sàng',
  CONTRACT: 'Hợp đồng và giấy tờ',
  OTHER: 'Khác',
};

/** Hai nhóm quyền độc lập: tệp LÂM SÀNG (`patient_document.*`) và HỢP ĐỒNG VÀ GIẤY TỜ (`patient_contract.*`). */
export type PatientDocumentGroup = 'clinical' | 'contract';
export function patientDocumentGroupOf(category: PatientDocumentCategory): PatientDocumentGroup {
  return category === 'CONTRACT' ? 'contract' : 'clinical';
}
export const PATIENT_DOCUMENT_PERMISSION_MODULE: Record<PatientDocumentGroup, 'patient_document' | 'patient_contract'> = {
  clinical: 'patient_document',
  contract: 'patient_contract',
};

export const patientDocumentSourceSchema = z.enum(['UPLOAD', 'PARACLINICAL_IMAGE', 'LAB_PARTNER_RESULT', 'INSURANCE_CARD', 'PATIENT_PHOTO']);
export type PatientDocumentSource = z.infer<typeof patientDocumentSourceSchema>;

/** Cách hiển thị: ảnh xem trực tiếp, PDF xem trong khung, DICOM chỉ tải về (chưa có trình xem). */
export const patientDocumentKindSchema = z.enum(['image', 'pdf', 'dicom']);
export type PatientDocumentKind = z.infer<typeof patientDocumentKindSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const patientDocumentSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  category: patientDocumentCategorySchema,
  source: patientDocumentSourceSchema,
  /** `true` với dòng tham chiếu (không phải tải tay): chỉ xem và tải về, sửa/xoá ở chỗ gốc. */
  readOnly: z.boolean(),
  /** Dòng tham chiếu kết quả cận lâm sàng: tên dịch vụ ("Siêu âm ổ bụng") để hiện "Kết quả CLS · Siêu âm ổ bụng"; các dòng khác là `null`. */
  sourceLabel: z.string().nullable(),
  /** Dòng tham chiếu kết quả cận lâm sàng: dịch vụ và lượt khám chứa kết quả, để nút "Mở kết quả" tìm đúng; các dòng khác là `null`. */
  sourceRef: z.object({ orderItemId: z.string().uuid(), encounterId: z.string().uuid(), group: z.enum(['lab', 'imaging']) }).nullable(),
  fileName: z.string(),
  displayName: z.string(),
  contentType: z.string(),
  kind: patientDocumentKindSchema,
  sizeBytes: z.number().int().nonnegative(),
  note: z.string().nullable(),
  folderId: z.string().uuid().nullable(),
  folderName: z.string().nullable(),
  encounterId: z.string().uuid().nullable(),
  encounterLabel: z.string().nullable(),
  uploadedAt: z.string(),
  uploadDate: isoDate,
  uploadedByName: z.string(),
  branchId: z.string().uuid(),
  branchName: z.string().nullable(),
  /** Đường dẫn ký có hạn 15 phút (làm mới mỗi lần gọi lại danh sách). */
  url: z.string(),
  version: z.number().int(),
});
export type PatientDocument = z.infer<typeof patientDocumentSchema>;

export const patientDocumentFolderSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  lastUploadDate: isoDate.nullable(),
  version: z.number().int(),
});
export type PatientDocumentFolder = z.infer<typeof patientDocumentFolderSchema>;

const accessSchema = z.object({ read: z.boolean(), upload: z.boolean(), delete: z.boolean() });
export const patientDocumentAccessSchema = z.object({ clinical: accessSchema, contract: accessSchema });
export type PatientDocumentAccess = z.infer<typeof patientDocumentAccessSchema>;

export const patientDocumentCategorySummarySchema = z.object({
  category: patientDocumentCategorySchema,
  count: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  lastUploadDate: isoDate.nullable(),
});

export const patientDocumentSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  firstUploadDate: isoDate.nullable(),
  lastUploadDate: isoDate.nullable(),
  byCategory: z.array(patientDocumentCategorySummarySchema),
});
export type PatientDocumentSummary = z.infer<typeof patientDocumentSummarySchema>;

export const listPatientDocumentsQuerySchema = z.object({
  category: patientDocumentCategorySchema.optional(),
  /** UUID thư mục tự tạo, hoặc `none` = tệp chưa vào thư mục nào. */
  folderId: z.union([z.string().uuid(), z.literal('none')]).optional(),
  q: z.string().trim().max(100).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});
export type ListPatientDocumentsQuery = z.infer<typeof listPatientDocumentsQuerySchema>;

export const listPatientDocumentsResponseSchema = z.object({
  items: z.array(patientDocumentSchema),
  nextCursor: z.string().nullable(),
  /** Tổng quan KHÔNG phụ thuộc bộ lọc (dải số, đếm theo loại), chỉ gồm loại tệp người xem được phép. */
  summary: patientDocumentSummarySchema,
  folders: z.array(patientDocumentFolderSchema),
  access: patientDocumentAccessSchema,
  /** `true` khi công ty có từ 2 chi nhánh: web hiện cột Chi nhánh và tô nền tệp ở chi nhánh khác. */
  multiBranch: z.boolean(),
  currentBranchId: z.string().uuid(),
});
export type ListPatientDocumentsResponse = z.infer<typeof listPatientDocumentsResponseSchema>;

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/** Các trường kèm theo tệp trong form multipart (tệp nằm ở trường `file`). */
export const uploadPatientDocumentFormSchema = z.object({
  category: patientDocumentCategorySchema,
  folderId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  encounterId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  note: z.preprocess(emptyToUndefined, z.string().trim().max(PATIENT_DOCUMENT_NOTE_MAX).optional()),
});
export type UploadPatientDocumentForm = z.infer<typeof uploadPatientDocumentFormSchema>;

export const updatePatientDocumentRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(PATIENT_DOCUMENT_DISPLAY_NAME_MAX).optional(),
  category: patientDocumentCategorySchema.optional(),
  folderId: z.string().uuid().nullable().optional(),
  encounterId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(PATIENT_DOCUMENT_NOTE_MAX).nullable().optional(),
  version: z.number().int().min(1),
});
export type UpdatePatientDocumentRequest = z.infer<typeof updatePatientDocumentRequestSchema>;

export const removePatientDocumentQuerySchema = z.object({
  reason: z.string().trim().min(2, 'Nhập lý do xoá.').max(500),
  version: z.coerce.number().int().min(1),
});
export type RemovePatientDocumentQuery = z.infer<typeof removePatientDocumentQuerySchema>;

export const createPatientDocumentFolderRequestSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên thư mục.').max(PATIENT_DOCUMENT_FOLDER_NAME_MAX),
});
export type CreatePatientDocumentFolderRequest = z.infer<typeof createPatientDocumentFolderRequestSchema>;

export const renamePatientDocumentFolderRequestSchema = createPatientDocumentFolderRequestSchema.extend({ version: z.number().int().min(1) });
export type RenamePatientDocumentFolderRequest = z.infer<typeof renamePatientDocumentFolderRequestSchema>;

export const removePatientDocumentFolderQuerySchema = z.object({ version: z.coerce.number().int().min(1) });
export type RemovePatientDocumentFolderQuery = z.infer<typeof removePatientDocumentFolderQuerySchema>;

export const patientDocumentEncounterOptionSchema = z.object({
  id: z.string().uuid(),
  /** "13/11/2026 · Khám tổng quát" */
  label: z.string(),
});
export const listPatientDocumentEncounterOptionsResponseSchema = z.object({ items: z.array(patientDocumentEncounterOptionSchema) });
export type PatientDocumentEncounterOption = z.infer<typeof patientDocumentEncounterOptionSchema>;
export type ListPatientDocumentEncounterOptionsResponse = z.infer<typeof listPatientDocumentEncounterOptionsResponseSchema>;
