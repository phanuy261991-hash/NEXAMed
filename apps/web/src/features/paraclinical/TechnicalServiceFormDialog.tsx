import { useMemo, useState } from 'react';
import { Flask, Info, MagnifyingGlass, Trash, Warning, X } from '@phosphor-icons/react';
import type {
  CreateTechnicalServiceRequest,
  TechnicalServiceDetail,
  TechnicalServiceKind,
  TechnicalServiceResultType,
  UpdateTechnicalServiceRequest,
} from '@nexamed/shared';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RecordFormNotice } from '../../shared/ui/RecordFormNotice';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';
import { formatVnd } from '../../shared/format/currency';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useHasAnyPermission, useHasPermission } from '../auth/usePermission';
import { useLabPartnerEnabledQuery } from '../clinic/clinic.queries';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { useSuppliersQuery } from '../drug/supplier.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { ServiceNormSection, useServiceNormEditor } from '../service-consumption/ServiceNormSection';
import { DEFAULT_RESULT_TYPE_BY_KIND, TECHNICAL_SERVICE_KIND_LABELS } from './paraclinical-labels';
import { convertTurnaroundText, parseTurnaround, splitTurnaround, type TurnaroundUnit } from './turnaround-model';
import {
  addPartnerRow,
  buildPartnerPayload,
  partnerMargin,
  removePartnerRow,
  setDefaultPartner,
  setPartnerAmount,
  toPartnerRows,
  validatePartnerRows,
  type PartnerPriceRow,
} from './lab-partner-price-model';
import {
  buildPriceLines,
  dayBefore,
  hiddenOtherPriceTypeCodes,
  initialPriceFormInput,
  rankPriceTypeCodes,
  splitPriceLines,
  validatePriceForm,
  type PriceFormInput,
} from './technical-service-price-model';
import {
  useCreateTechnicalServiceMutation,
  useLabIndicatorsQuery,
  useTechnicalServiceQuery,
  useUpdateTechnicalServiceMutation,
} from './paraclinical.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-800';
const labelClassName = 'text-sm font-semibold text-slate-800';

const KIND_CARDS: { kind: TechnicalServiceKind; hint: string }[] = [
  { kind: 'LAB', hint: 'Có mẫu bệnh phẩm, kết quả theo chỉ số' },
  { kind: 'IMAGING', hint: 'Kết quả mô tả + kết luận' },
  { kind: 'FUNCTIONAL', hint: 'Mô tả, có thể kèm chỉ số' },
];

/** Đơn vị nhập "Thời gian trả kết quả" (#291) — lưu vẫn bằng phút. */
const TURNAROUND_UNIT_OPTIONS: ComboboxOption[] = [
  { value: 'minute', label: 'Phút' },
  { value: 'hour', label: 'Giờ' },
];

const RESULT_TYPE_OPTIONS: ComboboxOption[] = [
  { value: 'INDICATORS', label: 'Theo chỉ số' },
  { value: 'NARRATIVE', label: 'Mô tả + kết luận' },
  { value: 'BOTH', label: 'Cả chỉ số và mô tả' },
];

interface IndicatorRow {
  indicatorId: string;
  code: string;
  name: string;
  unit: string | null;
  interpretationText: string | undefined;
}

/**
 * Thêm/Sửa/Xem "Dịch vụ kỹ thuật" (Cận lâm sàng GĐ1, docs/DECISIONS.md #212, mockup màn 2) — 4 khối: Thông tin dịch vụ,
 * Nơi thực hiện & kết quả, Đơn giá dịch vụ, Chỉ số xét nghiệm của dịch vụ. Lưu một lần (đơn giá + chỉ số thay TOÀN BỘ,
 * cùng khuôn `ExamTypeFormModal`). `mode='view'` chỉ đọc, có nút chuyển sang Sửa khi có quyền.
 */
