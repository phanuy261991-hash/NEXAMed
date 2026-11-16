/**
 * Lưu/đọc/xoá file (ảnh sinh hiệu, file đính kèm...) — xem .claude/docs/project-structure.md
 * bảng Port/adapter. v1 adapter ghi thẳng ra disk cục bộ (`apps/api/src/infrastructure/storage/
 * local-disk.adapter.ts`); sau này đổi sang S3/MinIO chỉ thay adapter, không sửa service.
 *
 * Không có endpoint phục vụ file qua signed URL ở S1-06 (chưa có module nào cần upload) — thêm
 * khi module đầu tiên thật sự cần (ví dụ scan thẻ BHYT, xuất PDF bệnh án), theo đúng yêu cầu
 * "lưu ngoài web root, phục vụ qua signed URL có hạn" ở .claude/docs/security-audit.md.
 */
export interface StoredFileRef {
  key: string;
  sizeBytes: number;
  contentType: string;
}

export interface StoragePort {
  save(tenantId: string, key: string, content: Uint8Array, contentType: string): Promise<StoredFileRef>;
  read(tenantId: string, key: string): Promise<Uint8Array>;
  delete(tenantId: string, key: string): Promise<void>;
  /** Dung lượng (byte) của một tệp đã lưu; `null` nếu tệp không còn trong kho. Không đọc nội dung tệp. */
  sizeOf(tenantId: string, key: string): Promise<number | null>;
  /** Dung lượng tổng và còn trống của ổ chứa kho lưu (để nhắc ổ sắp đầy); `null` khi kho không có khái niệm đó (ví dụ kho đám mây) hoặc không đọc được. */
  volumeUsage(): Promise<{ totalBytes: number; freeBytes: number } | null>;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');
