import { useEffect, useRef, useState } from 'react';
import { CaretDown, Check, MapPin, WarningCircle } from '@phosphor-icons/react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { Button } from '../ui/Button';
import { switchBranch } from '../../features/auth/auth.api';
import { useAuthStore } from '../../features/auth/auth.store';
import { findCurrentBranch, hasMultipleBranches } from '../../features/branch/branch-visibility';

/**
 * Bộ chuyển chi nhánh ở thanh đỉnh (docs/DECISIONS.md #231, mockup Màn 2b đã duyệt) — chỉ hiện khi tài khoản được gán từ 2 chi nhánh trở lên (công ty/tài khoản 1 chi nhánh: ẩn hẳn, giao diện không đổi).
 * Đổi chi nhánh = đổi phiên (access token mới) + tải lại dữ liệu theo nơi mới, về trang chủ. Đang ở màn khám (`/encounters/:id`) thì hỏi xác nhận trước vì hàng đợi và phiếu thu chuyển sang nơi khác.
 * Thanh đỉnh thật nền trắng (mockup vẽ nền tối) — nút/panel theo token app thật.
 */
export function BranchSwitcher() {
  const user = useAuthStore((s) => s.user);
  const setCurrentBranch = useAuthStore((s) => s.setCurrentBranch);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isOnEncounterPage = useMatch('/encounters/:id') !== null;

  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = findCurrentBranch(user);
  if (!user || !hasMultipleBranches(user) || !current) return null;

  async function doSwitch(branchId: string) {
    setSwitching(true);
    setError(null);
    try {
      const result = await switchBranch(branchId, true);
      setCurrentBranch(result.currentBranchId, result.accessToken);
      // Dữ liệu cache là của chi nhánh cũ → bỏ hết rồi tải lại theo chi nhánh mới; về trang chủ vì trang đang mở (vd chi tiết lượt khám) có thể không thuộc chi nhánh mới.
      await queryClient.resetQueries();
      setConfirmId(null);
      setOpen(false);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không đổi được chi nhánh, vui lòng thử lại.');
    } finally {
      setSwitching(false);
    }
  }

  function handlePick(branchId: string) {
    if (branchId === current!.id) {
      setOpen(false);
      return;
    }
    if (isOnEncounterPage) {
      setOpen(false);
      setError(null);
      setConfirmId(branchId);
      return;
    }
    void doSwitch(branchId);
  }

  const confirmTarget = user.branches.find((b) => b.id === confirmId) ?? null;

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Chuyển chi nhánh làm việc"
        className="flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 hover:border-blue-200 hover:bg-blue-50"
      >
        <MapPin size={16} weight="fill" className="flex-shrink-0 text-brand-teal" aria-hidden="true" />
        <span className="max-w-[220px] truncate">{current.name}</span>
        <CaretDown size={12} weight="bold" className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180 text-blue-600' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        // Panel cùng mép phải với nút, rộng tối thiểu bằng nút (không lệch ra trái) và co giãn theo tên chi nhánh dài nhất; mọi dòng cùng cỡ chữ/độ đậm/lề — chỉ dòng đang chọn có nền teal + dấu ✓.
        <div role="menu" className="absolute right-0 top-10 z-30 w-max min-w-full max-w-sm rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <div className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Chuyển chi nhánh</div>
          {error && (
            <p role="alert" className="px-3 py-1 text-xs font-semibold text-rose-600">
              {error}
            </p>
          )}
          {user.branches.map((b) => {
            const isCurrent = b.id === current.id;
            return (
              <button
                key={b.id}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                disabled={switching}
                onClick={() => handlePick(b.id)}
                className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm font-medium ${
                  isCurrent ? 'bg-brand-teal-tint text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="min-w-0 truncate">{b.name}</span>
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  {isCurrent && <Check size={16} weight="bold" className="text-brand-teal" aria-label="Đang làm việc ở chi nhánh này" />}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="branch-switch-confirm-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <WarningCircle size={20} weight="fill" className="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
              <div>
                <p id="branch-switch-confirm-title" className="text-sm font-bold text-slate-900">
                  Đổi sang &quot;{confirmTarget.name}&quot; khi đang ở màn khám?
                </p>
                <p className="mt-1 text-xs text-slate-700">Hàng đợi và phiếu thu sẽ chuyển sang nơi khác. Dữ liệu đã lưu vẫn giữ nguyên; thông tin đang nhập dở chưa lưu sẽ mất.</p>
              </div>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm font-semibold text-rose-600">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={switching} onClick={() => setConfirmId(null)}>
                Huỷ
              </Button>
              <Button type="button" variant="amberSolid" loading={switching} onClick={() => void doSwitch(confirmTarget.id)}>
                Vẫn chuyển
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
