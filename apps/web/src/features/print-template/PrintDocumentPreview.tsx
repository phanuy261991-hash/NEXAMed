import { useState } from 'react';
import type { PrintDocumentType } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { formatPrintDate } from '../../shared/format/print-date';
import { InvoiceCombinedPrintView } from '../billing/InvoiceCombinedPrintView';
import { InvoicePrintView } from '../billing/InvoicePrintView';
import { SAMPLE_INSURANCE, formatInsurancePrintValue } from '../insurance-card/insurance-print';
import { CashVoucherPrintView } from '../cash-book/CashVoucherPrintView';
import { CashierShiftReceiptDocument } from '../cashier-shift/CashierShiftReceiptView';
import { ClinicalOrderPrintView } from '../clinical-order/ClinicalOrderPrintView';
import { ParaclinicalResultPrintView } from '../paraclinical-result/ParaclinicalResultPrintView';
import { SpecimenLabelSheet } from '../paraclinical-result/SpecimenLabelSheet';
import { MedicineLabelSheet } from '../inventory/MedicineLabelSheet';
import { PrescriptionPrintView } from '../encounter/PrescriptionPrintView';
import { StockCountPrintView } from '../inventory/StockCountPrintView';
import { StockIssuePrintView } from '../inventory/StockIssuePrintView';
import { StockReceiptPrintView } from '../inventory/StockReceiptPrintView';
import { StockTransferPrintView } from '../inventory/StockTransferPrintView';
import { WalletReceiptPrintView } from '../patient-wallet/WalletReceiptPrintView';
import {
  SAMPLE_CASH_VOUCHER,
  SAMPLE_CLINICAL_ORDER,
  SAMPLE_IMAGING_RESULT,
  SAMPLE_LAB_RESULT,
  SAMPLE_CASHIER_SHIFT,
  SAMPLE_COMBINED_INVOICES,
  SAMPLE_INVOICE,
  SAMPLE_PRESCRIPTION_VARIANT_LABEL,
  buildSamplePrescriptionVariant,
  type SamplePrescriptionVariant,
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
/** Xem trước đơn thuốc có 4 biến thể (đơn thường, "N", "H", trẻ nhỏ) để thấy tác động của từng công tắc ở khối "Thông tin trên đơn". */
function PrescriptionSamplePreview() {
  const [variant, setVariant] = useState<SamplePrescriptionVariant>('C');
  const sample = buildSamplePrescriptionVariant(variant);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5 print:hidden" role="group" aria-label="Loại đơn xem trước">
        {(Object.keys(SAMPLE_PRESCRIPTION_VARIANT_LABEL) as SamplePrescriptionVariant[]).map((v) => (
          <Button key={v} type="button" variant={variant === v ? 'primary' : 'secondary'} aria-pressed={variant === v} className="h-8 px-3 text-xs" onClick={() => setVariant(v)}>
            {SAMPLE_PRESCRIPTION_VARIANT_LABEL[v]}
          </Button>
        ))}
      </div>
      <PrescriptionPrintView
        doctorName="BS. Đặng Quốc Hưng"
        patientFullName={sample.patientFullName}
        patientDob={sample.patientDob}
        patientGender={sample.patientGender}
        diagnosisLabel={sample.diagnosisLabel}
        items={sample.items}
        documents={sample.documents}
        printInfo={sample.printInfo}
        signedAt="2026-10-01T07:30:00.000Z"
        advice="Uống thuốc đúng giờ, nghỉ ngơi, uống đủ nước. Quay lại ngay nếu sốt cao hoặc khó thở."
        followUpLabel="Thứ Năm, 08/10/2026"
      />
    </div>
  );
}

