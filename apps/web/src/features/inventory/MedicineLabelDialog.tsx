import { Tag } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { MedicineLabelPrintPanel } from './MedicineLabelPrintPanel';

/**
 * Hộp "In nhãn thuốc" mở từ "Chi tiết phiếu xuất kho" để IN LẠI nhãn dán bì thuốc của một phiếu đã phát (docs/DECISIONS.md #267) — cùng khối `MedicineLabelPrintPanel`
 * với màn thành công của "Phát thuốc". Đặt lớp phủ cao hơn hộp chi tiết (z-[60]) vì mở chồng lên nó.
 */
export function MedicineLabelDialog({ issueId, issueNo, onClose }: { issueId: string; issueNo: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="In nhãn thuốc">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="px-5 pt-5">
          <ModalHeader icon={Tag} title="In nhãn thuốc" subtitle={`Phiếu ${issueNo}`} onClose={onClose} />
        </div>
        <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <MedicineLabelPrintPanel issueId={issueId} />
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}
