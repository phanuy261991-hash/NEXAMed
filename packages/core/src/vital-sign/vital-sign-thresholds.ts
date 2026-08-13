/**
 * Ngưỡng cảnh báo sinh hiệu ngoài giới hạn sinh lý (REC-03) — theo nhóm tuổi, xem
 * docs/DECISIONS.md (entry Tiếp nhận, Sprint 3). Các khoảng dưới đây là ngưỡng tham khảo phổ biến
 * kiểu bảng sinh hiệu theo tuổi (cùng tinh thần các biểu đồ APLS/PALS dùng trong đào tạo cấp cứu
 * nhi khoa) — KHÔNG thay thế đánh giá lâm sàng của điều dưỡng/bác sĩ, không cấu hình theo tenant ở
 * v1 (khác ngưỡng no-show đọc từ `tenant_setting`). Luôn chỉ CẢNH BÁO — hàm này không bao giờ
 * quyết định chặn lưu, việc đó là của tầng gọi (`ReceptionService.recordVitalSigns()`).
 *
 * Cân nặng/chiều cao KHÔNG làm theo percentile tăng trưởng (WHO growth chart — bài toán lớn hơn
 * nhiều, ngoài phạm vi v1) — chỉ chặn giá trị phi lý rõ ràng để bắt lỗi nhập nhầm đơn vị
 * (`kind: 'implausible'`, khác `kind: 'out_of_range'` của các chỉ số còn lại).
 */

export type VitalSignAgeBand = 'infant' | 'child' | 'adolescent_adult';

/** <1 tuổi / 1–12 tuổi / ≥13 tuổi — 3 nhóm cho mạch + nhịp thở (biến thiên nhiều nhất theo tuổi). */
export function resolveVitalSignAgeBand(ageYears: number): VitalSignAgeBand {
  if (ageYears < 1) return 'infant';
  if (ageYears < 13) return 'child';
  return 'adolescent_adult';
}

export interface VitalSignMeasurement {
  pulse?: number;
  /** Độ C thập phân (ví dụ 37.5) — đã quy đổi từ `temperature_deci_c` ở tầng gọi. */
  temperatureC?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  respiratoryRate?: number;
  spo2?: number;
  weightGram?: number;
  heightMm?: number;
}

export interface VitalSignWarning {
  field: keyof VitalSignMeasurement;
  kind: 'out_of_range' | 'implausible';
  message: string;
}

interface Range {
  min: number;
  max: number;
}

function outOfRange(value: number, range: Range): boolean {
  return value < range.min || value > range.max;
}

const PULSE_RANGE_BY_BAND: Record<VitalSignAgeBand, Range> = {
  infant: { min: 100, max: 160 },
  child: { min: 70, max: 150 },
  adolescent_adult: { min: 60, max: 100 },
};

const RESPIRATORY_RATE_RANGE_BY_BAND: Record<VitalSignAgeBand, Range> = {
  infant: { min: 30, max: 50 },
  child: { min: 18, max: 30 },
  adolescent_adult: { min: 12, max: 20 },
};

/** Nhiệt độ/SpO2 dùng chung 1 ngưỡng mọi lứa tuổi — đơn giản hoá có chủ đích (docs/DECISIONS.md). */
const TEMPERATURE_RANGE_C: Range = { min: 36.0, max: 39.0 };
const SPO2_MIN_PERCENT = 95;

type BloodPressureAgeBand = 'under_13' | 'from_13';

function resolveBloodPressureAgeBand(ageYears: number): BloodPressureAgeBand {
  return ageYears < 13 ? 'under_13' : 'from_13';
}

/** Huyết áp: 2 nhóm (dưới/từ 13 tuổi) — đơn giản hoá có chủ đích, ngưỡng thật theo percentile tuổi/chiều cao phức tạp hơn nhiều, ngoài phạm vi v1. */
const BP_SYSTOLIC_RANGE_BY_BAND: Record<BloodPressureAgeBand, Range> = {
  under_13: { min: 70, max: 110 },
  from_13: { min: 90, max: 140 },
};
const BP_DIASTOLIC_RANGE_BY_BAND: Record<BloodPressureAgeBand, Range> = {
  under_13: { min: 40, max: 70 },
  from_13: { min: 60, max: 90 },
};

