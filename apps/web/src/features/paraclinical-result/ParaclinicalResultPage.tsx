import { useMemo, useState } from 'react';
import { CheckCircle, Plus, Trash, Warning } from '@phosphor-icons/react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ParaclinicalResultForm, ParaclinicalResultSection, SaveParaclinicalResultRequest } from '@nexamed/shared';
import { ApiError, resolveApiUrl } from '../../shared/api/client';
import { formatClockTime } from '../../shared/format/time';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { PrintButton } from '../../shared/print/PrintButton';
import { Textarea } from '../../shared/ui/Textarea';
import { TimeInput } from '../../shared/ui/TimeInput';
import { useHasPermission } from '../auth/usePermission';
import { useResultTemplatesQuery } from '../paraclinical/paraclinical.queries';
import { formatDateTimeVn, genderShort, previewFlag, RESULT_STATUS_META, SERVICE_KIND_LABELS } from './paraclinical-result-labels';
import { ParaclinicalResultPrintView } from './ParaclinicalResultPrintView';
import { useApproveParaclinicalResultMutation, useParaclinicalImageMutations, useParaclinicalResultQuery, usePrintParaclinicalResultMutation, useSaveParaclinicalResultMutation } from './paraclinical-result.queries';

interface SectionDraft {
  values: Record<string, { valueText: string; note: string }>;
  description: string;
  conclusion: string;
}

