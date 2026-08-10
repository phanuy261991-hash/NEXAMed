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
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');
