import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Stethoscope, UserMinus, Warning, WarningCircle } from '@phosphor-icons/react';
import type { InteropActionResult, InteropDoctorRow, InteropFacilityRow } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { TwoOptionToggle } from '../../shared/ui/TwoOptionToggle';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { NoticeRow } from '../../shared/ui/NoticeRow';
import { findCurrentBranch } from '../branch/branch-visibility';
import { useShowBranchInfo } from '../branch/BranchChip';
import { InteropCredentialDialog } from './InteropCredentialDialog';
import { describeDoctorToken, describeFacilityToken } from './interop-token-view';
import {
  useAddInteropDoctorMutation,
  useInteropDoctorsQuery,
  useInteropFacilitiesQuery,
  useLoginInteropFacilityMutation,
  usePrescriptionInteropSettingsQuery,
  useRemoveInteropDoctorMutation,
  useSaveInteropDoctorCredentialMutation,
  useSaveInteropFacilityCredentialMutation,
  useUpdatePrescriptionInteropSettingsMutation,
} from './prescription-interop.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-800';

type Mode = 'OFF' | 'ON';

interface Draft {
  enabled: boolean;
  sendEnabled: boolean;
  gatewayUrl: string;
  timeoutSeconds: string;
  maxRetries: string;
}

/** Địa chỉ cổng phải là https (mã + mật khẩu liên thông đi qua đường này); http chỉ cho máy cục bộ để thử — khớp kiểm ở máy chủ. */
function isValidGatewayUrl(value: string): boolean {
  const v = value.trim();
  return /^https:\/\/\S+$/i.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i.test(v);
}

