import type { ClinicalOrderListRow } from '@nexamed/shared';
import { formatDateStringVi } from '../encounter/follow-up-date';

/** Ngày sinh + giới tính của bệnh nhân ở dạng chữ cho bản in phiếu chỉ định (`ClinicalOrderPrintView` nhận chuỗi đã định dạng). */
export function printPatientInfo(row: Pick<ClinicalOrderListRow, 'patientDob' | 'patientGender' | 'primaryDiagnosis'>): { dob: string; gender: string; diagnosisLabel: string | undefined } {
  return {
    dob: formatDateStringVi(row.patientDob),
    gender: row.patientGender === 'male' ? 'Nam' : row.patientGender === 'female' ? 'Nữ' : 'Khác',
    diagnosisLabel: row.primaryDiagnosis ? `${row.primaryDiagnosis.code} — ${row.primaryDiagnosis.name}` : undefined,
  };
}
