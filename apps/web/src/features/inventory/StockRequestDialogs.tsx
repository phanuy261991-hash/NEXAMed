import { useMemo, useState, type FormEvent } from 'react';
import { ChatText, ListPlus, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import type { StockRequestDetail, StockRequestPriority } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { DateInput } from '../../shared/ui/DateInput';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useDrugsQuery } from '../drug/drug.queries';
import { useAddStockRequestLinesMutation, useNoteStockRequestMutation, useWithdrawStockRequestLinesMutation } from './stock-request.queries';

const textareaClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

/** Nhắn bổ sung / đổi mức khẩn / đổi ngày cần (bên xin, #298) — sau khi kho cấp đã tiếp nhận thì kho cấp được báo "Có cập nhật mới". */
export function StockRequestNoteDialog({ request, mode, onClose }: { request: StockRequestDetail; mode: 'message' | 'priority'; onClose: () => void }) {
  const mutation = useNoteStockRequestMutation();
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<StockRequestPriority>(request.priority);
  const [neededBy, setNeededBy] = useState(request.neededBy ?? '');
  const [error, setError] = useState<string | null>(null);
  const afterAccept = request.status === 'ACCEPTED' || request.status === 'IN_PROGRESS';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const changedPriority = priority !== request.priority;
    const changedDate = (neededBy || null) !== request.neededBy;
    if (!message.trim() && !changedPriority && !changedDate) {
      setError('Hãy nhập tin nhắn hoặc thay đổi mức khẩn/ngày cần.');
      return;
    }
    try {
      await mutation.mutateAsync({
        id: request.id,
        body: {
          version: request.version,
          ...(message.trim() ? { message: message.trim() } : {}),
          ...(changedPriority ? { priority } : {}),
          ...(changedDate ? { neededBy: neededBy || null } : {}),
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lưu thất bại, vui lòng thử lại.');
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <ConfirmDialog
        icon={ChatText}
        title={mode === 'priority' ? 'Đổi mức khẩn' : 'Nhắn bổ sung'}
        rows={[{ label: 'Phiếu', value: request.requestNo }]}
        note={afterAccept ? 'Kho cấp sẽ thấy nhãn "Có cập nhật mới".' : undefined}
        error={error}
        onClose={onClose}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Lưu
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {mode === 'priority' && (
            <div>
              <p className="mb-1 text-sm font-semibold text-slate-800">Mức khẩn</p>
              <SegmentedToggle
                ariaLabel="Mức khẩn"
                value={priority}
                onChange={setPriority}
                items={[
                  { id: 'NORMAL', label: 'Thường' },
                  { id: 'URGENT', label: 'Khẩn' },
                ]}
              />
            </div>
          )}
          <div>
            <label htmlFor="request-note-date" className="mb-1 block text-sm font-semibold text-slate-800">
              Ngày cần hàng
            </label>
            <DateInput id="request-note-date" value={neededBy} onChange={setNeededBy} />
          </div>
          <div>
            <label htmlFor="request-note-message" className="mb-1 block text-sm font-semibold text-slate-800">
              Tin nhắn cho kho cấp
            </label>
            <textarea id="request-note-message" rows={3} autoFocus={mode === 'message'} value={message} onChange={(e) => setMessage(e.target.value)} className={textareaClass} />
          </div>
        </div>
      </ConfirmDialog>
    </form>
  );
}

interface AddLineDraft {
  drugId: string;
  drugCode: string;
  drugName: string;
  unitCode: string;
  requestedQty: string;
}

/** Thêm mặt hàng vào phiếu đã tiếp nhận mà chưa cấp (bên xin, #298, mockup màn 6b). Kho cấp được báo bằng nhãn "Có cập nhật mới" và dòng "Mới thêm". */
export function StockRequestAddLinesDialog({ request, onClose }: { request: StockRequestDetail; onClose: () => void }) {
  const mutation = useAddStockRequestLinesMutation();
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 300);
  const [drafts, setDrafts] = useState<AddLineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const search = useDrugsQuery({ q: debounced.trim() || undefined });
  const taken = useMemo(() => new Set([...request.lines.map((l) => l.drugId), ...drafts.map((d) => d.drugId)]), [request.lines, drafts]);
  const results = query.trim() === '' ? [] : (search.data?.items ?? []).filter((d) => !taken.has(d.id)).slice(0, 8);
  const afterAccept = request.status === 'ACCEPTED';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (drafts.length === 0) {
      setError('Chọn ít nhất 1 mặt hàng.');
      return;
    }
    if (drafts.some((d) => !d.requestedQty || Number(d.requestedQty) <= 0)) {
      setError('Mỗi mặt hàng phải có số xin lớn hơn 0.');
      return;
    }
    try {
      await mutation.mutateAsync({ id: request.id, body: { version: request.version, lines: drafts.map((d) => ({ drugId: d.drugId, requestedQty: Number(d.requestedQty) })) } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Thêm mặt hàng thất bại, vui lòng thử lại.');
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <ConfirmDialog
        icon={ListPlus}
        size="md"
        title="Thêm mặt hàng"
        rows={[{ label: 'Phiếu', value: request.requestNo }]}
        note={afterAccept ? 'Lưu xong, kho cấp sẽ thấy nhãn "Có cập nhật mới" và dòng "Mới thêm". Các dòng cũ không đổi.' : undefined}
        error={error}
        onClose={onClose}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {afterAccept ? 'Lưu và báo kho cấp' : 'Lưu'}
            </Button>
          </>
        }
      >
        <div className="relative">
          <label htmlFor="request-add-search" className="mb-1 block text-sm font-semibold text-slate-800">
            Mặt hàng cần thêm
          </label>
          <div className="relative">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-500" aria-hidden="true" />
            <input
              id="request-add-search"
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const first = results[0];
                  if (first) {
                    setDrafts((prev) => [...prev, { drugId: first.id, drugCode: first.code, drugName: first.name, unitCode: first.baseUnitCode ?? '', requestedQty: '' }]);
                    setQuery('');
                  }
                }
              }}
              placeholder="Gõ tên/mã mặt hàng — Enter để thêm"
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          {results.length > 0 && (
            <div className="scroll-hover absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {results.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setDrafts((prev) => [...prev, { drugId: d.id, drugCode: d.code, drugName: d.name, unitCode: d.baseUnitCode ?? '', requestedQty: '' }]);
                    setQuery('');
                  }}
                  className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-900">{d.name}</span> <span className="text-xs font-semibold text-slate-400">({d.code})</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {drafts.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
            {drafts.map((d) => (
              <li key={d.drugId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">
                  {d.drugName} <span className="text-xs font-medium text-slate-400">({d.drugCode})</span>
                </span>
                <input
                  type="number"
                  min={1}
                  value={d.requestedQty}
                  aria-label={`Số xin ${d.drugName}`}
                  onChange={(e) => setDrafts((prev) => prev.map((x) => (x.drugId === d.drugId ? { ...x, requestedQty: e.target.value } : x)))}
                  className="w-24 rounded-md border border-slate-300 px-1.5 py-1 text-center text-sm font-semibold text-slate-900 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="w-10 text-xs text-slate-500">{d.unitCode}</span>
                <button type="button" aria-label={`Bỏ ${d.drugName}`} onClick={() => setDrafts((prev) => prev.filter((x) => x.drugId !== d.drugId))} className="text-slate-400 hover:text-rose-600">
                  <Trash size={16} weight="bold" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </form>
  );
}

/** Rút các dòng chưa có hàng (lý do bắt buộc) — bên xin, #298. Phần đã cấp giữ nguyên. */
export function StockRequestWithdrawDialog({ request, lineIds, onClose }: { request: StockRequestDetail; lineIds: string[]; onClose: () => void }) {
  const mutation = useWithdrawStockRequestLinesMutation();
  const lines = request.lines.filter((l) => lineIds.includes(l.id));
  return (
    <ReasonConfirmDialog
      title="Rút dòng chưa có hàng"
      rows={[
        { label: 'Phiếu', value: request.requestNo },
        { label: 'Mặt hàng', value: lines.map((l) => l.drugName).join(', ') },
      ]}
      note="Phần đã cấp giữ nguyên. Kho cấp được báo."
      confirmLabel="Xác nhận rút"
      confirmVariant="danger"
      onConfirm={(reason) => mutation.mutateAsync({ id: request.id, body: { version: request.version, lineIds, reason } })}
      onDone={onClose}
      onClose={onClose}
    />
  );
}
