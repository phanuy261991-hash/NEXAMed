import { useMemo, useState } from 'react';
import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import type { ResultTemplateItem, TechnicalServiceItem } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RecordFormNotice } from '../../shared/ui/RecordFormNotice';
import { Skeleton } from '../../shared/ui/Skeleton';
import { Textarea } from '../../shared/ui/Textarea';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';
import { useHasPermission } from '../auth/usePermission';
import { TECHNICAL_SERVICE_KIND_LABELS } from './paraclinical-labels';
import {
  useCreateResultTemplateMutation,
  useResultTemplatesQuery,
  useTechnicalServicesQuery,
  useUpdateResultTemplateMutation,
} from './paraclinical.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50';

type TemplateSelection = { kind: 'none' } | { kind: 'new' } | { kind: 'existing'; id: string };

/**
 * Pill "Mẫu kết quả" (Cận lâm sàng GĐ1, docs/DECISIONS.md #212, mockup màn 3b) — 3 cột: dịch vụ | mẫu của dịch vụ | soạn
 * mẫu. Mẫu dùng CHUNG toàn phòng khám (đúng khuôn "Đơn thuốc mẫu"), chỉ chứa lời Mô tả/Kết luận — KHÔNG điền giá trị chỉ
 * số, và chèn vào phiếu xong vẫn sửa được tự do.
 */
