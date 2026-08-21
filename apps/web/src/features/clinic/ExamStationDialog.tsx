import { useState } from 'react';
import { PencilSimple, Plus, X } from '@phosphor-icons/react';
import type { ExamStationSummary, RoomSummary } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useAuthStore } from '../auth/auth.store';
import { useCreateExamStationMutation, useExamStationsQuery, useUpdateExamStationMutation } from './clinic.queries';

/** Khớp `clinic_config.update` — .claude/docs/security-audit.md (chỉ clinic_admin ở v1). */
const MANAGE_ROLES = ['clinic_admin'];

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

/**
 * "Quản lý bàn khám / ghế" của một PHÒNG cụ thể (docs/DECISIONS.md #055) — mở từ badge số đếm ở
 * mỗi dòng trong `RoomPane.tsx`. Cùng khuôn `PatientMatchDialog.tsx` (overlay + card trắng), thân
 * dialog là danh sách nhỏ + form thêm/sửa tại chỗ (không mở thêm 1 modal lồng modal) vì số bàn
 * khám mỗi phòng luôn rất ít.
 */
export function ExamStationDialog({ room, onClose }: { room: RoomSummary; onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.roles.some((role) => MANAGE_ROLES.includes(role)) ?? false;

  const [editing, setEditing] = useState<ExamStationSummary | 'new' | null>(null);
  const query = useExamStationsQuery(room.id);
  const createMutation = useCreateExamStationMutation();
  const updateMutation = useUpdateExamStationMutation();

  const stations = query.data?.items ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby="exam-station-title">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="relative px-6 pb-5 pt-6">
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} weight="bold" />
          </button>

          <h2 id="exam-station-title" className="text-[16px] font-bold text-slate-900">
            Bàn khám / Ghế
          </h2>
          <p className="mt-1 text-[13px] text-slate-500">Phòng: {room.name}</p>

          {query.isError && <ErrorBanner message="Không tải được danh sách." onRetry={() => query.refetch()} />}

          {query.isLoading && (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}

          {query.isSuccess && (
            <ul className="mt-4 max-h-64 space-y-1.5 overflow-y-auto scroll-hover">
              {stations.length === 0 && editing !== 'new' && (
                <li className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
                  Chưa có bàn khám nào trong phòng này.
                </li>
              )}
              {stations.map((station) =>
                editing !== 'new' && editing?.id === station.id ? (
                  <ExamStationRow
                    key={station.id}
                    initialName={station.name}
                    initialActive={station.isActive}
                    showActiveToggle
                    submitting={updateMutation.isPending}
                    onCancel={() => setEditing(null)}
                    onSubmit={(dto) =>
                      updateMutation.mutate(
                        { id: station.id, body: { name: dto.name, isActive: dto.isActive, version: station.version } },
                        { onSuccess: () => setEditing(null) },
                      )
                    }
                  />
                ) : (
                  <li
                    key={station.id}
                    className={`flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 ${station.isActive ? '' : 'opacity-50'}`}
                  >
                    <span className="text-sm font-medium text-slate-900">{station.name}</span>
                    <div className="flex items-center gap-2">
                      {!station.isActive && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-500">Ngưng dùng</span>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() => setEditing(station)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <PencilSimple size={13} weight="regular" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                ),
              )}

              {editing === 'new' && (
                <ExamStationRow
                  initialName=""
                  submitting={createMutation.isPending}
                  onCancel={() => setEditing(null)}
                  onSubmit={(dto) => createMutation.mutate({ roomId: room.id, name: dto.name }, { onSuccess: () => setEditing(null) })}
                />
              )}
            </ul>
          )}

          {canManage && editing === null && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              <Plus size={13} weight="bold" aria-hidden="true" />
              Thêm bàn khám
            </button>
          )}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}

function ExamStationRow({
  initialName,
  initialActive,
  showActiveToggle,
  submitting,
  onCancel,
  onSubmit,
}: {
  initialName: string;
  initialActive?: boolean;
  showActiveToggle?: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: { name: string; isActive: boolean }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [isActive, setIsActive] = useState(initialActive ?? true);
  const isInvalid = name.trim() === '';

  // Bọc `<form>` để Enter trong ô nhập tự submit — bắt buộc cho mọi form Thêm/Sửa (`.claude/docs/
  // ui-guidelines.md` mục 4.4).
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    onSubmit({ name: name.trim(), isActive });
  }

  return (
    <li>
      <form className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50/40 px-2.5 py-2" onSubmit={handleSubmit}>
        <input
          autoFocus
          placeholder="Tên bàn khám/ghế"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${inputClassName} py-1.5 text-sm`}
        />
        {showActiveToggle && (
          <label className="flex flex-shrink-0 items-center gap-1 text-[11px] text-slate-500">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Hoạt động
          </label>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
        >
          Huỷ
        </button>
        <button
          type="submit"
          disabled={submitting || isInvalid}
          className="flex-shrink-0 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Lưu
        </button>
      </form>
    </li>
  );
}