export function PrintDocumentPreview({ documentType }: { documentType: PrintDocumentType }) {
  switch (documentType) {
    case 'PRESCRIPTION':
      return <PrescriptionSamplePreview />;
    case 'CLINICAL_ORDER':
      return (
        <ClinicalOrderPrintView
          order={SAMPLE_CLINICAL_ORDER}
          patientFullName="Lý Thị Hoài Thương"
          patientCode="BN2610000148"
          patientDob="14/03/1987"
          patientGender="Nữ"
          patientPhone="0912 345 678"
          encounterNo="LK2610000312"
          diagnosisLabel="Đái tháo đường týp 2 không biến chứng (E11.9) / Tăng huyết áp vô căn (I10)"
          doctorName="BS. Đặng Quốc Hưng"
          printedAt="2026-10-06T02:30:00.000Z"
        />
      );
    case 'LAB_RESULT':
      return <ParaclinicalResultPrintView form={SAMPLE_LAB_RESULT} />;
    case 'IMAGING_RESULT':
      return <ParaclinicalResultPrintView form={SAMPLE_IMAGING_RESULT} />;
    case 'INVOICE':
      return <InvoicePrintView collectedByName="Nguyễn Thị Bích Ngọc" paymentMethodLabel="Tiền mặt" invoice={SAMPLE_INVOICE} insurance={SAMPLE_INSURANCE} />;
    case 'INVOICE_COMBINED':
      return (
        <InvoiceCombinedPrintView
          collectedByName="Nguyễn Thị Bích Ngọc"
          paymentMethodName={(code) => (code === 'CASH' ? 'Tiền mặt' : code)}
          data={SAMPLE_COMBINED_INVOICES}
          insurance={SAMPLE_INSURANCE}
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
    case 'MEDICINE_LABEL':
      return (
        <MedicineLabelSheet
          printedAt="2026-10-28T03:15:00.000Z"
          labels={[
            {
              key: 'sample-1',
              patientName: 'Nguyễn Văn An',
              birthYear: 2019,
              title: 'Zyrtec Sol 60ml (Cetirizin dihydroclorid 1mg/ml)',
              quantityText: '01 Hộp',
              instruction: 'Sáng 5 ml - Tối 5 ml, 5 ngày. Uống sau ăn.',
              lotText: 'Lô ZY2407 · HSD 07/2028',
            },
          ]}
        />
      );
    case 'SPECIMEN_LABEL':
      return (
        <SpecimenLabelSheet
          printedAt="2026-10-08T01:56:00.000Z"
          labels={[
            {
              sid: '2610080014',
              patientName: 'Lý Thị Hoài Thương',
              patientCode: 'BN2610000148',
              patientBirthYear: 1987,
              patientAgeYears: 39,
              patientGender: 'female',
              groupAbbreviation: 'HH',
              capLabel: 'Nắp tím',
            },
          ]}
        />
      );
  }
}

/**
 * Bệnh án được dựng ở MÁY CHỦ (`renderEncounterMedicalRecordHtml`, Chromium nội bộ) chứ không phải component React, nên xem trước ở đây là bản MINH HOẠ cùng khung
 * (đầu trang/tiêu đề/ghi chú/chữ ký) và cùng bố cục mẫu MS 15/BV-01 của MỘT lượt khám (#269): mục I–IV rồi trang "Tổng kết bệnh án" — phần thân là nội dung tiêu biểu.
 */
const SAMPLE_RECORD_SECTIONS: { numeral: string; title: string; body: string }[] = [
  { numeral: 'II', title: 'Lý do vào viện', body: 'Ho khan, sốt nhẹ 2 ngày.' },
  { numeral: 'III', title: 'Hỏi bệnh', body: '1. Quá trình bệnh lý: ho khan tăng về đêm, không khó thở. 2. Tiền sử bệnh: không dị ứng thuốc.' },
  {
    numeral: 'IV',
    title: 'Khám bệnh',
    body: 'Mạch 88 l/p · Nhiệt độ 37,8 °C · HA 120/75 mmHg · Nhịp thở 18 l/p · Cân nặng 54 kg. 1. Toàn thân: tỉnh. 2. Các bộ phận: phổi thô, không rales. 3. Cận lâm sàng: bạch cầu 11,2 G/L (cao nhẹ). 4. Chẩn đoán ban đầu: viêm đường hô hấp. 5. Đã xử lý: điều trị ngoại trú, Amoxicillin + Acid clavulanic 625mg × 14 viên. 6. Chẩn đoán khi ra viện: viêm phế quản cấp (J20.9). 7. Điều trị ngoại trú từ ngày 01/10/2026 đến ngày 08/10/2026.',
  },
];
const SAMPLE_RECORD_SUMMARY: { numeral: string; title: string; body: string }[] = [
  { numeral: '1', title: 'Diễn biến', body: 'Bệnh nhân nữ 39 tuổi, ho khan kèm sốt nhẹ 2 ngày, phổi thô.' },
  { numeral: '2', title: 'Cận lâm sàng', body: 'Công thức máu: bạch cầu 11,2 G/L (cao nhẹ).' },
  { numeral: '3', title: 'Chẩn đoán ra viện', body: 'Bệnh chính: viêm phế quản cấp (J20.9).' },
  { numeral: '4', title: 'Phương pháp điều trị', body: 'Điều trị ngoại trú bằng thuốc kháng sinh và long đờm.' },
  { numeral: '5', title: 'Tình trạng ra viện', body: 'Ổn định, tiếp tục điều trị ngoại trú.' },
  { numeral: '6', title: 'Hướng điều trị tiếp', body: 'Uống nhiều nước. Hẹn tái khám: 08/10/2026.' },
];

function SampleRecordRows({ rows }: { rows: { numeral: string; title: string; body: string }[] }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.numeral} className="grid grid-cols-[110px_1fr] border-b border-slate-300 last:border-b-0">
          <div className="border-r border-slate-300 bg-slate-50 p-2 font-semibold">
            {r.numeral}. {r.title}
          </div>
          <div className="p-2">{r.body}</div>
        </div>
      ))}
    </>
  );
}

