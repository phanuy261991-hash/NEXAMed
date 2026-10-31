import { useState, type ReactNode } from 'react';
import { CheckCircle, DownloadSimple, FileXls, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import { ApiError } from '../api/client';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { ModalHeader } from './ModalHeader';
import { TabBar } from './TabBar';

type TabId = 'valid' | 'duplicates' | 'errors' | 'newCatalog';

const TH = 'px-3 py-2.5 text-left';
const TD = 'px-3 py-2 text-slate-900';

/** Giới hạn dung lượng file nhập ở máy chủ (5 MB, `multer`) — thông báo "quá lớn" nêu rõ con số để người dùng biết cách xử lý. */
const FILE_TOO_LARGE_MESSAGE = 'File quá lớn — tối đa 5 MB. Hãy chia nhỏ file (xoá bớt dòng, xoá ảnh/định dạng thừa) rồi chọn lại.';

function describeUploadError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.code === 'PAYLOAD_TOO_LARGE' ? FILE_TOO_LARGE_MESSAGE : err.message;
  return fallback;
}

/** Một dòng lỗi từ máy chủ — luôn có sheet, số dòng và lý do (đã nêu tên cột + cách sửa). */
export interface ImportErrorRowLike {
  sheet: string;
  rowNumber: number;
  reason: string;
}

export interface ImportPreviewLike<Row, ErrorRow> {
  validRows: Row[];
  /** Đã có sẵn trong hệ thống — luôn bị bỏ qua (không ghi đè). */
  duplicateRows: Row[];
  errorRows: ErrorRow[];
  newCatalogItems: { category: string; name: string }[];
  exampleRowCount: number;
}

export interface ImportCommitLike {
  createdCount: number;
  duplicateCount: number;
  errorCount: number;
  newCatalogItemCount: number;
}

export interface ImportRowColumn<Row> {
  header: string;
  /** Lớp chỉnh độ rộng/căn lề của cột (ví dụ `w-24 text-center`); mặc định căn trái. */
  className?: string;
  render: (row: Row) => ReactNode;
}

/**
 * Hộp thoại "Nhập Excel" dùng chung cho các danh mục (Thuốc & Vật tư #210, Dịch vụ kỹ thuật #276) — cùng luồng `ImportExcelDialog` của Lịch làm việc: chọn file →
 * XEM TRƯỚC (chưa ghi gì) → tự quyết định có "Xác nhận nhập" không. Dòng lỗi/đã có sẵn luôn bị bỏ qua (không ghi đè). Kết quả hiện dạng BẢNG theo tab
 * (`.claude/docs/ui-guidelines.md` mục 12 — không xếp thẻ). Lỗi mức file (sai mẫu, không phải .xlsx, quá lớn, file rỗng) báo ngay trên hộp thoại bằng tiếng Việt;
 * lỗi từng dòng hiện ở tab "Lỗi" kèm sheet + số dòng + tên cột + cách sửa để người dùng sửa file rồi chọn lại. Mọi chữ riêng của từng danh mục truyền qua props.
 */
