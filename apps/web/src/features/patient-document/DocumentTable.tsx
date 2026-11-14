import { ArrowSquareOut, DownloadSimple, Eye, PencilSimple, ArrowRight, Trash } from '@phosphor-icons/react';
import type { PatientDocument, PatientDocumentAccess } from '@nexamed/shared';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { RowActionMenu, type RowActionMenuItem } from '../../shared/ui/RowActionMenu';
import { DocumentThumb } from './DocumentThumb';
import { canDeleteDocument, canEditDocument, canOpenResult, formatBytes, formatIsoDateVi, sourceText } from './patient-document-view';
import { downloadPatientDocument } from './patient-document.api';

/**
 * Bảng tệp trong một thư mục (mockup màn 3, 3b, 11, 12). Dòng tệp lấy từ nơi khác chỉ có Xem và Tải về; tệp tải tay còn có menu Sửa, Chuyển thư mục, Xoá theo quyền.
 * Công ty nhiều chi nhánh hiện cột Chi nhánh và tô nền xanh nhạt tệp tải lên ở chi nhánh khác.
 */
export function DocumentTable({
  items,
  access,
  multiBranch,
  currentBranchId,
  onOpen,
  onOpenResult,
  onEdit,
  onDelete,
}: {
  items: PatientDocument[];
  access: PatientDocumentAccess;
  multiBranch: boolean;
  currentBranchId: string;
  onOpen: (doc: PatientDocument) => void;
  /** Mở phiếu kết quả cận lâm sàng của dòng tham chiếu (chỉ dòng có `sourceRef`). Bỏ trống khi người xem không có quyền xem kết quả cận lâm sàng. */
  onOpenResult?: (doc: PatientDocument) => void;
  onEdit: (doc: PatientDocument) => void;
  onDelete: (doc: PatientDocument) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-[13px] font-semibold text-slate-700">
            <th className="border-b border-slate-200 px-3 py-2">Tên tệp</th>
            <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">Ngày tải</th>
            {multiBranch && <th className="border-b border-slate-200 px-3 py-2">Chi nhánh</th>}
            <th className="border-b border-slate-200 px-3 py-2">Nguồn</th>
            <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">Người tải</th>
            <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-right">Dung lượng</th>
            <th className="w-[130px] border-b border-slate-200 px-3 py-2 text-center">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {items.map((doc) => {
            const menu: RowActionMenuItem[] = [
              { key: 'view', label: 'Xem', icon: <Eye size={16} aria-hidden="true" />, onClick: () => onOpen(doc) },
              { key: 'download', label: 'Tải về', icon: <DownloadSimple size={16} aria-hidden="true" />, onClick: () => downloadPatientDocument(doc) },
            ];
            if (canEditDocument(doc, access)) {
              menu.push(
                { key: 'edit', label: 'Đổi tên, ghi chú', icon: <PencilSimple size={16} aria-hidden="true" />, onClick: () => onEdit(doc) },
                { key: 'move', label: 'Chuyển thư mục', icon: <ArrowRight size={16} aria-hidden="true" />, onClick: () => onEdit(doc) },
              );
            }
            if (canDeleteDocument(doc, access)) {
              menu.push({ key: 'delete', label: 'Xoá', icon: <Trash size={16} aria-hidden="true" />, danger: true, onClick: () => onDelete(doc) });
            }
            const otherBranch = multiBranch && doc.branchId !== currentBranchId;
            return (
              <tr key={doc.id} className={`border-b border-slate-100 last:border-b-0 ${otherBranch ? 'bg-blue-50' : ''}`}>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => onOpen(doc)} className="flex min-w-0 items-center gap-2.5 text-left font-semibold text-slate-900 hover:text-blue-700">
                    <span className="block h-8 w-[42px] flex-none overflow-hidden rounded border border-slate-200 bg-slate-100">
                      <DocumentThumb kind={doc.kind} url={doc.url} category={doc.category} />
                    </span>
                    <span className="truncate">{doc.displayName}</span>
                  </button>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{formatIsoDateVi(doc.uploadDate)}</td>
                {multiBranch && <td className="whitespace-nowrap px-3 py-2">{doc.branchName ?? '—'}</td>}
                <td className="px-3 py-2 text-[13px] text-slate-600">
                  {canOpenResult(doc) && doc.sourceLabel ? (
                    <>
                      Kết quả CLS · <span className="font-semibold text-blue-700">{doc.sourceLabel}</span>
                    </>
                  ) : (
                    sourceText(doc)
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{doc.uploadedByName}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatBytes(doc.sizeBytes)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-center gap-1.5">
                    <RowActionButton icon={Eye} label="Xem" onClick={() => onOpen(doc)} />
                    <RowActionButton icon={DownloadSimple} label="Tải về" onClick={() => downloadPatientDocument(doc)} />
                    {onOpenResult && canOpenResult(doc) && <RowActionButton icon={ArrowSquareOut} label="Mở kết quả" onClick={() => onOpenResult(doc)} />}
                    {menu.length > 2 && <RowActionMenu label="Thêm thao tác" items={menu} />}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
