import { useMemo, useState } from 'react';
import { Image, Trash, UploadSimple } from '@phosphor-icons/react';
import type { PatientDocument } from '@nexamed/shared';
import { PATIENT_DOCUMENT_CATEGORY_LABEL } from './patient-document-constants';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ListLoadError } from '../../shared/ui/ListLoadError';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { toVietnamDateString } from '../encounter/follow-up-date';
import { useCanSeePatientParaclinicalTab } from '../patient/PatientParaclinicalResultsTab';
import { ParaclinicalResultViewDialog } from '../paraclinical-result/ParaclinicalResultViewDialog';
import type { ParaclinicalGroup } from '../paraclinical-result/paraclinical-group';
import { DocumentEditDialog } from './DocumentEditDialog';
import { DocumentThumb } from './DocumentThumb';
import { DocumentUploadDialog } from './DocumentUploadDialog';
import { DocumentViewerDialog } from './DocumentViewerDialog';
import { CATEGORY_SHORT_LABEL, formatDateTimeVi, isSupplementUpload, sourceBadge } from './patient-document-view';
import { useEncounterDocumentsQuery, useRemovePatientDocumentMutation } from './patient-document.queries';
import { requestThumbnailBackfill } from './request-thumbnail-backfill';

type Filter = 'all' | 'photo' | 'other' | 'ref';

function filterOf(doc: PatientDocument): Exclude<Filter, 'all'> {
  if (doc.category === 'CLINICAL_PHOTO') return 'photo';
  if (doc.category === 'PARACLINICAL') return 'ref';
  return 'other';
}

/**
 * Tab "Hình ảnh" của màn khám (docs/DECISIONS.md #299 bổ sung 6, mockup đã chốt https://claude.ai/artifact/Vq4jrvzMeMSDjsNmKSwYRz): ảnh và tài liệu của ĐÚNG lượt khám này, lọc theo loại, nút "+ Đính ảnh".
 * Cùng dữ liệu với tab "Hình ảnh & Tài liệu" của hồ sơ bệnh nhân (ảnh đính ở đây nằm luôn ở đó); ảnh tự gộp từ kết quả cận lâm sàng hiện dạng chỉ đọc. Lượt khám đã hoàn thành vẫn đính thêm được,
 * ảnh đính sau khi hoàn thành ghi là "bổ sung".
 */
export function EncounterImagesTab({
  patientId,
  patientName,
  encounterId,
  encounterLabel,
  completedAt,
}: {
  patientId: string;
  patientName: string;
  encounterId: string;
  /** Mã hiển thị của lượt khám (ví dụ KB-2026-004512). */
  encounterLabel: string;
  /** Giờ hoàn tất lượt khám (ISO) — ảnh tải lên sau mốc này ghi là "bổ sung". */
  completedAt?: string | null;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [uploading, setUploading] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PatientDocument | null>(null);
  const [deleting, setDeleting] = useState<PatientDocument | null>(null);
  const canSeeResults = useCanSeePatientParaclinicalTab();
  const [resultView, setResultView] = useState<{ group: ParaclinicalGroup; itemId: string } | null>(null);
  const today = useMemo(() => toVietnamDateString(new Date().toISOString()), []);

  const query = useEncounterDocumentsQuery(patientId, encounterId);
  const removeMutation = useRemovePatientDocumentMutation(patientId);
  const first = query.data?.pages[0];
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const shown = useMemo(() => (filter === 'all' ? items : items.filter((d) => filterOf(d) === filter)), [items, filter]);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>
    );
  }
  if (query.isError || !first) {
    return <ListLoadError error={query.error} fallbackMessage="Không tải được ảnh của lượt khám." onRetry={() => void query.refetch()} />;
  }

  const { access } = first;
  const canUpload = access.clinical.upload;
  const counts = { all: items.length, photo: items.filter((d) => filterOf(d) === 'photo').length, other: items.filter((d) => filterOf(d) === 'other').length, ref: items.filter((d) => filterOf(d) === 'ref').length };
  const viewerIndex = viewerId ? shown.findIndex((d) => d.id === viewerId) : -1;
  const openResult = canSeeResults
    ? (d: PatientDocument) => {
        if (!d.sourceRef) return;
        setViewerId(null);
        setResultView({ group: d.sourceRef.group, itemId: d.sourceRef.orderItemId });
      }
    : undefined;

  const uploadButton = (
    <Button type="button" disabled={!canUpload} title={canUpload ? undefined : 'Bạn chỉ có quyền xem'} onClick={() => setUploading(true)}>
      <UploadSimple size={16} aria-hidden="true" /> Đính ảnh
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <EmptyState
          icon={Image}
          title="Lượt khám này chưa có ảnh"
          description="Đính ảnh vết thương, phim chụp hoặc giấy chuyển tuyến để lưu cùng hồ sơ."
          action={uploadButton}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-[15px] font-semibold text-slate-900">Hình ảnh của lượt khám này</h3>
            <SegmentedToggle
              ariaLabel="Lọc theo loại"
              value={filter}
              onChange={setFilter}
              items={[
                { id: 'all', label: 'Tất cả', count: counts.all },
                ...(counts.photo > 0 ? [{ id: 'photo' as const, label: 'Ảnh lâm sàng', count: counts.photo }] : []),
                ...(counts.other > 0 ? [{ id: 'other' as const, label: 'Khác', count: counts.other }] : []),
                ...(counts.ref > 0 ? [{ id: 'ref' as const, label: 'Từ cận lâm sàng', count: counts.ref }] : []),
              ]}
            />
            <div className="flex-1" />
            {uploadButton}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            {shown.map((doc) => {
              const badge = sourceBadge(doc.source);
              const supplement = !doc.readOnly && isSupplementUpload(doc.uploadedAt, completedAt);
              return (
                <button key={doc.id} type="button" onClick={() => setViewerId(doc.id)} title={doc.displayName} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm hover:border-blue-300">
                  <span className="relative block aspect-[4/3] overflow-hidden bg-slate-100">
                    <DocumentThumb kind={doc.kind} url={doc.url} thumbnailUrl={doc.thumbnailUrl} category={doc.category} onOriginalLoad={(img) => requestThumbnailBackfill(patientId, access, doc, img)} />
                    {badge && <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-px text-[11.5px] font-semibold text-emerald-700">{badge}</span>}
                    {supplement && <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-px text-[11.5px] font-semibold text-amber-700">Bổ sung</span>}
                  </span>
                  <span className="flex flex-col gap-px px-2.5 py-2">
                    <span className="truncate text-[13.5px] font-semibold text-slate-900">{doc.displayName}</span>
                    <span className="truncate text-xs font-normal text-slate-500">
                      {CATEGORY_SHORT_LABEL[doc.category]} · {formatDateTimeVi(doc.uploadedAt).slice(11)} · {doc.readOnly ? 'chỉ đọc' : doc.uploadedByName}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {query.hasNextPage && <p className="text-xs font-medium text-slate-500">Còn ảnh khác của lượt khám này, xem đủ ở tab Hình ảnh &amp; Tài liệu của hồ sơ bệnh nhân.</p>}
        </>
      )}

      {uploading && <DocumentUploadDialog patientId={patientId} patientName={patientName} access={access} folders={first.folders} today={today} encounter={{ id: encounterId, label: encounterLabel }} onClose={() => setUploading(false)} />}
      {viewerIndex >= 0 && (
        <DocumentViewerDialog
          items={shown}
          index={viewerIndex}
          access={access}
          onIndexChange={(i) => setViewerId(shown[i]?.id ?? null)}
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
          folders={first.folders}
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
    </div>
  );
}
