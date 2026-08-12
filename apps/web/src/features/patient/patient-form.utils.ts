import type { CreatePatientRequest, PatientDetail, UpdatePatientRequest } from '@nexamed/shared';
import { EMPTY_PATIENT_FORM, type PatientFormValues } from './PatientFormFields';

/** Chuỗi rỗng → không gửi field (undefined) — khớp field optional của schema dùng chung. */
function orUndefined(value: string): string | undefined {
  return value.trim() === '' ? undefined : value;
}

function toAddress(values: PatientFormValues): CreatePatientRequest['address'] {
  const address = {
    street: orUndefined(values.street),
    ward: orUndefined(values.ward),
    district: orUndefined(values.district),
    province: orUndefined(values.province),
  };
  const hasAnyField = Object.values(address).some((v) => v !== undefined);
  return hasAnyField ? address : undefined;
}

export function toCreatePatientRequest(values: PatientFormValues): CreatePatientRequest {
  return {
    fullName: values.fullName,
    dob: values.dob,
    gender: values.gender,
    phone: values.phone,
    nationalId: orUndefined(values.nationalId),
    address: toAddress(values),
    allergyNote: orUndefined(values.allergyNote),
  };
}

export function toUpdatePatientRequest(values: PatientFormValues, version: number): UpdatePatientRequest {
  return { ...toCreatePatientRequest(values), version };
}

export function patientDetailToFormValues(detail: PatientDetail): PatientFormValues {
  return {
    ...EMPTY_PATIENT_FORM,
    fullName: detail.fullName,
    dob: detail.dob,
    gender: detail.gender,
    phone: detail.phone,
    nationalId: detail.nationalId ?? '',
    street: detail.address?.street ?? '',
    ward: detail.address?.ward ?? '',
    district: detail.address?.district ?? '',
    province: detail.address?.province ?? '',
    allergyNote: detail.allergyNote ?? '',
  };
}
