import { useEffect, useState } from 'react';
import { Plus, Trash, Warning, X } from '@phosphor-icons/react';
import type { FamilyRelation } from '@nexamed/shared';
import type { ConditionDraft, FamilyHistoryRowDraft, PatientFormValues } from './PatientFormFields';
import { findRepeatedFamilyConditions } from './patient-form.utils';
// Import trực tiếp từ module lá (không qua patient-form.utils.ts) — phá vòng lặp import thật sự
// gây ReferenceError lúc chạy `pnpm dev` (Vite native ESM), xem comment trong `family-relation.ts`.
import { FAMILY_RELATION_LABELS } from './family-relation';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { Textarea } from '../../shared/ui/Textarea';
import { Button } from '../../shared/ui/Button';
import { Icd10SearchPicker } from '../../shared/ui/Icd10SearchPicker';
import { useAllergenGroupsQuery, useAllergensQuery, useCreateAllergenMutation } from '../allergen/allergen.queries';

/**
 * Bệnh lý nền phổ biến — danh sách CỨNG trong code web (không phải bảng DB quản lý qua UI), đúng
 * nguyên tắc "cụ thể trước, trừu tượng sau" (CLAUDE.md). Người dùng vẫn tìm được bệnh khác qua ô
 * tìm ICD-10 đầy đủ bên dưới. Mã đã xác nhận có thật trong danh mục đã seed (`docs/data/icd10-chuong-*.md`).
 */
const QUICK_CONDITIONS: ConditionDraft[] = [
  { icd10Code: 'I10', icd10Name: 'Tăng huyết áp' },
  { icd10Code: 'E11', icd10Name: 'Đái tháo đường type 2' },
  { icd10Code: 'J45', icd10Name: 'Hen phế quản' },
  { icd10Code: 'N18', icd10Name: 'Bệnh thận mạn' },
  { icd10Code: 'I63', icd10Name: 'Đột quỵ / Tai biến mạch máu não' },
  { icd10Code: 'B18', icd10Name: 'Viêm gan virus mạn tính' },
];

/** Thói quen/lối sống — dùng CHUNG mảng `conditions` (mã ICD-10 Chương XXI, xem `patient_condition`), không tách trường riêng. */
const HABIT_CONDITIONS: (ConditionDraft & { tone: 'rose' | 'amber' })[] = [
  { icd10Code: 'Z72.0', icd10Name: 'Hút thuốc lá', tone: 'rose' },
  { icd10Code: 'Z72.1', icd10Name: 'Uống rượu bia thường xuyên', tone: 'rose' },
  { icd10Code: 'Z72.3', icd10Name: 'Lười vận động', tone: 'amber' },
];

const FAMILY_RELATION_OPTIONS: ComboboxOption[] = (Object.keys(FAMILY_RELATION_LABELS) as FamilyRelation[]).map((relation) => ({
  value: relation,
  label: FAMILY_RELATION_LABELS[relation],
}));

/**
 * Bỏ dấu tiếng Việt để lọc dị nguyên không phân biệt hoa/thường/dấu — bản sao nhỏ của
 * `stripVietnameseDiacritics` (`packages/core`, cùng kỹ thuật xử lý riêng "đ"/"Đ"). KHÔNG import từ
 * `@nexamed/core` — ESLint boundary rule cấm `apps/web` import package này (docs/DECISIONS.md #073).
 */
function stripDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Số chip "chọn nhanh" tối đa hiện mặc định cho MỖI nhóm dị nguyên khi chưa gõ tìm. */
const ALLERGEN_QUICK_LIMIT = 5;

function makeDraftId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `draft-${Math.random().toString(36).slice(2)}`;
}

const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-5 pt-7';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';
const subLabelClassName = 'mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-700';

function chipClassName(selected: boolean, tone: 'teal' | 'rose' | 'amber' = 'teal'): string {
  if (!selected) {
    return 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-brand-teal-tint';
  }
  if (tone === 'rose') return 'border-rose-600 bg-rose-600 text-white';
  if (tone === 'amber') return 'border-amber-500 bg-amber-500 text-white';
  return 'border-brand-teal bg-brand-teal text-white';
}

