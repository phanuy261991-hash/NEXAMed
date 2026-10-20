import { useState } from 'react';
import { Key } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { PasswordInput } from '../../shared/ui/PasswordInput';
import { ApiError } from '../../shared/api/client';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export interface InteropCredentialDialogProps {
  /** "Mã liên thông cơ sở" / "Mã liên thông bác sĩ". */
  title: string;
  /** Tên chi nhánh hoặc tên bác sĩ đang nhập hộ. */
  subtitle: string;
  codeLabel: string;
  codeHint?: string;
  passwordLabel: string;
  passwordHint: string;
  /** Mã đã lưu (nếu có) để điền sẵn. */
  initialCode: string | null;
  /** Đã có mật khẩu lưu → bỏ trống ô mật khẩu = giữ nguyên. */
  hasPassword: boolean;
  /** Ném lỗi khi lưu thất bại để hộp thoại hiện lỗi và không đóng. */
  onSave: (value: { code: string; password?: string }) => Promise<void>;
  onClose: () => void;
}

/**
 * Nhập/sửa mã + mật khẩu liên thông (cơ sở hoặc bác sĩ) — docs/DECISIONS.md #242 GĐ3, mockup 8d. Dùng chung cho cả hai (chỉ khác nhãn). Mật khẩu chỉ GHI ĐÈ được, không hiện lại;
 * lần đầu bắt buộc, đã có thì để trống = giữ nguyên. Form `<form>` để Enter lưu (ui-guidelines 4.4).
 */
export function InteropCredentialDialog({ title, subtitle, codeLabel, codeHint, passwordLabel, passwordHint, initialCode, hasPassword, onSave, onClose }: InteropCredentialDialogProps) {
  const [code, setCode] = useState(initialCode ?? '');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedCode = code.trim();
  const invalid = trimmedCode === '' || (!hasPassword && password === '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ code: trimmedCode, ...(password !== '' ? { password } : {}) });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được. Thử lại sau.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <form className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader icon={Key} title={title} subtitle={subtitle} onClose={onClose} />

        <div className="space-y-4">
          <div>
            <label htmlFor="interop-code" className="mb-1.5 block text-sm font-semibold text-slate-800">
              {codeLabel} <span className="text-rose-500">*</span>
            </label>
            <input id="interop-code" className={inputClassName} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Cấp trên donthuocquocgia.vn" maxLength={100} autoComplete="off" autoFocus />
            {codeHint && <p className="mt-1 text-xs text-slate-500">{codeHint}</p>}
          </div>
          <div>
            <label htmlFor="interop-password" className="mb-1.5 block text-sm font-semibold text-slate-800">
              {passwordLabel} {!hasPassword && <span className="text-rose-500">*</span>}
            </label>
            <PasswordInput
              id="interop-password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              placeholder={hasPassword ? 'Để trống để giữ mật khẩu đã lưu' : undefined}
            />
            <p className="mt-1 text-xs text-slate-500">{passwordHint}</p>
          </div>
          {error && <ErrorBanner message={error} />}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button type="submit" loading={saving} disabled={invalid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
