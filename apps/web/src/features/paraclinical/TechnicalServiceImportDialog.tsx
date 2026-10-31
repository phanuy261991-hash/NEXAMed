import type { TechnicalServiceImportCommitResponse, TechnicalServiceImportPreviewResponse } from '@nexamed/shared';
import { CatalogImportDialog, type ImportRowColumn } from '../../shared/ui/CatalogImportDialog';
import { formatVnd } from '../../shared/format/currency';
import { TECHNICAL_SERVICE_KIND_LABELS } from './paraclinical-labels';
import { downloadTechnicalServiceImportTemplate, previewTechnicalServiceImport } from './paraclinical.api';
import { useCommitTechnicalServiceImportMutation } from './paraclinical.queries';

const CATEGORY_LABEL: Record<string, string> = {
  TECH_SERVICE_CATEGORY: 'Nhóm dịch vụ',
  SPECIMEN_TYPE: 'Loại mẫu',
  UNIT: 'Đơn vị tính',
};

type ServiceRow = TechnicalServiceImportPreviewResponse['validRows'][number];

const ROW_COLUMNS: ImportRowColumn<ServiceRow>[] = [
  { header: 'Tên dịch vụ', render: (r) => <span className="font-semibold">{r.name}</span> },
  { header: 'Loại', className: 'w-44 text-left', render: (r) => TECHNICAL_SERVICE_KIND_LABELS[r.serviceKind] },
  { header: 'Giá bán', className: 'w-32 text-right', render: (r) => (r.price === null ? 'Chỉ định ra ngoài' : formatVnd(r.price)) },
];

/** Nhập Excel "Dịch vụ kỹ thuật" (docs/DECISIONS.md #276) — hộp thoại dùng chung `CatalogImportDialog`, chỉ khai báo chữ và cột riêng của dịch vụ kỹ thuật. */
export function TechnicalServiceImportDialog({ onClose }: { onClose: () => void }) {
  const commit = useCommitTechnicalServiceImportMutation();
  return (
    <CatalogImportDialog<ServiceRow, TechnicalServiceImportPreviewResponse['errorRows'][number], TechnicalServiceImportCommitResponse>
      onClose={onClose}
      title="Nhập Dịch vụ kỹ thuật từ Excel"
      subtitle="Nhập dịch vụ và đơn giá gốc; chỉ số xét nghiệm tạo riêng ở màn Chỉ số"
      itemNoun="dịch vụ"
      templateHint={
        <>
          Chưa có file? Tải <strong>file mẫu</strong> — có sẵn dữ liệu ví dụ và hướng dẫn điền từng cột. Dịch vụ cùng <strong>Loại + Tên</strong> đã có trong hệ thống được{' '}
          <strong>bỏ qua</strong>, không ghi đè; mã dịch vụ do hệ thống tự cấp.
        </>
      }
      fileHint="1 sheet: Dịch vụ kỹ thuật — tối đa 2.000 dịch vụ, 5 MB"
      exampleHint="tên bắt đầu bằng VD-"
      emptyFileHint='Kiểm tra đã điền vào sheet "Dịch vụ kỹ thuật" (xoá dòng ví dụ rồi nhập dịch vụ thật) và lưu file trước khi chọn lại.'
      downloadTemplate={downloadTechnicalServiceImportTemplate}
      previewFile={previewTechnicalServiceImport}
      commit={commit}
      rowColumns={ROW_COLUMNS}
      errorRefHeader="Dịch vụ"
      errorRef={(r) => r.name}
      categoryLabels={CATEGORY_LABEL}
    />
  );
}
