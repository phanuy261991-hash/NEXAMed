import { useMemo, useState } from 'react';
import { ChairIcon, MagnifyingGlass, PencilSimple, Plus } from '@phosphor-icons/react';
import type { FloorSummary, RoomSummary } from '@nexamed/shared';
import { useAuthStore } from '../auth/auth.store';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ExamStationDialog } from './ExamStationDialog';
import {
  useCreateFloorMutation,
  useCreateRoomMutation,
  useFloorsQuery,
  useRoomsQuery,
  useUpdateFloorMutation,
  useUpdateRoomMutation,
} from './clinic.queries';

/** Khớp `clinic_config.update` — .claude/docs/security-audit.md (chỉ clinic_admin ở v1). */
const MANAGE_ROLES = ['clinic_admin'];

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const NO_FLOOR_VALUE = '';

/**
 * Pane "Phòng khám" (Quản trị, docs/DECISIONS.md #054/#055) — bố cục master-detail (cột "Tầng"
 * lọc cột "Phòng", theo mẫu tham khảo chủ dự án gửi) TÍCH HỢP CHUNG một màn hình, không tách
 * pill/mục riêng cho từng cấp — đúng yêu cầu "tích hợp giao diện UI tầng/phòng/bàn vào chung giao
 * diện quản trị phòng khám hiện có". Adapt CẤU TRÚC 2 cột của ảnh tham khảo (không copy màu/font
 * của app khác — vẫn theo `.claude/docs/ui-guidelines.md`/token sẵn có của dự án).
 *
 * "Tầng" TÙY CHỌN (docs/DECISIONS.md #055) — 0 tầng thì cột trái tự ẩn hoàn toàn, "Phòng" hiện
 * flat list y hệt bản trước #055 (không thêm thao tác nào cho phòng khám nhỏ). "Bàn khám/Ghế" —
 * cấp con BẮT BUỘC của 1 phòng, quản lý qua `ExamStationDialog.tsx` mở từ badge trên mỗi dòng
 * Phòng (không phải cột riêng — 3 cột song song sẽ chật, đúng cấu trúc 2 cột của ảnh tham khảo).
 */
