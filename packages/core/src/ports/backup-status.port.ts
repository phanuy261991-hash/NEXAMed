/**
 * Đọc trạng thái lần sao lưu Postgres gần nhất (S6-01, ADM-04) — xem
 * .claude/docs/project-structure.md bảng Port/adapter. Container `backup` (`deploy/on-prem/
 * backup/backup.sh`) chạy TÁCH BIỆT khỏi tiến trình API (không đi qua NestJS DI), nên không gọi
 * thẳng port này — nó ghi 1 file JSON trạng thái ra volume dùng chung, port chỉ ĐỌC file đó.
 * v1 chỉ có adapter đọc file cục bộ (`apps/api/src/infrastructure/backup-status/
 * local-file.adapter.ts`) — sau này đổi cơ chế sao lưu (ví dụ managed backup của cloud) chỉ thay
 * adapter, không sửa service.
 */
export interface BackupStatusSnapshot {
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface BackupStatusPort {
  /** Tính năng giám sát backup có được cấu hình không (biến môi trường `BACKUP_STATUS_FILE`) —
   *  máy dev không chạy container `backup` nên mặc định KHÔNG cấu hình, tránh cảnh báo giả. */
  isEnabled(): boolean;
  /** `null` khi tính năng chưa cấu hình HOẶC file trạng thái chưa từng được ghi (mới cài đặt,
   *  chưa tới lần sao lưu đầu tiên, hoặc container `backup` chưa từng chạy được — coi như "chưa
   *  có lần sao lưu nào thành công", đúng bản chất rủi ro cần cảnh báo). */
  read(): Promise<BackupStatusSnapshot | null>;
}

export const BACKUP_STATUS_PORT = Symbol('BACKUP_STATUS_PORT');
