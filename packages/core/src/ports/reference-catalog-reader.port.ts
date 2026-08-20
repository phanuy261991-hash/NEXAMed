/**
 * Đọc một mục `reference_catalog` theo (category, code) — dùng khi một module KHÁC module sở hữu
 * `reference_catalog` cần đọc dữ liệu của nó (ví dụ `iam` cần biết `deactivatesAccount` của
 * `EMPLOYMENT_STATUS` để tự động vô hiệu hoá tài khoản khi nhân viên nghỉ việc, mở rộng ADM-01).
 * Không import thẳng `ReferenceCatalogRepository` — .claude/docs/coding-standards.md mục "Ranh
 * giới module" (module không import trực tiếp module khác), cùng mẫu `DoctorDirectoryPort`
 * (S2-09). Adapter thật đọc thẳng `reference_catalog` (bảng toàn hệ thống, không `tenant_id`).
 */
export interface ReferenceCatalogReaderPort {
  /**
   * `tenantId` chỉ dùng để mở transaction đúng khuôn `UnitOfWorkService.runInTenantScope` (như
   * mọi service khác) — `reference_catalog` là bảng toàn hệ thống, không lọc theo tenant.
   */
  findActiveByCode(
    tenantId: string,
    category: string,
    code: string,
  ): Promise<{ code: string; name: string; deactivatesAccount: boolean } | null>;
}

export const REFERENCE_CATALOG_READER_PORT = Symbol('REFERENCE_CATALOG_READER_PORT');
