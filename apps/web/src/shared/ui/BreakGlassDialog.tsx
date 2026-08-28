import { useState } from 'react';
import { LockKeyOpen } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { requestBreakGlass } from '../api/break-glass.api';
import { ApiError } from '../api/client';
import { Button } from './Button';
import { PasswordInput } from './PasswordInput';

/**
 * Xin phá kính (break-glass) — hiện khi một thao tác bị chặn `403 PERMISSION_DENIED` kèm
 * `breakGlassAvailable: true` (`.claude/docs/security-audit.md`). Xác thực lại đúng mật khẩu đăng
 * nhập của CHÍNH tài khoản đang dùng (không phải mật khẩu của ai khác) + lý do bắt buộc. Thành công
 * thì gọi `onGranted()` để nơi gọi tự thử lại thao tác vừa bị chặn — dialog không tự retry vì không
 * biết thao tác gốc là gì. Cùng khuôn overlay/card `VitalSignsDialog.tsx` (chưa có `Dialog`
 * primitive dùng chung trong dự án). Lần dùng thật đầu tiên — web trước đây chưa từng gọi
 * `POST /break-glass`, dù backend đã có từ S1-04c.
 */
export function BreakGlassDialog({
  entityType,
  entityId,
  onGranted,
  onClose,
}: {
  /** Phải khớp đúng `module` của `@RequirePermission` đang bị chặn (ví dụ `'diagnosis'`, `'clinical_note'`). */
  entityType: string;
  entityId: string;
  onGranted: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: requestBreakGlass });

  async function handleSubmit() {
    setError(null);
    if (!password.trim() || !reason.trim()) {
      setError('Nhập đầy đủ mật khẩu và lý do.');
      return;
    }
    try {
      await mutation.mutateAsync({ entityType, entityId, reason, password });
      onGranted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không xin được vượt quyền, vui lòng thử lại.');
    }
  }

  return (
    // z-60 (không phải z-50 mặc định) — break-glass luôn là một bước LEO THANG xin quyền, có thể
    // xảy ra khi một dialog z-50 khác (ví dụ "Đính chính") đang mở sẵn; cùng z-50 thì DOM order
    // quyết định lớp trên/dưới, dialog sau cùng che mất popup này khiến không thao tác được (lỗi
    // thật chủ dự án phát hiện lúc kiểm "Đính chính chẩn đoán", Sprint 5 S5-02/03). z-60 đã là quy
    // ước có sẵn cho "lớp trên dialog" ở nơi khác trong app (ví dụ popup "Hoàn tất khám thành công").
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby="break-glass-title">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="px-6 pb-5 pt-6">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 ring-8 ring-amber-100/60">
            <LockKeyOpen size={22} weight="fill" className="text-amber-600" />
          </div>
          <h2 id="break-glass-title" className="text-[16px] font-bold text-slate-900">
            Xin vượt quyền tạm thời
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            Bạn không có quyền thao tác trực tiếp ở đây. Nhập lại mật khẩu đăng nhập của mình kèm lý do — thao tác này được ghi vào nhật ký hoạt động.
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="bg-password" className="mb-1 block text-sm font-semibold text-slate-800">
                Mật khẩu đăng nhập
              </label>
              <PasswordInput id="bg-password" value={password} onChange={setPassword} autoComplete="current-password" />
            </div>
            <div>
              <label htmlFor="bg-reason" className="mb-1 block text-sm font-semibold text-slate-800">
                Lý do
              </label>
              <textarea
                id="bg-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ví dụ: sửa nhầm chẩn đoán lúc khám, chủ động vá lại theo yêu cầu bác sĩ..."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={() => void handleSubmit()}>
            Xác nhận
          </Button>
        </div>
      </div>
    </div>
  );
}