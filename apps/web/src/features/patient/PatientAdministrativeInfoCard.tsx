import { useMemo } from 'react';
import { IdentificationCard, PencilSimple } from '@phosphor-icons/react';
import type { PatientDetail } from '@nexamed/shared';
import { useAllWardsQuery, useProvincesQuery } from '../geo/geo.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { formatDobDisplay } from '../../shared/format/date';
import { GENDER_LABEL, formatAddressLine } from './patient-form.utils';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-0.5 block text-sm font-medium text-slate-500">{label}</span>
      <span className="text-base font-semibold text-slate-900">{value || '—'}</span>
    </div>
  );
}

function codeNameMap(items: { code: string; name: string }[] | undefined): Record<string, string> {
  return Object.fromEntries((items ?? []).map((i) => [i.code, i.name]));
}

/**
 * Thẻ "Thông tin hành chính" của trang "Hồ sơ bệnh nhân" — CHỈ HIỂN THỊ (không input/validate),
 * đúng bố cục mockup đã duyệt (1 khối gộp, không dùng lại `PatientFormFields` vì component đó luôn
 * tự vẽ 2 khối viền riêng — đã hỏi và chốt chấp nhận đánh đổi thêm 1 component hiển thị).
 */
export function PatientAdministrativeInfoCard({ patient, onEdit }: { patient: PatientDetail; onEdit?: () => void }) {
  const provincesQuery = useProvincesQuery();
  const wardsQuery = useAllWardsQuery();
  const ethnicityQuery = useReferenceCatalogQuery('ETHNICITY');
  const nationalityQuery = useReferenceCatalogQuery('NATIONALITY');
  const occupationQuery = useReferenceCatalogQuery('OCCUPATION');

  const provinceNameByCode = useMemo(() => codeNameMap(provincesQuery.data?.items), [provincesQuery.data]);
  const wardNameByCode = useMemo(() => codeNameMap(wardsQuery.data?.items), [wardsQuery.data]);
  const ethnicityNameByCode = useMemo(() => codeNameMap(ethnicityQuery.data?.items), [ethnicityQuery.data]);
  const nationalityNameByCode = useMemo(() => codeNameMap(nationalityQuery.data?.items), [nationalityQuery.data]);
  const occupationNameByCode = useMemo(() => codeNameMap(occupationQuery.data?.items), [occupationQuery.data]);

  const hasRelative = Boolean(patient.relativeFullName || patient.relativeRelationship || patient.relativePhone || patient.relativeAddress);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <IdentificationCard size={16} weight="fill" className="text-blue-600" aria-hidden="true" />
          Thông tin hành chính
        </h2>
        {onEdit && (
          <button type="button" onClick={onEdit} aria-label="Sửa thông tin hành chính" className="text-slate-400 hover:text-slate-600">
            <PencilSimple size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Họ và tên" value={patient.fullName} />
        <Field label="Ngày sinh" value={formatDobDisplay(patient.dob)} />
        <Field label="Giới tính" value={GENDER_LABEL[patient.gender] ?? patient.gender} />
        <Field label="Số điện thoại" value={patient.phone} />
        <Field label="Số CCCD" value={patient.nationalId ?? ''} />
        <Field label="Ngày / nơi cấp" value={[patient.nationalIdIssuedAt, patient.nationalIdIssuedPlace].filter(Boolean).join(' · ')} />
        <Field label="Số thẻ BHYT" value={patient.insuranceNumber ?? ''} />
        <Field label="Dân tộc" value={patient.ethnicity ? (ethnicityNameByCode[patient.ethnicity] ?? patient.ethnicity) : ''} />
        <Field label="Quốc tịch" value={patient.nationality ? (nationalityNameByCode[patient.nationality] ?? patient.nationality) : ''} />
        <Field label="Nghề nghiệp" value={patient.occupation ? (occupationNameByCode[patient.occupation] ?? patient.occupation) : ''} />
        <div className="col-span-2 sm:col-span-3 lg:col-span-4">
          <Field label="Địa chỉ" value={formatAddressLine(patient.address, provinceNameByCode, wardNameByCode)} />
        </div>
      </div>

      {hasRelative && (
        <div className="px-5 pb-5">
          <div className="mb-2 mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-700">Thông tin người thân</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md bg-slate-50 p-3 sm:grid-cols-4">
            <Field label="Họ và tên" value={patient.relativeFullName ?? ''} />
            <Field label="Quan hệ" value={patient.relativeRelationship ?? ''} />
            <Field label="Số điện thoại" value={patient.relativePhone ?? ''} />
            <Field label="Địa chỉ" value={patient.relativeAddress ?? ''} />
          </div>
        </div>
      )}
    </section>
  );
}

