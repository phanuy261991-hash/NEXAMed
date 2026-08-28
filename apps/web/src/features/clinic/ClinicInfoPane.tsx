import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, CheckCircle, Image as ImageIcon } from '@phosphor-icons/react';
import type { CurrencyCode, Timezone } from '@nexamed/shared';
import { useAuthStore } from '../auth/auth.store';
import { ApiError, resolveApiUrl } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import {
  useClinicProfileQuery,
  useUpdateClinicProfileMutation,
  useUploadClinicLogoMutation,
  useUploadClinicPrintLogoMutation,
} from './clinic.queries';

/** Khớp `clinic_config.update` — .claude/docs/security-audit.md (chỉ clinic_admin ở v1). */
const MANAGE_ROLES = ['clinic_admin'];

const SECTION_BADGE_CLASS =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

/**
 * Đơn vị tiền tệ/múi giờ — danh sách hiển thị đặt LẶP LẠI có chủ đích ở đây, KHÔNG import từ
 * `@nexamed/shared` (nguồn sự thật cho mã hợp lệ vẫn là `currency.ts`/`timezone.ts` bên đó, dùng
 * để validate ở server) — cùng lý do "giới hạn Rollup" đã ghi ở docs/DECISIONS.md #032/#036: hằng
 * số/hàm giá trị thuần từ `packages/shared` từng không import được vào `apps/web` qua `vite
 * build`. Đổi danh sách mã ở `packages/shared` thì phải sửa lại đúng bộ mã ở đây theo.
 */
const CURRENCY_OPTIONS: ComboboxOption[] = [
  { value: 'VND', label: '🇻🇳 VND — Đồng Việt Nam' },
  { value: 'USD', label: '🇺🇸 USD — Đô la Mỹ' },
  { value: 'EUR', label: '🇪🇺 EUR — Euro' },
  { value: 'JPY', label: '🇯🇵 JPY — Yên Nhật' },
  { value: 'KRW', label: '🇰🇷 KRW — Won Hàn Quốc' },
  { value: 'CNY', label: '🇨🇳 CNY — Nhân dân tệ' },
  { value: 'GBP', label: '🇬🇧 GBP — Bảng Anh' },
  { value: 'AUD', label: '🇦🇺 AUD — Đô la Úc' },
  { value: 'THB', label: '🇹🇭 THB — Baht Thái' },
  { value: 'SGD', label: '🇸🇬 SGD — Đô la Singapore' },
];

const TIMEZONE_OPTIONS: ComboboxOption[] = [
  { value: 'Asia/Ho_Chi_Minh', label: 'Việt Nam (GMT+7)' },
  { value: 'Asia/Bangkok', label: 'Thái Lan / Lào / Campuchia (GMT+7)' },
  { value: 'Asia/Singapore', label: 'Singapore (GMT+8)' },
  { value: 'Asia/Shanghai', label: 'Trung Quốc (GMT+8)' },
  { value: 'Asia/Tokyo', label: 'Nhật Bản (GMT+9)' },
  { value: 'Asia/Seoul', label: 'Hàn Quốc (GMT+9)' },
  { value: 'UTC', label: 'Giờ quốc tế (UTC)' },
  { value: 'Europe/London', label: 'Anh (GMT+0/+1)' },
  { value: 'America/New_York', label: 'Mỹ — Miền Đông (GMT-5/-4)' },
  { value: 'Australia/Sydney', label: 'Úc — Sydney (GMT+10/+11)' },
];

interface LogoUploadBoxProps {
  label: string;
  hint: string;
  imageUrl: string | null;
  version: number | undefined;
  aspectClassName: string;
  disabled: boolean;
  onUpload: (file: File) => Promise<void>;
}

