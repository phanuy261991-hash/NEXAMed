import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Lock, MagnifyingGlass, Package, Plus, Trash, Warning } from '@phosphor-icons/react';
import type { ClinicalOrderDetail, ClinicalOrderPerformance, SaveClinicalOrderRequest, TechnicalServiceItem } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { RecordFormNotice } from '../../shared/ui/RecordFormNotice';
import { Skeleton } from '../../shared/ui/Skeleton';
import { TwoOptionToggle } from '../../shared/ui/TwoOptionToggle';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { formatVnd } from '../../shared/format/currency';
import { stripDiacritics } from '../../shared/format/strip-diacritics';
import { makeDraftId } from '../../shared/make-draft-id';
import { PrintButton } from '../../shared/print/PrintButton';
import { useHasPermission } from '../auth/usePermission';
import { useTechnicalServicesQuery } from '../paraclinical/paraclinical.queries';
import { getServicePackage, resolvePrices } from '../pricing/pricing.api';
import { useServicePackagesQuery } from '../pricing/pricing.queries';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { ClinicalOrderPrintView } from './ClinicalOrderPrintView';
import { useClinicalOrderQuery, usePrintClinicalOrderMutation, useSaveClinicalOrderMutation } from './clinical-order.queries';

/** 1 dịch vụ lẻ đang soạn. `id` có = đã lưu trên phiếu; `locked` = tiền đã thu/đã thực hiện nên không gỡ/đổi được. */
interface DraftItem {
  key: string;
  id?: string;
  performance: ClinicalOrderPerformance;
  technicalServiceId?: string;
  freeTextName?: string;
  code: string | null;
  name: string;
  placeName: string | null;
  quantity: number;
  note: string;
  /** Đơn giá xem trước (dòng chưa lưu) hoặc đã chốt (đã lưu) — `null` = không tính tiền. */
  unitPrice: number | null;
  locked: boolean;
}

interface DraftChild {
  code: string | null;
  name: string;
  placeName: string | null;
  quantity: number;
}

interface DraftPackage {
  key: string;
  id?: string;
  servicePackageId: string;
  code: string;
  name: string;
  unitPrice: number;
  children: DraftChild[];
  locked: boolean;
}

interface Draft {
  items: DraftItem[];
  packages: DraftPackage[];
}

function fromServer(order: ClinicalOrderDetail | null): Draft {
  if (!order) return { items: [], packages: [] };
  return {
    items: order.items
      .filter((i) => i.packageId === null)
      .map((i) => ({
        key: i.id,
        id: i.id,
        performance: i.performance,
        technicalServiceId: i.technicalServiceId ?? undefined,
        freeTextName: i.itemKind === 'FREE_TEXT' ? i.name : undefined,
        code: i.code,
        name: i.name,
        placeName: i.placeName,
        quantity: i.quantity,
        note: i.note ?? '',
        unitPrice: i.unitPrice,
        locked: !i.editable,
      })),
    packages: order.packages.map((p) => ({
      key: p.id,
      id: p.id,
      servicePackageId: p.servicePackageId,
      code: p.code,
      name: p.name,
      unitPrice: p.unitPrice,
      children: order.items.filter((i) => i.packageId === p.id).map((i) => ({ code: i.code, name: i.name, placeName: i.placeName, quantity: i.quantity })),
      locked: !p.editable,
    })),
  };
}

/** Chữ ký nội dung để biết có thay đổi chưa lưu (so với bản server). */
function signature(draft: Draft): string {
  return JSON.stringify([
    draft.items.map((i) => [i.id ?? '', i.performance, i.technicalServiceId ?? '', i.freeTextName ?? '', i.quantity, i.performance === 'EXTERNAL' ? i.note.trim() : '']),
    draft.packages.map((p) => [p.id ?? '', p.servicePackageId]),
  ]);
}

const inputClassName =
  'w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50';

/**
 * Tab "Chỉ định cận lâm sàng" của màn khám (Cận lâm sàng GĐ3, docs/DECISIONS.md #212, mockup màn 5). Bác sĩ chọn 2 đường: "Làm tại phòng khám" (có giá, vào
 * hoá đơn + hàng đợi) hoặc "Chỉ định ra ngoài" (không giá, chỉ in phiếu, cho phép tên tự do); "+ Thêm theo gói" thêm cả gói (hoá đơn ghi 1 dòng gói). Lưu = gửi
 * TOÀN BỘ danh sách; server cộng/trừ tiền vào hoá đơn. Dòng đã thu tiền khoá lại. Đơn giá hiển thị trên dòng chưa lưu là bản XEM TRƯỚC (sau bảng giá có
 * thời hạn theo hôm nay) — số chốt do server tính lúc lưu.
 */
