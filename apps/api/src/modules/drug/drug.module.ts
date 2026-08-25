import { Module } from '@nestjs/common';
import { DrugController } from './drug.controller';
import { DrugService } from './drug.service';
import { DrugRepository } from './drug.repository';

/** `exports: [DrugRepository]` — `EncounterModule` (prescription) đọc tên/hoạt chất thuốc trong cùng transaction lúc lưu/ký đơn. */
@Module({
  controllers: [DrugController],
  providers: [DrugService, DrugRepository],
  exports: [DrugRepository],
})
export class DrugModule {}