/**
 * Khung upload logo — viết cục bộ (không tách `shared/ui`, chỉ 1 nơi gọi, đúng "trùng lần 2 mới
 * tách" của `CLAUDE.md`). Khác `PatientAvatarUpload.tsx` vì tỷ lệ khung không phải hình vuông cố
 * định (`aspectClassName` truyền vào tuỳ logo chính 2:1 hay logo in 1:1) và `object-contain` thay
 * vì `object-cover` — logo thường là PNG nền trong suốt, không nên bị cắt. `disabled` (chưa vào
 * chế độ Sửa) ẩn nút "Chọn ảnh" — đã hỏi và chốt với chủ dự án 2026-08-13 (nhất quán với trường
 * văn bản khác, áp dụng ngược cả cho `PatientAvatarUpload.tsx`).
 */
function LogoUploadBox({ label, hint, imageUrl, version, aspectClassName, disabled, onUpload }: LogoUploadBoxProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || version === undefined) return;

    setError(null);
    setUploading(true);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải ảnh lên được, vui lòng thử lại.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-semibold text-slate-800">{label}</span>
      <div className={`flex items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-slate-50 ${aspectClassName}`}>
        {imageUrl ? (
          <img src={resolveApiUrl(imageUrl)} alt={label} className="h-full w-full object-contain" />
        ) : (
          <ImageIcon size={28} weight="regular" className="text-slate-300" aria-hidden="true" />
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
      {!disabled && (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || version === undefined}
            className="mt-2 flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Camera size={14} weight="regular" aria-hidden="true" />
            {uploading ? 'Đang tải lên…' : 'Chọn ảnh'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => void handleFileChange(e)} />
        </>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Trang "Thông tin phòng khám" (2026-08-13) — mục con MỚI trong pill "Cấu hình phòng khám"
 * (`ClinicConfigPage.tsx`), đặt trước "Giờ làm việc" theo yêu cầu chủ dự án. Cùng khuôn
 * `ClinicHoursPane.tsx`: toggle Sửa/Lưu/Huỷ cho trường văn bản, Boxed Section Form Pattern (mục
 * 9b) cho từng khối. Upload logo CHỈ bấm được khi đang ở chế độ Sửa (đã hỏi và chốt, nhất quán
 * với các trường văn bản khác).
 */
export function ClinicInfoPane() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.roles.some((role) => MANAGE_ROLES.includes(role)) ?? false;

  const query = useClinicProfileQuery();
  const updateMutation = useUpdateClinicProfileMutation();
  const logoMutation = useUploadClinicLogoMutation();
  const printLogoMutation = useUploadClinicPrintLogoMutation();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('VND');
  const [timezone, setTimezone] = useState<Timezone>('Asia/Ho_Chi_Minh');
  const [savedNotice, setSavedNotice] = useState(false);

  // Không đồng bộ lại trong lúc `editing=true` — upload logo (hoạt động độc lập, bấm là lưu
  // ngay) làm `query.data` đổi (version tăng) NGAY CẢ KHI đang sửa các trường văn bản; nếu effect
  // chạy lại lúc đó sẽ âm thầm ghi đè mất phần văn bản người dùng đang gõ dở.
  useEffect(() => {
    if (!query.data || editing) return;
    setName(query.data.name);
    setPhone(query.data.phone ?? '');
    setAddress(query.data.address ?? '');
    setEmail(query.data.email ?? '');
    setTaxCode(query.data.taxCode ?? '');
    setCurrency(query.data.currency);
    setTimezone(query.data.timezone);
  }, [query.data, editing]);

  function handleCancel() {
    if (query.data) {
      setName(query.data.name);
      setPhone(query.data.phone ?? '');
      setAddress(query.data.address ?? '');
      setEmail(query.data.email ?? '');
      setTaxCode(query.data.taxCode ?? '');
      setCurrency(query.data.currency);
      setTimezone(query.data.timezone);
    }
    setEditing(false);
  }

  function handleSave() {
    if (!query.data) return;
    updateMutation.mutate(
      {
        name,
        phone: phone.trim() === '' ? null : phone,
        address: address.trim() === '' ? null : address,
        email: email.trim() === '' ? null : email,
        taxCode: taxCode.trim() === '' ? null : taxCode,
        currency,
        timezone,
        version: query.data.version,
      },
      {
        onSuccess: () => {
          setEditing(false);
          setSavedNotice(true);
          setTimeout(() => setSavedNotice(false), 3000);
        },
      },
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">Hiển thị trên hệ thống và chuẩn bị cho mẫu in đơn thuốc sau này.</p>
        {canManage && !editing && !query.isLoading && (
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Sửa
          </Button>
        )}
      </div>

      {query.isError && <ErrorBanner message="Không tải được thông tin phòng khám." onRetry={() => query.refetch()} />}

      {query.isLoading || !query.data ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="relative rounded-lg border border-slate-200 p-6 pt-8">
            <span className={SECTION_BADGE_CLASS}>Thông tin cơ bản</span>
            <div className="flex flex-col gap-6 sm:flex-row">
              <div className="flex flex-shrink-0 gap-4">
                <LogoUploadBox
                  label="Logo chính"
                  hint="Khuyến nghị 220×110px"
                  imageUrl={query.data.logoUrl}
                  version={query.data.version}
                  aspectClassName="h-20 w-40"
                  disabled={!editing}
                  onUpload={async (file) => {
                    await logoMutation.mutateAsync({ file, version: query.data!.version });
                  }}
                />
                <LogoUploadBox
                  label="Logo dùng cho mẫu in"
                  hint="Khuyến nghị 110×110px"
                  imageUrl={query.data.printLogoUrl}
                  version={query.data.version}
                  aspectClassName="h-20 w-20"
                  disabled={!editing}
                  onUpload={async (file) => {
                    await printLogoMutation.mutateAsync({ file, version: query.data!.version });
                  }}
                />
              </div>

              <div className="grid flex-1 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">Tên phòng khám</label>
                  {editing ? (
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  ) : (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{query.data.name}</p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">Điện thoại</label>
                  {editing ? (
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  ) : (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{query.data.phone || '—'}</p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">Email</label>
                  {editing ? (
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  ) : (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{query.data.email || '—'}</p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">Mã số thuế</label>
                  {editing ? (
                    <input
                      type="text"
                      value={taxCode}
                      onChange={(e) => setTaxCode(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  ) : (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{query.data.taxCode || '—'}</p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-semibold text-slate-800">Địa chỉ</label>
                  {editing ? (
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  ) : (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{query.data.address || '—'}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="relative rounded-lg border border-slate-200 p-6 pt-8">
            <span className={SECTION_BADGE_CLASS}>Hiển thị</span>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-800">Đơn vị tiền tệ</label>
                {editing ? (
                  <Combobox id="clinic-currency" value={currency} onChange={(v) => setCurrency(v as CurrencyCode)} options={CURRENCY_OPTIONS} />
                ) : (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {CURRENCY_OPTIONS.find((o) => o.value === query.data!.currency)?.label ?? query.data.currency}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-800">Múi giờ hiển thị</label>
                {editing ? (
                  <Combobox id="clinic-timezone" value={timezone} onChange={(v) => setTimezone(v as Timezone)} options={TIMEZONE_OPTIONS} />
                ) : (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {TIMEZONE_OPTIONS.find((o) => o.value === query.data!.timezone)?.label ?? query.data.timezone}
                  </p>
                )}
              </div>
            </div>
          </div>

          {editing && (
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={handleCancel} disabled={updateMutation.isPending}>
                Huỷ
              </Button>
              <Button type="button" loading={updateMutation.isPending} onClick={handleSave}>
                Lưu
              </Button>
            </div>
          )}

          {updateMutation.isError && (
            <ErrorBanner message={updateMutation.error instanceof ApiError ? updateMutation.error.message : 'Không lưu được thông tin. Thử lại.'} />
          )}
        </div>
      )}

      {savedNotice && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          <CheckCircle size={15} weight="fill" aria-hidden="true" />
          Đã lưu thông tin phòng khám.
        </div>
      )}
    </div>
  );
}