export function CatalogImportDialog<Row extends { rowNumber: number }, ErrorRow extends ImportErrorRowLike, Commit extends ImportCommitLike>({
  onClose,
  title,
  subtitle,
  itemNoun,
  templateHint,
  fileHint,
  exampleHint,
  emptyFileHint,
  downloadTemplate,
  previewFile,
  commit,
  rowColumns,
  errorRefHeader,
  errorRef,
  categoryLabels,
}: {
  onClose: () => void;
  title: string;
  subtitle: string;
  /** Danh từ đếm được: "mặt hàng", "dịch vụ". */
  itemNoun: string;
  templateHint: ReactNode;
  /** Dòng mô tả file hợp lệ dưới ô chọn file (số sheet, giới hạn dòng/dung lượng). */
  fileHint: string;
  /** Cách nhận ra dòng ví dụ, ví dụ "mã bắt đầu bằng VD-". */
  exampleHint: string;
  /** Gợi ý khi file không có dòng dữ liệu nào (tên sheet cần điền). */
  emptyFileHint: string;
  downloadTemplate: () => Promise<void>;
  previewFile: (file: File) => Promise<ImportPreviewLike<Row, ErrorRow>>;
  commit: { mutateAsync: (file: File) => Promise<Commit>; isPending: boolean };
  /** Cột của bảng "Hợp lệ" và "Đã có sẵn" (sau cột "Dòng"). */
  rowColumns: ImportRowColumn<Row>[];
  /** Tiêu đề + cách lấy định danh dòng lỗi ("Mã" → mã mặt hàng, "Dịch vụ" → tên dịch vụ). */
  errorRefHeader: string;
  errorRef: (row: ErrorRow) => string;
  categoryLabels: Record<string, string>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewLike<Row, ErrorRow> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Commit | null>(null);
  const [tab, setTab] = useState<TabId>('valid');
  const titleId = 'catalog-import-title';

  async function handleFileChange(input: HTMLInputElement) {
    const selected = input.files?.[0];
    // Xoá giá trị ô chọn file: sửa file xong rồi chọn lại ĐÚNG tên file cũ vẫn kích hoạt sự kiện (trình duyệt bỏ qua nếu giá trị không đổi).
    input.value = '';
    setError(null);
    setResult(null);
    setPreview(null);
    setFile(selected ?? null);
    if (!selected) return;
    setPreviewing(true);
    try {
      const data = await previewFile(selected);
      setPreview(data);
      setTab(data.errorRows.length > 0 ? 'errors' : data.validRows.length > 0 ? 'valid' : data.duplicateRows.length > 0 ? 'duplicates' : 'valid');
    } catch (err) {
      setError(describeUploadError(err, 'Không đọc được file, kiểm tra lại đúng file mẫu.'));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setError(null);
    try {
      setResult(await commit.mutateAsync(file));
    } catch (err) {
      setError(describeUploadError(err, 'Nhập thất bại, vui lòng thử lại. Chưa có dữ liệu nào được ghi.'));
    }
  }

  const validCount = preview?.validRows.length ?? 0;
  const fileIsEmpty = preview !== null && preview.validRows.length + preview.duplicateRows.length + preview.errorRows.length + preview.exampleRowCount === 0;
  const tabs: { id: TabId; label: string }[] = preview
    ? [
        { id: 'valid', label: `Hợp lệ (${preview.validRows.length})` },
        { id: 'duplicates', label: `Đã có sẵn (${preview.duplicateRows.length})` },
        { id: 'errors', label: `Lỗi (${preview.errorRows.length})` },
        { id: 'newCatalog', label: `Danh mục mới (${preview.newCatalogItems.length})` },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="shrink-0 px-6 pt-5">
          <ModalHeader icon={FileXls} title={title} subtitle={subtitle} onClose={onClose} />
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        </div>

        <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {!result && (
            <>
              <div className="flex flex-wrap items-center gap-3 border-l-4 border-l-blue-600 bg-blue-50/70 px-4 py-3">
                <p className="min-w-0 flex-1 text-[13px] text-slate-700">{templateHint}</p>
                <Button type="button" variant="secondary" onClick={() => void downloadTemplate()}>
                  <DownloadSimple size={15} weight="bold" aria-hidden="true" />
                  Tải file mẫu
                </Button>
              </div>

              <label
                className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors ${
                  file ? 'border-blue-300 bg-blue-50/50' : 'border-slate-300 hover:border-blue-300 hover:bg-slate-50'
                }`}
              >
                <input type="file" accept=".xlsx" className="hidden" onChange={(e) => void handleFileChange(e.target)} />
                {file ? <FileXls size={28} weight="fill" className="text-blue-600" /> : <UploadSimple size={26} weight="bold" className="text-slate-400" />}
                <span className="text-[13.5px] font-semibold text-slate-700">{file ? file.name : 'Bấm để chọn file .xlsx'}</span>
                {file ? <span className="text-[11.5px] text-slate-500">Sửa file xong, bấm vào đây để chọn lại — hệ thống đọc lại và báo kết quả mới.</span> : <span className="text-[11.5px] text-slate-500">{fileHint}</span>}
              </label>
            </>
          )}

          {previewing && <p className="mt-4 text-center text-[13px] text-slate-500">Đang đọc file...</p>}
          {error && <ErrorBanner message={error} />}

          {result && (
            <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-[13.5px] text-emerald-800">
              <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Đã nhập thành công <strong>{result.createdCount}</strong> {itemNoun}
                {result.newCatalogItemCount > 0 && <>, tạo mới <strong>{result.newCatalogItemCount}</strong> mục danh mục</>}. Bỏ qua {result.duplicateCount} {itemNoun} đã có sẵn, {result.errorCount} dòng lỗi.
              </span>
            </div>
          )}

          {fileIsEmpty && !result && (
            <div role="alert" className="mt-4 flex items-start gap-2.5 border-l-4 border-l-amber-500 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
              <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>File không có dòng dữ liệu nào để nhập. {emptyFileHint}</span>
            </div>
          )}

          {preview && !result && !fileIsEmpty && (
            <div className="mt-4">
              {preview.errorRows.length > 0 && (
                <p role="alert" className="mb-3 flex items-start gap-2 border-l-4 border-l-rose-500 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-800">
                  <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    Có {preview.errorRows.length} lỗi trong file. Xem tab "Lỗi" bên dưới: mỗi dòng nêu rõ số dòng, tên cột và cách sửa — sửa file rồi chọn lại, hoặc nhập riêng {validCount} {itemNoun} hợp lệ.
                  </span>
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabBar tabs={tabs} active={tab} onChange={setTab} />
                {preview.exampleRowCount > 0 && <span className="text-xs text-slate-500">Đã bỏ qua {preview.exampleRowCount} dòng ví dụ ({exampleHint})</span>}
              </div>

              <div className="scroll-hover mt-2 max-h-[38vh] overflow-y-auto rounded-md border border-slate-200">
                {tab === 'valid' && <RowTable rows={preview.validRows} columns={rowColumns} accent="border-l-emerald-500" empty={`Không có ${itemNoun} hợp lệ nào để nhập.`} />}
                {tab === 'duplicates' && <RowTable rows={preview.duplicateRows} columns={rowColumns} accent="border-l-slate-300" empty={`Không có ${itemNoun} nào đã tồn tại.`} />}
                {tab === 'errors' &&
                  (preview.errorRows.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-slate-500">Không có lỗi.</p>
                  ) : (
                    <table className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                          <th className={TH}>Sheet</th>
                          <th className={`${TH} w-16`}>Dòng</th>
                          <th className={TH}>{errorRefHeader}</th>
                          <th className={TH}>Lý do và cách sửa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.errorRows.map((r, i) => (
                          <tr key={i} className="border-b border-slate-200 last:border-0">
                            <td className={`${TD} whitespace-nowrap border-l-4 border-l-rose-500`}>{r.sheet}</td>
                            <td className={TD}>{r.rowNumber}</td>
                            <td className={`${TD} font-semibold`}>{errorRef(r)}</td>
                            <td className={`${TD} text-rose-700`}>{r.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
                {tab === 'newCatalog' &&
                  (preview.newCatalogItems.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-slate-500">Mọi tên trong file đều đã có trong danh mục.</p>
                  ) : (
                    <>
                      <p className="border-b border-slate-200 bg-amber-50 px-4 py-2 text-[12.5px] font-semibold text-amber-800">
                        Các mục dưới đây chưa có trong danh mục dùng chung — sẽ được TẠO MỚI khi bạn xác nhận nhập.
                      </p>
                      <table className="w-full border-collapse text-sm">
                        <thead className="sticky top-0 z-10">
                          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                            <th className={TH}>Danh mục</th>
                            <th className={TH}>Tên sẽ tạo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.newCatalogItems.map((c, i) => (
                            <tr key={i} className="border-b border-slate-200 last:border-0">
                              <td className={`${TD} border-l-4 border-l-amber-500`}>{categoryLabels[c.category] ?? c.category}</td>
                              <td className={`${TD} font-semibold`}>{c.name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          {preview && !result && preview.errorRows.length > 0 && (
            <span className="mr-auto text-[12.5px] font-semibold text-rose-700">{preview.errorRows.length} lỗi sẽ bị bỏ qua — sửa file và chọn lại nếu muốn nhập đủ.</span>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            {result ? 'Đóng' : 'Huỷ'}
          </Button>
          {!result && (
            <Button type="button" loading={commit.isPending} disabled={validCount === 0 || previewing} onClick={() => void handleConfirm()}>
              Xác nhận nhập{validCount > 0 ? ` (${validCount} ${itemNoun})` : ''}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function RowTable<Row extends { rowNumber: number }>({ rows, columns, accent, empty }: { rows: Row[]; columns: ImportRowColumn<Row>[]; accent: string; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 z-10">
        <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
          <th className={`${TH} w-16`}>Dòng</th>
          {columns.map((c) => (
            <th key={c.header} className={`px-3 py-2.5 ${c.className ?? 'text-left'}`}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.rowNumber} className="border-b border-slate-200 last:border-0">
            <td className={`${TD} border-l-4 ${accent}`}>{r.rowNumber}</td>
            {columns.map((c) => (
              <td key={c.header} className={`${TD} ${c.className?.includes('text-center') ? 'text-center' : ''}`}>
                {c.render(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
