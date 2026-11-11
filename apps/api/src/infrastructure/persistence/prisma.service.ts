import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { reportNestedTransaction, transactionScopeStorage } from './transaction-scope';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // `@Optional()`: Nest không tìm thấy nhà cung cấp cho kiểu `options` thì để trống (dùng cấu hình mặc định); các spec truyền
  // `{ datasources }` thủ công như trước.
  constructor(@Optional() options?: Prisma.PrismaClientOptions) {
    super(options);
    // Truy vấn bằng client GỐC (không phải `tx`) khi một giao dịch đang mở trong cùng luồng bất đồng bộ = lấy thêm một kết nối từ
    // bể trong lúc giữ kết nối của giao dịch (docs/DECISIONS.md #296). `runInTransaction` là cờ Prisma đặt cho truy vấn của
    // chính `tx`, nên truy vấn đúng cách không bị báo.
    this.$use(async (params, next) => {
      if (!params.runInTransaction) {
        const outer = transactionScopeStorage.getStore();
        if (outer?.active) reportNestedTransaction('prisma-client-query', outer, `${params.model ?? 'raw'}.${params.action}`);
      }
      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
