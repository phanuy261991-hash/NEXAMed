import { Fragment, useState } from 'react';
import { MagnifyingGlass, Plus, Trash, Warning } from '@phosphor-icons/react';
import type { CreateLabIndicatorRequest, LabIndicatorDetail, LabIndicatorValueType, LabReferenceSex, UpdateLabIndicatorRequest } from '@nexamed/shared';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RecordFormNotice } from '../../shared/ui/RecordFormNotice';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';
import { makeDraftId } from '../../shared/make-draft-id';
import { useHasPermission } from '../auth/usePermission';
import {
  useCreateLabIndicatorMutation,
  useLabIndicatorQuery,
  useLabIndicatorsQuery,
  useUpdateLabIndicatorMutation,
} from './paraclinical.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-800';
const cellInputClassName =
  'w-full rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50';
const labelClassName = 'text-sm font-semibold text-slate-800';

const VALUE_TYPE_OPTIONS = [
  { value: 'NUMBER', label: 'Số' },
  { value: 'TEXT', label: 'Chữ' },
  { value: 'CHOICE', label: 'Chọn từ danh sách' },
];

const SEX_LABELS: Record<LabReferenceSex, string> = { MALE: 'Nam', FEMALE: 'Nữ', ANY: 'Chung' };

interface ReferenceRow {
  draftId: string;
  sex: LabReferenceSex;
  ageFrom: string;
  ageTo: string;
  low: string;
  high: string;
  lowInclusive: boolean;
  highInclusive: boolean;
  normalText: string;
  displayText: string;
  note: string;
}

function emptyReference(): ReferenceRow {
  return { draftId: makeDraftId(), sex: 'ANY', ageFrom: '0', ageTo: '', low: '', high: '', lowInclusive: true, highInclusive: true, normalText: '', displayText: '', note: '' };
}

function parseOptionalNumber(text: string): number | undefined | 'invalid' {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 'invalid';
}

type Selection = { kind: 'none' } | { kind: 'new' } | { kind: 'existing'; id: string };

/**
 * Pill "Chỉ số xét nghiệm" (Cận lâm sàng GĐ1, docs/DECISIONS.md #212, mockup màn 3) — danh sách chỉ số bên trái, chi tiết
 * (thông tin chỉ số + Khoảng tham chiếu theo giới tính × tuổi) bên phải. Khoảng tham chiếu LUÔN lưu cả ngưỡng số (để
 * tự gắn cờ Cao/Thấp) lẫn "chữ in trên phiếu" (tuỳ chọn, ví dụ "< 0.03", "Âm tính", nhiều dòng kiểu HbA1c).
 */
export function LabIndicatorPane() {
  const canCreate = useHasPermission('technical_service', 'create');
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim(), 300);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const listQuery = useLabIndicatorsQuery({ search: search === '' ? undefined : search, includeInactive: true });
  const items = listQuery.data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 gap-3.5 px-6 pb-5 pt-3.5">
      <section className="flex w-[306px] flex-shrink-0 flex-col gap-2.5" aria-label="Danh sách chỉ số xét nghiệm">
        <div className="relative">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            aria-label="Tìm chỉ số"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Tìm chỉ số…"
            className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        {listQuery.isError && <ErrorBanner message="Không tải được danh sách chỉ số." onRetry={() => listQuery.refetch()} />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="grid flex-shrink-0 grid-cols-[92px_minmax(0,1fr)_72px] border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-bold uppercase tracking-wide text-slate-800">
            <div className="px-1.5 py-2.5">Mã</div>
            <div className="px-1.5 py-2.5">Tên chỉ số</div>
            <div className="px-1.5 py-2.5">Đơn vị</div>
          </div>
          <div className="scroll-hover min-h-0 flex-1 overflow-y-auto">
            {listQuery.isLoading && (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
            {!listQuery.isLoading && items.length === 0 && <p className="px-4 py-8 text-center text-sm italic text-slate-400">{search !== '' ? 'Không tìm thấy chỉ số nào' : 'Chưa có chỉ số nào'}</p>}
            {items.map((item) => {
              const active = selection.kind === 'existing' && selection.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelection({ kind: 'existing', id: item.id })}
                  aria-pressed={active}
                  className={`grid h-12 w-full grid-cols-[92px_minmax(0,1fr)_72px] items-center border-b border-slate-100 text-center text-[13px] ${active ? 'bg-blue-50' : 'hover:bg-slate-50'} ${item.isActive ? '' : 'opacity-50'}`}
                >
                  <span className="px-1.5 font-semibold text-slate-800">{item.code}</span>
                  <span className={`min-w-0 truncate px-2 text-left ${active ? 'font-bold text-blue-700' : 'font-medium text-slate-900'}`} title={item.name}>
                    {item.name}
                  </span>
                  <span className="px-1.5 font-medium text-slate-600">{item.unit ?? '—'}</span>
                </button>
              );
            })}
          </div>
        </div>
        {canCreate && (
          <Button type="button" onClick={() => setSelection({ kind: 'new' })}>
            <Plus size={15} weight="bold" aria-hidden="true" />
            Thêm chỉ số
          </Button>
        )}
      </section>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Chi tiết chỉ số xét nghiệm">
        {selection.kind === 'none' && (
          <div className="p-6">
            <EmptyState icon={MagnifyingGlass} title="Chọn một chỉ số để xem" description="Chọn chỉ số ở danh sách bên trái để xem và sửa khoảng tham chiếu theo giới tính, tuổi." />
          </div>
        )}
        {selection.kind === 'new' && <IndicatorDetail key="new" indicatorId={null} onSaved={(id) => setSelection({ kind: 'existing', id })} onCancel={() => setSelection({ kind: 'none' })} />}
        {selection.kind === 'existing' && (
          <IndicatorDetail key={selection.id} indicatorId={selection.id} onSaved={(id) => setSelection({ kind: 'existing', id })} onCancel={() => setSelection({ kind: 'none' })} />
        )}
      </section>
    </div>
  );
}

