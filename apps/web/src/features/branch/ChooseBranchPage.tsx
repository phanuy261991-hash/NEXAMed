import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { switchBranch } from '../auth/auth.api';
import { useAuthStore } from '../auth/auth.store';
import { needsBranchSelection } from './branch-visibility';

/**
 * "Chọn chi nhánh làm việc" (docs/DECISIONS.md #231, mockup Màn 2a đã duyệt) — hiện ngay sau đăng nhập, CHỈ khi tài khoản được gán từ 2 chi nhánh trở lên và phiên chưa có chi nhánh hiện hành
 * (`RequireAuth` chuyển hướng tới đây, cùng khuôn `/change-password`). Đứng ngoài `AppShell` (chưa có chi nhánh thì chưa có dữ liệu nào để hiện sau menu). Mặc định chọn sẵn chi nhánh mặc định của
 * công ty và bật "Nhớ lựa chọn" như mockup; chọn xong máy chủ cấp access token mới mang chi nhánh đó.
 */
export function ChooseBranchPage() {
  const user = useAuthStore((s) => s.user);
  const setCurrentBranch = useAuthStore((s) => s.setCurrentBranch);
  const navigate = useNavigate();

  const branches = user?.branches ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(() => (branches.find((b) => b.isDefault) ?? branches[0])?.id ?? null);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Không cần chọn (1 chi nhánh, hoặc phiên đã có chi nhánh) → về trang chủ, không để người dùng kẹt ở màn này.
  if (!needsBranchSelection(user)) return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedId === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await switchBranch(selectedId, remember);
      setCurrentBranch(result.currentBranchId, result.accessToken);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5">
        <h1 className="text-xl font-semibold text-slate-900">Chọn chi nhánh làm việc</h1>
        <p className="mt-1 text-sm text-slate-500">
          Bạn đang đăng nhập với tài khoản <strong className="font-semibold text-slate-900">{user?.displayName ?? user?.fullName}</strong>.
        </p>

        <div className="mt-4 space-y-3" role="radiogroup" aria-label="Chi nhánh làm việc">
          {branches.map((b) => {
            const selected = b.id === selectedId;
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSelectedId(b.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-4 py-3 text-left ${
                  selected ? 'border-2 border-brand-teal bg-brand-teal-tint' : 'border border-slate-300 hover:border-blue-400 hover:bg-brand-teal-tint'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-slate-900">{b.name}</span>
                  {/* Luôn có dòng địa chỉ (đúng mockup) — chi nhánh chưa nhập địa chỉ thì nhắc nhẹ thay vì để trống. */}
                  <span className={`mt-0.5 block truncate text-sm ${b.address ? 'text-slate-500' : 'text-slate-400'}`}>{b.address ?? 'Chưa cập nhật địa chỉ'}</span>
                </span>
                {selected && <span className="flex-shrink-0 rounded bg-brand-teal px-2 py-0.5 text-xs font-semibold text-white">Đang chọn</span>}
              </button>
            );
          })}
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
          Nhớ lựa chọn này cho lần sau
        </label>

        {error && (
          <p role="alert" className="mt-4 text-sm font-semibold text-rose-600">
            {error}
          </p>
        )}

        <Button type="submit" loading={submitting} disabled={selectedId === null} className="mt-4 w-full">
          Vào làm việc
        </Button>
      </form>
    </div>
  );
}
