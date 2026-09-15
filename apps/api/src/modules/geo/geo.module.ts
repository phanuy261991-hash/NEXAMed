import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { GeoRepository } from './geo.repository';

/** Danh mục hành chính Tỉnh/Phường-Xã toàn hệ thống, read-only — docs/DECISIONS.md #038.
 * `exports: [GeoRepository]` (S6-06, ADM-05) — "Xuất bệnh án PDF" ở `EncounterModule` cần tra
 * tên Tỉnh/Phường-Xã theo mã để in địa chỉ đầy đủ, đúng tiền lệ chia sẻ Repository giữa module
 * (#042). */
@Module({
  controllers: [GeoController],
  providers: [GeoService, GeoRepository],
  exports: [GeoRepository],
})
export class GeoModule {}
