import { Injectable } from '@nestjs/common';
import type { TenantAccessPort } from '@nexamed/core';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

export interface TenantDirectoryEntry {
  id: string;
  name: string;
  code: string | null;
  suspendedAt: Date | null;
  suspendedReason: string | null;
}

const SELECT = { id: true, name: true, code: true, suspendedAt: true, suspendedReason: true } as const;

/**
 * Tra danh bạ công ty (bảng `tenant`, không có RLS vì là gốc của tenant — docs/DECISIONS.md #011) để nhận biết công ty theo tên miền phụ và kiểm tra trạng thái tạm ngưng (#237).
 * Chỉ đọc; việc tạo/khoá công ty nằm ở module `platform`. Công ty đã xoá mềm (`deleted_at`) coi như không tồn tại.
 */
@Injectable()
export class TenantDirectoryRepository implements TenantAccessPort {
  constructor(private readonly prisma: PrismaService) {}

  findByCode(code: string): Promise<TenantDirectoryEntry | null> {
    return this.prisma.tenant.findFirst({ where: { code, deletedAt: null }, select: SELECT });
  }

  /**
   * Mã công ty cũ còn trong thời gian giữ lối tắt (docs/DECISIONS.md #245) → MÃ HIỆN TẠI của công ty đó (đi theo `tenant_id`, nên đổi mã nhiều lần vẫn dẫn tới mã mới nhất).
   * `null` nếu không có lối tắt còn hạn, công ty đã xoá, hoặc mã hiện tại trùng chính mã đang tra.
   */
  async findCurrentCodeByAlias(code: string, now: Date): Promise<string | null> {
    const alias = await this.prisma.tenantCodeAlias.findFirst({
      where: { oldCode: code, expiresAt: { gt: now }, deletedAt: null, tenant: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      select: { tenant: { select: { code: true } } },
    });
    const current = alias?.tenant.code ?? null;
    return current !== null && current !== code ? current : null;
  }

  findById(id: string): Promise<TenantDirectoryEntry | null> {
    return this.prisma.tenant.findFirst({ where: { id, deletedAt: null }, select: SELECT });
  }

  async isSuspended(tenantId: string): Promise<boolean> {
    const entry = await this.findById(tenantId);
    return entry !== null && entry.suspendedAt !== null;
  }
}
