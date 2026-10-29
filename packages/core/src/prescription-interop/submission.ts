import type { PrescriptionKind } from '@nexamed/shared';

/**
 * Dựng gói `POST /api/v1/gui-don-thuoc` của cổng Đơn thuốc quốc gia (Quyết định 808/QĐ-BYT, mục VII — `docs/product/references/qd-808-donthuocquocgia-api.md`) và kiểm dữ liệu trước khi gửi
 * (docs/DECISIONS.md #242 GĐ3, mockup 8a). Hàm THUẦN: nhận dữ liệu đã gom sẵn, không đọc DB/đồng hồ.
 *
 * Tên trường và kiểu theo ĐÚNG tài liệu; chỗ tài liệu không nhất quán/chưa rõ được ghi `HỎI ĐƠN VỊ VẬN HÀNH` ngay tại chỗ và ở `docs/product/prescription-interop-questions.md`:
 * tên trường chẩn đoán (`ma_chan_doan` theo ví dụ, bảng mô tả ghi `ma_benh`), khuôn `dot_dung_thuoc`, định dạng `thong_tin_nguoi_giam_ho`, chữ hoa/thường mã đơn, `signature` (chưa có chữ ký số).
 */
export interface InteropItemInput {
  /** Dòng kê tự do (không có thuốc trong danh mục) — KHÔNG gửi được vì thiếu mã thuốc quốc gia. */
  isFreeText: boolean;
  drugName: string;
  /** Mã thuốc quốc gia 20 ký tự (`drug.national_code`); `null` = chưa khai. */
  drugNationalCode: string | null;
  activeIngredient: string | null;
  /** Tên đơn vị tính ("Viên"), không phải mã. */
  unitName: string | null;
  quantity: number;
  /** Liều theo buổi đã định dạng ("Sáng 1 - Tối 1"). */
  doseSummary: string;
  /** `null` khi dòng kiểu "Khi cần" (#267) — không có số ngày, cách dùng chỉ gồm liều mỗi lần + hướng dẫn. */
  durationDays: number | null;
  instruction: string | null;
}

export interface InteropSubmissionInput {
  kind: PrescriptionKind;
  /** Mã đơn chuẩn 14 ký tự `xxxxxyyyyyyy-Z` (chữ hoa như lưu trong hệ thống). */
  nationalCode: string;
  /** Thời điểm ký đơn (UTC). */
  prescribedAt: Date;
  patient: {
    fullName: string;
    /** `YYYY-MM-DD`. */
    dob: string;
    gender: 'male' | 'female' | 'other';
    phone: string | null;
    nationalId: string | null;
    insuranceNumber: string | null;
    /** Địa chỉ đã ghép chữ (đường, phường/xã, tỉnh/thành). */
    address: string | null;
    weightGram: number | null;
    ageMonths: number;
    /** Người thân/giám hộ từ hồ sơ bệnh nhân. */
    guardian: { fullName: string | null; phone: string | null; address: string | null };
  };
  diagnoses: { code: string; name: string; note: string | null }[];
  /** Kết luận của bác sĩ (ghi chú lâm sàng) — dùng làm `ket_luan` khi chẩn đoán không có ghi chú riêng. */
  conclusion: string | null;
  doctorLicenseNo: string | null;
  /** Lời dặn riêng của đơn. */
  doctorAdvice: string | null;
  /** Số ngày từ ngày kê đến ngày tái khám; `null` = không hẹn. */
  followUpDays: number | null;
  /** Hình thức điều trị (mã số của Bộ Y tế) — đơn loại C. */
  treatmentFormCode: string | null;
  /** Đợt dùng thuốc — đơn N/H/Y. */
  dosePeriod: { number: number | null; from: string | null; to: string | null } | null;
  /** Số thang thuốc — đơn Y. */
  herbalDoses: number | null;
  /** Cách sắc thuốc, cách uống — đơn Y. */
  herbalInstruction: string | null;
  items: InteropItemInput[];
}

export type InteropProblemCode =
  | 'ITEMS_EMPTY'
  | 'DRUG_NATIONAL_CODE_MISSING'
  | 'DRUG_NATIONAL_CODE_INVALID'
  | 'UNIT_MISSING'
  | 'TREATMENT_FORM_MISSING'
  | 'DOSE_PERIOD_MISSING'
  | 'DOSE_PERIOD_INVALID'
  | 'HERBAL_DOSES_MISSING'
  | 'GUARDIAN_MISSING'
  | 'PATIENT_ADDRESS_MISSING'
  | 'DIAGNOSIS_MISSING'
  | 'DOCTOR_LICENSE_MISSING';