export function RoomPane() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.roles.some((role) => MANAGE_ROLES.includes(role)) ?? false;

  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [floorSearch, setFloorSearch] = useState('');
  const [floorModal, setFloorModal] = useState<{ mode: 'create' | 'edit'; floor?: FloorSummary } | null>(null);
  const [roomModal, setRoomModal] = useState<{ mode: 'create' | 'edit'; room?: RoomSummary } | null>(null);
  const [stationsRoom, setStationsRoom] = useState<RoomSummary | null>(null);

  const floorsQuery = useFloorsQuery();
  const roomsQuery = useRoomsQuery();
  const createFloorMutation = useCreateFloorMutation();
  const updateFloorMutation = useUpdateFloorMutation();
  const createRoomMutation = useCreateRoomMutation();
  const updateRoomMutation = useUpdateRoomMutation();

  const floors = floorsQuery.data?.items ?? [];
  const hasFloors = floors.length > 0;

  const visibleFloors = useMemo(() => {
    const q = floorSearch.trim().toLowerCase();
    if (q === '') return floors;
    return floors.filter((f) => f.name.toLowerCase().includes(q));
  }, [floors, floorSearch]);

  const rooms = useMemo(() => {
    const all = roomsQuery.data?.items ?? [];
    if (!hasFloors || selectedFloorId === null) return all;
    return all.filter((r) => r.floorId === selectedFloorId);
  }, [roomsQuery.data, hasFloors, selectedFloorId]);

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-xs text-slate-500">
        Từ 2 phòng đang hoạt động trở lên, bác sĩ sẽ được hỏi chọn phòng làm việc lúc đăng nhập mỗi ngày. Tầng/Bàn khám chỉ
        để tổ chức không gian, không ảnh hưởng luồng khám.
      </p>

      {roomsQuery.isError && <ErrorBanner message="Không tải được danh sách phòng." onRetry={() => roomsQuery.refetch()} />}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Thẻ "Tầng" LUÔN hiện (kể cả 0 tầng) — đây là lối vào duy nhất để tạo tầng đầu tiên,
            không giấu sau bất kỳ thao tác nào khác. Chỉ phần danh sách bên trong mới tuỳ theo
            hasFloors (0 tầng → dòng gợi ý thay vì "Tất cả"/danh sách). */}
        <div className="flex w-56 flex-shrink-0 flex-col rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tầng</span>
            {canManage && (
              <button
                type="button"
                title="Thêm tầng"
                onClick={() => setFloorModal({ mode: 'create' })}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus size={14} weight="bold" aria-hidden="true" />
              </button>
            )}
          </div>
          {hasFloors ? (
            <>
              <div className="relative border-b border-slate-100 px-2.5 py-2">
                <MagnifyingGlass
                  size={13}
                  weight="regular"
                  className="pointer-events-none absolute left-4.5 top-1/2 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={floorSearch}
                  onChange={(e) => setFloorSearch(e.target.value)}
                  placeholder="Tìm tầng..."
                  className="w-full rounded-md border border-slate-200 py-1.5 pl-7 pr-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <ul className="flex-1 overflow-y-auto scroll-hover py-1">
                <li>
                  <button
                    type="button"
                    onClick={() => setSelectedFloorId(null)}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm font-medium ${
                      selectedFloorId === null ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Tất cả
                  </button>
                </li>
                {visibleFloors.length === 0 && <li className="px-3 py-3 text-xs text-slate-400">Không tìm thấy tầng nào.</li>}
                {visibleFloors.map((floor) => {
                  const selected = selectedFloorId === floor.id;
                  return (
                    <li key={floor.id} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => setSelectedFloorId(floor.id)}
                        className={`flex-1 truncate px-3 py-2 text-left text-sm font-medium ${
                          selected ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                        } ${floor.isActive ? '' : 'opacity-50'}`}
                      >
                        {floor.name}
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() => setFloorModal({ mode: 'edit', floor })}
                          className="mr-1.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-600 group-hover:text-slate-400"
                        >
                          <PencilSimple size={13} weight="regular" aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="px-3 py-3 text-xs text-slate-400">Chưa có tầng nào. Bấm + để thêm.</p>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Phòng</span>
            {canManage && (
              <Button type="button" onClick={() => setRoomModal({ mode: 'create' })}>
                <Plus size={16} weight="bold" aria-hidden="true" />
                Thêm phòng
              </Button>
            )}
          </div>

          {roomsQuery.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          )}

          {roomsQuery.isSuccess && rooms.length === 0 && (
            <EmptyState
              icon={ChairIcon}
              title="Chưa có phòng khám nào"
              description="Phòng khám 1-3 bác sĩ không bắt buộc tạo phòng. Chỉ thêm khi cần điều phối nhiều bác sĩ vào nhiều phòng vật lý."
            />
          )}

          {roomsQuery.isSuccess && rooms.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                    <th className="px-4 py-2.5 text-left">Tên phòng</th>
                    {hasFloors && <th className="w-36 px-4 py-2.5 text-center">Tầng</th>}
                    <th className="w-32 px-4 py-2.5 text-center">Bàn khám</th>
                    <th className="w-36 px-4 py-2.5 text-center">Trạng thái</th>
                    {canManage && <th className="w-20 px-4 py-2.5 text-center">Sửa</th>}
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => (
                    <tr key={room.id} className={`border-b border-slate-200 last:border-0 ${room.isActive ? '' : 'opacity-50'}`}>
                      <td className="px-4 py-2 text-left font-medium text-slate-900">{room.name}</td>
                      {hasFloors && <td className="px-4 py-2 text-center text-slate-600">{room.floorName ?? '—'}</td>}
                      <td className="px-4 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => setStationsRoom(room)}
                          className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600"
                        >
                          {room.examStationCount}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            room.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {room.isActive ? 'Đang hoạt động' : 'Ngưng dùng'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-2 text-center">
                          <button
                            type="button"
                            title="Sửa"
                            onClick={() => setRoomModal({ mode: 'edit', room })}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <PencilSimple size={15} weight="regular" aria-hidden="true" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {floorModal && (
        <FloorFormModal
          mode={floorModal.mode}
          floor={floorModal.floor}
          submitting={createFloorMutation.isPending || updateFloorMutation.isPending}
          onCancel={() => setFloorModal(null)}
          onSubmit={(dto) => {
            const onSettled = () => setFloorModal(null);
            if (floorModal.mode === 'create') {
              createFloorMutation.mutate({ name: dto.name }, { onSuccess: onSettled });
            } else if (floorModal.floor) {
              updateFloorMutation.mutate(
                { id: floorModal.floor.id, body: { name: dto.name, isActive: dto.isActive, version: floorModal.floor.version } },
                { onSuccess: onSettled },
              );
            }
          }}
        />
      )}

      {roomModal && (
        <RoomFormModal
          mode={roomModal.mode}
          room={roomModal.room}
          floors={floors}
          submitting={createRoomMutation.isPending || updateRoomMutation.isPending}
          onCancel={() => setRoomModal(null)}
          onSubmit={(dto) => {
            const onSettled = () => setRoomModal(null);
            if (roomModal.mode === 'create') {
              createRoomMutation.mutate({ name: dto.name, floorId: dto.floorId }, { onSuccess: onSettled });
            } else if (roomModal.room) {
              updateRoomMutation.mutate(
                { id: roomModal.room.id, body: { name: dto.name, floorId: dto.floorId, isActive: dto.isActive, version: roomModal.room.version } },
                { onSuccess: onSettled },
              );
            }
          }}
        />
      )}

      {stationsRoom && <ExamStationDialog room={stationsRoom} onClose={() => setStationsRoom(null)} />}
    </div>
  );
}

function FloorFormModal({
  mode,
  floor,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  floor?: FloorSummary;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: { name: string; isActive: boolean }) => void;
}) {
  const [name, setName] = useState(floor?.name ?? '');
  const [isActive, setIsActive] = useState(floor?.isActive ?? true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-[15px] font-semibold text-slate-900">{mode === 'create' ? 'Thêm tầng' : 'Sửa tầng'}</h2>

        <div className="mb-3.5 mt-4 flex flex-col gap-1.5">
          <label htmlFor="floor-name" className="text-sm font-semibold text-slate-800">
            Tên tầng
          </label>
          <input id="floor-name" placeholder="Ví dụ: Tầng 1" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
        </div>

        {mode === 'edit' && (
          <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Đang hoạt động
          </label>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="button" loading={submitting} disabled={name.trim() === ''} onClick={() => onSubmit({ name: name.trim(), isActive })}>
            Lưu
          </Button>
        </div>
      </div>
    </div>
  );
}

function RoomFormModal({
  mode,
  room,
  floors,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  room?: RoomSummary;
  floors: FloorSummary[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: { name: string; floorId: string | null; isActive: boolean }) => void;
}) {
  const [name, setName] = useState(room?.name ?? '');
  const [floorId, setFloorId] = useState(room?.floorId ?? NO_FLOOR_VALUE);
  const [isActive, setIsActive] = useState(room?.isActive ?? true);

  const floorOptions = [{ value: NO_FLOOR_VALUE, label: 'Không thuộc tầng nào' }, ...floors.map((f) => ({ value: f.id, label: f.name }))];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-[15px] font-semibold text-slate-900">{mode === 'create' ? 'Thêm phòng khám' : 'Sửa phòng khám'}</h2>

        <div className="mb-3.5 mt-4 flex flex-col gap-1.5">
          <label htmlFor="room-name" className="text-sm font-semibold text-slate-800">
            Tên phòng
          </label>
          <input
            id="room-name"
            placeholder="Ví dụ: Phòng Nội 1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClassName}
          />
        </div>

        {floors.length > 0 && (
          <div className="mb-3.5 flex flex-col gap-1.5">
            <label htmlFor="room-floor" className="text-sm font-semibold text-slate-800">
              Tầng
            </label>
            <Combobox id="room-floor" value={floorId} onChange={setFloorId} options={floorOptions} />
          </div>
        )}

        {mode === 'edit' && (
          <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Đang hoạt động
          </label>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button
            type="button"
            loading={submitting}
            disabled={name.trim() === ''}
            onClick={() => onSubmit({ name: name.trim(), floorId: floorId === NO_FLOOR_VALUE ? null : floorId, isActive })}
          >
            Lưu
          </Button>
        </div>
      </div>
    </div>
  );
}
