import { useEffect, useState } from 'react';
import { CheckCircle, UserPlus } from '@phosphor-icons/react';
import type { PatientDetail, PatientSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { computeBmi } from '../../shared/format/bmi';
import { Button } from '../../shared/ui/Button';
import { Combobox, withLegacyValueOption } from '../../shared/ui/Combobox';
import { TimeInput } from '../../shared/ui/TimeInput';
import { useDoctorsQuery } from '../appointment/appointment.queries';
import { getVietnamTodayDateString, minutesToLabel, vietnamNowMinutes, vnDateTimeToIso } from '../appointment/schedule-grid.utils';
import { useRoomOptionsQuery } from '../clinic/clinic.queries';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { checkPatientDuplicate } from '../patient/patient.api';
import {
  useCreatePatientMutation,
  usePatientByNationalIdQuery,
  usePatientByPhoneQuery,
  usePatientQuery,
  useUpdatePatientMutation,
} from '../patient/patient.queries';
import { toCreatePatientRequest, toUpdatePatientRequest } from '../patient/patient-form.utils';
import { EMPTY_PATIENT_FORM, PatientFormFields, type PatientFormValues } from '../patient/PatientFormFields';
import { PatientMatchDialog } from '../patient/PatientMatchDialog';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useCheckInMutation, useReceptionListQuery, useRegisterReceptionMutation } from './reception.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const labelClassName = 'mb-1.5 block text-sm font-semibold text-slate-800';
/** Boxed Section Form Pattern — .claude/docs/ui-guidelines.md mục 9b. */
const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-5 pt-7';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';
const sectionBadgeTealClassName =
  'absolute -top-3 left-4 rounded-md bg-brand-teal px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

interface VitalValues {
  pulse: string;
  temperatureC: string;
  bpSystolic: string;
  bpDiastolic: string;
  respiratoryRate: string;
  spo2: string;
  weightKg: string;
  heightCm: string;
}

const EMPTY_VITALS: VitalValues = {
  pulse: '',
  temperatureC: '',
  bpSystolic: '',
  bpDiastolic: '',
  respiratoryRate: '',
  spo2: '',
  weightKg: '',
  heightCm: '',
};

