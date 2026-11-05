import type { ReactNode } from 'react';
import type { DailyBranchReportDto, DailyReport } from '@nexamed/shared';
import { formatVndPlain } from '../../shared/format/currency';
import { formatPrintDateTime } from '../../shared/format/print-date';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { branchShiftDiscrepancy, formatReportDate, formatShiftClock, formatSignedVnd, REVENUE_GROUP_LABEL, REVENUE_GROUP_ORDER, SHIFT_STATUS_LABEL, weekdayLabel } from './daily-report-model';

type Totals = DailyReport['totals'];
type BlockData = Pick<DailyBranchReportDto, 'visits' | 'collection' | 'recognized' | 'unpaid' | 'counterVouchers'>;

const NUM = 'text-right tabular-nums';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3 break-inside-avoid">
      <h2 className="mb-0.5 border-b-[1.5px] border-slate-900 pb-0.5 text-[13px] font-bold uppercase tracking-wide text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Row({ cols, children, strong = false, shaded = false, head = false }: { cols: string; children: ReactNode; strong?: boolean; shaded?: boolean; head?: boolean }) {
  return (
    <div
      className={`grid items-center gap-x-3 border-b border-slate-200 py-[2px] text-[13px] ${head ? 'text-[11.5px] font-bold uppercase tracking-wide text-slate-700' : ''} ${strong ? 'font-bold' : ''} ${shaded ? 'bg-slate-50' : ''}`}
      style={{ gridTemplateColumns: cols }}
    >
      {children}
    </div>
  );
}

function SignedAmount({ amount }: { amount: number }) {
  return <span className={amount < 0 ? 'font-bold text-rose-700' : ''}>{formatSignedVnd(amount)}</span>;
}

