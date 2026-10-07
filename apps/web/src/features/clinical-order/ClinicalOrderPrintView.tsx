import type { ClinicalOrderDetail } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { formatVnd } from '../../shared/format/currency';
import { PrintDocument } from '../../shared/print/PrintDocument';

/**
 * Bản in "Phiếu chỉ định cận lâm sàng" (Cận lâm sàng GĐ3, docs/DECISIONS.md #212, mockup màn 9c) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo
 * theo bản mẫu `CLINICAL_ORDER` ("Quản lý mẫu in"), file này chỉ giữ phần THÂN: thông tin bệnh nhân + mục A "Thực hiện tại phòng khám" (có tiền, gói hiện
 * dịch vụ con) + mục B "Chỉ định thực hiện ngoài phòng khám" (không tiền, kèm lưu ý). Nhận dữ liệu qua props, không tự gọi API.
 */
export function ClinicalOrderPrintView({
  order,
  patientFullName,
  patientCode,
  patientDob,
  patientGender,
  patientPhone,
  encounterNo,
  diagnosisLabel,
  doctorName,
  printedAt,
}: {
  order: ClinicalOrderDetail;
  patientFullName: string;
  patientCode: string;
  patientDob: string;
  patientGender: string;
  patientPhone?: string;
  encounterNo?: string;
  /** Chẩn đoán của lượt khám; rỗng thì không in dòng này. */
  diagnosisLabel?: string;
  doctorName: string;
  printedAt: string;
}) {
  const inHouseItems = order.items.filter((i) => i.performance === 'IN_HOUSE' && i.packageId === null);
  const externalItems = order.items.filter((i) => i.performance === 'EXTERNAL');
  const hasInHouse = inHouseItems.length > 0 || order.packages.length > 0;
  let rowNo = 0;

  return (
    <PrintDocument
      documentType="CLINICAL_ORDER"
      title="Phiếu chỉ định cận lâm sàng"
      subtitle={`Số: ${order.orderNo}`}
      signatureDateText={formatPrintDate(printedAt)}
      signatures={[
        { label: 'Người bệnh / Người nhà', name: '' },
        { label: 'Bác sĩ chỉ định', name: doctorName },
      ]}
    >
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          Họ và tên: <strong>{patientFullName}</strong>
        </p>
        <p>
          Mã bệnh nhân: <strong>{patientCode}</strong>
        </p>
        <p>
          Ngày sinh: <strong>{patientDob}</strong>
        </p>
        <p>
          Giới tính: <strong>{patientGender}</strong>
        </p>
        {patientPhone && (
          <p>
            Điện thoại: <strong>{patientPhone}</strong>
          </p>
        )}
        {encounterNo && (
          <p>
            Mã lượt khám: <strong>{encounterNo}</strong>
          </p>
        )}
        {diagnosisLabel && (
          <p className="col-span-2">
            Chẩn đoán: <strong>{diagnosisLabel}</strong>
          </p>
        )}
      </div>

      {hasInHouse && (
        <>
          <p className="mt-5 text-[1.05em] font-bold">A. THỰC HIỆN TẠI PHÒNG KHÁM</p>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-800 text-left">
                <th className="w-8 py-1.5">TT</th>
                <th className="w-24 py-1.5">Mã</th>
                <th className="py-1.5">Tên dịch vụ</th>
                <th className="w-32 py-1.5">Nơi thực hiện</th>
                <th className="w-10 py-1.5 text-center">SL</th>
                <th className="w-24 py-1.5 text-right">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {inHouseItems.map((item) => (
                <tr key={item.id} className="border-b border-slate-300 align-top">
                  <td className="py-1.5">{++rowNo}</td>
                  <td className="py-1.5">{item.code ?? ''}</td>
                  <td className="py-1.5">{item.name}</td>
                  <td className="py-1.5">{item.placeName ?? ''}</td>
                  <td className="py-1.5 text-center">{item.quantity}</td>
                  <td className="py-1.5 text-right">{item.lineTotal === null ? '' : formatVnd(item.lineTotal)}</td>
                </tr>
              ))}
              {order.packages.map((pkg) => (
                <PackageRows key={pkg.id} pkg={pkg} children={order.items.filter((i) => i.packageId === pkg.id)} nextNo={() => ++rowNo} />
              ))}
              <tr>
                <td colSpan={5} className="py-2 text-right font-bold">
                  Tổng cộng
                </td>
                <td className="py-2 text-right font-bold">{formatVnd(order.inHouseTotal)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {externalItems.length > 0 && (
        <>
          <p className="mt-5 text-[1.05em] font-bold">{hasInHouse ? 'B. ' : ''}CHỈ ĐỊNH THỰC HIỆN NGOÀI PHÒNG KHÁM</p>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-800 text-left">
                <th className="w-8 py-1.5">TT</th>
                <th className="py-1.5">Tên dịch vụ</th>
                <th className="w-10 py-1.5 text-center">SL</th>
                <th className="w-64 py-1.5">Lưu ý cho người bệnh</th>
              </tr>
            </thead>
            <tbody>
              {externalItems.map((item, index) => (
                <tr key={item.id} className="border-b border-slate-300 align-top">
                  <td className="py-1.5">{index + 1}</td>
                  <td className="py-1.5">{item.name}</td>
                  <td className="py-1.5 text-center">{item.quantity}</td>
                  <td className="py-1.5">{item.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-slate-600">
            {hasInHouse ? 'Các dịch vụ mục B phòng khám chưa thực hiện được — ' : ''}Người bệnh mang phiếu này tới cơ sở có đủ điều kiện.
            {hasInHouse ? ' Chi phí mục B không nằm trong số tiền đã nêu ở mục A.' : ''}
          </p>
        </>
      )}
    </PrintDocument>
  );
}

/** 1 dòng "gói" (giá gói) + các dịch vụ con thụt lề, không có giá riêng ("trong gói"). */
function PackageRows({
  pkg,
  children,
  nextNo,
}: {
  pkg: ClinicalOrderDetail['packages'][number];
  children: ClinicalOrderDetail['items'];
  nextNo: () => number;
}) {
  return (
    <>
      <tr className="border-b border-slate-300 align-top">
        <td className="py-1.5">{nextNo()}</td>
        <td className="py-1.5">{pkg.code}</td>
        <td className="py-1.5 font-semibold">Gói: {pkg.name}</td>
        <td className="py-1.5" />
        <td className="py-1.5 text-center">1</td>
        <td className="py-1.5 text-right">{formatVnd(pkg.unitPrice)}</td>
      </tr>
      {children.map((child) => (
        <tr key={child.id} className="border-b border-slate-200 align-top text-slate-700">
          <td className="py-1" />
          <td className="py-1">{child.code ?? ''}</td>
          <td className="py-1 pl-4">— {child.name}</td>
          <td className="py-1">{child.placeName ?? ''}</td>
          <td className="py-1 text-center">{child.quantity}</td>
          <td className="py-1 text-right text-slate-500">trong gói</td>
        </tr>
      ))}
    </>
  );
}
