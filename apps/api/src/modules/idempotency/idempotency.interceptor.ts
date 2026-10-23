import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, StreamableFile } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { DomainError, IDEMPOTENCY_KEY_HEADER, IdempotencyKeyInvalidError, isValidIdempotencyKey, stableStringify } from '@nexamed/core';
import { IdempotencyService, type AcquireOutcome } from './idempotency.service';

/**
 * Chống ghi trùng khi mạng đứt giữa chừng (docs/DECISIONS.md #257, chủ dự án chọn phương án A 23/10/2026). Đăng ký toàn cục (`APP_INTERCEPTOR`) nên MỌI POST
 * mới tự được phủ — endpoint mới không cần làm gì.
 *
 * Chỉ tác động khi: là POST JSON, đã đăng nhập (guard chạy trước interceptor) và có header `Idempotency-Key`. Thiếu header → chạy y như cũ (không tốn thêm truy vấn nào).
 * Lần đầu: giữ chỗ khoá → chạy nghiệp vụ → lưu phản hồi (mã hoá). Lần gửi lại cùng khoá và cùng nội dung: trả ĐÚNG phản hồi cũ, KHÔNG chạy nghiệp vụ nên không
 * ghi bản nào, không audit thêm; header `Idempotent-Replayed: true` để dễ truy vết. Mã trạng thái HTTP của lần gửi lại do chính handler quyết (cùng route → cùng mã).
 *
 * Vân tay yêu cầu = phương thức + URL (kèm query) + người gửi + chi nhánh của phiên + thân JSON (khoá sắp xếp) — cùng khoá nhưng khác nội dung thì không phải "bấm lại".
 * Bỏ qua `multipart/*` (interceptor toàn cục chạy trước khi tải tệp được đọc nên không có nội dung để so).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly service: IdempotencyService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    if (req.method !== 'POST') return next.handle();

    const header = req.headers[IDEMPOTENCY_KEY_HEADER];
    if (header === undefined) return next.handle();
    const user = req.user;
    if (!user) return next.handle();
    if ((req.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/')) return next.handle();

    const requestKey = ((Array.isArray(header) ? header[0] : header) ?? '').trim();
    if (!isValidIdempotencyKey(requestKey)) throw new IdempotencyKeyInvalidError();

    let outcome: AcquireOutcome;
    try {
      outcome = await this.service.acquire(user.tenantId, user.userId, {
        requestKey: requestKey.toLowerCase(),
        requestHash: fingerprint(req, user.userId, user.branchId),
        method: req.method,
        path: req.originalUrl.split('?')[0] ?? req.originalUrl,
      });
    } catch (error) {
      // Lỗi nghiệp vụ của chính cơ chế (dùng lại khoá, đang xử lý, không replay được) → trả về như mọi lỗi nghiệp vụ. Lỗi HẠ TẦNG (CSDL...) thì KHÔNG chặn thao tác:
      // chạy như khi chưa có khoá — người dùng không bị kẹt vì một cơ chế phụ trợ trục trặc.
      if (error instanceof DomainError) throw error;
      this.logger.error(`Khoá chống ghi trùng lỗi hạ tầng, chạy không có khoá: ${error instanceof Error ? error.message : String(error)}`);
      return next.handle();
    }

    if (outcome.kind === 'replay') {
      http.getResponse<{ setHeader(name: string, value: string): void }>().setHeader('Idempotent-Replayed', 'true');
      return of(outcome.value);
    }

    const { tenantId, userId } = user;
    const { id } = outcome;
    return next.handle().pipe(
      // Thành công → lưu phản hồi (tệp/luồng nhị phân không lưu JSON được thì nhả khoá). Lưu lỗi không làm hỏng phản hồi (service đã nuốt và log).
      mergeMap((data) => from(isJsonStorable(data) ? this.service.complete(tenantId, userId, id, data) : this.service.fail(tenantId, userId, id)).pipe(mergeMap(() => of(data)))),
      // Nghiệp vụ lỗi → nhả khoá (chưa ghi gì) rồi ném lại đúng lỗi gốc.
      catchError((error: unknown) => from(this.service.fail(tenantId, userId, id)).pipe(mergeMap(() => throwError(() => error)))),
    );
  }
}

function fingerprint(req: Request, userId: string, branchId: string | null): string {
  let bodyText: string;
  try {
    bodyText = stableStringify(req.body ?? null);
  } catch {
    // Thân không tuần tự hoá được (không xảy ra với JSON) — dùng chuỗi cố định để vẫn tạo được vân tay.
    bodyText = '[unserializable]';
  }
  return createHash('sha256').update([req.method, req.originalUrl, userId, branchId ?? '', bodyText].join('\n')).digest('hex');
}

/** Tệp/luồng nhị phân (xuất Excel/PDF...) không lưu dạng JSON được — nhả khoá, thao tác giữ nguyên hành vi cũ. */
function isJsonStorable(data: unknown): boolean {
  return !(data instanceof StreamableFile || Buffer.isBuffer(data));
}
