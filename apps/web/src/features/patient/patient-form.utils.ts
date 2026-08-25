import type { CreatePatientRequest, PatientAddress, PatientDetail, PatientGender, UpdatePatientRequest } from '@nexamed/shared';
import { EMPTY_PATIENT_FORM, type FamilyHistoryRowDraft, type PatientFormValues } from './PatientFormFields';
import { FAMILY_RELATION_LABELS } from './family-relation';

export { FAMILY_RELATION_LABELS };

/** Chuỗi rỗng → không gửi field (undefined) — khớp field optional của schema dùng chung. */
function orUndefined(value: string): string | undefined {
  return value.trim() === '' ? undefined : value;
}

/**
 * `district` (Quận/Huyện) KHÔNG còn input trên form (docs/DECISIONS.md #034 — bỏ theo đúng danh
 * sách trường yêu cầu, khớp cải cách hành chính 2 cấp Tỉnh→Xã) nên không đưa vào đây nữa — hồ sơ
 * cũ có sẵn `district` sẽ bị bỏ trống khi sửa và lưu lại (chấp nhận được, xem plan đã duyệt).
 */
function toAddress(values: PatientFormValues): CreatePatientRequest['address'] {
  const address = {
    street: orUndefined(values.street),
    ward: orUndefined(values.ward),
    neighborhood: orUndefined(values.neighborhood),
    province: orUndefined(values.province),
  };
  const hasAnyField = Object.values(address).some((v) => v !== undefined);
  return hasAnyField ? address : undefined;
}

export function toCreatePatientRequest(values: PatientFormValues): CreatePatientRequest {
  return {
    fullName: values.fullName,
    dob: values.dob,
    // Bắt buộc chọn thật trước khi submit được (required trên Combobox chặn ở tầng UI) — ép kiểu ở
    // đây vì `PatientFormValues.gender` cho phép rỗng lúc CHƯA chọn (ui-guidelines.md mục 4.1c).
    gender: values.gender as PatientGender,
    phone: values.phone,
    nationalId: orUndefined(values.nationalId),
    nationalIdIssuedAt: orUndefined(values.nationalIdIssuedAt),
    nationalIdIssuedPlace: orUndefined(values.nationalIdIssuedPlace),
    ethnicity: orUndefined(values.ethnicity),
    nationality: orUndefined(values.nationality),
    occupation: orUndefined(values.occupation),
    insuranceNumber: orUndefined(values.insuranceNumber),
    address: toAddress(values),
    allergenIds: values.allergenIds,
    personalHistory: orUndefined(values.personalHistory),
    // Bệnh lý nền + thói quen/lối sống có cấu trúc (Sprint 5) — mảng mã ICD-10, cùng ngữ nghĩa allergenIds.
    conditionCodes: values.conditions.map((c) => c.icd10Code),
    // Tiền sử gia đình có cấu trúc (Sprint 5) — bỏ dòng chưa chọn đủ quan hệ/bệnh lý (chưa hợp lệ để gửi).
    familyHistoryRows: values.familyHistoryRows
      .filter((row) => row.relation !== '' && row.icd10Code !== '')
      .map((row) => ({
        relation: row.relation as Exclude<FamilyHistoryRowDraft['relation'], ''>,
        icd10Code: row.icd10Code,
        ageOfOnsetYears: row.ageOfOnsetYears.trim() === '' ? undefined : Number(row.ageOfOnsetYears),
      })),
    relativeFullName: orUndefined(values.relativeFullName),
    relativeRelationship: orUndefined(values.relativeRelationship),
    relativePhone: orUndefined(values.relativePhone),
    relativeAddress: orUndefined(values.relativeAddress),
  };
}

export function toUpdatePatientRequest(values: PatientFormValues, version: number): UpdatePatientRequest {
  return { ...toCreatePatientRequest(values), version };
}

/** Khoá tạm cho React key/thao tác xoá dòng khi CHỈNH SỬA — KHÔNG gửi lên server (xem `toCreatePatientRequest`). */
function makeDraftId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `draft-${Math.random().toString(36).slice(2)}`;
}

/**
 * Chuyển `PatientDetail` (dữ liệu server, dùng chung cả `ReceptionIntakeForm.tsx` — trùng lặp lần 2
 * so với bản cục bộ cũ ở đó, gộp lại theo CLAUDE.md) sang `PatientFormValues` để hiển thị/sửa.
 */
export function patientDetailToFormValues(detail: PatientDetail): PatientFormValues {
  return {
    ...EMPTY_PATIENT_FORM,
    fullName: detail.fullName,
    dob: detail.dob,
    gender: detail.gender,
    phone: detail.phone,
    nationalId: detail.nationalId ?? '',
    nationalIdIssuedAt: detail.nationalIdIssuedAt ?? '',
    nationalIdIssuedPlace: detail.nationalIdIssuedPlace ?? '',
    ethnicity: detail.ethnicity ?? '',
    nationality: detail.nationality ?? '',
    occupation: detail.occupation ?? '',
    insuranceNumber: detail.insuranceNumber ?? '',
    street: detail.address?.street ?? '',
    ward: detail.address?.ward ?? '',
    neighborhood: detail.address?.neighborhood ?? '',
    province: detail.address?.province ?? '',
    allergenIds: detail.allergens.map((a) => a.id),
    personalHistory: detail.personalHistory ?? '',
    conditions: detail.conditions.map((c) => ({ icd10Code: c.icd10Code, icd10Name: c.icd10Name })),
    familyHistoryRows: detail.familyHistoryRows.map((row) => ({
      draftId: makeDraftId(),
      relation: row.relation,
      icd10Code: row.icd10Code,
      icd10Name: row.icd10Name,
      ageOfOnsetYears: row.ageOfOnsetYears === null ? '' : String(row.ageOfOnsetYears),
    })),
    relativeFullName: detail.relativeFullName ?? '',
    relativeRelationship: detail.relativeRelationship ?? '',
    relativePhone: detail.relativePhone ?? '',
    relativeAddress: detail.relativeAddress ?? '',
  };
}