function parseIntInRange(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

type DialogTarget = { kind: 'facility'; row: InteropFacilityRow } | { kind: 'doctor'; row: InteropDoctorRow };
type Notice = { scope: 'connection' | 'facility' | 'doctor'; result: InteropActionResult };

/** Kết quả một thao tác gọi cổng: xanh (thành công), đỏ (cổng từ chối, kèm nguyên văn lỗi), hổ phách (không kết nối được/thiếu cấu hình) — đúng mockup 8d. */
function ResultAlert({ result }: { result: InteropActionResult }) {
  const tone =
    result.outcome === 'OK'
      ? { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: CheckCircle }
      : result.outcome === 'REJECTED'
        ? { box: 'border-rose-300 bg-rose-50 text-rose-700', Icon: WarningCircle }
        : { box: 'border-amber-300 bg-amber-50 text-amber-800', Icon: Warning };
  return (
    <div role="alert" className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${tone.box}`}>
      <tone.Icon size={18} weight="fill" className="mt-0.5 flex-none" aria-hidden="true" />
      <div className="min-w-0">
        <p className={result.outcome === 'OK' ? 'font-semibold' : ''}>{result.message}</p>
        {result.errors.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-xs">
            {result.errors.map((e, i) => (
              <li key={i} className="break-words">
                {e}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * "Liên thông đơn thuốc" (docs/DECISIONS.md #242 giai đoạn 3, mockup 8d đã chốt) — pill phẳng trong "Cấu hình hệ thống", MỘT nơi duy nhất nhập thông tin kết nối: công tắc tổng, địa chỉ cổng + thông số,
 * "Gửi đơn lên cổng", "Kiểm tra kết nối", mã/mật khẩu + token của cơ sở (theo chi nhánh), mã/mật khẩu + "Trên cổng" + token của bác sĩ (thêm/xoá khỏi cơ sở), trạng thái khoá nhà cung cấp phần mềm.
 * Khung kết nối đã dựng đủ nhưng CHƯA kiểm với cổng thật (chưa có môi trường thử). Công tắc "Gửi đơn lên cổng" mới lưu cấu hình — việc gửi đơn (hàng chờ) làm ở bước sau.
 */
export function PrescriptionInteropPane() {
  const canManage = useHasPermission('clinic_config', 'update');
  const showBranch = useShowBranchInfo();
  const currentBranch = useAuthStore((s) => findCurrentBranch(s.user));

  const settingsQuery = usePrescriptionInteropSettingsQuery();
  const updateMutation = useUpdatePrescriptionInteropSettingsMutation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [removeTarget, setRemoveTarget] = useState<InteropDoctorRow | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (settingsQuery.data) {
      const s = settingsQuery.data;
      setDraft({ enabled: s.enabled, sendEnabled: s.sendEnabled, gatewayUrl: s.gatewayUrl, timeoutSeconds: String(s.timeoutSeconds), maxRetries: String(s.maxRetries) });
    }
  }, [settingsQuery.data]);

  const serverEnabled = settingsQuery.data?.enabled === true;
  const facilitiesQuery = useInteropFacilitiesQuery(serverEnabled);
  const doctorsQuery = useInteropDoctorsQuery(serverEnabled);
  const saveFacility = useSaveInteropFacilityCredentialMutation();
  const saveDoctor = useSaveInteropDoctorCredentialMutation();
  const loginFacility = useLoginInteropFacilityMutation();
  const addDoctor = useAddInteropDoctorMutation();
  const removeDoctor = useRemoveInteropDoctorMutation();

  const parsedTimeout = draft ? parseIntInRange(draft.timeoutSeconds, 5, 120) : null;
  const parsedRetries = draft ? parseIntInRange(draft.maxRetries, 0, 10) : null;
  const urlValid = draft ? isValidGatewayUrl(draft.gatewayUrl) : false;
  const valid = draft !== null && urlValid && parsedTimeout !== null && parsedRetries !== null;
  const dirty = useMemo(() => {
    const s = settingsQuery.data;
    if (!draft || !s) return false;
    return draft.enabled !== s.enabled || draft.sendEnabled !== s.sendEnabled || draft.gatewayUrl.trim().replace(/\/+$/, '') !== s.gatewayUrl || parsedTimeout !== s.timeoutSeconds || parsedRetries !== s.maxRetries;
  }, [draft, settingsQuery.data, parsedTimeout, parsedRetries]);
  const errorMessage = updateMutation.error instanceof ApiError ? updateMutation.error.message : undefined;

  function patch(next: Partial<Draft>) {
    setSaved(false);
    updateMutation.reset();
    setDraft((d) => (d ? { ...d, ...next } : d));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !valid || !dirty || !canManage) return;
    updateMutation.mutate({ enabled: draft.enabled, sendEnabled: draft.sendEnabled, gatewayUrl: draft.gatewayUrl.trim(), timeoutSeconds: parsedTimeout!, maxRetries: parsedRetries! }, { onSuccess: () => setSaved(true) });
  }

  function handleCancel() {
    const s = settingsQuery.data;
    if (!s) return;
    setSaved(false);
    updateMutation.reset();
    setDraft({ enabled: s.enabled, sendEnabled: s.sendEnabled, gatewayUrl: s.gatewayUrl, timeoutSeconds: String(s.timeoutSeconds), maxRetries: String(s.maxRetries) });
  }

  /** Chạy một thao tác gọi cổng: hiện trạng thái đang chạy, rồi kết quả (kể cả khi cổng từ chối — máy chủ vẫn trả 200). */
  async function runAction(key: string, scope: Notice['scope'], call: () => Promise<InteropActionResult>) {
    setBusyKey(key);
    setNotice(null);
    try {
      setNotice({ scope, result: await call() });
    } catch (err) {
      setNotice({ scope, result: { outcome: 'UNREACHABLE', message: err instanceof ApiError ? err.message : 'Không thực hiện được. Thử lại sau.', errors: [] } });
    } finally {
      setBusyKey(null);
    }
  }

  const facilities = facilitiesQuery.data?.items ?? [];
  const doctors = doctorsQuery.data?.items ?? [];
  // "Kiểm tra kết nối" thử cơ sở của chi nhánh đang làm việc; công ty 1 chi nhánh thì cơ sở duy nhất.
  const testFacility = facilities.find((f) => f.branchId === currentBranch?.id) ?? facilities.find((f) => f.isDefault) ?? facilities[0];
  const testLabel = showBranch && testFacility ? `Chi nhánh đang làm (${testFacility.branchName})` : 'cơ sở khám chữa bệnh';

  return (
    <div className="flex h-full flex-col">
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <h2 className="sr-only">Liên thông đơn thuốc</h2>

        {settingsQuery.isError && <ErrorBanner message="Không tải được cấu hình liên thông đơn thuốc." onRetry={() => void settingsQuery.refetch()} />}
        {settingsQuery.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {draft && (
          <div className="scroll-hover min-h-0 flex-1 space-y-8 overflow-y-auto pb-4 pt-3">
            <BoxedSection badge="Liên thông đơn thuốc quốc gia">
              <p className="mb-2 text-sm font-semibold text-slate-800">Phòng khám có liên thông đơn thuốc quốc gia không?</p>
              <TwoOptionToggle<Mode>
                options={[
                  { value: 'OFF', label: 'Không liên thông' },
                  { value: 'ON', label: 'Có liên thông' },
                ]}
                value={draft.enabled ? 'ON' : 'OFF'}
                onChange={(next) => next && patch({ enabled: next === 'ON' })}
                disabled={!canManage}
              />
              <p className="mt-2 max-w-3xl text-xs text-slate-500">
                {draft.enabled && !serverEnabled
                  ? 'Bạn vừa chọn "Có liên thông" nhưng CHƯA LƯU: bấm "Lưu" ở cuối trang trước. Lưu xong, bảng nhập mã liên thông và mật khẩu của cơ sở và bác sĩ mới hiện ở bên dưới.'
                  : draft.enabled
                    ? 'Bật: màn kê đơn có khối "Thông tin liên thông" và cảnh báo thiếu dữ liệu, có menu "Đơn thuốc liên thông", đơn ký xong được xếp vào hàng chờ gửi. Nhập mã liên thông của cơ sở và bác sĩ ở dưới, kiểm tra kết nối và thêm bác sĩ vào cơ sở trên cổng.'
                  : 'Tắt: ẩn khối "Thông tin liên thông" ở màn kê đơn, không cảnh báo thiếu dữ liệu, không có menu "Đơn thuốc liên thông", không xếp hàng chờ, không cần mã liên thông. Mã đơn chuẩn Bộ Y tế vẫn dùng được riêng. Bật lại sau này thì đơn ký trong lúc tắt không tự xếp hàng.'}
              </p>
            </BoxedSection>

            {draft.enabled && (
              <>
                <BoxedSection badge="Kết nối máy chủ">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label htmlFor="interop-url" className="mb-1.5 block text-sm font-semibold text-slate-800">
                        Địa chỉ máy chủ (API) <span className="text-rose-500">*</span>
                      </label>
                      <input id="interop-url" className={inputClassName} value={draft.gatewayUrl} onChange={(e) => patch({ gatewayUrl: e.target.value })} disabled={!canManage} inputMode="url" maxLength={300} />
                      {draft.gatewayUrl.trim() !== '' && !urlValid ? (
                        <p className="mt-1 text-xs font-semibold text-rose-700">Địa chỉ phải bắt đầu bằng https://.</p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">Địa chỉ theo Quyết định 808/QĐ-BYT. Tài liệu chưa nêu môi trường thử; khi đơn vị vận hành cấp địa chỉ thử thì đổi ở đây.</p>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <p className="mb-1.5 text-sm font-semibold text-slate-800">Gửi đơn lên cổng</p>
                      <TwoOptionToggle<Mode>
                        options={[
                          { value: 'OFF', label: 'Tắt, chỉ xếp hàng chờ' },
                          { value: 'ON', label: 'Bật, tự gửi nền sau khi ký' },
                        ]}
                        value={draft.sendEnabled ? 'ON' : 'OFF'}
                        onChange={(next) => next && patch({ sendEnabled: next === 'ON' })}
                        disabled={!canManage}
                      />
                      <p className="mt-1.5 text-xs text-slate-500">
                        {draft.sendEnabled ? 'Đơn ký xong được gửi nền; lỗi mạng tự thử lại, lỗi dữ liệu dừng ở trạng thái Lỗi để người dùng sửa.' : 'Đơn ký xong chỉ xếp hàng chờ, chưa gửi đi.'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-3 py-1.5 text-sm"
                      loading={busyKey === 'test'}
                      disabled={!canManage || !testFacility || dirty || busyKey !== null}
                      title={dirty ? 'Lưu cấu hình trước khi kiểm tra kết nối' : undefined}
                      onClick={() => testFacility && void runAction('test', 'connection', () => loginFacility.mutateAsync(testFacility.branchId))}
                    >
                      Kiểm tra kết nối
                    </Button>
                    <span className="text-xs text-slate-500">{dirty ? 'Lưu cấu hình trước, rồi kiểm tra.' : `Đăng nhập ${testLabel} để thử, không gửi đơn nào.`}</span>
                  </div>
                  {notice?.scope === 'connection' && <ResultAlert result={notice.result} />}

                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">Thông số nâng cao (hệ thống tự đặt, không thuộc quy định của cổng)</summary>
                    <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label htmlFor="interop-timeout" className="mb-1.5 block text-sm font-semibold text-slate-800">
                          Thời gian chờ mỗi lần gọi (giây)
                        </label>
                        <input
                          id="interop-timeout"
                          className={`${inputClassName} text-center`}
                          value={draft.timeoutSeconds}
                          onChange={(e) => patch({ timeoutSeconds: e.target.value })}
                          disabled={!canManage}
                          inputMode="numeric"
                          maxLength={3}
                        />
                        {parsedTimeout === null && <p className="mt-1 text-xs font-semibold text-rose-700">Nhập số từ 5 đến 120.</p>}
                      </div>
                      <div>
                        <label htmlFor="interop-retries" className="mb-1.5 block text-sm font-semibold text-slate-800">
                          Số lần thử lại tối đa khi lỗi mạng
                        </label>
                        <input
                          id="interop-retries"
                          className={`${inputClassName} text-center`}
                          value={draft.maxRetries}
                          onChange={(e) => patch({ maxRetries: e.target.value })}
                          disabled={!canManage}
                          inputMode="numeric"
                          maxLength={2}
                        />
                        {parsedRetries === null ? <p className="mt-1 text-xs font-semibold text-rose-700">Nhập số từ 0 đến 10.</p> : <p className="mt-1 text-xs text-slate-500">Giãn dần: 1, 5, 15, 60 phút.</p>}
                      </div>
                    </div>
                  </details>
                </BoxedSection>

                <BoxedSection badge={showBranch ? 'Cơ sở khám chữa bệnh theo chi nhánh' : 'Cơ sở khám chữa bệnh'}>
                  {!serverEnabled && <SaveFirstNotice />}
                  {facilitiesQuery.isError && <ErrorBanner message="Không tải được danh sách cơ sở." onRetry={() => void facilitiesQuery.refetch()} />}
                  {facilitiesQuery.isLoading && <Skeleton className="h-16 w-full" />}
                  {facilitiesQuery.data && (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                            {showBranch && <th className="px-4 py-2.5 text-left">Chi nhánh</th>}
                            <th className="px-4 py-2.5 text-center">Mã liên thông cơ sở</th>
                            <th className="px-4 py-2.5 text-center">Mật khẩu</th>
                            <th className="px-4 py-2.5 text-center">Token</th>
                            <th className="px-4 py-2.5 text-center">Trạng thái</th>
                            <th className="px-4 py-2.5 text-center">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {facilities.map((f) => {
                            const view = describeFacilityToken(f.token, f.code !== null && f.hasPassword);
                            return (
                              <tr key={f.branchId} className="border-b border-slate-200 last:border-0">
                                {showBranch && (
                                  <td className="max-w-[240px] px-4 py-2 text-left font-semibold text-slate-900">
                                    <div className="truncate" title={f.branchName}>
                                      {f.branchName}
                                    </div>
                                  </td>
                                )}
                                <td className="px-4 py-2 text-center font-medium text-slate-700">{f.code ?? <StatusBadge tone="neutral">Chưa nhập</StatusBadge>}</td>
                                <td className="px-4 py-2 text-center">{f.hasPassword ? <StatusBadge tone="success">Đã lưu</StatusBadge> : <StatusBadge tone="neutral">Chưa có</StatusBadge>}</td>
                                <td className="px-4 py-2 text-center text-slate-700">
                                  {view.primary ? (
                                    <>
                                      <div>{view.primary}</div>
                                      <div className="text-xs text-slate-500">{view.secondary}</div>
                                    </>
                                  ) : (
                                    <span className="text-slate-500">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-center">
                                  <StatusBadge tone={view.badge.tone}>{view.badge.label}</StatusBadge>
                                </td>
                                <td className="px-4 py-2 text-center">
                                  {canManage && (
                                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                                      <Button type="button" variant="secondary" className="px-3 py-1 text-xs" disabled={busyKey !== null} onClick={() => setDialog({ kind: 'facility', row: f })}>
                                        {f.code ? 'Sửa mã/mật khẩu' : 'Nhập mã/mật khẩu'}
                                      </Button>
                                      {f.code && f.hasPassword && (
                                        <Button
                                          type="button"
                                          variant="secondary"
                                          className="px-3 py-1 text-xs"
                                          loading={busyKey === `fac-${f.branchId}`}
                                          disabled={busyKey !== null}
                                          onClick={() => void runAction(`fac-${f.branchId}`, 'facility', () => loginFacility.mutateAsync(f.branchId))}
                                        >
                                          Đăng nhập lại
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {notice?.scope === 'facility' && <ResultAlert result={notice.result} />}
                  <p className="mt-2 text-xs text-slate-500">
                    Cổng không trả hạn của token (chỉ trả token), nên hạn hiện ở đây là hệ thống tính: giờ đăng nhập cộng 7 ngày. Hệ thống tự đăng nhập lại khi sắp hết hạn hoặc khi cổng trả lỗi chưa xác thực. Token chỉ
                    lưu mã hoá, không hiện ra. Mã liên thông cơ sở cấp trên donthuocquocgia.vn, khác mã cơ sở KCB 5 chữ số của mã đơn thuốc.
                  </p>
                </BoxedSection>

                <BoxedSection badge={showBranch && currentBranch ? `Bác sĩ tại ${currentBranch.name}` : 'Bác sĩ'}>
                  {!serverEnabled && <SaveFirstNotice />}
                  {doctorsQuery.isError && <ErrorBanner message="Không tải được danh sách bác sĩ." onRetry={() => void doctorsQuery.refetch()} />}
                  {doctorsQuery.isLoading && <Skeleton className="h-24 w-full" />}
                  {doctorsQuery.data && doctors.length === 0 && <EmptyState icon={Stethoscope} title="Chưa có bác sĩ nào" description="Chưa có tài khoản bác sĩ đang hoạt động ở chi nhánh này." />}
                  {doctorsQuery.data && doctors.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                            <th className="px-4 py-2.5 text-left">Bác sĩ</th>
                            <th className="px-4 py-2.5 text-center">Mã liên thông bác sĩ</th>
                            <th className="px-4 py-2.5 text-center">Mật khẩu</th>
                            <th className="px-4 py-2.5 text-center">Trên cổng</th>
                            <th className="px-4 py-2.5 text-center">Token</th>
                            <th className="px-4 py-2.5 text-center">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {doctors.map((d) => {
                            const ready = d.code !== null && d.hasPassword;
                            return (
                              <tr key={d.userId} className="border-b border-slate-200 last:border-0">
                                <td className="max-w-[260px] px-4 py-2 text-left">
                                  <div className="truncate font-semibold text-slate-900" title={d.fullName}>
                                    {d.fullName}
                                  </div>
                                  {d.licenseNo && <div className="truncate text-xs text-slate-500">CCHN {d.licenseNo}</div>}
                                </td>
                                <td className="px-4 py-2 text-center font-medium text-slate-700">{d.code ?? <StatusBadge tone="neutral">Chưa nhập</StatusBadge>}</td>
                                <td className="px-4 py-2 text-center">{d.hasPassword ? <StatusBadge tone="success">Đã lưu</StatusBadge> : <StatusBadge tone="neutral">Chưa có</StatusBadge>}</td>
                                <td className="px-4 py-2 text-center">
                                  {d.onGateway ? <StatusBadge tone="success">Đã thêm</StatusBadge> : ready ? <StatusBadge tone="warning">Chưa thêm</StatusBadge> : <span className="text-slate-500">—</span>}
                                </td>
                                <td className="px-4 py-2 text-center text-xs text-slate-600">{describeDoctorToken(d.token)}</td>
                                <td className="px-4 py-2 text-center">
                                  {canManage && (
                                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                                      <Button type="button" variant="secondary" className="px-3 py-1 text-xs" disabled={busyKey !== null} onClick={() => setDialog({ kind: 'doctor', row: d })}>
                                        {d.code ? 'Sửa mã/mật khẩu' : 'Nhập mã/mật khẩu'}
                                      </Button>
                                      {ready && !d.onGateway && (
                                        <Button
                                          type="button"
                                          variant="secondary"
                                          className="px-3 py-1 text-xs"
                                          loading={busyKey === `add-${d.userId}`}
                                          disabled={busyKey !== null}
                                          onClick={() => void runAction(`add-${d.userId}`, 'doctor', () => addDoctor.mutateAsync(d.userId))}
                                        >
                                          Thêm vào cơ sở
                                        </Button>
                                      )}
                                      {d.onGateway && (
                                        <Button type="button" variant="dangerGhost" className="px-3 py-1 text-xs" disabled={busyKey !== null} onClick={() => setRemoveTarget(d)}>
                                          Xoá khỏi cơ sở
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {notice?.scope === 'doctor' && <ResultAlert result={notice.result} />}
                  <p className="mt-2 text-xs text-slate-500">
                    Token của bác sĩ theo từng cặp bác sĩ và cơ sở: bác sĩ làm ở hai chi nhánh có hai token, đổi chi nhánh ở thanh trên cùng để xem cơ sở kia. "Thêm vào cơ sở" và "Xoá khỏi cơ sở" gọi API thêm/xoá bác sĩ
                    của cổng bằng token cơ sở. Mỗi bác sĩ một tài khoản liên thông cho mọi chi nhánh; quản trị nhập hộ. Mật khẩu mã hoá khi lưu, không hiện lại.
                  </p>
                </BoxedSection>

                <BoxedSection badge="Khoá của nhà cung cấp phần mềm (app-name, app-key)">
                  <div className="flex flex-wrap items-center gap-3">
                    {settingsQuery.data?.appKeyConfigured ? <StatusBadge tone="success">Đã cấu hình</StatusBadge> : <StatusBadge tone="neutral">Chưa cấu hình</StatusBadge>}
                    <span className="text-xs text-slate-500">Do đơn vị vận hành cổng cấp cho nhà cung cấp phần mềm, cài ở máy chủ, không nhập tại đây. Chỉ cần cho API nhà thuốc (lấy đơn, báo số lượng bán).</span>
                  </div>
                </BoxedSection>
              </>
            )}
          </div>
        )}

        {draft && (
          <div className="flex flex-shrink-0 items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <div className="mr-auto min-h-5 text-sm" aria-live="polite">
              {errorMessage && <span className="font-semibold text-rose-700">{errorMessage}</span>}
              {saved && !dirty && !errorMessage && <span className="font-semibold text-emerald-700">Đã lưu.</span>}
              {!errorMessage && !(saved && !dirty) && <span className="text-xs text-slate-500">Lưu cấu hình không làm đơn đã xếp hàng chờ biến mất.</span>}
            </div>
            {canManage && (
              <>
                <Button type="button" variant="secondary" onClick={handleCancel} disabled={!dirty || updateMutation.isPending}>
                  Huỷ
                </Button>
                <Button type="submit" loading={updateMutation.isPending} disabled={!dirty || !valid}>
                  Lưu
                </Button>
              </>
            )}
          </div>
        )}
      </form>

      {/* Hộp thoại có <form> riêng nên PHẢI nằm ngoài <form> của trang (không lồng form, Enter chỉ lưu hộp thoại). */}
      {dialog?.kind === 'facility' && (
        <InteropCredentialDialog
          title="Mã liên thông cơ sở"
          subtitle={showBranch ? dialog.row.branchName : 'Cơ sở khám chữa bệnh'}
          codeLabel="Mã liên thông cơ sở"
          codeHint="Khác mã cơ sở KCB 5 chữ số của mã đơn thuốc."
          passwordLabel="Mật khẩu"
          passwordHint="Mã hoá khi lưu, không hiện lại, chỉ ghi đè được."
          initialCode={dialog.row.code}
          hasPassword={dialog.row.hasPassword}
          onSave={async (value) => {
            setNotice(null);
            await saveFacility.mutateAsync({ branchId: dialog.row.branchId, body: value });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'doctor' && (
        <InteropCredentialDialog
          title="Mã liên thông bác sĩ"
          subtitle={dialog.row.fullName}
          codeLabel="Mã liên thông bác sĩ"
          passwordLabel="Mật khẩu tài khoản liên thông của bác sĩ"
          passwordHint="Quản trị nhập hộ. Một tài khoản cổng cho mọi chi nhánh bác sĩ làm việc. Mã hoá khi lưu, không hiện lại."
          initialCode={dialog.row.code}
          hasPassword={dialog.row.hasPassword}
          onSave={async (value) => {
            setNotice(null);
            await saveDoctor.mutateAsync({ userId: dialog.row.userId, body: value });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {removeTarget && (
        <ConfirmDialog
          icon={UserMinus}
          tone="danger"
          title="Xoá khỏi cơ sở"
          rows={[{ label: 'Bác sĩ', value: removeTarget.fullName }]}
          note="Bác sĩ không gửi được đơn tới khi thêm lại"
          onClose={() => setRemoveTarget(null)}
          actions={
            <>
              <Button type="button" variant="secondary" onClick={() => setRemoveTarget(null)}>
                Huỷ
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  const target = removeTarget;
                  setRemoveTarget(null);
                  void runAction(`del-${target.userId}`, 'doctor', () => removeDoctor.mutateAsync(target.userId));
                }}
              >
                Xoá
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

/** Mới gạt "Có liên thông" mà chưa Lưu: bảng cơ sở/bác sĩ chưa tải (chỉ tải khi cấu hình ĐÃ LƯU là bật) nên khối sẽ trống — nói rõ cần làm gì thay vì để trống. */
function SaveFirstNotice() {
  return (
    <div className="mb-3">
      <NoticeRow title="Bấm Lưu trước.">Chưa lưu nên chưa có bảng nhập. Bấm "Lưu" ở cuối trang, bảng nhập mã liên thông và mật khẩu sẽ hiện ngay ở đây.</NoticeRow>
    </div>
  );
}