/** Tách ISO → ngày + giờ theo giờ Việt Nam để đưa vào DateInput/TimeInput (UTC+7 cố định, không có giờ mùa hè). */
function splitVn(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

function joinVn(date: string, time: string): string {
  return new Date(`${date}T${time}:00+07:00`).toISOString();
}

function initDrafts(form: ParaclinicalResultForm): Record<string, SectionDraft> {
  return Object.fromEntries(
    form.sections.map((s) => [
      s.itemId,
      {
        values: Object.fromEntries(s.indicators.map((i) => [i.indicatorId, { valueText: i.valueText ?? '', note: i.note ?? '' }])),
        description: s.descriptionText ?? '',
        conclusion: s.conclusionText ?? '',
      },
    ]),
  );
}

/** Màn nhập/duyệt kết quả (`/paraclinical/items/:itemId`) — mở từ Hàng đợi cận lâm sàng; xét nghiệm cùng nhóm hiện chung 1 màn. */
export function ParaclinicalResultPage() {
  const { itemId = '' } = useParams();
  const query = useParaclinicalResultQuery(itemId);
  const form = query.data?.form;
  useBreadcrumb([{ label: 'Cận lâm sàng' }, { label: 'Hàng đợi cận lâm sàng', to: '/paraclinical/queue' }, { label: form ? `Nhập kết quả — ${form.orderNo}` : 'Nhập kết quả' }]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <h1 className="sr-only">Nhập kết quả cận lâm sàng</h1>
      {query.isLoading && (
        <div className="space-y-3 p-6">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {query.isError && (
        <div className="p-6">
          <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được phiếu kết quả.'} onRetry={() => query.refetch()} />
        </div>
      )}
      {form && <ResultForm key={itemId} itemId={itemId} form={form} />}
    </div>
  );
}

function ResultForm({ itemId, form }: { itemId: string; form: ParaclinicalResultForm }) {
  const navigate = useNavigate();
  const canEnter = useHasPermission('paraclinical_result', 'enter');
  const canApprove = useHasPermission('paraclinical_result', 'approve');
  const saveMutation = useSaveParaclinicalResultMutation(itemId);
  const approveMutation = useApproveParaclinicalResultMutation(itemId);
  const printMutation = usePrintParaclinicalResultMutation(itemId);
  const imageMutations = useParaclinicalImageMutations(itemId);

  const [drafts, setDrafts] = useState<Record<string, SectionDraft>>(() => initDrafts(form));
  // Bản in lấy từ dữ liệu ĐÃ LƯU ở máy chủ — còn thay đổi chưa lưu thì khoá nút in để phiếu in không lệch màn hình.
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initDrafts(form)));
  const dirty = JSON.stringify(drafts) !== savedJson;
  const initial = useMemo(() => splitVn(form.resultedAt ?? new Date().toISOString()), [form.resultedAt]);
  const [resultDate, setResultDate] = useState(initial.date);
  const [resultTime, setResultTime] = useState(initial.time);
  const [approverId, setApproverId] = useState(form.approverId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const signed = form.bucket === 'COMPLETED';
  const editable = canEnter && !signed && (form.bucket === 'IN_PROGRESS' || form.bucket === 'PENDING_APPROVAL');
  const busy = saveMutation.isPending || approveMutation.isPending;
  const statusMeta = RESULT_STATUS_META[form.bucket];

  function setValue(section: ParaclinicalResultSection, indicatorId: string, patch: Partial<{ valueText: string; note: string }>) {
    setDrafts((prev) => {
      const draft = prev[section.itemId]!;
      return { ...prev, [section.itemId]: { ...draft, values: { ...draft.values, [indicatorId]: { ...draft.values[indicatorId]!, ...patch } } } };
    });
  }

  function patchSection(sectionItemId: string, patch: Partial<Pick<SectionDraft, 'description' | 'conclusion'>>) {
    setDrafts((prev) => ({ ...prev, [sectionItemId]: { ...prev[sectionItemId]!, ...patch } }));
  }

  function buildRequest(submit: boolean): SaveParaclinicalResultRequest {
    return {
      sections: form.sections.map((s) => {
        const d = drafts[s.itemId]!;
        return {
          itemId: s.itemId,
          values: s.indicators.map((i) => ({ indicatorId: i.indicatorId, valueText: d.values[i.indicatorId]!.valueText.trim() || null, note: d.values[i.indicatorId]!.note.trim() || null })),
          descriptionText: d.description.trim() || null,
          conclusionText: d.conclusion.trim() || null,
        };
      }),
      resultedAt: joinVn(resultDate, resultTime),
      approverId: approverId || null,
      submit,
    };
  }

  async function run(action: () => Promise<unknown>, flash: boolean) {
    setError(null);
    setSavedFlash(false);
    const snapshot = JSON.stringify(drafts);
    try {
      await action();
      setSavedJson(snapshot);
      if (flash) {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được. Thử lại sau.');
    }
  }

  async function handlePrint() {
    await printMutation.mutateAsync();
    setTimeout(() => window.print(), 100);
  }

  const saveDraft = () => run(() => saveMutation.mutateAsync(buildRequest(false)), true);
  const submitForApproval = () => run(() => saveMutation.mutateAsync(buildRequest(true)), true);
  const approve = () => run(() => approveMutation.mutateAsync(buildRequest(true)), false);

  /** Enter = bấm nút chính (đúng chuẩn form), nhưng trong bảng chỉ số Enter nhảy sang ô kết quả kế tiếp để nhập nhanh; ô cuối cùng thì Enter gửi form. */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editable || busy) return;
    void (canApprove ? approve() : form.bucket === 'IN_PROGRESS' ? submitForApproval() : Promise.resolve());
  }

  const showPrimary = editable && (canApprove || form.bucket === 'IN_PROGRESS');
  const doctorOptions = [{ value: '', label: '— Chưa chọn —' }, ...form.approvers.map((a) => ({ value: a.id, label: a.fullName }))];
  const serviceNames = form.sections.map((s) => s.name);

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <InfoBlock label="Bệnh nhân" primary={form.patientName} secondary={`${form.patientCode} · ${genderShort(form.patientGender)} · ${form.ageYears ?? '—'} tuổi`} />
          <InfoBlock
            label="Dịch vụ"
            primary={serviceNames.length === 1 ? serviceNames[0]! : `${serviceNames.length} dịch vụ`}
            secondary={serviceNames.length === 1 ? [form.sections[0]!.code, form.sections[0]!.specimenTypeName, form.collectedAt ? `Lấy mẫu ${formatClockTime(form.collectedAt)}` : null].filter(Boolean).join(' · ') : serviceNames.join(', ')}
          />
          <InfoBlock label="Bác sĩ chỉ định" primary={form.doctorName ?? '—'} secondary={form.encounterNo ?? ''} />
          <InfoBlock
            label={form.sections.some((s) => s.serviceKind === 'LAB') ? 'Thời gian nhận mẫu' : 'Thời gian gọi vào phòng'}
            primary={form.collectedAt ? formatDateTimeVn(form.collectedAt) : '—'}
            secondary={`Đăng ký ${formatDateTimeVn(form.registeredAt)}`}
          />
        </div>
        <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
      </div>

      <div className="scroll-hover flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-10 pt-4 [&>*]:flex-shrink-0">
        {signed && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-800">
            <CheckCircle size={18} weight="fill" aria-hidden="true" />
            Kết quả đã được duyệt{form.signedByName ? ` bởi ${form.signedByName}` : ''}
            {form.signedAt ? ` lúc ${formatClockTime(form.signedAt)}` : ''} — là bản ký, không sửa trực tiếp được.
          </div>
        )}

        {form.sections.map((section) => (
          <SectionCard
            key={section.itemId}
            section={section}
            draft={drafts[section.itemId]!}
            editable={editable}
            onValue={setValue}
            onPatch={patchSection}
            showName={form.sections.length > 1}
            onUploadImages={async (files) => {
              setError(null);
              try {
                for (const file of files) await imageMutations.upload.mutateAsync({ itemId: section.itemId, file });
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Không tải được ảnh. Thử lại sau.');
              }
            }}
            onRemoveImage={(imageId) => void imageMutations.remove.mutateAsync(imageId).catch((err) => setError(err instanceof ApiError ? err.message : 'Không gỡ được ảnh.'))}
            imageBusy={imageMutations.upload.isPending || imageMutations.remove.isPending}
          />
        ))}

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label htmlFor="pr-by" className="mb-1 block text-sm font-semibold text-slate-800">
                Người thực hiện
              </label>
              <input id="pr-by" value={form.performedByName ?? ''} readOnly className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-[15px] font-semibold text-slate-800" />
            </div>
            <div>
              <span className="mb-1 block text-sm font-semibold text-slate-800">Thời gian có kết quả</span>
              <div className="flex gap-2">
                <div className="flex-1">
                  <DateInput id="pr-date" value={resultDate} onChange={(v) => v && setResultDate(v)} disabled={!editable} />
                </div>
                <div className="w-24">
                  <TimeInput id="pr-time" value={resultTime} onChange={setResultTime} disabled={!editable} className="w-full rounded-md border border-slate-300 px-3 py-2 text-center text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50" />
                </div>
              </div>
            </div>
            <div>
              <label htmlFor="pr-approver" className="mb-1 block text-sm font-semibold text-slate-800">
                Bác sĩ duyệt kết quả
              </label>
              <Combobox id="pr-approver" value={approverId} onChange={setApproverId} options={doctorOptions} disabled={!editable} floating />
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
            <Warning size={15} weight="fill" className="mt-0.5 flex-none" aria-hidden="true" />
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
        <p className="text-[12.5px] text-slate-500">
          {signed
            ? 'Kết quả đã duyệt là bản ký — sửa sau khi duyệt phải tạo bản đính chính kèm lý do, bản cũ được giữ lại.'
            : form.bucket === 'PENDING_APPROVAL' && !canApprove
              ? 'Đã gửi duyệt — chờ bác sĩ duyệt và trả kết quả.'
              : 'Kết quả đã duyệt là bản ký — sửa sau khi duyệt phải tạo bản đính chính kèm lý do, bản cũ được giữ lại.'}
          {savedFlash && <span className="ml-3 font-semibold text-emerald-600">Đã lưu</span>}
        </p>
        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" onClick={() => navigate('/paraclinical/queue')}>
            {editable ? 'Về hàng đợi' : 'Đóng'}
          </Button>
          <PrintButton documentType="PARACLINICAL_RESULT" onPrint={() => void handlePrint()} loading={printMutation.isPending} disabled={busy || dirty}>
            In phiếu kết quả
          </PrintButton>
          {editable && (
            <Button type="button" variant="secondary" loading={saveMutation.isPending} disabled={busy} onClick={() => void saveDraft()}>
              Lưu nháp
            </Button>
          )}
          {editable && !canApprove && form.bucket === 'IN_PROGRESS' && (
            <Button type="submit" loading={saveMutation.isPending} disabled={busy}>
              Gửi duyệt
            </Button>
          )}
          {showPrimary && canApprove && (
            <Button type="submit" variant="success" loading={approveMutation.isPending} disabled={busy}>
              Duyệt &amp; trả kết quả
            </Button>
          )}
        </div>
      </div>
      <ParaclinicalResultPrintView form={form} />
    </form>
  );
}

