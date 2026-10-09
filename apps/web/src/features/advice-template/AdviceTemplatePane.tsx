import { useMemo, useRef, useState } from 'react';
import { ArrowCounterClockwise, FileText, MagnifyingGlass, PencilSimple, Plus, Prohibit } from '@phosphor-icons/react';
import type { AdviceTemplate } from '@nexamed/shared';
import { ACTION_CONFLICT_MESSAGE, describeSaveError, isConflictError } from '../../shared/api/save-error';
import { fetchOneFromList } from '../../shared/api/fetch-one-from-list';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';
import { useSaveFlash } from '../../shared/hooks/useSaveFlash';
import { useEditedRecordGuard } from '../../shared/hooks/useStaleRecordWatch';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { RecordFormNotice } from '../../shared/ui/RecordFormNotice';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { SaveFlashBanner } from '../../shared/ui/SaveFlashBanner';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Textarea } from '../../shared/ui/Textarea';
import { useHasPermission } from '../auth/usePermission';
import { listAdviceTemplates } from './advice-template.api';
import { useAdviceTemplatesQuery, useCreateAdviceTemplateMutation, useUpdateAdviceTemplateMutation } from './advice-template.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

/** Tìm không phân biệt hoa thường và dấu tiếng Việt (web không import giá trị `stripVietnameseDiacritics` từ `@nexamed/core`, #073). */
function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

interface ModalState {
  mode: 'create' | 'edit';
  item?: AdviceTemplate;
}

/**
 * Danh mục "Mẫu lời dặn" (pill của "Danh mục Chuyên môn", docs/DECISIONS.md #222) — quản lý đầy đủ (xem/thêm/sửa/ẩn) ngoài lúc khám; bác sĩ vẫn thêm nhanh được ngay trong hộp thoại
 * "Mẫu lời dặn" ở màn khám (`AdviceTemplateDialog.tsx`). Mẫu dùng chung toàn phòng khám; ẩn = không chọn được ở màn khám nhưng giữ lại, kích hoạt lại được. Thêm/Sửa/Ẩn chỉ hiện với người có `advice_template.manage`.
 */
