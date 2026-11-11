import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { projectCallSite, reportNestedTransaction, transactionScopeStorage, type TransactionScope } from './transaction-scope';

const TRANSACTION_MAX_WAIT_MS = 10_000;
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

  /**
   * `options.timeoutMs` — chỉ truyền cho tác vụ GHI HÀNG LOẠT hợp lệ chạy lâu (ví dụ "Nhập Excel Thuốc & Vật
   * tư", docs/DECISIONS.md #210); mặc định giữ timeout 5 giây của Prisma cho mọi nơi khác.
   */
  async runInTenantScope<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new Error(`tenantId không hợp lệ: "${tenantId}"`);
    }

    // Bộ phát hiện giao dịch lồng nhau (docs/DECISIONS.md #296): mở giao dịch thứ hai khi giao dịch ngoài còn chạy = request
    // chiếm 2 kết nối cùng lúc. Kiểm TRƯỚC khi xin kết nối để chế độ `throw` không tự khoá bể.
    const outer = transactionScopeStorage.getStore();
    if (outer?.active) reportNestedTransaction('runInTenantScope', outer);
    const scope: TransactionScope = { active: true, openedAt: projectCallSite() };

    return transactionScopeStorage.run(scope, () => this.runTransaction(tenantId, work, options, scope));
  }

  private async runTransaction<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { timeoutMs?: number } | undefined,
    scope: TransactionScope,
  ): Promise<T> {
    try {
      return await this.openTransaction(tenantId, work, options);
    } finally {
      // Lời gọi nền còn sót lại sau khi giao dịch đóng không còn bị coi là "lồng".
      scope.active = false;
    }
  }

  private openTransaction<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { timeoutMs?: number } | undefined,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
        return work(tx);
      },
      // `maxWait` = thời gian CHỜ LẤY KẾT NỐI từ bể trước khi báo "Unable to start a transaction in the given time" (500). Mặc
      // định của Prisma chỉ 2 giây — khi máy bận (đợt kiểm cả bộ 15:54 10/11/2026, CI lúc nhiều file chạy song song) việc chờ
      // vượt 2 giây dù không có gì sai về logic. Nâng lên 10 giây (bằng `pool_timeout` mặc định của bể) để xếp hàng thay vì lỗi.
      { maxWait: TRANSACTION_MAX_WAIT_MS, ...(options?.timeoutMs ? { timeout: options.timeoutMs } : {}) },
    );
  }
}