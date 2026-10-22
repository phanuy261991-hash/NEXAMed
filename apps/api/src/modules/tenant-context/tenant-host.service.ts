import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { TenantNotFoundError, resolveHost, type HostResolution } from '@nexamed/core';
import type { Env } from '../../config/env.schema';
import { TenantDirectoryRepository, type TenantDirectoryEntry } from './tenant-directory.repository';

/** Mỗi request có token đều hỏi trạng thái công ty — đệm ngắn để không truy vấn DB mỗi lần; khoá công ty còn xoá đệm ngay (`invalidate`) nên độ trễ thực tế chỉ ở máy chủ khác. */
const CACHE_TTL_MS = 5_000;

export interface ResolvedTenant {
  tenantId: string;
  name: string;
  code: string;
  suspended: boolean;
}

/**
 * Nhận biết công ty/khu quản trị theo tên miền phụ của request ở chế độ SaaS (docs/DECISIONS.md #237). Chế độ một công ty (`DEPLOYMENT_MODE=single`) KHÔNG dùng lớp này:
 * mọi hàm trả "không áp dụng" để hành vi on-prem/VPS/NAS giữ nguyên. Tên miền lấy từ header `Host` (reverse proxy phải chuyển nguyên Host của khách).
 */
@Injectable()
export class TenantHostService {
  private readonly cache = new Map<string, { entry: TenantDirectoryEntry | null; at: number }>();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly directory: TenantDirectoryRepository,
  ) {}

  isSaas(): boolean {
    return this.config.get('DEPLOYMENT_MODE', { infer: true }) === 'saas';
  }

  baseDomain(): string {
    return this.config.get('PLATFORM_BASE_DOMAIN', { infer: true }) ?? '';
  }

  adminHost(): string {
    return `${this.config.get('PLATFORM_ADMIN_SUBDOMAIN', { infer: true })}.${this.baseDomain()}`;
  }

  /** Địa chỉ đăng nhập của một công ty (hiển thị cho người vận hành). `http` chỉ khi chạy thử trên localhost. */
  loginUrlFor(code: string): string {
    const base = this.baseDomain();
    return `${base === 'localhost' ? 'http' : 'https'}://${code}.${base}`;
  }

  resolveRequestHost(req: Request): HostResolution {
    if (!this.isSaas()) return { kind: 'unknown' };
    return resolveHost(req.header('host'), { baseDomain: this.baseDomain(), adminSubdomain: this.config.get('PLATFORM_ADMIN_SUBDOMAIN', { infer: true }) });
  }

  /**
   * Địa chỉ đăng nhập MỚI của công ty khi request đến bằng MÃ CŨ còn trong thời gian giữ lối tắt (docs/DECISIONS.md #245); `null` nếu không phải trường hợp đó.
   * Chỉ dùng để chuyển hướng trình duyệt: mọi thao tác khác trên tên miền cũ vẫn bị coi là không có công ty (token/cookie gắn với tên miền mới).
   */
  async resolveMovedLoginUrl(req: Request): Promise<string | null> {
    const host = this.resolveRequestHost(req);
    if (host.kind !== 'tenant') return null;
    const currentCode = await this.directory.findCurrentCodeByAlias(host.code, new Date());
    return currentCode ? this.loginUrlFor(currentCode) : null;
  }

  /** Công ty ứng với tên miền phụ của request; `null` nếu không phải tên miền công ty hoặc công ty không tồn tại. */
  async resolveTenant(req: Request): Promise<ResolvedTenant | null> {
    const host = this.resolveRequestHost(req);
    if (host.kind !== 'tenant') return null;
    const entry = await this.lookup(host.code);
    return entry && entry.code ? { tenantId: entry.id, name: entry.name, code: entry.code, suspended: entry.suspendedAt !== null } : null;
  }

  /**
   * Chốt chặn đăng nhập/làm mới phiên: ở SaaS, `tenantId` do client gửi (hoặc ghi trong refresh token) PHẢI là công ty của tên miền đang truy cập — không cho một tên miền phụ thao tác
   * trên công ty khác. Sai → `TenantNotFoundError` (không phân biệt "không tồn tại" với "không phải công ty này"). Chế độ một công ty: bỏ qua.
   */
  async assertRequestTenant(req: Request, tenantId: string): Promise<void> {
    if (!this.isSaas()) return;
    const resolved = await this.resolveTenant(req);
    if (!resolved || resolved.tenantId !== tenantId) throw new TenantNotFoundError();
  }

  /** Công ty của tên miền đang truy cập (chế độ SaaS) hoặc `undefined` (chế độ một công ty). Không có công ty ứng với tên miền → `TenantNotFoundError`. */
  async requireRequestTenantId(req: Request): Promise<string | undefined> {
    if (!this.isSaas()) return undefined;
    const resolved = await this.resolveTenant(req);
    if (!resolved) throw new TenantNotFoundError();
    return resolved.tenantId;
  }

  /** Dùng ở middleware mỗi request có token: công ty còn hoạt động không (đệm 5 giây). Chế độ một công ty luôn `true`. */
  async isTenantActive(tenantId: string): Promise<boolean> {
    if (!this.isSaas()) return true;
    const entry = await this.lookupById(tenantId);
    return entry !== null && entry.suspendedAt === null;
  }

  /** Xoá đệm của một công ty (sau khi khoá/mở/tạo) để request kế tiếp thấy trạng thái mới ngay trên tiến trình này. */
  invalidate(): void {
    this.cache.clear();
  }

  private async lookup(code: string): Promise<TenantDirectoryEntry | null> {
    return this.cached(`code:${code}`, () => this.directory.findByCode(code));
  }

  private async lookupById(id: string): Promise<TenantDirectoryEntry | null> {
    return this.cached(`id:${id}`, () => this.directory.findById(id));
  }

  private async cached(key: string, load: () => Promise<TenantDirectoryEntry | null>): Promise<TenantDirectoryEntry | null> {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.entry;
    const entry = await load();
    this.cache.set(key, { entry, at: now });
    return entry;
  }
}
