import { Module } from '@nestjs/common';
import { PrintTemplateController } from './print-template.controller';
import { PrintTemplateService } from './print-template.service';
import { PrintTemplateRepository } from './print-template.repository';

/** "Quản lý mẫu in" (docs/DECISIONS.md #211) — module riêng, không phụ thuộc module nghiệp vụ nào. */
@Module({
  controllers: [PrintTemplateController],
  providers: [PrintTemplateService, PrintTemplateRepository],
  exports: [PrintTemplateService],
})
export class PrintTemplateModule {}
