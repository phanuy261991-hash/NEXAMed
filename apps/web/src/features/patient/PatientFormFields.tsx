import { useState } from 'react';
import { MagnifyingGlass, PencilSimple } from '@phosphor-icons/react';
import type { FamilyRelation, PatientGender } from '@nexamed/shared';
import { calculateAgeYears, computeAgeLabel, computeBirthYear, findRepeatedFamilyConditions } from './patient-form.utils';
import { PatientAvatarUpload } from './PatientAvatarUpload';
import { PhoneDuplicateWarning } from './PhoneDuplicateWarning';
import { PatientHistoryDialog } from './PatientHistoryDialog';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useProvincesQuery, useWardsQuery } from '../geo/geo.queries';
import { Combobox, withLegacyValueOption, type ComboboxOption } from '../../shared/ui/Combobox';

/** Khớp `ADULT_AGE_THRESHOLD` trong `packages/shared/src/patient.ts` (docs/DECISIONS.md #035). */
const ADULT_AGE_THRESHOLD = 18;

/** Một bệnh lý nền/thói quen đã chọn (Sprint 5) — thói quen dùng chung mảng này, mã ICD-10 Chương XXI (Z72.x). */
export interface ConditionDraft {
  icd10Code: string;
  icd10Name: string;
}

/** Một dòng "Tiền sử gia đình" (Sprint 5) — `draftId` chỉ dùng làm React key/xoá dòng lúc sửa, KHÔNG gửi lên server. */
export interface FamilyHistoryRowDraft {
  draftId: string;
  /** Rỗng khi chưa chọn — cùng nguyên tắc "không tô sẵn giá trị mặc định" ở `gender`. */
  relation: FamilyRelation | '';
  icd10Code: string;
  icd10Name: string;
  /** Dạng chuỗi để bind trực tiếp vào `<input type="number">`; rỗng nếu chưa nhập. */
  ageOfOnsetYears: string;
}

/** Form state phẳng (địa chỉ không lồng) — quy đổi sang/từ payload API ở nơi gọi (New/Edit page). */
export interface PatientFormValues {
  fullName: string;
  dob: string;
  /** Rỗng khi chưa chọn — trường bắt buộc KHÔNG có giá trị mặc định tô sẵn (.claude/docs/ui-guidelines.md mục 4.1c). */
  gender: PatientGender | '';
  phone: string;
  nationalId: string;
  nationalIdIssuedAt: string;
  nationalIdIssuedPlace: string;
  ethnicity: string;
  nationality: string;
  occupation: string;
  insuranceNumber: string;
  street: string;
  ward: string;
  neighborhood: string;
  province: string;
  /** Dị nguyên đã biết — liên kết danh mục "Dị nguyên" có sẵn (Sprint 4, chốt 2026-08-25). "Ghi chú dị ứng khác" (text tự do) đã bỏ khỏi UI (Sprint 5) — không có trường thay thế. */
  allergenIds: string[];
  /** Ghi chú bổ sung tự do cạnh chip bệnh lý nền (Sprint 5) — KHÁC ý nghĩa "Tiền sử bản thân" cũ (nay đã có `conditions`). */
  personalHistory: string;
  /** Bệnh lý nền + thói quen/lối sống có cấu trúc (Sprint 5) — thay ô text "Tiền sử bản thân" cũ. */
  conditions: ConditionDraft[];
  /** Tiền sử gia đình có cấu trúc (Sprint 5) — thay ô text "Tiền sử gia đình" cũ. */
  familyHistoryRows: FamilyHistoryRowDraft[];
  relativeFullName: string;
  relativeRelationship: string;
  relativePhone: string;
  relativeAddress: string;
}

export const EMPTY_PATIENT_FORM: PatientFormValues = {
  fullName: '',
  dob: '',
  gender: '',
  phone: '',
  nationalId: '',
  nationalIdIssuedAt: '',
  nationalIdIssuedPlace: '',
  ethnicity: '1',
  nationality: 'VNM',
  occupation: '',
  insuranceNumber: '',
  street: '',
  ward: '',
  neighborhood: '',
  province: '',
  allergenIds: [],
  personalHistory: '',
  conditions: [],
  familyHistoryRows: [],
  relativeFullName: '',
  relativeRelationship: '',
  relativePhone: '',
  relativeAddress: '',
};