export function AdviceTemplatePane() {
  const canManage = useHasPermission('advice_template', 'manage');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [hideTarget, setHideTarget] = useState<AdviceTemplate | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Lấy cả mẫu đã ẩn để hiện trạng thái và kích hoạt lại được (cùng cách các danh mục quản trị khác).
  const query = useAdviceTemplatesQuery(true);
  const createMutation = useCreateAdviceTemplateMutation();
  const updateMutation = useUpdateAdviceTemplateMutation();

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const visible = useMemo(() => {
    const q = normalizeForSearch(search.trim());
    return q === '' ? items : items.filter((t) => normalizeForSearch(`${t.name} ${t.content}`).includes(q));
  }, [items, search]);
  const rowSelection = useRowSelection(visible.map((t) => t.id));
  const guard = useEditedRecordGuard({
    editing: modal?.mode === 'edit' ? modal.item : undefined,
    watchKey: 'advice-template',
    fetchLatest: (id) => fetchOneFromList(() => listAdviceTemplates(true), id),
    onFresh: (fresh) => setModal(fresh ? { mode: 'edit', item: fresh } : null),
    onReloaded: () => void query.refetch(),
  });

  /** Lỗi thao tác nhanh ở danh sách: xung đột phiên bản → báo rõ + tải lại danh sách; lỗi khác dùng câu thống nhất. */
  function handleActionError(err: unknown) {
    if (isConflictError(err)) {
      setActionError(ACTION_CONFLICT_MESSAGE);
      void query.refetch();
      return;
    }
    setActionError(describeSaveError(err));
  }

  function handleHide(item: AdviceTemplate) {
    setActionError(null);
    updateMutation.mutate({ id: item.id, body: { isActive: false, version: item.version } }, { onSuccess: () => setHideTarget(null), onError: handleActionError });
  }

  function handleReactivate(item: AdviceTemplate) {
    setActionError(null);
    updateMutation.mutate({ id: item.id, body: { isActive: true, version: item.version } }, { onError: handleActionError });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <MagnifyingGlass size={15} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm mẫu theo tên hoặc nội dung…"
            aria-label="Tìm mẫu lời dặn"
            className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        {canManage && (
          <Button type="button" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Thêm mẫu
          </Button>
        )}
      </div>

      {actionError && <ErrorBanner message={actionError} />}
      {query.isError && <ErrorBanner message="Không tải được danh sách mẫu lời dặn." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Chưa có mẫu lời dặn nào"
          description="Lưu sẵn những lời dặn hay dùng, bác sĩ chỉ cần chọn mẫu ở màn khám là nội dung tự điền vào ô Lời dặn."
          action={
            canManage ? (
              <Button type="button" onClick={() => setModal({ mode: 'create' })}>
                <Plus size={16} weight="bold" aria-hidden="true" />
                Thêm mẫu
              </Button>
            ) : undefined
          }
        />
      )}
      {query.isSuccess && items.length > 0 && visible.length === 0 && <p className="py-10 text-center text-sm text-slate-500">Không có mẫu nào khớp.</p>}

      {query.isSuccess && visible.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="scroll-hover h-full overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="w-10 px-4 py-2.5 text-center">
                    <SelectionCheckbox checked={rowSelection.allLoadedSelected} indeterminate={rowSelection.someLoadedSelected} onChange={rowSelection.toggleAll} ariaLabel="Chọn tất cả" />
                  </th>
                  <th className="w-64 px-4 py-2.5 text-center">Tên mẫu</th>
                  <th className="px-4 py-2.5 text-center">Nội dung lời dặn</th>
                  <th className="w-32 px-4 py-2.5 text-center">Trạng thái</th>
                  {canManage && <th className="w-24 px-4 py-2.5 text-center">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.id} className={`border-b border-slate-200 align-top last:border-0 ${t.isActive ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-2.5 text-center">
                      <SelectionCheckbox checked={rowSelection.isSelected(t.id)} onChange={() => rowSelection.toggle(t.id)} ariaLabel={`Chọn ${t.name}`} />
                    </td>
                    <td className="px-4 py-2.5 text-left font-semibold text-slate-800">{t.name}</td>
                    <td className="px-4 py-2.5 text-left font-medium text-slate-700" title={t.content}>
                      <span className="line-clamp-3 whitespace-pre-line">{t.content}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <StatusBadge tone={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Đang dùng' : 'Đã ẩn'}</StatusBadge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex flex-nowrap items-center justify-center gap-1.5">
                          <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => setModal({ mode: 'edit', item: t })} />
                          {t.isActive ? (
                            <RowActionButton icon={Prohibit} label="Ẩn mẫu" tone="danger" onClick={() => setHideTarget(t)} />
                          ) : (
                            <RowActionButton icon={ArrowCounterClockwise} label="Kích hoạt lại" tone="primary" onClick={() => handleReactivate(t)} />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SelectionToolbar count={rowSelection.selectedCount} onClear={rowSelection.clear} />

      {modal && (
        <AdviceTemplateFormModal
          key={modal.item ? `${modal.item.id}:${modal.item.version}` : 'new'}
          stale={guard.stale}
          onReload={guard.reload}
          mode={modal.mode}
          item={modal.item}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={async (dto) => {
            if (modal.mode === 'create') await createMutation.mutateAsync(dto);
            else if (modal.item) await updateMutation.mutateAsync({ id: modal.item.id, body: { ...dto, version: modal.item.version } });
          }}
        />
      )}

      {hideTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-slate-900">Ẩn mẫu &quot;{hideTarget.name}&quot;?</p>
            <p className="mt-1.5 text-xs text-slate-500">Bác sĩ sẽ không chọn được mẫu này ở màn khám nữa. Có thể kích hoạt lại sau.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setHideTarget(null)}>
                Huỷ
              </Button>
              <Button type="button" variant="danger" loading={updateMutation.isPending} onClick={() => handleHide(hideTarget)}>
                Ẩn mẫu
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdviceTemplateFormModal({
  mode,
  item,
  submitting,
  stale,
  onReload,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  item?: AdviceTemplate;
  submitting: boolean;
  /** Người khác vừa lưu bản mới của mẫu này (phát hiện lúc form đang mở) — khoá nút Lưu tới khi tải lại. */
  stale: boolean;
  onReload: () => void | Promise<void>;
  onCancel: () => void;
  onSubmit: (dto: { name: string; content: string }) => Promise<void>;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(item?.name ?? '');
  const [content, setContent] = useState(item?.content ?? '');
  const { flashVisible, triggerFlash } = useSaveFlash();
  const { saveError, run } = useSaveAttempt();
  const isInvalid = name.trim() === '' || content.trim() === '' || stale;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    if (await run(() => onSubmit({ name: name.trim(), content: content.trim() }))) onCancel();
  }

  async function handleSaveAndContinue() {
    if (isInvalid) return;
    if (!(await run(() => onSubmit({ name: name.trim(), content: content.trim() })))) return;
    setName('');
    setContent('');
    nameInputRef.current?.focus();
    triggerFlash();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader icon={FileText} title={mode === 'create' ? 'Thêm mẫu lời dặn' : 'Sửa mẫu lời dặn'} onClose={onCancel} />

        <SaveFlashBanner visible={flashVisible} />

        <div className="mb-4 mt-4 grid grid-cols-1 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="advice-template-form-name" className="text-sm font-semibold text-slate-800">
              Tên mẫu <span className="text-rose-500">*</span>
            </label>
            <input
              id="advice-template-form-name"
              ref={nameInputRef}
              autoFocus
              maxLength={120}
              placeholder="Ví dụ: Viêm đường hô hấp"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClassName}
            />
          </div>
          <Textarea
            id="advice-template-form-content"
            label="Nội dung lời dặn"
            required
            rows={6}
            maxLength={2000}
            placeholder="Nội dung sẽ tự điền vào ô Lời dặn bác sĩ"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <RecordFormNotice stale={stale} saveError={saveError} onReload={mode === 'edit' ? onReload : undefined} />

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          {mode === 'create' && (
            <Button type="button" variant="secondary" loading={submitting} disabled={isInvalid} onClick={handleSaveAndContinue}>
              Lưu và nhập tiếp
            </Button>
          )}
          <Button type="submit" loading={submitting} disabled={isInvalid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