const WEIGHT_GRAM_PLAUSIBLE_RANGE: Range = { min: 500, max: 200_000 };
const HEIGHT_MM_PLAUSIBLE_RANGE: Range = { min: 200, max: 2_500 };

export function evaluateVitalSignWarnings(measurement: VitalSignMeasurement, ageYears: number): VitalSignWarning[] {
  const warnings: VitalSignWarning[] = [];
  const ageBand = resolveVitalSignAgeBand(ageYears);
  const bpBand = resolveBloodPressureAgeBand(ageYears);

  if (measurement.pulse !== undefined) {
    const range = PULSE_RANGE_BY_BAND[ageBand];
    if (outOfRange(measurement.pulse, range)) {
      warnings.push({
        field: 'pulse',
        kind: 'out_of_range',
        message: `Mạch ${measurement.pulse} lần/phút ngoài ngưỡng tham khảo ${range.min}–${range.max} theo tuổi.`,
      });
    }
  }

  if (measurement.respiratoryRate !== undefined) {
    const range = RESPIRATORY_RATE_RANGE_BY_BAND[ageBand];
    if (outOfRange(measurement.respiratoryRate, range)) {
      warnings.push({
        field: 'respiratoryRate',
        kind: 'out_of_range',
        message: `Nhịp thở ${measurement.respiratoryRate} lần/phút ngoài ngưỡng tham khảo ${range.min}–${range.max} theo tuổi.`,
      });
    }
  }

  if (measurement.temperatureC !== undefined && outOfRange(measurement.temperatureC, TEMPERATURE_RANGE_C)) {
    warnings.push({
      field: 'temperatureC',
      kind: 'out_of_range',
      message: `Nhiệt độ ${measurement.temperatureC}°C ngoài ngưỡng tham khảo ${TEMPERATURE_RANGE_C.min}–${TEMPERATURE_RANGE_C.max}°C.`,
    });
  }

  if (measurement.spo2 !== undefined && measurement.spo2 < SPO2_MIN_PERCENT) {
    warnings.push({
      field: 'spo2',
      kind: 'out_of_range',
      message: `SpO2 ${measurement.spo2}% dưới ngưỡng tham khảo ${SPO2_MIN_PERCENT}%.`,
    });
  }

  if (measurement.bpSystolic !== undefined) {
    const range = BP_SYSTOLIC_RANGE_BY_BAND[bpBand];
    if (outOfRange(measurement.bpSystolic, range)) {
      warnings.push({
        field: 'bpSystolic',
        kind: 'out_of_range',
        message: `Huyết áp tâm thu ${measurement.bpSystolic} mmHg ngoài ngưỡng tham khảo ${range.min}–${range.max} theo tuổi.`,
      });
    }
  }

  if (measurement.bpDiastolic !== undefined) {
    const range = BP_DIASTOLIC_RANGE_BY_BAND[bpBand];
    if (outOfRange(measurement.bpDiastolic, range)) {
      warnings.push({
        field: 'bpDiastolic',
        kind: 'out_of_range',
        message: `Huyết áp tâm trương ${measurement.bpDiastolic} mmHg ngoài ngưỡng tham khảo ${range.min}–${range.max} theo tuổi.`,
      });
    }
  }

  if (measurement.weightGram !== undefined && outOfRange(measurement.weightGram, WEIGHT_GRAM_PLAUSIBLE_RANGE)) {
    warnings.push({
      field: 'weightGram',
      kind: 'implausible',
      message: `Cân nặng ${measurement.weightGram}g có vẻ không hợp lý — kiểm tra lại đơn vị đã nhập.`,
    });
  }

  if (measurement.heightMm !== undefined && outOfRange(measurement.heightMm, HEIGHT_MM_PLAUSIBLE_RANGE)) {
    warnings.push({
      field: 'heightMm',
      kind: 'implausible',
      message: `Chiều cao ${measurement.heightMm}mm có vẻ không hợp lý — kiểm tra lại đơn vị đã nhập.`,
    });
  }

  return warnings;
}