export function ResultTemplatePane() {
  const canManage = useHasPermission('result_template', 'manage');
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim(), 300);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [selection, setSelection] = useState<TemplateSelection>({ kind: 'none' });

  const servicesQuery = useTechnicalServicesQuery({ search: search === '' ? undefined : search, inHouse: true, includeInactive: false });
  const templatesQuery = useResultTemplatesQuery({ includeInactive: true });
  const services = servicesQuery.data?.items ?? [];
  const allTemplates = useMemo(() => templatesQuery.data?.items ?? [], [templatesQuery.data]);

  const countByService = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of allTemplates) if (t.isActive) map.set(t.technicalServiceId, (map.get(t.technicalServiceId) ?? 0) + 1);
    return map;
  }, [allTemplates]);

  const selectedService = services.find((s) => s.id === serviceId) ?? null;
  const serviceTemplates = allTemplates.filter((t) => t.technicalServiceId === serviceId);
  const selectedTemplate = selection.kind === 'existing' ? (serviceTemplates.find((t) => t.id === selection.id) ?? null) : null;

  return (
    <div className="flex h-full min-h-0 gap-3.5 px-6 pb-5 pt-3.5">
      <section className="flex w-[274px] flex-shrink-0 flex-col gap-2.5" aria-label="Dịch vụ kỹ thuật">
        <div className="relative">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            aria-label="Tìm dịch vụ"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Tìm dịch vụ…"
            className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        {servicesQuery.isError && <ErrorBanner message="Không tải được danh sách dịch vụ." onRetry={() => servicesQuery.refetch()} />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-800">Dịch vụ kỹ thuật</div>
          <div className="scroll-hover min-h-0 flex-1 overflow-y-auto">
            {servicesQuery.isLoading && (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
            {!servicesQuery.isLoading && services.length === 0 && <p className="px-4 py-8 text-center text-sm italic text-slate-400">Chưa có dịch vụ nào</p>}
            {services.map((s) => (
              <ServiceButton
                key={s.id}
                service={s}
                active={s.id === serviceId}
                count={countByService.get(s.id) ?? 0}
                onClick={() => {
                  setServiceId(s.id);
                  setSelection({ kind: 'none' });
                }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="flex w-[286px] flex-shrink-0 flex-col gap-2.5" aria-label="Mẫu của dịch vụ">
        {canManage && (
          <Button type="button" disabled={!selectedService} onClick={() => setSelection({ kind: 'new' })}>
            <Plus size={15} weight="bold" aria-hidden="true" />
            Thêm mẫu cho dịch vụ này
          </Button>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex-shrink-0 truncate border-b-2 border-blue-600 bg-slate-100 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-800">
            {selectedService ? `Mẫu của ${selectedService.name}` : 'Mẫu của dịch vụ'}
          </div>
          <div className="scroll-hover min-h-0 flex-1 overflow-y-auto">
            {!selectedService && <p className="px-4 py-8 text-center text-sm italic text-slate-400">Chọn một dịch vụ ở cột bên trái</p>}
            {selectedService && serviceTemplates.length === 0 && <p className="px-4 py-8 text-center text-sm italic text-slate-400">Dịch vụ này chưa có mẫu nào</p>}
            {serviceTemplates.map((t) => {
              const active = selection.kind === 'existing' && selection.id === t.id;
              const preview = t.conclusionText ?? t.descriptionText ?? '';
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelection({ kind: 'existing', id: t.id })}
                  className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left ${active ? 'bg-blue-50' : 'hover:bg-slate-50'} ${t.isActive ? '' : 'opacity-50'}`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`min-w-0 truncate text-[13px] ${active ? 'font-bold text-blue-700' : 'font-medium text-slate-900'}`}>{t.name}</span>
                    {t.isDefault && <span className="flex-shrink-0 rounded-md bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">Mặc định</span>}
                    {!t.isActive && <span className="flex-shrink-0 rounded-md bg-slate-300 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">Đã ẩn</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-slate-400">{preview}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Soạn mẫu kết quả">
        {(selection.kind === 'none' || !selectedService) && (
          <div className="p-6">
            <EmptyState icon={MagnifyingGlass} title="Chọn hoặc tạo một mẫu" description="Chọn dịch vụ rồi chọn một mẫu để xem/sửa, hoặc bấm “Thêm mẫu cho dịch vụ này”." />
          </div>
        )}
        {selection.kind === 'new' && selectedService && (
          <TemplateEditor key={`new-${selectedService.id}`} service={selectedService} template={null} canManage={canManage} onSaved={(t) => setSelection({ kind: 'existing', id: t.id })} />
        )}
        {selection.kind === 'existing' && selectedService && selectedTemplate && (
          <TemplateEditor
            key={`${selectedTemplate.id}-${selectedTemplate.version}`}
            service={selectedService}
            template={selectedTemplate}
            canManage={canManage}
            onSaved={(t) => setSelection({ kind: 'existing', id: t.id })}
          />
        )}
      </section>
    </div>
  );
}

function ServiceButton({ service, active, count, onClick }: { service: TechnicalServiceItem; active: boolean; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 text-left ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
    >
      <span className="min-w-0">
        <span className={`block truncate text-[13px] ${active ? 'font-bold text-blue-700' : 'font-medium text-slate-900'}`}>{service.name}</span>
        <span className="block text-[11px] text-slate-400">
          {service.code} · {TECHNICAL_SERVICE_KIND_LABELS[service.serviceKind]}
        </span>
      </span>
      <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold ${count === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
    </button>
  );
}

function TemplateEditor({
  service,
  template,
  canManage,
  onSaved,
}: {
  service: TechnicalServiceItem;
  template: ResultTemplateItem | null;
  canManage: boolean;
  onSaved: (template: ResultTemplateItem) => void;
}) {
  const { saveError, run } = useSaveAttempt();
  const createMutation = useCreateResultTemplateMutation();
  const updateMutation = useUpdateResultTemplateMutation();
  const submitting = createMutation.isPending || updateMutation.isPending;

  // Xét nghiệm chỉ có một ô "Nhận xét / Kết luận" (kết quả đi theo chỉ số); CĐHA/thăm dò có thêm "Mô tả hình ảnh".
  const hasDescription = service.serviceKind !== 'LAB';
  const [name, setName] = useState(template?.name ?? '');
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [description, setDescription] = useState(template?.descriptionText ?? '');
  const [conclusion, setConclusion] = useState(template?.conclusionText ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const invalid = name.trim() === '';

  async function save(patch?: { isActive?: boolean }) {
    if (!canManage || invalid) return;
    setFormError(null);
    if (description.trim() === '' && conclusion.trim() === '') {
      setFormError(hasDescription ? 'Mẫu phải có Mô tả hoặc Kết luận.' : 'Mẫu phải có nội dung Nhận xét / Kết luận.');
      return;
    }
    let saved: ResultTemplateItem | null = null;
    const ok = await run(async () => {
      if (template === null) {
        saved = await createMutation.mutateAsync({
          technicalServiceId: service.id,
          name: name.trim(),
          isDefault,
          isActive: true,
          ...(description.trim() ? { descriptionText: description } : {}),
          ...(conclusion.trim() ? { conclusionText: conclusion } : {}),
        });
      } else {
        saved = await updateMutation.mutateAsync({
          id: template.id,
          body: {
            version: template.version,
            name: name.trim(),
            isDefault,
            descriptionText: description.trim() ? description : null,
            conclusionText: conclusion.trim() ? conclusion : null,
            ...(patch?.isActive !== undefined ? { isActive: patch.isActive } : {}),
          },
        });
      }
    });
    if (ok && saved) onSaved(saved);
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[15.5px] font-bold text-slate-900">{template ? template.name : 'Mẫu mới'}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {service.name} ({service.code}) · dùng chung toàn phòng khám
          </p>
        </div>
        {canManage && (
          <div className="flex flex-shrink-0 gap-2">
            {template && (
              <Button type="button" variant="dangerGhost" disabled={submitting} onClick={() => void save({ isActive: !template.isActive })}>
                {template.isActive ? 'Xoá mẫu' : 'Khôi phục mẫu'}
              </Button>
            )}
            <Button type="submit" loading={submitting} disabled={invalid}>
              Lưu mẫu
            </Button>
          </div>
        )}
      </div>

      <fieldset disabled={!canManage} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto border-0 p-4">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rt-name" className="text-sm font-semibold text-slate-800">
              Tên mẫu <span className="text-rose-500">*</span>
            </label>
            <input id="rt-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
          </div>
          <label className="flex h-[42px] cursor-pointer items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
            <span className="text-[13px] font-semibold text-emerald-900">Tự điền sẵn khi mở phiếu kết quả</span>
          </label>
        </div>

        {hasDescription && <Textarea id="rt-desc" label="Mô tả hình ảnh" rows={10} value={description} onChange={(e) => setDescription(e.target.value)} className="font-medium leading-relaxed" />}
        <Textarea
          id="rt-concl"
          label={hasDescription ? 'Kết luận' : 'Nhận xét / Kết luận'}
          rows={hasDescription ? 3 : 8}
          value={conclusion}
          onChange={(e) => setConclusion(e.target.value)}
        />

        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-3">
          <p className="mb-1.5 text-[12.5px] font-bold text-blue-900">Hai điều mẫu KHÔNG làm</p>
          <p className="mb-1 text-[12.5px] text-blue-800">
            <strong>Không khoá nội dung.</strong> Mẫu chỉ điền sẵn chữ vào ô để khỏi gõ lại; người thực hiện sửa thoải mái theo đúng tình trạng thật của người bệnh. Sửa trên phiếu không đụng tới mẫu gốc.
          </p>
          <p className="text-[12.5px] text-blue-800">
            <strong>Không điền giá trị chỉ số.</strong> Với xét nghiệm, mẫu chỉ áp cho lời <em>Nhận xét / Kết luận</em>. Từng thông số (HGB, WBC, Glucose…) luôn nhập tay theo kết quả thật của từng người bệnh.
          </p>
        </div>

        {formError && (
          <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
            {formError}
          </div>
        )}
        <RecordFormNotice saveError={saveError} />
      </fieldset>
    </form>
  );
}