const GENDER_OPTIONS: ComboboxOption[] = [
  { value: 'female', label: 'Nữ' },
  { value: 'male', label: 'Nam' },
  { value: 'other', label: 'Khác' },
];

/** Giá trị đã nhập BẮT BUỘC nổi bật (`font-semibold` + `text-slate-900`) — chốt 2026-08-14, xem
 * `.claude/docs/ui-guidelines.md` mục 4.1c: nhãn nhỏ/nhạt phía trên, giá trị đậm/rõ phía dưới. */
const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const readOnlyInputClassName = `${inputClassName} bg-slate-50 text-slate-800`;
const labelClassName = 'mb-1 block text-sm font-semibold text-slate-800';
/** Khung viền quanh mỗi nhóm trường + badge tiêu đề nổi trên viền — bố cục tham khảo theo ảnh chủ dự án gửi. */
const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-6 pt-8';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';
/** Lưới trường tra dày hơn (gap hẹp) theo đúng mật độ trong ảnh tham khảo, thay cho gap-6 trước đây. */
const fieldGridClassName = 'grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 lg:grid-cols-4';

function Field({
  id,
  label,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelClassName} htmlFor={id}>
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

/** Badge trạng thái 1 loại Tiền sử trong dòng tóm tắt (mockup đã duyệt) — `empty` nhạt, `teal` đã có dữ liệu, `amber` cần chú ý (phát hiện trùng bệnh lý gia đình), `rose` an toàn/dị ứng. */
function HistorySummaryPill({ label, count, tone }: { label: string; count: number; tone: 'empty' | 'teal' | 'amber' | 'rose' }) {
  const toneClassName =
    tone === 'empty'
      ? 'border-slate-300 bg-white text-slate-400'
      : tone === 'teal'
        ? 'border-brand-teal bg-brand-teal-tint text-brand-teal-active'
        : tone === 'amber'
          ? 'border-amber-300 bg-amber-50 text-amber-700'
          : 'border-rose-300 bg-rose-50 text-rose-700';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClassName}`}>
      {label} · {count > 0 ? count : 'chưa ghi nhận'}
    </span>
  );
}

/**
 * Form nhập liệu hồ sơ bệnh nhân — dùng chung cho tạo mới (PatientNewPage) và sửa tại chỗ
 * (PatientDetailPage, không modal — đã chốt với chủ dự án). Mở rộng field (docs/DECISIONS.md
 * #034) chia 2 khối rõ ràng: "Thông tin hành chính" / "Thông tin người thân", lưới 2-3 cột theo
 * .claude/docs/ui-guidelines.md mục 4.1 (trường bắt buộc có dấu `*` đỏ, textarea kéo full-width).
 *
 * `patientId`/`patientCode`/`photoUrl`/`version` chỉ có giá trị ở trang Chi tiết (patient đã tồn
 * tại) — `undefined` ở trang Thêm mới, `PatientAvatarUpload`/Mã bệnh nhân tự chuyển sang trạng
 * thái phù hợp (chưa upload được / hiển thị "sẽ cấp tự động").
 */
export function PatientFormFields({
  values,
  onChange,
  disabled = false,
  identityLocked = false,
  hidePhoneDuplicateHint = false,
  patientId,
  patientCode,
  photoUrl,
  version,
  onSearchPatient,
}: {
  values: PatientFormValues;
  onChange: (values: PatientFormValues) => void;
  disabled?: boolean;
  /**
   * Khoá RIÊNG 4 field định danh (CCCD, Mã bệnh nhân — luôn readonly sẵn, Họ và tên, Ngày sinh) —
   * dùng ở màn hình "Tiếp nhận bệnh nhân" (mockup đã duyệt) khi đã khớp đúng bệnh nhân cũ qua tra
   * trùng SĐT/CCCD: 4 field này không cho sửa, các field còn lại (SĐT, địa chỉ...) vẫn sửa được
   * bình thường. KHÁC `disabled` (khoá TOÀN BỘ form, dùng khi có nghi trùng PAT-03 chờ xác nhận).
   */
  identityLocked?: boolean;
  /**
   * Ẩn `PhoneDuplicateWarning` inline mặc định — dùng ở màn hình "Tiếp nhận bệnh nhân" vì đã có
   * `PatientMatchDialog` (popup) làm cùng việc nổi bật hơn, tránh hiện trùng 2 lời cảnh báo cùng
   * lúc (chủ dự án phản hồi). Nơi khác (Thêm/Sửa bệnh nhân) vẫn giữ cảnh báo mềm inline như cũ.
   */
  hidePhoneDuplicateHint?: boolean;
  patientId?: string;
  patientCode?: string;
  photoUrl?: string | null;
  version?: number;
  /**
   * Icon "Tìm kiếm khách hàng" cạnh ô Mã bệnh nhân (Sprint 5) — CHỈ truyền từ `ReceptionIntakeForm.tsx`
   * (mở `PatientSearchDialog`). Không truyền = không hiện icon (Thêm/Sửa bệnh nhân không cần tìm
   * "bệnh nhân khác" trong lúc đang xem/sửa đúng 1 hồ sơ).
   */
  onSearchPatient?: () => void;
}) {
  function set<K extends keyof PatientFormValues>(key: K, value: PatientFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  const ethnicityQuery = useReferenceCatalogQuery('ETHNICITY');
  const nationalityQuery = useReferenceCatalogQuery('NATIONALITY');
  const occupationQuery = useReferenceCatalogQuery('OCCUPATION');
  const ethnicityOptions = withLegacyValueOption(
    (ethnicityQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    values.ethnicity,
  );
  const nationalityOptions = withLegacyValueOption(
    (nationalityQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    values.nationality,
  );
  const occupationOptions = withLegacyValueOption(
    (occupationQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    values.occupation,
  );

  // Cascading Tỉnh → Phường/Xã (docs/DECISIONS.md #038). Đổi Tỉnh thì Phường/Xã cũ (nếu có) hết
  // hợp lệ — xoá luôn để tránh lưu một cặp province/ward không khớp nhau.
  const provinceQuery = useProvincesQuery();
  const wardQuery = useWardsQuery(values.province);
  const provinceOptions = withLegacyValueOption(
    (provinceQuery.data?.items ?? []).map((p) => ({ value: p.code, label: p.name })),
    values.province,
  );
  const wardOptions = withLegacyValueOption(
    (wardQuery.data?.items ?? []).map((w) => ({ value: w.code, label: w.name })),
    values.ward,
  );
  function setProvince(code: string) {
    onChange({ ...values, province: code, ward: '' });
  }

  const birthYear = computeBirthYear(values.dob);
  const ageLabel = computeAgeLabel(values.dob);

  // CCCD bắt buộc khi >= 18 tuổi (docs/DECISIONS.md #035) — CHỈ áp lúc tạo mới (`patientId`
  // undefined). Không áp lại lúc sửa, khớp đúng `createPatientRequestSchema` (không phải
  // `updatePatientRequestSchema`) để tránh chặn sửa các hồ sơ người lớn đã tạo trước ràng buộc này.
  const hasValidDob = values.dob !== '' && !Number.isNaN(new Date(values.dob).getTime());
  const isCreateContext = patientId === undefined;
  const requireNationalId = isCreateContext && hasValidDob && calculateAgeYears(values.dob) >= ADULT_AGE_THRESHOLD;

  return (
    <div className="space-y-8">
      <div className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Thông tin hành chính</span>

        <div className="flex flex-col gap-4 sm:flex-row">
        <PatientAvatarUpload patientId={patientId} photoUrl={photoUrl ?? null} version={version} disabled={disabled} />

        <div className={`flex-1 ${fieldGridClassName}`}>
          <Field id="patientCode" label="Mã bệnh nhân">
            <div className="flex items-center gap-1.5">
              <input
                id="patientCode"
                readOnly
                disabled
                value={patientCode ?? ''}
                className={readOnlyInputClassName}
              />
              {onSearchPatient && (
                <button
                  type="button"
                  onClick={onSearchPatient}
                  disabled={disabled}
                  title="Tìm kiếm khách hàng đã có"
                  aria-label="Tìm kiếm khách hàng đã có"
                  className="flex h-9.5 w-9.5 flex-none items-center justify-center rounded-md border border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MagnifyingGlass size={16} weight="bold" />
                </button>
              )}
            </div>
          </Field>

          <Field id="fullName" label="Họ và tên" required>
            <input
              id="fullName"
              required
              disabled={disabled || identityLocked}
              value={values.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              className={identityLocked ? readOnlyInputClassName : inputClassName}
            />
          </Field>

          <Field id="gender" label="Giới tính" required>
            <Combobox
              id="gender"
              required
              disabled={disabled}
              value={values.gender}
              onChange={(v) => set('gender', v as PatientGender | '')}
              options={GENDER_OPTIONS}
            />
          </Field>

          <Field id="dob" label="Ngày sinh" required>
            <input
              id="dob"
              type="date"
              required
              disabled={disabled || identityLocked}
              value={values.dob}
              onChange={(e) => set('dob', e.target.value)}
              className={identityLocked ? readOnlyInputClassName : inputClassName}
            />
          </Field>

          <Field id="birthYear" label="Năm sinh">
            <input id="birthYear" readOnly disabled value={birthYear} className={readOnlyInputClassName} />
          </Field>

          <Field id="age" label="Tuổi">
            <input id="age" readOnly disabled value={ageLabel} className={readOnlyInputClassName} />
          </Field>

          <Field id="phone" label="Số điện thoại" required>
            <input
              id="phone"
              type="tel"
              required
              disabled={disabled}
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
              className={inputClassName}
            />
            {!disabled && !hidePhoneDuplicateHint && <PhoneDuplicateWarning phone={values.phone} excludePatientId={patientId} />}
          </Field>

          <Field id="nationalId" label="CCCD/CMND" required={requireNationalId}>
            <input
              id="nationalId"
              required={requireNationalId}
              disabled={disabled || identityLocked}
              value={values.nationalId}
              onChange={(e) => set('nationalId', e.target.value)}
              className={identityLocked ? readOnlyInputClassName : inputClassName}
              placeholder={requireNationalId ? 'Bắt buộc — bệnh nhân từ 18 tuổi' : 'Để trống nếu chưa có giấy tờ'}
            />
          </Field>

          <Field id="nationalIdIssuedAt" label="Ngày cấp">
            <input
              id="nationalIdIssuedAt"
              type="date"
              disabled={disabled}
              value={values.nationalIdIssuedAt}
              onChange={(e) => set('nationalIdIssuedAt', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <Field id="nationalIdIssuedPlace" label="Nơi cấp">
            <input
              id="nationalIdIssuedPlace"
              disabled={disabled}
              value={values.nationalIdIssuedPlace}
              onChange={(e) => set('nationalIdIssuedPlace', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <Field id="ethnicity" label="Dân tộc">
            <Combobox
              id="ethnicity"
              disabled={disabled}
              value={values.ethnicity}
              onChange={(v) => set('ethnicity', v)}
              options={ethnicityOptions}
            />
          </Field>

          <Field id="nationality" label="Quốc tịch">
            <Combobox
              id="nationality"
              disabled={disabled}
              value={values.nationality}
              onChange={(v) => set('nationality', v)}
              options={nationalityOptions}
            />
          </Field>

          <Field id="occupation" label="Nghề nghiệp">
            <Combobox
              id="occupation"
              disabled={disabled}
              value={values.occupation}
              onChange={(v) => set('occupation', v)}
              options={occupationOptions}
            />
          </Field>

          <Field id="insuranceNumber" label="Số bảo hiểm">
            <input
              id="insuranceNumber"
              disabled={disabled}
              value={values.insuranceNumber}
              onChange={(e) => set('insuranceNumber', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <Field id="province" label="Tỉnh/Thành phố">
            <Combobox
              id="province"
              disabled={disabled}
              value={values.province}
              onChange={setProvince}
              options={provinceOptions}
            />
          </Field>

          <Field id="ward" label="Phường/Xã">
            <Combobox
              id="ward"
              disabled={disabled || values.province === ''}
              placeholder={values.province === '' ? 'Chọn Tỉnh/Thành phố trước' : 'Gõ để tìm...'}
              value={values.ward}
              onChange={(v) => set('ward', v)}
              options={wardOptions}
            />
          </Field>

          <Field id="street" label="Số nhà, đường">
            <input
              id="street"
              disabled={disabled}
              value={values.street}
              onChange={(e) => set('street', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <Field id="neighborhood" label="Khu phố">
            <input
              id="neighborhood"
              disabled={disabled}
              value={values.neighborhood}
              onChange={(e) => set('neighborhood', e.target.value)}
              className={inputClassName}
            />
          </Field>

          {/* Tiền sử bản thân/gia đình/dị ứng (docs/DECISIONS.md #068, chuyển sang dữ liệu có cấu
              trúc Sprint 5) — dùng chung mọi lượt khám của bệnh nhân, không nhập lại theo từng lần
              khám (khác ghi chú lâm sàng ở màn khám). 1 dòng tóm tắt + nút "Thêm/Sửa" mở
              `PatientHistoryDialog` thay 4 field rời rạc trước đây (mockup đã duyệt). */}
          <Field id="history" label="Tiền sử" className="col-span-2 sm:col-span-3 lg:col-span-4">
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2.5">
              <div className="flex flex-1 flex-wrap gap-1.5">
                <HistorySummaryPill
                  label="Bản thân"
                  count={values.conditions.length}
                  tone={values.conditions.length > 0 ? 'teal' : 'empty'}
                />
                <HistorySummaryPill
                  label="Gia đình"
                  count={values.familyHistoryRows.filter((r) => r.relation !== '' && r.icd10Code !== '').length}
                  tone={
                    findRepeatedFamilyConditions(values.familyHistoryRows).length > 0
                      ? 'amber'
                      : values.familyHistoryRows.length > 0
                        ? 'teal'
                        : 'empty'
                  }
                />
                <HistorySummaryPill label="Dị ứng" count={values.allergenIds.length} tone={values.allergenIds.length > 0 ? 'rose' : 'empty'} />
              </div>
              <button
                type="button"
                onClick={() => setHistoryDialogOpen(true)}
                disabled={disabled}
                className="flex flex-none items-center gap-1.5 rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PencilSimple size={14} weight="bold" />
                Thêm / Sửa
              </button>
            </div>
          </Field>
        </div>
        </div>

        <PatientHistoryDialog
          open={historyDialogOpen}
          onClose={() => setHistoryDialogOpen(false)}
          values={values}
          onChange={onChange}
        />
      </div>

      <div className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Thông tin người thân</span>

        <div className={fieldGridClassName}>
          <Field id="relativeFullName" label="Họ tên người thân">
            <input
              id="relativeFullName"
              disabled={disabled}
              value={values.relativeFullName}
              onChange={(e) => set('relativeFullName', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <Field id="relativeRelationship" label="Mối quan hệ">
            <input
              id="relativeRelationship"
              disabled={disabled}
              value={values.relativeRelationship}
              onChange={(e) => set('relativeRelationship', e.target.value)}
              className={inputClassName}
              placeholder="Ví dụ: Bố, Mẹ, Vợ/Chồng, Con"
            />
          </Field>

          <Field id="relativePhone" label="Số điện thoại người thân">
            <input
              id="relativePhone"
              type="tel"
              disabled={disabled}
              value={values.relativePhone}
              onChange={(e) => set('relativePhone', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <Field id="relativeAddress" label="Địa chỉ người thân">
            <input
              id="relativeAddress"
              disabled={disabled}
              value={values.relativeAddress}
              onChange={(e) => set('relativeAddress', e.target.value)}
              className={inputClassName}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
