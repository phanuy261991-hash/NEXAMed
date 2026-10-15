import { useEffect, useRef } from 'react';
import type { ParaclinicalGroup } from './paraclinical-group';
import { useParaclinicalResultQuery, usePrintParaclinicalResultMutation } from './paraclinical-result.queries';
import { ParaclinicalResultPrintView } from './ParaclinicalResultPrintView';

/**
 * In nhanh một kết quả ĐÃ DUYỆT ngay từ dòng "Tra cứu kết quả" (docs/DECISIONS.md #232): tải phiếu kết quả (có ghi audit "xem" như mọi lần mở kết quả), ghi audit "in", dựng bản in ẨN theo bản mẫu
 * của phòng khám rồi gọi hộp thoại in. Chỉ mount khi người dùng bấm In; gỡ khi in xong (`afterprint`) hoặc lỗi. Lễ tân không mở được nội dung trên màn hình nhưng được in (chủ dự án chốt).
 */
export function ParaclinicalResultQuickPrint({
  group,
  itemId,
  patientId,
  onDone,
  onError,
}: {
  group: ParaclinicalGroup;
  itemId: string;
  /** Có khi in từ tab "Kết quả cận lâm sàng" ở hồ sơ bệnh nhân — đọc kết quả ở mọi chi nhánh (#234). */
  patientId?: string;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const query = useParaclinicalResultQuery(group, itemId, patientId);
  const printMutation = usePrintParaclinicalResultMutation(group, itemId, patientId);
  const started = useRef(false);
  const form = query.data?.form ?? null;

  useEffect(() => {
    if (query.isError) onError('Không tải được kết quả để in.');
  }, [query.isError, onError]);

  useEffect(() => {
    if (!form || started.current) return;
    started.current = true;
    void printMutation
      .mutateAsync()
      .catch(() => undefined)
      .finally(() => setTimeout(() => window.print(), 150));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy đúng một lần khi kết quả vừa tải xong; `printMutation` không ổn định theo từng lần render.
  }, [form]);

  useEffect(() => {
    window.addEventListener('afterprint', onDone);
    return () => window.removeEventListener('afterprint', onDone);
  }, [onDone]);

  if (!form) return null;
  return <ParaclinicalResultPrintView form={form} />;
}