/** Dải ngăn đánh số trang của bộ hồ sơ trong bản xem trước (chỉ hiện trên màn hình; khi in thử, phần sau ngăn tự sang trang mới). */
function RecordPageBreak({ page, label }: { page: number; label: string }) {
  return (
    <div className="my-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 print:hidden" aria-hidden="true">
      <span className="h-px flex-1 border-t border-dashed border-slate-300" />
      Trang {page} · {label}
      <span className="h-px flex-1 border-t border-dashed border-slate-300" />
    </div>
  );
}

/** Phiếu kết quả cận lâm sàng MẪU kèm theo bộ hồ sơ (chỉ minh hoạ vị trí/khung; bản in thật do máy chủ dựng từ kết quả đã duyệt). */
function SampleRecordClsSheet() {
  return (
    <div className="break-before-page text-[12px]">
      <p className="text-center text-[13px] font-semibold uppercase">Phiếu kết quả xét nghiệm</p>
      <p className="mt-1 text-slate-600">LÝ THỊ HOÀI THƯƠNG · Mã BN BN2610000123 · Số lưu trữ LT2026-000042</p>
      <table className="mt-2 w-full border-collapse border border-slate-300 text-[11px]">
        <thead>
          <tr className="bg-slate-50 text-left">
            <th className="border border-slate-300 px-2 py-1">Chỉ số</th>
            <th className="border border-slate-300 px-2 py-1">Kết quả</th>
            <th className="border border-slate-300 px-2 py-1">Khoảng tham chiếu</th>
            <th className="border border-slate-300 px-2 py-1">Đơn vị</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-slate-300 px-2 py-1">Bạch cầu</td>
            <td className="border border-slate-300 px-2 py-1 font-semibold underline">11,2</td>
            <td className="border border-slate-300 px-2 py-1">4,0 – 10,0</td>
            <td className="border border-slate-300 px-2 py-1">G/L</td>
          </tr>
          <tr>
            <td className="border border-slate-300 px-2 py-1">Hemoglobin</td>
            <td className="border border-slate-300 px-2 py-1">132</td>
            <td className="border border-slate-300 px-2 py-1">120 – 150</td>
            <td className="border border-slate-300 px-2 py-1">g/L</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1">
        <strong>Nhận xét:</strong> Bạch cầu tăng nhẹ.
      </p>
    </div>
  );
}

