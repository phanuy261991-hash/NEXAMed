import { useEffect, useMemo, useState } from 'react';
import { ChartBar, ClipboardText, FileText, FolderSimple, Image, MagnifyingGlass, CaretLeft, PencilSimple, Trash, UploadSimple } from '@phosphor-icons/react';
import {
  type PatientDocument,
  type PatientDocumentCategory,
  type PatientDocumentFolder,
} from '@nexamed/shared';
import { PATIENT_DOCUMENT_CATEGORIES, PATIENT_DOCUMENT_CATEGORY_LABEL } from './patient-document-constants';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useInfiniteScrollSentinel } from '../../shared/hooks/useInfiniteScrollSentinel';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { EmptyState } from '../../shared/ui/EmptyState';
import { InfiniteScrollTail } from '../../shared/ui/InfiniteListFooter';
import { ListLoadError } from '../../shared/ui/ListLoadError';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatCardRow, type StatCardItem } from '../../shared/ui/StatCard';
import { addDaysToDateString, toVietnamDateString } from '../encounter/follow-up-date';
import { DocumentDayView } from './DocumentDayView';
import { DocumentEditDialog } from './DocumentEditDialog';
import { DocumentDeleteFolderDialog, DocumentFolderDialog } from './DocumentFolderDialogs';
import { DocumentTable } from './DocumentTable';
import { DocumentTypeRoot } from './DocumentTypeRoot';
import { DocumentUploadDialog } from './DocumentUploadDialog';
import { DocumentViewerDialog } from './DocumentViewerDialog';
import { useCanSeePatientParaclinicalTab } from '../patient/PatientParaclinicalResultsTab';
import { ParaclinicalResultViewDialog } from '../paraclinical-result/ParaclinicalResultViewDialog';
import type { ParaclinicalGroup } from '../paraclinical-result/paraclinical-group';
import { formatBytes, formatIsoDateVi, PERIOD_OPTIONS } from './patient-document-view';
import { usePatientDocumentsQuery, useRemovePatientDocumentMutation } from './patient-document.queries';
import { INPUT_CLASS } from './DocumentModal';

type ViewMode = 'day' | 'type';
type OpenTarget = { kind: 'category'; category: PatientDocumentCategory } | { kind: 'folder'; folderId: string };

/**
 * Tab "Hình ảnh & Tài liệu" của hồ sơ bệnh nhân (docs/DECISIONS.md #299, mockup đã chốt https://claude.ai/artifact/3kjLBzNBhTNYjGwfJsRSRn): nơi tổng hợp DUY NHẤT mọi hình ảnh/tài liệu gắn bệnh nhân.
 * Hai kiểu xem trên cùng dữ liệu — theo NGÀY (mặc định, thư mục tên ngày tải) và theo LOẠI (bốn loại cố định + thư mục tự tạo). Quyền theo hai nhóm độc lập (tệp lâm sàng / hợp đồng và giấy tờ):
 * máy chủ chỉ trả loại người xem được phép, giao diện ẩn/hiện nút theo `access` trong phản hồi.
 */