/**
 * Khối "Hình ảnh đính kèm" của kết quả chẩn đoán hình ảnh / thăm dò chức năng (mockup `NhapKetQuaCDHA`): lưới 2 cột ảnh nhỏ (bấm để xem cỡ đầy đủ ở tab mới), "+ Thêm ảnh" chọn nhiều
 * file JPG/PNG từ máy, nút xoá trên từng ảnh khi còn sửa được. Chưa kết nối PACS — ảnh do người dùng chọn từ máy hoặc chụp màn hình máy siêu âm.
 */
function ImagesPanel({ images, editable, busy, onUpload, onRemove }: { images: ParaclinicalResultSection['images']; editable: boolean; busy: boolean; onUpload: (files: File[]) => Promise<void>; onRemove: (imageId: string) => void }) {
  return (
    <aside aria-label="Hình ảnh đính kèm" className="w-full flex-shrink-0 lg:w-[300px]">
      <div className="mb-1.5 text-sm font-semibold text-slate-800">Hình ảnh đính kèm</div>
      <div className="grid grid-cols-2 gap-2">
        {images.map((img) => (
          <div key={img.id} className="group relative aspect-[4/3] overflow-hidden rounded-md border border-slate-200 bg-slate-900">
            <a href={resolveApiUrl(img.url)} target="_blank" rel="noreferrer" title={img.fileName} className="block h-full w-full">
              <img src={resolveApiUrl(img.url)} alt={img.fileName} className="h-full w-full object-contain" />
            </a>
            {editable && (
              <button
                type="button"
                onClick={() => onRemove(img.id)}
                disabled={busy}
                aria-label={`Gỡ ảnh ${img.fileName}`}
                className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-600 text-white shadow hover:bg-rose-700 disabled:opacity-60"
              >
                <Trash size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {editable && (
          <label className={`flex aspect-[4/3] cursor-pointer items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-slate-300 text-sm font-semibold text-slate-600 hover:border-blue-400 hover:bg-blue-50 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              className="hidden"
              aria-label="Thêm ảnh đính kèm"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length > 0) void onUpload(files);
              }}
            />
            <Plus size={14} weight="bold" aria-hidden="true" />
            {busy ? 'Đang tải…' : 'Thêm ảnh'}
          </label>
        )}
      </div>
      <p className="mt-2 text-[11.5px] text-slate-500">Ảnh chọn từ máy (JPG/PNG, ≤ 5 MB, tối đa 8 ảnh) hoặc chụp màn hình máy siêu âm. Chưa kết nối PACS.</p>
    </aside>
  );
}

/** Dòng nhãn của ô nhập (trái) kèm điều khiển phụ (phải, ví dụ chọn mẫu) — thay cho nhãn của `Textarea` (đã ẩn bằng `hideLabel`). */
function FieldHeader({ label, required, htmlFor, children }: { label: string; required: boolean; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-slate-800">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

function InfoBlock({ label, primary, secondary }: { label: string; primary: string; secondary: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 max-w-[26rem] truncate text-[15px] font-bold text-slate-900" title={primary}>
        {primary}
      </div>
      <div className="max-w-[26rem] truncate text-xs text-slate-500" title={secondary}>
        {secondary}
      </div>
    </div>
  );
}

const INDICATOR_COLUMNS = '40px 100px minmax(160px,1fr) 150px 84px 170px 104px minmax(140px,220px)';

function SectionCard({
  section,
  draft,
  editable,
  onValue,
  onPatch,
  showName,
  onUploadImages,
  onRemoveImage,
  imageBusy,
}: {
  section: ParaclinicalResultSection;
  draft: SectionDraft;
  editable: boolean;
  onValue: (section: ParaclinicalResultSection, indicatorId: string, patch: Partial<{ valueText: string; note: string }>) => void;
  onPatch: (itemId: string, patch: Partial<Pick<SectionDraft, 'description' | 'conclusion'>>) => void;
  showName: boolean;
  onUploadImages: (files: File[]) => Promise<void>;
  onRemoveImage: (imageId: string) => void;
  imageBusy: boolean;
}) {
  const wantsIndicators = section.resultType === 'INDICATORS' || section.resultType === 'BOTH';
  const wantsNarrative = section.resultType === 'NARRATIVE' || section.resultType === 'BOTH';
  const templatesQuery = useResultTemplatesQuery({ technicalServiceId: section.technicalServiceId });
  const templates = (templatesQuery.data?.items ?? []).filter((t) => t.isActive);

  function insertTemplate(templateId: string) {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    onPatch(section.itemId, {
      ...(wantsNarrative && t.descriptionText ? { description: t.descriptionText } : {}),
      ...(t.conclusionText ? { conclusion: t.conclusionText } : {}),
    });
  }

  const templatePicker =
    editable && templates.length > 0 ? (
      <div className="flex items-center gap-2.5">
        <span className="hidden text-xs text-slate-500 sm:inline">Chèn xong sửa lại được bình thường</span>
        <div className="w-64">
          <Combobox
            id={`pr-tpl-${section.itemId}`}
            value=""
            onChange={insertTemplate}
            options={[{ value: '', label: 'Chèn mẫu…' }, ...templates.map((t) => ({ value: t.id, label: `Chèn mẫu: ${t.name}` }))]}
            dense
            floating
          />
        </div>
      </div>
    ) : null;

  /** Enter trong ô kết quả → nhảy sang ô kết quả kế tiếp (nhập nhanh); ô cuối thì để Enter gửi form. */
  function focusNext(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const fields = Array.from(e.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[data-result-field]:not(:disabled)') ?? []);
    const next = fields[fields.indexOf(e.currentTarget) + 1];
    if (next) {
      e.preventDefault();
      next.focus();
      next.select();
    }
  }

  return (
    <section aria-label={section.name} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[13.5px] font-bold text-slate-900">{showName || !wantsIndicators ? section.name : 'Kết quả theo chỉ số'}</h2>
          <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">{SERVICE_KIND_LABELS[section.serviceKind]}</span>
          {section.code && <span className="text-xs font-semibold text-slate-500">{section.code}</span>}
          {section.specimenTypeName && <span className="text-xs text-slate-500">· {section.specimenTypeName}</span>}
        </div>
        {wantsIndicators && section.indicators.some((i) => i.reference) && <span className="text-xs text-slate-500">Khoảng tham chiếu tự chọn theo giới tính và tuổi bệnh nhân</span>}
      </div>

      {wantsIndicators && (
        <div className="scroll-hover overflow-x-auto">
          <div style={{ minWidth: 900 }}>
            <div role="row" className="grid border-b-2 border-blue-600 bg-slate-100 px-2 text-center text-xs font-bold uppercase tracking-wide text-slate-800" style={{ gridTemplateColumns: INDICATOR_COLUMNS }}>
              {['TT', 'Mã', 'Tên chỉ số', 'Kết quả', 'Đơn vị', 'Khoảng tham chiếu', 'Đánh giá', 'Ghi chú'].map((h) => (
                <div key={h} role="columnheader" className="px-2 py-2.5">
                  {h}
                </div>
              ))}
            </div>
            {section.indicators.length === 0 && <p className="px-4 py-6 text-center text-sm italic text-slate-400">Dịch vụ này chưa gắn chỉ số nào — khai ở Danh mục cận lâm sàng.</p>}
            {section.indicators.map((ind, index) => {
              const value = draft.values[ind.indicatorId]!;
              const flag = previewFlag(ind.valueType, value.valueText, ind.reference);
              return (
                <div key={ind.indicatorId} role="row" className="grid items-center border-b border-slate-100 px-2 text-center text-sm" style={{ gridTemplateColumns: INDICATOR_COLUMNS, minHeight: 52 }}>
                  <div className="font-medium text-slate-600">{index + 1}</div>
                  <div className="font-semibold text-slate-800">{ind.code}</div>
                  <div className="px-2 text-left font-medium text-slate-900">
                    {ind.name}
                    {ind.abbreviation && <span className="ml-1.5 text-xs font-semibold text-slate-500">({ind.abbreviation})</span>}
                  </div>
                  <div className="px-2">
                    {ind.valueType === 'CHOICE' ? (
                      <Combobox
                        id={`pr-v-${ind.indicatorId}`}
                        value={value.valueText}
                        onChange={(v) => onValue(section, ind.indicatorId, { valueText: v })}
                        options={[{ value: '', label: '—' }, ...ind.choiceOptions.map((o) => ({ value: o, label: o }))]}
                        disabled={!editable}
                        dense
                        floating
                      />
                    ) : (
                      <input
                        data-result-field=""
                        aria-label={`Kết quả ${ind.name}`}
                        value={value.valueText}
                        disabled={!editable}
                        inputMode={ind.valueType === 'NUMBER' ? 'decimal' : 'text'}
                        onChange={(e) => onValue(section, ind.indicatorId, { valueText: e.target.value })}
                        onKeyDown={focusNext}
                        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-[15px] font-bold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
                      />
                    )}
                  </div>
                  <div className="font-medium text-slate-600">{ind.unit ?? ''}</div>
                  <div className="whitespace-pre-line px-2 text-[13px] font-medium text-slate-600">{ind.referenceText || '—'}</div>
                  <div className="px-1">
                    {flag === 'HIGH' && <StatusBadge tone="danger">▲ Cao</StatusBadge>}
                    {flag === 'LOW' && <StatusBadge tone="info">▼ Thấp</StatusBadge>}
                    {flag === 'ABNORMAL' && <StatusBadge tone="danger">Bất thường</StatusBadge>}
                    {flag === 'NORMAL' && <span className="text-[13px] font-semibold text-emerald-700">Bình thường</span>}
                  </div>
                  <div className="px-2">
                    <input
                      aria-label={`Ghi chú ${ind.name}`}
                      value={value.note}
                      disabled={!editable}
                      placeholder="—"
                      onChange={(e) => onValue(section, ind.indicatorId, { note: e.target.value })}
                      className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-[13px] font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={section.serviceKind === 'LAB' ? 'p-4' : 'flex flex-col gap-4 p-4 lg:flex-row'}>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
        <FieldHeader label={wantsNarrative ? 'Mô tả hình ảnh / kết quả' : 'Nhận xét của người thực hiện'} required={wantsNarrative} htmlFor={wantsNarrative ? `pr-desc-${section.itemId}` : `pr-concl-${section.itemId}`}>
          {templatePicker}
        </FieldHeader>
        {wantsNarrative && (
          <Textarea id={`pr-desc-${section.itemId}`} label="Mô tả hình ảnh / kết quả" hideLabel required rows={wantsIndicators ? 4 : 9} value={draft.description} disabled={!editable} onChange={(e) => onPatch(section.itemId, { description: e.target.value })} />
        )}
        <Textarea
          id={`pr-concl-${section.itemId}`}
          label={wantsNarrative ? 'Kết luận' : 'Nhận xét của người thực hiện'}
          hideLabel={!wantsNarrative}
          required={wantsNarrative}
          rows={wantsNarrative ? 3 : 2}
          value={draft.conclusion}
          disabled={!editable}
          onChange={(e) => onPatch(section.itemId, { conclusion: e.target.value })}
        />
        </div>
        {section.serviceKind !== 'LAB' && <ImagesPanel images={section.images} editable={editable} busy={imageBusy} onUpload={onUploadImages} onRemove={onRemoveImage} />}
      </div>
    </section>
  );
}
