import { useMemo, useState } from 'react';
import { MagnifyingGlass, Package, Trash, Warning, X } from '@phosphor-icons/react';
import type {
  CreateServicePackageRequest,
  PriceableItem,
  ServicePackageDetail,
  ServicePackageItemInput,
  ServicePackagePricingMode,
  UpdateServicePackageRequest,
} from '@nexamed/shared';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { RecordFormNotice } from '../../shared/ui/RecordFormNotice';
import { Skeleton } from '../../shared/ui/Skeleton';
import { TwoOptionToggle } from '../../shared/ui/TwoOptionToggle';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';
import { formatVnd } from '../../shared/format/currency';
import { useHasPermission } from '../auth/usePermission';
import { SERVICE_PACKAGE_PRICING_MODE_LABELS } from './pricing-labels';
import { useCreateServicePackageMutation, usePriceableItemSearch, useServicePackageQuery, useUpdateServicePackageMutation } from './pricing.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-800';
const labelClassName = 'text-sm font-semibold text-slate-800';

const MODE_CARDS: { mode: ServicePackagePricingMode; hint: string }[] = [
  { mode: 'FIXED', hint: 'Hoá đơn ghi đúng một dòng "gói". Giá dịch vụ con không cộng vào.' },
  { mode: 'SUM_MINUS_DISCOUNT', hint: 'Giá gói tự tính lại khi đơn giá dịch vụ con đổi.' },
];

interface PackageRow {
  itemKind: 'EXAM_TYPE' | 'TECHNICAL_SERVICE';
  /** `examTypeCode` (dịch vụ khám) hoặc id dịch vụ kỹ thuật — duy nhất trong gói. */
  ref: string;
  code: string;
  name: string;
  groupName: string | null;
  quantity: number;
  /** Giá lẻ 1 đơn vị hôm nay; `null` = chưa có giá. */
  unitPrice: number | null;
}

/** Giá lẻ của 1 dịch vụ = mức giá ĐẦU TIÊN có giá (cùng quy tắc ở API) — chỉ để xem trước, số chính thức do API tính lại. */
function listPriceOf(item: PriceableItem): number | null {
  return item.scopes.find((s) => s.amount !== null)?.amount ?? null;
}

function toRow(item: PriceableItem): PackageRow | null {
  if (item.itemKind !== 'EXAM_TYPE' && item.itemKind !== 'TECHNICAL_SERVICE') return null;
  return { itemKind: item.itemKind, ref: item.ref, code: item.code, name: item.name, groupName: item.groupName, quantity: 1, unitPrice: listPriceOf(item) };
}

/** Làm tròn nửa lên về 1 đồng — cùng quy tắc `roundHalfUpDiv` ở API. */
function percentOff(total: number, percent: number): number {
  return Math.max(0, Math.floor((total * (100 - percent) * 2 + 100) / 200));
}

/**
 * Thêm/Sửa/Xem "Gói dịch vụ" (Cận lâm sàng GĐ2, docs/DECISIONS.md #212, mockup màn 4) — 3 khối: Thông tin gói, Cách tính giá gói,
 * Dịch vụ trong gói. Gói nhận Dịch vụ khám + Dịch vụ kỹ thuật, KHÔNG nhận thuốc/vật tư. `mode='view'` chỉ đọc.
 */
export function ServicePackageFormDialog({
  mode,
  packageId,
  onClose,
  onSwitchToEdit,
}: {
  mode: 'create' | 'view' | 'edit';
  packageId: string | null;
  onClose: () => void;
  onSwitchToEdit: (id: string) => void;
}) {
  const detailQuery = useServicePackageQuery(packageId);
  const [formKey, setFormKey] = useState(0);

  async function reload() {
    await detailQuery.refetch();
    setFormKey((k) => k + 1);
  }

  const loading = packageId !== null && detailQuery.isLoading;
  const title = mode === 'create' ? 'Thêm gói dịch vụ' : mode === 'edit' ? 'Sửa gói dịch vụ' : 'Chi tiết gói dịch vụ';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/55 p-4 py-8" role="dialog" aria-modal="true" aria-labelledby="sp-dialog-title">
      <div className="w-full max-w-[1136px] overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-blue-600 text-white">
              <Package size={20} weight="fill" aria-hidden="true" />
            </span>
            <div>
              <h2 id="sp-dialog-title" className="text-[17px] font-bold text-slate-900">
                {title}
              </h2>
              <span className="mt-1 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">Danh mục cận lâm sàng</span>
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
        {detailQuery.isError && <div className="p-6 text-sm text-rose-700">Không tải được gói dịch vụ. Đóng và thử lại.</div>}
        {!loading && !detailQuery.isError && (
          <PackageForm key={formKey} mode={mode} detail={detailQuery.data} onClose={onClose} onSwitchToEdit={onSwitchToEdit} onReload={reload} />
        )}
      </div>
    </div>
  );
}

