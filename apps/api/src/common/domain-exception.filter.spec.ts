import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { DomainExceptionFilter } from './domain-exception.filter';

function run(exception: unknown) {
  const json = vi.fn((_body: unknown) => undefined);
  const status = vi.fn((_code: number) => ({ json }));
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost;
  new DomainExceptionFilter().catch(exception, host);
  return { status: status.mock.calls[0]?.[0] as number, body: json.mock.calls[0]?.[0] as { error: { code: string; message: string } } };
}

/** Giống lỗi Prisma thật khi đường dẫn mang id không phải UUID (`GET /inventory/receipts/abc`). */
function prismaError(code: string, message: string) {
  const e = new Error(message);
  e.name = 'PrismaClientKnownRequestError';
  (e as unknown as { code: string }).code = code;
  return e;
}

describe('DomainExceptionFilter — id sai định dạng UUID', () => {
  it('P2023 do UUID → 404 NOT_FOUND bằng tiếng Việt, không phải 500', () => {
    const r = run(prismaError('P2023', 'Inconsistent column data: Error creating UUID, invalid character'));
    expect(r.status).toBe(404);
    expect(r.body.error).toEqual({ code: 'NOT_FOUND', message: 'Không tìm thấy dữ liệu.' });
  });

  it('P2023 KHÔNG liên quan UUID vẫn là 500 (không nuốt lỗi dữ liệu thật)', () => {
    expect(run(prismaError('P2023', 'Inconsistent column data: số quá lớn')).status).toBe(500);
  });

  it('lỗi Prisma khác (P2002) vẫn là 500', () => {
    expect(run(prismaError('P2002', 'Unique constraint failed on UUID')).status).toBe(500);
  });
});