/** Đơn thuốc MẪU kèm theo bộ hồ sơ (minh hoạ; bản in thật gồm các đơn đã ký của lượt khám). */
function SampleRecordPrescriptionSheet() {
  return (
    <div className="break-before-page text-[12px]">
      <p className="text-center text-[13px] font-semibold uppercase">Đơn thuốc</p>
      <p className="mt-1 text-slate-600">LÝ THỊ HOÀI THƯƠNG · 39 tuổi · Chẩn đoán: Viêm phế quản cấp (J20.9)</p>
      <table className="mt-2 w-full border-collapse border border-slate-300 text-[11px]">
        <thead>
          <tr className="bg-slate-50 text-left">
            <th className="border border-slate-300 px-2 py-1">Tên thuốc</th>
            <th className="border border-slate-300 px-2 py-1">Liều dùng</th>
            <th className="border border-slate-300 px-2 py-1">Số lượng</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-slate-300 px-2 py-1">Amoxicillin 500 mg</td>
            <td className="border border-slate-300 px-2 py-1">Sáng 1 – Tối 1</td>
            <td className="border border-slate-300 px-2 py-1">14 viên</td>
          </tr>
          <tr>
            <td className="border border-slate-300 px-2 py-1">Acetylcysteine 200 mg</td>
            <td className="border border-slate-300 px-2 py-1">Sáng 1 – Chiều 1</td>
            <td className="border border-slate-300 px-2 py-1">14 gói</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function MedicalRecordPreview() {
  return (
    <PrintDocument
      documentType="MEDICAL_RECORD"
      title="Bệnh án ngoại trú"
      subtitle={
        <p>
          Số ngoại trú: <strong>LK2610000471</strong> · Số lưu trữ: <strong>LT2026-000042</strong> · MS: 15/BV-01
        </p>
      }
      signatureDateText={formatPrintDate('2026-10-01T07:30:00.000Z')}
      signatures={[{ label: 'Bác sĩ khám bệnh', name: 'BS. Đặng Quốc Hưng' }]}
    >
      {({ config }) => {
        // Bộ hồ sơ: tờ khám (trang 1) + Tổng kết (trang 2) luôn có; phiếu kết quả và đơn thuốc theo khối "Bộ hồ sơ khi in một lượt khám" (#272); bản mẫu chưa có khối = kèm hết.
        const withCls = config.recordBundle?.includeParaclinical !== false;
        const withRx = config.recordBundle?.includePrescriptions !== false;
        const pageCount = 2 + (withCls ? 1 : 0) + (withRx ? 1 : 0);
        return (
          <>
            <p className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400 print:hidden">Bộ hồ sơ {pageCount} trang</p>
            <div className="mt-3 border border-slate-300 text-[12px]">
              <div className="grid grid-cols-[110px_1fr] border-b border-slate-300">
                <div className="border-r border-slate-300 bg-slate-50 p-2 font-semibold">I. Hành chính</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-2">
                  <p>
                    1. Họ và tên: <strong>LÝ THỊ HOÀI THƯƠNG</strong>
                  </p>
                  <p>
                    2. Sinh ngày: <strong>14/03/1987</strong> · 39 tuổi
                  </p>
                  <p>
                    3. Giới: <strong>Nữ</strong>
                  </p>
                  <p className="col-span-2">
                    7. Địa chỉ: <strong>45/7 Trần Hưng Đạo, P. Cầu Ông Lãnh, TP. Hồ Chí Minh</strong>
                  </p>
                  {config.insurance?.show && formatInsurancePrintValue(SAMPLE_INSURANCE, config.insurance.whenSelfPay) && (
                    <p className="col-span-2">
                      10. BHYT giá trị đến · Số thẻ BHYT: <strong>{formatInsurancePrintValue(SAMPLE_INSURANCE, config.insurance.whenSelfPay)}</strong>
                    </p>
                  )}
                </div>
              </div>
              <SampleRecordRows rows={SAMPLE_RECORD_SECTIONS} />
            </div>
            <RecordPageBreak page={2} label="Tổng kết bệnh án" />
            <div className="break-before-page">
              <p className="text-[11px] font-semibold uppercase tracking-wide">Tổng kết bệnh án</p>
              <div className="mt-1 border border-slate-300 text-[12px]">
                <SampleRecordRows rows={SAMPLE_RECORD_SUMMARY} />
              </div>
            </div>
            {withCls && (
              <>
                <RecordPageBreak page={3} label="Phiếu kết quả cận lâm sàng" />
                <SampleRecordClsSheet />
              </>
            )}
            {withRx && (
              <>
                <RecordPageBreak page={withCls ? 4 : 3} label="Đơn thuốc" />
                <SampleRecordPrescriptionSheet />
              </>
            )}
          </>
        );
      }}
    </PrintDocument>
  );
}
