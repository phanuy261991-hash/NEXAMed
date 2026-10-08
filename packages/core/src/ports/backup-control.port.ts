/**
 * Điều khiển sao lưu dữ liệu từ giao diện (docs/DECISIONS.md #217) — đối ứng của `BackupStatusPort` (cổng ĐỌC trạng thái): đọc/ghi cấu hình và gửi yêu cầu "Sao lưu ngay"
 * cho container `backup`. Container chạy tách biệt khỏi API nên v1 giao tiếp qua file trong volume dùng chung (adapter `LocalFileBackupControlAdapter`); đổi cơ chế sao lưu
 * (vd. managed backup của cloud) chỉ cần thay adapter.
 */
export interface BackupControlConfig {
  enabled: boolean;
  /** Giờ chạy hằng ngày theo giờ Việt Nam (0-23). */
  hourVn: number;
  retentionDays: number;
}

export interface BackupControlPort {
  /** Máy có container sao lưu để điều khiển không (đã cấu hình `BACKUP_STATUS_FILE`). Máy dev/cloud: `false`. */
  isAvailable(): boolean;
  /** Cấu hình hiện hành; `null` nếu container chưa từng ghi file cấu hình (mới cài, chưa chạy lần nào). */
  readConfig(): Promise<BackupControlConfig | null>;
  writeConfig(config: BackupControlConfig): Promise<void>;
  /** Gửi yêu cầu "Sao lưu ngay"; trả lúc gửi (ISO). Container nhận trong vài chục giây. */
  requestRun(): Promise<string>;
  /** Lúc có yêu cầu đang chờ container nhận, `null` nếu không. */
  readRunRequestedAt(): Promise<string | null>;
  /** Thư mục đích hiển thị cho người dùng (chỉ đọc), `null` nếu không biết. */
  destinationDir(): string | null;
}

export const BACKUP_CONTROL_PORT = Symbol('BACKUP_CONTROL_PORT');
