import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { GeoRepository } from './geo.repository';

/** Danh mục hành chính Tỉnh/Phường-Xã toàn hệ thống, read-only — docs/DECISIONS.md #038. */
@Module({
  controllers: [GeoController],
  providers: [GeoService, GeoRepository],
})
export class GeoModule {}
