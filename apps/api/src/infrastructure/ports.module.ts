import { Global, Module } from '@nestjs/common';
import { BACKUP_STATUS_PORT, EVENT_BUS_PORT, INSURANCE_GATEWAY_PORT, PATIENT_IDENTITY_PORT, PDF_RENDERER_PORT, SIGNATURE_PORT, STORAGE_PORT } from '@nexamed/core';
import { LocalDiskStorageAdapter } from './storage/local-disk.adapter';
import { InMemoryEventBusAdapter } from './eventbus/in-memory.adapter';
import { NoopSignatureAdapter } from './signature/noop.adapter';
import { NoopInsuranceGatewayAdapter } from './insurance/noop.adapter';
import { SameTenantPatientIdentityAdapter } from './patient-identity/same-tenant.adapter';
import { LocalFileBackupStatusAdapter } from './backup-status/local-file.adapter';
import { PuppeteerPdfRendererAdapter } from './pdf/puppeteer-pdf-renderer.adapter';

/**
 * Đăng ký DI cho 5 port còn lại của S1-06 (Storage/EventBus/Signature/Insurance/
 * PatientIdentity) — NotificationPort đã đăng ký riêng trong `IamModule` từ S1-04c, không đụng
 * lại. Global vì chưa có module nghiệp vụ nào tiêu thụ các port này (patient/encounter/
 * prescription là việc của S2+): mọi domain module tương lai `@Inject()` thẳng token, không cần
 * import module này. Theo .claude/docs/project-structure.md: "Adapter no-op phải tồn tại và
 * được đăng ký, không để service gọi vào undefined."
 * `BACKUP_STATUS_PORT` (S6-01) thêm sau — cùng lý do Global, `BackupStatusModule` chỉ
 * `@Inject()` thẳng token.
 * `PDF_RENDERER_PORT` (S6-06, ADM-05) — Global cùng lý do, module `encounter` (xuất bệnh án PDF)
 * `@Inject()` thẳng token, không cần import module này.
 */
@Global()
@Module({
  providers: [
    { provide: STORAGE_PORT, useClass: LocalDiskStorageAdapter },
    { provide: EVENT_BUS_PORT, useClass: InMemoryEventBusAdapter },
    { provide: SIGNATURE_PORT, useClass: NoopSignatureAdapter },
    { provide: INSURANCE_GATEWAY_PORT, useClass: NoopInsuranceGatewayAdapter },
    { provide: PATIENT_IDENTITY_PORT, useClass: SameTenantPatientIdentityAdapter },
    { provide: BACKUP_STATUS_PORT, useClass: LocalFileBackupStatusAdapter },
    { provide: PDF_RENDERER_PORT, useClass: PuppeteerPdfRendererAdapter },
  ],
  exports: [STORAGE_PORT, EVENT_BUS_PORT, SIGNATURE_PORT, INSURANCE_GATEWAY_PORT, PATIENT_IDENTITY_PORT, BACKUP_STATUS_PORT, PDF_RENDERER_PORT],
})
export class PortsModule {}
