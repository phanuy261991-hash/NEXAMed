import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Tenant } from '@prisma/client';
import {
  ConcurrentModificationError,
  InvalidLogoError,
  STORAGE_PORT,
  sniffImageExtension,
  type StoragePort,
} from '@nexamed/core';
import type { ClinicProfile, UpdateClinicProfileRequest } from '@nexamed/shared';
import { randomUUID } from 'node:crypto';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { signFileToken } from '../../infrastructure/storage/signed-url';
import type { RequestMeta } from '../../common/request-meta';
import { ClinicProfileRepository, type UpdateClinicProfileData } from './clinic-profile.repository';

/** Logo sống 15 phút — cùng TTL/lý do `PatientService.signPhotoUrl` (tự làm mới mỗi lần gọi lại GET). */
const LOGO_URL_TTL_SECONDS = 15 * 60;
/** Logo là ảnh nhỏ (220×110/110×110) — 2MB rộng rãi, không cần 3MB như ảnh đại diện bệnh nhân. */
export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Trang "Thông tin phòng khám" (2026-08-13, `/admin/system-config`) — module `clinic` (mở rộng,
 * không tạo module mới, khớp `.claude/docs/architecture.md`: module `clinic` sở hữu "cấu hình
 * phòng khám"). `currency`/`timezone` chỉ lưu giá trị hiển thị, xem docs/DECISIONS.md #041.
 */
@Injectable()
export class ClinicProfileService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly clinicProfileRepository: ClinicProfileRepository,
    private readonly configService: ConfigService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async getProfile(tenantId: string): Promise<ClinicProfile> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const tenant = await this.clinicProfileRepository.findByTenantId(tx, tenantId);
      if (!tenant) {
        throw new Error(`Tenant không tồn tại: ${tenantId}`);
      }
      return this.toProfile(tenant);
    });
  }

  async updateProfile(
    tenantId: string,
    actorId: string,
    dto: UpdateClinicProfileRequest,
    meta: RequestMeta,
  ): Promise<ClinicProfile> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const patch: UpdateClinicProfileData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.phone !== undefined) patch.phone = dto.phone;
      if (dto.address !== undefined) patch.address = dto.address;
      if (dto.email !== undefined) patch.email = dto.email;
      if (dto.currency !== undefined) patch.currency = dto.currency;
      if (dto.taxCode !== undefined) patch.taxCode = dto.taxCode;
      if (dto.timezone !== undefined) patch.timezone = dto.timezone;

      const updatedCount = await this.clinicProfileRepository.updateIfVersionMatches(tx, tenantId, dto.version, actorId, patch);
      if (updatedCount === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'clinic_profile.updated',
        entityType: 'tenant',
        entityId: tenantId,
        afterJson: { ...dto },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const tenant = await this.clinicProfileRepository.findByTenantId(tx, tenantId);
      if (!tenant) {
        throw new Error(`Tenant không tồn tại: ${tenantId}`);
      }
      return this.toProfile(tenant);
    });
  }

  uploadLogo(tenantId: string, actorId: string, expectedVersion: number, fileBuffer: Buffer, meta: RequestMeta): Promise<ClinicProfile> {
    return this.uploadImage(tenantId, actorId, expectedVersion, fileBuffer, meta, 'logo');
  }

  uploadPrintLogo(tenantId: string, actorId: string, expectedVersion: number, fileBuffer: Buffer, meta: RequestMeta): Promise<ClinicProfile> {
    return this.uploadImage(tenantId, actorId, expectedVersion, fileBuffer, meta, 'print-logo');
  }

  /**
   * Dùng chung cho cả 2 logo (chính/in) — chỉ khác key thư mục lưu, cột cập nhật, và tên hành
   * động ghi audit. Cùng thứ tự thao tác `PatientService.uploadPhoto` (docs/DECISIONS.md #034):
   * lưu file mới trước → cập nhật cột → 0 dòng thì xoá file mới vừa lưu (không rác) → thành công
   * thì xoá file cũ SAU (tránh mất cả hai nếu lỗi giữa chừng).
   */
  private async uploadImage(
    tenantId: string,
    actorId: string,
    expectedVersion: number,
    fileBuffer: Buffer,
    meta: RequestMeta,
    kind: 'logo' | 'print-logo',
  ): Promise<ClinicProfile> {
    if (fileBuffer.byteLength > MAX_LOGO_SIZE_BYTES) {
      throw new InvalidLogoError('Ảnh logo vượt quá 2MB, vui lòng chọn ảnh nhỏ hơn.');
    }
    const extension = sniffImageExtension(fileBuffer);
    if (!extension) {
      throw new InvalidLogoError('Chỉ nhận ảnh định dạng JPG hoặc PNG.');
    }

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.clinicProfileRepository.findByTenantId(tx, tenantId);
      if (!existing) {
        throw new Error(`Tenant không tồn tại: ${tenantId}`);
      }

      const key = `tenant/${tenantId}/${kind}/${randomUUID()}.${extension}`;
      await this.storage.save(tenantId, key, fileBuffer, extension === 'jpg' ? 'image/jpeg' : 'image/png');

      const oldKey = kind === 'logo' ? existing.logoKey : existing.printLogoKey;
      const updatedCount = await this.clinicProfileRepository.updateIfVersionMatches(
        tx,
        tenantId,
        expectedVersion,
        actorId,
        kind === 'logo' ? { logoKey: key } : { printLogoKey: key },
      );
      if (updatedCount === 0) {
        await this.storage.delete(tenantId, key);
        throw new ConcurrentModificationError();
      }

      if (oldKey) {
        await this.storage.delete(tenantId, oldKey);
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: kind === 'logo' ? 'clinic_profile.logo_updated' : 'clinic_profile.print_logo_updated',
        entityType: 'tenant',
        entityId: tenantId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.clinicProfileRepository.findByTenantId(tx, tenantId);
      if (!updated) {
        throw new Error(`Tenant không tồn tại: ${tenantId}`);
      }
      return this.toProfile(updated);
    });
  }

  private toProfile(tenant: Tenant): ClinicProfile {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    return {
      name: tenant.name,
      phone: tenant.phone,
      address: tenant.address,
      email: tenant.email,
      currency: tenant.currency as ClinicProfile['currency'],
      taxCode: tenant.taxCode,
      timezone: tenant.timezone as ClinicProfile['timezone'],
      logoUrl: tenant.logoKey ? this.signFileUrl(tenant.id, tenant.logoKey, encryptionKey) : null,
      printLogoUrl: tenant.printLogoKey ? this.signFileUrl(tenant.id, tenant.printLogoKey, encryptionKey) : null,
      version: tenant.version,
    };
  }

  private signFileUrl(tenantId: string, key: string, encryptionKey: string): string {
    const exp = Math.floor(Date.now() / 1000) + LOGO_URL_TTL_SECONDS;
    const token = signFileToken({ tenantId, key, exp }, encryptionKey);
    return `/api/v1/files/${token}`;
  }
}