/**
 * Cảnh báo nguy cơ di truyền — CHUNG CHUNG, KHÔNG số liệu % (đã hỏi và chốt với chủ dự án, mockup
 * chỉ minh hoạ số liệu chưa qua thẩm định y khoa). Quy tắc: ≥2 dòng cùng `icd10Code` → liệt kê
 * đúng người thân + tên bệnh. Dùng chung cho pill tóm tắt (`PatientFormFields.tsx`) và banner trong
 * `PatientHistoryDialog.tsx` — tránh viết lại logic đếm 2 nơi.
 */
export function findRepeatedFamilyConditions(rows: FamilyHistoryRowDraft[]): { icd10Code: string; icd10Name: string; relationLabels: string[] }[] {
  const byCode = new Map<string, { icd10Name: string; relationLabels: string[] }>();
  for (const row of rows) {
    if (row.icd10Code === '' || row.relation === '') continue;
    const entry = byCode.get(row.icd10Code) ?? { icd10Name: row.icd10Name, relationLabels: [] };
    entry.relationLabels.push(FAMILY_RELATION_LABELS[row.relation]);
    byCode.set(row.icd10Code, entry);
  }
  return [...byCode.entries()]
    .filter(([, v]) => v.relationLabels.length >= 2)
    .map(([icd10Code, v]) => ({ icd10Code, icd10Name: v.icd10Name, relationLabels: v.relationLabels }));
}

/** Năm sinh — bóc tách từ `dob` (`YYYY-MM-DD`), rỗng nếu chưa nhập. */
export function computeBirthYear(dob: string): string {
  return dob.slice(0, 4);
}

/**
 * Tuổi hiển thị — `>= 3 tuổi` hiện "X tuổi", `< 3 tuổi` hiện "X tháng tuổi" (yêu cầu chủ dự án).
 * Tính theo tháng tròn trước, quy đổi ra năm khi đủ ngưỡng — tránh sai lệch quanh ranh giới ngày
 * trong tháng (ví dụ sinh 31/1, hôm nay 1/3 → chưa đủ 1 tháng tròn).
 */
export function computeAgeLabel(dob: string): string {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return '';
  const now = new Date();

  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return '';

  const years = Math.floor(months / 12);
  return years >= 3 ? `${years} tuổi` : `${months} tháng tuổi`;
}

/**
 * Địa chỉ 1 dòng cho màn hình danh sách (docs/DECISIONS.md #034) — bỏ qua `district` (không còn
 * nhập, xem `toAddress`), rỗng nếu chưa có địa chỉ nào. `province`/`ward` lưu **mã** (không lưu
 * tên, docs/DECISIONS.md #038, giống ethnicity/nationality ở #037) nên cần bảng tra code→tên
 * (`provinceNameByCode`/`wardNameByCode`, xem `PatientListPage.tsx`) để hiển thị đúng tên thay vì
 * mã thô; không tra được (hồ sơ cũ lưu text tự do trước #038, hoặc chưa tải xong danh mục) thì
 * hiện nguyên giá trị đang có — không mất thông tin.
 */
export function formatAddressLine(
  address: PatientAddress | null,
  provinceNameByCode: Record<string, string> = {},
  wardNameByCode: Record<string, string> = {},
): string {
  if (!address) return '';
  const province = address.province ? (provinceNameByCode[address.province] ?? address.province) : undefined;
  const ward = address.ward ? (wardNameByCode[address.ward] ?? address.ward) : undefined;
  return [address.street, address.neighborhood, ward, province].filter(Boolean).join(', ');
}

/**
 * Trùng logic với `calculateAgeYears` ở `packages/shared/src/patient.ts` (nguồn sự thật cho
 * ràng buộc server-side, docs/DECISIONS.md #035) — cố ý KHÔNG import từ `@nexamed/shared` ở đây.
 * `packages/shared` build ra CommonJS, barrel `index.ts` dùng `export *` (biên dịch thành
 * `__exportStar`, một vòng lặp gán runtime) — Rollup (`vite build`) không dò tĩnh được named
 * export đi qua kiểu re-export này, lỗi build "X is not exported by .../dist/index.js" dù Node
 * `require()` thấy đúng (đã gặp y hệt với 1 hằng số ở #032, giờ lặp lại với hàm này). Đây là hàm
 * thuần rất nhỏ, ổn định (chỉ số học ngày tháng) — chấp nhận trùng thay vì đổi kiến trúc build.
 */
export function calculateAgeYears(dob: string, now: Date = new Date()): number {
  const birth = new Date(dob);
  let age = now.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}
