import { useState } from 'react';
import { DownloadSimple, FileXls, UploadSimple } from '@phosphor-icons/react';
import type { PriceListImportPreviewResponse, PriceListImportRow } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { PRICE_LIST_ITEM_KIND_LABELS } from './pricing-labels';
import { downloadPriceListImportTemplate, previewPriceListImport } from './pricing.api';

/**
 * Nhập Excel vào bảng giá (docs/DECISIONS.md #212, yêu cầu chủ dự án 07/10/2026) — cùng luồng `DrugImportDialog`: chọn file → xem trước (hợp lệ / lỗi từng dòng) →
 * "Thêm vào bảng giá". Chưa ghi gì vào DB: dòng hợp lệ chỉ được GỘP vào danh sách đang soạn (file thắng dòng đã có của cùng mặt hàng), người dùng vẫn bấm "Lưu bảng giá".
 */
export function PriceListImportDialog({ onApply, onClose }: { onApply: (rows: PriceListImportRow[]) => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PriceListImportPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(selected: File | undefined) {
    if (!selected) return;
    setFile(selected);
    setPreview(null);
    setError(null);
    setPreviewing(true);
    try {
      setPreview(await previewPriceListImport(selected));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không đọc được file. Thử lại sau.');
    } finally {
      setPreviewing(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!preview || preview.rows.length === 0) return;
    onApply(preview.rows);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby="pl-import-title">
      <form onSubmit={handleSubmit} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex-shrink-0 px-6 pt-5">
          <ModalHeader icon={FileXls} title="Nhập mặt hàng từ Excel" subtitle="Thêm số lượng lớn mặt hàng vào bảng giá" onClose={onClose} />
          <h2 id="pl-import-title" className="sr-only">
            Nhập mặt hàng vào bảng giá từ Excel
          </h2>
        </div>

        <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          <div className="flex flex-wrap items-center gap-3 border-l-4 border-l-blue-600 bg-blue-50/70 px-4 py-3">
            <p className="min-w-0 flex-1 text-[13px] text-slate-700">
              Chưa có file? Tải <strong>file mẫu</strong> — có dòng ví dụ, hướng dẫn từng cột và danh mục mã hiện có. Mặt hàng đã có trong bảng sẽ được <strong>thay bằng dòng trong file</strong>.
            </p>
            <Button type="button" variant="secondary" onClick={() => void downloadPriceListImportTemplate()}>
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
            {!file && <span className="text-[11.5px] text-slate-500">Cột: Loại mặt hàng · Mã · Loại giá / Đơn vị · Cách tính · Giá trị — tối đa 5.000 dòng, 5 MB</span>}
          </label>

          {previewing && <p className="mt-4 text-center text-[13px] text-slate-500">Đang đọc file...</p>}
          {error && (
            <div className="mt-4">
              <ErrorBanner message={error} />
            </div>
          )}

          {preview && (
            <div className="mt-4 flex flex-col gap-4">
              <p className="text-sm font-semibold text-slate-800">
                <span className="text-emerald-700">{preview.rows.length} dòng hợp lệ</span>
                {preview.errors.length > 0 && <span className="ml-3 text-rose-700">{preview.errors.length} dòng lỗi (sẽ bị bỏ qua)</span>}
                {preview.exampleRowCount > 0 && <span className="ml-3 font-medium text-slate-500">{preview.exampleRowCount} dòng ví dụ đã bỏ qua</span>}
              </p>

              {preview.errors.length > 0 && (
                <section aria-label="Dòng lỗi" className="overflow-hidden rounded-md border border-rose-200">
                  <h3 className="border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-rose-800">Dòng lỗi</h3>
                  <ul className="max-h-40 overflow-y-auto divide-y divide-rose-100 text-[13px]">
                    {preview.errors.map((e) => (
                      <li key={`${e.rowNumber}-${e.message}`} className="flex gap-3 px-3 py-1.5">
                        <span className="w-14 flex-none font-semibold text-slate-700">Dòng {e.rowNumber}</span>
                        <span className="text-rose-700">{e.message}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {preview.rows.length > 0 && (
                <section aria-label="Dòng hợp lệ" className="overflow-hidden rounded-md border border-slate-200">
                  <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">Dòng hợp lệ</h3>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-white text-xs font-bold uppercase tracking-wide text-slate-600">
                        <tr className="border-b border-slate-200">
                          <th className="px-3 py-1.5 text-left">Loại</th>
                          <th className="px-3 py-1.5 text-left">Mã</th>
                          <th className="px-3 py-1.5 text-left">Tên mặt hàng</th>
                          <th className="px-3 py-1.5 text-right">Cách tính</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preview.rows.map((r) => (
                          <tr key={r.rowNumber}>
                            <td className="px-3 py-1.5 text-slate-600">{PRICE_LIST_ITEM_KIND_LABELS[r.item.itemKind]}</td>
                            <td className="px-3 py-1.5 font-semibold text-slate-800">{r.item.code}</td>
                            <td className="px-3 py-1.5 text-slate-900">{r.item.name}</td>
                            <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{r.mode === 'PERCENT_OFF' ? `Giảm ${r.value}%` : `Giá mới ${formatVnd(r.value)}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-2.5 border-t border-slate-200 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" disabled={!preview || preview.rows.length === 0}>
            {preview && preview.rows.length > 0 ? `Thêm ${preview.rows.length} dòng vào bảng giá` : 'Thêm vào bảng giá'}
          </Button>
        </div>
      </form>
    </div>
  );
}
