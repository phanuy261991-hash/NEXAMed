import { z } from 'zod';
import { backupStatusResponseSchema } from './backup-status';

/**
 * Cấu hình sao lưu dữ liệu (bản cài on-premise, docs/DECISIONS.md #217). Sao lưu chạy ở container `backup` TÁCH BIỆT khỏi API; API chỉ ghi file cấu hình vào
 * volume dùng chung để container đọc lại. Là cấu hình của CẢ MÁY CHỦ (không theo tenant). Thư mục lưu bản sao KHÔNG nằm ở đây — đó là điểm gắn của container
 * (`BACKUP_HOST_DIR` trong `.env`), giao diện chỉ hiển thị.
 */
export const backupConfigSchema = z.object({
  /** Bật sao lưu tự động hằng ngày. Tắt thì chỉ còn "Sao lưu ngay"; banner cảnh báo vẫn hiện khi quá lâu chưa có bản sao lưu thành công. */
  enabled: z.boolean(),
  /** Giờ chạy mỗi ngày theo GIỜ VIỆT NAM (0-23). Container chạy giờ UTC, script tự quy đổi. */
  hourVn: z.number().int().min(0).max(23),
  /** Số ngày giữ các bản `.dump` trước khi tự xoá (thư mục ảnh không bị dọn). */
  retentionDays: z.number().int().min(1).max(365),
});
export type BackupConfig = z.infer<typeof backupConfigSchema>;

export const backupConfigResponseSchema = z.object({
  /** `false` khi máy không chạy container sao lưu (máy dev, bản cloud) — giao diện ẩn mục này. */
  available: z.boolean(),
  config: backupConfigSchema,
  /** Thư mục đích trên máy chủ (chỉ hiển thị; muốn đổi phải sửa `.env` rồi khởi động lại dịch vụ `backup`). `null` nếu không biết. */
  destinationDir: z.string().nullable(),
  /** Lúc có yêu cầu "Sao lưu ngay" đang chờ container nhận (`null` = không có yêu cầu nào đang chờ). */
  runRequestedAt: z.string().nullable(),
  /** Trạng thái lần sao lưu gần nhất — kèm sẵn ở đây vì quản trị hệ thống không có `clinic_config.read` để gọi `GET /backup-status`. */
  status: backupStatusResponseSchema,
});
export type BackupConfigResponse = z.infer<typeof backupConfigResponseSchema>;

export const updateBackupConfigRequestSchema = backupConfigSchema;
export type UpdateBackupConfigRequest = z.infer<typeof updateBackupConfigRequestSchema>;

export const backupRunRequestResponseSchema = z.object({ requestedAt: z.string() });
export type BackupRunRequestResponse = z.infer<typeof backupRunRequestResponseSchema>;
