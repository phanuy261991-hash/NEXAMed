import { Folder } from '@phosphor-icons/react';
import {
  type PatientDocumentCategory,
  type PatientDocumentFolder,
  type PatientDocumentSummary,
} from '@nexamed/shared';
import { PATIENT_DOCUMENT_CATEGORY_LABEL } from './patient-document-constants';
import { formatBytes, formatIsoDateVi } from './patient-document-view';

const ICON_TONE: Record<PatientDocumentCategory, string> = {
  PARACLINICAL: 'bg-[#e6f6f2] text-[#099078]',
  CLINICAL_PHOTO: 'bg-amber-100 text-amber-700',
  CONTRACT: 'bg-blue-50 text-blue-600',
  OTHER: 'bg-slate-100 text-slate-500',
};

const GRID = 'grid grid-cols-[minmax(0,1fr)_90px_110px_150px] items-center gap-3 max-sm:grid-cols-[minmax(0,1fr)_70px]';

/**
 * Xem THEO LOẠI, màn gốc (mockup màn 2): bốn loại cố định (chỉ hiện loại người xem được phép) rồi các thư mục phòng khám tự tạo. Bấm một dòng để mở thư mục.
 */
export function DocumentTypeRoot({
  summary,
  folders,
  onOpenCategory,
  onOpenFolder,
}: {
  summary: PatientDocumentSummary;
  folders: PatientDocumentFolder[];
  onOpenCategory: (category: PatientDocumentCategory) => void;
  onOpenFolder: (folder: PatientDocumentFolder) => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className={`${GRID} border-b border-slate-100 bg-slate-50 px-3.5 py-2 text-[13px] font-semibold text-slate-700`}>
          <span>Thư mục</span>
          <span>Số tệp</span>
          <span className="max-sm:hidden">Dung lượng</span>
          <span className="max-sm:hidden">Cập nhật gần nhất</span>
        </div>
        {summary.byCategory.map((row) => (
          <button key={row.category} type="button" onClick={() => onOpenCategory(row.category)} className={`${GRID} w-full border-b border-slate-100 px-3.5 py-2.5 text-left last:border-b-0 hover:bg-slate-50`}>
            <span className="flex min-w-0 items-center gap-2.5 font-semibold text-slate-900">
              <span className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-lg ${ICON_TONE[row.category]}`}>
                <Folder size={20} weight="bold" aria-hidden="true" />
              </span>
              <span className="truncate">{PATIENT_DOCUMENT_CATEGORY_LABEL[row.category]}</span>
            </span>
            <span className="tabular-nums text-slate-600">{row.count}</span>
            <span className="tabular-nums text-slate-600 max-sm:hidden">{formatBytes(row.totalBytes)}</span>
            <span className="tabular-nums text-slate-600 max-sm:hidden">{row.lastUploadDate ? formatIsoDateVi(row.lastUploadDate) : '—'}</span>
          </button>
        ))}
      </div>

      {folders.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-slate-900">Thư mục tự tạo</div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            {folders.map((folder) => (
              <button key={folder.id} type="button" onClick={() => onOpenFolder(folder)} className={`${GRID} w-full border-b border-slate-100 px-3.5 py-2.5 text-left last:border-b-0 hover:bg-slate-50`}>
                <span className="flex min-w-0 items-center gap-2.5 font-semibold text-slate-900">
                  <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Folder size={20} weight="bold" aria-hidden="true" />
                  </span>
                  <span className="truncate">{folder.name}</span>
                </span>
                <span className="tabular-nums text-slate-600">{folder.fileCount}</span>
                <span className="tabular-nums text-slate-600 max-sm:hidden">{formatBytes(folder.totalBytes)}</span>
                <span className="tabular-nums text-slate-600 max-sm:hidden">{folder.lastUploadDate ? formatIsoDateVi(folder.lastUploadDate) : '—'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs font-medium text-slate-500">Một tệp thuộc một loại, và có thể nằm thêm trong một thư mục tự tạo.</p>
    </div>
  );
}
