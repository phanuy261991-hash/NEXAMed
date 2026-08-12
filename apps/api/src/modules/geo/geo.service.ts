import { Injectable } from '@nestjs/common';
import type { ListProvincesResponse, ListWardsResponse } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { GeoRepository } from './geo.repository';

/**
 * Danh mục hành chính Tỉnh/Phường-Xã toàn hệ thống (docs/DECISIONS.md #038) — read-only, không
 * `tenant_id`. Không có thao tác ghi nào (không audit) — khác `reference_catalog`.
 */
@Injectable()
export class GeoService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly geoRepository: GeoRepository,
  ) {}

  async listProvinces(tenantId: string): Promise<ListProvincesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.geoRepository.listProvinces(tx);
      return { items: rows.map((r) => ({ code: r.code, name: r.name, sortOrder: r.sortOrder })) };
    });
  }

  async listWards(tenantId: string, provinceCode: string | undefined): Promise<ListWardsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.geoRepository.listWards(tx, provinceCode);
      return {
        items: rows.map((r) => ({ code: r.code, name: r.name, provinceCode: r.provinceCode, sortOrder: r.sortOrder })),
      };
    });
  }
}
