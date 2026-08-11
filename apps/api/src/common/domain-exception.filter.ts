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
      const message = typeof body === 'string' ? body : ((body as { message?: string }).message ?? exception.message);
      response.status(status).json({ error: { code: HttpStatus[status] ?? 'ERROR', message } });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Có lỗi xảy ra, vui lòng thử lại.' } });
  }
}