function PackageForm({
  mode,
  detail,
  onClose,
  onSwitchToEdit,
  onReload,
}: {
  mode: 'create' | 'view' | 'edit';
  detail: ServicePackageDetail | undefined;
  onClose: () => void;
  onSwitchToEdit: (id: string) => void;
  onReload: () => Promise<void>;
}) {
  const readOnly = mode === 'view';
  const isCreate = mode === 'create';
  const { saveError, run } = useSaveAttempt();
  const createMutation = useCreateServicePackageMutation();
  const updateMutation = useUpdateServicePackageMutation();
  const submitting = createMutation.isPending || updateMutation.isPending;

  const [name, setName] = useState(detail?.name ?? '');
  const [isActive, setIsActive] = useState(detail?.isActive ?? true);
  const [pricingMode, setPricingMode] = useState<ServicePackagePricingMode>(detail?.pricingMode ?? 'FIXED');
  const [fixedPrice, setFixedPrice] = useState<number | undefined>(detail?.fixedPrice ?? undefined);
  const [discountType, setDiscountType] = useState<'PERCENT' | 'AMOUNT' | null>(detail?.discountType ?? null);
  const [discountValue, setDiscountValue] = useState<number | undefined>(detail?.discountValue ?? undefined);
  const [effectiveFrom, setEffectiveFrom] = useState(detail?.effectiveFrom ?? '');
  const [effectiveTo, setEffectiveTo] = useState(detail?.effectiveTo ?? '');
  const [rows, setRows] = useState<PackageRow[]>(
    (detail?.items ?? []).map((i) => ({
      itemKind: i.itemKind,
      ref: i.itemKind === 'EXAM_TYPE' ? (i.examTypeCode ?? '') : (i.technicalServiceId ?? ''),
      code: i.code,
      name: i.name,
      groupName: i.groupName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
  );
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const [rowError, setRowError] = useState<string | null>(null);

  // Gói chỉ nhận Dịch vụ khám + Dịch vụ kỹ thuật → tìm 2 loại này riêng rồi gộp.
  const examResults = usePriceableItemSearch(debouncedSearch, 'EXAM_TYPE');
  const techResults = usePriceableItemSearch(debouncedSearch, 'TECHNICAL_SERVICE');
  const addedKeys = new Set(rows.map((r) => `${r.itemKind}:${r.ref}`));
  const searchResults = useMemo(() => {
    if (debouncedSearch === '') return [];
    const all = [...(examResults.data?.items ?? []), ...(techResults.data?.items ?? [])];
    return all.filter((i) => !addedKeys.has(`${i.itemKind}:${i.ref}`)).slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, examResults.data, techResults.data, rows]);

  const retailTotal = rows.reduce((sum, r) => (r.unitPrice === null ? sum : sum + r.unitPrice * r.quantity), 0);
  const unpricedCount = rows.filter((r) => r.unitPrice === null).length;
  const packagePrice: number | null =
    pricingMode === 'FIXED'
      ? (fixedPrice ?? null)
      : discountType === 'PERCENT'
        ? percentOff(retailTotal, Math.min(100, discountValue ?? 0))
        : discountType === 'AMOUNT'
          ? Math.max(0, retailTotal - (discountValue ?? 0))
          : retailTotal;
  const saving = packagePrice === null ? null : retailTotal - packagePrice;
  const savingPercent = saving !== null && retailTotal > 0 ? Math.round((saving / retailTotal) * 1000) / 10 : null;

  const invalid = name.trim() === '' || rows.length === 0 || effectiveFrom === '' || (pricingMode === 'FIXED' && fixedPrice === undefined);

  function pickItem(item: PriceableItem) {
    const row = toRow(item);
    if (row) setRows((prev) => [...prev, row]);
    setSearch('');
  }

  function updateQuantity(index: number, quantity: number) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, quantity: Math.min(999, Math.max(1, quantity || 1)) } : r)));
  }

  const itemsPayload = (): ServicePackageItemInput[] =>
    rows.map((r) =>
      r.itemKind === 'EXAM_TYPE'
        ? { itemKind: 'EXAM_TYPE', examTypeCode: r.ref, quantity: r.quantity }
        : { itemKind: 'TECHNICAL_SERVICE', technicalServiceId: r.ref, quantity: r.quantity },
    );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || invalid) return;
    setRowError(null);
    if (effectiveTo !== '' && effectiveTo < effectiveFrom) {
      setRowError('Ngày kết thúc phải sau hoặc bằng Ngày hiệu lực.');
      return;
    }
    if (pricingMode === 'SUM_MINUS_DISCOUNT' && (discountType === null) !== (discountValue === undefined)) {
      setRowError('Chiết khấu phải có cả cách tính (% hoặc tiền) và giá trị — hoặc bỏ trống cả hai.');
      return;
    }
    if (pricingMode === 'SUM_MINUS_DISCOUNT' && discountType === 'PERCENT' && (discountValue ?? 0) > 100) {
      setRowError('Chiết khấu phần trăm tối đa 100.');
      return;
    }

    const ok = await run(async () => {
      if (isCreate) {
        const body: CreateServicePackageRequest = {
          name: name.trim(),
          pricingMode,
          isActive,
          sortOrder: 0,
          effectiveFrom,
          ...(effectiveTo ? { effectiveTo } : {}),
          ...(pricingMode === 'FIXED' ? { fixedPrice } : {}),
          ...(pricingMode === 'SUM_MINUS_DISCOUNT' && discountType !== null && discountValue !== undefined ? { discountType, discountValue } : {}),
          items: itemsPayload(),
        };
        await createMutation.mutateAsync(body);
      } else {
        const body: UpdateServicePackageRequest = {
          version: detail!.version,
          name: name.trim(),
          pricingMode,
          isActive,
          effectiveFrom,
          effectiveTo: effectiveTo || null,
          fixedPrice: pricingMode === 'FIXED' ? (fixedPrice ?? null) : null,
          discountType: pricingMode === 'SUM_MINUS_DISCOUNT' ? discountType : null,
          discountValue: pricingMode === 'SUM_MINUS_DISCOUNT' && discountType !== null ? (discountValue ?? null) : null,
          items: itemsPayload(),
        };
        await updateMutation.mutateAsync({ id: detail!.id, body });
      }
    });
    if (ok) onClose();
  }

  return (
    <form onSubmit={handleSubmit}>
      <fieldset disabled={readOnly} className="flex max-h-[72vh] min-w-0 flex-col gap-7 overflow-y-auto border-0 p-6 pt-7">
        <BoxedSection badge="Thông tin gói">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sp-code" className={labelClassName}>
                Mã gói
              </label>
              <input id="sp-code" value={detail?.code ?? ''} readOnly placeholder="Tự động" className={`${inputClassName} bg-slate-50`} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <label htmlFor="sp-name" className={labelClassName}>
                Tên gói <span className="text-rose-500">*</span>
              </label>
              <input id="sp-name" autoFocus={!readOnly} value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sp-status" className={labelClassName}>
                Trạng thái
              </label>
              <Combobox
                id="sp-status"
                value={isActive ? '1' : '0'}
                onChange={(v) => setIsActive(v === '1')}
                options={[
                  { value: '1', label: 'Đang dùng' },
                  { value: '0', label: 'Ngưng dùng' },
                ]}
                disabled={readOnly}
              />
            </div>
          </div>
        </BoxedSection>

        <BoxedSection badge="Cách tính giá gói">
          <div role="radiogroup" aria-label="Cách tính giá gói" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {MODE_CARDS.map((card) => {
              const selected = pricingMode === card.mode;
              return (
                <label
                  key={card.mode}
                  className={`block rounded-lg border px-3.5 py-3 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${
                    selected ? 'border-brand-teal bg-brand-teal text-white' : `border-slate-300 ${readOnly ? '' : 'hover:border-blue-400 hover:bg-brand-teal-tint'}`
                  }`}
                >
                  <input type="radio" name="sp-mode" className="sr-only" checked={selected} disabled={readOnly} onChange={() => setPricingMode(card.mode)} />
                  <span className={`block text-[13.5px] font-bold ${selected ? '' : 'text-slate-900'}`}>{SERVICE_PACKAGE_PRICING_MODE_LABELS[card.mode]}</span>
                  <span className={`mt-0.5 block text-[11.5px] ${selected ? 'opacity-90' : 'text-slate-500'}`}>{card.hint}</span>
                </label>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 items-end gap-x-3 gap-y-3.5 sm:grid-cols-4">
            {pricingMode === 'FIXED' ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sp-price" className={labelClassName}>
                  Giá gói <span className="text-rose-500">*</span>
                </label>
                <MoneyInput id="sp-price" value={fixedPrice} onChange={setFixedPrice} disabled={readOnly} className={`${inputClassName} text-right`} />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className={labelClassName}>Chiết khấu</span>
                <div className="flex items-center gap-2">
                  <TwoOptionToggle
                    options={[
                      { value: 'PERCENT', label: '%' },
                      { value: 'AMOUNT', label: 'Tiền' },
                    ]}
                    value={discountType}
                    onChange={(next) => {
                      setDiscountType(next);
                      if (next === null) setDiscountValue(undefined);
                    }}
                    disabled={readOnly}
                  />
                  {discountType === 'AMOUNT' ? (
                    <MoneyInput id="sp-discount" value={discountValue} onChange={setDiscountValue} disabled={readOnly} className={`${inputClassName} text-right`} />
                  ) : (
                    <input
                      id="sp-discount"
                      aria-label="Giá trị chiết khấu"
                      inputMode="numeric"
                      value={discountValue ?? ''}
                      disabled={readOnly || discountType === null}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '');
                        setDiscountValue(digits === '' ? undefined : Math.min(100, Number(digits)));
                      }}
                      className={`${inputClassName} text-right`}
                    />
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sp-from" className={labelClassName}>
                Hiệu lực từ <span className="text-rose-500">*</span>
              </label>
              <DateInput id="sp-from" value={effectiveFrom} onChange={setEffectiveFrom} disabled={readOnly} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sp-to" className={labelClassName}>
                Đến ngày
              </label>
              <DateInput id="sp-to" value={effectiveTo} onChange={setEffectiveTo} disabled={readOnly} />
            </div>
            <div className="pb-0.5">
              <span className="block text-xs text-slate-500">{pricingMode === 'FIXED' ? 'Tổng giá lẻ các dịch vụ con' : 'Giá gói sau chiết khấu'}</span>
              <span className="mt-0.5 block text-base font-bold tabular-nums text-slate-900">
                {pricingMode === 'FIXED' ? formatVnd(retailTotal) : packagePrice === null ? '—' : formatVnd(packagePrice)}
              </span>
              {saving !== null && retailTotal > 0 && (
                <span className={`mt-px block text-xs font-semibold ${saving >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {saving >= 0 ? `Khách lợi ${formatVnd(saving)}` : `Đắt hơn mua lẻ ${formatVnd(-saving)}`}
                  {savingPercent !== null && ` (${Math.abs(savingPercent).toLocaleString('vi-VN')}%)`}
                </span>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Để trống "Đến ngày" nếu gói áp dụng không giới hạn thời gian.</p>
        </BoxedSection>

        <BoxedSection badge="Dịch vụ trong gói">
          {!readOnly && (
            <div className="relative">
              <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                aria-label="Tìm dịch vụ để thêm vào gói"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  // Enter ở ô tìm CHỈ để chọn kết quả đầu — không submit cả form (ui-guidelines mục 4.4).
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const first = searchResults[0];
                    if (first) pickItem(first);
                  }
                }}
                placeholder="Gõ tên hoặc mã để thêm — gồm cả Dịch vụ khám và Dịch vụ kỹ thuật…"
                className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              {searchResults.length > 0 && (
                <ul role="listbox" aria-label="Kết quả tìm dịch vụ" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                  {searchResults.map((item) => (
                    <li key={`${item.itemKind}:${item.ref}`} role="option" aria-selected={false}>
                      <button type="button" onClick={() => pickItem(item)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <span className="min-w-0 truncate font-semibold text-slate-900">{item.name}</span>
                        <span className="flex-none text-xs font-semibold text-slate-500">
                          {item.itemKind === 'EXAM_TYPE' ? 'Dịch vụ khám' : 'Dịch vụ KT'} · {item.code}
                          {listPriceOf(item) !== null ? ` · ${formatVnd(listPriceOf(item) as number)}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">Gói nhận Dịch vụ khám và Dịch vụ kỹ thuật. Không nhận thuốc/vật tư — những thứ đó trừ kho theo lô và phải có y lệnh của bác sĩ.</p>

          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            <div className="scroll-hover overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                    <th className="w-12 px-2 py-2.5 text-center">TT</th>
                    <th className="w-32 px-2 py-2.5 text-center">Loại</th>
                    <th className="w-28 px-2 py-2.5 text-center">Mã</th>
                    <th className="px-2 py-2.5 text-center">Tên dịch vụ</th>
                    <th className="w-36 px-2 py-2.5 text-center">Nhóm</th>
                    <th className="w-20 px-2 py-2.5 text-center">SL</th>
                    <th className="w-32 px-2 py-2.5 text-center">Giá lẻ</th>
                    <th className="w-12 px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center font-medium italic text-slate-400">
                        Chưa có dịch vụ nào trong gói
                      </td>
                    </tr>
                  )}
                  {rows.map((row, index) => (
                    <tr key={`${row.itemKind}:${row.ref}`} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2.5 text-center font-medium text-slate-600">{index + 1}</td>
                      <td className="px-2 py-2.5 text-center">
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{row.itemKind === 'EXAM_TYPE' ? 'Dịch vụ khám' : 'Dịch vụ KT'}</span>
                      </td>
                      <td className="px-2 py-2.5 text-center font-semibold text-slate-800">{row.code}</td>
                      <td className="px-2.5 py-2.5 text-left font-medium text-slate-900">{row.name}</td>
                      <td className="px-2 py-2.5 text-center font-medium text-slate-600">{row.groupName ?? '—'}</td>
                      <td className="px-2 py-1.5 text-center">
                        {readOnly ? (
                          <span className="font-medium text-slate-700">{row.quantity}</span>
                        ) : (
                          <input
                            aria-label={`Số lượng ${row.name}`}
                            inputMode="numeric"
                            value={row.quantity}
                            onChange={(e) => updateQuantity(index, Number(e.target.value.replace(/\D/g, '')))}
                            className="w-14 rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                        {row.unitPrice === null ? <span className="font-normal text-slate-400">Chưa có giá</span> : formatVnd(row.unitPrice)}
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                            aria-label={`Xoá ${row.name} khỏi gói`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-50 text-rose-600 hover:bg-rose-100"
                          >
                            <Trash size={14} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-7 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
              <span className="text-[13px] font-semibold text-slate-700">Tổng {rows.length} dịch vụ</span>
              <span className="text-base font-bold tabular-nums text-slate-900">{formatVnd(retailTotal)}</span>
            </div>
          </div>
          {unpricedCount > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <Warning size={14} weight="fill" aria-hidden="true" />
              {unpricedCount} dịch vụ chưa có đơn giá hôm nay — chưa được cộng vào tổng giá lẻ.
            </p>
          )}
        </BoxedSection>

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
          detail && <CanEditButton onClick={() => onSwitchToEdit(detail.id)} />
        ) : (
          <Button type="submit" loading={submitting} disabled={invalid}>
            Lưu gói dịch vụ
          </Button>
        )}
      </div>
    </form>
  );
}

function CanEditButton({ onClick }: { onClick: () => void }) {
  const canUpdate = useHasPermission('service_package', 'update');
  if (!canUpdate) return null;
  return (
    <Button type="button" onClick={onClick}>
      Sửa gói dịch vụ
    </Button>
  );
}
