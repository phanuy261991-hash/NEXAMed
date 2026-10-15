import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemVersionService } from './system-version.service';

@Module({
  controllers: [SystemController],
  providers: [SystemVersionService],
  exports: [SystemVersionService],
})
export class SystemModule {}
