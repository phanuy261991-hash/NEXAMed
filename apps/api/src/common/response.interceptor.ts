import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/** Bọc mọi response thành công thành `{ data, meta }` — theo .claude/docs/architecture.md. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<{ data: unknown; meta: Record<string, never> }> {
    return next.handle().pipe(map((data: unknown) => ({ data, meta: {} })));
  }
}
