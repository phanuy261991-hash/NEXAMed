import { UNREADABLE_LABEL } from '../encryption-key/encryption-key-view';
import { ShieldCheck } from '@phosphor-icons/react';
import type { EncounterInsurance } from '@nexamed/shared';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatValidityRange, KIND_CHIP_CLASS, KIND_LABEL, SELF_PAY_REASON_LABEL } from './insurance-card-view';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3.5 border-t border-slate-100 py-2 first:border-t-0 first:pt-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * Khung "Thẻ BHYT lúc khám" ở chi tiết một lượt khám cũ (S2-04, docs/DECISIONS.md #243, mockup màn 6) — thẻ ĐÃ CHỤP vào lượt khám lúc Tiếp nhận, không đổi dù bệnh nhân
 * sau đó đổi/xoá thẻ. `insurance` là `null` khi phòng khám chưa bật "Áp dụng BHYT" → không hiện khung. Không phải dữ liệu tiền nên không bị che theo chi nhánh.
 */
export function EncounterInsuranceSection({ insurance }: { insurance: EncounterInsurance | null | undefined }) {
  if (!insurance) return null;
  // Số thẻ không giải mã được (khoá hệ thống không khớp, #262) KHÔNG phải "tự chi trả" — vẫn hiện khung thẻ, số thẻ ghi "Không đọc được".
  const selfPay = insurance.selfPay || (!insurance.cardNo && !insurance.cardNoUnreadable);
  return (
    <div className="relative rounded-lg border border-slate-200 bg-white p-5 pt-8 shadow-sm">
      <span className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
        <ShieldCheck size={12} weight="fill" aria-hidden="true" />
        Thẻ BHYT lúc khám
      </span>
      <span className="absolute -top-2.5 right-4 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Đã chụp, không đổi</span>
      {selfPay ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700">
            Lượt khám này ghi <strong className="font-semibold text-slate-900">tự chi trả</strong>
            {insurance.reason ? ` (${SELF_PAY_REASON_LABEL[insurance.reason].toLowerCase()})` : ''}.
          </p>
          <StatusBadge tone="neutral">Tự chi trả</StatusBadge>
        </div>
      ) : (
        <dl>
          <Row label="Số thẻ">
            <span className="tabular-nums tracking-wide">{insurance.cardNoUnreadable ? <span className="text-rose-700">{UNREADABLE_LABEL}</span> : insurance.cardNo}</span>
            {insurance.kind && (
              <span className={`ml-2 inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${KIND_CHIP_CLASS[insurance.kind]}`}>{KIND_LABEL[insurance.kind]}</span>
            )}
          </Row>
          <Row label="Hiệu lực">{formatValidityRange(insurance.validFrom, insurance.validTo)}</Row>
          <Row label="Nơi đăng ký KCB">{insurance.facilityName ? `${insurance.facilityName}${insurance.facilityCode ? ` · ${insurance.facilityCode}` : ''}` : '—'}</Row>
          <Row label="Mức hưởng">{insurance.benefitRate !== null ? `${insurance.benefitRate}%` : '—'}</Row>
          <Row label="Hình thức thanh toán">
            <StatusBadge tone="info">BHYT</StatusBadge>
          </Row>
        </dl>
      )}
    </div>
  );
}
