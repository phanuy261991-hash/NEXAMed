import type { PatientGender } from '@nexamed/shared';

/** Form state phẳng (địa chỉ không lồng) — quy đổi sang/từ payload API ở nơi gọi (New/Edit page). */
export interface PatientFormValues {
  fullName: string;
  dob: string;
  gender: PatientGender;
  phone: string;
  nationalId: string;
  street: string;
  ward: string;
  district: string;
  province: string;
  allergyNote: string;
}

export const EMPTY_PATIENT_FORM: PatientFormValues = {
  fullName: '',
  dob: '',
  gender: 'female',
  phone: '',
  nationalId: '',
  street: '',
  ward: '',
  district: '',
  province: '',
  allergyNote: '',
};

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const labelClassName = 'mb-1 block text-sm font-medium text-slate-700';

/**
 * Form nhập liệu hồ sơ bệnh nhân — dùng chung cho tạo mới (PatientNewPage) và sửa tại chỗ
 * (PatientDetailPage, không modal — đã chốt với chủ dự án). Bố cục lưới 2 cột theo
 * .claude/docs/ui-guidelines.md mục 4.1: trường bắt buộc có dấu `*` đỏ, textarea kéo full-width.
 */
export function PatientFormFields({
  values,
  onChange,
  disabled = false,
}: {
  values: PatientFormValues;
  onChange: (values: PatientFormValues) => void;
  disabled?: boolean;
}) {
  function set<K extends keyof PatientFormValues>(key: K, value: PatientFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div>
        <label className={labelClassName} htmlFor="fullName">
          Họ tên <span className="text-rose-500">*</span>
        </label>
        <input
          id="fullName"
          required
          disabled={disabled}
          value={values.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          className={inputClassName}
        />
      </div>

      <div>
        <label className={labelClassName} htmlFor="dob">
          Ngày sinh <span className="text-rose-500">*</span>
        </label>
        <input
          id="dob"
          type="date"
          required
          disabled={disabled}
          value={values.dob}
          onChange={(e) => set('dob', e.target.value)}
          className={inputClassName}
        />
      </div>

      <div>
        <label className={labelClassName} htmlFor="gender">
          Giới tính <span className="text-rose-500">*</span>
        </label>
        <select
          id="gender"
          required
          disabled={disabled}
          value={values.gender}
          onChange={(e) => set('gender', e.target.value as PatientGender)}
          className={inputClassName}
        >
          <option value="female">Nữ</option>
          <option value="male">Nam</option>
          <option value="other">Khác</option>
        </select>
      </div>

      <div>
        <label className={labelClassName} htmlFor="phone">
          Số điện thoại <span className="text-rose-500">*</span>
        </label>
        <input
          id="phone"
          type="tel"
          required
          disabled={disabled}
          value={values.phone}
          onChange={(e) => set('phone', e.target.value)}
          className={inputClassName}
        />
      </div>

      <div>
        <label className={labelClassName} htmlFor="nationalId">
          CCCD/CMND
        </label>
        <input
          id="nationalId"
          disabled={disabled}
          value={values.nationalId}
          onChange={(e) => set('nationalId', e.target.value)}
          className={inputClassName}
          placeholder="Để trống nếu chưa có giấy tờ"
        />
      </div>

      <div>
        <label className={labelClassName} htmlFor="province">
          Tỉnh/Thành phố
        </label>
        <input
          id="province"
          disabled={disabled}
          value={values.province}
          onChange={(e) => set('province', e.target.value)}
          className={inputClassName}
        />
      </div>

      <div>
        <label className={labelClassName} htmlFor="district">
          Quận/Huyện
        </label>
        <input
          id="district"
          disabled={disabled}
          value={values.district}
          onChange={(e) => set('district', e.target.value)}
          className={inputClassName}
        />
      </div>

      <div>
        <label className={labelClassName} htmlFor="ward">
          Phường/Xã
        </label>
        <input
          id="ward"
          disabled={disabled}
          value={values.ward}
          onChange={(e) => set('ward', e.target.value)}
          className={inputClassName}
        />
      </div>

      <div className="md:col-span-2">
        <label className={labelClassName} htmlFor="street">
          Số nhà, đường
        </label>
        <input
          id="street"
          disabled={disabled}
          value={values.street}
          onChange={(e) => set('street', e.target.value)}
          className={inputClassName}
        />
      </div>

      <div className="md:col-span-2">
        <label className={labelClassName} htmlFor="allergyNote">
          Ghi chú dị ứng
        </label>
        <textarea
          id="allergyNote"
          rows={3}
          disabled={disabled}
          value={values.allergyNote}
          onChange={(e) => set('allergyNote', e.target.value)}
          className={inputClassName}
        />
      </div>
    </div>
  );
}
