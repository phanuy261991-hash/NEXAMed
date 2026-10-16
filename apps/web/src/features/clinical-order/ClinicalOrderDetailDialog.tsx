import { useEffect, useState } from 'react';
import { ClipboardText } from '@phosphor-icons/react';
import type { ClinicalOrderItemView, ClinicalOrderListRow, TechnicalServiceKind } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { PrintButton } from '../../shared/print/PrintButton';
import { useAuthStore } from '../auth/auth.store';
import { findCurrentBranch, hasMultipleBranches } from '../branch/branch-visibility';
import { formatDateTimeVn } from '../../shared/format/time';
import type { ParaclinicalGroup } from '../paraclinical-result/paraclinical-group';
import { SERVICE_KIND_LABELS, genderShort } from '../paraclinical-result/paraclinical-result-labels';
import { ParaclinicalResultViewDialog } from '../paraclinical-result/ParaclinicalResultViewDialog';
import { useCanViewResultContent } from '../paraclinical-result/useCanViewResultContent';
import { ClinicalOrderPrintView } from './ClinicalOrderPrintView';
import { orderProgressBadge } from './clinical-order-book-labels';
import { printPatientInfo } from './clinical-order-print-info';
import { useClinicalOrderQuery, usePrintClinicalOrderMutation } from './clinical-order.queries';

const ITEM_STATUS_BADGE: Record<ClinicalOrderItemView['status'], { tone: StatusBadgeTone; label: string }> = {
  ORDERED: { tone: 'warning', label: 'Chờ thực hiện' },
  IN_PROGRESS: { tone: 'info', label: 'Đang thực hiện' },
  RESULTED: { tone: 'info', label: 'Chờ duyệt kết quả' },
  COMPLETED: { tone: 'success', label: 'Đã có kết quả' },
  CANCELLED: { tone: 'neutral', label: 'Đã huỷ' },
};

const INVOICE_STATUS_BADGE: Record<string, { tone: StatusBadgeTone; label: string }> = {
  PAID: { tone: 'success', label: 'Đã thu' },
  UNPAID: { tone: 'warning', label: 'Chưa thu' },
  REFUNDED: { tone: 'accent', label: 'Đã hoàn' },
  CANCELLED: { tone: 'neutral', label: 'Đã huỷ' },
};

const groupOfKind = (kind: TechnicalServiceKind | null): ParaclinicalGroup | null => (kind === 'LAB' ? 'lab' : kind === 'IMAGING' || kind === 'FUNCTIONAL' ? 'imaging' : null);

/**
 * Chi tiết MỘT phiếu chỉ định (nút "Xem" ở menu "Phiếu chỉ định", mockup 14b đã duyệt, docs/DECISIONS.md #232): thông tin bệnh nhân/bác sĩ, bảng dịch vụ (loại, nơi thực hiện, đơn giá, trạng thái),
 * hoá đơn + tổng tiền, nút In. Dữ liệu phiếu lấy lại từ `GET /encounters/:id/clinical-orders` (cùng nguồn màn khám); thông tin bệnh nhân lấy từ dòng danh sách. "Xem kết quả" chỉ hiện cho người
 * làm chuyên môn của nhóm (quyền Nhập/Duyệt) — lễ tân không mở được nội dung. Đóng bằng X, "Đóng" hoặc Esc.
 */
