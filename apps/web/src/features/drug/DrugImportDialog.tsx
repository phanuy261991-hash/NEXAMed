import type { DrugImportCommitResponse, DrugImportPreviewResponse } from '@nexamed/shared';
import { CatalogImportDialog, type ImportRowColumn } from '../../shared/ui/CatalogImportDialog';
import { downloadDrugImportTemplate, previewDrugImport } from './drug.api';
import { useCommitDrugImportMutation } from './drug.queries';

const CATEGORY_LABEL: Record<string, string> = {
  UNIT: 'Đơn vị tính',
  MANUFACTURER: 'Hãng sản xuất',
  DRUG_GROUP: 'Nhóm thuốc',
  DRUG_ROUTE: 'Đường dùng',
  DOSAGE_FORM: 'Dạng bào chế',
  COUNTRY_OF_ORIGIN: 'Nước sản xuất',
  STORAGE_CONDITION: 'Điều kiện bảo quản',
  STORAGE_LOCATION: 'Vị trí bảo quản',
  ACTIVE_INGREDIENT: 'Hoạt chất',
};

type DrugRow = DrugImportPreviewResponse['validRows'][number];

const ROW_COLUMNS: ImportRowColumn<DrugRow>[] = [
  { header: 'Mã', render: (r) => <span className="font-semibold">{r.code}</span> },
  { header: 'Tên', render: (r) => r.name },
  { header: 'Loại', className: 'w-24 text-left', render: (r) => (r.itemType === 'MEDICINE' ? 'Thuốc' : 'Vật tư') },
  { header: 'Hoạt chất', className: 'w-24 text-center', render: (r) => r.ingredientCount },
  { header: 'Quy đổi', className: 'w-24 text-center', render: (r) => r.unitCount },
];

/** Nhập Excel "Thuốc & Vật tư" (docs/DECISIONS.md #210) — hộp thoại dùng chung `CatalogImportDialog`, chỉ khai báo chữ và cột riêng của thuốc/vật tư. */
export function DrugImportDialog({ onClose }: { onClose: () => void }) {
  const commit = useCommitDrugImportMutation();
  return (
    <CatalogImportDialog<DrugRow, DrugImportPreviewResponse['errorRows'][number], DrugImportCommitResponse>
      onClose={onClose}
      title="Nhập Thuốc & Vật tư từ Excel"
      subtitle="Chỉ nhập danh mục mặt hàng, không nhập tồn kho"
      itemNoun="mặt hàng"
      templateHint={
        <>
          Chưa có file? Tải <strong>file mẫu</strong> — có sẵn dữ liệu ví dụ và hướng dẫn điền từng cột. Mã đã có trong hệ thống được <strong>bỏ qua</strong>, không ghi đè.
        </>
      }
      fileHint="3 sheet: Thuốc & Vật tư · Hoạt chất · Quy đổi đơn vị — tối đa 2.000 mặt hàng, 5 MB"
      exampleHint="mã bắt đầu bằng VD-"
      emptyFileHint='Kiểm tra đã điền vào sheet "Thuốc & Vật tư" (xoá dòng ví dụ rồi nhập mặt hàng thật) và lưu file trước khi chọn lại.'
      downloadTemplate={downloadDrugImportTemplate}
      previewFile={previewDrugImport}
      commit={commit}
      rowColumns={ROW_COLUMNS}
      errorRefHeader="Mã"
      errorRef={(r) => r.code}
      categoryLabels={CATEGORY_LABEL}
    />
  );
}
