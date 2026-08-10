import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { PortsModule } from './infrastructure/ports.module';
import { CommonModule } from './common/common.module';
import { IamModule } from './modules/iam/iam.module';
import { TenantContextMiddleware } from './common/tenant-context.middleware';

@Module({
  imports: [ConfigModule, PersistenceModule, PortsModule, CommonModule, IamModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}