/** Các khối số liệu dùng chung cho trang tổng và trang chi nhánh: lượt khám, tiền thu theo phương thức, ghi nhận theo nhóm. */
function Blocks({ data, showUnpaidPerBranch = false }: { data: BlockData; showUnpaidPerBranch?: boolean }) {
  const { visits, collection, recognized, unpaid } = data;
  const payCols = 'minmax(0,1fr) 90px 150px';
  return (
    <>
      <Section title="Lượt khám">
        <div className="grid grid-cols-4 gap-3 pt-1 text-[13px]">
          <Stat label="Tiếp nhận" value={visits.received} />
          <Stat label="Khám mới" value={visits.newCount} />
          <Stat label="Tái khám" value={visits.returnCount} />
          <Stat label="Hoàn tất" value={visits.completed} />
        </div>
        <p className="mt-1.5 text-[12.5px] text-slate-700">
          Đang chờ hoặc đang khám cuối ngày: {visits.stillOpen} · Huỷ: {visits.cancelled} · Không đến: {visits.noShow}
        </p>
      </Section>

      <Section title="Tiền thu theo phương thức">
        <Row cols={payCols} head>
          <div>Phương thức</div>
          <div className={NUM}>Lượt thu</div>
          <div className={NUM}>Số tiền</div>
        </Row>
        {collection.byMethod.length === 0 && <p className="py-1.5 text-[13px] text-slate-600">Không có khoản thu nào trong ngày.</p>}
        {collection.byMethod.map((m) => (
          <Row key={m.methodCode} cols={payCols}>
            <div>{m.methodName}</div>
            <div className={NUM}>{m.paymentCount}</div>
            <div className={NUM}>{formatVndPlain(m.amount)}</div>
          </Row>
        ))}
        <Row cols={payCols} strong>
          <div>Tổng thu</div>
          <div className={NUM}>{collection.collectedCount}</div>
          <div className={NUM}>{formatVndPlain(collection.collectedAmount)}</div>
        </Row>
        <Row cols={payCols}>
          <div>Hoàn tiền</div>
          <div className={NUM}>{collection.refundedCount}</div>
          <div className={NUM}>{collection.refundedAmount > 0 ? `−${formatVndPlain(collection.refundedAmount)}` : '0'}</div>
        </Row>
        <Row cols={payCols} strong shaded>
          <div>Thực thu</div>
          <div />
          <div className={NUM}>{formatVndPlain(collection.netAmount)}</div>
        </Row>
      </Section>

      <Section title="Ghi nhận theo nhóm">
        <Row cols="minmax(0,1fr) 150px" head>
          <div>Nhóm</div>
          <div className={NUM}>Số tiền</div>
        </Row>
        {REVENUE_GROUP_ORDER.map((g) => (
          <Row key={g} cols="minmax(0,1fr) 150px">
            <div>{REVENUE_GROUP_LABEL[g]}</div>
            <div className={NUM}>{formatVndPlain(recognized.byGroup[g])}</div>
          </Row>
        ))}
        <Row cols="minmax(0,1fr) 150px" strong shaded>
          <div>Tổng ghi nhận</div>
          <div className={NUM}>{formatVndPlain(recognized.total)}</div>
        </Row>
        {!showUnpaidPerBranch && (
          <Row cols="minmax(0,1fr) 150px">
            <div>Phiếu chưa thu cuối ngày ({unpaid.invoiceCount} phiếu)</div>
            <div className={`${NUM} font-bold`}>{formatVndPlain(unpaid.amount)}</div>
          </Row>
        )}
      </Section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-slate-600">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Subtitle({ date, generatedAt, exportedBy }: { date: string; generatedAt: string; exportedBy: string }) {
  return (
    <p className="mt-1 text-xs text-slate-600">
      {weekdayLabel(date)} · xuất lúc {formatPrintDateTime(generatedAt)}
      {exportedBy ? ` bởi ${exportedBy}` : ''}
    </p>
  );
}

/** Trang TỔNG của tờ in nhiều chi nhánh: bảng một dòng mỗi chi nhánh + dòng cộng, rồi các khối cộng. */
function TotalsSheet({ report, exportedBy, pageText }: { report: DailyReport; exportedBy: string; pageText: string }) {
  const cols = 'minmax(0,1fr) 64px 44px 44px 94px 94px 84px 64px';
  const t: Totals = report.totals;
  return (
    <PrintDocument
      documentType="REPORT"
      title={`Báo cáo ngày ${formatReportDate(report.date)}`}
      fixedTitle
      subtitle={
        <>
          <p className="text-xs text-slate-700">Tổng hợp {report.branches.length} chi nhánh: {report.branches.map((b) => b.branchName).join(', ')}</p>
          <Subtitle date={report.date} generatedAt={report.generatedAt} exportedBy={exportedBy} />
        </>
      }
      signatures={[{ label: 'Quản lý' }, { label: 'Chủ phòng khám' }]}
      display="screen"
    >
      <Section title="Theo chi nhánh">
        <Row cols={cols} head>
          <div>Chi nhánh</div>
          <div className={NUM}>Tiếp nhận</div>
          <div className={NUM}>Mới</div>
          <div className={NUM}>Tái</div>
          <div className={NUM}>Ghi nhận</div>
          <div className={NUM}>Thực thu</div>
          <div className={NUM}>Chưa thu</div>
          <div className={NUM}>Lệch két</div>
        </Row>
        {report.branches.map((b) => (
          <Row key={b.branchId} cols={cols}>
            <div className="font-semibold">{b.branchName}</div>
            <div className={NUM}>{b.visits.received}</div>
            <div className={NUM}>{b.visits.newCount}</div>
            <div className={NUM}>{b.visits.returnCount}</div>
            <div className={NUM}>{formatVndPlain(b.recognized.total)}</div>
            <div className={`${NUM} font-semibold`}>{formatVndPlain(b.collection.netAmount)}</div>
            <div className={NUM}>{formatVndPlain(b.unpaid.amount)}</div>
            <div className={NUM}>
              <SignedAmount amount={branchShiftDiscrepancy(b)} />
            </div>
          </Row>
        ))}
        <Row cols={cols} strong shaded>
          <div>Cộng {report.branches.length} chi nhánh</div>
          <div className={NUM}>{t.visits.received}</div>
          <div className={NUM}>{t.visits.newCount}</div>
          <div className={NUM}>{t.visits.returnCount}</div>
          <div className={NUM}>{formatVndPlain(t.recognized.total)}</div>
          <div className={NUM}>{formatVndPlain(t.collection.netAmount)}</div>
          <div className={NUM}>{formatVndPlain(t.unpaid.amount)}</div>
          <div className={NUM}>
            <SignedAmount amount={t.shiftDiscrepancy} />
          </div>
        </Row>
        <p className="mt-1.5 text-[12.5px] text-slate-700">
          Phiếu chưa thu cuối ngày: {t.unpaid.invoiceCount} phiếu ({report.branches.map((b) => `${b.branchName}: ${b.unpaid.invoiceCount}`).join(', ')}).
        </p>
      </Section>
      <Blocks data={t} showUnpaidPerBranch />
      <p className="mt-3 text-right text-[11.5px] text-slate-500">{pageText}</p>
    </PrintDocument>
  );
}

/** Trang của MỘT chi nhánh: các khối số liệu + bảng ca thu ngân + thu chi tại quầy. Công ty một chi nhánh: đây là cả tờ in. */
function BranchSheet({ report, branch, exportedBy, pageText, multiBranch }: { report: DailyReport; branch: DailyBranchReportDto; exportedBy: string; pageText: string | null; multiBranch: boolean }) {
  const shiftCols = '110px minmax(0,1fr) 92px 100px 100px 72px';
  return (
    <PrintDocument
      documentType="REPORT"
      title={`Báo cáo ngày ${formatReportDate(report.date)}`}
      fixedTitle
      subtitle={<Subtitle date={report.date} generatedAt={report.generatedAt} exportedBy={exportedBy} />}
      signatures={[{ label: 'Thu ngân' }, { label: multiBranch ? 'Quản lý chi nhánh' : 'Quản lý' }]}
      branchId={multiBranch ? branch.branchId : undefined}
      display="screen"
    >
      <Blocks data={branch} />

      <Section title="Các ca thu ngân">
        <Row cols={shiftCols} head>
          <div>Ca</div>
          <div>Thu ngân</div>
          <div>Giờ</div>
          <div className={NUM}>Dự kiến</div>
          <div className={NUM}>Kiểm đếm</div>
          <div className={NUM}>Lệch</div>
        </Row>
        {branch.shifts.length === 0 && <p className="py-1.5 text-[13px] text-slate-600">Không có ca nào mở trong ngày.</p>}
        {branch.shifts.map((s) => (
          <Row key={s.shiftNo} cols={shiftCols}>
            <div>
              {s.label}
              <span className="block text-[11px] text-slate-500">{s.shiftNo}</span>
            </div>
            <div>{s.cashierName}</div>
            <div>
              {formatShiftClock(s.openedAt)}–{s.closedAt ? formatShiftClock(s.closedAt) : '…'}
              <span className="block text-[11px] text-slate-500">{SHIFT_STATUS_LABEL[s.status]}</span>
            </div>
            <div className={NUM}>{s.expectedCash === null ? '—' : formatVndPlain(s.expectedCash)}</div>
            <div className={NUM}>{s.countedCash === null ? '—' : formatVndPlain(s.countedCash)}</div>
            <div className={NUM}>{s.discrepancy === null ? '—' : <SignedAmount amount={s.discrepancy} />}</div>
          </Row>
        ))}
        <p className="mt-1.5 text-[12.5px] text-slate-700">
          Thu chi tại quầy (ngoài dịch vụ khám): thu {formatVndPlain(branch.counterVouchers.incomeAmount)} · chi {formatVndPlain(branch.counterVouchers.expenseAmount)}.
        </p>
      </Section>
      {pageText && <p className="mt-3 text-right text-[11.5px] text-slate-500">{pageText}</p>}
    </PrintDocument>
  );
}

/**
 * Tờ in "Báo cáo ngày" (docs/DECISIONS.md #287): phạm vi một chi nhánh → một trang; từ hai chi nhánh → TRANG TỔNG rồi MỖI CHI NHÁNH MỘT TRANG, ngắt trang khi in (`.print-stack`).
 * Hiện sẵn trên màn hình để xem trước; nút "In" của trang gọi `window.print()` và CSS chung chỉ in các tờ này. Khung/đầu trang/chữ ký lấy từ bản mẫu `REPORT` ở Quản lý mẫu in.
 */
export function DailyReportPrintView({ report, exportedBy = '' }: { report: DailyReport; exportedBy?: string }) {
  const multiBranch = report.branches.length > 1;
  const totalPages = multiBranch ? report.branches.length + 1 : 1;
  const pageText = (index: number) => (multiBranch ? `Trang ${index}/${totalPages}` : null);
  return (
    <div className="print-stack flex flex-col items-center gap-6 print:block">
      {multiBranch && <TotalsSheet report={report} exportedBy={exportedBy} pageText={`Trang 1/${totalPages}`} />}
      {report.branches.map((b, i) => (
        <BranchSheet key={b.branchId} report={report} branch={b} exportedBy={exportedBy} pageText={pageText(i + 2)} multiBranch={multiBranch} />
      ))}
    </div>
  );
}