export function ClinicalOrderDetailDialog({ row, onClose }: { row: ClinicalOrderListRow; onClose: () => void }) {
  const query = useClinicalOrderQuery(row.encounterId);
  const printMutation = usePrintClinicalOrderMutation(row.encounterId);
  const [viewing, setViewing] = useState<{ group: ParaclinicalGroup; itemId: string } | null>(null);
  const canViewLab = useCanViewResultContent('lab');
  const canViewImaging = useCanViewResultContent('imaging');
  const user = useAuthStore((s) => s.user);
  const branchName = hasMultipleBranches(user) ? (findCurrentBranch(user)?.name ?? undefined) : undefined;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Hộp thoại xem kết quả lồng bên trong tự xử lý Esc của nó; ở đây chỉ đóng khi không có hộp thoại con.
      if (e.key === 'Escape' && viewing === null) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, viewing]);

  const order = query.data?.order ?? null;
  const info = printPatientInfo(row);

  async function handlePrint() {
    await printMutation.mutateAsync().catch(() => undefined);
    setTimeout(() => window.print(), 100);
  }

  const items = order?.items ?? [];
  const progressGroupBadge = orderProgressBadge(row.progress);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Chi tiết phiếu chỉ định">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg bg-white p-6 shadow-xl">
        <ModalHeader
          icon={ClipboardText}
          title={`Phiếu chỉ định ${row.orderNo}`}
          subtitle={branchName}
          onClose={onClose}
          right={<StatusBadge tone={progressGroupBadge.tone}>{progressGroupBadge.label}</StatusBadge>}
        />

        <div className="scroll-hover min-h-0 flex-1 overflow-y-auto">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 pb-4 sm:grid-cols-4">
            <div>
              <dt className="text-sm font-medium text-slate-500">Bệnh nhân</dt>
              <dd className="text-base font-semibold text-slate-900">{row.patientName}</dd>
              <dd className="text-xs font-medium text-slate-500">
                {row.patientCode} · {row.ageYears ?? '—'} tuổi · {genderShort(row.patientGender === 'male' || row.patientGender === 'female' || row.patientGender === 'other' ? row.patientGender : null)}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">Bác sĩ chỉ định</dt>
              <dd className="text-base font-semibold text-slate-900">{row.doctorName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">Chỉ định lúc</dt>
              <dd className="text-base font-semibold text-slate-900">{formatDateTimeVn(row.orderedAt)}</dd>
              {row.encounterNo && <dd className="text-xs font-medium text-slate-500">Lượt khám {row.encounterNo}</dd>}
            </div>
            {row.primaryDiagnosis && (
              <div>
                <dt className="text-sm font-medium text-slate-500">Chẩn đoán</dt>
                <dd className="text-base font-semibold text-slate-900">{row.primaryDiagnosis.code}</dd>
                <dd className="text-xs font-medium text-slate-500">{row.primaryDiagnosis.name}</dd>
              </div>
            )}
          </dl>

          {query.isLoading && <Skeleton className="h-48 w-full rounded-lg" />}
          {query.isError && <ErrorBanner message="Không tải được chi tiết phiếu." onRetry={() => void query.refetch()} />}
          {query.isSuccess && order === null && <ErrorBanner message="Lượt khám này hiện không còn phiếu chỉ định." />}

          {order && (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="scroll-hover overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 720 }}>
                  <thead>
                    <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                      <th className="px-3 py-2.5 text-left">Dịch vụ</th>
                      <th className="px-3 py-2.5 text-center">Loại</th>
                      <th className="px-3 py-2.5 text-center">Nơi thực hiện</th>
                      <th className="px-3 py-2.5 text-center">Đơn giá</th>
                      <th className="px-3 py-2.5 text-center">Trạng thái</th>
                      <th className="px-3 py-2.5 text-center">Kết quả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const external = item.performance === 'EXTERNAL';
                      const status = ITEM_STATUS_BADGE[item.status];
                      const resultGroup = item.status === 'COMPLETED' ? groupOfKind(item.serviceKind) : null;
                      const canView = resultGroup === 'lab' ? canViewLab : resultGroup === 'imaging' ? canViewImaging : false;
                      return (
                        <tr key={item.id} className="h-[60px] border-b border-slate-100 last:border-b-0">
                          <td className="px-3 py-2 text-left">
                            <div className="font-semibold text-slate-900">{item.name}</div>
                            {item.packageId && <div className="text-xs font-medium text-slate-500">Thuộc gói</div>}
                          </td>
                          <td className="px-3 py-2 text-center font-medium text-slate-700">{external ? 'Ra ngoài' : item.serviceKind ? SERVICE_KIND_LABELS[item.serviceKind] : '—'}</td>
                          <td className="px-3 py-2 text-center font-medium text-slate-700">{external ? 'Ngoài phòng khám' : (item.placeName ?? '—')}</td>
                          <td className="px-3 py-2 text-center font-semibold tabular-nums text-slate-900">
                            {item.lineTotal !== null ? formatVnd(item.lineTotal) : item.packageId ? <span className="font-medium text-slate-500">Trong gói</span> : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center">{external ? <StatusBadge tone="accent">Chỉ định ra ngoài</StatusBadge> : <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}</td>
                          <td className="px-3 py-2 text-center">
                            {resultGroup && canView ? (
                              <button type="button" onClick={() => setViewing({ group: resultGroup, itemId: item.id })} className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                                Xem kết quả
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {order.packages.map((pkg) => (
                      <tr key={pkg.id} className="h-[48px] border-b border-slate-100 bg-slate-50 last:border-b-0">
                        <td className="px-3 py-2 text-left font-semibold text-slate-900" colSpan={3}>
                          Gói: {pkg.name}
                        </td>
                        <td className="px-3 py-2 text-center font-semibold tabular-nums text-slate-900">{formatVnd(pkg.unitPrice)}</td>
                        <td colSpan={2} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium text-slate-600">Hoá đơn</span>
                  {order.invoices.length === 0 && <span className="font-medium text-slate-500">Chưa có hoá đơn</span>}
                  {order.invoices.map((inv) => {
                    const badge = INVOICE_STATUS_BADGE[inv.status] ?? { tone: 'neutral' as const, label: inv.status };
                    return (
                      <span key={inv.invoiceId} className="inline-flex items-center gap-2">
                        <span className="font-semibold text-slate-800">{inv.invoiceNo}</span>
                        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                      </span>
                    );
                  })}
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium text-slate-500">Tổng cộng</span> <span className="ml-2 text-2xl font-semibold tabular-nums text-slate-900">{formatVnd(order.inHouseTotal)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <PrintButton documentType="CLINICAL_ORDER" onPrint={() => void handlePrint()} loading={printMutation.isPending} disabled={!order}>
            In phiếu chỉ định
          </PrintButton>
          <Button type="button" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>

      {order && (
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
      )}
      {viewing && <ParaclinicalResultViewDialog group={viewing.group} itemId={viewing.itemId} onClose={() => setViewing(null)} />}
    </div>
  );
}
