import { useState } from 'react';
import { ArrowCounterClockwise, MagnifyingGlass, PencilSimple, Plus, Prohibit, Stack, X } from '@phosphor-icons/react';
import type { PrescriptionTemplate, PrescriptionTemplateItem } from '@nexamed/shared';
import { computePrescriptionQuantityPreview as computePrescriptionQuantity } from '../encounter/prescription-dose-preview';
import { ApiError } from '../../shared/api/client';
import { useHasPermission } from '../auth/usePermission';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { useUnitNameByCode, unitLabel } from './useUnitNameByCode';
import { DrugPicker } from '../encounter/DrugPicker';
import { LineInput } from '../encounter/PrescriptionPanel';
import { useCreatePrescriptionTemplateMutation, usePrescriptionTemplatesQuery, useUpdatePrescriptionTemplateMutation } from './prescription-template.queries';

interface TemplateDraftLine {
  key: string;
  drugId: string;
  drugName: string;
  unitCode: string | null;
  doseMorning: string;
  doseNoon: string;
  doseAfternoon: string;
  doseEvening: string;
  durationDays: string;
  instruction: string;
}

function itemToDraft(item: PrescriptionTemplateItem): TemplateDraftLine {
  return {
    key: item.id,
    drugId: item.drugId,
    drugName: item.drugName,
    unitCode: item.unitCode,
    doseMorning: String(item.doseMorning),
    doseNoon: String(item.doseNoon),
    doseAfternoon: String(item.doseAfternoon),
    doseEvening: String(item.doseEvening),
    durationDays: String(item.durationDays),
    instruction: item.instruction ?? '',
  };
}

function draftLineTotal(line: TemplateDraftLine): number {
  return computePrescriptionQuantity(
    { doseMorning: Number(line.doseMorning) || 0, doseNoon: Number(line.doseNoon) || 0, doseAfternoon: Number(line.doseAfternoon) || 0, doseEvening: Number(line.doseEvening) || 0 },
    Number(line.durationDays) || 0,
  );
}

interface ModalState {
  mode: 'create' | 'edit';
  item?: PrescriptionTemplate;
}

/**
 * "Đơn thuốc mẫu" — trang quản lý ĐẦY ĐỦ trong Quản trị (docs/DECISIONS.md #196, mockup đã duyệt),
 * chốt qua `AskUserQuestion`: trước đây CHỈ sửa/lưu được từ NGAY TRONG popup lúc đang kê đơn cho 1
 * bệnh nhân cụ thể (`PrescriptionTemplateModal` ở `PrescriptionPanel.tsx`) — không có nơi xem/sửa/
 * ẩn toàn bộ mẫu ngoài lúc đó. Trang này dùng LẠI đúng API (`prescription-template.queries.ts`) và
 * đúng khuôn liều theo buổi (`LineInput`/`DrugPicker` export từ `PrescriptionPanel.tsx`/
 * `DrugPicker.tsx`) — không viết lại logic tính tổng số lượng/đơn vị nhỏ nhất.
 */
