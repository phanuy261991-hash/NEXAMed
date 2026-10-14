import { useEffect, useRef } from 'react';
import type { ClinicalOrderListRow } from '@nexamed/shared';
import { ClinicalOrderPrintView } from './ClinicalOrderPrintView';
import { printPatientInfo } from './clinical-order-print-info';
import { useClinicalOrderQuery, usePrintClinicalOrderMutation } from './clinical-order.queries';

/**
 * In nhanh một phiếu chỉ định ngay từ dòng danh sách (nút "In" ở menu "Phiếu chỉ định", docs/DECISIONS.md #232): tải phiếu, ghi audit "in", dựng bản in ẨN rồi gọi hộp thoại in của trình duyệt.
 * Chỉ mount khi người dùng bấm In (khổ giấy đã chọn trước qua `PrintButton`); gỡ ra khi in xong (`afterprint`) hoặc lỗi. Nhận dữ liệu bệnh nhân từ dòng danh sách nên không gọi thêm API bệnh nhân.
 */
export function ClinicalOrderQuickPrint({ row, onDone, onError }: { row: ClinicalOrderListRow; onDone: () => void; onError: (message: string) => void }) {
  const query = useClinicalOrderQuery(row.encounterId);
  const printMutation = usePrintClinicalOrderMutation(row.encounterId);
  const started = useRef(false);
  const order = query.data?.order ?? null;
  const failed = query.isError || (query.isSuccess && order === null);

  useEffect(() => {
    if (failed) onError('Không tải được phiếu chỉ định để in.');
  }, [failed, onError]);

  useEffect(() => {
    if (!order || started.current) return;
    started.current = true;
    // Ghi audit "in" rồi mới mở hộp thoại in; audit lỗi không chặn việc in.
    void printMutation
      .mutateAsync()
      .catch(() => undefined)
      .finally(() => setTimeout(() => window.print(), 150));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy đúng một lần khi phiếu vừa tải xong; `printMutation` không ổn định theo từng lần render.
  }, [order]);

  useEffect(() => {
    window.addEventListener('afterprint', onDone);
    return () => window.removeEventListener('afterprint', onDone);
  }, [onDone]);

  if (!order) return null;
  const info = printPatientInfo(row);
  return (
    <ClinicalOrderPrintView
      order={order}
      patientFullName={row.patientName}
      patientCode={row.patientCode}
      patientDob={info.dob}
      patientGender={info.gender}
      patientPhone={row.patientPhone ?? undefined}
      encounterNo={row.encounterNo ?? undefined}
      diagnosisLabel={info.diagnosisLabel}
      doctorName={row.doctorName ?? ''}
      printedAt={new Date().toISOString()}
    />
  );
}
