import { useEffect } from 'react';
import { ArrowRight, ArrowSquareOut, CaretLeft, CaretRight, DownloadSimple, PencilSimple, Trash, X } from '@phosphor-icons/react';
import {
  type PatientDocument,
  type PatientDocumentAccess,
} from '@nexamed/shared';
import { PATIENT_DOCUMENT_CATEGORY_LABEL } from './patient-document-constants';
import { resolveApiUrl } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { DocumentArt } from './DocumentThumb';
import { canDeleteDocument, canEditDocument, canOpenResult, formatBytes, formatDateTimeVi, sourceText } from './patient-document-view';
import { downloadPatientDocument } from './patient-document.api';

/**
 * Xem lớn một tệp (mockup màn 5, 5b): ảnh xem trực tiếp, PDF xem trong khung, DICOM chỉ tải về. Bên phải là chi tiết và thao tác; tệp tham chiếu chỉ đọc chỉ có Tải về
 * kèm một dòng giải thích vì sao không sửa/xoá ở đây. Mũi tên trái/phải chuyển qua tệp kế trong danh sách đang hiện, Esc đóng.
 */
export function DocumentViewerDialog({
  items,
  index,
  access,
  onIndexChange,
  onOpenResult,
  onEdit,
  onDelete,
  onClose,
}: {
  items: PatientDocument[];
  index: number;
  access: PatientDocumentAccess;
  onIndexChange: (index: number) => void;
  /** Mở phiếu kết quả cận lâm sàng của dòng tham chiếu (nút "Mở kết quả"). Bỏ trống khi người xem không có quyền xem kết quả cận lâm sàng. */
  onOpenResult?: (doc: PatientDocument) => void;
  onEdit: (doc: PatientDocument) => void;
  onDelete: (doc: PatientDocument) => void;
  onClose: () => void;
}) {
  const doc = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, hasPrev, hasNext, onClose, onIndexChange]);

  if (!doc) return null;
  const editable = canEditDocument(doc, access);
  const deletable = canDeleteDocument(doc, access);
  const src = resolveApiUrl(doc.url);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 p-3" role="dialog" aria-modal="true" aria-label={doc.displayName}>
      <div className="grid max-h-full w-full max-w-[1000px] grid-cols-[minmax(0,1fr)_300px] overflow-hidden rounded-xl bg-[#0b1220] shadow-xl max-md:grid-cols-1 max-md:overflow-y-auto">
        <div className="relative flex min-h-[420px] items-center justify-center p-4 text-slate-200">
          <div className="absolute left-4 top-3 max-w-[70%] truncate text-sm font-semibold">
            {doc.displayName} · {index + 1}/{items.length}
          </div>
          {hasPrev && (
            <button type="button" aria-label="Tệp trước" onClick={() => onIndexChange(index - 1)} className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
              <CaretLeft size={18} weight="bold" aria-hidden="true" />
            </button>
          )}
          {doc.kind === 'image' ? (
            <img src={src} alt={doc.displayName} className="max-h-[70vh] max-w-full rounded border border-slate-700 object-contain" />
          ) : doc.kind === 'pdf' ? (
            <iframe title={doc.displayName} src={src} className="h-[70vh] w-full max-w-[560px] rounded bg-white" />
          ) : (
            <div className="flex w-full max-w-[420px] flex-col items-center gap-3 text-center">
              <div className="aspect-[4/3] w-full overflow-hidden rounded border border-slate-700">
                <DocumentArt kind="dicom" />
              </div>
              <p className="text-sm font-medium text-slate-300">Chưa xem được tệp DICOM trong hệ thống. Hãy tải về để xem bằng phần mềm chuyên dụng.</p>
            </div>
          )}
          {hasNext && (
            <button type="button" aria-label="Tệp sau" onClick={() => onIndexChange(index + 1)} className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
              <CaretRight size={18} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3 bg-white p-4 text-slate-900">
          <div className="flex items-center">
            <h2 className="text-base font-semibold">Chi tiết tệp</h2>
            <div className="flex-1" />
            <button type="button" aria-label="Đóng" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <Detail label="Tên tệp" value={doc.displayName} />
          <Detail label="Loại" value={PATIENT_DOCUMENT_CATEGORY_LABEL[doc.category]} />
          {doc.folderName && <Detail label="Thư mục" value={doc.folderName} />}
          <Detail label="Ngày tải" value={formatDateTimeVi(doc.uploadedAt)} />
          <Detail label="Người tải" value={doc.uploadedByName} />
          <Detail label="Dung lượng" value={formatBytes(doc.sizeBytes)} />
          {doc.encounterLabel && <Detail label="Lượt khám" value={doc.encounterLabel} />}
          {doc.note && <Detail label="Ghi chú" value={doc.note} />}
          {doc.readOnly && <Detail label="Nguồn" value={sourceText(doc)} />}
          {doc.readOnly && (
            <p className="text-xs font-medium text-slate-500">
              {canOpenResult(doc) ? 'Tệp thuộc kết quả đã duyệt. Muốn gỡ, đính chính ở kết quả.' : 'Tệp lấy từ nơi khác trong hồ sơ. Muốn sửa hoặc gỡ, hãy làm ở chỗ gốc.'}
            </p>
          )}
          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => downloadPatientDocument(doc)}>
              <DownloadSimple size={16} aria-hidden="true" /> Tải về
            </Button>
            {onOpenResult && canOpenResult(doc) && (
              <Button type="button" variant="primary" onClick={() => onOpenResult(doc)}>
                <ArrowSquareOut size={16} aria-hidden="true" /> Mở kết quả
              </Button>
            )}
            {editable && (
              <>
                <Button type="button" variant="secondary" onClick={() => onEdit(doc)}>
                  <PencilSimple size={16} aria-hidden="true" /> Sửa
                </Button>
                <Button type="button" variant="secondary" onClick={() => onEdit(doc)}>
                  <ArrowRight size={16} aria-hidden="true" /> Chuyển
                </Button>
              </>
            )}
            {deletable && (
              <Button type="button" variant="danger" onClick={() => onDelete(doc)}>
                <Trash size={16} aria-hidden="true" /> Xoá
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-px">
      <span className="text-[13px] font-medium text-slate-500">{label}</span>
      <span className="break-words text-[15px] font-semibold">{value}</span>
    </div>
  );
}