export function PatientDocumentsTab({ patientId, patientName, merged }: { patientId: string; patientName: string; merged: boolean }) {
  const [view, setView] = useState<ViewMode>('day');
  const [open, setOpen] = useState<OpenTarget | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [period, setPeriod] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const today = useMemo(() => toVietnamDateString(new Date().toISOString()), []);

  const [uploading, setUploading] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  // "Mở kết quả" của dòng tham chiếu cận lâm sàng (giai đoạn 2): chỉ người xem được kết quả cận lâm sàng mới có nút; hộp xem dùng lại đúng phiếu kết quả của tab "Kết quả cận lâm sàng".
  const canSeeResults = useCanSeePatientParaclinicalTab();
  const [resultView, setResultView] = useState<{ group: ParaclinicalGroup; itemId: string } | null>(null);
  const openResult = canSeeResults
    ? (d: PatientDocument) => {
        if (!d.sourceRef) return;
        setViewerId(null);
        setResultView({ group: d.sourceRef.group, itemId: d.sourceRef.orderItemId });
      }
    : undefined;
  const [editing, setEditing] = useState<PatientDocument | null>(null);
  const [deleting, setDeleting] = useState<PatientDocument | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ folder?: PatientDocumentFolder } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<PatientDocumentFolder | null>(null);

  const atRoot = view === 'type' && open === null;
  const filters = useMemo(() => {
    if (atRoot) return { limit: 1 };
    return {
      category: open?.kind === 'category' ? open.category : ((categoryFilter || undefined) as PatientDocumentCategory | undefined),
      folderId: open?.kind === 'folder' ? open.folderId : undefined,
      q: q || undefined,
      dateFrom: period ? (addDaysToDateString(today, -(Number(period) - 1)) ?? undefined) : undefined,
    };
  }, [atRoot, open, categoryFilter, q, period, today]);
  const filtered = !atRoot && (q !== '' || period !== '' || categoryFilter !== '');

  const query = usePatientDocumentsQuery(patientId, filters);
  const first = query.data?.pages[0];
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const removeMutation = useRemovePatientDocumentMutation(patientId);

  const { fetchNextPage } = query;
  const loadMoreFailed: boolean = query.isFetchNextPageError;
  const sentinelRef = useInfiniteScrollSentinel({
    enabled: !atRoot && query.hasNextPage && !query.isFetchingNextPage && !loadMoreFailed,
    onReach: () => void fetchNextPage(),
    watchKey: items.length,
  });

  // Thư mục đang mở vừa bị xoá (hoặc không còn): quay về màn gốc thay vì để trang trống.
  const folderMissing = open?.kind === 'folder' && first !== undefined && !first.folders.some((f) => f.id === open.folderId);
  useEffect(() => {
    if (folderMissing) setOpen(null);
  }, [folderMissing]);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[84px] w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>
    );
  }
  if (query.isError || !first) {
    return <ListLoadError error={query.error} fallbackMessage="Không tải được danh sách tệp." onRetry={() => void query.refetch()} />;
  }

  const { access, summary, folders, multiBranch, currentBranchId } = first;
  const canUpload = !merged && (access.clinical.upload || access.contract.upload);
  const readCategories = summary.byCategory.map((c) => c.category);
  const openedFolder = open?.kind === 'folder' ? folders.find((f) => f.id === open.folderId) : undefined;
  const contractCount = summary.byCategory.find((c) => c.category === 'CONTRACT')?.count ?? 0;
  const statItems: StatCardItem[] = [
    {
      icon: ClipboardText,
      tone: 'blue',
      label: 'Tổng số tệp',
      value: String(summary.total),
      hint: summary.firstUploadDate && summary.lastUploadDate ? `từ ${formatIsoDateVi(summary.firstUploadDate)} đến ${formatIsoDateVi(summary.lastUploadDate)}` : undefined,
    },
    ...(access.clinical.read ? [{ icon: Image, tone: 'slate' as const, label: 'Kết quả cận lâm sàng', value: String(summary.byCategory.find((c) => c.category === 'PARACLINICAL')?.count ?? 0), hint: 'ảnh và PDF' }] : []),
    ...(access.contract.read ? [{ icon: FileText, tone: 'slate' as const, label: 'Hợp đồng và giấy tờ', value: String(contractCount), hint: 'gồm thẻ BHYT' }] : []),
    { icon: ChartBar, tone: 'slate', label: 'Dung lượng', value: formatBytes(summary.totalBytes), hint: 'của bệnh nhân này' },
  ];

  const empty = summary.total === 0 && folders.length === 0;
  const viewerIndex = viewerId ? items.findIndex((d) => d.id === viewerId) : -1;
  const categoryOptions = [{ value: '', label: 'Tất cả loại' }, ...PATIENT_DOCUMENT_CATEGORIES.filter((c) => readCategories.includes(c)).map((c) => ({ value: c, label: PATIENT_DOCUMENT_CATEGORY_LABEL[c] }))];

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2.5">
      <SegmentedToggle
        ariaLabel="Kiểu xem"
        value={view}
        onChange={(next) => {
          setView(next);
          setOpen(null);
        }}
        items={[
          { id: 'day', label: 'Theo ngày' },
          { id: 'type', label: 'Theo loại' },
        ]}
      />
      <div className="flex-1" />
      {canUpload && (
        <>
          <Button type="button" variant="secondary" onClick={() => setFolderDialog({})}>
            <FolderSimple size={16} aria-hidden="true" /> Thư mục mới
          </Button>
          <Button type="button" onClick={() => setUploading(true)}>
            <UploadSimple size={16} aria-hidden="true" /> Tải lên
          </Button>
        </>
      )}
    </div>
  );

  const filterRow = (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="w-48">
        <Combobox id="pd-category" value={open?.kind === 'category' ? open.category : categoryFilter} onChange={setCategoryFilter} options={categoryOptions} placeholder="Tất cả loại" dense disabled={open?.kind === 'category'} />
      </div>
      <div className="w-52">
        <Combobox id="pd-period" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} placeholder="Mọi thời gian" dense />
      </div>
      <div className="relative min-w-56 flex-1">
        <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm tên tệp, ghi chú…"
          aria-label="Tìm tệp"
          className={`${INPUT_CLASS} py-1.5! pl-8! text-[13px]!`}
        />
      </div>
    </div>
  );

  const breadcrumb = open && (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex items-center gap-2 font-semibold text-slate-900">
        <button type="button" onClick={() => setOpen(null)} className="flex items-center gap-1 text-blue-600 hover:text-blue-800">
          <CaretLeft size={14} weight="bold" aria-hidden="true" /> Theo loại
        </button>
        <span className="text-slate-400">›</span>
        <span>{open.kind === 'category' ? PATIENT_DOCUMENT_CATEGORY_LABEL[open.category] : (openedFolder?.name ?? '')}</span>
      </div>
      <div className="flex-1" />
      {canUpload && openedFolder && (
        <>
          <Button type="button" variant="secondary" onClick={() => setFolderDialog({ folder: openedFolder })}>
            <PencilSimple size={16} aria-hidden="true" /> Đổi tên
          </Button>
          <Button type="button" variant="secondary" onClick={() => setDeletingFolder(openedFolder)}>
            <Trash size={16} aria-hidden="true" /> Xoá thư mục
          </Button>
        </>
      )}
      {canUpload && (
        <Button type="button" onClick={() => setUploading(true)}>
          <UploadSimple size={16} aria-hidden="true" /> Tải lên
        </Button>
      )}
    </div>
  );

  let body;
  if (empty && !filtered) {
    body = (
      <EmptyState
        icon={FolderSimple}
        title="Chưa có hình ảnh hay tài liệu"
        description="Tải lên phim chụp, ảnh lâm sàng hoặc hợp đồng của bệnh nhân. Ảnh kết quả cận lâm sàng tự hiện ở đây."
        action={
          canUpload ? (
            <Button type="button" onClick={() => setUploading(true)}>
              <UploadSimple size={16} aria-hidden="true" /> Tải lên
            </Button>
          ) : undefined
        }
      />
    );
  } else if (atRoot) {
    body = <DocumentTypeRoot summary={summary} folders={folders} onOpenCategory={(category) => setOpen({ kind: 'category', category })} onOpenFolder={(f) => setOpen({ kind: 'folder', folderId: f.id })} />;
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={FolderSimple}
        title={filtered ? 'Không có tệp nào khớp bộ lọc' : 'Thư mục này chưa có tệp'}
        description={filtered ? 'Thử bỏ bớt bộ lọc hoặc đổi khoảng thời gian.' : 'Tải lên tệp hoặc chuyển tệp từ thư mục khác sang đây.'}
      />
    );
  } else if (view === 'day') {
    body = <DocumentDayView items={items} today={today} onOpen={(d) => setViewerId(d.id)} />;
  } else {
    body = (
      <DocumentTable
        items={items}
        access={access}
        multiBranch={multiBranch}
        currentBranchId={currentBranchId}
        onOpen={(d) => setViewerId(d.id)}
        onOpenResult={openResult}
        onEdit={setEditing}
        onDelete={setDeleting}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <StatCardRow items={statItems} />
      {open ? breadcrumb : toolbar}
      {!atRoot && !(empty && !filtered) && filterRow}
      {body}
      {!atRoot && <InfiniteScrollTail sentinelRef={sentinelRef} hasNextPage={query.hasNextPage} isFetchingNextPage={query.isFetchingNextPage} />}
      {loadMoreFailed && (
        <p role="alert" className="text-sm font-semibold text-rose-700">
          Chưa tải thêm được.{' '}
          <button type="button" className="underline" onClick={() => void fetchNextPage()}>
            Thử lại
          </button>
        </p>
      )}
      {!atRoot && items.length > 0 && <p className="text-xs font-medium text-slate-500">Mới nhất ở trên · cuộn xuống tự tải thêm.</p>}
      {multiBranch && view === 'type' && open && items.length > 0 && <p className="text-xs font-medium text-slate-500">Dòng nền xanh nhạt là tệp ở chi nhánh khác. Tệp lâm sàng xem đầy đủ khi mở đúng hồ sơ bệnh nhân.</p>}

      {uploading && (
        <DocumentUploadDialog
          patientId={patientId}
          patientName={patientName}
          access={access}
          folders={folders}
          defaultFolderId={open?.kind === 'folder' ? open.folderId : undefined}
          today={today}
          onClose={() => setUploading(false)}
        />
      )}
      {viewerIndex >= 0 && (
        <DocumentViewerDialog
          items={items}
          index={viewerIndex}
          access={access}
          onIndexChange={(i) => setViewerId(items[i]?.id ?? null)}
          onOpenResult={openResult}
          onEdit={(d) => {
            setViewerId(null);
            setEditing(d);
          }}
          onDelete={(d) => {
            setViewerId(null);
            setDeleting(d);
          }}
          onClose={() => setViewerId(null)}
        />
      )}
      {resultView && <ParaclinicalResultViewDialog group={resultView.group} itemId={resultView.itemId} patientId={patientId} onClose={() => setResultView(null)} />}
      {editing && (
        <DocumentEditDialog
          patientId={patientId}
          doc={editing}
          access={access}
          folders={folders}
          onSaved={() => setEditing(null)}
          onReload={() => {
            setEditing(null);
            void query.refetch();
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ReasonConfirmDialog
          icon={Trash}
          title="Xoá tệp"
          rows={[
            { label: 'Tệp', value: deleting.displayName },
            { label: 'Loại', value: PATIENT_DOCUMENT_CATEGORY_LABEL[deleting.category] },
          ]}
          note="Tệp ẩn khỏi hồ sơ, vẫn lưu vết xoá."
          confirmLabel="Xoá"
          confirmVariant="danger"
          onConfirm={(reason) => removeMutation.mutateAsync({ documentId: deleting.id, version: deleting.version, reason: reason.trim() })}
          onDone={() => setDeleting(null)}
          onClose={() => setDeleting(null)}
        />
      )}
      {folderDialog && (
        <DocumentFolderDialog
          patientId={patientId}
          patientName={patientName}
          folder={folderDialog.folder}
          onDone={() => setFolderDialog(null)}
          onReload={() => {
            setFolderDialog(null);
            void query.refetch();
          }}
          onClose={() => setFolderDialog(null)}
        />
      )}
      {deletingFolder && (
        <DocumentDeleteFolderDialog
          patientId={patientId}
          folder={deletingFolder}
          onDone={() => {
            setDeletingFolder(null);
            setOpen(null);
          }}
          onClose={() => setDeletingFolder(null)}
        />
      )}
    </div>
  );
}
