import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowCounterClockwise,
  CalendarBlank,
  CaretRight,
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
  XCircle,
} from '@phosphor-icons/react';
import type { ClinicalNoteSection, ConsultationDetailResponse, DiagnosisType, EncounterHistoryItem, PatientAllergenItem, SaveClinicalNoteRequest } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { useAutoCollapseSidebar } from '../../shared/layout/sidebar.context';
import { ApiError } from '../../shared/api/client';
import { ActionMenu } from '../../shared/ui/ActionMenu';
import { Button } from '../../shared/ui/Button';
import { BreakGlassDialog } from '../../shared/ui/BreakGlassDialog';
import { CancelEncounterDialog } from '../../shared/ui/CancelEncounterDialog';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ReleaseEncounterDialog } from '../../shared/ui/ReleaseEncounterDialog';
import { Skeleton } from '../../shared/ui/Skeleton';
import { Textarea } from '../../shared/ui/Textarea';
import { computeAgeLabel, buildHistoryUpdatePayload, consultationPatientToHistoryFormValues } from '../patient/patient-form.utils';
import { PatientHistoryDialog } from '../patient/PatientHistoryDialog';
import { CLINICAL_SECTION_LABEL, DIAGNOSIS_TYPE_LABEL, VitalChip, classifyBmi, type ClinicalKey } from './clinical-display';
import { EncounterHistoryDetailDialog } from './EncounterHistoryDetailDialog';
import type { PatientFormValues } from '../patient/PatientFormFields';
import { formatDobDisplay } from '../../shared/format/date';
import { useUpdatePatientMutation } from '../patient/patient.queries';
import { Icd10SearchPicker } from '../../shared/ui/Icd10SearchPicker';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { PrescriptionPanel } from './PrescriptionPanel';
import { VitalSignsDialog } from './VitalSignsDialog';
import { saveClinicalNote as saveClinicalNoteRaw } from './encounter.api';
import {
  useAmendClinicalNoteMutation,
  useAmendDiagnosesMutation,
  useCompleteConsultationMutation,
  useConsultationDetailQuery,
  useSaveClinicalNoteMutation,
  useSaveDiagnosesMutation,
} from './encounter.queries';

const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' };
/** Ký hồ sơ khám (Sprint 5, S5-02/03) — ghép field form (`ClinicalKey`) sang mã section thật gửi lên `.../clinical-note/amend`. */
const CLINICAL_SECTION_CODE: Record<ClinicalKey, ClinicalNoteSection> = {
  reasonForVisit: 'REASON_FOR_VISIT',
  illnessProgress: 'ILLNESS_PROGRESS',
  preliminaryDiagnosis: 'PRELIMINARY_DIAGNOSIS',
  generalExam: 'GENERAL_EXAM',
  regionalExam: 'REGIONAL_EXAM',
  plan: 'PLAN',
};