export function TechnicalServiceFormDialog({
  mode,
  serviceId,
  onClose,
  onSwitchToEdit,
}: {
  mode: 'create' | 'view' | 'edit';
  serviceId: string | null;
  onClose: () => void;
  onSwitchToEdit: (id: string) => void;
}) {
  const detailQuery = useTechnicalServiceQuery(serviceId);
  const [formKey, setFormKey] = useState(0);

  async function reload() {
    await detailQuery.refetch();
    setFormKey((k) => k + 1);
  }

  const loading = serviceId !== null && detailQuery.isLoading;
  const title = mode === 'create' ? 'Thêm dịch vụ kỹ thuật' : mode === 'edit' ? 'Sửa dịch vụ kỹ thuật' : 'Chi tiết dịch vụ kỹ thuật';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/55 p-4 py-8" role="dialog" aria-modal="true" aria-labelledby="ts-dialog-title">
      <div className="w-full max-w-[1136px] overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-blue-600 text-white">
              <Flask size={20} weight="fill" aria-hidden="true" />
            </span>
            <div>
              <h2 id="ts-dialog-title" className="text-[17px] font-semibold text-slate-900">
                {title}
              </h2>
              <span className="mt-1 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">Danh mục Cận lâm sàng</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {loading && (
          <div className="space-y-3 p-6">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {detailQuery.isError && <div className="p-6 text-sm text-rose-700">Không tải được dịch vụ. Đóng và thử lại.</div>}
        {!loading && !detailQuery.isError && (
          <ServiceForm key={formKey} mode={mode} detail={detailQuery.data} onClose={onClose} onSwitchToEdit={onSwitchToEdit} onReload={reload} />
        )}
      </div>
    </div>
  );
}

function ServiceForm({
  mode,
  detail,
  onClose,
  onSwitchToEdit,
  onReload,
}: {
  mode: 'create' | 'view' | 'edit';
  detail: TechnicalServiceDetail | undefined;
  onClose: () => void;
  onSwitchToEdit: (id: string) => void;
  onReload: () => Promise<void>;
}) {
  const readOnly = mode === 'view';
  const isCreate = mode === 'create';
  const { saveError, run } = useSaveAttempt();
  const createMutation = useCreateTechnicalServiceMutation();
  const updateMutation = useUpdateTechnicalServiceMutation();
  const submitting = createMutation.isPending || updateMutation.isPending;

  const [name, setName] = useState(detail?.name ?? '');
  const [shortName, setShortName] = useState(detail?.shortName ?? '');
  const [nationalCode, setNationalCode] = useState(detail?.nationalCode ?? '');
  const [kind, setKind] = useState<TechnicalServiceKind>(detail?.serviceKind ?? 'LAB');
  const [categoryCode, setCategoryCode] = useState(detail?.categoryCode ?? '');
  const [isActive, setIsActive] = useState(detail?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(detail?.sortOrder ?? 0);
  const [inHouse, setInHouse] = useState(detail?.isPerformedInHouse ?? true);
  // "Gửi đối tác" (#291): phòng khám lấy mẫu rồi gửi đối tác; giá trả theo từng đối tác. Chỉ hiện khi công tắc "Dùng đối tác xét nghiệm" BẬT (hoặc dịch vụ đã gửi đối tác từ trước).
  const [sentToPartner, setSentToPartner] = useState(detail?.sentToPartner ?? false);
  const [partnerRows, setPartnerRows] = useState<PartnerPriceRow[]>(toPartnerRows(detail?.partnerPrices));
  const [departmentId, setDepartmentId] = useState(detail?.departmentId ?? '');
  const [specimenTypeCode, setSpecimenTypeCode] = useState(detail?.specimenTypeCode ?? '');
  // "Thời gian trả kết quả" lưu bằng PHÚT nhưng nhập được theo giờ (#291: dịch vụ gửi đối tác trả kết quả theo giờ); giá trị tròn giờ hiện sẵn theo giờ.
  const initialTurnaround = splitTurnaround(detail?.turnaroundMinutes);
  const [turnaround, setTurnaround] = useState(initialTurnaround.text);
  const [turnaroundUnit, setTurnaroundUnit] = useState<TurnaroundUnit>(initialTurnaround.unit);
  const [resultType, setResultType] = useState<TechnicalServiceResultType>(detail?.resultType ?? DEFAULT_RESULT_TYPE_BY_KIND.LAB);
  // Các ô giá NGƯỜI DÙNG đã sửa (docs/DECISIONS.md #268) — ô chưa đụng tới lấy theo dữ liệu đang có, nên danh mục Loại giá tải xong muộn vẫn ra đúng mức.
  const [priceEdits, setPriceEdits] = useState<Partial<PriceFormInput>>({});
  const [indicators, setIndicators] = useState<IndicatorRow[]>(
    (detail?.indicators ?? []).map((i) => ({ indicatorId: i.indicatorId, code: i.code, name: i.name, unit: i.unit, interpretationText: i.interpretationText ?? undefined })),
  );
  const [indicatorSearch, setIndicatorSearch] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);
  // Định mức vật tư tiêu hao (#297 GĐ4): lưu riêng, CHỈ khi sửa/xem dịch vụ đã có.
  const normEditor = useServiceNormEditor(detail ? { kind: 'TECHNICAL_SERVICE', ref: detail.id } : null);

  const categoryQuery = useReferenceCatalogQuery('TECH_SERVICE_CATEGORY');
  const specimenQuery = useReferenceCatalogQuery('SPECIMEN_TYPE');
  // Lấy cả Loại giá đã ẩn: thứ tự xếp mức phải KHỚP máy chủ (`PriceableCatalogService.priceTypeOrder` đọc cả mục ẩn) để form và lúc tính tiền cùng một mức.
  const priceTypeQuery = useReferenceCatalogQuery('PRICE_TYPE', true);
  const unitQuery = useReferenceCatalogQuery('UNIT');
  const departmentQuery = useDepartmentOptionsQuery();
  const partnerEnabledQuery = useLabPartnerEnabledQuery();
  const partnerEnabled = partnerEnabledQuery.data?.enabled === true;
  const suppliersQuery = useSuppliersQuery();
  const partnerCandidates = useMemo(() => (suppliersQuery.data?.items ?? []).filter((s) => s.isLabPartner && !partnerRows.some((r) => r.supplierId === s.id)), [suppliersQuery.data, partnerRows]);
  const partnerOptions: ComboboxOption[] = useMemo(() => partnerCandidates.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })), [partnerCandidates]);
  const showPartnerSection = kind === 'LAB' && inHouse && (partnerEnabled || (detail?.sentToPartner ?? false));
  const partnerEditable = !readOnly && partnerEnabled;
  // Giá trả đối tác là giá vốn, khách không được thấy (#291): máy chủ chỉ trả cho người cấu hình dịch vụ hoặc xem công nợ nhà cung cấp; web ẩn bảng với người còn lại.
  const canSeePartnerCost = useHasAnyPermission([
    ['technical_service', 'update'],
    ['supplier_debt', 'read'],
  ]);
  const indicatorSearchQuery = useLabIndicatorsQuery({ search: indicatorSearch.trim() === '' ? undefined : indicatorSearch.trim() });
  const allIndicatorsQuery = useLabIndicatorsQuery({ includeInactive: true });

  const toOptions = (items: { code: string; name: string }[] | undefined): ComboboxOption[] => (items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const categoryOptions = useMemo(() => toOptions(categoryQuery.data?.items), [categoryQuery.data]);
  const specimenOptions = useMemo(() => toOptions(specimenQuery.data?.items), [specimenQuery.data]);
  const unitOptions = useMemo(() => toOptions(unitQuery.data?.items), [unitQuery.data]);
  const departmentOptions: ComboboxOption[] = useMemo(() => (departmentQuery.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })), [departmentQuery.data]);
  const referenceCountById = useMemo(() => new Map((allIndicatorsQuery.data?.items ?? []).map((i) => [i.id, i.referenceCount])), [allIndicatorsQuery.data]);

  // --- Đơn giá: MỘT giá gốc + "Hẹn đổi giá" (#268). Dòng giá cũ nhiều mức vẫn nằm trong dữ liệu và được gửi lại nguyên vẹn khi lưu.
  const today = getVietnamTodayDateString();
  const priceTypeItems = useMemo(() => priceTypeQuery.data?.items ?? [], [priceTypeQuery.data]);
  const defaultPriceTypeCode = priceTypeItems.find((i) => i.isDefault)?.code ?? '';
  const rankedPriceTypes = useMemo(() => rankPriceTypeCodes(priceTypeItems.map((i) => i.code), defaultPriceTypeCode), [priceTypeItems, defaultPriceTypeCode]);
  const newServicePriceType = rankedPriceTypes.find((c) => priceTypeItems.some((i) => i.code === c && i.isActive)) ?? '';
  const priceModel = useMemo(
    () =>
      splitPriceLines(
        (detail?.prices ?? []).map((p) => ({ priceTypeCode: p.priceTypeCode, unitCode: p.unitCode, amount: p.amount, effectiveFrom: p.effectiveFrom, ...(p.effectiveTo ? { effectiveTo: p.effectiveTo } : {}) })),
        rankedPriceTypes,
        today,
        newServicePriceType,
      ),
    [detail, rankedPriceTypes, today, newServicePriceType],
  );
  const priceInput: PriceFormInput = { ...initialPriceFormInput(priceModel), ...priceEdits };
  const priceTypeLabel = (code: string) => priceTypeItems.find((i) => i.code === code)?.name ?? code;
  const hiddenOtherPriceTypes = hiddenOtherPriceTypeCodes(priceModel);
  function editPrice(patch: Partial<PriceFormInput>) {
    setPriceEdits((prev) => ({ ...prev, ...patch }));
  }

  const showIndicators = resultType !== 'NARRATIVE';
  const addedIds = new Set(indicators.map((i) => i.indicatorId));
  const searchResults = indicatorSearch.trim() === '' ? [] : (indicatorSearchQuery.data?.items ?? []).filter((i) => !addedIds.has(i.id)).slice(0, 8);

  // Chờ danh mục Loại giá tải xong mới cho lưu dịch vụ thực hiện tại phòng khám — thiếu thì không biết gán giá vào mức nào.
  const invalid = name.trim() === '' || (inHouse && priceTypeQuery.isLoading);

  function pickKind(next: TechnicalServiceKind) {
    setKind(next);
    setResultType(DEFAULT_RESULT_TYPE_BY_KIND[next]);
    if (next !== 'LAB') {
      setSpecimenTypeCode('');
      setSentToPartner(false);
    }
  }

  function changeInHouse(next: boolean) {
    setInHouse(next);
    if (!next) setSentToPartner(false);
  }

  // Mảng gửi API = giá hiện hành + giá hẹn + MỌI dòng ẩn nguyên vẹn (lưu giá là "thay sạch" — thiếu dòng ẩn là mất mức giá cũ).
  const pricesPayload = () => buildPriceLines(priceModel, priceInput, today);
  const indicatorsPayload = () => indicators.map((i) => ({ indicatorId: i.indicatorId, ...(i.interpretationText ? { interpretationText: i.interpretationText } : {}) }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || invalid) return;
    setRowError(null);
    const priceError = validatePriceForm(priceModel, priceInput, today, inHouse);
    if (priceError) {
      setRowError(priceError);
      return;
    }
    const parsedTurnaround = parseTurnaround(turnaround, turnaroundUnit);
    if (parsedTurnaround.error) {
      setRowError(parsedTurnaround.error);
      return;
    }
    const turnaroundMinutes = parsedTurnaround.minutes;
    if (partnerEnabled) {
      const partnerError = validatePartnerRows(sentToPartner, partnerRows);
      if (partnerError) {
        setRowError(partnerError);
        return;
      }
    }

    const normError = normEditor.validate();
    if (normError) {
      setRowError(normError);
      return;
    }

    const ok = await run(async () => {
      // Định mức lưu TRƯỚC dịch vụ: thay nguyên danh sách nên chạy lại khi lưu dịch vụ lỗi vẫn an toàn.
      await normEditor.save();
      if (isCreate) {
        const body: CreateTechnicalServiceRequest = {
          name: name.trim(),
          serviceKind: kind,
          isPerformedInHouse: inHouse,
          isActive,
          sortOrder,
          resultType,
          ...(shortName.trim() ? { shortName: shortName.trim() } : {}),
          ...(nationalCode.trim() ? { nationalCode: nationalCode.trim() } : {}),
          ...(categoryCode ? { categoryCode } : {}),
          ...(kind === 'LAB' && specimenTypeCode ? { specimenTypeCode } : {}),
          ...(departmentId ? { departmentId } : {}),
          ...(turnaroundMinutes !== undefined ? { turnaroundMinutes } : {}),
          ...(inHouse ? { prices: pricesPayload() } : {}),
          sentToPartner: partnerEnabled && sentToPartner,
          ...(partnerEnabled ? { partnerPrices: buildPartnerPayload(partnerRows) } : {}),
          ...(showIndicators ? { indicators: indicatorsPayload() } : {}),
        };
        await createMutation.mutateAsync(body);
      } else {
        const body: UpdateTechnicalServiceRequest = {
          version: detail!.version,
          name: name.trim(),
          shortName: shortName.trim() || null,
          nationalCode: nationalCode.trim() || null,
          categoryCode: categoryCode || null,
          specimenTypeCode: kind === 'LAB' ? specimenTypeCode || null : null,
          isPerformedInHouse: inHouse,
          departmentId: departmentId || null,
          turnaroundMinutes: turnaroundMinutes ?? null,
          resultType,
          isActive,
          sortOrder,
          ...(inHouse ? { prices: pricesPayload() } : {}),
          ...(partnerEnabled ? { sentToPartner, partnerPrices: buildPartnerPayload(partnerRows) } : {}),
          ...(showIndicators ? { indicators: indicatorsPayload() } : {}),
        };
        await updateMutation.mutateAsync({ id: detail!.id, body });
      }
    });
    if (ok) onClose();
  }

  return (
    <form onSubmit={handleSubmit}>
      <fieldset disabled={readOnly} className="flex max-h-[72vh] min-w-0 flex-col gap-7 overflow-y-auto border-0 p-6 pt-7">
        <BoxedSection badge="Thông tin dịch vụ">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-code" className={labelClassName}>
                Mã dịch vụ
              </label>
              <input id="ts-code" value={detail?.code ?? ''} readOnly placeholder="Tự động" className={`${inputClassName} bg-slate-50`} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <label htmlFor="ts-name" className={labelClassName}>
                Tên dịch vụ <span className="text-rose-500">*</span>
              </label>
              <input id="ts-name" autoFocus={!readOnly} value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-short" className={labelClassName}>
                Tên viết tắt
              </label>
              <input id="ts-short" value={shortName} onChange={(e) => setShortName(e.target.value)} className={inputClassName} />
            </div>

            <div className="col-span-2 sm:col-span-4" role="radiogroup" aria-label="Loại dịch vụ">
              <span className={`${labelClassName} mb-1.5 block`}>
                Loại dịch vụ <span className="text-rose-500">*</span>
              </span>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {KIND_CARDS.map((card) => {
                  const selected = kind === card.kind;
                  const locked = !isCreate && !selected;
                  return (
                    <label
                      key={card.kind}
                      className={`block rounded-lg border px-3.5 py-2.5 ${isCreate ? 'cursor-pointer' : 'cursor-default'} ${
                        selected
                          ? 'border-brand-teal bg-brand-teal text-white'
                          : `border-slate-300 ${locked ? 'opacity-50' : 'hover:border-blue-400 hover:bg-brand-teal-tint'}`
                      }`}
                    >
                      <input type="radio" name="ts-kind" className="sr-only" checked={selected} disabled={!isCreate} onChange={() => pickKind(card.kind)} />
                      <span className={`block text-[13.5px] font-semibold ${selected ? '' : 'text-slate-900'}`}>{TECHNICAL_SERVICE_KIND_LABELS[card.kind]}</span>
                      <span className={`mt-0.5 block text-[11.5px] ${selected ? 'opacity-90' : 'text-slate-500'}`}>{card.hint}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-category" className={labelClassName}>
                Nhóm dịch vụ
              </label>
              <Combobox id="ts-category" value={categoryCode} onChange={setCategoryCode} options={categoryOptions} placeholder="Chọn nhóm…" disabled={readOnly} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-status" className={labelClassName}>
                Trạng thái
              </label>
              <Combobox
                id="ts-status"
                value={isActive ? '1' : '0'}
                onChange={(v) => setIsActive(v === '1')}
                options={[
                  { value: '1', label: 'Đang dùng' },
                  { value: '0', label: 'Ngưng dùng' },
                ]}
                disabled={readOnly}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-sort" className={labelClassName}>
                Thứ tự hiển thị
              </label>
              <input id="ts-sort" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-national" className={labelClassName}>
                Mã BYT (tuỳ chọn)
              </label>
              <input id="ts-national" value={nationalCode} onChange={(e) => setNationalCode(e.target.value)} className={inputClassName} />
            </div>
          </div>
        </BoxedSection>

        <BoxedSection badge="Nơi thực hiện & kết quả">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
            <input type="checkbox" checked={inHouse} onChange={(e) => changeInHouse(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-600" />
            <span>
              <span className="block text-[13.5px] font-semibold text-emerald-900">Phòng khám tự thực hiện dịch vụ này</span>
              <span className="mt-0.5 block text-xs text-emerald-800">
                Bỏ chọn nếu phòng khám không làm được — bác sĩ vẫn chỉ định được, nhưng dịch vụ chỉ in trên phiếu cho bệnh nhân ra ngoài làm, không tính tiền và không vào hàng đợi.
              </span>
            </span>
          </label>

          {showPartnerSection && (
            <div className="mt-3.5 flex flex-col gap-3" role="group" aria-label="Nơi thực hiện">
              <span className={labelClassName}>Nơi thực hiện</span>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {[
                  { value: false, label: 'Tại phòng khám', hint: 'Kỹ thuật viên nhập kết quả như hiện nay' },
                  { value: true, label: 'Gửi đối tác', hint: 'Lấy mẫu rồi gửi đối tác, nhận kết quả dạng PDF' },
                ].map((card) => {
                  const selected = sentToPartner === card.value;
                  return (
                    <label
                      key={String(card.value)}
                      className={`block rounded-lg border px-3.5 py-2.5 ${partnerEditable ? 'cursor-pointer' : 'cursor-default'} ${
                        selected ? 'border-brand-teal bg-brand-teal text-white' : `border-slate-300 ${partnerEditable ? 'hover:border-blue-400 hover:bg-brand-teal-tint' : 'opacity-60'}`
                      }`}
                    >
                      <input type="radio" name="ts-place" className="sr-only" checked={selected} disabled={!partnerEditable} onChange={() => {
                          setSentToPartner(card.value);
                          if (card.value && turnaround.trim() === '') setTurnaroundUnit('hour');
                        }} />
                      <span className={`block text-[13.5px] font-semibold ${selected ? '' : 'text-slate-900'}`}>{card.label}</span>
                      <span className={`mt-0.5 block text-[11.5px] ${selected ? 'opacity-90' : 'text-slate-500'}`}>{card.hint}</span>
                    </label>
                  );
                })}
              </div>

              {canSeePartnerCost && (sentToPartner || partnerRows.length > 0) && (
                <div>
                  <span className={`${labelClassName} mb-1.5 block`}>Giá trả bên thứ ba theo từng đối tác</span>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <div className="min-w-[640px]">
                      <div role="row" className="grid items-center gap-x-3 border-b-2 border-blue-600 bg-slate-100 px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-800" style={{ gridTemplateColumns: 'minmax(200px,1.6fr) 170px 150px 120px 56px' }}>
                        <div className="text-left">Đối tác</div>
                        <div>Giá trả (đ)</div>
                        <div>Giá niêm yết</div>
                        <div>Mặc định</div>
                        <div />
                      </div>
                      {partnerRows.length === 0 && <p className="px-3 py-3 text-[13px] text-slate-500">Chưa có đối tác nào. Chọn đối tác bên dưới rồi nhập giá trả.</p>}
                      {partnerRows.map((row) => {
                        const margin = partnerMargin(priceInput.amount, row.amount);
                        return (
                          <div key={row.supplierId} role="row" className="grid items-center gap-x-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0" style={{ gridTemplateColumns: 'minmax(200px,1.6fr) 170px 150px 120px 56px' }}>
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-slate-900" title={row.name}>{row.name}</div>
                              <div className="text-xs text-slate-500">{row.code}</div>
                            </div>
                            <div className="relative">
                              <MoneyInput id={`ts-partner-${row.supplierId}`} value={row.amount} onChange={(v) => setPartnerRows((prev) => setPartnerAmount(prev, row.supplierId, v))} disabled={!partnerEditable} className={`${inputClassName} pr-8 text-right tabular-nums`} />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500" aria-hidden="true">đ</span>
                            </div>
                            <div className="text-right tabular-nums">
                              {priceInput.amount === undefined ? <span className="text-slate-400">—</span> : formatVnd(priceInput.amount)}
                              {margin !== null && <div className={`text-[11.5px] font-semibold ${margin < 0 ? 'text-rose-600' : 'text-slate-500'}`}>Lãi {formatVnd(margin)}</div>}
                            </div>
                            <div className="text-center">
                              {row.isDefault ? (
                                <span className="inline-block rounded bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">Mặc định</span>
                              ) : partnerEditable ? (
                                <button type="button" onClick={() => setPartnerRows((prev) => setDefaultPartner(prev, row.supplierId))} className="text-[13px] font-semibold text-blue-600 hover:text-blue-700">Đặt mặc định</button>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </div>
                            <div className="text-center">
                              {partnerEditable && (
                                <button type="button" onClick={() => setPartnerRows((prev) => removePartnerRow(prev, row.supplierId))} aria-label={`Gỡ ${row.name}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600">
                                  <Trash size={16} aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {partnerEditable && (
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex w-72 flex-col gap-1.5">
                        <label htmlFor="ts-partner-add" className={labelClassName}>
                          Thêm đối tác
                        </label>
                        <Combobox
                          id="ts-partner-add"
                          value=""
                          onChange={(id) => {
                            const s = partnerCandidates.find((c) => c.id === id);
                            if (s) setPartnerRows((prev) => addPartnerRow(prev, { id: s.id, code: s.code, name: s.name }));
                          }}
                          options={partnerOptions}
                          placeholder={suppliersQuery.isError ? 'Không tải được danh sách đối tác' : partnerOptions.length === 0 ? 'Không còn đối tác để thêm' : '+ Thêm đối tác…'}
                          disabled={partnerOptions.length === 0}
                        />
                      </div>
                      <span className="text-[13px] text-slate-500">Khách chỉ thấy giá niêm yết. Giá trả đối tác chỉ hiện ở công nợ và đối chiếu.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-3.5 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-dept" className={labelClassName}>
                Khoa/Phòng thực hiện
              </label>
              <Combobox id="ts-dept" value={departmentId} onChange={setDepartmentId} options={departmentOptions} placeholder="Chọn khoa/phòng…" disabled={readOnly || !inHouse} />
              {inHouse && departmentId === '' && !readOnly && (
                <span className="text-xs font-semibold text-amber-700">Chưa chọn phòng — tài khoản giới hạn theo phòng sẽ không thấy dịch vụ này ở hàng đợi.</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-specimen" className={labelClassName}>
                Mẫu bệnh phẩm
              </label>
              <Combobox id="ts-specimen" value={specimenTypeCode} onChange={setSpecimenTypeCode} options={specimenOptions} placeholder={kind === 'LAB' ? 'Chọn mẫu…' : 'Chỉ dùng cho xét nghiệm'} disabled={readOnly || kind !== 'LAB'} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-tat" className={labelClassName}>
                Thời gian trả kết quả
              </label>
              <div className="flex gap-2">
                <input
                  id="ts-tat"
                  inputMode={turnaroundUnit === 'hour' ? 'decimal' : 'numeric'}
                  value={turnaround}
                  onChange={(e) => setTurnaround(e.target.value.replace(turnaroundUnit === 'hour' ? /[^\d.,]/g : /\D/g, ''))}
                  placeholder={turnaroundUnit === 'hour' ? 'Ví dụ: 24' : 'Ví dụ: 120'}
                  className={`${inputClassName} min-w-0 flex-1`}
                />
                <div className="w-[104px] flex-none">
                  <Combobox
                    id="ts-tat-unit"
                    value={turnaroundUnit}
                    onChange={(next) => {
                      if (next !== 'minute' && next !== 'hour') return;
                      if (next === turnaroundUnit) return;
                      setTurnaround((text) => convertTurnaroundText(text, turnaroundUnit, next));
                      setTurnaroundUnit(next);
                    }}
                    options={TURNAROUND_UNIT_OPTIONS}
                    disabled={readOnly}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-rtype" className={labelClassName}>
                Kiểu nhập kết quả
              </label>
              <Combobox id="ts-rtype" value={resultType} onChange={(v) => setResultType(v as TechnicalServiceResultType)} options={RESULT_TYPE_OPTIONS} disabled={readOnly} />
            </div>
          </div>
        </BoxedSection>

        <BoxedSection badge="Đơn giá dịch vụ">
          {!inHouse ? (
            <p className="text-sm text-slate-600">Dịch vụ chỉ định ra ngoài không tính tiền tại phòng khám — không cần khai đơn giá.</p>
          ) : priceTypeQuery.isError ? (
            <ErrorBanner message="Không tải được danh mục Loại giá dịch vụ nên chưa khai được đơn giá." onRetry={() => void priceTypeQuery.refetch()} />
          ) : priceTypeQuery.isLoading ? (
            // Chưa hiện ô giá khi danh mục Loại giá chưa tải xong: mức đang quản lý phụ thuộc mức mặc định, nếu người dùng gõ giá trước lúc đó thì giá sẽ bám sang mức khác khi danh mục về.
            <Skeleton className="h-20 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-1 items-start gap-x-3 gap-y-3.5 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ts-unit" className={labelClassName}>
                    Đơn vị tính <span className="text-rose-500">*</span>
                  </label>
                  <Combobox id="ts-unit" value={priceInput.unitCode} onChange={(v) => editPrice({ unitCode: v })} options={unitOptions} placeholder="Chọn đơn vị…" disabled={readOnly} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ts-amount" className={labelClassName}>
                    Đơn giá <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <MoneyInput id="ts-amount" value={priceInput.amount} onChange={(v) => editPrice({ amount: v })} disabled={readOnly} className={`${inputClassName} pr-8 text-right tabular-nums`} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500" aria-hidden="true">
                      đ
                    </span>
                  </div>
                </div>
                <p className="text-[13px] text-slate-600 sm:pt-7">
                  Giá niêm yết của dịch vụ. Khuyến mại có hạn đặt ở <span className="font-semibold text-slate-700">Bảng giá</span>.
                </p>
              </div>

              {hiddenOtherPriceTypes.length > 0 && (
                <p className="mt-3.5 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
                  <Info size={16} weight="fill" className="mt-0.5 flex-none text-slate-500" aria-hidden="true" />
                  <span>
                    Dịch vụ này còn <span className="font-semibold text-slate-700">{hiddenOtherPriceTypes.length} mức giá cũ đã ẩn</span> ({hiddenOtherPriceTypes.map(priceTypeLabel).join(', ')}). Hệ thống đang dùng mức{' '}
                    <span className="font-semibold text-slate-700">{priceTypeLabel(priceModel.priceTypeCode)}</span>; sửa ô trên là ghi lại mức đang dùng, các mức cũ không bị xoá.
                  </span>
                </p>
              )}

              <div className="mt-3.5 border-t border-slate-100 pt-3.5">
                <div className="flex items-start gap-2.5">
                  <input
                    id="ts-schedule"
                    type="checkbox"
                    checked={priceInput.scheduleEnabled}
                    onChange={(e) => editPrice({ scheduleEnabled: e.target.checked })}
                    disabled={readOnly}
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                  />
                  <div>
                    <label htmlFor="ts-schedule" className={`${labelClassName} cursor-pointer`}>
                      Hẹn đổi giá từ ngày…
                    </label>
                    <p className="mt-0.5 text-[13px] text-slate-500">Không tích thì giá trên áp dụng ngay khi lưu.</p>
                  </div>
                </div>

                {priceInput.scheduleEnabled && (
                  <div className="ml-6 mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                    <div className="grid grid-cols-1 items-start gap-x-3 gap-y-3.5 sm:grid-cols-3">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="ts-new-amount" className={labelClassName}>
                          Giá mới <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative">
                          <MoneyInput id="ts-new-amount" value={priceInput.scheduleAmount} onChange={(v) => editPrice({ scheduleAmount: v })} disabled={readOnly} className={`${inputClassName} pr-8 text-right tabular-nums`} />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500" aria-hidden="true">
                            đ
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="ts-new-from" className={labelClassName}>
                          Áp dụng từ ngày <span className="text-rose-500">*</span>
                        </label>
                        <DateInput id="ts-new-from" value={priceInput.scheduleFrom} onChange={(v) => editPrice({ scheduleFrom: v })} disabled={readOnly} />
                      </div>
                      {priceInput.amount !== undefined && priceInput.scheduleFrom !== '' && (
                        <p className="text-[13px] text-slate-600 sm:pt-7">
                          Giá <span className="font-semibold tabular-nums text-slate-700">{formatVnd(priceInput.amount)}</span> giữ đến{' '}
                          <span className="font-semibold tabular-nums text-slate-700">{dayBefore(priceInput.scheduleFrom).split('-').reverse().join('/')}</span>.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </BoxedSection>

        {showIndicators && (
          <BoxedSection badge="Chỉ số xét nghiệm của dịch vụ">
            {!readOnly && (
              <div className="relative">
                <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Tìm chỉ số để thêm"
                  value={indicatorSearch}
                  onChange={(e) => setIndicatorSearch(e.target.value)}
                  placeholder="Gõ tên hoặc mã chỉ số để thêm (VD: Ferritin, HGB…)"
                  className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                {searchResults.length > 0 && (
                  <ul role="listbox" aria-label="Kết quả tìm chỉ số" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                    {searchResults.map((ind) => (
                      <li key={ind.id} role="option" aria-selected={false}>
                        <button
                          type="button"
                          onClick={() => {
                            setIndicators((prev) => [...prev, { indicatorId: ind.id, code: ind.code, name: ind.name, unit: ind.unit, interpretationText: undefined }]);
                            setIndicatorSearch('');
                          }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          <span className="font-semibold text-slate-900">{ind.name}</span>
                          <span className="text-xs font-semibold text-slate-500">
                            {ind.code}
                            {ind.unit ? ` · ${ind.unit}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                    <th className="w-14 px-2 py-2.5 text-center">TT</th>
                    <th className="w-32 px-2 py-2.5 text-center">Mã</th>
                    <th className="px-2 py-2.5 text-center">Tên chỉ số</th>
                    <th className="w-28 px-2 py-2.5 text-center">Đơn vị</th>
                    <th className="w-48 px-2 py-2.5 text-center">Tham chiếu</th>
                    <th className="w-12 px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {indicators.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center font-medium italic text-slate-400">
                        Chưa gắn chỉ số nào
                      </td>
                    </tr>
                  )}
                  {indicators.map((row, index) => {
                    const refCount = referenceCountById.get(row.indicatorId);
                    return (
                      <tr key={row.indicatorId} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-2.5 text-center font-medium text-slate-600">{index + 1}</td>
                        <td className="px-2 py-2.5 text-center font-semibold text-slate-800">{row.code}</td>
                        <td className="px-2.5 py-2.5 text-left font-medium text-slate-900">{row.name}</td>
                        <td className="px-2 py-2.5 text-center font-medium text-slate-600">{row.unit ?? '—'}</td>
                        <td className="px-2 py-2.5 text-center font-medium text-slate-600">{refCount === undefined ? '—' : refCount === 0 ? 'Chưa khai' : `${refCount} khoảng`}</td>
                        <td className="px-2 py-2.5 text-center">
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => setIndicators((prev) => prev.filter((i) => i.indicatorId !== row.indicatorId))}
                              aria-label="Gỡ chỉ số khỏi dịch vụ"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-50 text-rose-600 hover:bg-rose-100"
                            >
                              <Trash size={14} aria-hidden="true" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </BoxedSection>
        )}

        <ServiceNormSection editor={normEditor} readOnly={readOnly} idPrefix="ts" />

        {rowError && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
            <Warning size={15} weight="fill" className="flex-none" aria-hidden="true" />
            {rowError}
          </div>
        )}
        <RecordFormNotice saveError={saveError} onReload={isCreate ? undefined : onReload} />
      </fieldset>

      <div className="flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
        <Button type="button" variant="secondary" onClick={onClose}>
          {readOnly ? 'Đóng' : 'Huỷ'}
        </Button>
        {readOnly ? (
          detail && (
            <CanEditButton onClick={() => onSwitchToEdit(detail.id)} />
          )
        ) : (
          <Button type="submit" loading={submitting} disabled={invalid}>
            Lưu dịch vụ
          </Button>
        )}
      </div>
    </form>
  );
}


function CanEditButton({ onClick }: { onClick: () => void }) {
  const canUpdate = useHasPermission('technical_service', 'update');
  if (!canUpdate) return null;
  return (
    <Button type="button" onClick={onClick}>
      Sửa dịch vụ
    </Button>
  );
}