export function ClinicalOrderPanel({
  encounterId,
  isEditableEncounter,
  encounterNo,
  patientFullName,
  patientCode,
  patientDob,
  patientGender,
  patientPhone,
  diagnosisLabel,
  doctorName,
}: {
  encounterId: string;
  isEditableEncounter: boolean;
  encounterNo?: string;
  patientFullName: string;
  patientCode: string;
  patientDob: string;
  patientGender: string;
  patientPhone?: string;
  diagnosisLabel?: string;
  doctorName: string;
}) {
  const canCreate = useHasPermission('clinical_order', 'create');
  const canEdit = canCreate && isEditableEncounter;
  const query = useClinicalOrderQuery(encounterId);
  const saveMutation = useSaveClinicalOrderMutation(encounterId);
  const printMutation = usePrintClinicalOrderMutation(encounterId);
  const { saveError, run, clear } = useSaveAttempt();

  const serverOrder = query.data?.order ?? null;
  const [draft, setDraft] = useState<Draft>({ items: [], packages: [] });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [mode, setMode] = useState<ClinicalOrderPerformance>('IN_HOUSE');
  const [searchText, setSearchText] = useState('');
  /** Dòng đang được tô trong danh sách kết quả (phím ↑↓); Enter thêm đúng dòng này. */
  const [activeIndex, setActiveIndex] = useState(0);
  const search = useDebouncedValue(searchText.trim(), 200);
  const [packageMenuOpen, setPackageMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Nạp từ server đúng 1 lần cho MỖI (lượt khám, phiên bản phiếu) — không ghi đè bản nháp đang soạn khi query tự refetch.
  const serverKey = `${encounterId}:${serverOrder?.id ?? 'none'}:${serverOrder?.version ?? 0}`;
  useEffect(() => {
    if (query.isSuccess && loadedFor !== serverKey) {
      setDraft(fromServer(serverOrder));
      setLoadedFor(serverKey);
    }
  }, [query.isSuccess, serverOrder, serverKey, loadedFor]);

  const servicesQuery = useTechnicalServicesQuery({ includeInactive: false });
  const packagesQuery = useServicePackagesQuery({ orderableOnly: true });

  const results = useMemo(() => {
    if (search === '') return [];
    const needle = stripDiacritics(search);
    return (servicesQuery.data?.items ?? [])
      .filter((s) => [s.code, s.name, s.shortName ?? ''].some((f) => stripDiacritics(f).includes(needle)))
      .filter((s) => !draft.items.some((d) => d.technicalServiceId === s.id && d.performance === (s.isPerformedInHouse && mode === 'IN_HOUSE' ? 'IN_HOUSE' : 'EXTERNAL')))
      .slice(0, 8);
  }, [search, servicesQuery.data, draft.items, mode]);

  const dirty = loadedFor === serverKey && signature(draft) !== signature(fromServer(serverOrder));
  const inHouseItems = draft.items.filter((i) => i.performance === 'IN_HOUSE');
  const externalItems = draft.items.filter((i) => i.performance === 'EXTERNAL');
  const inHouseTotal = inHouseItems.reduce((sum, i) => sum + (i.unitPrice ?? 0) * i.quantity, 0) + draft.packages.reduce((sum, p) => sum + p.unitPrice, 0);
  const inHouseCount = inHouseItems.length + draft.packages.reduce((sum, p) => sum + Math.max(1, p.children.length), 0);

  async function addService(service: TechnicalServiceItem) {
    if (adding) return;
    setLocalError(null);
    // Dịch vụ phòng khám không tự làm được tự xếp vào "ra ngoài" (mockup 5).
    const performance: ClinicalOrderPerformance = mode === 'IN_HOUSE' && service.isPerformedInHouse ? 'IN_HOUSE' : 'EXTERNAL';
    let unitPrice: number | null = null;
    if (performance === 'IN_HOUSE') {
      setAdding(true);
      try {
        const res = await resolvePrices({ date: getVietnamTodayDateString(), items: [{ itemKind: 'TECHNICAL_SERVICE', ref: service.id }] });
        unitPrice = res.items[0]?.amount ?? null;
      } catch {
        unitPrice = service.currentPrices[0]?.amount ?? null;
      } finally {
        setAdding(false);
      }
      if (unitPrice === null) {
        setLocalError(`"${service.name}" chưa có đơn giá hiệu lực — khai đơn giá ở Danh mục cận lâm sàng hoặc chỉ định ra ngoài.`);
        return;
      }
    }
    setDraft((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { key: makeDraftId(), performance, technicalServiceId: service.id, code: service.code, name: service.name, placeName: performance === 'IN_HOUSE' ? service.departmentName : null, quantity: 1, note: '', unitPrice, locked: false },
      ],
    }));
    setSearchText('');
  }

  function addFreeText() {
    const name = searchText.trim();
    if (name === '') return;
    setDraft((prev) => ({
      ...prev,
      items: [...prev.items, { key: makeDraftId(), performance: 'EXTERNAL', freeTextName: name, code: null, name, placeName: null, quantity: 1, note: '', unitPrice: null, locked: false }],
    }));
    setSearchText('');
  }

  async function addPackage(servicePackageId: string) {
    if (adding) return;
    setLocalError(null);
    setPackageMenuOpen(false);
    setAdding(true);
    try {
      const detail = await getServicePackage(servicePackageId);
      const resolved = await resolvePrices({ date: getVietnamTodayDateString(), items: [{ itemKind: 'PACKAGE', ref: servicePackageId }] });
      const price = resolved.items[0]?.amount ?? detail.price;
      if (price === null) {
        setLocalError(`Gói "${detail.name}" chưa tính được giá.`);
        return;
      }
      setDraft((prev) => ({
        ...prev,
        packages: [
          ...prev.packages,
          { key: makeDraftId(), servicePackageId, code: detail.code, name: detail.name, unitPrice: price, children: detail.items.map((i) => ({ code: i.code, name: i.name, placeName: null, quantity: i.quantity })), locked: false },
        ],
      }));
    } catch {
      setLocalError('Không tải được gói dịch vụ. Thử lại.');
    } finally {
      setAdding(false);
    }
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setDraft((prev) => ({ ...prev, items: prev.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  }

  function buildRequest(): SaveClinicalOrderRequest {
    return {
      items: draft.items.map((i) => ({
        ...(i.id ? { id: i.id } : {}),
        performance: i.performance,
        ...(i.technicalServiceId ? { technicalServiceId: i.technicalServiceId } : { freeTextName: i.freeTextName }),
        quantity: i.quantity,
        ...(i.performance === 'EXTERNAL' && i.note.trim() !== '' ? { note: i.note.trim() } : {}),
      })),
      packages: draft.packages.map((p) => ({ ...(p.id ? { id: p.id } : {}), servicePackageId: p.servicePackageId })),
    };
  }

  async function handleSave() {
    setLocalError(null);
    setSavedFlash(false);
    const ok = await run(async () => {
      const res = await saveMutation.mutateAsync(buildRequest());
      setDraft(fromServer(res.order));
      setLoadedFor(`${encounterId}:${res.order?.id ?? 'none'}:${res.order?.version ?? 0}`);
    });
    if (ok) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    }
  }

  async function handlePrint() {
    if (!serverOrder) return;
    await printMutation.mutateAsync();
    setTimeout(() => window.print(), 100);
  }

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <TwoOptionToggle
              options={[
                { value: 'IN_HOUSE', label: 'Làm tại phòng khám' },
                { value: 'EXTERNAL', label: 'Chỉ định ra ngoài' },
              ]}
              value={mode}
              onChange={(next) => next !== null && setMode(next)}
            />
            <div className="relative min-w-[260px] flex-1">
              <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                aria-label="Tìm dịch vụ cận lâm sàng"
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    if (results.length === 0) return;
                    e.preventDefault();
                    setActiveIndex((i) => (e.key === 'ArrowDown' ? Math.min(i + 1, results.length - 1) : Math.max(i - 1, 0)));
                    return;
                  }
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const picked = results[Math.min(activeIndex, results.length - 1)];
                  if (picked) void addService(picked);
                  else if (mode === 'EXTERNAL') addFreeText();
                }}
                placeholder="Gõ tên, mã hoặc viết tắt dịch vụ — VD: ctm, xq nguc, sieu am bung…"
                className="w-full rounded-md border-2 border-blue-600 py-2 pl-9 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              {search !== '' && (results.length > 0 || mode === 'EXTERNAL') && (
                <ul role="listbox" aria-label="Kết quả tìm dịch vụ" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                  {results.map((s, index) => (
                    <li key={s.id} role="option" aria-selected={index === activeIndex}>
                      <button
                        type="button"
                        onClick={() => void addService(s)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 ${index === activeIndex ? 'bg-blue-50' : ''}`}
                      >
                        <span className="min-w-0 truncate font-semibold text-slate-900">{s.name}</span>
                        <span className="flex-none text-xs font-semibold text-slate-500">
                          {s.code}
                          {mode === 'IN_HOUSE' && !s.isPerformedInHouse ? ' · gửi ra ngoài' : s.currentPrices[0] ? ` · ${formatVnd(s.currentPrices[0].amount)}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                  {mode === 'EXTERNAL' && (
                    <li role="option" aria-selected={false}>
                      <button type="button" onClick={addFreeText} className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold text-blue-700 hover:bg-slate-50">
                        <Plus size={14} weight="bold" aria-hidden="true" />
                        Thêm tên tự do: "{searchText.trim()}"
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
            <div className="relative">
              <Button type="button" variant="secondary" onClick={() => setPackageMenuOpen((v) => !v)} loading={adding}>
                <Package size={15} weight="bold" aria-hidden="true" />
                Thêm theo gói
              </Button>
              {packageMenuOpen && (
                <ul role="menu" aria-label="Chọn gói dịch vụ" className="absolute right-0 top-full z-30 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                  {(packagesQuery.data?.items ?? []).length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Chưa có gói dịch vụ nào đang dùng.</li>}
                  {(packagesQuery.data?.items ?? []).map((p) => (
                    <li key={p.id} role="none">
                      <button type="button" role="menuitem" onClick={() => void addPackage(p.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <span className="min-w-0 truncate font-semibold text-slate-900">{p.name}</span>
                        <span className="flex-none text-xs font-semibold text-slate-500">
                          {p.itemCount} DV{p.price !== null ? ` · ${formatVnd(p.price)}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Dịch vụ phòng khám không tự làm được sẽ tự xếp vào nhóm "Chỉ định ra ngoài"; muốn ghi dịch vụ chưa có trong danh mục, chuyển sang "Chỉ định ra ngoài", gõ tên rồi chọn "Thêm tên tự do".
          </p>
        </div>
      )}
      {!canEdit && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {canCreate ? 'Lượt khám không còn ở trạng thái đang khám — chỉ xem được chỉ định.' : 'Bạn chỉ có quyền xem chỉ định cận lâm sàng của lượt khám này.'}
        </p>
      )}

      {draft.items.length === 0 && draft.packages.length === 0 && (
        <EmptyState icon={Package} title="Chưa có chỉ định cận lâm sàng nào" description="Gõ tên dịch vụ vào ô tìm phía trên hoặc bấm 'Thêm theo gói' để chỉ định xét nghiệm, chẩn đoán hình ảnh, thăm dò chức năng." />
      )}

      {(inHouseItems.length > 0 || draft.packages.length > 0) && (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Làm tại phòng khám">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" aria-hidden="true" />
              <h3 className="text-[13.5px] font-bold text-slate-900">Làm tại phòng khám</h3>
              <span className="text-xs text-slate-500">{inHouseCount} dịch vụ · tính tiền, vào hàng đợi, nhập kết quả tại đây</span>
            </div>
            <span className="text-xs font-semibold text-slate-700">
              Tạm tính <strong className="text-[15px] text-slate-900">{formatVnd(inHouseTotal)}</strong>
            </span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                <th className="w-12 px-2 py-2.5 text-center">TT</th>
                <th className="w-28 px-2 py-2.5 text-center">Mã</th>
                <th className="px-2 py-2.5 text-center">Tên dịch vụ</th>
                <th className="w-40 px-2 py-2.5 text-center">Nơi thực hiện</th>
                <th className="w-20 px-2 py-2.5 text-center">SL</th>
                <th className="w-32 px-2 py-2.5 text-center">Đơn giá</th>
                <th className="w-32 px-2 py-2.5 text-center">Thành tiền</th>
                <th className="w-12 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {inHouseItems.map((item, index) => (
                <tr key={item.key} className="border-b border-slate-100">
                  <td className="px-2 py-2.5 text-center font-medium text-slate-600">{index + 1}</td>
                  <td className="px-2 py-2.5 text-center font-semibold text-slate-800">{item.code}</td>
                  <td className="px-2 py-2.5 text-left font-medium text-slate-900">{item.name}</td>
                  <td className="px-2 py-2.5 text-center font-medium text-slate-600">{item.placeName ?? '—'}</td>
                  <td className="px-2 py-1.5 text-center">
                    {canEdit && !item.locked ? (
                      <input
                        aria-label={`Số lượng ${item.name}`}
                        inputMode="numeric"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.key, { quantity: Math.min(999, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)) })}
                        className="w-14 rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    ) : (
                      <span className="font-medium text-slate-700">{item.quantity}</span>
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 text-right font-medium tabular-nums text-slate-700">{item.unitPrice === null ? '—' : formatVnd(item.unitPrice)}</td>
                  <td className="px-2.5 py-2.5 text-right font-bold tabular-nums text-slate-900">{item.unitPrice === null ? '—' : formatVnd(item.unitPrice * item.quantity)}</td>
                  <td className="px-2 py-2.5 text-center">
                    <RowTail locked={item.locked} canEdit={canEdit} label={item.name} onRemove={() => setDraft((p) => ({ ...p, items: p.items.filter((i) => i.key !== item.key) }))} />
                  </td>
                </tr>
              ))}
              {draft.packages.map((pkg) => (
                <PackageRowsView
                  key={pkg.key}
                  pkg={pkg}
                  canEdit={canEdit}
                  onRemove={() => setDraft((p) => ({ ...p, packages: p.packages.filter((x) => x.key !== pkg.key) }))}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {externalItems.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-amber-300 bg-white" aria-label="Chỉ định ra ngoài làm">
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3.5 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-600" aria-hidden="true" />
            <h3 className="text-[13.5px] font-bold text-slate-900">Chỉ định ra ngoài làm</h3>
            <span className="text-xs text-amber-900">{externalItems.length} dịch vụ · không tính tiền, không vào hàng đợi — chỉ in phiếu cho bệnh nhân mang đi</span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                <th className="w-12 px-2 py-2.5 text-center">TT</th>
                <th className="w-28 px-2 py-2.5 text-center">Mã</th>
                <th className="px-2 py-2.5 text-center">Tên dịch vụ</th>
                <th className="w-80 px-2 py-2.5 text-center">Ghi chú cho bệnh nhân</th>
                <th className="w-12 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {externalItems.map((item, index) => (
                <tr key={item.key} className="border-b border-slate-100">
                  <td className="px-2 py-2.5 text-center font-medium text-slate-600">{index + 1}</td>
                  <td className="px-2 py-2.5 text-center">
                    {item.code ? <span className="font-semibold text-slate-800">{item.code}</span> : <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-600">Tự do</span>}
                  </td>
                  <td className="px-2 py-2.5 text-left font-medium text-slate-900">{item.name}</td>
                  <td className="px-2 py-1.5">
                    <input
                      aria-label={`Ghi chú cho bệnh nhân — ${item.name}`}
                      value={item.note}
                      disabled={!canEdit}
                      maxLength={500}
                      onChange={(e) => updateItem(item.key, { note: e.target.value })}
                      placeholder="Ghi chú…"
                      className={inputClassName}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <RowTail locked={false} canEdit={canEdit} label={item.name} onRemove={() => setDraft((p) => ({ ...p, items: p.items.filter((i) => i.key !== item.key) }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {localError && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
          <Warning size={15} weight="fill" className="flex-none" aria-hidden="true" />
          {localError}
        </div>
      )}
      <RecordFormNotice saveError={saveError} onReload={() => void query.refetch().then(() => clear())} />

      <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3">
        <div className="text-sm text-slate-600">
          Tổng tiền chỉ định tại phòng khám: <strong className="text-[17px] text-slate-900">{formatVnd(inHouseTotal)}</strong>
          {externalItems.length > 0 && <span className="ml-3 text-slate-500">· {externalItems.length} dịch vụ ra ngoài không tính tiền</span>}
          {dirty && <span className="ml-3 font-semibold text-amber-700">· Có thay đổi chưa lưu</span>}
          {!dirty && savedFlash && (
            <span className="ml-3 inline-flex items-center gap-1 font-semibold text-emerald-600">
              <CheckCircle size={14} weight="fill" aria-hidden="true" /> Đã lưu
            </span>
          )}
        </div>
        <div className="flex gap-2.5">
          <PrintButton documentType="CLINICAL_ORDER" onPrint={() => void handlePrint()} loading={printMutation.isPending} disabled={!serverOrder || dirty}>
            In phiếu chỉ định
          </PrintButton>
          {canEdit && (
            <Button type="button" loading={saveMutation.isPending} disabled={!dirty} onClick={() => void handleSave()}>
              Lưu chỉ định
            </Button>
          )}
        </div>
      </div>

      {serverOrder && (
        <ClinicalOrderPrintView
          order={serverOrder}
          patientFullName={patientFullName}
          patientCode={patientCode}
          patientDob={patientDob}
          patientGender={patientGender}
          patientPhone={patientPhone}
          encounterNo={encounterNo}
          diagnosisLabel={diagnosisLabel}
          doctorName={doctorName}
          printedAt={new Date().toISOString()}
        />
      )}
    </div>
  );
}

/** Nút xoá hàng, hoặc biểu tượng khoá khi dòng đã thu tiền/đã thực hiện (phải xử lý ở Thu ngân trước). */
function RowTail({ locked, canEdit, label, onRemove }: { locked: boolean; canEdit: boolean; label: string; onRemove: () => void }) {
  if (locked) {
    return (
      <span title="Đã thu tiền hoặc đã thực hiện — không gỡ trực tiếp được" aria-label="Đã khoá" className="inline-flex h-7 w-7 items-center justify-center text-slate-400">
        <Lock size={15} weight="fill" aria-hidden="true" />
      </span>
    );
  }
  if (!canEdit) return null;
  return (
    <button type="button" onClick={onRemove} aria-label={`Xoá ${label} khỏi chỉ định`} className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-50 text-rose-600 hover:bg-rose-100">
      <Trash size={14} aria-hidden="true" />
    </button>
  );
}

/** 1 dòng "gói" (giá gói) + các dịch vụ con thụt lề "Thuộc gói: ..." không có giá riêng. */
function PackageRowsView({ pkg, canEdit, onRemove }: { pkg: DraftPackage; canEdit: boolean; onRemove: () => void }) {
  return (
    <>
      <tr className="border-b border-slate-100 bg-violet-50/40">
        <td className="px-2 py-2.5 text-center">
          <Package size={15} weight="fill" className="mx-auto text-violet-600" aria-hidden="true" />
        </td>
        <td className="px-2 py-2.5 text-center font-semibold text-slate-800">{pkg.code}</td>
        <td className="px-2 py-2.5 text-left font-semibold text-slate-900">Gói: {pkg.name}</td>
        <td className="px-2 py-2.5" />
        <td className="px-2 py-2.5 text-center font-medium text-slate-700">1</td>
        <td className="px-2.5 py-2.5 text-right font-medium tabular-nums text-slate-700">{formatVnd(pkg.unitPrice)}</td>
        <td className="px-2.5 py-2.5 text-right font-bold tabular-nums text-slate-900">{formatVnd(pkg.unitPrice)}</td>
        <td className="px-2 py-2.5 text-center">
          <RowTail locked={pkg.locked} canEdit={canEdit} label={pkg.name} onRemove={onRemove} />
        </td>
      </tr>
      {pkg.children.map((child, i) => (
        <tr key={`${pkg.key}-${i}`} className="border-b border-slate-100 text-slate-700">
          <td className="px-2 py-1.5" />
          <td className="px-2 py-1.5 text-center text-[13px]">{child.code ?? ''}</td>
          <td className="px-2 py-1.5 pl-6 text-left text-[13px]">
            {child.name}
            <div className="text-[11.5px] font-semibold text-violet-700">Thuộc gói: {pkg.name}</div>
          </td>
          <td className="px-2 py-1.5 text-center text-[13px]">{child.placeName ?? '—'}</td>
          <td className="px-2 py-1.5 text-center text-[13px]">{child.quantity}</td>
          <td colSpan={3} className="px-2 py-1.5 text-center text-xs text-slate-400">
            trong giá gói
          </td>
        </tr>
      ))}
    </>
  );
}
