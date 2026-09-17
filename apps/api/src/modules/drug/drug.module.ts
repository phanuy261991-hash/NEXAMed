import { Module } from '@nestjs/common';
import { DrugController } from './drug.controller';
import { DrugService } from './drug.service';
import { DrugRepository } from './drug.repository';
import { DrugIngredientRepository } from './drug-ingredient.repository';
import { DrugUnitRepository } from './drug-unit.repository';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { SupplierRepository } from './supplier.repository';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { WarehouseRepository } from './warehouse.repository';

/**
 * Danh mục Thuốc & Vật tư y tế — Drug (Sprint 4, S4-03) + Nhà cung cấp/Kho (Giai đoạn 1 của Kho
 * Thuốc & Vật tư y tế, docs/DECISIONS.md #146), gộp 1 module vì cùng 1 trang web ("Danh mục Thuốc
 * & Vật tư", 3 pill). `exports: [DrugRepository]` — `EncounterModule` (prescription) đọc tên/hoạt
 * chất thuốc trong cùng transaction lúc lưu/ký đơn. `exports: [WarehouseRepository,
 * SupplierRepository]` — Kho Thuốc GĐ2 (`InventoryModule`) kiểm tồn tại kho/nhà cung cấp trong
 * cùng transaction lúc tạo/duyệt phiếu nhập kho, đúng tiền lệ "chia sẻ Repository giữa module", #042.
 */
@Module({
  controllers: [DrugController, SupplierController, WarehouseController],
  providers: [DrugService, DrugRepository, DrugIngredientRepository, DrugUnitRepository, SupplierService, SupplierRepository, WarehouseService, WarehouseRepository],
  exports: [DrugRepository, WarehouseRepository, SupplierRepository],
})
export class DrugModule {}
