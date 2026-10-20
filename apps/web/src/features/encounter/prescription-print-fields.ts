import type { PrescriptionInfoConfig, PrescriptionPrintInfo } from '@nexamed/shared';

/**
 * Bật hết — khớp `DEFAULT_PRESCRIPTION_INFO_CONFIG` của `@nexamed/shared` (web chỉ import được KIỂU từ shared, #032; `prescription-print-fields.spec.ts` kiểm hai bản không lệch).
 * Máy chủ luôn điền khối này cho bản mẫu Đơn thuốc; hằng này chỉ dùng khi bản mẫu chưa nạp xong lúc in.
 */
export const ALL_ON_PRESCRIPTION_INFO: PrescriptionInfoConfig = {
  showPatientCode: true,
  showNationalId: true,
  nationalIdWhenMissing: 'hide',
  showAddress: true,
  showPhone: true,
  showWeight: true,
  showGuardian: true,
  showCourse: true,
  showQuantityInWords: true,
  showReceiverBox: true,
};

/** Trẻ DƯỚI 72 tháng tuổi phải ghi người giám hộ (Thông tư 52/2017/TT-BYT). */
export const GUARDIAN_AGE_LIMIT_MONTHS = 72;

/** Một ô thông tin: có giá trị, hoặc dòng chấm để viết tay, hoặc ẩn hẳn. */
export type PrintField = { mode: 'value'; value: string } | { mode: 'dots' } | { mode: 'hidden' };

export interface PrescriptionPrintFields {
  patientCode: PrintField;
  nationalId: PrintField;
  phone: PrintField;
  weight: PrintField;
  address: PrintField;
  /** `null` = không in dòng người giám hộ; `name`/`relationship` rỗng → in dòng chấm. */
  guardian: { name: string | null; relationship: string | null } | null;
  /** "Đợt từ ngày … đến hết ngày …" — chỉ đơn N. */
  course: boolean;
  /** Số lượng viết bằng chữ — chỉ đơn N. */
  quantityInWords: boolean;
  /** Ô người nhận thuốc — đơn N và H. */
  receiverBox: boolean;
}

const VALUE = (value: string | null | undefined): PrintField => (value && value.trim() !== '' ? { mode: 'value', value: value.trim() } : { mode: 'hidden' });

/** "54 kg", "56,5 kg" — gram → kg, dấu phẩy thập phân kiểu Việt. */
export function formatWeightKg(weightGram: number): string {
  const kg = Math.round(weightGram / 10) / 100;
  return `${String(kg).replace('.', ',')} kg`;
}

/**
 * Quyết định MỤC NÀO in trên đơn thuốc (mockup "Mẫu in đơn thuốc" 20/10/2026, docs/DECISIONS.md #242). Thuần — nhận cấu hình bản mẫu, loại đơn (`null` = đơn in kiểu cũ, chưa tách
 * loại) và thông tin bệnh nhân (`null` = chưa nạp/không lấy được) rồi trả từng ô ở dạng "có giá trị / dòng chấm / ẩn".
 */
export function resolvePrescriptionPrintFields(args: {
  config: PrescriptionInfoConfig;
  kind: 'C' | 'N' | 'H' | 'Y' | null;
  printInfo: PrescriptionPrintInfo | null;
  /** Địa chỉ đã ghép thành dòng chữ (cần danh mục tỉnh/phường nên ghép ở nơi gọi). */
  addressLine: string;
}): PrescriptionPrintFields {
  const { config, kind, printInfo, addressLine } = args;
  const nationalId: PrintField = !config.showNationalId
    ? { mode: 'hidden' }
    : printInfo?.nationalId
      ? { mode: 'value', value: printInfo.nationalId }
      : config.nationalIdWhenMissing === 'dots'
        ? { mode: 'dots' }
        : { mode: 'hidden' };
  const weight: PrintField = !config.showWeight ? { mode: 'hidden' } : printInfo?.weightGram ? { mode: 'value', value: formatWeightKg(printInfo.weightGram) } : { mode: 'dots' };
  return {
    patientCode: config.showPatientCode ? VALUE(printInfo?.patientCode) : { mode: 'hidden' },
    nationalId,
    phone: config.showPhone ? VALUE(printInfo?.phone) : { mode: 'hidden' },
    weight,
    address: config.showAddress ? VALUE(addressLine) : { mode: 'hidden' },
    guardian:
      config.showGuardian && printInfo !== null && printInfo.ageMonths < GUARDIAN_AGE_LIMIT_MONTHS
        ? { name: printInfo.guardian?.fullName ?? null, relationship: printInfo.guardian?.relationship ?? null }
        : null,
    course: config.showCourse && kind === 'N',
    quantityInWords: config.showQuantityInWords && kind === 'N',
    receiverBox: config.showReceiverBox && (kind === 'N' || kind === 'H'),
  };
}
