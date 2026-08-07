import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mở một transaction, set `app.current_tenant_id` cho phiên Postgres trong transaction đó
 * (Row Level Security dựa vào giá trị này — xem prisma/migrations/*_tenant_context), rồi chạy
 * `work`. Toàn bộ thao tác ghi (nghiệp vụ + audit_log) phải nằm trong cùng transaction này để
 * rollback đồng thời (xem .claude/docs/coding-standards.md, .claude/docs/security-audit.md).
 *
 * `SET LOCAL` không hỗ trợ bind parameter nên tenantId được validate là UUID trước khi nối
 * chuỗi — chặn SQL injection qua giá trị này.
 */
@Injectable()
export class UnitOfWorkService {
  constructor(private readonly prisma: PrismaService) {}

  async runInTenantScope<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new Error(`tenantId không hợp lệ: "${tenantId}"`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
      return work(tx);
    });
  }
}