/**
 * Dialog nhập "Tiền sử" có cấu trúc (Sprint 5, mockup đã duyệt qua 2 vòng chỉnh sửa) — thay 4 field
 * rời rạc cũ (personalHistory/familyHistory text tự do, allergenIds, allergyNote). Dùng chung cho
 * CẢ 3 nơi gọi `PatientFormFields` (Thêm/Sửa bệnh nhân, Tiếp nhận) vì đặt trong chính component đó.
 *
 * Có state DRAFT riêng — mở dialog mới nạp lại từ `values`, "Huỷ" bỏ hết thay đổi trong dialog,
 * "Lưu" mới `onChange()` gộp vào form ngoài (form ngoài vẫn tự quyết định khi nào thật sự gửi lên
 * server qua nút "Lưu" của chính nó — dialog này không tự gọi API).
 */
export function PatientHistoryDialog({
  open,
  onClose,
  values,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  values: PatientFormValues;
  onChange: (values: PatientFormValues) => void;
}) {
  const [draftConditions, setDraftConditions] = useState<ConditionDraft[]>([]);
  const [draftFamilyRows, setDraftFamilyRows] = useState<FamilyHistoryRowDraft[]>([]);
  const [draftPersonalNote, setDraftPersonalNote] = useState('');
  const [draftAllergenIds, setDraftAllergenIds] = useState<string[]>([]);
  const [allergenFilter, setAllergenFilter] = useState('');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [newAllergenName, setNewAllergenName] = useState('');
  const [newAllergenGroupId, setNewAllergenGroupId] = useState('');

  const allergensQuery = useAllergensQuery();
  const allergenGroupsQuery = useAllergenGroupsQuery();
  const createAllergenMutation = useCreateAllergenMutation();

  // Nạp lại đúng 1 lần MỖI LẦN MỞ — không đồng bộ theo mọi thay đổi của `values` (form ngoài có thể
  // tự đổi field khác trong lúc dialog đang mở ở lý thuyết, dialog vẫn giữ nguyên draft đang sửa).
  useEffect(() => {
    if (!open) return;
    setDraftConditions(values.conditions);
    setDraftFamilyRows(values.familyHistoryRows);
    setDraftPersonalNote(values.personalHistory);
    setDraftAllergenIds(values.allergenIds);
    setAllergenFilter('');
    setQuickAddOpen(false);
    setNewAllergenName('');
    setNewAllergenGroupId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ nạp lại khi `open` chuyển sang true, không phải mỗi lần `values` đổi.
  }, [open]);

  if (!open) return null;

  function toggleCondition(item: ConditionDraft) {
    setDraftConditions((prev) => (prev.some((c) => c.icd10Code === item.icd10Code) ? prev.filter((c) => c.icd10Code !== item.icd10Code) : [...prev, item]));
  }

  function addFamilyRow() {
    setDraftFamilyRows((prev) => [...prev, { draftId: makeDraftId(), relation: '', icd10Code: '', icd10Name: '', ageOfOnsetYears: '' }]);
  }
  function updateFamilyRow(draftId: string, patch: Partial<FamilyHistoryRowDraft>) {
    setDraftFamilyRows((prev) => prev.map((row) => (row.draftId === draftId ? { ...row, ...patch } : row)));
  }
  function removeFamilyRow(draftId: string) {
    setDraftFamilyRows((prev) => prev.filter((row) => row.draftId !== draftId));
  }

  function toggleAllergen(id: string) {
    setDraftAllergenIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  async function handleCreateAllergen() {
    const name = newAllergenName.trim();
    if (name === '' || newAllergenGroupId === '') return;
    const created = await createAllergenMutation.mutateAsync({ name, allergenGroupId: newAllergenGroupId });
    setDraftAllergenIds((prev) => [...prev, created.id]);
    setNewAllergenName('');
    setQuickAddOpen(false);
  }

  function handleSave() {
    onChange({
      ...values,
      conditions: draftConditions,
      familyHistoryRows: draftFamilyRows,
      personalHistory: draftPersonalNote,
      allergenIds: draftAllergenIds,
    });
    onClose();
  }

  const allergenOptions = allergensQuery.data?.items ?? [];
  const allergenGroupOptions: ComboboxOption[] = (allergenGroupsQuery.data?.items ?? []).map((g) => ({ value: g.id, label: g.name }));
  const isAllergenSearching = allergenFilter.trim() !== '';
  const filteredAllergens = isAllergenSearching
    ? allergenOptions.filter((a) => stripDiacritics(`${a.name} ${a.allergenGroupName}`).includes(stripDiacritics(allergenFilter)))
    : [];
  // Chưa gõ tìm — nhóm theo `allergenGroupName`, mỗi nhóm chỉ hiện tối đa `ALLERGEN_QUICK_LIMIT`
  // chip "chọn nhanh" (danh mục dị nguyên có thể lên tới hàng trăm mục, hiện hết một lúc rối mắt).
  // Chip đã chọn LUÔN ưu tiên hiện trước trong nhóm của nó — không được để "biến mất" khỏi tầm nhìn
  // chỉ vì đứng ngoài top N, người dùng phải bỏ chọn được mà không cần gõ tìm lại đúng tên.
  const quickAllergensByGroup = isAllergenSearching
    ? []
    : (allergenGroupsQuery.data?.items ?? [])
        .map((group) => {
          const items = allergenOptions.filter((a) => a.allergenGroupId === group.id);
          const selected = items.filter((a) => draftAllergenIds.includes(a.id));
          const rest = items.filter((a) => !draftAllergenIds.includes(a.id));
          const shown = [...selected, ...rest].slice(0, Math.max(ALLERGEN_QUICK_LIMIT, selected.length));
          return { group, totalCount: items.length, shown };
        })
        .filter((entry) => entry.totalCount > 0);

  const repeatedFamilyConditions = findRepeatedFamilyConditions(draftFamilyRows);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/55 p-4 py-8" role="dialog" aria-modal="true" aria-labelledby="history-dialog-title">
      <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 id="history-dialog-title" className="text-[16px] font-bold text-slate-900">
              Tiền sử bệnh nhân
            </h2>
            <p className="mt-0.5 text-[13px] text-slate-500">Bệnh lý nền, tiền sử gia đình và dị ứng — dùng chung mọi lượt khám.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng cửa sổ" className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50">
            <X size={15} weight="bold" />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto scroll-hover px-6 py-5">
          {/* 1. Tiền sử bản thân */}
          <div className={sectionBoxClassName}>
            <span className={sectionBadgeClassName}>Tiền sử bản thân</span>

            <p className={subLabelClassName}>Bệnh lý nền — chọn nhanh (bấm lại để bỏ chọn)</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {QUICK_CONDITIONS.map((item) => (
                <button
                  key={item.icd10Code}
                  type="button"
                  onClick={() => toggleCondition(item)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${chipClassName(draftConditions.some((c) => c.icd10Code === item.icd10Code))}`}
                >
                  {item.icd10Name} <span className="opacity-70">· {item.icd10Code}</span>
                </button>
              ))}
              {/* Bệnh lý đã thêm qua tìm kiếm nhưng không nằm trong danh sách cứng ở trên — vẫn hiện thành chip đã chọn. */}
              {draftConditions
                .filter((c) => ![...QUICK_CONDITIONS, ...HABIT_CONDITIONS].some((q) => q.icd10Code === c.icd10Code))
                .map((item) => (
                  <button
                    key={item.icd10Code}
                    type="button"
                    onClick={() => toggleCondition(item)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${chipClassName(true)}`}
                  >
                    {item.icd10Name} <span className="opacity-70">· {item.icd10Code}</span>
                  </button>
                ))}
            </div>

            <div className="mb-4">
              <Icd10SearchPicker
                excludeCodes={draftConditions.map((c) => c.icd10Code)}
                onSelect={(item) => toggleCondition(item)}
                placeholder="Tìm bệnh lý khác theo tên hoặc mã ICD-10..."
              />
            </div>

            <p className={subLabelClassName}>Thói quen / lối sống</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {HABIT_CONDITIONS.map((item) => (
                <button
                  key={item.icd10Code}
                  type="button"
                  onClick={() => toggleCondition(item)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${chipClassName(draftConditions.some((c) => c.icd10Code === item.icd10Code), item.tone)}`}
                >
                  {item.icd10Name}
                </button>
              ))}
            </div>

            <Textarea
              id="patient-history-note"
              label="Ghi chú bổ sung"
              dense
              rows={2}
              value={draftPersonalNote}
              onChange={(e) => setDraftPersonalNote(e.target.value)}
              placeholder="Ví dụ: tiền sử phẫu thuật, dị tật bẩm sinh..."
            />
          </div>

          {/* 2. Tiền sử gia đình */}
          <div className={sectionBoxClassName}>
            <span className={sectionBadgeClassName}>Tiền sử gia đình</span>
            <p className={subLabelClassName}>Quan hệ huyết thống × Bệnh lý (ICD-10)</p>

            <div className="space-y-2.5">
              {draftFamilyRows.map((row) => (
                <div key={row.draftId} className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                  <div className="flex items-start gap-2">
                    <div className="w-40 flex-none">
                      <Combobox
                        id={`family-relation-${row.draftId}`}
                        value={row.relation}
                        onChange={(v) => updateFamilyRow(row.draftId, { relation: v as FamilyRelation })}
                        options={FAMILY_RELATION_OPTIONS}
                        placeholder="Quan hệ..."
                      />
                    </div>
                    <div className="w-24 flex-none">
                      <input
                        type="number"
                        min={0}
                        max={120}
                        value={row.ageOfOnsetYears}
                        onChange={(e) => updateFamilyRow(row.draftId, { ageOfOnsetYears: e.target.value })}
                        placeholder="Tuổi"
                        className="w-full rounded-md border border-slate-300 px-2 py-2 text-center text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFamilyRow(row.draftId)}
                      aria-label="Xoá dòng"
                      className="flex h-9.5 w-9.5 flex-none items-center justify-center rounded-md border border-transparent text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash size={15} weight="bold" />
                    </button>
                  </div>
                  <div className="mt-2">
                    {row.icd10Code === '' ? (
                      <Icd10SearchPicker
                        excludeCodes={[]}
                        onSelect={(item) => updateFamilyRow(row.draftId, { icd10Code: item.icd10Code, icd10Name: item.icd10Name })}
                        placeholder="Chọn bệnh lý (ICD-10)..."
                      />
                    ) : (
                      <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-[13px] font-semibold text-blue-700">
                        <span className="flex-1">
                          {row.icd10Name} <span className="font-normal opacity-70">· {row.icd10Code}</span>
                        </span>
                        <button type="button" onClick={() => updateFamilyRow(row.draftId, { icd10Code: '', icd10Name: '' })} className="text-xs font-semibold text-blue-600 underline">
                          Đổi
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addFamilyRow}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-blue-400 bg-blue-50 px-3 py-1.5 text-[13px] font-semibold text-blue-600 hover:bg-blue-100"
            >
              <Plus size={13} weight="bold" />
              Thêm người thân / bệnh lý
            </button>

            {repeatedFamilyConditions.length > 0 && (
              <div className="mt-3 flex items-start gap-3 rounded-lg border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 px-3.5 py-3">
                <Warning size={18} weight="fill" className="mt-0.5 flex-none text-amber-500" />
                <div className="text-[13px]">
                  <p className="font-bold text-amber-800">Phát hiện yếu tố lặp lại trong gia đình</p>
                  {repeatedFamilyConditions.map((entry) => (
                    <p key={entry.icd10Code} className="text-amber-800">
                      Có <b>{entry.relationLabels.join(', ')}</b> cùng mắc <b>{entry.icd10Name}</b> — cân nhắc trao đổi thêm với bác sĩ.
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 3. Tiền sử dị ứng */}
          <div className={sectionBoxClassName}>
            <span className={sectionBadgeClassName}>Tiền sử dị ứng</span>
            <p className={subLabelClassName}>Dị nguyên đã biết (danh mục dùng chung)</p>

            <div className="mb-3 flex items-center gap-1.5">
              <input
                type="text"
                value={allergenFilter}
                onChange={(e) => setAllergenFilter(e.target.value)}
                placeholder="Lọc dị nguyên theo tên hoặc nhóm..."
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="button"
                onClick={() => setQuickAddOpen((o) => !o)}
                title="Thêm dị nguyên mới vào danh mục"
                aria-label="Thêm dị nguyên mới vào danh mục"
                className="flex h-9.5 w-9.5 flex-none items-center justify-center rounded-md border border-dashed border-blue-400 bg-blue-50 text-blue-600 hover:bg-blue-100"
              >
                <Plus size={15} weight="bold" />
              </button>
            </div>

            {quickAddOpen && (
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={newAllergenName}
                    onChange={(e) => setNewAllergenName(e.target.value)}
                    placeholder="Tên dị nguyên mới..."
                    className="min-w-40 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <div className="w-44">
                    <Combobox
                      id="new-allergen-group"
                      value={newAllergenGroupId}
                      onChange={setNewAllergenGroupId}
                      options={allergenGroupOptions}
                      placeholder="Nhóm dị nguyên..."
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => void handleCreateAllergen()}
                    loading={createAllergenMutation.isPending}
                    disabled={newAllergenName.trim() === '' || newAllergenGroupId === ''}
                  >
                    Thêm vào danh mục
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setQuickAddOpen(false)}>
                    Huỷ
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">Thêm mới sẽ lưu thẳng vào danh mục Dị nguyên dùng chung toàn hệ thống.</p>
              </div>
            )}

            {/* Chưa gõ tìm — nhóm theo Nhóm dị nguyên, mỗi nhóm chỉ hiện tối đa 5 chip chọn nhanh
                (chip đã chọn luôn ưu tiên hiện trước); phần còn lại của nhóm tìm qua ô lọc ở trên. */}
            {!isAllergenSearching && (
              <div className="space-y-3">
                {quickAllergensByGroup.length === 0 && (
                  <p className="text-[13px] text-slate-400">
                    Chưa có dị nguyên nào trong danh mục — bấm <b>+</b> ở trên để thêm mới.
                  </p>
                )}
                {quickAllergensByGroup.map(({ group, totalCount, shown }) => (
                  <div key={group.id}>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-700">{group.name}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {shown.map((allergen) => (
                        <button
                          key={allergen.id}
                          type="button"
                          onClick={() => toggleAllergen(allergen.id)}
                          className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${chipClassName(draftAllergenIds.includes(allergen.id), 'rose')}`}
                        >
                          {allergen.name}
                        </button>
                      ))}
                      {totalCount > shown.length && (
                        <span className="text-[12px] font-medium text-slate-400">+{totalCount - shown.length} khác — gõ tên để tìm</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Đang gõ tìm — trả phẳng mọi dị nguyên khớp, không giới hạn/nhóm (mục đích tìm đúng 1 tên cụ thể). */}
            {isAllergenSearching && (
              <div className="flex flex-wrap gap-2">
                {filteredAllergens.length === 0 && (
                  <p className="text-[13px] text-slate-400">
                    Không khớp dị nguyên nào trong danh mục — bấm <b>+</b> ở trên để thêm mới.
                  </p>
                )}
                {filteredAllergens.map((allergen) => (
                  <button
                    key={allergen.id}
                    type="button"
                    onClick={() => toggleAllergen(allergen.id)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${chipClassName(draftAllergenIds.includes(allergen.id), 'rose')}`}
                  >
                    {allergen.name} <span className="opacity-70">· {allergen.allergenGroupName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="button" onClick={handleSave}>
            Lưu tiền sử
          </Button>
        </div>
      </div>
    </div>
  );
}
