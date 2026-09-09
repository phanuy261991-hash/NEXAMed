import { useMemo } from 'react';
import { IdentificationBadge, Phone, MapPin, CalendarBlank, UsersThree, type Icon } from '@phosphor-icons/react';
import type { PatientDetail } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useAllWardsQuery, useProvincesQuery } from '../geo/geo.queries';
import { useWalletQuery } from '../patient-wallet/patient-wallet.queries';
import { AllergyBanner } from './AllergyBanner';
import { GENDER_LABEL, computeAgeLabel, formatAddressLine } from './patient-form.utils';
import { formatDobDisplay } from '../../shared/format/date';

function IdentityPill({ icon: IconComponent, children, accent = false }: { icon: Icon; children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        accent ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'
      }`}
    >
      <IconComponent size={12} weight="bold" className="opacity-70" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * Dải định danh NGANG của trang "Hồ sơ bệnh nhân" (thay sidebar dọc — bố cục cuối cùng đã duyệt qua
 * nhiều vòng mockup). Avatar đặc + tên + pill có icon; cảnh báo dị ứng (`AllergyBanner`, tái dùng
 * component đã có ở màn khám) đặt ngay dưới, luôn hiện bất kể tab đang chọn.
 */
export function PatientProfileHeader({
  patient,
  canEdit,
  canMerge,
  merged,
  onEdit,
  onMerge,
}: {
  patient: PatientDetail;
  canEdit: boolean;
  canMerge: boolean;
  merged: boolean;
  onEdit: () => void;
  onMerge: () => void;
}) {
  const provincesQuery = useProvincesQuery();
  const wardsQuery = useAllWardsQuery();
  const walletQuery = useWalletQuery(patient.id);
  const wallet = walletQuery.data;
  const provinceNameByCode = useMemo(
    () => Object.fromEntries((provincesQuery.data?.items ?? []).map((p) => [p.code, p.name])),
    [provincesQuery.data],
  );
  const wardNameByCode = useMemo(() => Object.fromEntries((wardsQuery.data?.items ?? []).map((w) => [w.code, w.name])), [wardsQuery.data]);
  const addressLine = formatAddressLine(patient.address, provinceNameByCode, wardNameByCode);
  const initials = patient.fullName
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 border-b-2 border-b-blue-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white ring-4 ring-blue-50">
            {initials || '?'}
          </div>
          <div>
            <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-blue-600">Hồ sơ bệnh nhân</div>
            <h1 className="text-lg font-bold leading-tight text-slate-900">{patient.fullName}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <IdentityPill icon={IdentificationBadge} accent>
                {patient.patientCode}
              </IdentityPill>
              <IdentityPill icon={UsersThree} accent>
                {GENDER_LABEL[patient.gender] ?? patient.gender}
              </IdentityPill>
              <IdentityPill icon={CalendarBlank}>
                {formatDobDisplay(patient.dob)} · {computeAgeLabel(patient.dob)}
              </IdentityPill>
              <IdentityPill icon={Phone}>{patient.phone}</IdentityPill>
              {addressLine && <IdentityPill icon={MapPin}>{addressLine}</IdentityPill>}
            </div>
          </div>
        </div>

        {(wallet || (!merged && (canMerge || canEdit))) && (
          <div className="flex flex-shrink-0 items-center gap-2">
            {wallet && (
              <StatusBadge tone={wallet.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {wallet.status === 'ACTIVE' ? 'Ví đang hoạt động' : 'Ví đã khoá'}
              </StatusBadge>
            )}
            {!merged && canMerge && (
              <Button type="button" variant="secondary" onClick={onMerge}>
                Gộp vào hồ sơ khác
              </Button>
            )}
            {!merged && canEdit && (
              <Button type="button" onClick={onEdit}>
                Sửa hồ sơ
              </Button>
            )}
          </div>
        )}
      </div>

      {patient.allergens.length > 0 && <AllergyBanner allergens={patient.allergens} />}
    </div>
  );
}
