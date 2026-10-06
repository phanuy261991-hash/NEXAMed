import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Sparkle } from '@phosphor-icons/react';
import type { PrintDocumentType, PrintPaperSize, PrintTemplate, PrintTemplateConfig } from '@nexamed/shared';
import { describeSaveError } from '../../shared/api/save-error';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import {
  useCreatePrintTemplateMutation,
  useDeletePrintTemplateMutation,
  usePrintTemplatesQuery,
  useQuickSetupPrintTemplatesMutation,
  useUpdatePrintTemplateMutation,
} from '../../shared/print/print-template.queries';
import { ActionMenu } from '../../shared/ui/ActionMenu';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { AddPrintTemplateDialog } from './AddPrintTemplateDialog';
import { PrintDocumentList } from './PrintDocumentList';
import { PrintTemplateConfigPanel } from './PrintTemplateConfigPanel';
import { PrintTemplatePreviewPanel } from './PrintTemplatePreviewPanel';
import { QuickSetupDialog } from './QuickSetupDialog';
import { PAPER_SHORT_LABEL } from './print-template-labels';

interface Draft {
  key: string;
  name: string;
  config: PrintTemplateConfig;
}

function templateKey(t: PrintTemplate): string {
  return `${t.documentType}|${t.paperSize}|${t.id ?? 'builtin'}|${t.version ?? 0}`;
}

/**
 * "Quản lý mẫu in" (docs/DECISIONS.md #211, mockup chủ dự án duyệt 01/10/2026) — trang riêng trong Quản trị, 3 vùng:
 * loại chứng từ (trái) · cấu hình bản mẫu (giữa) · xem trước đúng khổ giấy bằng dữ liệu mẫu (phải). Mỗi chứng từ có
 * nhiều bản mẫu theo khổ giấy, 1 bản mặc định; chưa lưu gì thì dùng bản dựng sẵn nên in được ngay. Soạn là NHÁP tại chỗ
 * (xem trước cập nhật tức thì), chỉ ghi khi bấm Lưu.
 */