export interface InteropProblem {
  code: InteropProblemCode;
  kind: PrescriptionKind;
  /** Câu hiển thị (tiếng Việt), đã gồm tên thuốc/trường cụ thể. */
  message: string;
  /** `true` = thiếu thì cổng sẽ từ chối (không gửi được); `false` = chỉ là nhắc, không chặn gửi (ví dụ chứng chỉ hành nghề — không có trong gói). */
  required: boolean;
}

/** Mã thuốc quốc gia: 20 ký tự (tài liệu: "Chuỗi ký tự, 20 ký tự", bắt buộc mỗi dòng). */
export const INTEROP_DRUG_CODE_LENGTH = 20;
/** Ngưỡng tuổi bắt buộc người giám hộ: DƯỚI 72 tháng (tài liệu ghi "hơn 72 tháng", chữ có vẻ lỗi — HỎI ĐƠN VỊ VẬN HÀNH). */
export const INTEROP_GUARDIAN_AGE_MONTHS = 72;

const KIND_LABEL: Record<PrescriptionKind, string> = { C: 'C', N: 'N', H: 'H', Y: 'Y' };
const present = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim() !== '';

function dayDiff(fromIso: string, toIso: string): number {
  return Math.round((Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10)) - Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10))) / 86_400_000);
}

/** Kiểm dữ liệu một đơn pháp lý trước khi gửi (8a). Không ném lỗi; trả danh sách vấn đề (rỗng = đủ). */
export function checkInteropReadiness(input: InteropSubmissionInput): InteropProblem[] {
  const problems: InteropProblem[] = [];
  const add = (code: InteropProblemCode, message: string, required = true) => problems.push({ code, kind: input.kind, message, required });
  const kind = KIND_LABEL[input.kind];

  if (input.items.length === 0) add('ITEMS_EMPTY', 'Đơn không có thuốc nào.');
  const noCode = input.items.filter((i) => !i.isFreeText && !present(i.drugNationalCode));
  const freeText = input.items.filter((i) => i.isFreeText);
  if (noCode.length > 0) add('DRUG_NATIONAL_CODE_MISSING', `Thiếu mã thuốc quốc gia: ${noCode.map((i) => i.drugName).join(', ')}`);
  if (freeText.length > 0) add('DRUG_NATIONAL_CODE_MISSING', `Thiếu mã thuốc quốc gia: ${freeText.map((i) => i.drugName).join(', ')} (kê tự do, không gửi được)`);
  const badCode = input.items.filter((i) => present(i.drugNationalCode) && i.drugNationalCode!.trim().length !== INTEROP_DRUG_CODE_LENGTH);
  if (badCode.length > 0) add('DRUG_NATIONAL_CODE_INVALID', `Mã thuốc quốc gia phải đủ ${INTEROP_DRUG_CODE_LENGTH} ký tự: ${badCode.map((i) => i.drugName).join(', ')}`);
  const noUnit = input.items.filter((i) => !present(i.unitName));
  if (noUnit.length > 0) add('UNIT_MISSING', `Thiếu đơn vị tính: ${noUnit.map((i) => i.drugName).join(', ')}`);

  if (input.kind === 'C' && !present(input.treatmentFormCode)) add('TREATMENT_FORM_MISSING', 'Thiếu hình thức điều trị (bắt buộc với đơn loại C).');
  if (input.kind !== 'C') {
    const p = input.dosePeriod;
    if (!p || p.number === null || !present(p.from) || !present(p.to)) {
      add('DOSE_PERIOD_MISSING', `Thiếu đợt dùng thuốc: đợt, từ ngày, đến ngày (bắt buộc với đơn ${kind}).`);
    } else if (p.to < p.from) {
      add('DOSE_PERIOD_INVALID', 'Đợt dùng thuốc có "đến ngày" trước "từ ngày".');
    }
  }
  if (input.kind === 'Y' && (input.herbalDoses === null || input.herbalDoses <= 0)) add('HERBAL_DOSES_MISSING', 'Thiếu số thang thuốc (bắt buộc với đơn Y).');

  if (!present(input.patient.address)) add('PATIENT_ADDRESS_MISSING', 'Bệnh nhân chưa có địa chỉ (cổng bắt buộc).');
  if (input.diagnoses.length === 0) add('DIAGNOSIS_MISSING', 'Thiếu chẩn đoán (cổng bắt buộc).');
  if (input.patient.ageMonths < INTEROP_GUARDIAN_AGE_MONTHS) {
    const g = input.patient.guardian;
    const missing = [!present(g.fullName) && 'họ tên', !present(g.phone) && 'số điện thoại', !present(g.address) && 'địa chỉ'].filter((x): x is string => x !== false);
    if (missing.length > 0) add('GUARDIAN_MISSING', `Bệnh nhân dưới ${INTEROP_GUARDIAN_AGE_MONTHS} tháng tuổi chưa đủ thông tin người giám hộ: thiếu ${missing.join(', ')}.`);
  }
  // Không nằm trong gói gửi → chỉ nhắc, không chặn (mockup 8a).
  if (!present(input.doctorLicenseNo)) add('DOCTOR_LICENSE_MISSING', 'Bác sĩ chưa có chứng chỉ hành nghề.', false);
  return problems;
}

