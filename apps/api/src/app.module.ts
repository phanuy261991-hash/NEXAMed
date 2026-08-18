import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { PortsModule } from './infrastructure/ports.module';
import { StorageHttpModule } from './infrastructure/storage/storage-http.module';
import { CommonModule } from './common/common.module';
import { IamModule } from './modules/iam/iam.module';
import { PatientModule } from './modules/patient/patient.module';
import { AppointmentModule } from './modules/appointment/appointment.module';
import { ClinicModule } from './modules/clinic/clinic.module';
import { ReferenceCatalogModule } from './modules/reference-catalog/reference-catalog.module';
import { GeoModule } from './modules/geo/geo.module';
import { Icd10Module } from './modules/icd10/icd10.module';
import { EncounterModule } from './modules/encounter/encounter.module';
import { ReceptionModule } from './modules/reception/reception.module';
import { TenantContextMiddleware } from './common/tenant-context.middleware';

@Module({
  imports: [
    ConfigModule,
    PersistenceModule,
    PortsModule,
    StorageHttpModule,
    CommonModule,
    IamModule,
    PatientModule,
    AppointmentModule,
    ClinicModule,
    ReferenceCatalogModule,
    GeoModule,
    Icd10Module,
    EncounterModule,
    ReceptionModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}