export function PrintTemplatePage() {
  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Mẫu in' }]);

  const query = usePrintTemplatesQuery();
  const createMutation = useCreatePrintTemplateMutation();
  const updateMutation = useUpdatePrintTemplateMutation();
  const deleteMutation = useDeletePrintTemplateMutation();
  const quickSetupMutation = useQuickSetupPrintTemplatesMutation();

  const [selectedType, setSelectedType] = useState<PrintDocumentType>('PRESCRIPTION');
  const [selectedPaper, setSelectedPaper] = useState<PrintPaperSize | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const catalog = query.data?.catalog;
  const typesInfo = catalog?.documentTypes ?? [];
  const typeInfo = typesInfo.find((d) => d.documentType === selectedType);
  const ofType = useMemo(() => items.filter((i) => i.documentType === selectedType), [items, selectedType]);
  const current = ofType.find((t) => t.paperSize === selectedPaper) ?? ofType.find((t) => t.isDefault) ?? ofType[0] ?? null;
  const currentKey = current ? templateKey(current) : null;
  const paper = catalog?.papers.find((p) => p.paperSize === current?.paperSize);

  // Nháp theo bản mẫu đang xem: đổi bản mẫu (hoặc dữ liệu server đổi version) thì nạp lại nháp từ bản đã lưu.
  useEffect(() => {
    setDraft(current && currentKey ? { key: currentKey, name: current.name, config: current.config } : null);
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ nạp lại khi khoá bản mẫu đổi, không theo từng lần `items` đổi tham chiếu
  }, [currentKey]);

  const effective = draft && draft.key === currentKey ? draft : current && currentKey ? { key: currentKey, name: current.name, config: current.config } : null;
  const dirty = !!current && !!effective && (effective.name !== current.name || JSON.stringify(effective.config) !== JSON.stringify(current.config));
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  useEffect(() => {
    // Đổi chứng từ → quay về bản mặc định của chứng từ đó.
    setSelectedPaper(null);
  }, [selectedType]);

  async function handleSave() {
    if (!current || !effective) return;
    setSaveError(null);
    try {
      if (current.id === null) {
        await createMutation.mutateAsync({ documentType: current.documentType, name: effective.name.trim() || current.name, paperSize: current.paperSize, config: effective.config, isDefault: true });
      } else {
        await updateMutation.mutateAsync({ id: current.id, body: { name: effective.name.trim() || current.name, config: effective.config, version: current.version ?? 1 } });
      }
    } catch (err) {
      setSaveError(describeSaveError(err));
    }
  }

  async function handleSetDefault() {
    if (!current || current.id === null) return;
    setSaveError(null);
    try {
      await updateMutation.mutateAsync({ id: current.id, body: { isDefault: true, version: current.version ?? 1 } });
    } catch (err) {
      setSaveError(describeSaveError(err));
    }
  }

  async function handleDelete() {
    if (!current || current.id === null) return;
    setSaveError(null);
    try {
      await deleteMutation.mutateAsync({ id: current.id, body: { version: current.version ?? 1 } });
      setDeleteOpen(false);
      setSelectedPaper(null);
    } catch (err) {
      setDeleteOpen(false);
      setSaveError(describeSaveError(err));
    }
  }

  function handleRestoreDefaults() {
    if (!current || !catalog || !effective) return;
    const defaults = catalog.defaultConfigs[current.paperSize];
    if (defaults) setDraft({ key: effective.key, name: effective.name, config: defaults });
  }

  const menuItems = [
    ...(current && current.id !== null && !current.isDefault ? [{ key: 'default', label: 'Đặt làm bản mặc định', onClick: () => void handleSetDefault() }] : []),
    ...(current && current.id !== null ? [{ key: 'delete', label: 'Xoá bản mẫu', danger: true, onClick: () => setDeleteOpen(true) }] : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-start justify-between gap-4 px-5 pt-3.5">
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold text-slate-900">Mẫu in</h1>
          <p className="mt-0.5 text-[12.5px] text-slate-500">Mọi chứng từ đã có bản mẫu dùng được ngay. Chỉ chỉnh khi phòng khám cần khổ giấy hoặc bố cục khác.</p>
        </div>
        <Button type="button" onClick={() => setQuickOpen(true)} disabled={!catalog}>
          <Sparkle size={15} weight="bold" aria-hidden="true" />
          Thiết lập nhanh
        </Button>
      </div>

      {query.isError && (
        <div className="px-5 pt-3">
          <ErrorBanner message="Không tải được danh sách mẫu in." onRetry={() => query.refetch()} />
        </div>
      )}

      {query.isLoading && (
        <div className="flex flex-1 gap-3.5 px-5 pb-5 pt-3.5">
          <Skeleton className="h-full w-[274px]" />
          <Skeleton className="h-full w-[380px]" />
          <Skeleton className="h-full flex-1" />
        </div>
      )}

      {catalog && (
        <div className="flex min-h-0 flex-1 gap-3.5 px-5 pb-5 pt-3.5">
          <PrintDocumentList documentTypes={typesInfo} templates={items} selected={selectedType} onSelect={setSelectedType} />

          <section className="flex w-[380px] flex-shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Cấu hình bản mẫu">
            <div className="border-b border-slate-100 px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="min-w-0 truncate text-[15px] font-bold text-slate-900">{typeInfo?.label}</h2>
                <Button type="button" variant="secondary" className="h-8 px-2.5 text-xs" onClick={() => setAddOpen(true)}>
                  <Plus size={13} weight="bold" aria-hidden="true" />
                  Thêm bản mẫu
                </Button>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {ofType.map((t) => {
                    const active = t.paperSize === current?.paperSize;
                    return (
                      <button
                        key={t.paperSize}
                        type="button"
                        onClick={() => setSelectedPaper(t.paperSize)}
                        aria-pressed={active}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ${
                          active ? 'bg-brand-teal text-white' : 'border border-slate-300 text-slate-600 hover:border-blue-400 hover:bg-brand-teal-tint'
                        }`}
                      >
                        {t.isDefault && <Check size={12} weight="bold" aria-hidden="true" />}
                        {PAPER_SHORT_LABEL[t.paperSize]}
                        {t.isDefault && ' — Mặc định'}
                      </button>
                    );
                  })}
                </div>
                {menuItems.length > 0 && <ActionMenu label="Khác" items={menuItems} />}
              </div>
            </div>

            <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
              {saveError && <ErrorBanner message={saveError} />}
              {current && effective && paper && typeInfo && (
                <PrintTemplateConfigPanel
                  name={effective.name}
                  onNameChange={(name) => setDraft({ key: effective.key, name, config: effective.config })}
                  paper={paper}
                  config={effective.config}
                  onConfigChange={(config) => setDraft({ key: effective.key, name: effective.name, config })}
                  defaultTitle={typeInfo.defaultTitle}
                  disabled={busy}
                />
              )}
            </div>

            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <Button type="button" variant="secondary" onClick={handleRestoreDefaults} disabled={busy || !current}>
                Khôi phục mặc định
              </Button>
              <Button type="button" onClick={() => void handleSave()} loading={createMutation.isPending || updateMutation.isPending} disabled={!dirty && current?.id !== null}>
                Lưu
              </Button>
            </div>
          </section>

          {current && effective && paper && <PrintTemplatePreviewPanel documentType={selectedType} paper={paper} config={effective.config} />}
        </div>
      )}

      {quickOpen && catalog && (
        <QuickSetupDialog
          documentTypes={typesInfo}
          initialHeader={catalog.defaultConfigs.A4?.header ?? items[0]!.config.header}
          submitting={quickSetupMutation.isPending}
          error={dialogError}
          onCancel={() => {
            setQuickOpen(false);
            setDialogError(null);
          }}
          onSubmit={(dto) => {
            setDialogError(null);
            quickSetupMutation.mutate(dto, {
              onSuccess: () => {
                setQuickOpen(false);
                setSelectedPaper(null);
              },
              onError: (err) => setDialogError(describeSaveError(err)),
            });
          }}
        />
      )}

      {addOpen && catalog && typeInfo && (
        <AddPrintTemplateDialog
          documentType={typeInfo}
          papers={catalog.papers}
          existing={ofType}
          baseTemplate={current}
          submitting={createMutation.isPending}
          error={dialogError}
          onCancel={() => {
            setAddOpen(false);
            setDialogError(null);
          }}
          onSubmit={(dto) => {
            setDialogError(null);
            createMutation.mutate(dto, {
              onSuccess: (created) => {
                setAddOpen(false);
                setSelectedPaper(created.paperSize);
              },
              onError: (err) => setDialogError(describeSaveError(err)),
            });
          }}
        />
      )}

      {deleteOpen && current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="alertdialog" aria-modal="true" aria-label="Xác nhận xoá bản mẫu">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Xoá bản mẫu &quot;{current.name}&quot;?</h3>
            <p className="mt-1.5 text-sm text-slate-600">Chứng từ sẽ in theo các bản mẫu còn lại (hoặc bản dựng sẵn nếu đây là bản cuối). Không ảnh hưởng chứng từ đã in.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>
                Huỷ
              </Button>
              <Button type="button" variant="danger" loading={deleteMutation.isPending} onClick={() => void handleDelete()}>
                Xoá
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
