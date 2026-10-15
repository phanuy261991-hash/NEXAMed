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

  findById(id: string): Promise<TenantDirectoryEntry | null> {
    return this.prisma.tenant.findFirst({ where: { id, deletedAt: null }, select: SELECT });
  }

  async isSuspended(tenantId: string): Promise<boolean> {
    const entry = await this.findById(tenantId);
    return entry !== null && entry.suspendedAt !== null;
  }
}