/** Vấn đề CHẶN gửi (cổng sẽ từ chối). */
export function blockingInteropProblems(problems: InteropProblem[]): InteropProblem[] {
  return problems.filter((p) => p.required);
}

// ---- Gói gửi ----

export interface GuiDonThuocPayload {
  loai_don_thuoc: 'c' | 'n' | 'h' | 'y';
  ma_don_thuoc: string;
  ho_ten_benh_nhan: string;
  ngay_sinh_benh_nhan: string;
  ma_dinh_danh_cong_dan?: string;
  can_nang?: number;
  gioi_tinh: 1 | 2 | 3;
  ma_so_the_bao_hiem_y_te?: string;
  thong_tin_nguoi_giam_ho?: string;
  dia_chi: string;
  chan_doan: { ma_chan_doan: string; ten_chan_doan: string; ket_luan: string }[];
  luu_y?: string;
  hinh_thuc_dieu_tri?: number;
  dot_dung_thuoc?: { dot: number; tu_ngay: string; den_ngay: string; so_thang_thuoc?: number }[];
  thong_tin_don_thuoc: { ma_thuoc: string; biet_duoc: string; ten_thuoc: string; don_vi_tinh: string; so_luong: number; cach_dung: string }[];
  loi_dan?: string;
  so_dien_thoai_nguoi_kham_benh?: string;
  ngay_tai_kham?: number;
  ngay_gio_ke_don: string;
}

