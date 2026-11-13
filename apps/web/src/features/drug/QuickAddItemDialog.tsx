import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash } from '@phosphor-icons/react';
import type { CreateDrugRequest, DrugItemType, DrugSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { useCatalogCombobox } from '../reference-catalog/useCatalogCombobox';
import { useCreateDrugMutation } from './drug.queries';

const fieldLabel = 'mb-1 block text-sm font-semibold text-slate-800';
const inputClass = 'h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

interface IngredientRow {
  activeIngredientCode: string;
  strength: string;
  unitCode: string;
}

/**
 * Hộp "Thêm mặt hàng mới" ngay trong ô tìm hàng của Đơn đặt hàng NCC và Phiếu nhập kho (docs/DECISIONS.md #298 bổ sung 2, mockup màn 3 và 4 đã duyệt): người lập đơn gặp thuốc/vật tư chưa có trong danh mục
 * thì thêm tại chỗ rồi dùng luôn, không phải rời trang. CHỈ gồm các mục hệ thống đang bắt buộc khi tạo mới (cùng luật ở `createDrugRequestSchema`): Thuốc cần nhóm thuốc, đường dùng, hoạt chất và hàm lượng,
 * dạng bào chế, nước sản xuất, nhà sản xuất, số đăng ký; Vật tư y tế cần phân nhóm VTYT, nhà sản xuất, số đăng ký/giấy phép nhập khẩu; cả hai cần đơn vị nhỏ nhất và giá bán (hoặc "Chỉ dùng nội bộ").
 * Mã mặt hàng do máy chủ tự sinh. Mục còn lại bổ sung sau ở Danh mục. Lưu xong trả mặt hàng vừa tạo qua `onCreated`.
 */
export function QuickAddItemDialog({
  initialName,
  submitLabel = 'Thêm vào đơn',
  onCreated,
  onClose,
}: {
  initialName: string;
  /** Nhãn nút lưu theo nơi gọi: "Thêm vào đơn" (Đơn đặt hàng NCC) hoặc "Thêm vào phiếu" (Phiếu nhập kho). */
  submitLabel?: string;
  onCreated: (drug: DrugSummary) => void;
  onClose: () => void;
}) {
  const createMutation = useCreateDrugMutation();
  const nameRef = useRef<HTMLInputElement>(null);

  const unitCatalog = useCatalogCombobox('UNIT');
  const manufacturerCatalog = useCatalogCombobox('MANUFACTURER');
  const supplyGroupCatalog = useCatalogCombobox('SUPPLY_GROUP');
  const drugGroupCatalog = useCatalogCombobox('DRUG_GROUP');
  const routeCatalog = useCatalogCombobox('DRUG_ROUTE');
  const dosageFormCatalog = useCatalogCombobox('DOSAGE_FORM');
  const countryCatalog = useCatalogCombobox('COUNTRY_OF_ORIGIN');
  const ingredientCatalog = useCatalogCombobox('ACTIVE_INGREDIENT');

  const [itemType, setItemType] = useState<DrugItemType>('SUPPLY');
  const [name, setName] = useState(initialName);
  const [groupCode, setGroupCode] = useState('');
  const [routeCode, setRouteCode] = useState('');
  const [dosageForm, setDosageForm] = useState('');
  const [country, setCountry] = useState('');
  const [manufacturerCode, setManufacturerCode] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [ingredients, setIngredients] = useState<IngredientRow[]>([{ activeIngredientCode: '', strength: '', unitCode: '' }]);
  const [baseUnitCode, setBaseUnitCode] = useState('');
  const [orderUnitCode, setOrderUnitCode] = useState('');
  const [factor, setFactor] = useState('');
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [internalUseOnly, setInternalUseOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isMedicine = itemType === 'MEDICINE';
  const baseUnitLabel = unitCatalog.nameByCode.get(baseUnitCode) ?? baseUnitCode;

  function validate(): string | null {
    if (!name.trim()) return 'Phải nhập tên mặt hàng.';
    if (!groupCode) return isMedicine ? 'Phải chọn Nhóm thuốc.' : 'Phải chọn Phân nhóm VTYT.';
    if (isMedicine) {
      if (!routeCode) return 'Phải chọn Đường dùng.';
      if (!dosageForm) return 'Phải chọn Dạng bào chế.';
      if (!country) return 'Phải chọn Nước sản xuất.';
      const valid = ingredients.filter((r) => r.activeIngredientCode && r.strength.trim() !== '' && r.unitCode);
      if (valid.length === 0) return 'Thuốc phải có ít nhất một hoạt chất kèm hàm lượng và đơn vị.';
      if (valid.some((r) => !(Number(r.strength) >= 0))) return 'Hàm lượng phải là số.';
    }
    if (!manufacturerCode) return 'Phải chọn Nhà sản xuất.';
    if (!registrationNumber.trim()) return isMedicine ? 'Phải nhập Số đăng ký lưu hành.' : 'Phải nhập Số đăng ký lưu hành hoặc số giấy phép nhập khẩu.';
    if (!baseUnitCode) return 'Phải chọn đơn vị nhỏ nhất.';
    if (orderUnitCode) {
      if (orderUnitCode === baseUnitCode) return 'Đơn vị đặt phải khác đơn vị nhỏ nhất.';
      if (!/^\d+$/.test(factor.trim()) || Number(factor) < 2) return 'Hệ số quy đổi phải là số nguyên từ 2 trở lên.';
    }
    if (!internalUseOnly && price === undefined) return 'Phải nhập giá bán (hoặc bật "Chỉ dùng nội bộ, không bán").';
    return null;
  }

  function buildBody(): CreateDrugRequest {
    return {
      name: name.trim(),
      itemType,
      baseUnitCode,
      manufacturerCode,
      registrationNumber: registrationNumber.trim(),
      drugGroupCode: groupCode,
      internalUseOnly,
      defaultSellPrice: internalUseOnly ? undefined : price,
      ...(isMedicine
        ? {
            routeCode,
            dosageForm,
            countryOfOrigin: country,
            ingredients: ingredients
              .filter((r) => r.activeIngredientCode && r.strength.trim() !== '' && r.unitCode)
              .map((r) => ({ activeIngredientCode: r.activeIngredientCode, strengthValue: Math.round(Number(r.strength) * 1000), strengthUnitCode: r.unitCode })),
          }
        : { ingredients: [] }),
      units: orderUnitCode ? [{ unitCode: orderUnitCode, sortOrder: 0, factorToUnitBelow: Number(factor) }] : [],
    } as CreateDrugRequest;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Hộp này nằm trong portal nhưng React vẫn chuyển sự kiện submit lên `<form>` của trang lập đơn/phiếu (cha trong cây React) — chặn để Enter ở đây không lưu nhầm cả đơn.
    e.stopPropagation();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const created = await createMutation.mutateAsync(buildBody());
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thêm được mặt hàng, vui lòng thử lại. Dữ liệu bạn nhập vẫn được giữ.');
    }
  }

  function setIngredient(i: number, patch: Partial<IngredientRow>) {
    setIngredients((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return createPortal(
    <div className="fixed inset-0 z-60 flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="quick-add-title">
      <form onSubmit={handleSubmit} className="my-6 w-full max-w-3xl rounded-lg bg-white p-5 shadow-xl">
        <h2 id="quick-add-title" className="text-lg font-semibold text-slate-900">
          Thêm mặt hàng mới
        </h2>
        <p className="mb-4 text-sm text-slate-600">Điền các mục bắt buộc để dùng ngay. Phần còn lại bổ sung sau ở Danh mục Thuốc &amp; Vật tư.</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="quick-add-name" className={fieldLabel}>
              Tên mặt hàng <span className="text-rose-500">*</span>
            </label>
            <input id="quick-add-name" ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <span className={fieldLabel}>Loại</span>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Loại mặt hàng">
              {(
                [
                  ['MEDICINE', 'Thuốc'],
                  ['SUPPLY', 'Vật tư y tế'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={itemType === value}
                  onClick={() => {
                    setItemType(value);
                    setGroupCode('');
                    setError(null);
                  }}
                  className={`px-3.5 py-2 text-sm font-medium ${itemType === value ? 'bg-teal-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="quick-add-group" className={fieldLabel}>
              {isMedicine ? 'Nhóm thuốc' : 'Phân nhóm VTYT'} <span className="text-rose-500">*</span>
            </label>
            <Combobox
              id="quick-add-group"
              value={groupCode}
              onChange={setGroupCode}
              options={isMedicine ? drugGroupCatalog.options : supplyGroupCatalog.options}
              allowCreate={!isMedicine}
              onCreateOption={isMedicine ? undefined : supplyGroupCatalog.onCreateOption}
            />
          </div>
          {isMedicine && (
            <>
              <div>
                <label htmlFor="quick-add-route" className={fieldLabel}>
                  Đường dùng <span className="text-rose-500">*</span>
                </label>
                <Combobox id="quick-add-route" value={routeCode} onChange={setRouteCode} options={routeCatalog.options} />
              </div>
              <div>
                <label htmlFor="quick-add-dosage-form" className={fieldLabel}>
                  Dạng bào chế <span className="text-rose-500">*</span>
                </label>
                <Combobox id="quick-add-dosage-form" value={dosageForm} onChange={setDosageForm} options={dosageFormCatalog.options} allowCreate onCreateOption={dosageFormCatalog.onCreateOption} />
              </div>
            </>
          )}
          <div>
            <label htmlFor="quick-add-manufacturer" className={fieldLabel}>
              Nhà sản xuất <span className="text-rose-500">*</span>
            </label>
            <Combobox id="quick-add-manufacturer" value={manufacturerCode} onChange={setManufacturerCode} options={manufacturerCatalog.options} allowCreate onCreateOption={manufacturerCatalog.onCreateOption} />
          </div>
          {isMedicine && (
            <div>
              <label htmlFor="quick-add-country" className={fieldLabel}>
                Nước sản xuất <span className="text-rose-500">*</span>
              </label>
              <Combobox id="quick-add-country" value={country} onChange={setCountry} options={countryCatalog.options} allowCreate onCreateOption={countryCatalog.onCreateOption} />
            </div>
          )}
          <div>
            <label htmlFor="quick-add-registration" className={fieldLabel}>
              {isMedicine ? 'Số đăng ký' : 'Số đăng ký / giấy phép NK'} <span className="text-rose-500">*</span>
            </label>
            <input id="quick-add-registration" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} className={inputClass} />
          </div>
        </div>

        {isMedicine && (
          <section className="relative mt-5 rounded-lg border border-slate-200 p-4 pt-6">
            <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Hoạt chất &amp; hàm lượng</span>
            <div className="space-y-2">
              {ingredients.map((row, i) => (
                <div key={i} className="grid grid-cols-12 items-end gap-2">
                  <div className="col-span-6">
                    {i === 0 && <label htmlFor="quick-add-ingredient-0" className={fieldLabel}>Hoạt chất</label>}
                    <Combobox id={`quick-add-ingredient-${i}`} value={row.activeIngredientCode} onChange={(v) => setIngredient(i, { activeIngredientCode: v })} options={ingredientCatalog.options} />
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <label htmlFor="quick-add-strength-0" className={fieldLabel}>Hàm lượng</label>}
                    <input id={`quick-add-strength-${i}`} value={row.strength} inputMode="decimal" onChange={(e) => setIngredient(i, { strength: e.target.value })} className={inputClass} />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <label htmlFor="quick-add-strength-unit-0" className={fieldLabel}>Đơn vị</label>}
                    <Combobox id={`quick-add-strength-unit-${i}`} value={row.unitCode} onChange={(v) => setIngredient(i, { unitCode: v })} options={unitCatalog.options} />
                  </div>
                  <div className="col-span-1">
                    {ingredients.length > 1 && (
                      <button type="button" aria-label="Xoá hoạt chất" onClick={() => setIngredients((rows) => rows.filter((_, idx) => idx !== i))} className="mb-0.5 rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <Trash size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setIngredients((rows) => [...rows, { activeIngredientCode: '', strength: '', unitCode: '' }])} className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-blue-400 px-3 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50">
              <Plus size={15} weight="bold" aria-hidden="true" />
              Thêm hoạt chất
            </button>
          </section>
        )}

        <section className="relative mt-5 rounded-lg border border-slate-200 p-4 pt-6">
          <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Đơn vị</span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="quick-add-base-unit" className={fieldLabel}>
                Đơn vị nhỏ nhất <span className="text-rose-500">*</span>
              </label>
              <Combobox id="quick-add-base-unit" value={baseUnitCode} onChange={setBaseUnitCode} options={unitCatalog.options} allowCreate onCreateOption={unitCatalog.onCreateOption} />
            </div>
            <div>
              <label htmlFor="quick-add-order-unit" className={fieldLabel}>
                Đơn vị đặt (tuỳ chọn)
              </label>
              <Combobox id="quick-add-order-unit" value={orderUnitCode} onChange={setOrderUnitCode} options={[{ value: '', label: 'Không có' }, ...unitCatalog.options.filter((o) => o.value !== baseUnitCode)]} allowCreate onCreateOption={unitCatalog.onCreateOption} />
            </div>
            <div>
              <label htmlFor="quick-add-factor" className={fieldLabel}>
                {orderUnitCode ? `1 ${unitCatalog.nameByCode.get(orderUnitCode) ?? ''} =` : 'Hệ số quy đổi'}
              </label>
              <div className="flex items-center gap-2">
                <input id="quick-add-factor" value={factor} disabled={!orderUnitCode} inputMode="numeric" onChange={(e) => setFactor(e.target.value)} className={`${inputClass} text-center font-semibold disabled:bg-slate-50`} />
                <span className="text-sm font-medium text-slate-600">{baseUnitLabel}</span>
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Cần nhiều bậc hơn (Thùng, Vỉ)? Thêm ở Danh mục sau.</p>
        </section>

        <section className="relative mt-5 rounded-lg border border-slate-200 p-4 pt-6">
          <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Giá bán</span>
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="quick-add-price" className={fieldLabel}>
                Giá bán mặc định (đ) {!internalUseOnly && <span className="text-rose-500">*</span>}
              </label>
              <MoneyInput id="quick-add-price" value={price} disabled={internalUseOnly} onChange={setPrice} className={`${inputClass} text-right`} />
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 pt-6 text-sm">
              <input type="checkbox" checked={internalUseOnly} onChange={(e) => setInternalUseOnly(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                <span className="block font-semibold text-slate-900">Chỉ dùng nội bộ, không bán</span>
                <span className="block text-slate-600">Bật thì không cần giá bán.</span>
              </span>
            </label>
          </div>
        </section>

        {error && (
          <p role="alert" className="mt-4 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {isMedicine && (
            <a href="/admin/catalog-pharmacy" target="_blank" rel="noreferrer" className="mr-auto text-sm font-semibold text-blue-600 hover:underline">
              Mở Danh mục để nhập đầy đủ
            </a>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={createMutation.isPending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
