import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CalendarBlank,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  Flask,
  PencilSimple,
  Pill,
  Plus,
  Stethoscope,
  Warning,
  X,
} from '@phosphor-icons/react';
import type { DiagnosisType, EncounterHistoryItem, SaveClinicalNoteRequest } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { useAutoCollapseSidebar } from '../../shared/layout/sidebar.context';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { Textarea } from '../../shared/ui/Textarea';
import { computeAgeLabel } from '../patient/patient-form.utils';
import { useUpdatePatientMutation } from '../patient/patient.queries';
import { Icd10DiagnosisPicker } from './Icd10DiagnosisPicker';
import { VitalSignsDialog } from './VitalSignsDialog';
import {
  useCompleteConsultationMutation,
  useConsultationDetailQuery,
  useSaveClinicalNoteMutation,
  useSaveDiagnosesMutation,
} from './encounter.queries';

const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' };
const DIAGNOSIS_TYPE_LABEL: Record<DiagnosisType, string> = { PRIMARY: 'Bệnh chính', SECONDARY: 'Bệnh kèm theo' };

type ClinicalKey = keyof SaveClinicalNoteRequest;
type ClinicalDraft = Record<ClinicalKey, string>;
const EMPTY_CLINICAL_DRAFT: ClinicalDraft = {
  personalHistory: '',
  familyHistory: '',
  reasonForVisit: '',
  illnessProgress: '',
  preliminaryDiagnosis: '',
  generalExam: '',
  regionalExam: '',
  plan: '',
};

interface DiagnosisDraft {
  icd10Code: string;
  icd10Name: string;
  type: DiagnosisType;
  note?: string;
}

function formatHistoryDate(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
}

/** "N ngày/tháng/năm trước" — chỉ dùng để gợi nhớ độ gần/xa của lần khám, không cần chính xác tuyệt đối. */
function formatRelativeTime(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60_000)));
  if (days === 0) return 'hôm nay';
  if (days < 30) return `${days} ngày trước`;
  if (days < 365) return `${Math.round(days / 30)} tháng trước`;
  return `${Math.round(days / 365)} năm trước`;
}

const TABS = [
  { id: 'section-kham', label: '1. Khám & Chẩn đoán', icon: ClipboardText, comingSoon: false },
  { id: 'section-cls', label: '2. Chỉ định cận lâm sàng', icon: Flask, comingSoon: true },
  { id: 'section-donthuoc', label: '3. Kê đơn thuốc', icon: Pill, comingSoon: true },
  { id: 'section-hen', label: '4. Lời dặn & hẹn tái khám', icon: CalendarBlank, comingSoon: true },
] as const;

/**
 * Màn hình khám bệnh (S3-06/07) — bố cục theo mockup đã duyệt
 * (`docs/design/encounter-consultation-mockup.html`), sau đó tách khối ghi chú từ 4 mục SOAP sang
 * 2 nhóm "Tiền sử"/"Thăm khám" theo yêu cầu chủ dự án 2026-08-20 (xem docs/DECISIONS.md — đổi
 * schema `clinical_note.section`). Chỉ tab 1 ("Chẩn đoán và điều trị") là nội dung thật; tab 2-4
 * chỉ giữ chỗ "Sắp ra mắt". "Hoàn tất khám" không đợi Kê đơn (đã chốt với chủ dự án).
 */