/** Giới hạn độ dài theo tài liệu (mục VII bảng 3). */
const LIMITS = { name: 500, address: 500, guardian: 500, note: 2000, advice: 2000, usage: 500, drugText: 500 } as const;

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** `YYYY-MM-DD` → `d/m/Y` (tài liệu: Date format d/m/Y — ví dụ 05/03/2026). */
export function toGatewayDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Thời điểm UTC → `Y-m-d H:i:s` theo giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export function toGatewayDateTime(at: Date): string {
  const vn = new Date(at.getTime() + 7 * 3_600_000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${vn.getUTCFullYear()}-${p(vn.getUTCMonth() + 1)}-${p(vn.getUTCDate())} ${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}:${p(vn.getUTCSeconds())}`;
}

/** Ngày (YYYY-MM-DD, giờ Việt Nam) của một thời điểm UTC. */
export function vietnamDateOf(at: Date): string {
  return toGatewayDateTime(at).slice(0, 10);
}

/** Giới tính: 1 chưa có thông tin, 2 nam, 3 nữ (tài liệu). */
export function toGatewayGender(gender: 'male' | 'female' | 'other'): 1 | 2 | 3 {
  return gender === 'male' ? 2 : gender === 'female' ? 3 : 1;
}

/**
 * Dựng gói gửi. KHÔNG kiểm đủ/thiếu (dùng `checkInteropReadiness`); trường tuỳ chọn thiếu/sai định dạng thì BỎ khỏi gói thay vì gửi giá trị chắc chắn bị từ chối (CCCD phải đúng 12 số, mã thẻ BHYT
 * chỉ gửi thẻ MỚI 12 chữ số — chủ dự án chốt 21/10/2026, #243; thẻ CŨ 15 ký tự bị bỏ vì chưa biết cổng nhận thế nào, và tài liệu QĐ 808 ghi 10 ký tự nên PHẢI xác nhận độ dài với đơn vị vận hành
 * trước khi gửi thật; số điện thoại tối đa 12 số). `signature` (chữ ký số) KHÔNG có vì chưa triển khai.
 */
export function buildGuiDonThuocPayload(input: InteropSubmissionInput): GuiDonThuocPayload {
  const p = input.patient;
  const isChild = p.ageMonths < INTEROP_GUARDIAN_AGE_MONTHS;
  const g = p.guardian;
  const guardianText = [g.fullName, g.phone, g.address].filter(present).map((s) => s.trim()).join(', ');
  const phoneDigits = (p.phone ?? '').replace(/\D/g, '');
  const advice = present(input.doctorAdvice) ? input.doctorAdvice.trim() : '';
  const herbal = input.kind === 'Y' && present(input.herbalInstruction) ? input.herbalInstruction.trim() : '';
  const lifestyle = [advice, herbal].filter((s) => s !== '').join('\n');
  const conclusion = present(input.conclusion) ? input.conclusion.trim() : '';

  const payload: GuiDonThuocPayload = {
    loai_don_thuoc: input.kind.toLowerCase() as GuiDonThuocPayload['loai_don_thuoc'],
    ma_don_thuoc: input.nationalCode,
    ho_ten_benh_nhan: clip(p.fullName.trim(), LIMITS.name),
    ngay_sinh_benh_nhan: toGatewayDate(p.dob),
    gioi_tinh: toGatewayGender(p.gender),
    dia_chi: clip((p.address ?? '').trim(), LIMITS.address),
    // HỎI ĐƠN VỊ VẬN HÀNH: ví dụ dùng `ma_chan_doan`, bảng mô tả ghi `ma_benh` — theo ví dụ.
    chan_doan: input.diagnoses.map((d) => ({ ma_chan_doan: d.code, ten_chan_doan: d.name, ket_luan: present(d.note) ? d.note.trim() : conclusion })),
    thong_tin_don_thuoc: input.items.map((i) => ({
      ma_thuoc: (i.drugNationalCode ?? '').trim(),
      // Đơn Y: biệt dược = tên dược liệu, vị thuốc; còn lại là hoạt chất chính (thiếu thì lấy tên thuốc).
      biet_duoc: clip(input.kind === 'Y' ? i.drugName : (present(i.activeIngredient) ? i.activeIngredient : i.drugName), LIMITS.drugText),
      ten_thuoc: clip(i.drugName, LIMITS.drugText),
      don_vi_tinh: clip(i.unitName ?? '', LIMITS.drugText),
      so_luong: i.quantity,
      cach_dung: clip([i.doseSummary, i.durationDays === null ? '' : `${i.durationDays} ngày`, present(i.instruction) ? i.instruction.trim() : ''].filter((s) => s !== '').join(', '), LIMITS.usage),
    })),
    ngay_gio_ke_don: toGatewayDateTime(input.prescribedAt),
  };

  if (/^\d{12}$/.test((p.nationalId ?? '').trim())) payload.ma_dinh_danh_cong_dan = p.nationalId!.trim();
  if (p.weightGram !== null && p.weightGram > 0) payload.can_nang = Math.round(p.weightGram) / 1000;
  if (/^\d{12}$/.test((p.insuranceNumber ?? '').trim())) payload.ma_so_the_bao_hiem_y_te = p.insuranceNumber!.trim();
  if (isChild && guardianText !== '') payload.thong_tin_nguoi_giam_ho = clip(guardianText, LIMITS.guardian);
  if (lifestyle !== '') {
    payload.luu_y = clip(advice !== '' ? advice : lifestyle, LIMITS.note);
    payload.loi_dan = clip(lifestyle, LIMITS.advice);
  }
  if (input.kind === 'C' && present(input.treatmentFormCode) && /^\d+$/.test(input.treatmentFormCode.trim())) payload.hinh_thuc_dieu_tri = Number(input.treatmentFormCode.trim());
  if (input.kind !== 'C' && input.dosePeriod && input.dosePeriod.number !== null && present(input.dosePeriod.from) && present(input.dosePeriod.to)) {
    // HỎI ĐƠN VỊ VẬN HÀNH: tên trường trong từng đợt (tài liệu chỉ nêu: Đợt, từ ngày, đến ngày, số thang thuốc).
    payload.dot_dung_thuoc = [
      {
        dot: input.dosePeriod.number,
        tu_ngay: toGatewayDate(input.dosePeriod.from),
        den_ngay: toGatewayDate(input.dosePeriod.to),
        ...(input.kind === 'Y' && input.herbalDoses !== null && input.herbalDoses > 0 ? { so_thang_thuoc: input.herbalDoses } : {}),
      },
    ];
  }
  if (phoneDigits.length >= 8 && phoneDigits.length <= 12) payload.so_dien_thoai_nguoi_kham_benh = phoneDigits;
  if (input.followUpDays !== null && input.followUpDays >= 0) payload.ngay_tai_kham = input.followUpDays;
  return payload;
}

/** Số ngày từ ngày kê (giờ Việt Nam) tới ngày hẹn tái khám (`YYYY-MM-DD`); `null` nếu không hẹn hoặc hẹn trước ngày kê. */
export function computeFollowUpDays(prescribedAt: Date, followUpDate: string | null): number | null {
  if (!followUpDate) return null;
  const days = dayDiff(vietnamDateOf(prescribedAt), followUpDate);
  return days >= 0 ? days : null;
}
