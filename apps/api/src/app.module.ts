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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}