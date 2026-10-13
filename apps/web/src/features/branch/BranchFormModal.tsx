import { useRef, useState } from 'react';
import { TreeStructure } from '@phosphor-icons/react';
import type { BranchSummary } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { SaveFlashBanner } from '../../shared/ui/SaveFlashBanner';
import { RecordFormNotice } from '../../shared/ui/RecordFormNotice';
import { useSaveFlash } from '../../shared/hooks/useSaveFlash';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export interface BranchSubmitDto {
  name: string;
  address: string | null;
  phone: string | null;
}

/**
 * Modal Thêm/Sửa chi nhánh (docs/DECISIONS.md #231) — mã `CNxxxxx` tự sinh, không nhập tay. Enter để lưu (form `<form>`),
 * "Lưu và nhập tiếp" khi thêm mới (`.claude/docs/ui-guidelines.md` mục 4.7).
 */
export function BranchFormModal({
  mode,
  branch,
  submitting,
  stale,
  onReload,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  branch?: BranchSummary;
  submitting: boolean;
  /** Người khác vừa lưu bản mới của chi nhánh này (phát hiện lúc form đang mở) — khoá nút Lưu tới khi tải lại. */
  stale: boolean;
  onReload: () => void | Promise<void>;
  onCancel: () => void;
  onSubmit: (dto: BranchSubmitDto) => Promise<void>;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState({ name: branch?.name ?? '', address: branch?.address ?? '', phone: branch?.phone ?? '' });
  const { flashVisible, triggerFlash } = useSaveFlash();
  const { saveError, run } = useSaveAttempt();

  const isValid = values.name.trim() !== '' && !stale;

  function buildDto(): BranchSubmitDto {
    return { name: values.name.trim(), address: values.address.trim() || null, phone: values.phone.trim() || null };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    if (await run(() => onSubmit(buildDto()))) onCancel();
  }

  async function handleSaveAndContinue() {
    if (!isValid) return;
    if (!(await run(() => onSubmit(buildDto())))) return;
    setValues({ name: '', address: '', phone: '' });
    nameRef.current?.focus();
    triggerFlash();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader
          icon={TreeStructure}
          title={mode === 'create' ? 'Thêm chi nhánh' : 'Sửa chi nhánh'}
          subtitle="Quản trị: Chi nhánh"
          onClose={onCancel}
          right={
            mode === 'edit' && branch ? (
              <span className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600" title="Mã tự sinh, không sửa được">
                Mã: {branch.code}
              </span>
            ) : undefined
          }
        />

        <SaveFlashBanner visible={flashVisible} />

        <BoxedSection badge="Thông tin chi nhánh">
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label htmlFor="branch-name" className="text-sm font-semibold text-slate-800">
                Tên chi nhánh <span className="text-rose-500">*</span>
              </label>
              <input
                id="branch-name"
                ref={nameRef}
                autoFocus
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                className={inputClassName}
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label htmlFor="branch-address" className="text-sm font-semibold text-slate-800">
                Địa chỉ
              </label>
              <input
                id="branch-address"
                value={values.address}
                onChange={(e) => setValues((v) => ({ ...v, address: e.target.value }))}
                className={inputClassName}
                maxLength={500}
              />
              <p className="text-xs text-slate-500">In ở đầu phiếu của các lượt khám tại chi nhánh này.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="branch-phone" className="text-sm font-semibold text-slate-800">
                Số điện thoại
              </label>
              <input
                id="branch-phone"
                value={values.phone}
                onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
                className={inputClassName}
                maxLength={50}
                inputMode="tel"
              />
            </div>
          </div>
        </BoxedSection>

        <div className="mt-4">
          <RecordFormNotice stale={stale} saveError={saveError} onReload={mode === 'edit' ? onReload : undefined} />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Huỷ
          </Button>
          {mode === 'create' && (
            <Button type="button" variant="secondary" loading={submitting} disabled={!isValid} onClick={handleSaveAndContinue}>
              Lưu và nhập tiếp
            </Button>
          )}
          <Button type="submit" loading={submitting} disabled={!isValid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