export function EncounterConsultationPage() {
  const { id } = useParams<{ id: string }>();
  const encounterId = id!;
  const navigate = useNavigate();
  const query = useConsultationDetailQuery(encounterId);

  useBreadcrumb([
    { label: 'Khám bệnh', to: '/reception/doctor-queue' },
    { label: query.data?.patient.fullName ?? 'Đang khám' },
  ]);
  // Nhiều panel/cột (tiền sử + workspace ghi chú+ICD-10) cần không gian ngang rộng — tự thu gọn
  // sidebar lúc vào màn hình khám, tự khôi phục lại khi rời đi (docs/CURRENT.md yêu cầu chủ dự án).
  useAutoCollapseSidebar();

  const [initialized, setInitialized] = useState(false);
  const [clinical, setClinical] = useState<ClinicalDraft>(EMPTY_CLINICAL_DRAFT);
  const [clinicalVersions, setClinicalVersions] = useState<Partial<Record<ClinicalKey, number>>>({});
  const [diagnoses, setDiagnoses] = useState<DiagnosisDraft[]>([]);
  const [allergyDraft, setAllergyDraft] = useState('');
  const [allergyBaseline, setAllergyBaseline] = useState<{ value: string; version: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [vitalsDialogOpen, setVitalsDialogOpen] = useState(false);

  const saveDiagnosesMutation = useSaveDiagnosesMutation(encounterId);
  const saveClinicalNoteMutation = useSaveClinicalNoteMutation(encounterId);
  const completeMutation = useCompleteConsultationMutation(encounterId);
  const updatePatientMutation = useUpdatePatientMutation(query.data?.patient.id ?? '');

  const sectionRefs = {
    'section-kham': useRef<HTMLDivElement>(null),
    'section-cls': useRef<HTMLDivElement>(null),
    'section-donthuoc': useRef<HTMLDivElement>(null),
    'section-hen': useRef<HTMLDivElement>(null),
  };

  // Nạp bản nháp từ server đúng 1 lần lúc tải xong — không ghi đè lại mỗi lần refetch (sau khi lưu
  // chẩn đoán/ghi chú) để không mất chỉnh sửa đang gõ dở ở các ô khác.
  useEffect(() => {
    if (query.isSuccess && !initialized) {
      const note = query.data.clinicalNote;
      setClinical({
        personalHistory: note.personalHistory?.content ?? '',
        familyHistory: note.familyHistory?.content ?? '',
        // Chưa từng lưu thì mồi sẵn từ lý do tiếp nhận (`encounter.chiefComplaint`) — bác sĩ gõ
        // thêm/sửa trên đó. Đã lưu rồi (kể cả rỗng có chủ đích) thì tôn trọng đúng giá trị đã lưu.
        reasonForVisit: note.reasonForVisit ? note.reasonForVisit.content : (query.data.encounter.chiefComplaint ?? ''),
        illnessProgress: note.illnessProgress?.content ?? '',
        preliminaryDiagnosis: note.preliminaryDiagnosis?.content ?? '',
        generalExam: note.generalExam?.content ?? '',
        regionalExam: note.regionalExam?.content ?? '',
        plan: note.plan?.content ?? '',
      });
      setClinicalVersions({
        personalHistory: note.personalHistory?.version,
        familyHistory: note.familyHistory?.version,
        reasonForVisit: note.reasonForVisit?.version,
        illnessProgress: note.illnessProgress?.version,
        preliminaryDiagnosis: note.preliminaryDiagnosis?.version,
        generalExam: note.generalExam?.version,
        regionalExam: note.regionalExam?.version,
        plan: note.plan?.version,
      });
      setDiagnoses(
        query.data.diagnoses.map((d) => ({ icd10Code: d.icd10Code, icd10Name: d.icd10Name, type: d.type, note: d.note ?? undefined })),
      );
      // "Tiền sử dị ứng" tự mồi từ patient.allergyNote — sửa ở đây ghi thẳng lại hồ sơ bệnh nhân
      // (yêu cầu chủ dự án 2026-08-20), không lưu riêng cho lượt khám.
      const allergy = query.data.patient.allergyNote ?? '';
      setAllergyDraft(allergy);
      setAllergyBaseline({ value: allergy, version: query.data.patient.version });
      setInitialized(true);
    }
  }, [query.isSuccess, query.data, initialized]);

  function scrollToTab(sectionId: keyof typeof sectionRefs) {
    sectionRefs[sectionId].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setField(key: ClinicalKey, value: string) {
    setClinical((c) => ({ ...c, [key]: value }));
  }

  /**
   * Lưu ngay mỗi lần thêm/xoá/đổi bệnh chính — giữ bất biến "đúng 1 PRIMARY" tại mọi thời điểm nên
   * an toàn để gọi API luôn (không cần nút "Lưu" riêng cho khối chẩn đoán). Danh sách rỗng thì CHỈ
   * cập nhật UI cục bộ (API bắt buộc tối thiểu 1 dòng) — dữ liệu đã lưu trước đó trên server giữ
   * nguyên cho tới khi có ít nhất 1 chẩn đoán trở lại.
   */
  async function persistDiagnoses(next: DiagnosisDraft[]) {
    setFormError(null);
    if (next.length === 0) {
      setDiagnoses(next);
      return;
    }
    try {
      const result = await saveDiagnosesMutation.mutateAsync({
        diagnoses: next.map((d) => ({ icd10Code: d.icd10Code, type: d.type, note: d.note })),
      });
      setDiagnoses(
        result.items.map((d) => ({ icd10Code: d.icd10Code, icd10Name: d.icd10Name, type: d.type, note: d.note ?? undefined })),
      );
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Không lưu được chẩn đoán, vui lòng thử lại.');
    }
  }

  function handleAddDiagnosis(item: { icd10Code: string; icd10Name: string }) {
    const type: DiagnosisType = diagnoses.length === 0 ? 'PRIMARY' : 'SECONDARY';
    void persistDiagnoses([...diagnoses, { icd10Code: item.icd10Code, icd10Name: item.icd10Name, type }]);
  }

  function handleSetPrimary(code: string) {
    void persistDiagnoses(diagnoses.map((d) => ({ ...d, type: d.icd10Code === code ? 'PRIMARY' : 'SECONDARY' })));
  }

  function handleRemoveDiagnosis(code: string) {
    const removed = diagnoses.find((d) => d.icd10Code === code);
    const remaining = diagnoses.filter((d) => d.icd10Code !== code);
    if (removed?.type === 'PRIMARY' && remaining.length > 0 && !remaining.some((d) => d.type === 'PRIMARY')) {
      remaining[0] = { ...remaining[0]!, type: 'PRIMARY' };
    }
    void persistDiagnoses(remaining);
  }

  async function handleSaveDraft() {
    setFormError(null);
    setDraftSaved(false);
    if (!clinical.reasonForVisit.trim() || !clinical.preliminaryDiagnosis.trim()) {
      setFormError('"Lý do khám" và "Chuẩn đoán" là bắt buộc.');
      return;
    }
    try {
      const result = await saveClinicalNoteMutation.mutateAsync({
        personalHistory: { content: clinical.personalHistory, version: clinicalVersions.personalHistory },
        familyHistory: { content: clinical.familyHistory, version: clinicalVersions.familyHistory },
        reasonForVisit: { content: clinical.reasonForVisit, version: clinicalVersions.reasonForVisit },
        illnessProgress: { content: clinical.illnessProgress, version: clinicalVersions.illnessProgress },
        preliminaryDiagnosis: { content: clinical.preliminaryDiagnosis, version: clinicalVersions.preliminaryDiagnosis },
        generalExam: { content: clinical.generalExam, version: clinicalVersions.generalExam },
        regionalExam: { content: clinical.regionalExam, version: clinicalVersions.regionalExam },
        plan: { content: clinical.plan, version: clinicalVersions.plan },
      });
      setClinicalVersions({
        personalHistory: result.personalHistory?.version,
        familyHistory: result.familyHistory?.version,
        reasonForVisit: result.reasonForVisit?.version,
        illnessProgress: result.illnessProgress?.version,
        preliminaryDiagnosis: result.preliminaryDiagnosis?.version,
        generalExam: result.generalExam?.version,
        regionalExam: result.regionalExam?.version,
        plan: result.plan?.version,
      });

      // "Tiền sử dị ứng" ghi thẳng lại patient.allergyNote — chỉ gọi khi có thay đổi thật, tránh
      // tăng version bệnh nhân vô ích mỗi lần bấm "Lưu nháp".
      if (allergyBaseline && allergyDraft !== allergyBaseline.value) {
        const updated = await updatePatientMutation.mutateAsync({ allergyNote: allergyDraft, version: allergyBaseline.version });
        setAllergyBaseline({ value: updated.allergyNote ?? '', version: updated.version });
      }

      setDraftSaved(true);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Không lưu được ghi chú, vui lòng thử lại.');
    }
  }

  async function handleComplete() {
    setFormError(null);
    if (!diagnoses.some((d) => d.type === 'PRIMARY')) {
      setFormError('Phải có ít nhất một chẩn đoán chính trước khi hoàn tất khám.');
      return;
    }
    try {
      await completeMutation.mutateAsync({ version: query.data!.encounter.version });
      navigate('/reception/doctor-queue');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Không hoàn tất được lượt khám, vui lòng thử lại.');
    }
  }

  if (query.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (query.isError) {
    const err = query.error;
    if (err instanceof ApiError && err.code === 'NOT_FOUND') {
      return (
        <EmptyState
          icon={ClipboardText}
          title="Không tìm thấy lượt khám"
          description="Lượt khám này không tồn tại hoặc bạn không có quyền xem."
        />
      );
    }
    return (
      <ErrorBanner
        message={err instanceof ApiError ? err.message : 'Không tải được dữ liệu lượt khám.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { encounter, patient, vitalSigns, history } = query.data;
  const bmi =
    vitalSigns?.weightGram && vitalSigns.heightMm
      ? vitalSigns.weightGram / 1000 / (vitalSigns.heightMm / 1000) ** 2
      : null;
  const bmiClass = bmi != null ? classifyBmi(bmi) : null;
  const warningFields = new Set((vitalSigns?.warnings ?? []).map((w) => w.field));

  return (
    <div className="flex h-full flex-col">
      {/* Banner bệnh nhân + sinh hiệu (cố định, không cuộn theo nội dung) — 2 tầng rõ rệt: định
          danh chính (tên + mã lượt khám + cảnh báo dị ứng) tách hẳn khỏi dòng metadata có nhãn
          (Mã BN/Tuổi/Giới/SĐT, đúng mẫu tham khảo chủ dự án gửi), và khối sinh hiệu neo cố định bên
          phải (`flex-shrink-0`) — không dồn chung 1 hàng khiến vỡ dòng ở 1366px (CLAUDE.md mục 6). */}
      <div className="flex flex-shrink-0 items-center justify-between gap-6 border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-lg font-bold text-slate-900">{patient.fullName}</h1>
            <span className="whitespace-nowrap rounded-full bg-brand-teal-tint px-2.5 py-0.5 text-[11px] font-semibold text-brand-teal-active">
              {encounter.encounterNo}
            </span>
            {allergyDraft && (
              <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                <Warning size={13} weight="fill" aria-hidden="true" />
                DỊ ỨNG: {allergyDraft}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span>
              Mã BN: <strong className="font-bold text-slate-900">{patient.patientCode}</strong>
            </span>
            <span className="text-slate-300">|</span>
            <span>
              Tuổi: <strong className="font-bold text-slate-900">{computeAgeLabel(patient.dob)}</strong>
            </span>
            <span className="text-slate-300">|</span>
            <span>
              Giới: <strong className="font-bold text-slate-900">{GENDER_LABEL[patient.gender] ?? patient.gender}</strong>
            </span>
            <span className="text-slate-300">|</span>
            <span>
              SĐT: <strong className="font-bold text-slate-900">{patient.phone}</strong>
            </span>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {vitalSigns ? (
            <div className="flex items-stretch divide-x divide-slate-300 rounded-lg border border-slate-200 bg-slate-100">
              <VitalChip label="Mạch" value={vitalSigns.pulse} unit="l/p" tier={warningFields.has('pulse') ? 'danger' : 'normal'} />
              <VitalChip
                label="Huyết áp"
                value={vitalSigns.bpSystolic != null && vitalSigns.bpDiastolic != null ? `${vitalSigns.bpSystolic}/${vitalSigns.bpDiastolic}` : null}
                unit="mmHg"
                tier={warningFields.has('bpSystolic') || warningFields.has('bpDiastolic') ? 'danger' : 'normal'}
              />
              <VitalChip
                label="Nhiệt độ"
                value={vitalSigns.temperatureC}
                unit="°C"
                tier={warningFields.has('temperatureC') ? 'danger' : 'normal'}
              />
              <VitalChip label="SpO2" value={vitalSigns.spo2} unit="%" tier={warningFields.has('spo2') ? 'danger' : 'normal'} />
              <VitalChip
                label="Cân nặng"
                value={vitalSigns.weightGram != null ? Math.round(vitalSigns.weightGram / 1000) : null}
                unit="kg"
                tier={warningFields.has('weightGram') ? 'danger' : 'normal'}
              />
              <VitalChip
                label="BMI"
                value={bmi != null ? bmi.toFixed(1) : null}
                unit=""
                tier={bmi != null ? bmiClass?.tier : 'normal'}
                sublabel={bmiClass?.label}
              />
            </div>
          ) : (
            <span className="text-xs text-slate-400">Chưa có dữ liệu sinh hiệu</span>
          )}
          <button
            type="button"
            onClick={() => setVitalsDialogOpen(true)}
            title={vitalSigns ? 'Cập nhật sinh hiệu' : 'Bổ sung sinh hiệu'}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-600"
          >
            {vitalSigns ? <PencilSimple size={14} weight="bold" aria-hidden="true" /> : <Plus size={15} weight="bold" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {vitalsDialogOpen && (
        <VitalSignsDialog encounterId={encounterId} current={vitalSigns} onClose={() => setVitalsDialogOpen(false)} />
      )}

      {/* Không gian làm việc chính — chia đôi */}
      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr] bg-slate-50">
        {/* Panel trái — tiền sử */}
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
          <div className="flex h-11 flex-shrink-0 items-center gap-1.5 border-b border-slate-200 px-3.5">
            <ClockCounterClockwise size={14} weight="bold" className="text-slate-400" aria-hidden="true" />
            <span className="text-xs font-bold uppercase tracking-wide text-slate-700">Tiền sử &amp; lịch sử khám</span>
          </div>
          <div className="scroll-hover flex-1 overflow-y-auto p-3">
            {history.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">Chưa có lượt khám nào trước đây.</p>}
            {history.length > 0 && (
              <>
                <SectionLabel>Lần khám gần nhất</SectionLabel>
                <HistoryCard item={history[0]!} highlighted />
              </>
            )}
            {history.length > 1 && (
              <>
                <SectionLabel className="mt-3">Lịch sử cũ hơn</SectionLabel>
                <div className="flex flex-col gap-2">
                  {history.slice(1).map((item) => (
                    <HistoryCard key={item.encounterId} item={item} />
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>

        {/* Panel phải — khu vực làm việc */}
        <main className="flex min-h-0 flex-col">
          <div className="flex h-11 flex-shrink-0 gap-1 border-b border-slate-200 bg-white px-4">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => scrollToTab(tab.id)}
                className="flex h-full items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-semibold text-slate-500 hover:text-blue-700"
              >
                <tab.icon size={15} weight="bold" aria-hidden="true" />
                {tab.label}
                {tab.comingSoon && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Sắp ra mắt</span>
                )}
              </button>
            ))}
          </div>

          <div className="scroll-hover flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-6" ref={sectionRefs['section-kham']}>
              {/* "THÔNG TIN KHÁM LÂM SÀNG" — MỘT khung duy nhất (không tách 3 khung riêng như bản
                  trước), gộp Tiền sử/Thăm khám/Chẩn đoán bằng tiêu đề phụ nhẹ bên trong; ô nhập rút
                  gọn ~50% (`Textarea dense`) và lưới 3 cột để gọn hơn, theo phản hồi chủ dự án. */}
              <div className="relative rounded-lg border border-slate-200 bg-white p-5 pt-8 shadow-sm">
                <span className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                  <Stethoscope size={12} weight="bold" aria-hidden="true" />
                  Thông tin khám lâm sàng
                </span>

                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-700">Tiền sử</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Textarea
                    id="clinical-personal-history"
                    label="Tiền sử bản thân"
                    dense
                    rows={2}
                    value={clinical.personalHistory}
                    onChange={(e) => setField('personalHistory', e.target.value)}
                  />
                  <Textarea
                    id="clinical-family-history"
                    label="Tiền sử gia đình"
                    dense
                    rows={2}
                    value={clinical.familyHistory}
                    onChange={(e) => setField('familyHistory', e.target.value)}
                  />
                  <div>
                    <label htmlFor="clinical-allergy" className="mb-1 block text-sm font-semibold text-rose-600">
                      Tiền sử dị ứng
                    </label>
                    <textarea
                      id="clinical-allergy"
                      rows={2}
                      value={allergyDraft}
                      onChange={(e) => setAllergyDraft(e.target.value)}
                      placeholder="Chưa có ghi chú dị ứng lúc tiếp nhận — nhập mới nếu cần."
                      className="w-full rounded-md border border-rose-200 bg-rose-50/40 px-2 py-1.5 text-[13px] font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>
                </div>

                <h3 className="mb-2 mt-4 border-t border-dashed border-slate-200 pt-3 text-[11px] font-bold uppercase tracking-wide text-slate-700">
                  Thăm khám
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Textarea
                    id="clinical-reason"
                    label="Lý do khám"
                    required
                    dense
                    rows={2}
                    value={clinical.reasonForVisit}
                    onChange={(e) => setField('reasonForVisit', e.target.value)}
                  />
                  <Textarea
                    id="clinical-illness-progress"
                    label="Quá trình bệnh lý"
                    dense
                    rows={2}
                    value={clinical.illnessProgress}
                    onChange={(e) => setField('illnessProgress', e.target.value)}
                  />
                  <Textarea
                    id="clinical-preliminary-diagnosis"
                    label="Chuẩn đoán"
                    required
                    dense
                    rows={2}
                    value={clinical.preliminaryDiagnosis}
                    onChange={(e) => setField('preliminaryDiagnosis', e.target.value)}
                  />
                  <Textarea
                    id="clinical-general-exam"
                    label="Kết quả khám toàn thân"
                    dense
                    rows={2}
                    value={clinical.generalExam}
                    onChange={(e) => setField('generalExam', e.target.value)}
                  />
                  <Textarea
                    id="clinical-regional-exam"
                    label="Kết quả khám bộ phận"
                    dense
                    rows={2}
                    value={clinical.regionalExam}
                    onChange={(e) => setField('regionalExam', e.target.value)}
                  />
                </div>

                <h3 className="mb-2 mt-4 border-t border-dashed border-slate-200 pt-3 text-[11px] font-bold uppercase tracking-wide text-slate-700">
                  Chẩn đoán bệnh (ICD-10) <span className="text-rose-500">*</span>
                </h3>
                <Icd10DiagnosisPicker excludeCodes={diagnoses.map((d) => d.icd10Code)} onSelect={handleAddDiagnosis} />

                <div className="mt-2.5 flex flex-col gap-1.5">
                  {diagnoses.length === 0 && <p className="text-xs text-slate-400">Chưa chọn chẩn đoán nào.</p>}
                  {diagnoses.map((d) => (
                    <div
                      key={d.icd10Code}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                        d.type === 'PRIMARY' ? 'border-l-4 border-l-blue-600 border-y-slate-200 border-r-slate-200 bg-blue-50' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="text-sm text-slate-900">
                        <span
                          className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            d.type === 'PRIMARY' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {DIAGNOSIS_TYPE_LABEL[d.type]}
                        </span>
                        <strong>{d.icd10Code}</strong> — {d.icd10Name}
                      </div>
                      <div className="flex items-center gap-2">
                        {d.type !== 'PRIMARY' && (
                          <button
                            type="button"
                            onClick={() => handleSetPrimary(d.icd10Code)}
                            className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                          >
                            Đặt làm bệnh chính
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveDiagnosis(d.icd10Code)}
                          className="text-slate-400 hover:text-rose-600"
                          aria-label={`Bỏ chẩn đoán ${d.icd10Code}`}
                        >
                          <X size={15} weight="bold" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION 2-4 — chỉ giữ chỗ, ngoài phạm vi v1/Sprint 4 */}
              {TABS.filter((t) => t.comingSoon).map((tab) => (
                <div key={tab.id} ref={sectionRefs[tab.id]} className="rounded-lg border border-dashed border-slate-300 bg-white p-8">
                  <EmptyState icon={tab.icon} title={tab.label.replace(/^\d\.\s*/, '')} description="Tính năng sẽ có ở giai đoạn sau." />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      {/* Thanh hành động cố định */}
      <footer className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <div className="text-xs text-slate-500">
          {formError && <span className="font-medium text-rose-600">{formError}</span>}
          {!formError && draftSaved && (
            <span className="flex items-center gap-1.5 font-medium text-emerald-600">
              <CheckCircle size={14} weight="fill" aria-hidden="true" /> Đã lưu nháp
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            loading={saveClinicalNoteMutation.isPending || updatePatientMutation.isPending}
            onClick={() => void handleSaveDraft()}
          >
            Lưu nháp
          </Button>
          <Button type="button" loading={completeMutation.isPending} onClick={() => void handleComplete()}>
            <CheckCircle size={15} weight="bold" aria-hidden="true" />
            Hoàn tất khám
          </Button>
        </div>
      </footer>
    </div>
  );
}

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-700 ${className}`}>{children}</div>;
}

/**
 * Thẻ tóm tắt 1 lần khám trước — lần gần nhất nổi bật (viền/nền xanh, đúng mockup đã duyệt
 * `docs/design/encounter-consultation-mockup.html`), các lần cũ hơn phẳng hơn. CHỈ hiển thị 3
 * trường đã chốt phạm vi (`docs/DECISIONS.md` #059 — "panel tiền sử chỉ cần danh sách tóm tắt: ngày
 * khám, lý do khám, chẩn đoán chính"): không có tên bác sĩ/đơn thuốc cũ/kết quả xét nghiệm — những
 * trường đó không có trong `EncounterHistoryItem`, xem chi tiết ghi chú từng lần khám cũ để dành sau.
 */
function HistoryCard({ item, highlighted = false }: { item: EncounterHistoryItem; highlighted?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlighted ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'}`}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-blue-700">
        <CalendarBlank size={12} weight="bold" aria-hidden="true" />
        {formatHistoryDate(item.checkedInAt)}
        <span className="font-normal text-slate-400">({formatRelativeTime(item.checkedInAt)})</span>
      </div>
      {item.primaryDiagnosisName && <div className="mb-1 text-sm font-bold text-slate-900">{item.primaryDiagnosisName}</div>}
      {item.chiefComplaint && <div className="text-xs leading-relaxed text-slate-500">Lý do: {item.chiefComplaint}</div>}
    </div>
  );
}

type VitalTier = 'normal' | 'caution' | 'danger';

const TIER_TEXT_CLASS: Record<VitalTier, string> = {
  normal: 'text-slate-900',
  caution: 'text-amber-600',
  danger: 'text-rose-600',
};

/** Chấm trạng thái cạnh nhãn — khôi phục theo yêu cầu chủ dự án (đã bỏ nhầm lúc gộp bố cục 1 dòng
 * ở #060, chỉ nên bỏ dòng phân loại thứ 3 gây lệch hàng, không phải bỏ luôn tín hiệu màu chấm). */
const TIER_DOT_CLASS: Record<VitalTier, string> = {
  normal: 'bg-emerald-500',
  caution: 'bg-amber-500',
  danger: 'bg-rose-600',
};

/**
 * Phân loại BMI (chuẩn WHO khu vực Châu Á - Thái Bình Dương, chốt 2026-08-20 theo yêu cầu chủ dự
 * án): <18.5 Thiếu cân, 18.5–22.9 Bình thường, 23–24.9 Thừa cân, 25–29.9 Béo phì độ I, ≥30 Béo phì
 * độ II. Chỉ "Bình thường" là `normal` — thiếu cân/thừa cân ở mức `caution` (amber), 2 mức béo phì
 * ở `danger` (rose), đúng "Tín hiệu Y tế" mục 2.1 ui-guidelines.md.
 */
function classifyBmi(bmi: number): { label: string; tier: VitalTier } {
  if (bmi < 18.5) return { label: 'Thiếu cân', tier: 'caution' };
  if (bmi < 23.0) return { label: 'Bình thường', tier: 'normal' };
  if (bmi < 25.0) return { label: 'Thừa cân', tier: 'caution' };
  if (bmi < 30.0) return { label: 'Béo phì độ I', tier: 'danger' };
  return { label: 'Béo phì độ II', tier: 'danger' };
}

/**
 * Nhãn + giá trị (kèm đơn vị/phân loại BMI) trên CÙNG một dòng — theo mẫu tham khảo chủ dự án gửi
 * (gọn hơn bản 3 dòng trước, mọi ô tự nhiên cùng chiều cao nên không còn lệch hàng). Giá trị bất
 * thường đổi màu (đúng "Tín hiệu Y tế" mục 2.1 ui-guidelines.md), kèm chấm trạng thái cạnh nhãn
 * (`TIER_DOT_CLASS`) — không chỉ dựa màu chữ (quy tắc "Color Only" trong bộ UX checklist).
 * Container cha (nơi gọi component này) dùng `divide-x` để vẽ đường kẻ dọc phân cách RÕ giữa từng
 * ô — chủ dự án gửi ảnh tham khảo yêu cầu tách bạch rõ ràng hơn bản cũ (chỉ có khoảng cách `gap`,
 * không có đường kẻ). `px-3 py-2` ở đây tạo khoảng đệm đều hai bên mỗi ô cho đường kẻ có chỗ thở.
 */
function VitalChip({
  label,
  value,
  unit,
  tier = 'normal',
  sublabel,
}: {
  label: string;
  value: string | number | null | undefined;
  unit: string;
  tier?: VitalTier;
  sublabel?: string;
}) {
  const hasValue = value != null;
  const effectiveTier = hasValue ? tier : 'normal';
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 text-center">
      <span className="flex items-center gap-1">
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${TIER_DOT_CLASS[effectiveTier]}`} aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </span>
      <span className={`whitespace-nowrap text-sm font-bold ${TIER_TEXT_CLASS[effectiveTier]}`}>
        {value ?? '—'}
        {hasValue && unit && <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>}
        {hasValue && sublabel && <span className="ml-1.5 text-xs font-semibold">{sublabel}</span>}
      </span>
    </div>
  );
}