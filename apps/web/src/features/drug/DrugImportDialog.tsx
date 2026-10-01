import { useState } from 'react';
import { CheckCircle, DownloadSimple, FileXls, UploadSimple } from '@phosphor-icons/react';
import type { DrugImportCommitResponse, DrugImportPreviewResponse } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { TabBar } from '../../shared/ui/TabBar';
import { downloadDrugImportTemplate, previewDrugImport } from './drug.api';
import { useCommitDrugImportMutation } from './drug.queries';

type TabId = 'valid' | 'duplicates' | 'errors' | 'newCatalog';

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

const TH = 'px-3 py-2.5 text-left';
const TD = 'px-3 py-2 text-slate-900';

/**
 * Nhập Excel "Thuốc & Vật tư" (docs/DECISIONS.md #210) — cùng luồng `ImportExcelDialog` của Lịch làm việc: chọn file →
 * XEM TRƯỚC (chưa ghi gì) → tự quyết định có "Xác nhận nhập" không. Dòng lỗi/đã có sẵn luôn bị bỏ qua (không ghi
 * đè). 4 nhóm kết quả hiện dạng BẢNG theo tab (`.claude/docs/ui-guidelines.md` mục 12 — không xếp thẻ).
 */
export function DrugImportDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DrugImportPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DrugImportCommitResponse | null>(null);
  const [tab, setTab] = useState<TabId>('valid');
  const commitMutation = useCommitDrugImportMutation();

  async function handleFileChange(selected: File | undefined) {
    setError(null);
    setResult(null);
    setPreview(null);
    setFile(selected ?? null);
    if (!selected) return;
    setPreviewing(true);
    try {
      const data = await previewDrugImport(selected);
      setPreview(data);
      setTab(data.errorRows.length > 0 ? 'errors' : data.validRows.length > 0 ? 'valid' : data.duplicateRows.length > 0 ? 'duplicates' : 'valid');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không đọc được file, kiểm tra lại đúng file mẫu.');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setError(null);
    try {
      setResult(await commitMutation.mutateAsync(file));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nhập thất bại, vui lòng thử lại. Chưa có dữ liệu nào được ghi.');
    }
  }

  const validCount = preview?.validRows.length ?? 0;
  const tabs: { id: TabId; label: string }[] = preview
    ? [
        { id: 'valid', label: `Hợp lệ (${preview.validRows.length})` },
        { id: 'duplicates', label: `Đã có sẵn (${preview.duplicateRows.length})` },
        { id: 'errors', label: `Lỗi (${preview.errorRows.length})` },
        { id: 'newCatalog', label: `Danh mục mới (${preview.newCatalogItems.length})` },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby="drug-import-title">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex-shrink-0 px-6 pt-5">
          <ModalHeader icon={FileXls} title="Nhập Thuốc & Vật tư từ Excel" subtitle="Chỉ nhập danh mục mặt hàng, không nhập tồn kho" onClose={onClose} />
          <h2 id="drug-import-title" className="sr-only">
            Nhập Thuốc & Vật tư từ Excel
          </h2>
        </div>

        <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {!result && (
            <>
              <div className="flex flex-wrap items-center gap-3 border-l-4 border-l-blue-600 bg-blue-50/70 px-4 py-3">
                <p className="min-w-0 flex-1 text-[13px] text-slate-700">
                  Chưa có file? Tải <strong>file mẫu</strong> — có sẵn dữ liệu ví dụ và hướng dẫn điền từng cột. Mã đã có trong hệ thống được <strong>bỏ qua</strong>, không ghi đè.
                </p>
                <Button type="button" variant="secondary" onClick={() => void downloadDrugImportTemplate()}>
                  <DownloadSimple size={15} weight="bold" aria-hidden="true" />
                  Tải file mẫu
                </Button>
              </div>

              <label
                className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors ${
                  file ? 'border-blue-300 bg-blue-50/50' : 'border-slate-300 hover:border-blue-300 hover:bg-slate-50'
                }`}
              >
                <input type="file" accept=".xlsx" className="hidden" onChange={(e) => void handleFileChange(e.target.files?.[0])} />
                {file ? <FileXls size={28} weight="fill" className="text-blue-600" /> : <UploadSimple size={26} weight="bold" className="text-slate-400" />}
                <span className="text-[13.5px] font-semibold text-slate-700">{file ? file.name : 'Bấm để chọn file .xlsx'}</span>
                {!file && <span className="text-[11.5px] text-slate-500">3 sheet: Thuốc & Vật tư · Hoạt chất · Quy đổi đơn vị — tối đa 2.000 mặt hàng, 5 MB</span>}
              </label>
            </>
          )}

          {previewing && <p className="mt-4 text-center text-[13px] text-slate-500">Đang đọc file...</p>}
          {error && <ErrorBanner message={error} />}

          {result && (
            <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-[13.5px] text-emerald-800">
              <CheckCircle size={20} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                Đã nhập thành công <strong>{result.createdCount}</strong> mặt hàng
                {result.newCatalogItemCount > 0 && <>, tạo mới <strong>{result.newCatalogItemCount}</strong> mục danh mục</>}. Bỏ qua {result.duplicateCount} mặt hàng đã có sẵn, {result.errorCount} dòng lỗi.
              </span>
            </div>
          )}

          {preview && !result && (
            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabBar tabs={tabs} active={tab} onChange={setTab} />
                {preview.exampleRowCount > 0 && <span className="text-xs text-slate-500">Đã bỏ qua {preview.exampleRowCount} dòng ví dụ (mã bắt đầu bằng VD-)</span>}
              </div>

              <div className="mt-2 max-h-[38vh] overflow-y-auto rounded-md border border-slate-200 scroll-hover">
                {tab === 'valid' && <ItemTable rows={preview.validRows} accent="border-l-emerald-500" empty="Không có mặt hàng hợp lệ nào để nhập." />}
                {tab === 'duplicates' && <ItemTable rows={preview.duplicateRows} accent="border-l-slate-300" empty="Không có mặt hàng nào đã tồn tại." />}
                {tab === 'errors' &&
                  (preview.errorRows.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-slate-500">Không có lỗi.</p>
                  ) : (
                    <table className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                          <th className={TH}>Sheet</th>
                          <th className={`${TH} w-16`}>Dòng</th>
                          <th className={TH}>Mã</th>
                          <th className={TH}>Lý do</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.errorRows.map((r, i) => (
                          <tr key={i} className="border-b border-slate-200 last:border-0">
                            <td className={`${TD} border-l-4 border-l-rose-500 whitespace-nowrap`}>{r.sheet}</td>
                            <td className={TD}>{r.rowNumber}</td>
                            <td className={`${TD} font-semibold`}>{r.code}</td>
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
                          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                            <th className={TH}>Danh mục</th>
                            <th className={TH}>Tên sẽ tạo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.newCatalogItems.map((c, i) => (
                            <tr key={i} className="border-b border-slate-200 last:border-0">
                              <td className={`${TD} border-l-4 border-l-amber-500`}>{CATEGORY_LABEL[c.category] ?? c.category}</td>
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

        <div className="flex flex-shrink-0 items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          {preview && !result && preview.errorRows.length > 0 && (
            <span className="mr-auto text-[12.5px] font-semibold text-rose-700">{preview.errorRows.length} lỗi sẽ bị bỏ qua — sửa file và chọn lại nếu muốn nhập đủ.</span>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            {result ? 'Đóng' : 'Huỷ'}
          </Button>
          {!result && (
            <Button type="button" loading={commitMutation.isPending} disabled={validCount === 0 || previewing} onClick={() => void handleConfirm()}>
              Xác nhận nhập{validCount > 0 ? ` (${validCount} mặt hàng)` : ''}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemTable({ rows, accent, empty }: { rows: DrugImportPreviewResponse['validRows']; accent: string; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 z-10">
        <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
          <th className={`${TH} w-16`}>Dòng</th>
          <th className={TH}>Mã</th>
          <th className={TH}>Tên</th>
          <th className={`${TH} w-24`}>Loại</th>
          <th className="w-24 px-3 py-2.5 text-center">Hoạt chất</th>
          <th className="w-24 px-3 py-2.5 text-center">Quy đổi</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.rowNumber}-${r.code}`} className="border-b border-slate-200 last:border-0">
            <td className={`${TD} border-l-4 ${accent}`}>{r.rowNumber}</td>
            <td className={`${TD} font-semibold`}>{r.code}</td>
            <td className={TD}>{r.name}</td>
            <td className={TD}>{r.itemType === 'MEDICINE' ? 'Thuốc' : 'Vật tư'}</td>
            <td className={`${TD} text-center`}>{r.ingredientCount}</td>
            <td className={`${TD} text-center`}>{r.unitCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
