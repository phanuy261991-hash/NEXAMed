import { useState } from 'react';
import { CheckCircle, FileXls, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import type { LabPartnerPriceImportCommitResponse, LabPartnerPriceImportPreviewResponse } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { previewLabPartnerPriceImport } from './lab-partner.api';
import { useCommitLabPartnerPriceImportMutation } from './lab-partner.queries';
import { PRICE_IMPORT_RESULT_VIEW, canWritePriceImport, priceImportWriteLabel, splitErrorReason, summarizePriceImport } from './lab-partner-price-import-model';

/** Giới hạn dung lượng file nhập ở máy chủ (5 MB) — thông báo nêu rõ con số để người dùng biết cách xử lý. */
const FILE_TOO_LARGE_MESSAGE = 'File quá lớn — tối đa 5 MB. Hãy chia nhỏ file rồi chọn lại.';

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.code === 'PAYLOAD_TOO_LARGE' ? FILE_TOO_LARGE_MESSAGE : err.message;
  return fallback;
}

const TH = 'px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-800';
const TD = 'px-3 py-2 text-sm text-slate-900';

/**
 * Hộp "Nhập giá trả từ Excel" (docs/DECISIONS.md #291 GĐ4, mockup đã chốt 10/11/2026): chọn file → XEM TRƯỚC ngay (chưa ghi gì) → "Ghi N giá". Có lỗi thì không ghi được; sửa file rồi chọn lại.
 * Ghi trong một lần (hoặc ghi hết hoặc không ghi gì). Lỗi mức file (sai mẫu, không phải .xlsx, quá lớn) báo ngay trong hộp; lỗi từng dòng nêu dòng, cột và cách sửa.
 */
