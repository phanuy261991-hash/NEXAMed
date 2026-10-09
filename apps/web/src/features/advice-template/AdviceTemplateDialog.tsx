import { useEffect, useMemo, useState } from 'react';
import { FileText, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import type { AdviceTemplate } from '@nexamed/shared';
import { describeSaveError } from '../../shared/api/save-error';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { Skeleton } from '../../shared/ui/Skeleton';
import { Textarea } from '../../shared/ui/Textarea';
import { useHasPermission } from '../auth/usePermission';
import { useAdviceTemplatesQuery, useCreateAdviceTemplateMutation, useUpdateAdviceTemplateMutation } from './advice-template.queries';

/** Tìm không phân biệt hoa thường và dấu tiếng Việt (web không import giá trị `stripVietnameseDiacritics` từ `@nexamed/core`, #073). */
function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

interface FormState {
  id: string | null;
  version: number;
  name: string;
  content: string;
}

/**
 * Hộp thoại "Mẫu lời dặn" (docs/DECISIONS.md #222) — chọn 1 hoặc nhiều mẫu rồi "Chèn vào lời dặn" (nối vào cuối ô, bác sĩ vẫn sửa tay được). Người có quyền `advice_template.manage`
 * (bác sĩ, quản lý phòng khám) thêm/sửa/ẩn mẫu ngay trong hộp thoại này; các vai trò khác chỉ chọn. Mẫu dùng chung toàn phòng khám.
 */
export function AdviceTemplateDialog({ onInsert, onClose }: { onInsert: (texts: string[]) => void; onClose: () => void }) {
  const canManage = useHasPermission('advice_template', 'manage');
  const [showHidden, setShowHidden] = useState(false);
  const query = useAdviceTemplatesQuery(canManage && showHidden);
  const createMutation = useCreateAdviceTemplateMutation();
  const updateMutation = useUpdateAdviceTemplateMutation();

  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Esc: đang ở form thì quay về danh sách, đang ở danh sách thì đóng hộp thoại.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (form) {
        setForm(null);
        setError(null);
      } else {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [form, onClose]);

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const visible = useMemo(() => {
    const q = normalizeForSearch(search.trim());
    return q === '' ? items : items.filter((t) => normalizeForSearch(`${t.name} ${t.content}`).includes(q));
  }, [items, search]);
  const pickedInOrder = items.filter((t) => picked.has(t.id) && t.isActive);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleInsert() {
    if (pickedInOrder.length === 0) return;
    onInsert(pickedInOrder.map((t) => t.content));
    onClose();
  }

  async function handleToggleActive(template: AdviceTemplate) {
    setError(null);
    try {
      await updateMutation.mutateAsync({ id: template.id, body: { isActive: !template.isActive, version: template.version } });
      if (template.isActive) {
        setPicked((prev) => {
          const next = new Set(prev);
          next.delete(template.id);
          return next;
        });
      }
    } catch (err) {
      setError(describeSaveError(err));
    }
  }

  async function handleSaveForm() {
    if (!form) return;
    const name = form.name.trim();
    const content = form.content.trim();
    if (name === '' || content === '') {
      setError('Nhập đủ tên mẫu và nội dung lời dặn.');
      return;
    }
    setError(null);
    try {
      if (form.id) await updateMutation.mutateAsync({ id: form.id, body: { name, content, version: form.version } });
      else await createMutation.mutateAsync({ name, content });
      setForm(null);
    } catch (err) {
      setError(describeSaveError(err));
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Mẫu lời dặn">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader icon={FileText} title="Mẫu lời dặn" subtitle={form ? (form.id ? 'Sửa mẫu' : 'Thêm mẫu mới') : 'Chọn mẫu để chèn vào lời dặn'} onClose={onClose} />

        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} />
          </div>
        )}

        {form ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveForm();
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="scroll-hover min-h-0 flex-1 space-y-3 overflow-y-auto">
              <div>
                <label htmlFor="advice-template-name" className="mb-1 block text-sm font-semibold text-slate-800">
                  Tên mẫu <span className="text-rose-500">*</span>
                </label>
                <input
                  id="advice-template-name"
                  autoFocus
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ví dụ: Viêm đường hô hấp"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <Textarea
                id="advice-template-content"
                label="Nội dung lời dặn"
                required
                rows={6}
                maxLength={2000}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Nội dung sẽ tự điền vào ô Lời dặn bác sĩ"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setForm(null);
                  setError(null);
                }}
              >
                Huỷ
              </Button>
              <Button type="submit" loading={saving} disabled={form.name.trim() === '' || form.content.trim() === ''}>
                {form.id ? 'Lưu thay đổi' : 'Lưu mẫu'}
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleInsert();
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="relative mb-3">
              <MagnifyingGlass size={15} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                // Enter ở ô tìm chỉ để lọc, không được chèn mẫu (Enter chèn khi focus ở nút/ô tích — ui-guidelines mục 4.4).
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
                placeholder="Tìm mẫu theo tên hoặc nội dung…"
                aria-label="Tìm mẫu lời dặn"
                className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="scroll-hover min-h-0 flex-1 space-y-2 overflow-y-auto">
              {query.isPending && (
                <>
                  <Skeleton className="h-16 w-full rounded-md" />
                  <Skeleton className="h-16 w-full rounded-md" />
                </>
              )}
              {query.isError && <ErrorBanner message="Không tải được danh sách mẫu lời dặn." onRetry={() => void query.refetch()} />}
              {query.isSuccess && items.length === 0 && (
                <EmptyState
                  icon={FileText}
                  title="Chưa có mẫu lời dặn nào"
                  description={canManage ? 'Bấm "Thêm mẫu mới" để lưu sẵn những lời dặn hay dùng, lần sau chỉ cần chọn.' : 'Nhờ bác sĩ hoặc quản lý phòng khám thêm mẫu lời dặn.'}
                />
              )}
              {query.isSuccess && items.length > 0 && visible.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Không có mẫu nào khớp.</p>}
              {visible.map((t) => {
                const isPicked = picked.has(t.id) && t.isActive;
                return (
                  <div
                    key={t.id}
                    className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-md border px-3 py-2.5 ${
                      isPicked ? 'border-brand-teal bg-brand-teal-tint' : 'border-slate-300 bg-white hover:border-blue-400'
                    } ${t.isActive ? '' : 'opacity-70'}`}
                  >
                    <span className="mt-0.5">
                      {t.isActive ? (
                        <SelectionCheckbox checked={isPicked} onChange={() => toggle(t.id)} ariaLabel={`Chọn mẫu ${t.name}`} />
                      ) : (
                        <span className="inline-block h-4 w-4" aria-hidden="true" />
                      )}
                    </span>
                    <button type="button" onClick={() => t.isActive && toggle(t.id)} className={`min-w-0 text-left ${t.isActive ? 'cursor-pointer' : 'cursor-default'}`} tabIndex={-1}>
                      <span className="block text-sm font-bold text-slate-900">
                        {t.name}
                        {!t.isActive && <span className="ml-2 rounded-full bg-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Đã ẩn</span>}
                      </span>
                      <span className="mt-0.5 block whitespace-pre-line text-[13px] text-slate-700">{t.content}</span>
                    </button>
                    {canManage && (
                      <span className="flex flex-none gap-1">
                        {t.isActive && (
                          <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setForm({ id: t.id, version: t.version, name: t.name, content: t.content })}>
                            Sửa
                          </Button>
                        )}
                        <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" loading={updateMutation.isPending && updateMutation.variables?.id === t.id} onClick={() => void handleToggleActive(t)}>
                          {t.isActive ? 'Ẩn' : 'Hiện lại'}
                        </Button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              {canManage && (
                <>
                  <Button
                    type="button"
                    variant="add"
                    onClick={() => {
                      setError(null);
                      setForm({ id: null, version: 1, name: '', content: '' });
                    }}
                  >
                    <Plus size={14} weight="bold" aria-hidden="true" />
                    Thêm mẫu mới
                  </Button>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                    <SelectionCheckbox checked={showHidden} onChange={() => setShowHidden((v) => !v)} ariaLabel="Hiện cả mẫu đã ẩn" />
                    Hiện cả mẫu đã ẩn
                  </label>
                </>
              )}
              <span className="flex-1" />
              <Button type="button" variant="secondary" onClick={onClose}>
                Đóng
              </Button>
              <Button type="submit" disabled={pickedInOrder.length === 0}>
                Chèn vào lời dặn{pickedInOrder.length > 0 ? ` (${pickedInOrder.length})` : ''}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
