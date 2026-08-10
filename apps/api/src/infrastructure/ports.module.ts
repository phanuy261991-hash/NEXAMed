import { Global, Module } from '@nestjs/common';
import { EVENT_BUS_PORT, INSURANCE_GATEWAY_PORT, PATIENT_IDENTITY_PORT, SIGNATURE_PORT, STORAGE_PORT } from '@nexamed/core';
import { LocalDiskStorageAdapter } from './storage/local-disk.adapter';
import { InMemoryEventBusAdapter } from './eventbus/in-memory.adapter';
import { NoopSignatureAdapter } from './signature/noop.adapter';
import { NoopInsuranceGatewayAdapter } from './insurance/noop.adapter';
import { SameTenantPatientIdentityAdapter } from './patient-identity/same-tenant.adapter';

/**
 * Đăng ký DI cho 5 port còn lại của S1-06 (Storage/EventBus/Signature/Insurance/
 * PatientIdentity) — NotificationPort đã đăng ký riêng trong `IamModule` từ S1-04c, không đụng
 * lại. Global vì chưa có module nghiệp vụ nào tiêu thụ các port này (patient/encounter/
 * prescription là việc của S2+): mọi domain module tương lai `@Inject()` thẳng token, không cần
 * import module này. Theo .claude/docs/project-structure.md: "Adapter no-op phải tồn tại và
 * được đăng ký, không để service gọi vào undefined."
 */
@Global()
@Module({
  providers: [
    { provide: STORAGE_PORT, useClass: LocalDiskStorageAdapter },
    { provide: EVENT_BUS_PORT, useClass: InMemoryEventBusAdapter },
    { provide: SIGNATURE_PORT, useClass: NoopSignatureAdapter },
    { provide: INSURANCE_GATEWAY_PORT, useClass: NoopInsuranceGatewayAdapter },
    { provide: PATIENT_IDENTITY_PORT, useClass: SameTenantPatientIdentityAdapter },
  ],
  exports: [STORAGE_PORT, EVENT_BUS_PORT, SIGNATURE_PORT, INSURANCE_GATEWAY_PORT, PATIENT_IDENTITY_PORT],
})
export class PortsModule {}
