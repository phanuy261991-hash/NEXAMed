import { forwardRef, Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { DrugController } from './drug.controller';
import { DrugImportController } from './drug-import.controller';
import { DrugImportService } from './drug-import.service';
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
import { PrescriptionTemplateController } from './prescription-template.controller';
import { PrescriptionTemplateService } from './prescription-template.service';
import { PrescriptionTemplateRepository } from './prescription-template.repository';

/**
 * Danh mục Thuốc & Vật tư y tế — Drug (Sprint 4, S4-03) + Nhà cung cấp/Kho (Giai đoạn 1 của Kho
 * Thuốc & Vật tư y tế, docs/DECISIONS.md #146), gộp 1 module vì cùng 1 trang web ("Danh mục Thuốc
 * & Vật tư", 3 pill). `exports: [DrugRepository]` — `EncounterModule` (prescription) đọc tên/hoạt
 * chất thuốc trong cùng transaction lúc lưu/ký đơn. `exports: [WarehouseRepository,
 * SupplierRepository]` — Kho Thuốc GĐ2 (`InventoryModule`) kiểm tồn tại kho/nhà cung cấp trong
 * cùng transaction lúc tạo/duyệt phiếu nhập kho, đúng tiền lệ "chia sẻ Repository giữa module", #042.
 *
 * `imports: [forwardRef(() => InventoryModule)]` (21/09/2026, guard chặn đổi `isBatchManaged` khi
 * còn tồn) — `DrugService.update()` đọc `StockBalanceRepository` để kiểm tồn trước khi cho đổi cờ.
 * Vòng phụ thuộc 2 chiều CÓ THẬT (`InventoryModule` đã import `DrugModule` từ GĐ2) — `forwardRef`
 * bắt buộc ở CẢ HAI phía, đúng tiền lệ `CashierShiftModule ↔ BillingModule`/`↔ CashBookModule`.
 *
 * `PrescriptionTemplateController/Service/Repository` (Kho Thuốc GĐ5, PRD INV-05) — "Đơn thuốc
 * mẫu", CÙNG module (không tách riêng, đúng chỗ vì `.claude/docs/architecture.md` ghi rõ GĐ5 mở
 * rộng module `drug`). Dùng chung `DrugRepository` sẵn có trong module để validate `drugId` tồn
 * tại, không cần thêm `imports` nào.
 *
 * `DrugImportController/Service` (#210) — Nhập/Xuất Excel Thuốc & Vật tư. `imports: [ReferenceCatalogModule]`
 * (một chiều, không vòng) để tra tên → mã danh mục hàng loạt + tạo mục mới trong cùng transaction. Controller
 * khai báo TRƯỚC `DrugController` (route tĩnh `drugs/export`/`drugs/import-template` phải khớp trước `drugs/:id`).
 */
@Module({
  imports: [forwardRef(() => InventoryModule), ReferenceCatalogModule],
  controllers: [DrugImportController, DrugController, SupplierController, WarehouseController, PrescriptionTemplateController],
  providers: [
    DrugService,
    DrugImportService,
    DrugRepository,
    DrugIngredientRepository,
    DrugUnitRepository,
    SupplierService,
    SupplierRepository,
    WarehouseService,
    WarehouseRepository,
    PrescriptionTemplateService,
    PrescriptionTemplateRepository,
  ],
  exports: [DrugRepository, WarehouseRepository, SupplierRepository],
})
export class DrugModule {}
