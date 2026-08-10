/**
 * Khung entity thuần — phản ánh 8 cột bắt buộc mọi bảng nghiệp vụ (.claude/docs/data-model.md).
 * Entity domain cụ thể (patient, appointment, encounter... từ S2+) extend `BaseEntity`, không
 * khai lại 8 trường này ở từng nơi.
 */
export interface BaseEntity {
  id: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
  createdBy: string;
  updatedBy: string;
}

/**
 * Khung cho bảng append-only (audit_log, break_glass_session) — không có updated_at/deleted_at/
 * version/created_by/updated_by, dùng occurred_at làm mốc thời gian và actor_id làm actor
 * (xem .claude/docs/data-model.md, ngoại lệ 8 cột bắt buộc).
 */
export interface AppendOnlyEntity {
  id: string;
  tenantId: string;
  actorId: string | null;
  occurredAt: Date;
}

/**
 * Khung cho dữ liệu lâm sàng có thể ký (clinical_note, prescription từ S3/S4) — bản ghi đã ký
 * bất biến, sửa = bản ghi mới trỏ `supersedesId` (xem .claude/docs/clinical-workflow.md mục
 * Amendment).
 */
export interface SignableEntity extends BaseEntity {
  signedAt: Date | null;
  signedBy: string | null;
  supersedesId: string | null;
  amendmentReason: string | null;
}

/**
 * Quy tắc nghiệp vụ dùng chung: bản ghi đã ký không được sửa (chỉ tạo amendment mới) — nguồn sự
 * thật duy nhất cho quy tắc này, service domain gọi thay vì tự so sánh `signedAt !== null`.
 */
export function isSigned(entity: Pick<SignableEntity, 'signedAt'>): boolean {
  return entity.signedAt !== null;
}
