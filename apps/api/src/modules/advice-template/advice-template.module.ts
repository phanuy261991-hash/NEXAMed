import { Module } from '@nestjs/common';
import { AdviceTemplateController } from './advice-template.controller';
import { AdviceTemplateRepository } from './advice-template.repository';
import { AdviceTemplateService } from './advice-template.service';

/** "Mẫu lời dặn" (docs/DECISIONS.md #222) — module riêng, không phụ thuộc module nghiệp vụ nào khác. */
@Module({
  controllers: [AdviceTemplateController],
  providers: [AdviceTemplateService, AdviceTemplateRepository],
})
export class AdviceTemplateModule {}
