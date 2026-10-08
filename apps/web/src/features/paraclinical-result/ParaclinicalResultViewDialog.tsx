import { useEffect } from 'react';
import { ClipboardText } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Skeleton } from '../../shared/ui/Skeleton';
import type { ParaclinicalGroup } from './paraclinical-group';
import { useParaclinicalResultQuery } from './paraclinical-result.queries';
import { ParaclinicalResultPrintView } from './ParaclinicalResultPrintView';

/**
 * Hộp thoại CHỈ XEM kết quả cận lâm sàng (nút "Xem" ở khối "Kết quả đã có của lượt khám này", màn khám — docs/DECISIONS.md #215). Dùng lại đúng bản phiếu kết quả
 * (`ParaclinicalResultPrintView display="screen"`, theo bản mẫu in của phòng khám) nên bác sĩ thấy y như phiếu trả cho bệnh nhân, kể cả chỉ số vượt mức in đậm + gạch chân.
 * Không có nút in/sửa — nhập, duyệt, đính chính, in vẫn ở menu Cận lâm sàng. Đóng bằng nút X, nút "Đóng" hoặc phím Esc.
 */
export function ParaclinicalResultViewDialog({ group, itemId, onClose }: { group: ParaclinicalGroup; itemId: string; onClose: () => void }) {
  const query = useParaclinicalResultQuery(group, itemId);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Xem kết quả cận lâm sàng">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader icon={ClipboardText} title="Kết quả cận lâm sàng" subtitle={query.data ? `Số: ${query.data.form.orderNo}` : undefined} onClose={onClose} />
        <div className="scroll-hover min-h-0 flex-1 overflow-y-auto overflow-x-auto rounded-lg bg-slate-100 py-5">
          {query.isLoading && <Skeleton className="mx-auto h-80 w-3/4" />}
          {query.isError && (
            <div className="px-5">
              <ErrorBanner message="Không tải được kết quả." onRetry={() => void query.refetch()} />
            </div>
          )}
          {query.data && (
            <div className="flex justify-center">
              <div className="print-preview-shrink">
                <ParaclinicalResultPrintView form={query.data.form} display="screen" />
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}
