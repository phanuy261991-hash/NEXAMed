import type { PrintDocumentType } from '@nexamed/shared';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { formatPrintDate } from '../../shared/format/print-date';
import { InvoiceCombinedPrintView } from '../billing/InvoiceCombinedPrintView';
import { InvoicePrintView } from '../billing/InvoicePrintView';
import { CashVoucherPrintView } from '../cash-book/CashVoucherPrintView';
import { CashierShiftReceiptDocument } from '../cashier-shift/CashierShiftReceiptView';
import { PrescriptionPrintView } from '../encounter/PrescriptionPrintView';
import { StockCountPrintView } from '../inventory/StockCountPrintView';
import { StockIssuePrintView } from '../inventory/StockIssuePrintView';
import { StockReceiptPrintView } from '../inventory/StockReceiptPrintView';
import { StockTransferPrintView } from '../inventory/StockTransferPrintView';
import { WalletReceiptPrintView } from '../patient-wallet/WalletReceiptPrintView';
import {
  SAMPLE_CASH_VOUCHER,
  SAMPLE_CASHIER_SHIFT,
  SAMPLE_COMBINED_INVOICES,
  SAMPLE_INVOICE,
  SAMPLE_PRESCRIPTION_ITEMS,
  SAMPLE_STOCK_COUNT,
  SAMPLE_STOCK_ISSUE,
  SAMPLE_STOCK_RECEIPT,
  SAMPLE_STOCK_TRANSFER,
  SAMPLE_UNIT_NAMES,
  SAMPLE_WALLET_RECEIPT,
} from './print-samples';

/**
 * Bản xem trước của MỘT loại chứng từ ở "Quản lý mẫu in" (docs/DECISIONS.md #211) — dựng bằng CHÍNH component in thật của
 * chứng từ đó với dữ liệu mẫu, nên bản xem trước luôn khớp bản in. Phải được bọc trong `PrintPreviewProvider` (bản mẫu
 * đang soạn + đầu trang) để `PrintDocument` lấy cấu hình nháp thay vì bản đã lưu.
 */
export function PrintDocumentPreview({ documentType }: { documentType: PrintDocumentType }) {
  switch (documentType) {
    case 'PRESCRIPTION':
      return (
        <PrescriptionPrintView
          doctorName="BS. Đặng Quốc Hưng"
          patientFullName="Lý Thị Hoài Thương"
          patientDob="14/03/1987"
          patientGender="Nữ"
          items={SAMPLE_PRESCRIPTION_ITEMS}
          signedAt="2026-10-01T07:30:00.000Z"
        />
      );
    case 'INVOICE':
      return <InvoicePrintView collectedByName="Nguyễn Thị Bích Ngọc" paymentMethodLabel="Tiền mặt" invoice={SAMPLE_INVOICE} />;
    case 'INVOICE_COMBINED':
      return (
        <InvoiceCombinedPrintView
          collectedByName="Nguyễn Thị Bích Ngọc"
          paymentMethodName={(code) => (code === 'CASH' ? 'Tiền mặt' : code)}
          data={SAMPLE_COMBINED_INVOICES}
        />
      );
    case 'WALLET_TOPUP_RECEIPT':
      return <WalletReceiptPrintView {...SAMPLE_WALLET_RECEIPT} />;
    case 'CASHIER_SHIFT_RECEIPT':
      return <CashierShiftReceiptDocument shift={SAMPLE_CASHIER_SHIFT} />;
    case 'CASH_VOUCHER':
      return (
        <CashVoucherPrintView voucher={SAMPLE_CASH_VOUCHER} incomeExpenseTypeLabel="Chi phí vận hành" cashAccountName="Quỹ tiền mặt" paymentMethodLabel="Tiền mặt" />
      );
    case 'STOCK_RECEIPT':
      return <StockReceiptPrintView receipt={SAMPLE_STOCK_RECEIPT} unitNameByCode={SAMPLE_UNIT_NAMES} />;
    case 'STOCK_ISSUE':
      return <StockIssuePrintView issue={SAMPLE_STOCK_ISSUE} />;
    case 'STOCK_COUNT':
      return <StockCountPrintView count={SAMPLE_STOCK_COUNT} />;
    case 'STOCK_TRANSFER':
      return <StockTransferPrintView transfer={SAMPLE_STOCK_TRANSFER} />;
    case 'MEDICAL_RECORD':
      return <MedicalRecordPreview />;
  }
}

/**
 * Bệnh án xuất PDF được dựng ở MÁY CHỦ (`renderPatientMedicalRecordHtml`, Chromium nội bộ) chứ không phải component React,
 * nên xem trước ở đây là bản MINH HOẠ cùng khung (đầu trang/tiêu đề/ghi chú/chữ ký) — phần thân là nội dung tiêu biểu.
 */
function MedicalRecordPreview() {
  return (
    <PrintDocument
      documentType="MEDICAL_RECORD"
      title="Bệnh án"
      subtitle={
        <p>
          Mã bệnh nhân: <strong>BN2609000471</strong>
        </p>
      }
      signatureDateText={formatPrintDate('2026-10-01T07:30:00.000Z')}
      signatures={[{ label: 'Bác sĩ điều trị', name: 'BS. Đặng Quốc Hưng' }]}
    >
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          Họ tên: <strong>Lý Thị Hoài Thương</strong>
        </p>
        <p>
          Ngày sinh: <strong>14/03/1987</strong> — Nữ
        </p>
        <p className="col-span-2">
          Địa chỉ: <strong>45/7 Trần Hưng Đạo, P. Cầu Ông Lãnh, TP. Hồ Chí Minh</strong>
        </p>
      </div>
      <div className="mt-5 border-t border-slate-300 pt-3">
        <p className="font-semibold">Lượt khám LK2610000471 — 01/10/2026</p>
        <p className="mt-1">
          Chẩn đoán: <strong>Viêm phế quản cấp (J20.9)</strong>
        </p>
        <p className="mt-1">Lý do khám: Ho khan, sốt nhẹ 2 ngày. Khám: phổi thô, không rales.</p>
        <p className="mt-1">Đơn thuốc: Amoxicillin + Acid clavulanic 625mg × 14 viên; Acetylcystein 200mg × 21 gói.</p>
      </div>
    </PrintDocument>
  );
}
