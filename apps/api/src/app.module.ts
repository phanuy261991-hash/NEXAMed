import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './config/config.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { PortsModule } from './infrastructure/ports.module';
import { StorageHttpModule } from './infrastructure/storage/storage-http.module';
import { CommonModule } from './common/common.module';
import { IamModule } from './modules/iam/iam.module';
import { PatientModule } from './modules/patient/patient.module';
import { PatientMergeModule } from './modules/patient/patient-merge.module';
import { AppointmentModule } from './modules/appointment/appointment.module';
import { ClinicModule } from './modules/clinic/clinic.module';
import { ReferenceCatalogModule } from './modules/reference-catalog/reference-catalog.module';
import { GeoModule } from './modules/geo/geo.module';
import { Icd10Module } from './modules/icd10/icd10.module';
import { EncounterModule } from './modules/encounter/encounter.module';
import { ReceptionModule } from './modules/reception/reception.module';
import { AllergenModule } from './modules/allergen/allergen.module';
import { DrugModule } from './modules/drug/drug.module';
import { BillingModule } from './modules/billing/billing.module';
import { AuditModule } from './modules/audit/audit.module';
import { DoctorAvailabilityModule } from './modules/doctor-availability/doctor-availability.module';
import { WorkShiftAssignmentModule } from './modules/work-shift-assignment/work-shift-assignment.module';
import { HealthModule } from './modules/health/health.module';
import { TenantContextMiddleware } from './common/tenant-context.middleware';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    PersistenceModule,
    PortsModule,
    StorageHttpModule,
    CommonModule,
    IamModule,
    PatientModule,
    PatientMergeModule,
    AppointmentModule,
    ClinicModule,
    ReferenceCatalogModule,
    GeoModule,
    Icd10Module,
    AllergenModule,
    DrugModule,
    EncounterModule,
    BillingModule,
    ReceptionModule,
    AuditModule,
    DoctorAvailabilityModule,
    WorkShiftAssignmentModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}