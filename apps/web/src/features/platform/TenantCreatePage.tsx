import { useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import type { CreatePlatformTenantResponse } from '@nexamed/shared';
import { copyText } from '../../shared/format/clipboard';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Textarea } from '../../shared/ui/Textarea';
import { PlatformApiError } from './platform.api';
import { TENANT_CODE_PATTERN, previewLoginHost } from './platform-format';
import { useCreateTenantMutation } from './platform.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

function Field({ id, label, required, hint, className, children }: { id: string; label: string; required?: boolean; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-slate-800">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs font-medium text-slate-500">{hint}</p>}
    </div>
  );
}

/** Kết quả sau khi tạo: địa chỉ đăng nhập + tài khoản + mật khẩu tạm CHỈ hiện một lần, kèm nút sao chép gửi khách. */
function CreatedResult({ result, loginHost }: { result: CreatePlatformTenantResponse; loginHost: string }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const loginUrl = result.tenant.loginUrl ?? `https://${loginHost}`;

  async function handleCopy() {
    const ok = await copyText(`Địa chỉ đăng nhập: ${loginUrl}\nTên đăng nhập: ${result.adminUsername}\nMật khẩu tạm: ${result.temporaryPassword}\n(Bạn sẽ được yêu cầu đổi mật khẩu ở lần đăng nhập đầu tiên.)`);
    setCopied(ok ? 'ok' : 'failed');
  }

  return (
    <div className="rounded-lg border border-emerald-500 bg-emerald-50 p-5">
      <p className="flex items-center gap-2 text-base font-bold text-slate-900">
        <CheckCircle size={20} weight="fill" className="text-emerald-600" aria-hidden="true" />
        Đã tạo công ty "{result.tenant.name}"
      </p>
      <p className="mt-1 text-sm font-medium text-slate-700">Gửi cho khách thông tin dưới đây. Mật khẩu chỉ hiện đúng một lần, khách bị bắt đổi ở lần đăng nhập đầu.</p>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-slate-500">Địa chỉ đăng nhập</dt>
          <dd className="break-all text-base font-bold text-blue-700">{loginUrl}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-slate-500">Tên đăng nhập quản trị</dt>
          <dd className="text-base font-bold text-slate-900">{result.adminUsername}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-sm font-medium text-slate-500">Mật khẩu tạm</dt>
          <dd className="text-lg font-extrabold tracking-wide text-slate-900">{result.temporaryPassword}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => void handleCopy()}>
          Sao chép thông tin gửi khách
        </Button>
        <Button type="button" onClick={() => navigate('/')}>
          Về danh sách
        </Button>
        <span role="status" aria-live="polite" className={`text-sm font-semibold ${copied === 'failed' ? 'text-rose-700' : 'text-emerald-700'}`}>
          {copied === 'ok' ? 'Đã sao chép' : copied === 'failed' ? 'Không sao chép được, hãy chọn và sao chép thủ công' : ''}
        </span>
      </div>
    </div>
  );
}

/** Thêm công ty (docs/DECISIONS.md #237): thông tin công ty + mã (= tên miền phụ, đặt một lần không đổi) + tài khoản quản trị đầu tiên (mật khẩu tạm tự sinh) + ghi chú nội bộ. */
export function TenantCreatePage() {
  const navigate = useNavigate();
  const mutation = useCreateTenantMutation();
  const [created, setCreated] = useState<CreatePlatformTenantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [operatorNote, setOperatorNote] = useState('');

  const loginHost = previewLoginHost(code, window.location.host);
  const codeValid = TENANT_CODE_PATTERN.test(code);
  const canSubmit = name.trim().length >= 2 && codeValid && contactName.trim() && contactPhone.trim() && adminFullName.trim() && adminUsername.trim().length >= 3;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || mutation.isPending) return;
    setError(null);
    try {
      const result = await mutation.mutateAsync({
        name: name.trim(),
        code,
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail.trim() || undefined,
        adminFullName: adminFullName.trim(),
        adminUsername: adminUsername.trim(),
        operatorNote: operatorNote.trim() || undefined,
      });
      setCreated(result);
    } catch (err) {
      setError(err instanceof PlatformApiError ? err.message : 'Không tạo được công ty. Thử lại.');
    }
  }

  if (created) return <CreatedResult result={created} loginHost={loginHost} />;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      <BoxedSection badge="Thông tin công ty">
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-3">
          <Field id="t-name" label="Tên công ty" required className="md:col-span-2">
            <input id="t-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} autoFocus />
          </Field>
          <Field id="t-code" label="Mã công ty" required>
            <input id="t-code" value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} className={inputClassName} />
          </Field>
          <div className="md:col-span-3">
            <span className="mb-1 block text-sm font-semibold text-slate-800">Địa chỉ đăng nhập của khách</span>
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[15px] font-semibold text-blue-700">{loginHost}</p>
            <p className={`mt-1 text-xs font-medium ${code && !codeValid ? 'text-rose-600' : 'text-slate-500'}`}>
              Tạo từ mã công ty, không dấu, 3 đến 30 ký tự (chữ thường, số, gạch ngang); đặt một lần, không đổi được sau này.
            </p>
          </div>
          <Field id="t-contact" label="Người liên hệ" required>
            <input id="t-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputClassName} />
          </Field>
          <Field id="t-phone" label="Số điện thoại" required>
            <input id="t-phone" inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputClassName} />
          </Field>
          <Field id="t-email" label="Email">
            <input id="t-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputClassName} />
          </Field>
        </div>
      </BoxedSection>

      <BoxedSection badge="Tài khoản quản trị đầu tiên">
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-3">
          <Field id="a-name" label="Họ tên" required>
            <input id="a-name" value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} className={inputClassName} />
          </Field>
          <Field id="a-user" label="Tên đăng nhập" required hint="Từ 3 ký tự.">
            <input id="a-user" autoComplete="off" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} className={inputClassName} />
          </Field>
          <div>
            <span className="mb-1 block text-sm font-semibold text-slate-800">Mật khẩu tạm</span>
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[15px] font-semibold text-slate-700">Tự sinh khi tạo, hiện một lần</p>
          </div>
        </div>
      </BoxedSection>

      <BoxedSection badge="Ghi chú nội bộ">
        <Textarea id="t-note" label="Ví dụ: đã chuyển khoản cước 3 tháng ngày 14/10, hẹn gia hạn 14/01" value={operatorNote} onChange={(e) => setOperatorNote(e.target.value)} rows={3} />
      </BoxedSection>

      {error && <ErrorBanner message={error} />}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => navigate('/')}>
          Huỷ
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!canSubmit}>
          Tạo công ty
        </Button>
      </div>
    </form>
  );
}
