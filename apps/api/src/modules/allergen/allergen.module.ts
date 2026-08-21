import { Module } from '@nestjs/common';
import { AllergenGroupController } from './allergen-group.controller';
import { AllergenGroupService } from './allergen-group.service';
import { AllergenGroupRepository } from './allergen-group.repository';
import { AllergenController } from './allergen.controller';
import { AllergenService } from './allergen.service';
import { AllergenRepository } from './allergen.repository';

/** Danh mục "Dị nguyên" (docs/DECISIONS.md #069) — .claude/docs/architecture.md. Chưa module nào khác cần đọc nên không export port. */
@Module({
  controllers: [AllergenGroupController, AllergenController],
  providers: [AllergenGroupService, AllergenGroupRepository, AllergenService, AllergenRepository],
})
export class AllergenModule {}
