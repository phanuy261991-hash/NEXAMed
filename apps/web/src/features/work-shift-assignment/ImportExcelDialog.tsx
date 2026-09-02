import { useRef, useState } from 'react';
import { CheckCircle, FileXls, UploadSimple, WarningCircle, X } from '@phosphor-icons/react';
import type { ImportWorkShiftAssignmentsPreviewResponse } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import {
  commitImportWorkShiftAssignments,
  downloadWorkShiftAssignmentTemplate,
  previewImportWorkShiftAssignments,
} from './work-shift-assignment.api';

/**
 * Nhập Excel "Lịch làm việc nhân viên" (chỉ trang này, scope global) — 2 bước: chọn Tháng + file →
 * xem trước 3 nhóm (hợp lệ/trùng/lỗi), rồi TỰ QUYẾT ĐỊNH có bấm "Xác nhận nhập" không (đã hỏi và
 * chốt: không tự động bỏ qua/ghi đè trùng ca âm thầm). Dòng lỗi/trùng LUÔN bị bỏ qua khi nhập —
 * không có "ghi đè" (trùng nghĩa là nhân viên/ngày/ca giống hệt hàng có sẵn, không có gì khác để
 * ghi đè). File dạng bảng ngang (cột = ngày trong tháng) không tự chứa tháng đọc được an toàn — bắt
 * chọn tường minh ở đây (mặc định = tháng đang xem trên lưới), gửi kèm mỗi lần preview/commit.
 */
export function ImportExcelDialog({
  defaultMonth,
  onClose,
  onImported,
}: {
  defaultMonth: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(defaultMonth);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportWorkShiftAssignmentsPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ createdCount: number; duplicateCount: number; errorCount: number } | null>(null);

  async function runPreview(selectedFile: File, forMonth: string) {
    setError(null);
    setResult(null);
    setPreview(null);
    setPreviewing(true);
    try {
      setPreview(await previewImportWorkShiftAssignments(selectedFile, forMonth));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không đọc được file, kiểm tra lại đúng mẫu.');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleFileChange(selected: File | undefined) {
    if (!selected) {
      setFile(null);
      setPreview(null);
      return;
    }
    setFile(selected);
    await runPreview(selected, month);
  }

  function handleMonthChange(newMonth: string) {
    setMonth(newMonth);
    if (file) void runPreview(file, newMonth);
  }

  async function handleConfirm() {
    if (!file) return;
    setCommitting(true);
    setError(null);
    try {
      setResult(await commitImportWorkShiftAssignments(file, month));
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nhập thất bại, vui lòng thử lại.');
    } finally {
      setCommitting(false);
    }
  }

  const hasValidRows = (preview?.validRows.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby="import-excel-title">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="relative flex-shrink-0 border-b border-slate-200 px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} weight="bold" />
          </button>
          <h2 id="import-excel-title" className="text-[16px] font-bold text-slate-900">
            Nhập lịch làm việc từ Excel
          </h2>

          <div className="mt-3 flex items-center gap-2.5">
            <label htmlFor="import-month" className="text-[13px] font-semibold text-slate-700">
              Tháng cần nhập
            </label>
            <input
              id="import-month"
              type="month"
              value={month}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900"
            />
          </div>

          <p className="mt-2 text-[13px] text-slate-500">
            Chưa có file mẫu?{' '}
            <button type="button" onClick={() => void downloadWorkShiftAssignmentTemplate(month)} className="font-semibold text-blue-600 hover:underline">
              Tải file mẫu tháng {month}
            </button>
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-hover px-6 py-5">
          {!result && (
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
                file ? 'border-blue-300 bg-blue-50/50' : 'border-slate-300 hover:border-blue-300 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => void handleFileChange(e.target.files?.[0])}
              />
              {file ? <FileXls size={28} weight="fill" className="text-blue-600" /> : <UploadSimple size={26} weight="bold" className="text-slate-400" />}
              <span className="text-[13.5px] font-semibold text-slate-700">{file ? file.name : 'Bấm để chọn file .xlsx'}</span>
              {!file && <span className="text-[11.5px] text-slate-400">Đúng theo mẫu: cột 1 Mã nhân viên, các cột sau là từng ngày trong tháng</span>}
            </label>
          )}

          {previewing && <p className="mt-4 text-center text-[13px] text-slate-500">Đang đọc file...</p>}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
              <WarningCircle size={16} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="mt-4 flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-[13.5px] text-emerald-800">
              <CheckCircle size={20} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                Đã nhập thành công <strong>{result.createdCount}</strong> ca. Bỏ qua {result.duplicateCount} ca đã trùng, {result.errorCount} ô lỗi.
              </span>
            </div>
          )}

          {preview && !result && (
            <div className="mt-5 flex flex-col gap-4">
              <PreviewSection
                tone="emerald"
                title={`Hợp lệ, sẽ nhập (${preview.validRows.length})`}
                rows={preview.validRows.map((r) => `Dòng ${r.rowNumber}: ${r.employeeName} — ${r.workDate} — ${r.workShiftName}`)}
              />
              <PreviewSection
                tone="slate"
                title={`Đã có sẵn, sẽ bỏ qua (${preview.duplicateRows.length})`}
                rows={preview.duplicateRows.map((r) => `Dòng ${r.rowNumber}: ${r.employeeName} — ${r.workDate} — ${r.workShiftName}`)}
              />
              <PreviewSection
                tone="rose"
                title={`Lỗi, không nhập được (${preview.errorRows.length})`}
                rows={preview.errorRows.map((r) => `Dòng ${r.rowNumber}: ${r.employeeCode || '(trống)'} — ${r.workDate || '(trống)'} — ${r.reason}`)}
              />
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            {result ? 'Đóng' : 'Huỷ'}
          </Button>
          {!result && (
            <Button type="button" loading={committing} disabled={!hasValidRows || previewing} onClick={() => void handleConfirm()}>
              Xác nhận nhập {hasValidRows ? `(${preview!.validRows.length} ca)` : ''}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewSection({ tone, title, rows }: { tone: 'emerald' | 'slate' | 'rose'; title: string; rows: string[] }) {
  if (rows.length === 0) return null;
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
  }[tone];
  return (
    <div className={`rounded-md border ${toneClass}`}>
      <div className="border-b border-current/20 px-3.5 py-2 text-[12.5px] font-bold">{title}</div>
      <ul className="max-h-32 overflow-y-auto scroll-hover px-3.5 py-2 text-[12px]">
        {rows.map((r, i) => (
          <li key={i} className="py-0.5">
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}
