import { useEffect, useMemo, useState } from 'react';
import { Info, WarningCircle } from '@phosphor-icons/react';
import type { PrescriptionKindMappingResponse } from '@nexamed/shared';
import { useHasPermission } from '../auth/usePermission';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { PrescriptionKindChip, PRESCRIPTION_KIND_TEXT, type PrescriptionKindLetter } from '../../shared/ui/PrescriptionKindChip';
import { Skeleton } from '../../shared/ui/Skeleton';
import { ApiError } from '../../shared/api/client';
import { usePrescriptionKindMappingQuery, useUpdatePrescriptionKindMappingMutation } from './clinic.queries';

type Mapping = PrescriptionKindMappingResponse['mapping'];
type RowKey = keyof Mapping;

interface RowSpec {
  key: RowKey;
  label: string;
  basis: string;
  /** Giá trị cho phép chọn (dòng Đông y chỉ Y hoặc C). */
  options: readonly PrescriptionKindLetter[];
}

const ALL_KINDS: readonly PrescriptionKindLetter[] = ['N', 'H', 'Y', 'C'];

const ROWS: RowSpec[] = [
  { key: 'NARCOTIC', label: 'Gây nghiện', basis: 'Phân loại kiểm soát', options: ALL_KINDS },
  { key: 'PSYCHOTROPIC', label: 'Hướng thần', basis: 'Phân loại kiểm soát', options: ALL_KINDS },
  { key: 'PRECURSOR', label: 'Tiền chất dùng làm thuốc', basis: 'Phân loại kiểm soát. Cổng liên thông xếp chung nhóm với hướng thần.', options: ALL_KINDS },
  { key: 'TOXIC', label: 'Thuốc độc', basis: 'Phân loại kiểm soát. Chưa có văn bản nêu rõ nên đang để C.', options: ALL_KINDS },
  { key: 'NORMAL', label: 'Thuốc thường', basis: 'Phân loại kiểm soát', options: ALL_KINDS },
  { key: 'TRADITIONAL', label: 'Thuốc Đông y', basis: 'Cờ "Đông y" ở danh mục thuốc', options: ['Y', 'C'] },
];

const KIND_OPTIONS = (kinds: readonly PrescriptionKindLetter[]) => kinds.map((k) => ({ value: k, label: `${k} — ${PRESCRIPTION_KIND_TEXT[k]}` }));

/**
 * "Loại đơn thuốc" (docs/DECISIONS.md #242, giai đoạn 2; mockup mục 4 đã chốt) — bảng ánh xạ loại thuốc → loại đơn Bộ Y tế C/N/H/Y, pill phẳng trong "Cấu hình hệ thống".
 * Chỉ áp dụng cho đơn ký từ lúc lưu; thứ tự ưu tiên khi một thuốc khớp nhiều dòng: N, H, Y, C. Dòng "Kê thuốc tự do" cố định C, không có ô chọn.
 */
export function PrescriptionKindPane() {
  const canManage = useHasPermission('clinic_config', 'update');
  const query = usePrescriptionKindMappingQuery();
  const mutation = useUpdatePrescriptionKindMappingMutation();
  const [draft, setDraft] = useState<Mapping | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data) setDraft(query.data.mapping);
  }, [query.data]);

  const defaults = query.data?.defaults;
  const changedCount = useMemo(() => (draft && defaults ? ROWS.filter((r) => draft[r.key] !== defaults[r.key]).length : 0), [draft, defaults]);
  const dirty = useMemo(() => (draft && query.data ? ROWS.some((r) => draft[r.key] !== query.data!.mapping[r.key]) : false), [draft, query.data]);
  const narcoticWeakened = draft !== null && defaults !== undefined && defaults.NARCOTIC === 'N' && draft.NARCOTIC === 'C';
  const errorMessage = mutation.error instanceof ApiError ? mutation.error.message : undefined;

  function setRow(key: RowKey, value: string) {
    setSaved(false);
    setDraft((d) => (d ? ({ ...d, [key]: value } as Mapping) : d));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !dirty || !canManage) return;
    mutation.mutate(draft, { onSuccess: () => setSaved(true) });
  }

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <p className="mb-4 text-xs text-slate-500">
        Mỗi loại thuốc thuộc về một loại đơn. Khi ký, hệ thống nhóm các dòng thuốc theo loại này và tự tách thành từng đơn, mỗi đơn một mã. Chỉ áp dụng cho đơn ký từ lúc lưu.
      </p>

      {query.isError && <ErrorBanner message="Không tải được bảng loại đơn thuốc." onRetry={() => query.refetch()} />}
      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {draft && defaults && (
        <>
          <div className="min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="scroll-hover max-h-full overflow-y-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                    <th className="px-4 py-2.5 text-left">Phân loại thuốc</th>
                    <th className="px-4 py-2.5 text-left">Căn cứ</th>
                    <th className="w-28 px-4 py-2.5 text-center">Mặc định</th>
                    <th className="w-64 px-4 py-2.5 text-center">Loại đơn đang dùng</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => (
                    <tr key={r.key} className="border-b border-slate-200">
                      <td className="px-4 py-2 text-left font-medium text-slate-900">{r.label}</td>
                      <td className="px-4 py-2 text-left text-xs text-slate-500">{r.basis}</td>
                      <td className="px-4 py-2 text-center">
                        <PrescriptionKindChip kind={defaults[r.key]} />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="mx-auto w-48 text-left">
                          <Combobox
                            id={`kind-${r.key}`}
                            value={draft[r.key]}
                            onChange={(v) => setRow(r.key, v)}
                            options={KIND_OPTIONS(r.options)}
                            disabled={!canManage}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">Kê thuốc tự do</td>
                    <td className="px-4 py-2 text-left text-xs text-slate-500">Không có trong danh mục</td>
                    <td className="px-4 py-2 text-center">
                      <PrescriptionKindChip kind="C" />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                        <PrescriptionKindChip kind="C" /> cố định
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3" aria-live="polite">
            {narcoticWeakened ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800" role="alert">
                <WarningCircle size={18} weight="fill" className="mt-0.5 flex-none" aria-hidden="true" />
                <span>
                  Thuốc gây nghiện thường phải kê trong đơn riêng loại N. Chuyển sang C có thể không đúng quy định kê đơn; chỉ làm khi dược sĩ phụ trách đồng ý.
                </span>
              </div>
            ) : changedCount > 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-700">
                <Info size={18} weight="fill" className="mt-0.5 flex-none" aria-hidden="true" />
                <span>Đã đổi {changedCount} dòng so với mặc định. Áp dụng cho đơn ký từ lúc lưu.</span>
              </div>
            ) : null}
          </div>

          {errorMessage && <p className="mt-3 text-sm font-semibold text-rose-700">{errorMessage}</p>}
          {saved && !dirty && <p className="mt-3 text-sm font-semibold text-emerald-700">Đã lưu. Áp dụng cho đơn ký từ bây giờ.</p>}

          <div className="mt-4 flex items-center justify-end gap-3">
            <span className="mr-auto text-xs text-slate-500">Thứ tự ưu tiên khi một thuốc khớp nhiều dòng: N, rồi H, rồi Y, rồi C.</span>
            {canManage && (
              <>
                <Button type="button" variant="secondary" onClick={() => {
                    setSaved(false);
                    setDraft(defaults);
                  }} disabled={changedCount === 0 || mutation.isPending}>
                  Khôi phục mặc định
                </Button>
                <Button type="submit" loading={mutation.isPending} disabled={!dirty}>
                  Lưu
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </form>
  );
}
