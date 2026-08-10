/**
 * Lớp gốc cho lỗi nghiệp vụ — xem .claude/docs/coding-standards.md mục Xử lý lỗi. `code` là
 * hằng số ổn định (không đổi theo message hiển thị), filter tầng HTTP dựa vào `code`/class để
 * map status, không parse message.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