type ClinicalDraft = Record<ClinicalKey, string>;
const EMPTY_CLINICAL_DRAFT: ClinicalDraft = {
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
  /** Ký hồ sơ khám (Sprint 5, S5-02/03) — có giá trị = dòng này vừa được đính chính, hiện badge. */
  amendmentReason?: string | null;
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

/** Thói quen/lối sống dùng CHUNG mảng `patient.conditions` với bệnh lý nền, mã hoá ICD-10 Chương XXI (Z72.x) — xem `PatientHistoryDialog.tsx`. */
function isHabitConditionCode(icd10Code: string): boolean {
  return icd10Code.startsWith('Z72');
}

const TABS = [
  { id: 'section-kham', label: '1. Khám & Chẩn đoán', icon: ClipboardText, comingSoon: false },
  { id: 'section-cls', label: '2. Chỉ định cận lâm sàng', icon: Flask, comingSoon: true },
  // Sprint 4 (S4-01/02/04) — tab 3 nay có nội dung thật (PrescriptionPanel), không còn "Sắp ra mắt".
  { id: 'section-donthuoc', label: '3. Kê đơn thuốc', icon: Pill, comingSoon: false },
  { id: 'section-hen', label: '4. Lời dặn & hẹn tái khám', icon: CalendarBlank, comingSoon: true },
] as const;

/** Thứ tự THẬT của các section trong DOM (khác thứ tự `TABS` — "Kê đơn thuốc" render trước 2 mục "Sắp ra mắt", xem JSX phía dưới `EncounterConsultationPage`), dùng để chọn đúng section đang xem khi nhiều section cùng lọt vào dải phát hiện của scroll-spy. */
const SECTION_SCROLL_ORDER = ['section-kham', 'section-donthuoc', 'section-cls', 'section-hen'] as const;

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

  // `loadedForId` (thay cho `initialized` boolean cũ) — nạp bản nháp từ server đúng 1 lần MỖI
  // lượt khám, không phải đúng 1 lần cho cả vòng đời component. Bug thật phát hiện lúc sửa lỗi
  // vận hành khác (docs/DECISIONS.md): trang `/encounters/:id` không có `key` theo id nên
  // React Router KHÔNG remount khi bấm từ dải hàng chờ sang lượt khám khác cùng route — `initialized`
  // boolean cũ không bao giờ reset, khiến bản nháp CŨ của bệnh nhân trước đó tiếp tục hiện trên màn
  // hình bệnh nhân mới (không phải "mất dữ liệu" mà còn nguy hiểm hơn: lẫn dữ liệu 2 bệnh nhân).
  const [loadedForId, setLoadedForId] = useState<string | null>(null);
  /**
   * Tab panel trái ("Tiền sử bệnh" | "Lịch sử khám", theo yêu cầu chủ dự án — tách hẳn 2 tab thay vì
   * cuộn chung 1 cột, giải quyết triệt để thiếu không gian). Mặc định: bệnh nhân MỚI (chưa có lượt
   * khám nào trước đây) → mở "Tiền sử bệnh"; bệnh nhân CŨ (đã có lịch sử) → mở "Lịch sử khám" (bác sĩ
   * thường cần xem lần khám trước trước khi khám mới) — quyết định lúc nạp dữ liệu, xem effect dưới.
   */
  const [historyPanelTab, setHistoryPanelTab] = useState<'personal' | 'visits'>('visits');
  const [clinical, setClinical] = useState<ClinicalDraft>(EMPTY_CLINICAL_DRAFT);
  const [clinicalVersions, setClinicalVersions] = useState<Partial<Record<ClinicalKey, number>>>({});
  const [diagnoses, setDiagnoses] = useState<DiagnosisDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [vitalsDialogOpen, setVitalsDialogOpen] = useState(false);
  /** "Xem chi tiết đợt khám cũ" (mockup đã duyệt 2026-08-29) — thẻ đã bấm trong panel "Lịch sử khám", `null` = dialog đóng. */
  const [openHistoryItem, setOpenHistoryItem] = useState<EncounterHistoryItem | null>(null);
  /** Dialog "Tiền sử bệnh nhân" (Dị ứng/Bản thân/Gia đình) — dùng lại `PatientHistoryDialog` đã có sẵn, mở từ nút "+ Thêm" ở panel Tiền sử bên trái. */
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  // "Xem lại" một lượt khám đã "Hoàn tất khám" — mặc định chỉ xem, bấm "Chỉnh sửa thông tin" mới mở
  // lại các ô nhập (lỗi vận hành thật chủ dự án báo cáo, xem docs/DECISIONS.md).
  const [editingCompleted, setEditingCompleted] = useState(false);
  // Xin vượt quyền tạm thời (break-glass) khi thao tác lưu bị chặn 403 — `retry` gọi lại đúng thao
  // tác vừa bị chặn sau khi xin thành công, xem `BreakGlassDialog`.
  const [breakGlassPrompt, setBreakGlassPrompt] = useState<{ entityType: string; retry: () => void } | null>(null);
  /** Popup "Hoàn tất khám thành công" — cùng khuôn popup "Tiếp nhận thành công" (`ReceptionIntakeForm.tsx`), theo yêu cầu chủ dự án. */
  const [showCompleteSuccessDialog, setShowCompleteSuccessDialog] = useState(false);
  /** #085 "Khách bỏ về" ngay tại màn khám — bác sĩ đang khám dở phát hiện khách đã rời đi. */
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  /** "Trả về hàng chờ" ngay tại màn khám — trước đây phải quay ra "Hàng đợi khám" mới trả được,
   * theo yêu cầu chủ dự án (lỗ hổng thao tác thật phát hiện lúc dùng thử). */
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  /**
   * "Đính chính" (Sprint 5, S5-02/03) — hồ sơ đã ký (`isCompleted`) không sửa tại chỗ được nữa, chỉ
   * qua 2 dialog này (bắt buộc lý do). Chẩn đoán: list-editor đầy đủ (đúng khuôn `PrescriptionPanel`
   * "Sửa đơn"). Ghi chú khám: 1 dialog gộp cả 6 mục — chỉ mục THỰC SỰ đổi nội dung mới gửi lên
   * (`buildClinicalNoteAmendSections`), tránh tạo lịch sử đính chính vô ích cho mục không đổi.
   */
  const [diagnosisAmendOpen, setDiagnosisAmendOpen] = useState(false);
  const [diagnosisAmendItems, setDiagnosisAmendItems] = useState<DiagnosisDraft[]>([]);
  const [diagnosisAmendReason, setDiagnosisAmendReason] = useState('');
  const [clinicalAmendOpen, setClinicalAmendOpen] = useState(false);
  const [clinicalAmendDraft, setClinicalAmendDraft] = useState<ClinicalDraft>(EMPTY_CLINICAL_DRAFT);
  const [clinicalAmendReason, setClinicalAmendReason] = useState('');

  // Cho phép bấm Enter để xác nhận popup "Hoàn tất khám thành công" (yêu cầu chủ dự án) — nghe
  // phím ở `window` thay vì chỉ `autoFocus` nút, vì Enter cần hoạt động dù focus đang ở đâu (ví dụ
  // vẫn còn ở ô nhập cuối cùng lúc popup vừa hiện).
  useEffect(() => {
    if (!showCompleteSuccessDialog) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigate('/reception/doctor-queue');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCompleteSuccessDialog, navigate]);

  /** Loại tiếp nhận (Khám mới/Tái khám/...) — chỉ có mã ở `encounter.receptionTypeCode`, tự resolve tên hiển thị qua danh mục dùng chung, hiện ở banner cạnh SĐT. */
  const receptionTypeCatalogQuery = useReferenceCatalogQuery('RECEPTION_TYPE');
  const saveDiagnosesMutation = useSaveDiagnosesMutation(encounterId);
  const saveClinicalNoteMutation = useSaveClinicalNoteMutation(encounterId);
  const amendDiagnosesMutation = useAmendDiagnosesMutation(encounterId);
  const amendClinicalNoteMutation = useAmendClinicalNoteMutation(encounterId);
  const completeMutation = useCompleteConsultationMutation(encounterId);
  const updatePatientMutation = useUpdatePatientMutation(query.data?.patient.id ?? '');

  const isCompleted = query.data?.encounter.status === 'COMPLETED';
  /** Kê đơn (Sprint 4) vẫn giữ nguyên "mở khoá sửa tại chỗ" sau hoàn tất — module riêng, chưa ký tự động. */
  const canEditNow = !isCompleted || editingCompleted;
  /**
   * Chẩn đoán/ghi chú khám (Sprint 5, S5-02/03) — "Hoàn tất khám" ký NGAY cả hai, nên KHÔNG còn sửa
   * tại chỗ được sau khi hoàn tất (khác `canEditNow` ở trên, dành cho Kê đơn). Sau khi hoàn tất, sửa
   * phải qua "Đính chính" (2 dialog riêng), không mở khoá input trực tiếp nữa.
   */
  const canEditDraft = !isCompleted;

  // Luôn giữ bản mới nhất trong ref — dùng cho autosave debounce/flush lúc rời trang (effect cleanup
  // đóng gói giá trị lúc effect được TẠO, không phải lúc effect CHẠY, nên phải đọc qua ref để luôn
  // lấy đúng nội dung mới nhất thay vì bản state đã cũ tại thời điểm effect setup).
  const clinicalRef = useRef(clinical);
  clinicalRef.current = clinical;
  const clinicalVersionsRef = useRef(clinicalVersions);
  clinicalVersionsRef.current = clinicalVersions;
  /** `true` = có thay đổi ở ghi chú lâm sàng chưa lưu lên server. */
  const dirtyRef = useRef(false);
  /** Bỏ qua đúng 1 lần đánh dấu "dirty" ngay sau khi nạp dữ liệu từ server — tránh autosave tưởng
   * nhầm việc NẠP dữ liệu là NGƯỜI DÙNG vừa gõ. */
  const skipNextDirtyRef = useRef(false);

  const sectionRefs = {
    'section-kham': useRef<HTMLDivElement>(null),
    'section-cls': useRef<HTMLDivElement>(null),
    'section-donthuoc': useRef<HTMLDivElement>(null),
    'section-hen': useRef<HTMLDivElement>(null),
  };
  const [activeTabId, setActiveTabId] = useState<keyof typeof sectionRefs>('section-kham');
  const workspaceScrollRef = useRef<HTMLDivElement>(null);
  /** `true` trong lúc `scrollIntoView({behavior:'smooth'})` do bấm tab đang chạy — scroll-spy tạm ngưng tính lại theo từng khung hình cuộn để tránh giật/nhấp nháy qua các tab liền kề (xem effect scroll-spy bên dưới). */
  const isProgrammaticScrollRef = useRef(false);
  /** Timeout dự phòng bật lại scroll-spy nếu sự kiện `scrollend` không bắn (một số trình duyệt/tình huống). */
  const programmaticScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Đổ dữ liệu server vào form — dùng lúc nạp lần đầu MỖI lượt khám (effect dưới) và lúc bấm "Huỷ" giữa chừng sửa (`handleCancelEdit`). */
  function populateFromServer(data: ConsultationDetailResponse) {
    const note = data.clinicalNote;
    skipNextDirtyRef.current = true;
    setClinical({
      // Chưa từng lưu thì mồi sẵn từ lý do tiếp nhận (`encounter.chiefComplaint`) — bác sĩ gõ
      // thêm/sửa trên đó. Đã lưu rồi (kể cả rỗng có chủ đích) thì tôn trọng đúng giá trị đã lưu.
      reasonForVisit: note.reasonForVisit ? note.reasonForVisit.content : (data.encounter.chiefComplaint ?? ''),
      illnessProgress: note.illnessProgress?.content ?? '',
      preliminaryDiagnosis: note.preliminaryDiagnosis?.content ?? '',
      generalExam: note.generalExam?.content ?? '',
      regionalExam: note.regionalExam?.content ?? '',
      plan: note.plan?.content ?? '',
    });
    setClinicalVersions({
      reasonForVisit: note.reasonForVisit?.version,
      illnessProgress: note.illnessProgress?.version,
      preliminaryDiagnosis: note.preliminaryDiagnosis?.version,
      generalExam: note.generalExam?.version,
      regionalExam: note.regionalExam?.version,
      plan: note.plan?.version,
    });
    setDiagnoses(data.diagnoses.map((d) => ({ icd10Code: d.icd10Code, icd10Name: d.icd10Name, type: d.type, note: d.note ?? undefined, amendmentReason: d.amendmentReason })));
    dirtyRef.current = false;
  }

  // Nạp bản nháp từ server đúng 1 lần MỖI lượt khám (`loadedForId !== encounterId`, không phải chỉ
  // "chưa từng nạp bao giờ") — không ghi đè lại mỗi lần refetch cùng 1 lượt khám (sau khi lưu chẩn
  // đoán/ghi chú) để không mất chỉnh sửa đang gõ dở ở các ô khác, nhưng PHẢI nạp lại khi chuyển sang
  // lượt khám khác (xem chú thích ở khai báo `loadedForId`).
  useEffect(() => {
    if (query.isSuccess && loadedForId !== encounterId) {
      populateFromServer(query.data);
      setEditingCompleted(false);
      setFormError(null);
      setDraftSaved(false);
      setHistoryPanelTab(query.data.history.length === 0 ? 'personal' : 'visits');
      setLoadedForId(encounterId);
    }
  }, [query.isSuccess, query.data, loadedForId, encounterId]);

  /** Khớp đúng payload `PUT .../clinical-note` từ state form — dùng chung cho "Lưu nháp"/"Lưu thay đổi", autosave định kỳ, và flush lúc rời trang. */
  function buildClinicalNotePayload(c: ClinicalDraft, v: Partial<Record<ClinicalKey, number>>): SaveClinicalNoteRequest {
    return {
      reasonForVisit: { content: c.reasonForVisit, version: v.reasonForVisit },
      illnessProgress: { content: c.illnessProgress, version: v.illnessProgress },
      preliminaryDiagnosis: { content: c.preliminaryDiagnosis, version: v.preliminaryDiagnosis },
      generalExam: { content: c.generalExam, version: v.generalExam },
      regionalExam: { content: c.regionalExam, version: v.regionalExam },
      plan: { content: c.plan, version: v.plan },
    };
  }

  /** "Lý do khám"/"Chẩn đoán" bắt buộc (Zod `saveClinicalNoteRequestSchema`) — autosave/flush im lặng bỏ qua tới khi đủ, tránh 400 giữa chừng lúc bác sĩ chưa gõ tới đó. */
  function hasRequiredClinicalFields(c: ClinicalDraft): boolean {
    return c.reasonForVisit.trim() !== '' && c.preliminaryDiagnosis.trim() !== '';
  }

  // Autosave ghi chú lâm sàng — CHỈ khi đang khám dở (chưa "Hoàn tất khám"): mỗi lần `clinical` đổi,
  // đợi ~4 giây ngừng gõ (debounce) rồi tự lưu lên server, không cần bác sĩ nhớ bấm "Lưu nháp". Lỗi
  // vận hành thật chủ dự án báo cáo: rời màn khám sang bệnh nhân khác khi chưa lưu → mất trắng nội
  // dung đang gõ dở (xem docs/DECISIONS.md). Sửa hồ sơ SAU khi đã hoàn tất KHÔNG autosave (phiên sửa
  // ngắn, chủ động — chỉ lưu khi bấm "Lưu thay đổi", tránh autosave âm thầm đụng break-glass).
  useEffect(() => {
    if (skipNextDirtyRef.current) {
      skipNextDirtyRef.current = false;
      return;
    }
    if (isCompleted) return;
    dirtyRef.current = true;
    const timer = setTimeout(() => void runAutosave(), 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ cần đổi `clinical` mới reset debounce, đọc các giá trị khác qua ref/closure lúc timer chạy là đủ mới.
  }, [clinical]);

  async function runAutosave() {
    if (!dirtyRef.current) return;
    const c = clinicalRef.current;
    if (!hasRequiredClinicalFields(c)) return;
    try {
      const result = await saveClinicalNoteMutation.mutateAsync(buildClinicalNotePayload(c, clinicalVersionsRef.current));
      setClinicalVersions({
        reasonForVisit: result.reasonForVisit?.version,
        illnessProgress: result.illnessProgress?.version,
        preliminaryDiagnosis: result.preliminaryDiagnosis?.version,
        generalExam: result.generalExam?.version,
        regionalExam: result.regionalExam?.version,
        plan: result.plan?.version,
      });
      dirtyRef.current = false;
      setDraftSaved(true);
    } catch {
      // Im lặng — autosave chạy nền, không làm phiền bác sĩ đang gõ. Vòng debounce kế tiếp (gõ thêm
      // ký tự bất kỳ) hoặc bấm "Lưu nháp" thủ công sẽ thử lại; lỗi dai dẳng sẽ lộ ra rõ ràng khi đó.
    }
  }

  // Rời trang HOẶC chuyển sang lượt khám khác (route `/encounters/:id` không remount khi chỉ đổi
  // `id`, xem chú thích `loadedForId`) mà còn nội dung chưa lưu — cố lưu 1 lần cuối trước khi state
  // của lượt khám này biến mất. Đóng closure trực tiếp qua `encounterId` (không qua ref) để cleanup
  // của ĐÚNG lượt khám cũ chạy với đúng id cũ — effect này tạo lại mỗi khi `encounterId` đổi, cleanup
  // của bản trước luôn gắn với `encounterId` tại thời điểm nó được tạo. Gọi thẳng API (không qua
  // mutation hook, vì hook đã gắn với `encounterId` MỚI ngay khi render lại) — không cập nhật state
  // sau đó vì component có thể đã rời màn hình khám hẳn.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        const c = clinicalRef.current;
        if (hasRequiredClinicalFields(c)) {
          void saveClinicalNoteRaw(encounterId, buildClinicalNotePayload(c, clinicalVersionsRef.current)).catch(() => {});
        }
        dirtyRef.current = false;
      }
    };
  }, [encounterId]);

  function scrollToTab(sectionId: keyof typeof sectionRefs) {
    setActiveTabId(sectionId); // phản hồi ngay lúc bấm, không đợi cuộn xong scroll-spy mới xác nhận lại
    // Chặn scroll-spy tính lại theo từng khung hình TRONG LÚC cuộn mượt — bug thật đã gặp: cuộn
    // qua section dài (ví dụ "Thông tin khám lâm sàng") khiến scroll-spy liên tục đổi tab theo
    // đúng vị trí TỨC THỜI của từng khung hình, nhìn như nhảy qua tab liền kề rồi mới về đúng tab
    // vừa bấm — giật/lag rõ. Coi tab vừa bấm là chính xác NGAY, chỉ bật lại scroll-spy sau khi
    // `scrollend` báo cuộn xong (kèm timeout dự phòng — `scrollend` không phải mọi trình duyệt đều
    // bắn đúng lúc cho `scrollIntoView` lập trình, xem MDN).
    isProgrammaticScrollRef.current = true;
    if (programmaticScrollTimeoutRef.current !== null) clearTimeout(programmaticScrollTimeoutRef.current);
    programmaticScrollTimeoutRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 700);
    sectionRefs[sectionId].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Scroll-spy: tab "đang chọn" theo đúng section đang nằm ở đỉnh khung nhìn của khu vực làm việc —
   * không chỉ đổi lúc bấm, người dùng cuộn tay cũng phải thấy đúng tab tương ứng được tô sáng.
   * Tính TRỰC TIẾP theo vị trí cuộn thật (không dùng `IntersectionObserver` — bug thật đã gặp:
   * trong lúc `scrollIntoView({behavior:'smooth'})` đang chạy, nhiều section cùng cắt ngưỡng gần
   * như đồng thời, thứ tự các lần bắn callback không khớp thứ tự thật trên màn hình → chọn nhầm
   * section liền sau). Thuật toán: section CUỐI CÙNG (theo `SECTION_SCROLL_ORDER`) đã cuộn qua khỏi
   * mép trên (cộng biên `TOP_OFFSET_PX`) là section đang xem. Bỏ qua tính lại khi đang cuộn do BẤM
   * TAB (`isProgrammaticScrollRef`, xem `scrollToTab`) — tránh giật/nhảy qua tab liền kề giữa lúc
   * cuộn; cuộn TAY (rê chuột/lăn chuột) vẫn tính lại bình thường, có `requestAnimationFrame` chặn
   * bớt tần suất tính lại (sự kiện `scroll` có thể bắn hàng chục lần/giây).
   */
  useEffect(() => {
    const root = workspaceScrollRef.current;
    if (!root || !query.data) return;

    const TOP_OFFSET_PX = 24;

    function computeActiveTab() {
      if (!root) return;
      // Đã cuộn hết đáy — section cuối có thể quá ngắn để mép trên của nó vượt qua `TOP_OFFSET_PX`
      // (không còn chỗ cuộn thêm), vòng lặp bên dưới sẽ không bao giờ chọn được nó nếu chỉ xét vị
      // trí. Ép chọn thẳng section cuối cùng trong trường hợp này.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 1) {
        setActiveTabId(SECTION_SCROLL_ORDER[SECTION_SCROLL_ORDER.length - 1]!);
        return;
      }
      let current: keyof typeof sectionRefs = SECTION_SCROLL_ORDER[0];
      for (const id of SECTION_SCROLL_ORDER) {
        const el = sectionRefs[id].current;
        if (!el) continue;
        const offsetWithinRoot = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
        if (offsetWithinRoot <= root.scrollTop + TOP_OFFSET_PX) {
          current = id;
        } else {
          break;
        }
      }
      setActiveTabId(current);
    }

    let rafId: number | null = null;
    function onScroll() {
      if (isProgrammaticScrollRef.current) return;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        computeActiveTab();
      });
    }

    function onScrollEnd() {
      isProgrammaticScrollRef.current = false;
      if (programmaticScrollTimeoutRef.current !== null) {
        clearTimeout(programmaticScrollTimeoutRef.current);
        programmaticScrollTimeoutRef.current = null;
      }
      computeActiveTab(); // tự sửa lại nếu vị trí cuộn cuối cùng lệch nhẹ so với tab vừa bấm
    }

    computeActiveTab();
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('scrollend', onScrollEnd, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('scrollend', onScrollEnd);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sectionRefs` là object bọc các `useRef` ổn định qua mọi lần render (chỉ object bọc đổi identity, không phải các ref bên trong) — chỉ cần chạy lại khi dữ liệu vừa nạp xong (refs mới có element thật để đọc vị trí).
  }, [query.data]);

  function setField(key: ClinicalKey, value: string) {
    setClinical((c) => ({ ...c, [key]: value }));
  }

  /**
   * Lỗi bị chặn `403 PERMISSION_DENIED` kèm `breakGlassAvailable` → mở dialog xin vượt quyền thay vì
   * chỉ hiện lỗi đỏ; `retry` gọi lại đúng thao tác vừa bị chặn sau khi xin thành công. Lỗi khác thì
   * hiện `formError` như cũ. Dùng chung cho mọi thao tác lưu ở màn hình này (chẩn đoán/ghi chú).
   */
  function handleSaveError(err: unknown, entityType: string, retry: () => void, fallbackMessage: string) {
    if (err instanceof ApiError && err.code === 'PERMISSION_DENIED' && (err.details as { breakGlassAvailable?: boolean } | undefined)?.breakGlassAvailable) {
      setBreakGlassPrompt({ entityType, retry });
      return;
    }
    setFormError(err instanceof ApiError ? err.message : fallbackMessage);
  }

  /**
   * Lưu ngay mỗi lần thêm/xoá/đổi bệnh chính — giữ bất biến "đúng 1 PRIMARY" tại mọi thời điểm nên
   * an toàn để gọi API luôn (không cần nút "Lưu" riêng cho khối chẩn đoán). Danh sách rỗng thì CHỈ
   * cập nhật UI cục bộ (API bắt buộc tối thiểu 1 dòng) — dữ liệu đã lưu trước đó trên server giữ
   * nguyên cho tới khi có ít nhất 1 chẩn đoán trở lại. Cũng dùng lại đúng hàm này khi sửa chẩn đoán
   * SAU khi đã "Hoàn tất khám" (backend đã mở khoá — xem `docs/DECISIONS.md`), chỉ khác ở chỗ UI gọi
   * hàm này có bị ẩn hay không (`canEditNow`, xem JSX bên dưới).
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
        result.items.map((d) => ({ icd10Code: d.icd10Code, icd10Name: d.icd10Name, type: d.type, note: d.note ?? undefined, amendmentReason: d.amendmentReason })),
      );
    } catch (err) {
      handleSaveError(err, 'diagnosis', () => void persistDiagnoses(next), 'Không lưu được chẩn đoán, vui lòng thử lại.');
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

  /** "Đính chính chẩn đoán" (Sprint 5, S5-02/03) — chỉ mở được sau khi đã ký (`isCompleted`). */
  function openDiagnosisAmend() {
    setDiagnosisAmendItems(diagnoses);
    setDiagnosisAmendReason('');
    setDiagnosisAmendOpen(true);
  }

  function handleAddAmendDiagnosis(item: { icd10Code: string; icd10Name: string }) {
    const type: DiagnosisType = diagnosisAmendItems.length === 0 ? 'PRIMARY' : 'SECONDARY';
    setDiagnosisAmendItems((prev) => [...prev, { icd10Code: item.icd10Code, icd10Name: item.icd10Name, type }]);
  }

  function handleSetAmendPrimary(code: string) {
    setDiagnosisAmendItems((prev) => prev.map((d) => ({ ...d, type: d.icd10Code === code ? 'PRIMARY' : 'SECONDARY' })));
  }

  function handleRemoveAmendDiagnosis(code: string) {
    setDiagnosisAmendItems((prev) => {
      const removed = prev.find((d) => d.icd10Code === code);
      const remaining = prev.filter((d) => d.icd10Code !== code);
      if (removed?.type === 'PRIMARY' && remaining.length > 0 && !remaining.some((d) => d.type === 'PRIMARY')) {
        remaining[0] = { ...remaining[0]!, type: 'PRIMARY' };
      }
      return remaining;
    });
  }

  async function handleDiagnosisAmendSubmit() {
    if (diagnosisAmendReason.trim() === '' || diagnosisAmendItems.length === 0) return;
    try {
      const result = await amendDiagnosesMutation.mutateAsync({
        diagnoses: diagnosisAmendItems.map((d) => ({ icd10Code: d.icd10Code, type: d.type, note: d.note })),
        amendmentReason: diagnosisAmendReason.trim(),
      });
      // Đồng bộ NGAY state cục bộ từ bản đính chính vừa lưu — cùng khuôn `persistDiagnoses()`, vì
      // `diagnoses` không tự đồng bộ lại từ `query.data` sau lần nạp đầu (xem `loadedForId`).
      setDiagnoses(result.items.map((d) => ({ icd10Code: d.icd10Code, icd10Name: d.icd10Name, type: d.type, note: d.note ?? undefined, amendmentReason: d.amendmentReason })));
      setDiagnosisAmendOpen(false);
    } catch (err) {
      handleSaveError(err, 'diagnosis', () => void handleDiagnosisAmendSubmit(), 'Không lưu được bản đính chính, vui lòng thử lại.');
    }
  }

  /** "Đính chính ghi chú khám" (Sprint 5, S5-02/03) — chỉ gửi lên MỤC THỰC SỰ đổi nội dung so với bản đã ký, tránh tạo lịch sử vô ích cho mục không đổi. */
  function openClinicalAmend() {
    setClinicalAmendDraft(clinical);
    setClinicalAmendReason('');
    setClinicalAmendOpen(true);
  }

  async function handleClinicalAmendSubmit() {
    if (clinicalAmendReason.trim() === '') return;
    const changedKeys = (Object.keys(clinicalAmendDraft) as ClinicalKey[]).filter((key) => clinicalAmendDraft[key] !== clinical[key]);
    if (changedKeys.length === 0) return;
    try {
      const result = await amendClinicalNoteMutation.mutateAsync({
        amendmentReason: clinicalAmendReason.trim(),
        sections: changedKeys.map((key) => ({
          section: CLINICAL_SECTION_CODE[key],
          content: clinicalAmendDraft[key],
          version: clinicalVersions[key]!,
        })),
      });
      // Đồng bộ NGAY state cục bộ từ bản đính chính vừa lưu — cùng lý do `handleDiagnosisAmendSubmit()`.
      setClinical(clinicalAmendDraft);
      setClinicalVersions({
        reasonForVisit: result.reasonForVisit?.version,
        illnessProgress: result.illnessProgress?.version,
        preliminaryDiagnosis: result.preliminaryDiagnosis?.version,
        generalExam: result.generalExam?.version,
        regionalExam: result.regionalExam?.version,
        plan: result.plan?.version,
      });
      setClinicalAmendOpen(false);
    } catch (err) {
      handleSaveError(err, 'clinical_note', () => void handleClinicalAmendSubmit(), 'Không lưu được bản đính chính, vui lòng thử lại.');
    }
  }

  /** "Lưu nháp" (đang khám) HOẶC "Lưu thay đổi" (đang sửa lại sau khi đã "Hoàn tất khám", `editingCompleted=true`) — cùng 1 hàm, tự thoát chế độ sửa sau khi lưu xong nếu đang ở nhánh sau. */
  async function handleSaveDraft() {
    setFormError(null);
    setDraftSaved(false);
    if (!hasRequiredClinicalFields(clinical)) {
      setFormError('"Lý do khám" và "Chẩn đoán" là bắt buộc.');
      return;
    }
    try {
      const result = await saveClinicalNoteMutation.mutateAsync(buildClinicalNotePayload(clinical, clinicalVersions));
      setClinicalVersions({
        reasonForVisit: result.reasonForVisit?.version,
        illnessProgress: result.illnessProgress?.version,
        preliminaryDiagnosis: result.preliminaryDiagnosis?.version,
        generalExam: result.generalExam?.version,
        regionalExam: result.regionalExam?.version,
        plan: result.plan?.version,
      });
      dirtyRef.current = false;
      setDraftSaved(true);
      if (editingCompleted) setEditingCompleted(false);
    } catch (err) {
      handleSaveError(err, 'clinical_note', () => void handleSaveDraft(), 'Không lưu được ghi chú, vui lòng thử lại.');
    }
  }

  /** "Huỷ" lúc đang sửa lại một lượt khám đã hoàn tất — bỏ mọi thay đổi cục bộ chưa lưu, nạp lại đúng dữ liệu thật trên server. */
  async function handleCancelEdit() {
    setFormError(null);
    const result = await query.refetch();
    if (result.data) populateFromServer(result.data);
    setEditingCompleted(false);
  }

  async function handleComplete() {
    setFormError(null);
    // Bảo hiểm cuối trước khi hoàn tất: còn nội dung ghi chú/dị ứng chưa lưu (chưa kịp tới mốc
    // autosave) thì LƯU TRƯỚC, chỉ hoàn tất khi lưu thành công — lỗi vận hành thật chủ dự án báo cáo
    // (trước đây "Hoàn tất khám" không quan tâm ghi chú đã lưu hay chưa, xem lại thì nội dung mất).
    if (dirtyRef.current) {
      const c = clinicalRef.current;
      if (!hasRequiredClinicalFields(c)) {
        setFormError('"Lý do khám" và "Chẩn đoán" là bắt buộc trước khi hoàn tất khám.');
        return;
      }
      try {
        const result = await saveClinicalNoteMutation.mutateAsync(buildClinicalNotePayload(c, clinicalVersionsRef.current));
        setClinicalVersions({
          reasonForVisit: result.reasonForVisit?.version,
          illnessProgress: result.illnessProgress?.version,
          preliminaryDiagnosis: result.preliminaryDiagnosis?.version,
          generalExam: result.generalExam?.version,
          regionalExam: result.regionalExam?.version,
          plan: result.plan?.version,
        });
        dirtyRef.current = false;
      } catch (err) {
        handleSaveError(err, 'clinical_note', () => void handleComplete(), 'Không lưu được ghi chú trước khi hoàn tất, vui lòng thử lại.');
        return;
      }
    }
    if (!diagnoses.some((d) => d.type === 'PRIMARY')) {
      setFormError('Phải có ít nhất một chẩn đoán chính trước khi hoàn tất khám.');
      return;
    }
    try {
      await completeMutation.mutateAsync({ version: query.data!.encounter.version });
      setShowCompleteSuccessDialog(true);
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

  const { encounter, patient, vitalSigns, history, prescription } = query.data;
  const bmi =
    vitalSigns?.weightGram && vitalSigns.heightMm
      ? vitalSigns.weightGram / 1000 / (vitalSigns.heightMm / 1000) ** 2
      : null;
  const bmiClass = bmi != null ? classifyBmi(bmi) : null;
  const warningFields = new Set((vitalSigns?.warnings ?? []).map((w) => w.field));
  /** Tách bệnh lý nền/thói quen khỏi cùng mảng `patient.conditions` để hiện 2 dòng riêng ở panel Tiền sử (xem `isHabitConditionCode`). */
  const personalDiseaseConditions = patient.conditions.filter((c) => !isHabitConditionCode(c.icd10Code));
  const personalHabitConditions = patient.conditions.filter((c) => isHabitConditionCode(c.icd10Code));
  const receptionTypeName = encounter.receptionTypeCode
    ? (receptionTypeCatalogQuery.data?.items.find((i) => i.code === encounter.receptionTypeCode)?.name ?? null)
    : null;

  function handlePatientHistoryChange(values: PatientFormValues) {
    const payload = buildHistoryUpdatePayload(values, query.data!.patient.version);
    updatePatientMutation.mutate(payload, {
      onSuccess: () => void query.refetch(),
      onError: (err) => handleSaveError(err, 'patient', () => handlePatientHistoryChange(values), 'Không lưu được tiền sử, vui lòng thử lại.'),
    });
  }

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
            {isCompleted && (
              <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                <CheckCircle size={12} weight="fill" aria-hidden="true" />
                {editingCompleted ? 'Đang chỉnh sửa thông tin' : `Đã hoàn tất${encounter.completedAt ? ` · ${formatHistoryDate(encounter.completedAt)}` : ''}`}
              </span>
            )}
            {patient.allergens.length > 0 && <AllergyBanner allergens={patient.allergens} />}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
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
            {receptionTypeName && (
              <>
                <span className="text-slate-300">|</span>
                <span className="whitespace-nowrap rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue-700">
                  {receptionTypeName}
                </span>
              </>
            )}
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
          {/* Nhập/đo lại sinh hiệu chỉ hợp lệ khi CHECKED_IN/IN_CONSULTATION (backend chặn cứng, REC-02/03)
              — ẩn hẳn khi đã "Hoàn tất khám" thay vì hiện nút rồi báo lỗi khi bấm. */}
          {!isCompleted && (
            <button
              type="button"
              onClick={() => setVitalsDialogOpen(true)}
              title={vitalSigns ? 'Cập nhật sinh hiệu' : 'Bổ sung sinh hiệu'}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-600"
            >
              {vitalSigns ? <PencilSimple size={14} weight="bold" aria-hidden="true" /> : <Plus size={15} weight="bold" aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>

      {vitalsDialogOpen && (
        <VitalSignsDialog encounterId={encounterId} current={vitalSigns} onClose={() => setVitalsDialogOpen(false)} />
      )}

      {openHistoryItem && (
        <EncounterHistoryDetailDialog
          encounterId={openHistoryItem.encounterId}
          doctorName={openHistoryItem.doctorName}
          onClose={() => setOpenHistoryItem(null)}
        />
      )}

      {/* Không gian làm việc chính — chia đôi */}
      <div className="flex min-h-0 flex-1 bg-slate-50">
        {/* Panel trái — 2 tab riêng biệt "Tiền sử bệnh"/"Lịch sử khám" (thay cột cuộn chung 1 khối
            trước đây — giải quyết triệt để thiếu không gian, giúp bác sĩ tập trung đúng luồng đang
            cần). Tab mặc định chọn theo `historyPanelTab` lúc nạp dữ liệu (xem effect nạp bản nháp):
            bệnh nhân MỚI (chưa có lượt khám nào) → "Tiền sử bệnh"; bệnh nhân CŨ → "Lịch sử khám". Đã
            bỏ dải "Khách đang chờ" (theo yêu cầu chủ dự án) — điều hướng giữa các bệnh nhân quay lại
            "Hàng đợi khám". */}
        <aside className="flex w-[384px] min-h-0 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="flex h-11 flex-shrink-0 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setHistoryPanelTab('personal')}
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 text-xs font-bold uppercase tracking-wide ${
                historyPanelTab === 'personal' ? 'border-blue-600 bg-blue-50/60 text-blue-700' : 'border-transparent text-slate-500 hover:text-blue-600'
              }`}
            >
              <Warning size={13} weight="bold" aria-hidden="true" />
              Tiền sử bệnh
            </button>
            <button
              type="button"
              onClick={() => setHistoryPanelTab('visits')}
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 text-xs font-bold uppercase tracking-wide ${
                historyPanelTab === 'visits' ? 'border-blue-600 bg-blue-50/60 text-blue-700' : 'border-transparent text-slate-500 hover:text-blue-600'
              }`}
            >
              <ClockCounterClockwise size={13} weight="bold" aria-hidden="true" />
              Lịch sử khám
            </button>
          </div>

          {historyPanelTab === 'personal' && (
            <div className="scroll-hover flex-1 overflow-y-auto p-3">
              <div className="flex flex-col gap-3">
                <HistoryBoxCard title="Tiền sử dị ứng" onAdd={() => setHistoryDialogOpen(true)}>
                  {patient.allergens.length === 0 ? (
                    <p className="text-[13px] text-slate-400">Chưa ghi nhận dị ứng nào.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {patient.allergens.map((a) => (
                        <span key={a.id} className="rounded-full border border-rose-300 bg-rose-50 px-2.5 py-1 text-[12px] font-semibold text-rose-700">
                          {a.name} <span className="font-medium text-rose-500">({a.allergenGroupName})</span>
                        </span>
                      ))}
                    </div>
                  )}
                </HistoryBoxCard>

                <HistoryBoxCard title="Tiền sử bản thân" onAdd={() => setHistoryDialogOpen(true)}>
                  {personalDiseaseConditions.length === 0 && personalHabitConditions.length === 0 && !patient.personalHistory ? (
                    <p className="text-[13px] text-slate-400">Chưa ghi nhận.</p>
                  ) : (
                    <div className="space-y-2">
                      {personalDiseaseConditions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {personalDiseaseConditions.map((c) => (
                            <span
                              key={c.icd10Code}
                              className="rounded-full border border-brand-teal bg-brand-teal-tint px-2.5 py-1 text-[12px] font-semibold text-brand-teal-active"
                            >
                              {c.icd10Name}
                            </span>
                          ))}
                        </div>
                      )}
                      {personalHabitConditions.length > 0 && (
                        <p className="text-[12.5px]">
                          <span className="font-semibold text-slate-700">Thói quen: </span>
                          <span className="text-slate-600">{personalHabitConditions.map((c) => c.icd10Name).join(' / ')}</span>
                        </p>
                      )}
                      {patient.personalHistory && (
                        <p className="text-[12.5px]">
                          <span className="font-semibold text-slate-700">Ghi chú: </span>
                          <span className="text-slate-600">{patient.personalHistory}</span>
                        </p>
                      )}
                    </div>
                  )}
                </HistoryBoxCard>

                <HistoryBoxCard title="Tiền sử gia đình" onAdd={() => setHistoryDialogOpen(true)}>
                  {patient.familyHistoryRows.length === 0 ? (
                    <p className="text-[13px] text-slate-400">Chưa ghi nhận.</p>
                  ) : (
                    <ul className="space-y-1">
                      {patient.familyHistoryRows.map((row) => (
                        <li key={row.id} className="text-[12.5px] font-semibold text-slate-800">
                          {row.relationLabel}: <span className="font-normal text-slate-600">{row.icd10Name}</span>
                          {row.ageOfOnsetYears !== null && <span className="font-normal text-slate-400"> ({row.ageOfOnsetYears} tuổi)</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </HistoryBoxCard>
              </div>
            </div>
          )}

          {historyPanelTab === 'visits' && (
            <div className="scroll-hover flex-1 overflow-y-auto p-3">
              {history.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">Chưa có lượt khám nào trước đây.</p>}
              {history.length > 0 && (
                <>
                  <SectionLabel>Lần khám gần nhất</SectionLabel>
                  <HistoryCard item={history[0]!} highlighted onOpen={() => setOpenHistoryItem(history[0]!)} />
                </>
              )}
              {history.length > 1 && (
                <>
                  <SectionLabel className="mt-3">Lịch sử cũ hơn</SectionLabel>
                  <div className="flex flex-col gap-2">
                    {history.slice(1).map((item) => (
                      <HistoryCard key={item.encounterId} item={item} onOpen={() => setOpenHistoryItem(item)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </aside>

        {/* Panel phải — khu vực làm việc */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-11 flex-shrink-0 items-center gap-1.5 border-b border-slate-200 bg-white px-4">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => scrollToTab(tab.id)}
                aria-current={activeTabId === tab.id ? 'true' : undefined}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  activeTabId === tab.id ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`}
              >
                <tab.icon size={15} weight={activeTabId === tab.id ? 'fill' : 'bold'} aria-hidden="true" />
                {tab.label}
                {tab.comingSoon && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      activeTabId === tab.id ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    Sắp ra mắt
                  </span>
                )}
              </button>
            ))}
          </div>

          <div ref={workspaceScrollRef} className="scroll-hover flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-6" ref={sectionRefs['section-kham']}>
              {/* "THÔNG TIN KHÁM LÂM SÀNG" — MỘT khung duy nhất (không tách 3 khung riêng như bản
                  trước), gộp Tiền sử/Thăm khám/Chẩn đoán bằng tiêu đề phụ nhẹ bên trong; ô nhập rút
                  gọn ~50% (`Textarea dense`) và lưới 3 cột để gọn hơn, theo phản hồi chủ dự án. */}
              <div className="relative rounded-lg border border-slate-200 bg-white p-5 pt-8 shadow-sm">
                <span className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                  <Stethoscope size={12} weight="bold" aria-hidden="true" />
                  Thông tin khám lâm sàng
                </span>

                {/* "Tiền sử" (dị ứng/bệnh lý nền/thói quen/gia đình) đã chuyển sang panel trái
                    (3 khung riêng, có nút "+ Thêm" mở `PatientHistoryDialog`) — không còn hiện ở
                    đây, tránh trùng lặp 2 nơi cùng đọc chung một dữ liệu (theo yêu cầu chủ dự án). */}
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Thăm khám</h3>
                  {isCompleted && editingCompleted && (
                    <button type="button" onClick={openClinicalAmend} className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                      <PencilSimple size={13} weight="bold" aria-hidden="true" />
                      Đính chính ghi chú khám
                    </button>
                  )}
                </div>
                {isCompleted && query.data!.clinicalNote.reasonForVisit?.signedAt && (
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <CheckCircle size={13} weight="fill" aria-hidden="true" />
                    Đã ký lúc {new Date(query.data!.clinicalNote.reasonForVisit.signedAt).toLocaleString('vi-VN')}
                    {query.data!.clinicalNote.reasonForVisit.amendmentReason && ' (bản đính chính)'}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Textarea
                    id="clinical-reason"
                    label="Lý do khám"
                    required
                    dense
                    rows={2}
                    value={clinical.reasonForVisit}
                    onChange={(e) => setField('reasonForVisit', e.target.value)}
                    readOnly={!canEditDraft}
                  />
                  <Textarea
                    id="clinical-illness-progress"
                    label="Quá trình bệnh lý"
                    dense
                    rows={2}
                    value={clinical.illnessProgress}
                    onChange={(e) => setField('illnessProgress', e.target.value)}
                    readOnly={!canEditDraft}
                  />
                  <Textarea
                    id="clinical-preliminary-diagnosis"
                    label="Chẩn đoán"
                    required
                    dense
                    rows={2}
                    value={clinical.preliminaryDiagnosis}
                    onChange={(e) => setField('preliminaryDiagnosis', e.target.value)}
                    readOnly={!canEditDraft}
                  />
                  <Textarea
                    id="clinical-general-exam"
                    label="Kết quả khám toàn thân"
                    dense
                    rows={2}
                    value={clinical.generalExam}
                    onChange={(e) => setField('generalExam', e.target.value)}
                    readOnly={!canEditDraft}
                  />
                  <Textarea
                    id="clinical-regional-exam"
                    label="Kết quả khám bộ phận"
                    dense
                    rows={2}
                    value={clinical.regionalExam}
                    onChange={(e) => setField('regionalExam', e.target.value)}
                    readOnly={!canEditDraft}
                  />
                </div>

                <div className="mb-2 mt-4 flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                    Chẩn đoán bệnh (ICD-10) <span className="text-rose-500">*</span>
                  </h3>
                  {isCompleted && editingCompleted && (
                    <button type="button" onClick={openDiagnosisAmend} className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                      <PencilSimple size={13} weight="bold" aria-hidden="true" />
                      Đính chính chẩn đoán
                    </button>
                  )}
                </div>
                {/* "Xem lại" một lượt khám đã hoàn tất (đã ký, Sprint 5) — sửa phải qua "Đính chính" ở trên, không mở lại ô thêm chẩn đoán trực tiếp. */}
                {canEditDraft && <Icd10SearchPicker excludeCodes={diagnoses.map((d) => d.icd10Code)} onSelect={handleAddDiagnosis} />}

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
                        {d.amendmentReason && <span className="ml-1.5 text-[11px] font-medium text-blue-600">(đã đính chính)</span>}
                      </div>
                      {canEditDraft && (
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
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION 3 — Kê đơn thuốc (Sprint 4, S4-01/02/04). */}
              <div ref={sectionRefs['section-donthuoc']}>
                <PrescriptionPanel
                  encounterId={encounterId}
                  prescription={prescription}
                  hasPrimaryDiagnosis={diagnoses.some((d) => d.type === 'PRIMARY')}
                  isEditableEncounter={canEditNow}
                  patientFullName={patient.fullName}
                  patientDob={formatDobDisplay(patient.dob)}
                  patientGender={GENDER_LABEL[patient.gender] ?? patient.gender}
                />
              </div>

              {/* SECTION 2, 4 — chỉ giữ chỗ, ngoài phạm vi v1/Sprint 4 */}
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
        <div className="min-w-0 text-xs text-slate-500">
          {/* Lỗi hiển thị INLINE tại chỗ phát sinh (không dùng Toast — `.claude/docs/ui-guidelines.md`
              mục 4.3), nhưng làm nổi bật rõ ràng (khung nền/viền đỏ + icon) thay vì chỉ 1 dòng chữ
              nhỏ dễ bỏ lỡ — phản hồi thật của chủ dự án khi dùng thử. */}
          {formError && (
            <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
              <Warning size={16} weight="fill" className="flex-shrink-0" aria-hidden="true" />
              {formError}
            </div>
          )}
          {!formError && draftSaved && (
            <span className="flex items-center gap-1.5 font-medium text-emerald-600">
              <CheckCircle size={14} weight="fill" aria-hidden="true" /> Đã lưu
            </span>
          )}
        </div>
        <div className="flex gap-3">
          {/* Đang khám (chưa hoàn tất) — luồng gốc, không đổi. */}
          {!isCompleted && (
            <>
              {/* Gộp "Trả về hàng chờ" + "Hủy khám" vào 1 nút "Xử lý" xổ menu (chốt 2026-08-29,
                  yêu cầu chủ dự án) — đúng khuôn `ActionMenu` mới trích xuất từ dropdown tài khoản
                  ở `TopBar.tsx`, quy tắc ">3 nút gộp menu" mục 4.5 áp dụng sớm cho 2 nút phụ (không
                  phải hành động chính "Lưu"/"Hoàn tất khám") để thanh hành động gọn hơn.
                  "Trả về hàng chờ": không đóng ca, chỉ nhả `doctorId` về NULL cho bác sĩ khác nhận
                  — trước đây phải quay ra "Hàng đợi khám" mới trả được (lỗ hổng thao tác thật).
                  "Hủy khám" (#085): khách bỏ về giữa chừng, đóng ca hẳn ngay tại đây. COMPLETED là
                  trạng thái cuối nên cả 2 không hiện khi đã hoàn tất (state machine không cho lùi). */}
              <ActionMenu
                label="Xử lý"
                openDirection="up"
                items={[
                  {
                    key: 'release',
                    label: 'Trả về hàng chờ',
                    icon: <ArrowCounterClockwise size={15} weight="bold" aria-hidden="true" />,
                    onClick: () => setReleaseDialogOpen(true),
                  },
                  {
                    key: 'cancel',
                    label: 'Hủy khám',
                    icon: <XCircle size={15} weight="bold" aria-hidden="true" />,
                    danger: true,
                    onClick: () => setCancelDialogOpen(true),
                  },
                ]}
              />
              <Button
                type="button"
                variant="secondary"
                loading={saveClinicalNoteMutation.isPending || updatePatientMutation.isPending}
                onClick={() => void handleSaveDraft()}
              >
                Lưu
              </Button>
              <Button type="button" loading={completeMutation.isPending} onClick={() => void handleComplete()}>
                <CheckCircle size={15} weight="bold" aria-hidden="true" />
                Hoàn tất khám
              </Button>
            </>
          )}
          {/* Đã "Hoàn tất khám", chỉ xem — lỗi vận hành thật chủ dự án báo cáo: trước đây vẫn hiện
              y hệt 2 nút trên dù không lưu được gì. Chỉ 1 lối vào duy nhất để sửa. */}
          {isCompleted && !editingCompleted && (
            <Button type="button" variant="secondary" onClick={() => setEditingCompleted(true)}>
              <PencilSimple size={14} weight="bold" aria-hidden="true" />
              Chỉnh sửa thông tin
            </Button>
          )}
          {/* Đang hiện các nút "Đính chính" (Sprint 5) — chẩn đoán/ghi chú khám đã ký không còn sửa
              tại chỗ được (khác Kê đơn, vẫn "Lưu thay đổi" trực tiếp qua `PrescriptionPanel`), nên
              chỉ còn "Đóng" để ẩn các nút Đính chính đi, không có gì phải Huỷ/Lưu ở đây nữa. */}
          {isCompleted && editingCompleted && (
            <Button type="button" variant="secondary" onClick={() => void handleCancelEdit()}>
              Đóng
            </Button>
          )}
        </div>
      </footer>

      <PatientHistoryDialog
        open={historyDialogOpen}
        onClose={() => setHistoryDialogOpen(false)}
        values={consultationPatientToHistoryFormValues(patient)}
        onChange={handlePatientHistoryChange}
      />

      {breakGlassPrompt && (
        <BreakGlassDialog
          entityType={breakGlassPrompt.entityType}
          entityId={encounterId}
          onGranted={() => {
            const retry = breakGlassPrompt.retry;
            setBreakGlassPrompt(null);
            retry();
          }}
          onClose={() => setBreakGlassPrompt(null)}
        />
      )}

      {showCompleteSuccessDialog && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow-2xl">
            <CheckCircle size={56} weight="fill" className="mx-auto mb-4 text-emerald-500" aria-hidden="true" />
            <h3 className="mb-1 text-lg font-bold uppercase tracking-wide text-emerald-600">Thành công</h3>
            <p className="mb-6 text-sm text-slate-700">Hoàn tất khám thành công</p>
            <Button type="button" autoFocus className="w-full" onClick={() => navigate('/reception/doctor-queue')}>
              Về Hàng đợi khám
            </Button>
          </div>
        </div>
      )}

      {cancelDialogOpen && query.data && (
        <CancelEncounterDialog
          encounterId={encounterId}
          version={query.data.encounter.version}
          onCancelled={() => navigate('/reception/doctor-queue')}
          onClose={() => setCancelDialogOpen(false)}
        />
      )}

      {releaseDialogOpen && query.data && (
        <ReleaseEncounterDialog
          encounterId={encounterId}
          patientFullName={patient.fullName}
          version={query.data.encounter.version}
          onReleased={() => navigate('/reception/doctor-queue')}
          onClose={() => setReleaseDialogOpen(false)}
        />
      )}

      {/* "Đính chính chẩn đoán" (Sprint 5, S5-02/03) — cùng UX dialog "Sửa đơn" của `PrescriptionPanel.tsx`. */}
      {diagnosisAmendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-[15px] font-semibold text-slate-900">Đính chính chẩn đoán</h2>
            <p className="mt-1 text-xs text-slate-500">Tạo bản chẩn đoán mới thay thế bản đã ký — bản cũ vẫn lưu lại trong lịch sử, không mất.</p>

            <div className="scroll-hover mt-3 flex-1 space-y-1.5 overflow-y-auto">
              {diagnosisAmendItems.length === 0 && <p className="text-xs text-slate-400">Chưa chọn chẩn đoán nào.</p>}
              {diagnosisAmendItems.map((d) => (
                <div
                  key={d.icd10Code}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                    d.type === 'PRIMARY' ? 'border-l-4 border-l-blue-600 border-y-slate-200 border-r-slate-200 bg-blue-50' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="text-sm text-slate-900">
                    <span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${d.type === 'PRIMARY' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>
                      {DIAGNOSIS_TYPE_LABEL[d.type]}
                    </span>
                    <strong>{d.icd10Code}</strong> — {d.icd10Name}
                  </div>
                  <div className="flex items-center gap-2">
                    {d.type !== 'PRIMARY' && (
                      <button type="button" onClick={() => handleSetAmendPrimary(d.icd10Code)} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                        Đặt làm bệnh chính
                      </button>
                    )}
                    <button type="button" onClick={() => handleRemoveAmendDiagnosis(d.icd10Code)} className="text-slate-400 hover:text-rose-600" aria-label={`Bỏ chẩn đoán ${d.icd10Code}`}>
                      <X size={15} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
              <Icd10SearchPicker excludeCodes={diagnosisAmendItems.map((d) => d.icd10Code)} onSelect={handleAddAmendDiagnosis} />
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              <label htmlFor="diagnosis-amend-reason" className="text-sm font-semibold text-slate-800">
                Lý do đính chính
              </label>
              <textarea
                id="diagnosis-amend-reason"
                rows={2}
                value={diagnosisAmendReason}
                onChange={(e) => setDiagnosisAmendReason(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDiagnosisAmendOpen(false)}>
                Huỷ
              </Button>
              <Button
                type="button"
                onClick={() => void handleDiagnosisAmendSubmit()}
                loading={amendDiagnosesMutation.isPending}
                disabled={diagnosisAmendReason.trim() === '' || diagnosisAmendItems.length === 0}
              >
                Lưu bản đính chính
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* "Đính chính ghi chú khám" (Sprint 5, S5-02/03) — 1 dialog gộp cả 6 mục, chỉ mục THỰC SỰ đổi nội dung mới gửi lên (`handleClinicalAmendSubmit`). */}
      {clinicalAmendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-[15px] font-semibold text-slate-900">Đính chính ghi chú khám</h2>
            <p className="mt-1 text-xs text-slate-500">Chỉ mục nào sửa nội dung mới tạo bản đính chính — mục không đổi giữ nguyên bản đã ký.</p>

            <div className="scroll-hover mt-3 flex-1 space-y-2 overflow-y-auto">
              {(Object.keys(CLINICAL_SECTION_CODE) as ClinicalKey[]).map((key) => (
                <Textarea
                  key={key}
                  id={`clinical-amend-${key}`}
                  label={CLINICAL_SECTION_LABEL[key]}
                  dense
                  rows={2}
                  value={clinicalAmendDraft[key]}
                  onChange={(e) => setClinicalAmendDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              ))}
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              <label htmlFor="clinical-amend-reason" className="text-sm font-semibold text-slate-800">
                Lý do đính chính
              </label>
              <textarea
                id="clinical-amend-reason"
                rows={2}
                value={clinicalAmendReason}
                onChange={(e) => setClinicalAmendReason(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setClinicalAmendOpen(false)}>
                Huỷ
              </Button>
              <Button
                type="button"
                onClick={() => void handleClinicalAmendSubmit()}
                loading={amendClinicalNoteMutation.isPending}
                disabled={clinicalAmendReason.trim() === '' || (Object.keys(CLINICAL_SECTION_CODE) as ClinicalKey[]).every((key) => clinicalAmendDraft[key] === clinical[key])}
              >
                Lưu bản đính chính
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-700 ${className}`}>{children}</div>;
}

/** Chip 1 dị ứng — dùng chung cho phần hiện sẵn lẫn danh sách đầy đủ trong dropdown "xem thêm". */
function AllergenChip({ allergen }: { allergen: PatientAllergenItem }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-rose-300 bg-white px-2.5 py-0.5 text-xs font-semibold text-rose-700">
      {allergen.name} <span className="font-medium text-rose-600">({allergen.allergenGroupName})</span>
    </span>
  );
}

/**
 * Banner "CẢNH BÁO DỊ ỨNG" ở đầu trang khám — chỉ hiện tối đa 2 chip đầu tiên (theo yêu cầu chủ dự
 * án, tránh chiếm quá nhiều chỗ ở dòng định danh chính); còn lại gộp vào nút "+N", rê chuột hoặc bấm
 * vào mở dropdown liệt kê ĐẦY ĐỦ dị nguyên. **Chưa có "mức độ nghiêm trọng"** — hệ thống hiện không
 * lưu trường này cho dị nguyên (`patient_allergen`/`allergen_catalog` chỉ có tên + nhóm), nên dropdown
 * chỉ hiện tên + nhóm như banner chính, không bịa số liệu mức độ.
 */
function AllergyBanner({ allergens }: { allergens: PatientAllergenItem[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const VISIBLE_LIMIT = 2;
  const visible = allergens.slice(0, VISIBLE_LIMIT);
  const hiddenCount = allergens.length - visible.length;

  return (
    <span
      ref={containerRef}
      className="relative flex flex-wrap items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5"
      onMouseEnter={() => hiddenCount > 0 && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="flex items-center gap-1 whitespace-nowrap text-xs font-bold text-rose-700">
        <Warning size={13} weight="fill" aria-hidden="true" />
        CẢNH BÁO DỊ ỨNG:
      </span>
      {visible.map((a) => (
        <AllergenChip key={a.id} allergen={a} />
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`Xem thêm ${hiddenCount} dị ứng khác`}
          className="whitespace-nowrap rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700 hover:bg-rose-200"
        >
          +{hiddenCount}
        </button>
      )}
      {open && hiddenCount > 0 && (
        <div className="scroll-hover absolute left-0 top-full z-20 mt-1.5 max-h-64 w-72 overflow-y-auto rounded-lg border border-rose-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-rose-700">Toàn bộ dị ứng ({allergens.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {allergens.map((a) => (
              <AllergenChip key={a.id} allergen={a} />
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Khung "Tiền sử dị ứng"/"Tiền sử bản thân"/"Tiền sử gia đình" ở panel trái màn khám — tiêu đề +
 * nút "+ Thêm" (mở `PatientHistoryDialog`, dùng chung cho cả 3 khung vì đó là dialog sửa cả 3 mục
 * cùng lúc) trên cùng 1 khung viền, theo mẫu ảnh tham khảo chủ dự án gửi.
 */
function HistoryBoxCard({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">{title}</h3>
        <button
          type="button"
          onClick={onAdd}
          className="flex flex-shrink-0 items-center gap-1 rounded-full border border-dashed border-blue-400 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-100"
        >
          <Plus size={11} weight="bold" aria-hidden="true" />
          Thêm
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * Thẻ tóm tắt 1 lần khám trước — lần gần nhất nổi bật (viền/nền xanh đậm hơn, chữ to hơn), các lần
 * cũ hơn gọn/phẳng — theo mẫu tham khảo chủ dự án gửi (2026-08-21), làm nổi bật các trường thông
 * tin để dễ đọc hơn bản trước. Chỉ hiện CHẨN ĐOÁN CHÍNH (không phải toàn bộ chẩn đoán — đã hỏi và
 * chốt giữ nguyên phạm vi `docs/DECISIONS.md` #059, chỉ mở rộng thêm tên bác sĩ). Đơn thuốc cũ/kết
 * quả cận lâm sàng CHƯA hiện được — module Kê đơn (Sprint 4) và Cận lâm sàng (ngoài phạm vi v1)
 * chưa xây, không có dữ liệu.
 */
/** Bấm mở `EncounterHistoryDetailDialog` xem đầy đủ đợt khám đó (chỉ đọc) — mockup đã duyệt 2026-08-29. */
function HistoryCard({ item, highlighted = false, onOpen }: { item: EncounterHistoryItem; highlighted?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative w-full rounded-lg border p-3 pr-16 text-left transition-colors ${
        highlighted ? 'border-blue-300 bg-blue-50/70 shadow-sm hover:border-blue-400 hover:bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/60'
      }`}
    >
      {/* Panel chỉ rộng 280px — ngày + tên bác sĩ KHÔNG đủ chỗ chung 1 hàng (vỡ dòng xấu khi tên
          bác sĩ dài), xuống 2 dòng riêng thay vì `justify-between` trên cùng 1 hàng. */}
      <div className="mb-1.5">
        <span className={`flex items-center gap-1.5 font-bold ${highlighted ? 'text-[13px] text-blue-700' : 'text-xs text-blue-600'}`}>
          <CalendarBlank size={highlighted ? 13 : 12} weight="bold" aria-hidden="true" />
          {formatHistoryDate(item.checkedInAt)}
          {highlighted && <span className="text-[11px] font-medium text-slate-400">({formatRelativeTime(item.checkedInAt)})</span>}
        </span>
        {item.doctorName && <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">{item.doctorName}</div>}
      </div>
      {item.primaryDiagnosisName && (
        <div className={`mb-1 font-bold text-slate-900 ${highlighted ? 'text-[13.5px]' : 'text-[12.5px]'}`}>{item.primaryDiagnosisName}</div>
      )}
      {item.chiefComplaint && (
        <p className={`leading-relaxed text-slate-600 ${highlighted ? 'text-[12.5px]' : 'truncate text-[11.5px]'}`}>
          <span className="font-semibold text-slate-700">Lý do: </span>
          {item.chiefComplaint}
        </p>
      )}
      <span className="pointer-events-none absolute bottom-2.5 right-3 flex items-center gap-0.5 text-[10px] font-bold text-blue-600 opacity-0 transition-opacity group-hover:opacity-100">
        Xem chi tiết
        <CaretRight size={9} weight="bold" aria-hidden="true" />
      </span>
    </button>
  );
}