export function PrescriptionTemplatePane() {
  const canManage = useHasPermission('prescription_template', 'manage');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<PrescriptionTemplate | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = usePrescriptionTemplatesQuery(includeInactive);
  const createMutation = useCreatePrescriptionTemplateMutation();
  const updateMutation = useUpdatePrescriptionTemplateMutation();

  const q = search.trim().toLowerCase();
  const items = (query.data?.items ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));

  function errorMessage(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.';
  }

  function handleDeactivate(item: PrescriptionTemplate) {
    setActionError(null);
    updateMutation.mutate(
      { id: item.id, body: { isActive: false, version: item.version } },
      { onSuccess: () => setDeactivateTarget(null), onError: (err) => setActionError(errorMessage(err)) },
    );
  }

  function handleReactivate(item: PrescriptionTemplate) {
    setActionError(null);
    updateMutation.mutate({ id: item.id, body: { isActive: true, version: item.version } }, { onError: (err) => setActionError(errorMessage(err)) });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-72">
            <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tên mẫu..."
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Hiện cả mẫu đã ẩn
          </label>
        </div>
        {canManage && (
          <Button type="button" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Thêm mẫu mới
          </Button>
        )}
      </div>

      {actionError && <ErrorBanner message={actionError} />}
      {query.isError && <ErrorBanner message="Không tải được danh sách đơn thuốc mẫu." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={Stack} title="Chưa có đơn thuốc mẫu nào" description="Thêm mẫu để dùng lại nhanh lúc kê đơn." />
      )}

      {query.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="scroll-hover h-full overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="px-4 py-2.5 text-left">Tên mẫu</th>
                  <th className="w-28 px-4 py-2.5 text-center">Số thuốc</th>
                  <th className="w-32 px-4 py-2.5 text-center">Trạng thái</th>
                  <th className="w-28 px-4 py-2.5 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className={`border-b border-slate-200 last:border-0 ${t.isActive ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">{t.name}</td>
                    <td className="px-4 py-2 text-center text-slate-600">{t.items.length}</td>
                    <td className="px-4 py-2 text-center">
                      <StatusBadge tone={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Đang dùng' : 'Đã ẩn'}</StatusBadge>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {canManage && (
                        <div className="flex flex-nowrap items-center justify-center gap-1.5">
                          <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => setModal({ mode: 'edit', item: t })} />
                          {t.isActive ? (
                            <RowActionButton icon={Prohibit} label="Ẩn" tone="danger" onClick={() => setDeactivateTarget(t)} />
                          ) : (
                            <RowActionButton icon={ArrowCounterClockwise} label="Kích hoạt lại" tone="primary" onClick={() => handleReactivate(t)} />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <PrescriptionTemplateFormDialog
          mode={modal.mode}
          template={modal.item}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={async (dto) => {
            if (modal.mode === 'create') {
              await createMutation.mutateAsync(dto);
            } else if (modal.item) {
              await updateMutation.mutateAsync({ id: modal.item.id, body: { ...dto, version: modal.item.version } });
            }
          }}
        />
      )}

      {deactivateTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-slate-900">Ẩn đơn thuốc mẫu &quot;{deactivateTarget.name}&quot;?</p>
            <p className="mt-1.5 text-xs text-slate-500">Sẽ không chọn được mẫu này ở popup &quot;Đơn mẫu&quot; lúc kê đơn nữa. Có thể kích hoạt lại sau.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeactivateTarget(null)}>
                Huỷ
              </Button>
              <Button type="button" variant="danger" loading={updateMutation.isPending} onClick={() => handleDeactivate(deactivateTarget)}>
                Ẩn
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PrescriptionTemplateFormDialog({
  mode,
  template,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  template?: PrescriptionTemplate;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: {
    name: string;
    items: { drugId: string; doseMorning: number; doseNoon: number; doseAfternoon: number; doseEvening: number; durationDays: number; instruction?: string }[];
  }) => Promise<void>;
}) {
  const unitNameByCode = useUnitNameByCode();
  const [name, setName] = useState(template?.name ?? '');
  const [lines, setLines] = useState<TemplateDraftLine[]>((template?.items ?? []).map(itemToDraft));
  const [formError, setFormError] = useState<string | null>(null);

  function updateLine(key: string, patch: Partial<TemplateDraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim() === '') {
      setFormError('Phải nhập tên mẫu.');
      return;
    }
    if (lines.length === 0) {
      setFormError('Phải có ít nhất 1 dòng thuốc.');
      return;
    }
    for (const l of lines) {
      const total = (Number(l.doseMorning) || 0) + (Number(l.doseNoon) || 0) + (Number(l.doseAfternoon) || 0) + (Number(l.doseEvening) || 0);
      if (total <= 0) {
        setFormError(`Dòng "${l.drugName}" phải nhập liều dùng ít nhất 1 buổi trong ngày.`);
        return;
      }
    }
    setFormError(null);
    await onSubmit({
      name: name.trim(),
      items: lines.map((l) => ({
        drugId: l.drugId,
        doseMorning: Number(l.doseMorning) || 0,
        doseNoon: Number(l.doseNoon) || 0,
        doseAfternoon: Number(l.doseAfternoon) || 0,
        doseEvening: Number(l.doseEvening) || 0,
        durationDays: Math.max(1, Number(l.durationDays) || 1),
        instruction: l.instruction.trim() || undefined,
      })),
    });
    onCancel();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader icon={Stack} title={mode === 'create' ? 'Thêm đơn thuốc mẫu' : 'Sửa đơn thuốc mẫu'} onClose={onCancel} />

        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor="template-form-name" className="text-sm font-semibold text-slate-800">
            Tên mẫu
          </label>
          <input
            id="template-form-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Phác đồ viêm hô hấp trên"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div className="scroll-hover mt-3 flex-1 space-y-2 overflow-y-auto">
          {lines.map((line) => (
            <div key={line.key} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-900">{line.drugName}</p>
                <button type="button" onClick={() => removeLine(line.key)} className="text-slate-400 hover:text-rose-600" aria-label={`Xoá ${line.drugName}`}>
                  <X size={15} weight="bold" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-4">
                <div className="w-14">
                  <LineInput dense label="Sáng" type="number" value={line.doseMorning} onChange={(v) => updateLine(line.key, { doseMorning: v })} />
                </div>
                <div className="w-14">
                  <LineInput dense label="Trưa" type="number" value={line.doseNoon} onChange={(v) => updateLine(line.key, { doseNoon: v })} />
                </div>
                <div className="w-14">
                  <LineInput dense label="Chiều" type="number" value={line.doseAfternoon} onChange={(v) => updateLine(line.key, { doseAfternoon: v })} />
                </div>
                <div className="w-14">
                  <LineInput dense label="Tối" type="number" value={line.doseEvening} onChange={(v) => updateLine(line.key, { doseEvening: v })} />
                </div>
                <span className="pb-1.5 text-lg font-bold text-slate-300">×</span>
                <div className="w-16">
                  <LineInput dense label="Số ngày" type="number" value={line.durationDays} onChange={(v) => updateLine(line.key, { durationDays: v })} />
                </div>
                <span className="pb-1.5 text-lg font-bold text-slate-300">=</span>
                <div className="rounded-md bg-brand-teal-tint px-3 py-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tổng số</div>
                  <div className="text-[15px] font-bold text-blue-700">
                    {draftLineTotal(line)} {line.unitCode ? unitLabel(unitNameByCode, line.unitCode) : ''}
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <LineInput label="Hướng dẫn dùng" underline value={line.instruction} onChange={(v) => updateLine(line.key, { instruction: v })} />
              </div>
            </div>
          ))}
          <DrugPicker
            excludeDrugIds={lines.map((l) => l.drugId)}
            disableFreeText
            onSelect={(drug) =>
              setLines((prev) => [
                ...prev,
                { key: crypto.randomUUID(), drugId: drug.drugId, drugName: drug.drugName, unitCode: drug.unitCode, doseMorning: '', doseNoon: '', doseAfternoon: '', doseEvening: '', durationDays: '5', instruction: '' },
              ])
            }
            onAddFreeText={() => {}}
          />
        </div>

        {formError && <p className="mt-3 text-sm font-medium text-rose-600">{formError}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
