import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '@nexamed/core';
import type { ZodError } from 'zod';

/**
 * Map lỗi sang response `{ error: { code, message, details } }` — theo .claude/docs/
 * architecture.md. Đây là bộ khung tối thiểu (DomainError + ZodError + HttpException) đủ cho
 * S1-04; mở rộng thêm mã lỗi (404 khác tenant, 403 thiếu quyền theo data_scope...) khi các
 * module sau có nhu cầu, không đổi hình dạng response.
 */
// 423 (Locked, WebDAV/RFC 4918) không có trong enum HttpStatus của NestJS — dùng number thuần.
const DOMAIN_ERROR_STATUS: Record<string, number> = {
  AUTH_INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  AUTH_ACCOUNT_LOCKED: 423,
  AUTH_ACCOUNT_DISABLED: HttpStatus.FORBIDDEN,
  AUTH_REFRESH_TOKEN_INVALID: HttpStatus.UNAUTHORIZED,
  AUTH_REFRESH_TOKEN_REUSED: HttpStatus.UNAUTHORIZED,
  // Xung đột với trạng thái hiện có (trùng CCCD, mất optimistic lock) — 409, không phải 422
  // (422 dành cho vi phạm quy tắc nghiệp vụ không liên quan tới trạng thái đồng thời).
  PATIENT_DUPLICATE_NATIONAL_ID: HttpStatus.CONFLICT,
  // Sai định dạng/kích thước ảnh — lỗi input của client, không phải xung đột trạng thái.
  PATIENT_INVALID_PHOTO: HttpStatus.BAD_REQUEST,
  CLINIC_INVALID_LOGO: HttpStatus.BAD_REQUEST,
  CONCURRENT_MODIFICATION: HttpStatus.CONFLICT,
  APPOINTMENT_SLOT_CONFLICT: HttpStatus.CONFLICT,
  APPOINTMENT_NOT_CANCELLABLE: HttpStatus.CONFLICT,
  USER_ACCOUNT_DUPLICATE_USERNAME: HttpStatus.CONFLICT,
  REFERENCE_CATALOG_DUPLICATE_CODE: HttpStatus.CONFLICT,
  // Sprint 3, Tiếp nhận — chuyển trạng thái/tạo encounter xung đột trạng thái hiện có, không phải
  // lỗi input (422 mặc định không phù hợp), cùng nhóm APPOINTMENT_* ở trên.
  ENCOUNTER_INVALID_TRANSITION: HttpStatus.CONFLICT,
  ENCOUNTER_ALREADY_EXISTS: HttpStatus.CONFLICT,
  ENCOUNTER_NOT_CHECKED_IN: HttpStatus.CONFLICT,
  // S3-05→07 — lưu SOAP/chẩn đoán ngoài IN_CONSULTATION, cùng nhóm ENCOUNTER_NOT_CHECKED_IN ở trên.
  ENCOUNTER_NOT_IN_CONSULTATION: HttpStatus.CONFLICT,
  // "Hàng đợi ảo" (#064) — "Nhận ca" chậm chân, cùng nhóm ENCOUNTER_NOT_CHECKED_IN ở trên.
  ENCOUNTER_ALREADY_CLAIMED: HttpStatus.CONFLICT,
  // ADM-07 — trùng tên/còn tài khoản gán là xung đột với trạng thái hiện có (409). ROLE_IMMUTABLE
  // và ROLE_INVALID_REFERENCE không có trong bảng này nên rơi về mặc định 422 (vi phạm quy tắc
  // nghiệp vụ, không phải xung đột trạng thái đồng thời).
  ROLE_DUPLICATE_NAME: HttpStatus.CONFLICT,
  ROLE_IN_USE: HttpStatus.CONFLICT,
  // Mở rộng ADM-01 — xung đột giữa Trạng thái làm việc tự-vô-hiệu-hoá và isActive:true yêu cầu.
  ACCOUNT_CANNOT_REACTIVATE_WHILE_RESIGNED: HttpStatus.CONFLICT,
  // Danh mục "Dị nguyên" (docs/DECISIONS.md #069) — trùng mã tự sinh (retry hết lượt), cùng nhóm
  // REFERENCE_CATALOG_DUPLICATE_CODE ở trên. ALLERGEN_GROUP_INVALID_REFERENCE không có trong bảng
  // này nên rơi về mặc định 422 (vi phạm quy tắc nghiệp vụ, không phải xung đột trạng thái).
  ALLERGEN_GROUP_DUPLICATE_CODE: HttpStatus.CONFLICT,
  ALLERGEN_DUPLICATE_CODE: HttpStatus.CONFLICT,
  // Kê đơn (Sprint 4) — sửa đơn đã ký (lớp phòng thủ, DB trigger C8 chặn cứng hơn) và trùng mã
  // thuốc là xung đột với trạng thái/dữ liệu hiện có, không phải lỗi input. PRESCRIPTION_REQUIRES_
  // DIAGNOSIS/PRESCRIPTION_EMPTY không có trong bảng này nên rơi về mặc định 422 (vi phạm quy tắc
  // nghiệp vụ, không phải xung đột trạng thái đồng thời).
  PRESCRIPTION_ALREADY_SIGNED: HttpStatus.CONFLICT,
  DRUG_DUPLICATE_CODE: HttpStatus.CONFLICT,
};

/**
 * Nhận diện `ZodError` theo cấu trúc thay vì `instanceof` — `loginRequestSchema` (và mọi schema
 * dùng chung khác) được định nghĩa ở `@nexamed/shared`, biên dịch sẵn thành CommonJS, còn file
 * này nằm trong `apps/api`. Hai bên có thể nạp gói `zod` qua hai đường module khác nhau tuỳ
 * bundler/runtime (đã xác nhận qua Vitest + SWC), khiến `err instanceof ZodError` sai dù đúng là
 * ZodError — `.name`/`.issues` thì ổn định qua mọi ranh giới module.
 */
function isZodError(err: unknown): err is ZodError {
  return (
    err instanceof Error &&
    err.name === 'ZodError' &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const status = DOMAIN_ERROR_STATUS[exception.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
      const details = 'lockedUntil' in exception ? { lockedUntil: (exception as { lockedUntil: Date }).lockedUntil } : undefined;
      response.status(status).json({ error: { code: exception.code, message: exception.message, details } });
      return;
    }

    if (isZodError(exception)) {
      response.status(HttpStatus.BAD_REQUEST).json({
        error: { code: 'VALIDATION_ERROR', message: 'Dữ liệu gửi lên không hợp lệ.', details: exception.issues },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        response.status(status).json({ error: { code: HttpStatus[status] ?? 'ERROR', message: body } });
        return;
      }
      // Cho phép exception ném body dạng object mang thêm field tuỳ biến (ví dụ
      // `breakGlassAvailable` của PermissionGuard) — field lạ ngoài message/code/statusCode/error
      // mặc định của Nest được gói vào `details`, không đổi hình dạng response cho các
      // HttpException thường (không có field lạ thì không có `details`).
      const bodyObj = body as Record<string, unknown>;
      const knownKeys = new Set(['message', 'code', 'statusCode', 'error']);
      const details = Object.fromEntries(Object.entries(bodyObj).filter(([key]) => !knownKeys.has(key)));
      response.status(status).json({
        error: {
          code: typeof bodyObj.code === 'string' ? bodyObj.code : (HttpStatus[status] ?? 'ERROR'),
          message: typeof bodyObj.message === 'string' ? bodyObj.message : exception.message,
          ...(Object.keys(details).length > 0 ? { details } : {}),
        },
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Có lỗi xảy ra, vui lòng thử lại.' } });
  }
}