function IndicatorDetail({ indicatorId, onSaved, onCancel }: { indicatorId: string | null; onSaved: (id: string) => void; onCancel: () => void }) {
  const query = useLabIndicatorQuery(indicatorId);
  const [formKey, setFormKey] = useState(0);
  if (indicatorId !== null && query.isLoading) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (indicatorId !== null && query.isError) return <div className="p-5"><ErrorBanner message="Không tải được chỉ số." onRetry={() => query.refetch()} /></div>;
  return (
    <IndicatorForm
      key={`${formKey}-${query.data?.version ?? 'new'}`}
      detail={query.data}
      onSaved={onSaved}
      onCancel={onCancel}
      onReload={async () => {
        await query.refetch();
        setFormKey((k) => k + 1);
      }}
    />
  );
}

function IndicatorForm({
  detail,
  onSaved,
  onCancel,
  onReload,
}: {
  detail: LabIndicatorDetail | undefined;
  onSaved: (id: string) => void;
  onCancel: () => void;
  onReload: () => Promise<void>;
}) {
  const canWrite = useHasPermission('technical_service', detail ? 'update' : 'create');
  const { saveError, run } = useSaveAttempt();
  const createMutation = useCreateLabIndicatorMutation();
  const updateMutation = useUpdateLabIndicatorMutation();
  const submitting = createMutation.isPending || updateMutation.isPending;

  const [name, setName] = useState(detail?.name ?? '');
  const [abbreviation, setAbbreviation] = useState(detail?.abbreviation ?? '');
  const [unit, setUnit] = useState(detail?.unit ?? '');
  const [valueType, setValueType] = useState<LabIndicatorValueType>(detail?.valueType ?? 'NUMBER');
  const [decimals, setDecimals] = useState(detail?.decimals === null || detail?.decimals === undefined ? '' : String(detail.decimals));
  const [sortOrder, setSortOrder] = useState(detail?.sortOrder ?? 0);
  const [choices, setChoices] = useState((detail?.choiceOptions ?? []).join('; '));
  const isActive = detail?.isActive ?? true;
  const [rows, setRows] = useState<ReferenceRow[]>(
    (detail?.references ?? []).map((r) => ({
      draftId: makeDraftId(),
      sex: r.sex,
      ageFrom: String(r.ageFromYears),
      ageTo: r.ageToYears === null ? '' : String(r.ageToYears),
      low: r.lowValue === null ? '' : String(r.lowValue),
      high: r.highValue === null ? '' : String(r.highValue),
      lowInclusive: r.lowInclusive,
      highInclusive: r.highInclusive,
      normalText: r.normalText ?? '',
      displayText: r.displayText ?? '',
      note: r.note ?? '',
    })),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const numeric = valueType === 'NUMBER';
  const locked = !canWrite;
  const typeLocked = detail !== undefined && detail.serviceCount > 0;
  const invalid = name.trim() === '';

  function patchRow(draftId: string, patch: Partial<ReferenceRow>) {
    setRows((prev) => prev.map((r) => (r.draftId === draftId ? { ...r, ...patch } : r)));
  }

  function buildReferences() {
    const out = [];
    for (const r of rows) {
      const ageFrom = Number(r.ageFrom === '' ? '0' : r.ageFrom);
      const ageTo = r.ageTo.trim() === '' ? undefined : Number(r.ageTo);
      const low = parseOptionalNumber(r.low);
      const high = parseOptionalNumber(r.high);
      if (!Number.isInteger(ageFrom) || ageFrom < 0 || (ageTo !== undefined && (!Number.isInteger(ageTo) || ageTo < ageFrom))) {
        return { error: 'Tuổi phải là số nguyên ≥ 0 và "Tuổi đến" không nhỏ hơn "Tuổi từ".' };
      }
      if (low === 'invalid' || high === 'invalid') return { error: 'Ngưỡng thấp/cao phải là số.' };
      if (low !== undefined && high !== undefined && low > high) return { error: 'Ngưỡng cao phải lớn hơn hoặc bằng Ngưỡng thấp.' };
      if (!numeric && r.normalText.trim() === '' && r.displayText.trim() === '') return { error: 'Khoảng tham chiếu của chỉ số kiểu Chữ/Chọn cần Giá trị bình thường.' };
      out.push({
        sex: r.sex,
        ageFromYears: ageFrom,
        ...(ageTo !== undefined ? { ageToYears: ageTo } : {}),
        ...(numeric && low !== undefined ? { lowValue: low } : {}),
        ...(numeric && high !== undefined ? { highValue: high } : {}),
        lowInclusive: r.lowInclusive,
        highInclusive: r.highInclusive,
        ...(!numeric && r.normalText.trim() ? { normalText: r.normalText.trim() } : {}),
        ...(r.displayText.trim() ? { displayText: r.displayText } : {}),
        ...(r.note.trim() ? { note: r.note.trim() } : {}),
      });
    }
    return { references: out };
  }

  async function save(overrideActive?: boolean) {
    if (invalid || locked) return;
    setFormError(null);
    const built = buildReferences();
    if ('error' in built) {
      setFormError(built.error ?? 'Khoảng tham chiếu chưa hợp lệ.');
      return;
    }
    const decimalsValue = decimals.trim() === '' ? undefined : Number(decimals);
    if (decimalsValue !== undefined && (!Number.isInteger(decimalsValue) || decimalsValue < 0 || decimalsValue > 6)) {
      setFormError('Số lẻ thập phân phải từ 0 đến 6.');
      return;
    }
    const choiceList = choices
      .split(';')
      .map((c) => c.trim())
      .filter((c) => c !== '');
    if (valueType === 'CHOICE' && choiceList.length < 2) {
      setFormError('Chỉ số kiểu Chọn cần ít nhất 2 lựa chọn (cách nhau bằng dấu ;).');
      return;
    }
    const active = overrideActive ?? isActive;
    let savedId = detail?.id ?? '';
    const ok = await run(async () => {
      if (!detail) {
        const body: CreateLabIndicatorRequest = {
          name: name.trim(),
          valueType,
          isActive: active,
          sortOrder,
          ...(abbreviation.trim() ? { abbreviation: abbreviation.trim() } : {}),
          ...(unit.trim() ? { unit: unit.trim() } : {}),
          ...(numeric && decimalsValue !== undefined ? { decimals: decimalsValue } : {}),
          ...(valueType === 'CHOICE' ? { choiceOptions: choiceList } : {}),
          references: built.references,
        };
        savedId = (await createMutation.mutateAsync(body)).id;
      } else {
        const body: UpdateLabIndicatorRequest = {
          version: detail.version,
          name: name.trim(),
          abbreviation: abbreviation.trim() || null,
          unit: unit.trim() || null,
          valueType,
          decimals: numeric ? (decimalsValue ?? null) : null,
          choiceOptions: valueType === 'CHOICE' ? choiceList : null,
          isActive: active,
          sortOrder,
          references: built.references,
        };
        await updateMutation.mutateAsync({ id: detail.id, body });
      }
    });
    if (ok) onSaved(savedId);
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
          <h2 className="truncate text-base font-bold text-slate-900">{detail ? `${detail.abbreviation ? `${detail.abbreviation} — ` : ''}${detail.name}` : 'Thêm chỉ số xét nghiệm'}</h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500">
            {detail ? `Dùng trong ${detail.serviceCount} dịch vụ · Mã ${detail.code}${detail.isActive ? '' : ' · Đang ngưng dùng'}` : 'Mã sẽ tự sinh khi lưu'}
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          {detail && canWrite && (
            <Button type="button" variant="dangerGhost" disabled={submitting} onClick={() => void save(!detail.isActive)}>
              {detail.isActive ? 'Ngưng dùng' : 'Kích hoạt lại'}
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          {canWrite && (
            <Button type="submit" loading={submitting} disabled={invalid}>
              Lưu
            </Button>
          )}
        </div>
      </div>

      <fieldset disabled={locked} className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto border-0 p-4 pt-6">
        <BoxedSection badge="Thông tin chỉ số">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="li-code" className={labelClassName}>
                Mã chỉ số
              </label>
              <input id="li-code" value={detail?.code ?? ''} readOnly placeholder="Tự động" className={`${inputClassName} bg-slate-50`} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <label htmlFor="li-name" className={labelClassName}>
                Tên chỉ số <span className="text-rose-500">*</span>
              </label>
              <input id="li-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="li-abbr" className={labelClassName}>
                Ký hiệu in phiếu
              </label>
              <input id="li-abbr" value={abbreviation} onChange={(e) => setAbbreviation(e.target.value)} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="li-unit" className={labelClassName}>
                Đơn vị
              </label>
              <input id="li-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="li-type" className={labelClassName}>
                Kiểu giá trị
              </label>
              <Combobox id="li-type" value={valueType} onChange={(v) => setValueType(v as LabIndicatorValueType)} options={VALUE_TYPE_OPTIONS} disabled={locked || typeLocked} />
              {typeLocked && <span className="text-[11px] text-slate-500">Đang dùng trong dịch vụ — không đổi được kiểu.</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="li-dec" className={labelClassName}>
                Số lẻ thập phân
              </label>
              <input id="li-dec" inputMode="numeric" value={decimals} onChange={(e) => setDecimals(e.target.value.replace(/\D/g, ''))} disabled={!numeric} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="li-sort" className={labelClassName}>
                Thứ tự in
              </label>
              <input id="li-sort" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className={inputClassName} />
            </div>
            {valueType === 'CHOICE' && (
              <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-4">
                <label htmlFor="li-choices" className={labelClassName}>
                  Các lựa chọn <span className="text-rose-500">*</span>
                </label>
                <input id="li-choices" value={choices} onChange={(e) => setChoices(e.target.value)} placeholder="Ví dụ: Âm tính; Dương tính; Nghi ngờ (cách nhau bằng dấu ;)" className={inputClassName} />
              </div>
            )}
          </div>
        </BoxedSection>

        <BoxedSection badge="Khoảng tham chiếu">
          <p className="mb-3 text-[12.5px] text-slate-600">
            Khi nhập kết quả, hệ thống chọn dòng khớp <strong className="text-slate-900">giới tính</strong> và <strong className="text-slate-900">tuổi</strong> của bệnh nhân để gắn cờ Cao/Thấp. Dòng “Chung” dùng cho cả hai giới; dòng cụ thể hơn được ưu tiên.
          </p>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="scroll-hover overflow-x-auto">
              <table className="w-full min-w-[700px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                    <th className="w-28 px-1.5 py-2.5 text-center">Giới tính</th>
                    <th className="w-20 px-1.5 py-2.5 text-center">Tuổi từ</th>
                    <th className="w-20 px-1.5 py-2.5 text-center">Tuổi đến</th>
                    {numeric ? (
                      <>
                        <th className="w-36 px-1.5 py-2.5 text-center">Ngưỡng thấp</th>
                        <th className="w-36 px-1.5 py-2.5 text-center">Ngưỡng cao</th>
                      </>
                    ) : (
                      <th className="w-72 px-1.5 py-2.5 text-center">Giá trị bình thường</th>
                    )}
                    <th className="px-1.5 py-2.5 text-center">Ghi chú</th>
                    <th className="w-12 px-1.5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center font-medium italic text-slate-400">
                        Chưa khai khoảng tham chiếu — kết quả sẽ không được gắn cờ Cao/Thấp
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <Fragment key={r.draftId}>
                    <tr className="border-t border-slate-100">
                      <td className="px-1.5 py-2">
                        <select aria-label="Giới tính" value={r.sex} onChange={(e) => patchRow(r.draftId, { sex: e.target.value as LabReferenceSex })} className={cellInputClassName}>
                          {(['MALE', 'FEMALE', 'ANY'] as const).map((s) => (
                            <option key={s} value={s}>
                              {SEX_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1.5 py-2">
                        <input aria-label="Tuổi từ" inputMode="numeric" value={r.ageFrom} onChange={(e) => patchRow(r.draftId, { ageFrom: e.target.value.replace(/\D/g, '') })} className={cellInputClassName} />
                      </td>
                      <td className="px-1.5 py-2">
                        <input aria-label="Tuổi đến" inputMode="numeric" placeholder="∞" value={r.ageTo} onChange={(e) => patchRow(r.draftId, { ageTo: e.target.value.replace(/\D/g, '') })} className={cellInputClassName} />
                      </td>
                      {numeric ? (
                        <>
                          <td className="px-1.5 py-2">
                            <div className="flex items-center gap-1">
                              <select aria-label="Bao gồm ngưỡng thấp" value={r.lowInclusive ? '1' : '0'} onChange={(e) => patchRow(r.draftId, { lowInclusive: e.target.value === '1' })} className="w-12 rounded-md border border-slate-300 px-1 py-1.5 text-center text-sm font-semibold text-slate-700">
                                <option value="1">≥</option>
                                <option value="0">&gt;</option>
                              </select>
                              <input aria-label="Ngưỡng thấp" inputMode="decimal" value={r.low} onChange={(e) => patchRow(r.draftId, { low: e.target.value })} className={`${cellInputClassName} text-right`} />
                            </div>
                          </td>
                          <td className="px-1.5 py-2">
                            <div className="flex items-center gap-1">
                              <select aria-label="Bao gồm ngưỡng cao" value={r.highInclusive ? '1' : '0'} onChange={(e) => patchRow(r.draftId, { highInclusive: e.target.value === '1' })} className="w-12 rounded-md border border-slate-300 px-1 py-1.5 text-center text-sm font-semibold text-slate-700">
                                <option value="1">≤</option>
                                <option value="0">&lt;</option>
                              </select>
                              <input aria-label="Ngưỡng cao" inputMode="decimal" value={r.high} onChange={(e) => patchRow(r.draftId, { high: e.target.value })} className={`${cellInputClassName} text-right`} />
                            </div>
                          </td>
                        </>
                      ) : (
                        <td className="px-1.5 py-2">
                          <input aria-label="Giá trị bình thường" value={r.normalText} onChange={(e) => patchRow(r.draftId, { normalText: e.target.value })} placeholder="Ví dụ: Âm tính" className={`${cellInputClassName} text-left`} />
                        </td>
                      )}
                      <td className="px-1.5 py-2">
                        <input aria-label="Ghi chú" value={r.note} onChange={(e) => patchRow(r.draftId, { note: e.target.value })} className={`${cellInputClassName} text-left font-medium`} />
                      </td>
                      <td className="px-1.5 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => setRows((prev) => prev.filter((x) => x.draftId !== r.draftId))}
                          aria-label="Xoá khoảng tham chiếu"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-rose-50 text-rose-600 hover:bg-rose-100"
                        >
                          <Trash size={15} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={7} className="px-1.5 pb-2">
                        <input
                          aria-label="Chữ in trên phiếu"
                          value={r.displayText}
                          onChange={(e) => patchRow(r.draftId, { displayText: e.target.value })}
                          placeholder="Chữ in trên phiếu (tuỳ chọn) — để trống = tự sinh từ ngưỡng, ví dụ “< 0.03” hoặc nhiều dòng kiểu HbA1c"
                          className="w-full rounded-md border border-dashed border-slate-300 px-2.5 py-1.5 text-left text-[13px] font-medium text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
                        />
                      </td>
                    </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Button type="button" variant="secondary" className="mt-2.5" onClick={() => setRows((prev) => [...prev, emptyReference()])}>
            <Plus size={14} weight="bold" aria-hidden="true" />
            Thêm khoảng tham chiếu
          </Button>
        </BoxedSection>

        {formError && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
            <Warning size={15} weight="fill" className="flex-none" aria-hidden="true" />
            {formError}
          </div>
        )}
        <RecordFormNotice saveError={saveError} onReload={detail ? onReload : undefined} />
      </fieldset>
    </form>
  );
}