function toNumber(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function VitalField({ id, label, value, onChange, step }: { id: string; label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <div>
      <label className={labelClassName} htmlFor={id}>
        {label}
      </label>
      <input id={id} type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className={inputClassName} />
    </div>
  );
}

export interface ReceptionIntakeCheckinContext {
  appointmentId: string;
  appointmentVersion: number;
  doctorId: string;
  doctorName: string;
  fullName: string;
  phone: string;
  reason?: string;
}

/**
 * Biểu mẫu tiếp nhận DÙNG CHUNG cho cả 2 luồng (`docs/DECISIONS.md` #044, thiết kế lại theo mockup
 * đã duyệt — xem cuộc trò chuyện thiết kế lại "Tiếp nhận bệnh nhân"). Khác bản trước: KHÔNG còn
 * dùng `PatientPicker` (card tóm tắt) — hiện đủ field bệnh nhân ngay từ đầu, gõ SĐT/CCCD tự tra
 * trùng; khớp CCCD (duy nhất trong tenant) thì tự khoá luôn, khớp SĐT (được phép trùng) thì hiện
 * danh sách để chọn đúng người. Sau khi khớp: khoá CCCD/Mã bệnh nhân/Họ tên/Ngày sinh
 * (`PatientFormFields identityLocked`), các field còn lại vẫn sửa được — sửa xong thì PATCH cập
 * nhật hồ sơ gốc lúc lưu (chỉ gọi khi thật sự có thay đổi).
 *
 * `mode='direct'`: trang "Tiếp nhận bệnh nhân" (`/reception/new`), đủ trường ngày giờ/bác sĩ tự
 * chọn. `mode='checkin'`: popup trên panel chi tiết Lịch hẹn — bác sĩ cố định theo lịch hẹn (không
 * cho sửa), NHƯNG ngày/giờ tiếp nhận vẫn sửa được ở cả 2 chế độ (yêu cầu chủ dự án khi duyệt mockup).
 */
export function ReceptionIntakeForm({
  mode,
  checkin,
  onSuccess,
  onCancel,
}: {
  mode: 'direct' | 'checkin';
  checkin?: ReceptionIntakeCheckinContext;
  onSuccess: (encounterNo: string) => void;
  onCancel: () => void;
}) {
  const [formValues, setFormValues] = useState<PatientFormValues>({
    ...EMPTY_PATIENT_FORM,
    fullName: checkin?.fullName ?? '',
    phone: checkin?.phone ?? '',
  });
  const [matchedPatient, setMatchedPatient] = useState<PatientDetail | null>(null);
  const [matchedOriginalValues, setMatchedOriginalValues] = useState<PatientFormValues | null>(null);
  const [pendingMatchId, setPendingMatchId] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<PatientSummary[] | null>(null);
  /** Đóng popup "trùng SĐT"/"trùng CCCD" thì không tự bật lại cho tới khi giá trị field đó đổi khác. */
  const [phoneMatchDismissed, setPhoneMatchDismissed] = useState(false);
  const [nationalIdMatchDismissed, setNationalIdMatchDismissed] = useState(false);

  const [date, setDate] = useState(getVietnamTodayDateString());
  const [time, setTime] = useState(minutesToLabel(vietnamNowMinutes()));
  const [reason, setReason] = useState(checkin?.reason ?? '');
  const [patientSourceCode, setPatientSourceCode] = useState('');
  const [receptionTypeCode, setReceptionTypeCode] = useState('');
  const [examFormCode, setExamFormCode] = useState('');
  const [isPriority, setIsPriority] = useState(false);
  const [priorityReasonCode, setPriorityReasonCode] = useState('');
  const [examTypeCode, setExamTypeCode] = useState('');
  const [priceTypeCode, setPriceTypeCode] = useState('');
  const [serviceQuantity, setServiceQuantity] = useState(1);
  const [payLater, setPayLater] = useState(true);
  // Điều phối Bác sĩ/Khoa ("Hàng đợi ảo", docs/DECISIONS.md #064) — mặc định "theo bác sĩ", giữ
  // đúng bác sĩ đã đặt lịch cho mode='checkin' (vẫn sửa được, khác hành vi cũ khoá cứng).
  const [routingMode, setRoutingMode] = useState<'doctor' | 'department'>('doctor');
  const [doctorId, setDoctorId] = useState(checkin?.doctorId ?? '');
  const [departmentId, setDepartmentId] = useState('');
  /** Bộ lọc Khoa trong tab "Bác sĩ" (yêu cầu chủ dự án 2026-08-21, tách tab để không bể giao diện
   * khi nhiều Khoa/bác sĩ) — chỉ có ý nghĩa khi có ≥2 Khoa (dropdown mới hiện), 1 Khoa thì danh
   * sách bác sĩ coi như đã lọc sẵn theo đúng Khoa đó (không cần dropdown thừa). */
  const [doctorFilterDepartmentId, setDoctorFilterDepartmentId] = useState('');
  const [vitals, setVitals] = useState<VitalValues>(EMPTY_VITALS);
  const [error, setError] = useState<string | null>(null);
  /** Popup "Tiếp nhận thành công" (mode='direct') — thay điều hướng ngay lập tức, cho phép tiếp
   * nhận liên tiếp nhiều bệnh nhân không rời trang (yêu cầu chủ dự án, mẫu tham khảo đã gửi). */
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const doctorsQuery = useDoctorsQuery();
  const departmentsQuery = useDepartmentOptionsQuery();
  const roomOptionsQuery = useRoomOptionsQuery();
  // "Đang chờ: N" theo bác sĩ/Khoa cho danh sách thẻ điều phối (mockup
  // docs/design/doctor-queue-virtual-queue-mockup.html) — tái dùng nguyên `GET /reception/list`
  // của "Hàng đợi khám" thay vì thêm endpoint đếm riêng, lễ tân đã có `encounter.read=global` nên
  // không cần lọc theo actor.
  const todayQueueQuery = useReceptionListQuery(getVietnamTodayDateString());
  const patientSourceQuery = useReferenceCatalogQuery('PATIENT_SOURCE');
  const receptionTypeQuery = useReferenceCatalogQuery('RECEPTION_TYPE');
  const examFormQuery = useReferenceCatalogQuery('EXAM_FORM');
  const priorityReasonQuery = useReferenceCatalogQuery('PRIORITY_REASON');
  const priceTypeQuery = useReferenceCatalogQuery('PRICE_TYPE');
  const examTypeQuery = useReferenceCatalogQuery('EXAM_TYPE');
  const registerMutation = useRegisterReceptionMutation();
  const checkInMutation = useCheckInMutation();
  const createPatientMutation = useCreatePatientMutation();
  const updatePatientMutation = useUpdatePatientMutation(matchedPatient?.id ?? '');
  const submitting =
    registerMutation.isPending || checkInMutation.isPending || createPatientMutation.isPending || updatePatientMutation.isPending;

  // Tra trùng SĐT/CCCD ngay trên field (thay PatientPicker) — không tra khi đã khớp xong.
  const phoneMatchQuery = usePatientByPhoneQuery(matchedPatient ? '' : formValues.phone);
  const nationalIdMatchQuery = usePatientByNationalIdQuery(matchedPatient ? '' : formValues.nationalId);
  const patientDetailQuery = usePatientQuery(pendingMatchId ?? '', pendingMatchId !== null);

  // Chi tiết đầy đủ (đủ field ethnicity/nationality/người thân...) cho hồ sơ vừa khớp — load xong thì khoá form.
  useEffect(() => {
    if (patientDetailQuery.data && pendingMatchId === patientDetailQuery.data.id) {
      const values = patientDetailToFormValuesLocal(patientDetailQuery.data);
      setMatchedPatient(patientDetailQuery.data);
      setMatchedOriginalValues(values);
      setFormValues(values);
      setPendingMatchId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientDetailQuery.data]);

  useEffect(() => {
    setPhoneMatchDismissed(false);
  }, [formValues.phone]);

  useEffect(() => {
    setNationalIdMatchDismissed(false);
  }, [formValues.nationalId]);

  function unmatch() {
    setMatchedPatient(null);
    setMatchedOriginalValues(null);
    setPendingMatchId(null);
    setFormValues(EMPTY_PATIENT_FORM);
  }

  /** "Nhập lại" — xoá hết những gì đã nhập, đưa form về đúng trạng thái ban đầu lúc mount (khớp
   * initializer của từng state ở trên: `checkin` prefill vẫn giữ cho mode='checkin', trắng hoàn
   * toàn cho mode='direct'). Dùng lại sau popup "Tiếp nhận thành công" để tiếp nhận NGAY bệnh nhân
   * kế tiếp không rời trang, và cho nút "Nhập lại" bấm trực tiếp giữa chừng (yêu cầu chủ dự án). */
  function resetForm() {
    setMatchedPatient(null);
    setMatchedOriginalValues(null);
    setPendingMatchId(null);
    setDuplicates(null);
    setPhoneMatchDismissed(false);
    setNationalIdMatchDismissed(false);
    setFormValues({ ...EMPTY_PATIENT_FORM, fullName: checkin?.fullName ?? '', phone: checkin?.phone ?? '' });
    setDate(getVietnamTodayDateString());
    setTime(minutesToLabel(vietnamNowMinutes()));
    setReason(checkin?.reason ?? '');
    setPatientSourceCode('');
    setReceptionTypeCode('');
    setExamFormCode('');
    setIsPriority(false);
    setPriorityReasonCode('');
    setExamTypeCode('');
    setPriceTypeCode('');
    setServiceQuantity(1);
    setPayLater(true);
    setRoutingMode('doctor');
    setDoctorId(checkin?.doctorId ?? '');
    setDepartmentId('');
    setDoctorFilterDepartmentId('');
    setVitals(EMPTY_VITALS);
    setError(null);
  }

  // Khu vực "Chuyển vào hàng đợi" (đúng mockup docs/design/doctor-queue-virtual-queue-mockup.html,
  // yêu cầu chủ dự án 2026-08-21 — thay hẳn toggle+Combobox trước đó) — danh sách thẻ bác sĩ kèm
  // số "Đang chờ" thời gian thực (đếm từ `todayQueueQuery`, status CHECKED_IN), cùng thẻ "Khoa X
  // (chung)" viền nét đứt cho hàng chờ chung. "Phòng làm việc hôm nay" (#054) hiện làm phụ đề mỗi
  // thẻ bác sĩ khi có (`currentRoomName`), cùng quy tắc `DoctorAvailabilityList.tsx`.
  const todayItems = todayQueueQuery.data?.items ?? [];
  const waitingCountByDoctor = new Map<string, number>();
  const waitingCountByDepartmentPool = new Map<string, number>();
  for (const it of todayItems) {
    if (it.status !== 'CHECKED_IN') continue;
    if (it.doctorId) {
      waitingCountByDoctor.set(it.doctorId, (waitingCountByDoctor.get(it.doctorId) ?? 0) + 1);
    } else {
      waitingCountByDepartmentPool.set(it.departmentId, (waitingCountByDepartmentPool.get(it.departmentId) ?? 0) + 1);
    }
  }

  const doctorCards = (doctorsQuery.data?.items ?? []).map((d) => ({
    id: d.id,
    fullName: d.fullName,
    departmentId: d.departmentId,
    departmentName: d.departmentId ? (departmentsQuery.data?.items.find((dep) => dep.id === d.departmentId)?.name ?? null) : null,
    roomName: d.currentRoomName ?? null,
    waitingCount: waitingCountByDoctor.get(d.id) ?? 0,
  }));
  // Điều phối theo Khoa ("Hàng đợi ảo", #064) — hiện thẻ "(chung)" cho MỌI Khoa active, kể cả Khoa
  // chưa có bác sĩ nào gán vào (lễ tân vẫn cần đẩy bệnh nhân vào hàng chờ của Khoa mới tạo trước
  // khi có bác sĩ, hoặc bác sĩ sẽ gán vào sau) — sửa lại đúng hành vi gốc, bản trước lọc theo
  // `doctorCount > 0` khiến Khoa mới tạo (chưa gán bác sĩ) không bao giờ hiện được, phát hiện thật
  // khi chủ dự án tạo "Khoa Tai Mũi Họng" mà chỉ thấy đúng Khoa mặc định. Tự ẩn hoàn toàn khu vực
  // này khi tenant chỉ có 1 Khoa, đúng khuôn #054/#055: không có gì để chọn thì không hiện lựa chọn.
  // "N bác sĩ đang trực" (yêu cầu chủ dự án 2026-08-21, làm rõ căn cứ đếm sau khi bị hỏi lại) —
  // KHÔNG phải "đang đăng nhập" (không có cơ chế theo dõi phiên thời gian thực cho việc này, sẽ
  // phải đụng sang `user_session` của module `iam`, không đáng công cho một con số hiển thị) mà là
  // đã CHỌN PHÒNG LÀM VIỆC HÔM NAY (`doctor_room_session`, chọn phòng bắt buộc phải đang đăng nhập
  // mới làm được nên đã bao hàm "có online lúc đó") — CHỈ có ý nghĩa khi tenant ≥2 phòng active
  // (đúng 1 phòng thì không ai từng tạo `doctor_room_session`, #054). Fallback về "thuộc Khoa" khi
  // ≤1 phòng để vẫn hữu ích ở quy mô 1-3 bác sĩ (thị trường chính, PRD).
  const multiRoomActive = (roomOptionsQuery.data?.items.length ?? 0) > 1;
  const departmentPoolCards = (departmentsQuery.data?.items ?? []).map((dep) => ({
    id: dep.id,
    name: dep.name,
    doctorCount: doctorCards.filter((d) => d.departmentId === dep.id && (!multiRoomActive || d.roomName !== null)).length,
    waitingCount: waitingCountByDepartmentPool.get(dep.id) ?? 0,
  }));
  const departmentRoutingAvailable = departmentPoolCards.length > 1;
  // Bộ lọc Khoa trong tab "Bác sĩ" — chỉ hiện dropdown khi có ≥2 Khoa (departmentRoutingAvailable);
  // 1 Khoa thì danh sách bác sĩ coi như đã đúng phạm vi Khoa đó, không lọc gì thêm.
  const filteredDoctorCards = departmentRoutingAvailable
    ? doctorCards.filter((d) => doctorFilterDepartmentId === '' || d.departmentId === doctorFilterDepartmentId)
    : doctorCards;
  const patientSourceOptions = withLegacyValueOption(
    (patientSourceQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    patientSourceCode,
  );
  const receptionTypeOptions = withLegacyValueOption(
    (receptionTypeQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    receptionTypeCode,
  );
  const examFormOptions = withLegacyValueOption(
    (examFormQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    examFormCode,
  );
  const priorityReasonOptions = withLegacyValueOption(
    (priorityReasonQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    priorityReasonCode,
  );
  const priceTypeOptions = withLegacyValueOption(
    (priceTypeQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name })),
    priceTypeCode,
  );
  const examTypeItems = examTypeQuery.data?.items ?? [];
  const examTypeOptions = withLegacyValueOption(
    examTypeItems.map((i) => ({ value: i.code, label: i.price !== null ? `${i.name} — ${formatVnd(i.price)}` : i.name })),
    examTypeCode,
  );
  const selectedExamType = examTypeItems.find((i) => i.code === examTypeCode) ?? null;
  const serviceAmount = selectedExamType?.price !== null && selectedExamType?.price !== undefined ? selectedExamType.price * serviceQuantity : null;

  const weightGram = toNumber(vitals.weightKg) !== undefined ? Math.round(Number(vitals.weightKg) * 1000) : undefined;
  const heightMm = toNumber(vitals.heightCm) !== undefined ? Math.round(Number(vitals.heightCm) * 10) : undefined;
  const bmi = computeBmi(weightGram, heightMm);

  const phoneMatches = matchedPatient ? [] : (phoneMatchQuery.data?.items ?? []);
  const nationalIdMatches = matchedPatient ? [] : (nationalIdMatchQuery.data?.items ?? []);

  const administrativeComplete =
    formValues.fullName.trim() !== '' && formValues.dob !== '' && formValues.phone.trim() !== '' && formValues.gender !== '';
  const routingComplete = routingMode === 'doctor' ? doctorId !== '' : departmentId !== '';
  const canSubmit =
    administrativeComplete &&
    receptionTypeCode !== '' &&
    examFormCode !== '' &&
    examTypeCode !== '' &&
    (!isPriority || priorityReasonCode !== '') &&
    routingComplete;

  function buildVitalsPayload() {
    return {
      pulse: toNumber(vitals.pulse),
      temperatureC: toNumber(vitals.temperatureC),
      bpSystolic: toNumber(vitals.bpSystolic),
      bpDiastolic: toNumber(vitals.bpDiastolic),
      respiratoryRate: toNumber(vitals.respiratoryRate),
      spo2: toNumber(vitals.spo2),
      weightGram,
      heightMm,
    };
  }

  /** Trả về `patientId` để dùng tiếp cho check-in/tiếp nhận, hoặc `null` nếu bị chặn (nghi trùng chờ xác nhận). */
  async function resolvePatientId(confirmDuplicate: boolean): Promise<string | null> {
    if (matchedPatient && matchedOriginalValues) {
      const changed = JSON.stringify(formValues) !== JSON.stringify(matchedOriginalValues);
      if (!changed) return matchedPatient.id;
      const updated = await updatePatientMutation.mutateAsync(toUpdatePatientRequest(formValues, matchedPatient.version));
      return updated.id;
    }

    if (!confirmDuplicate) {
      const dup = await checkPatientDuplicate(formValues.fullName, formValues.dob);
      if (dup.items.length > 0) {
        setDuplicates(dup.items);
        return null;
      }
    }
    const created = await createPatientMutation.mutateAsync(toCreatePatientRequest(formValues));
    return created.id;
  }

  async function submit(confirmDuplicate: boolean) {
    if (!selectedExamType || !routingComplete) return;
    setError(null);
    try {
      const patientId = await resolvePatientId(confirmDuplicate);
      if (patientId === null) return; // chặn bởi nghi trùng (PAT-03), chờ người dùng quyết định

      // Điều phối Bác sĩ/Khoa ("Hàng đợi ảo", #064) — CHỈ gửi field đúng nhánh đang chọn (server tự
      // suy departmentId từ hồ sơ bác sĩ khi routingMode='doctor', không tin departmentId client
      // gửi kèm cho nhánh đó — xem `ReceptionService.resolveRouting()`).
      const routingFields = routingMode === 'doctor' ? { doctorId } : { departmentId };

      const sharedFields = {
        patientId,
        ...routingFields,
        chiefComplaint: reason.trim() === '' ? undefined : reason.trim(),
        patientSourceCode: patientSourceCode === '' ? undefined : patientSourceCode,
        examTypeCode: selectedExamType.code,
        examTypeName: selectedExamType.name,
        examTypePrice: selectedExamType.price ?? 0,
        examTypeUnit: selectedExamType.unit ?? undefined,
        receptionTypeCode,
        examFormCode,
        isPriority,
        priorityReasonCode: isPriority && priorityReasonCode !== '' ? priorityReasonCode : undefined,
        priceTypeCode: priceTypeCode === '' ? undefined : priceTypeCode,
        serviceQuantity,
        ...buildVitalsPayload(),
      };

      if (mode === 'direct') {
        await registerMutation.mutateAsync({
          ...sharedFields,
          checkedInAt: vnDateTimeToIso(date, time),
        });
        // Hiện popup xác nhận ngay tại trang (không điều hướng) — lễ tân tiếp nhận liên tiếp nhiều
        // bệnh nhân, "Tiếp nhận mới" xoá trắng form thay vì rời trang mỗi lần (yêu cầu chủ dự án).
        setShowSuccessDialog(true);
      } else if (checkin) {
        const created = await checkInMutation.mutateAsync({
          ...sharedFields,
          appointmentId: checkin.appointmentId,
          version: checkin.appointmentVersion,
        });
        onSuccess(created.encounterNo);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {duplicates && duplicates.length > 0 && (
        <PatientMatchDialog
          variant="warning"
          title="Có thể trùng với hồ sơ đã có"
          description="Tên và ngày sinh vừa nhập khớp với (các) hồ sơ dưới đây — chọn đúng người nếu là cùng một bệnh nhân, hoặc vẫn tạo hồ sơ mới nếu chỉ trùng tên."
          candidates={duplicates}
          onPick={(p) => {
            setDuplicates(null);
            setPendingMatchId(p.id);
          }}
          onCreateNew={() => void submit(true)}
          creating={submitting}
          onClose={() => setDuplicates(null)}
        />
      )}

      {!matchedPatient && nationalIdMatches.length > 0 && !nationalIdMatchDismissed ? (
        <PatientMatchDialog
          variant="info"
          title="Tìm thấy hồ sơ trùng CCCD/CMND"
          description="Số CCCD/CMND này đã dùng cho hồ sơ dưới đây (mỗi CCCD chỉ thuộc một bệnh nhân) — bấm Chọn để dùng hồ sơ cũ, hoặc đóng để tiếp tục nhập hồ sơ mới."
          candidates={nationalIdMatches}
          onPick={(p) => setPendingMatchId(p.id)}
          onClose={() => setNationalIdMatchDismissed(true)}
        />
      ) : (
        !matchedPatient &&
        phoneMatches.length > 0 &&
        !phoneMatchDismissed && (
          <PatientMatchDialog
            variant="info"
            title="Tìm thấy hồ sơ trùng số điện thoại"
            description="Số điện thoại này đã dùng cho (các) hồ sơ dưới đây — chọn đúng khách hàng nếu là cùng người, hoặc đóng để tiếp tục nhập hồ sơ mới (số điện thoại được phép dùng chung, ví dụ người thân)."
            candidates={phoneMatches}
            onPick={(p) => setPendingMatchId(p.id)}
            onClose={() => setPhoneMatchDismissed(true)}
          />
        )
      )}

      {matchedPatient && (
        <div className="flex items-center gap-3 rounded-lg border border-brand-teal bg-brand-teal-tint px-4 py-2.5 text-sm">
          <span className="h-2 w-2 flex-none rounded-full bg-brand-teal" aria-hidden="true" />
          <span className="text-slate-700">
            Đã khớp hồ sơ cũ — <strong className="font-semibold text-slate-900">{matchedPatient.fullName}</strong>, mã{' '}
            <strong className="font-semibold text-brand-teal">{matchedPatient.patientCode}</strong>. CCCD/Mã bệnh nhân/Họ tên/Ngày sinh
            đã khoá theo hồ sơ gốc.
          </span>
          <button type="button" onClick={unmatch} className="ml-auto text-xs font-semibold text-blue-600 underline hover:text-blue-700">
            Không phải người này?
          </button>
        </div>
      )}

      <PatientFormFields
        values={formValues}
        onChange={setFormValues}
        identityLocked={matchedPatient !== null}
        disabled={duplicates !== null}
        hidePhoneDuplicateHint
        patientId={matchedPatient?.id}
        patientCode={matchedPatient?.patientCode}
        photoUrl={matchedPatient?.photoUrl}
        version={matchedPatient?.version}
      />

      <div className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Thông tin tiếp nhận</span>
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-28 flex-none">
            <label htmlFor="intake-date" className={labelClassName}>
              Ngày tiếp nhận
            </label>
            <input id="intake-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClassName} />
          </div>
          <div className="w-24 flex-none">
            <label htmlFor="intake-time" className={labelClassName}>
              Giờ tiếp nhận
            </label>
            <TimeInput id="intake-time" value={time} onChange={setTime} className={inputClassName} />
          </div>
          <div className="min-w-[160px] flex-1">
            <label htmlFor="intake-reception-type" className={labelClassName}>
              Loại tiếp nhận <span className="text-rose-500">*</span>
            </label>
            <Combobox id="intake-reception-type" value={receptionTypeCode} onChange={setReceptionTypeCode} options={receptionTypeOptions} required />
          </div>
          <div className="min-w-[160px] flex-1">
            <label htmlFor="intake-exam-form" className={labelClassName}>
              Hình thức khám <span className="text-rose-500">*</span>
            </label>
            <Combobox id="intake-exam-form" value={examFormCode} onChange={setExamFormCode} options={examFormOptions} required />
          </div>
          <div className="w-40 flex-none">
            <label htmlFor="intake-priority" className={labelClassName}>
              Ưu tiên khám
            </label>
            <label htmlFor="intake-priority" className="flex h-[38px] cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 text-[14px] font-semibold text-slate-800">
              <input
                id="intake-priority"
                type="checkbox"
                checked={isPriority}
                onChange={(e) => {
                  setIsPriority(e.target.checked);
                  if (!e.target.checked) setPriorityReasonCode('');
                }}
                className="h-4 w-4 accent-blue-600"
              />
              Có ưu tiên
            </label>
          </div>
          <div className="min-w-[160px] flex-1">
            <label htmlFor="intake-priority-reason" className={labelClassName}>
              Lý do ưu tiên {isPriority && <span className="text-rose-500">*</span>}
            </label>
            <Combobox
              id="intake-priority-reason"
              value={priorityReasonCode}
              onChange={setPriorityReasonCode}
              options={priorityReasonOptions}
              disabled={!isPriority}
              placeholder={isPriority ? 'Gõ để tìm...' : 'Chọn "Ưu tiên khám" trước'}
              required={isPriority}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label htmlFor="intake-source" className={labelClassName}>
              Nguồn khách
            </label>
            <Combobox
              id="intake-source"
              value={patientSourceCode}
              onChange={setPatientSourceCode}
              options={patientSourceOptions}
              placeholder="Không bắt buộc — gõ để tìm..."
            />
          </div>
        </div>

        {/*
         * "Chuyển vào hàng đợi" (trước đây "Điều phối") — danh sách thẻ bác sĩ kèm "Đang chờ: N"
         * thời gian thực + thẻ "Khoa X (chung)" viền nét đứt, đúng
         * docs/design/doctor-queue-virtual-queue-mockup.html (thay hẳn toggle+Combobox trước đó,
         * yêu cầu chủ dự án 2026-08-21 — bản toggle+Combobox là bản đơn giản hoá lúc code #064,
         * chưa từng đối chiếu lại đúng mockup đã duyệt).
         */}
        <div className="mt-4">
          <span className={`${labelClassName} mb-2 block`}>
            Chuyển vào hàng đợi <span className="text-rose-500">*</span>
          </span>
          <div>
            {/* Tách tab Bác sĩ/Khoa (yêu cầu chủ dự án 2026-08-21) — danh sách phẳng gộp chung dễ bể
                giao diện khi tenant có nhiều Khoa × nhiều bác sĩ; CHỈ hiện tab khi có ≥2 Khoa
                (đúng khuôn #054/#055, 1 Khoa thì không có gì để tách). Lưới nhiều cột (không phải
                danh sách dọc 1 cột) để không kéo dài vô hạn khi có nhiều bác sĩ/Khoa — yêu cầu chủ
                dự án 2026-08-21 lần 2. */}
            {departmentRoutingAvailable && (
              <div className="mb-2.5 flex border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setRoutingMode('doctor')}
                  className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold ${
                    routingMode === 'doctor' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Bác sĩ
                </button>
                <button
                  type="button"
                  onClick={() => setRoutingMode('department')}
                  className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold ${
                    routingMode === 'department' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Khoa
                </button>
              </div>
            )}

            {routingMode === 'doctor' && (
              <div>
                {departmentRoutingAvailable && (
                  <select
                    value={doctorFilterDepartmentId}
                    onChange={(e) => setDoctorFilterDepartmentId(e.target.value)}
                    className={`${inputClassName} mb-2 max-w-xs`}
                    aria-label="Lọc bác sĩ theo Khoa"
                  >
                    <option value="">Tất cả Khoa</option>
                    {departmentPoolCards.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                )}
                {filteredDoctorCards.length === 0 && (
                  <p className="text-sm text-slate-400">
                    {doctorCards.length === 0 ? 'Chưa có bác sĩ nào đang hoạt động để chọn.' : 'Không có bác sĩ nào thuộc Khoa đã lọc.'}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {filteredDoctorCards.map((doctor) => {
                  const active = routingMode === 'doctor' && doctorId === doctor.id;
                  return (
                    <button
                      key={doctor.id}
                      type="button"
                      onClick={() => setDoctorId(doctor.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border-2 px-3.5 py-2.5 text-left shadow-sm transition-colors ${
                        active ? 'border-brand-teal bg-brand-teal' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {active && <CheckCircle size={18} weight="fill" className="flex-shrink-0 text-white" aria-hidden="true" />}
                        <div className="min-w-0">
                          <div className={`truncate text-[13.5px] font-bold ${active ? 'text-white' : 'text-slate-900'}`}>BS. {doctor.fullName}</div>
                          <div className={`truncate text-xs ${active ? 'text-white/80' : 'text-slate-500'}`}>
                            {[doctor.departmentName, doctor.roomName].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                          active ? 'bg-white text-brand-teal' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        Đang chờ: {doctor.waitingCount}
                      </span>
                    </button>
                  );
                })}
                </div>
              </div>
            )}

            {routingMode === 'department' && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {departmentPoolCards.map((dept) => {
                  const active = routingMode === 'department' && departmentId === dept.id;
                  return (
                    <button
                      key={dept.id}
                      type="button"
                      onClick={() => setDepartmentId(dept.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border-2 border-dashed px-3.5 py-2.5 text-left shadow-sm transition-colors ${
                        active ? 'border-blue-600 bg-blue-600' : 'border-blue-300 bg-blue-50/40 hover:border-blue-400'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {active && <CheckCircle size={18} weight="fill" className="flex-shrink-0 text-white" aria-hidden="true" />}
                        <div className="min-w-0">
                          <div className={`truncate text-[13.5px] font-bold ${active ? 'text-white' : 'text-slate-900'}`}>{dept.name} (chung)</div>
                          <div className={`truncate text-xs ${active ? 'text-white/80' : 'text-slate-500'}`}>
                            {dept.doctorCount > 0 ? `${dept.doctorCount} bác sĩ đang trực · chưa cần chọn ai` : 'Chưa có bác sĩ nào — vẫn tiếp nhận được'}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                          active ? 'bg-white text-blue-700' : dept.waitingCount > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        Đang chờ: {dept.waitingCount}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {mode === 'checkin' && routingMode === 'doctor' && (
            <p className="mt-1.5 text-xs text-slate-400">Mặc định theo bác sĩ đã đặt lịch ({checkin?.doctorName}) — vẫn chọn được bác sĩ khác.</p>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="intake-reason" className={labelClassName}>
            Lý do tiếp nhận
          </label>
          <textarea
            id="intake-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Không bắt buộc"
            className={inputClassName}
          />
          {mode === 'checkin' && checkin?.reason && (
            <p className="mt-1 text-xs text-slate-400">Đã tự điền từ lý do khám ghi lúc đặt lịch — vẫn sửa được.</p>
          )}
        </div>
      </div>

      <div className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Sinh hiệu (không bắt buộc)</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <VitalField id="intake-pulse" label="Mạch (l/p)" value={vitals.pulse} onChange={(v) => setVitals((p) => ({ ...p, pulse: v }))} />
          <VitalField
            id="intake-temperature"
            label="Nhiệt độ (°C)"
            step="0.1"
            value={vitals.temperatureC}
            onChange={(v) => setVitals((p) => ({ ...p, temperatureC: v }))}
          />
          <VitalField id="intake-spo2" label="SpO2 (%)" value={vitals.spo2} onChange={(v) => setVitals((p) => ({ ...p, spo2: v }))} />
          <VitalField
            id="intake-bp-systolic"
            label="HA tâm thu"
            value={vitals.bpSystolic}
            onChange={(v) => setVitals((p) => ({ ...p, bpSystolic: v }))}
          />
          <VitalField
            id="intake-bp-diastolic"
            label="HA tâm trương"
            value={vitals.bpDiastolic}
            onChange={(v) => setVitals((p) => ({ ...p, bpDiastolic: v }))}
          />
          <VitalField
            id="intake-respiratory-rate"
            label="Nhịp thở (l/p)"
            value={vitals.respiratoryRate}
            onChange={(v) => setVitals((p) => ({ ...p, respiratoryRate: v }))}
          />
          <VitalField
            id="intake-weight"
            label="Cân nặng (kg)"
            step="0.1"
            value={vitals.weightKg}
            onChange={(v) => setVitals((p) => ({ ...p, weightKg: v }))}
          />
          <VitalField
            id="intake-height"
            label="Chiều cao (cm)"
            step="0.1"
            value={vitals.heightCm}
            onChange={(v) => setVitals((p) => ({ ...p, heightCm: v }))}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-blue-100 bg-blue-50 px-5 py-3.5">
          <p className="text-[12.5px] font-bold uppercase tracking-wide text-blue-700">Chỉ số khối cơ thể (BMI)</p>
          <div className="flex-none text-[28px] font-extrabold leading-none text-blue-700">{bmi !== null ? bmi.toFixed(1) : '—'}</div>
        </div>
      </div>

      <div className={sectionBoxClassName}>
        <span className={sectionBadgeTealClassName}>Chỉ định dịch vụ khám — chỉ lưu để hiển thị, chưa tính viện phí</span>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="intake-exam-type" className={labelClassName}>
              Loại khám <span className="text-rose-500">*</span>
            </label>
            <Combobox id="intake-exam-type" value={examTypeCode} onChange={setExamTypeCode} options={examTypeOptions} required />
          </div>
          <div className="min-w-[180px] flex-1">
            <label htmlFor="intake-price-type" className={labelClassName}>
              Loại giá dịch vụ
            </label>
            <Combobox
              id="intake-price-type"
              value={priceTypeCode}
              onChange={setPriceTypeCode}
              options={priceTypeOptions}
              placeholder="Không bắt buộc — gõ để tìm..."
            />
          </div>
          <div className="w-28 flex-none">
            <span className={labelClassName}>Đơn vị</span>
            <div className="flex h-[38px] items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-[15px] font-semibold text-slate-800">
              {selectedExamType?.unit ?? '—'}
            </div>
          </div>
          <div className="w-24 flex-none">
            <label htmlFor="intake-quantity" className={labelClassName}>
              Số lượng
            </label>
            <input
              id="intake-quantity"
              type="number"
              min={1}
              value={serviceQuantity}
              onChange={(e) => setServiceQuantity(Math.max(1, Number(e.target.value) || 1))}
              className={inputClassName}
            />
          </div>
          <div className="w-40 flex-none">
            <span className={labelClassName}>Thanh toán</span>
            <label htmlFor="intake-pay-later" className="flex h-[38px] cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 text-[14px] font-semibold text-slate-800">
              <input id="intake-pay-later" type="checkbox" checked={payLater} onChange={(e) => setPayLater(e.target.checked)} className="h-4 w-4 accent-blue-600" />
              Thanh toán sau
            </label>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-bold uppercase tracking-wide text-slate-800">
                <th className="px-3 py-2.5">Mã dịch vụ</th>
                <th className="px-3 py-2.5 text-left">Tên dịch vụ</th>
                <th className="px-3 py-2.5">Số lượng</th>
                <th className="px-3 py-2.5">Đơn giá</th>
                <th className="px-3 py-2.5">Thành tiền</th>
                <th className="px-3 py-2.5">Trạng thái</th>
              </tr>
            </thead>
            {selectedExamType ? (
              <tbody>
                <tr>
                  <td className="px-3 py-3 text-center font-semibold text-slate-800">{selectedExamType.code}</td>
                  <td className="px-3 py-3 text-left font-semibold text-slate-900">{selectedExamType.name}</td>
                  <td className="px-3 py-3 text-center font-medium text-slate-700">{serviceQuantity}</td>
                  <td className="px-3 py-3 text-center font-medium text-slate-700">
                    {selectedExamType.price !== null ? formatVnd(selectedExamType.price) : '—'}
                  </td>
                  <td className="px-3 py-3 text-center font-bold text-slate-800">{serviceAmount !== null ? formatVnd(serviceAmount) : '—'}</td>
                  <td className="px-3 py-3 text-center">
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">Chờ thực hiện</span>
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody>
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm font-medium text-slate-500">
                    Chưa có dịch vụ chỉ định — chọn &quot;Loại khám&quot; ở trên để thêm.
                  </td>
                </tr>
              </tbody>
            )}
          </table>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2.5">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Quay lại
        </Button>
        <Button type="button" variant="secondary" onClick={resetForm}>
          Nhập lại
        </Button>
        <Button type="button" disabled={!canSubmit || duplicates !== null} loading={submitting} onClick={() => void submit(false)}>
          {mode === 'direct' ? 'Lưu tiếp nhận' : 'Xác nhận tiếp nhận'}
        </Button>
      </div>

      {showSuccessDialog && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow-2xl">
            <CheckCircle size={56} weight="fill" className="mx-auto mb-4 text-emerald-500" aria-hidden="true" />
            <h3 className="mb-1 text-lg font-bold uppercase tracking-wide text-emerald-600">Thành công</h3>
            <p className="mb-6 text-sm text-slate-700">Tiếp nhận thành công</p>
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                setShowSuccessDialog(false);
                resetForm();
              }}
            >
              <UserPlus size={18} weight="bold" aria-hidden="true" />
              Tiếp nhận mới
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Cùng logic `patientDetailToFormValues` (`patient-form.utils.ts`) — viết lại tại chỗ (không
 * import) vì file gốc build ra CommonJS qua `@nexamed/shared`/barrel export, còn hàm này chỉ đọc
 * field của `PatientDetail` (không phải logic nghiệp vụ cần đồng bộ 2 nơi) — an toàn trùng, tránh
 * vấn đề Rollup không dò được named export qua `__exportStar` đã gặp nhiều lần (`docs/DECISIONS.md` #032).
 */
function patientDetailToFormValuesLocal(detail: PatientDetail): PatientFormValues {
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
    allergyNote: detail.allergyNote ?? '',
    personalHistory: detail.personalHistory ?? '',
    familyHistory: detail.familyHistory ?? '',
    relativeFullName: detail.relativeFullName ?? '',
    relativeRelationship: detail.relativeRelationship ?? '',
    relativePhone: detail.relativePhone ?? '',
    relativeAddress: detail.relativeAddress ?? '',
  };
}