export function LabPartnerPriceImportDialog({ onClose }: { onClose: () => void }) {
  const commit = useCommitLabPartnerPriceImportMutation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LabPartnerPriceImportPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LabPartnerPriceImportCommitResponse | null>(null);
  const titleId = 'lp-price-import-title';

  async function handleFileChange(input: HTMLInputElement) {
    const selected = input.files?.[0];
    // Xoá giá trị ô chọn file: sửa file xong rồi chọn lại ĐÚNG tên file cũ vẫn kích hoạt sự kiện.
    input.value = '';
    setError(null);
    setResult(null);
    setPreview(null);
    setFile(selected ?? null);
    if (!selected) return;
    setPreviewing(true);
    try {
      setPreview(await previewLabPartnerPriceImport(selected));
    } catch (err) {
      setError(describeError(err, 'Không đọc được file, kiểm tra lại đúng file mẫu.'));
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
      setError(describeError(err, 'Ghi giá thất bại, vui lòng thử lại. Chưa có giá nào được ghi.'));
    }
  }

  const totals = preview ? summarizePriceImport(preview) : null;
  const canWrite = totals !== null && canWritePriceImport(totals) && !previewing;
  const nothingInFile = preview !== null && preview.serviceRowCount === 0 && preview.errorRows.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="shrink-0 px-6 pt-5">
          <ModalHeader icon={FileXls} title="Nhập giá trả từ Excel" subtitle="Cập nhật giá trả của từng dịch vụ cho từng đối tác" onClose={onClose} />
          <h2 id={titleId} className="sr-only">
            Nhập giá trả từ Excel
          </h2>
        </div>

        <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {!result && (
            <label
              className={`mt-2 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors ${
                file ? 'border-blue-300 bg-blue-50/50' : 'border-slate-300 hover:border-blue-300 hover:bg-slate-50'
              }`}
            >
              <input type="file" accept=".xlsx" className="hidden" onChange={(e) => void handleFileChange(e.target)} />
              {file ? <FileXls size={28} weight="fill" className="text-blue-600" aria-hidden="true" /> : <UploadSimple size={26} weight="bold" className="text-slate-400" aria-hidden="true" />}
              <span className="text-[13.5px] font-semibold text-slate-700">{file ? file.name : 'Bấm để chọn file .xlsx'}</span>
              <span className="text-xs text-slate-600">
                {file ? 'Sửa file xong, bấm vào đây để chọn lại — hệ thống đọc lại và báo kết quả mới.' : 'Dùng file mẫu hoặc file xuất từ "Giá trả (Excel)". Tối đa 2.000 dịch vụ, 5 MB.'}
              </span>
            </label>
          )}

          {previewing && <p className="mt-4 text-center text-[13px] text-slate-600">Đang đọc file...</p>}
          {error && <ErrorBanner message={error} />}

          {result && (
            <div className="mt-2 flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-[13.5px] text-emerald-800" role="status">
              <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Đã ghi <strong>{result.updatedPriceCount}</strong> giá cho <strong>{result.updatedServiceCount}</strong> dịch vụ
                {result.defaultChangeCount > 0 && <>, đổi đối tác mặc định của <strong>{result.defaultChangeCount}</strong> dịch vụ</>}. Mẫu đã gửi giữ giá đã chụp lúc gửi.
              </span>
            </div>
          )}

          {nothingInFile && !result && (
            <div role="alert" className="mt-4 flex items-start gap-2.5 border-l-4 border-l-amber-500 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
              <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>File không có dòng dịch vụ nào. Điền vào sheet "Giá trả đối tác" (xoá dòng ví dụ) rồi lưu file trước khi chọn lại.</span>
            </div>
          )}

          {preview && totals && !result && !nothingInFile && (
            <div className="mt-4 flex flex-col gap-4">
              <dl className="flex flex-wrap rounded-lg border border-slate-200 bg-white" aria-label="Tóm tắt xem trước">
                <div className="min-w-[150px] flex-1 border-l border-slate-200 px-4 py-2.5 first:border-l-0">
                  <dt className="text-[15px] font-semibold text-slate-800">Sẽ cập nhật</dt>
                  <dd className="text-[22px] font-semibold tabular-nums text-emerald-600">{totals.writeCount} giá</dd>
                </div>
                <div className="min-w-[150px] flex-1 border-l border-slate-200 px-4 py-2.5">
                  <dt className="text-[15px] font-semibold text-slate-800">Giữ nguyên</dt>
                  <dd className="text-[22px] font-semibold tabular-nums text-slate-900">{totals.keepCount} ô</dd>
                </div>
                <div className="min-w-[150px] flex-1 border-l border-slate-200 px-4 py-2.5">
                  <dt className="text-[15px] font-semibold text-slate-800">Lỗi</dt>
                  <dd className={`text-[22px] font-semibold tabular-nums ${totals.errorCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{totals.errorCount}</dd>
                </div>
              </dl>

              {preview.errorRows.length > 0 ? (
                <>
                  <div className="scroll-hover max-h-[38vh] overflow-auto rounded-md border border-slate-200">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b-2 border-blue-600 bg-slate-100">
                          <th className={`${TH} w-16 text-center`}>Dòng</th>
                          <th className={`${TH} w-44 text-center`}>Cột</th>
                          <th className={`${TH} text-left`}>Lỗi và cách sửa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.errorRows.map((r, i) => {
                          const { column, message } = splitErrorReason(r.reason);
                          return (
                            <tr key={i} className="border-b border-slate-200 bg-rose-50/60 last:border-0">
                              <td className={`${TD} border-l-4 border-l-rose-500 text-center font-semibold`}>{r.rowNumber}</td>
                              <td className={`${TD} text-center`}>{column || '—'}</td>
                              <td className={`${TD} text-rose-700`}>{message}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p role="alert" className="border-l-4 border-l-amber-500 bg-amber-50 px-4 py-2.5 text-[13px] font-semibold text-amber-800">
                    Sửa file rồi chọn lại. Chưa có giá nào được ghi.
                  </p>
                </>
              ) : (
                <div className="scroll-hover max-h-[38vh] overflow-auto rounded-md border border-slate-200">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b-2 border-blue-600 bg-slate-100">
                        <th className={`${TH} text-left`}>Dịch vụ</th>
                        <th className={`${TH} text-center`}>Đối tác</th>
                        <th className={`${TH} text-right`}>Giá hiện tại</th>
                        <th className={`${TH} text-right`}>Giá mới</th>
                        <th className={`${TH} text-center`}>Kết quả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.changes.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-600">
                            File không nhập giá nào (mọi ô giá để trống).
                          </td>
                        </tr>
                      )}
                      {preview.changes.map((c) => {
                        const view = PRICE_IMPORT_RESULT_VIEW[c.result];
                        return (
                          <tr key={`${c.rowNumber}-${c.partnerCode}`} className="border-b border-slate-200 last:border-0">
                            <td className={`${TD} font-semibold`}>{c.serviceName}</td>
                            <td className={`${TD} text-center`} title={c.partnerName}>
                              {c.partnerName}
                            </td>
                            <td className={`${TD} text-right tabular-nums ${c.currentAmount === null ? 'text-slate-500' : ''}`}>{c.currentAmount === null ? 'chưa có' : formatVnd(c.currentAmount)}</td>
                            <td className={`${TD} text-right font-semibold tabular-nums`}>{formatVnd(c.newAmount)}</td>
                            <td className={`${TD} text-center`}>
                              <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.ignoredColumns.length > 0 && (
                <p className="text-[12.5px] font-medium text-slate-600">
                  Bỏ qua cột không còn đối tác đang dùng hoặc không nhận ra: {preview.ignoredColumns.map((c) => `"${c}"`).join(', ')}.
                </p>
              )}
              {preview.errorRows.length === 0 && (
                <p className="text-[12.5px] font-medium text-slate-600">
                  {totals.defaultChangeCount > 0 ? `Đổi đối tác mặc định của ${totals.defaultChangeCount} dịch vụ. ` : 'Đối tác mặc định của dịch vụ không đổi. '}Giá mới không đổi giá đã chụp cho mẫu đã gửi.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            {result ? 'Đóng' : 'Huỷ'}
          </Button>
          {!result && (
            <Button type="button" loading={commit.isPending} disabled={!canWrite} onClick={() => void handleConfirm()}>
              {totals ? priceImportWriteLabel(totals) : 'Ghi giá'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
