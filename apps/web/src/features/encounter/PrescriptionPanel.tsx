import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle, ClockCounterClockwise, Info, PencilSimple, Pill, Plus, Stack, Warning, X } from '@phosphor-icons/react';
import type { DoseMode, PrescriptionItem, PrescriptionResponse, PrescriptionTemplate } from '@nexamed/shared';
import { formatPrescriptionDosePreview } from './prescription-dose-preview';
import { DoseLineEditor, DoseLinePreview, lineDoseRequest, lineHasDose, singleDoseText, type DoseLineState } from './DoseLineEditor';
import { AdviceTemplateDialog } from '../advice-template/AdviceTemplateDialog';
import { Textarea } from '../../shared/ui/Textarea';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
import { usePharmacyStockTrackingEnabledQuery, usePrescriptionSplitBlockEnabledQuery, useSoloClinicWorkflowEnabledQuery } from '../clinic/clinic.queries';
import { useHasPermission } from '../auth/usePermission';
import { Button } from '../../shared/ui/Button';
import { PrintButton } from '../../shared/print/PrintButton';
import { Combobox } from '../../shared/ui/Combobox';
import { EmptyState } from '../../shared/ui/EmptyState';
import { Skeleton } from '../../shared/ui/Skeleton';
import { appendSentence } from '../../shared/format/append-sentence';
import { useCreateReferenceCatalogItemMutation, useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useUnitNameByCode, unitLabel } from '../drug/useUnitNameByCode';
import { DispensePrescriptionDialog } from '../inventory/DispensePrescriptionDialog';
import { useStockOnHandSummaryQuery } from '../inventory/inventory.queries';
import { useCreatePrescriptionTemplateMutation, usePrescriptionTemplatesQuery } from '../drug/prescription-template.queries';
import { DrugPicker, type DrugPickerHandle } from './DrugPicker';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { PrescriptionPrintView } from './PrescriptionPrintView';
import { PrescriptionKindChip, PRESCRIPTION_KIND_TEXT, type PrescriptionKindLetter } from '../../shared/ui/PrescriptionKindChip';
import { PrescriptionNationalCode } from '../../shared/ui/PrescriptionNationalCode';
import { InteropInfoBlock } from '../prescription-interop/InteropInfoBlock';
import { makeDraftId } from '../../shared/make-draft-id';
import {
  useAmendPrescriptionMutation,
  useGetPreviousPrescriptionMutation,
  usePrescriptionPrintInfoQuery,
  usePrintPrescriptionMutation,
  useSavePrescriptionItemsMutation,
  useAcknowledgePrescriptionWarningMutation,
  useSignPrescriptionMutation,
} from './encounter.queries';

/**
 * Một dòng thuốc đang soạn. Liều theo buổi Sáng/Trưa/Chiều/Tối (docs/DECISIONS.md #196) hoặc kiểu "Khi cần" (#267: liều mỗi lần + số lượng nhập thẳng); số lượng của "Theo buổi" luôn TÍNH RA
 * (không nhập tay), theo đơn vị NHỎ NHẤT của thuốc (`unitCode` — CHỈ hiển thị, không có ô chọn đơn vị nào).
 */
type DraftLine = DoseLineState & {
  /** Số ngày đã sửa RIÊNG (#241) — không đổi theo "số ngày chung" (số ngày của thuốc "Theo buổi" đầu tiên) nữa. Luôn `false` ở dòng đầu. */
  daysOwn: boolean;
};

const DEFAULT_DURATION_DAYS = '5';

/** Dòng giữ "số ngày chung" của đơn = thuốc "Theo buổi" ĐẦU TIÊN (dòng "Khi cần" không có số ngày nên không làm chuẩn). */
function masterLineOf(lines: DraftLine[]): DraftLine | undefined {
  return lines.find((l) => l.doseMode === 'SCHEDULED');
}

/** Số ngày chung của đơn = số ngày của thuốc "Theo buổi" đầu tiên (chốt qua mockup #241); chưa có thì mặc định 5. */
function masterDaysOf(lines: DraftLine[]): string {
  return masterLineOf(lines)?.durationDays ?? DEFAULT_DURATION_DAYS;
}

/** Đánh dấu "chỉnh riêng" cho dòng có số ngày khác số ngày chung — dùng khi nạp cả cụm dòng (đơn đã lưu, đơn mẫu, đơn lần trước). */
function markDaysOwn(lines: DraftLine[]): DraftLine[] {
  const master = masterLineOf(lines);
  const masterDays = masterDaysOf(lines);
  return lines.map((l) => ({ ...l, daysOwn: l.doseMode === 'SCHEDULED' && l !== master && l.durationDays !== masterDays }));
}

function emptyDoseLine(drug: { drugId: string | null; drugName: string; unitCode: string | null; isSplittable: boolean; doseMode?: DoseMode }, durationDays: string): DraftLine {
  return {
    key: makeDraftId(),
    drugId: drug.drugId,
    drugName: drug.drugName,
    unitCode: drug.unitCode,
    // Kiểu kê mặc định lấy từ cấu hình thuốc (thuốc hạ sốt đặt sẵn "Khi cần"); dòng kê tự do mặc định "Theo buổi".
    doseMode: drug.doseMode ?? 'SCHEDULED',
    doseMorning: '',
    doseNoon: '',
    doseAfternoon: '',
    doseEvening: '',
    durationDays,
    singleDose: '',
    quantity: '',
    instruction: '',
    isSplittable: drug.isSplittable,
    daysOwn: false,
  };
}

function itemToDraft(item: PrescriptionItem): DraftLine {
  return {
    key: item.id,
    drugId: item.drugId,
    drugName: item.drugName,
    unitCode: item.unitCode,
    doseMode: item.doseMode,
    doseMorning: String(item.doseMorning),
    doseNoon: String(item.doseNoon),
    doseAfternoon: String(item.doseAfternoon),
    doseEvening: String(item.doseEvening),
    durationDays: item.durationDays === null ? DEFAULT_DURATION_DAYS : String(item.durationDays),
    singleDose: singleDoseText(item.singleDose),
    quantity: item.doseMode === 'AS_NEEDED' ? String(item.quantity) : '',
    instruction: item.instruction ?? '',
    isSplittable: item.isSplittable,
    daysOwn: false,
  };
}

/** Một dòng đang soạn → dòng gửi máy chủ (lưu nháp, đính chính, lưu đơn mẫu). "Kê thuốc tự do" — đúng 1 trong 2 (superRefine ở `packages/shared/src/prescription.ts`). */
function lineToItemInput(l: DraftLine) {
  return {
    ...(l.drugId !== null ? { drugId: l.drugId } : { freeTextDrugName: l.drugName }),
    ...lineDoseRequest(l),
    instruction: l.instruction.trim() || undefined,
  };
}

const WARNING_KIND_LABEL: Record<string, string> = {
  duplicate_active_ingredient: 'Trùng hoạt chất',
  allergy: 'Trùng dị nguyên đã biết của bệnh nhân',
  // Kho Thuốc GĐ5 — kê vượt TỔNG tồn kho toàn phòng khám, CẢNH BÁO MỀM (chặn cứng là lỗi 422 riêng
  // khi ký, không đi qua mảng `warnings` này — xem `EncounterConsultationPage`/backend).
  stock_insufficient: 'Kê vượt tồn kho',
  not_splittable: 'Thuốc không chia được nhưng kê liều lẻ',
};

/**
 * Kê đơn (Sprint 4, S4-01/02/04) — tab "Kê đơn thuốc" của màn hình khám. Đơn NHÁP (`signedAt=null`)
 * sửa tự do (thêm/xoá/đổi dòng thuốc, bấm "Lưu đơn nháp" để lưu — KHÔNG autosave từng phím như ghi
 * chú lâm sàng #066, vì đây là hành động rời rạc thêm/bớt dòng thuốc, không phải gõ văn bản dài).
 * Cảnh báo PRE-02/03/GĐ5-stock CHỈ đọc từ response server (`prescription.warnings`, tính trong
 * `packages/core`) — `apps/web` KHÔNG được import `@nexamed/core` (ESLint chặn, docs/DECISIONS.md
 * #073), nên không tự tính lại ở đây. Sau khi ký (`signedAt != null`) đơn bất biến (trigger C8) —
 * sửa = "Sửa đơn" (đính chính, tạo bản mới đã ký ngay, bắt buộc lý do).
 *
 * Kho Thuốc GĐ5 (PRD INV-05, redesign màn khám sang Phương án 1 — Tab thật) — mở rộng thêm:
 * - Khối "Mã đơn thuốc/BS kê đơn/Ngày kê" + "Chẩn đoán lâm sàng" (đúng mockup đã duyệt).
 * - "Đơn thuốc mẫu": chọn mẫu có sẵn chèn cả cụm vào đơn đang kê, hoặc lưu đơn hiện tại thành mẫu mới.
 * - Cột "Tồn kho" mỗi dòng thuốc + badge trong `DrugPicker` — CHỈ hiện khi tenant bật "Có kho thuốc"
 *   (`pharmacyStockTrackingEnabled`, mặc định bật — giữ nguyên pilot đang chạy).
 * - Điều hướng bàn phím toàn bộ dòng kê đơn: Enter ở ô "Hướng dẫn dùng" (ô cuối 1 dòng) đưa focus về
 *   lại ô tìm thuốc, sẵn sàng thêm dòng tiếp theo — Tab tuần tự qua các ô đã là hành vi HTML mặc định.
 */
export function PrescriptionPanel({
  encounterId,
  prescription,
  hasPrimaryDiagnosis,
  isEditableEncounter,
  patientFullName,
  patientDob,
  patientGender,
  diagnosisLabel,
  adviceText,
  followUpLabel,
}: {
  encounterId: string;
  prescription: PrescriptionResponse;
  /** .claude/docs/clinical-workflow.md: "Tạo được khi encounter IN_CONSULTATION và đã có chẩn đoán chính". */
  hasPrimaryDiagnosis: boolean;
  /** `canEditNow` của trang cha (IN_CONSULTATION, hoặc COMPLETED đang bấm "Chỉnh sửa thông tin"). */
  isEditableEncounter: boolean;
  patientFullName: string;
  patientDob: string;
  patientGender: string;
  /** Kho Thuốc GĐ5 — "{tên bệnh} (mã)" nối bởi " / " cho MỌI chẩn đoán (chính + phụ), tính sẵn ở
   * `EncounterConsultationPage.tsx` (đã có `diagnoses` trong state, không cần gọi API riêng) — cùng
   * định dạng khối "Chẩn đoán lâm sàng" ở màn "Phát thuốc" (docs/DECISIONS.md #169). */
  diagnosisLabel: string;
  /** Lời dặn bác sĩ + ngày hẹn tái khám đã định dạng (docs/DECISIONS.md #222) — in cuối đơn thuốc; bỏ trống thì không in. */
  adviceText?: string;
  followUpLabel?: string;
}) {
  const doctorName = useAuthStore((s) => s.user?.displayName ?? s.user?.fullName) ?? '';
  // "Thời điểm dùng thuốc" (docs/DECISIONS.md #155) — chỉ gợi ý ghép câu vào ô "Hướng dẫn dùng"
  // của từng dòng thuốc, không phải trường lưu riêng trên `prescription_item`.
  const usageTimingQuery = useReferenceCatalogQuery('DRUG_USAGE_TIMING');
  const createUsageTimingMutation = useCreateReferenceCatalogItemMutation('DRUG_USAGE_TIMING');
  const usageTimingOptions = (usageTimingQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  async function onCreateUsageTimingOption(name: string) {
    const created = await createUsageTimingMutation.mutateAsync({ category: 'DRUG_USAGE_TIMING', name, sortOrder: 0 });
    return { value: created.code, label: created.name };
  }
  const usageTimingSentenceByCode = new Map((usageTimingQuery.data?.items ?? []).map((i) => [i.code, i.description ?? i.fullName ?? i.name]));

  const saveMutation = useSavePrescriptionItemsMutation(encounterId);
  const signMutation = useSignPrescriptionMutation(encounterId);
  const printMutation = usePrintPrescriptionMutation(encounterId);
  const amendMutation = useAmendPrescriptionMutation(encounterId);
  // "Bỏ qua cảnh báo này cho đơn hiện tại" (#228) — chỉ cảnh báo trùng hoạt chất, chỉ đơn nháp, lý do không bắt buộc.
  const ackMutation = useAcknowledgePrescriptionWarningMutation(encounterId);
  const [ackOpenKey, setAckOpenKey] = useState<string | null>(null);
  const [ackReason, setAckReason] = useState('');
  const [ackError, setAckError] = useState<string | null>(null);

  const isSigned = prescription !== null && prescription.signedAt !== null;
  // Thông tin bệnh nhân in thêm (mã BN, CCCD, địa chỉ...) — chỉ nạp khi đơn đã ký; lỗi/không có quyền thì bản in tự ẩn các ô đó (#242).
  const printInfoQuery = usePrescriptionPrintInfoQuery(encounterId, isSigned);
  // Mã đơn thuốc chuẩn Bộ Y tế (#242): chữ cái loại đơn từng dòng + dải "sẽ ký thành N đơn". Chỉ có khi phòng khám bật chế độ chuẩn (server trả `kind`).
  const standardMode = prescription?.standardMode ?? false;
  const kindByDrugId = new Map((prescription?.items ?? []).flatMap((i) => (i.drugId !== null && i.kind !== null ? [[i.drugId, i.kind] as const] : [])));
  const kindOfLine = (line: DraftLine): PrescriptionKindLetter | null => (line.drugId === null ? (standardMode ? 'C' : null) : (kindByDrugId.get(line.drugId) ?? null));
  const KIND_ORDER: PrescriptionKindLetter[] = ['C', 'N', 'H', 'Y'];
  const kindGroups = KIND_ORDER.map((kind) => ({ kind, names: (prescription?.items ?? []).filter((i) => i.kind === kind).map((i) => i.drugName) })).filter((g) => g.names.length > 0);
  const willSplit = standardMode && !isSigned && kindGroups.length > 1;
  // In MỘT tờ (id đơn pháp lý) hoặc tất cả (null) — dùng cho đơn đã tách nhiều đơn pháp lý.
  const [printDocumentId, setPrintDocumentId] = useState<string | null>(null);
  const canEdit = isEditableEncounter && !isSigned;
  // Kho Thuốc GĐ3 (#163, đảo hướng #165) — nút "Phát thuốc" chỉ hiện khi đơn đã ký, actor có quyền
  // phát (`stock_issue.create` — lễ tân chỉ `.read`, không tự phát được), VÀ tenant bật "Chế độ
  // phòng khám 1 người" (`soloClinicWorkflowEnabled`, tái dùng nguyên công tắc có sẵn của
  // TopBar.tsx "Đóng ca hôm nay" — cùng một khái niệm "bác sĩ tự làm hết"). Tắt (mặc định, phòng
  // khám có quầy thuốc/dược sĩ riêng) → ẩn hẳn nút, phát thuốc chỉ qua trang "Phát thuốc" riêng.
  const soloClinicWorkflowQuery = useSoloClinicWorkflowEnabledQuery();
  const canDispense = useHasPermission('stock_issue', 'create') && (soloClinicWorkflowQuery.data?.enabled ?? false);
  const [dispenseOpen, setDispenseOpen] = useState(false);

  // Kho Thuốc GĐ5 — "Có kho thuốc", mặc định BẬT (giữ nguyên pilot). Tắt thì ẩn sạch cột tồn kho ở
  // đây VÀ badge tồn kho trong `DrugPicker.tsx` (hook riêng, tự đọc lại đúng công tắc này).
  const stockTrackingQuery = usePharmacyStockTrackingEnabledQuery();
  const showStock = stockTrackingQuery.data?.enabled ?? true;

  const [draftLines, setDraftLines] = useState<DraftLine[]>(() => markDaysOwn((prescription?.items ?? []).map(itemToDraft)));
  // "Lời dặn của bác sĩ" riêng của đơn (#241) — lưu cùng đơn nháp (`persistDraft`), in cuối đơn.
  const [advice, setAdvice] = useState(prescription?.doctorAdvice ?? '');
  const [adviceDialogOpen, setAdviceDialogOpen] = useState(false);
  const [draftKey, setDraftKey] = useState(prescription?.id ?? 'new');
  // Đơn đổi sang bản khác hẳn (vd sau "Sửa đơn" tạo id mới) — nạp lại draft từ server thay vì giữ
  // state cũ đã lỗi thời. Không dùng useEffect (tránh 1 nhịp render lệch) — so sánh ngay trong
  // render, đúng mẫu "derived state reset theo key" của React.
  const currentKey = prescription?.id ?? 'new';
  if (currentKey !== draftKey) {
    setDraftKey(currentKey);
    setDraftLines(markDaysOwn((prescription?.items ?? []).map(itemToDraft)));
    setAdvice(prescription?.doctorAdvice ?? '');
  }
  // `is_splittable` THẬT của từng thuốc lấy từ đơn đã lưu (server resolve) — dòng vừa thêm từ đơn mẫu/đơn lần trước chưa có thì coi là chia được.
  const splittableByDrugId = new Map((prescription?.items ?? []).flatMap((i) => (i.drugId !== null ? [[i.drugId, i.isSplittable] as const] : [])));
  const splittableOf = (line: DraftLine): boolean => (line.drugId === null ? true : (splittableByDrugId.get(line.drugId) ?? line.isSplittable));
  const splitBlockQuery = usePrescriptionSplitBlockEnabledQuery();
  const splitBlockEnabled = splitBlockQuery.data?.enabled ?? false;

  const onHandQuery = useStockOnHandSummaryQuery(
    draftLines.map((l) => l.drugId).filter((id): id is string => id !== null),
    showStock,
  );
  const onHandByDrugId = onHandQuery.data?.onHandByDrugId ?? {};

  const drugPickerRef = useRef<DrugPickerHandle>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  /** Bug thật phát hiện lúc verify Playwright (Kho Thuốc GĐ5): `signMutation`/`printMutation` không
   * có `onError` nào — bấm "Ký đơn" khi bị `PRESCRIPTION_STOCK_INSUFFICIENT` (422, "Chặn kê vượt
   * tồn" đang bật) trước đây KHÔNG hiện gì cả, bác sĩ không biết vì sao không ký được. Hiện inline
   * (không Toast, đúng `ui-guidelines.md` mục 4.3), cùng khuôn `formError` ở `EncounterConsultationPage.tsx`. */
  const [signError, setSignError] = useState<string | null>(null);

  const [amendOpen, setAmendOpen] = useState(false);
  const [amendLines, setAmendLines] = useState<DraftLine[]>([]);
  const [amendReason, setAmendReason] = useState('');
  const [amendAdvice, setAmendAdvice] = useState('');
  const [amendError, setAmendError] = useState<string | null>(null);
  const previousPrescriptionMutation = useGetPreviousPrescriptionMutation(encounterId);
  const [copyPreviousError, setCopyPreviousError] = useState<string | null>(null);
  const patchAmendLine = (key: string, patch: Partial<DraftLine>) => setAmendLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function persistDraft(lines: DraftLine[], nextAdvice: string = advice) {
    setDraftLines(lines);
    saveMutation.mutate({
      doctorAdvice: nextAdvice,
      items: lines.map(lineToItemInput),
    });
  }

  /** Thêm thuốc là LƯU NHÁP NGAY (#241) để cảnh báo trùng hoạt chất/không chia được hiện liền — dòng mới nhận số ngày chung của đơn, liều để trống. */
  function handleAddDrug(drug: { drugId: string; drugName: string; unitCode: string | null; isSplittable: boolean; doseMode: DoseMode }) {
    persistDraft([...draftLines, emptyDoseLine(drug, masterDaysOf(draftLines))]);
  }

  /** "Kê thuốc tự do, không qua danh mục" (mở rộng Kho Thuốc GĐ5) — thêm 1 dòng chỉ có tên tự do,
   * `drugId=null`. Chỉ gọi được khi `DrugPicker.tsx` tự xác nhận tenant đã bật công tắc. */
  function handleAddFreeTextDrug(name: string) {
    persistDraft([...draftLines, emptyDoseLine({ drugId: null, drugName: name, unitCode: null, isSplittable: true }, masterDaysOf(draftLines))]);
  }

  /** Kho Thuốc GĐ5 — "Đơn thuốc mẫu": chèn cả cụm dòng thuốc của mẫu vào đơn đang kê (bỏ qua thuốc
   * đã có sẵn trong đơn, tránh trùng) — CHƯA lưu ngay, bác sĩ sửa tiếp rồi tự bấm "Lưu đơn nháp",
   * đúng khuôn `handleAddDrug` (thêm 1 thuốc) ở trên. Mẫu LUÔN tham chiếu thuốc thật (`drugId`
   * bắt buộc ở `prescription_template_item`) — không có nhánh tự do ở đây. */
  function applyTemplate(template: PrescriptionTemplate) {
    const existingIds = new Set(draftLines.map((l) => l.drugId));
    const additions: DraftLine[] = template.items
      .filter((item) => !existingIds.has(item.drugId))
      .map((item) => ({
        key: makeDraftId(),
        drugId: item.drugId,
        drugName: item.drugName,
        unitCode: item.unitCode,
        doseMode: item.doseMode,
        doseMorning: String(item.doseMorning),
        doseNoon: String(item.doseNoon),
        doseAfternoon: String(item.doseAfternoon),
        doseEvening: String(item.doseEvening),
        durationDays: item.durationDays === null ? DEFAULT_DURATION_DAYS : String(item.durationDays),
        singleDose: singleDoseText(item.singleDose),
        quantity: item.doseMode === 'AS_NEEDED' ? String(item.quantity) : '',
        instruction: item.instruction ?? '',
        isSplittable: true,
        daysOwn: false,
      }));
    // Số ngày của dòng mẫu GIỮ NGUYÊN (khác số ngày chung thì thành "chỉnh riêng"), không bị đè bởi số ngày chung.
    persistDraft(markDaysOwn([...draftLines, ...additions]));
    setTemplateModalOpen(false);
  }

  /** "Sao chép đơn thuốc lần khám trước" (docs/DECISIONS.md #196, mockup đã duyệt) — chèn CẢ CỤM
   * đơn ĐÃ KÝ gần nhất của cùng bệnh nhân (bỏ qua thuốc đã có sẵn trong đơn đang kê, tránh trùng),
   * CHƯA lưu ngay — đúng khuôn `applyTemplate()`. */
  function handleCopyPrevious() {
    setCopyPreviousError(null);
    previousPrescriptionMutation.mutate(undefined, {
      onSuccess: (previous) => {
        if (!previous || previous.items.length === 0) {
          setCopyPreviousError('Bệnh nhân này chưa từng có đơn thuốc nào trước đó.');
          return;
        }
        const existingIds = new Set(draftLines.map((l) => l.drugId));
        const additions: DraftLine[] = previous.items.filter((item) => !existingIds.has(item.drugId)).map((item) => ({ ...itemToDraft(item), key: makeDraftId() }));
        persistDraft(markDaysOwn([...draftLines, ...additions]));
      },
      onError: (err) => setCopyPreviousError(err instanceof ApiError ? err.message : 'Không sao chép được đơn lần trước, vui lòng thử lại.'),
    });
  }

  function handleRemoveLine(key: string) {
    // Xoá dòng đầu thì dòng kế tiếp thành thuốc đầu → tính lại dòng nào "chỉnh riêng" so với số ngày chung mới.
    persistDraft(markDaysOwn(draftLines.filter((l) => l.key !== key)));
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setDraftLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /**
   * Chốt thay đổi của một dòng (rời ô liều, chọn liều mẫu/điền nhanh, đổi kiểu kê) và lưu nháp. Đổi sang "Theo buổi" thì dòng nhận lại số ngày chung của đơn.
   */
  function commitLine(key: string, patch: Partial<DraftLine>) {
    const others = draftLines.filter((l) => l.key !== key);
    const next = draftLines.map((l) => {
      if (l.key !== key) return l;
      const merged = { ...l, ...patch };
      return patch.doseMode === 'SCHEDULED' && l.doseMode !== 'SCHEDULED' ? { ...merged, durationDays: masterDaysOf(others), daysOwn: false } : merged;
    });
    persistDraft(markDaysOwn(next));
  }

  /**
   * Sửa số ngày (#241): sửa ở THUỐC "THEO BUỔI" ĐẦU = số ngày chung → mọi dòng đang "theo chung" đổi theo; sửa ở dòng khác thì dòng đó
   * tách riêng ("Chỉnh riêng") và không đổi theo nữa. Chưa lưu — lưu khi rời ô (`onBlurCommit`).
   */
  function handleDaysChange(key: string, value: string) {
    setDraftLines((prev) => {
      const masterKey = masterLineOf(prev)?.key;
      return prev.map((l) => {
        if (l.key === key) return { ...l, durationDays: value, daysOwn: key !== masterKey };
        if (masterKey === key && l.doseMode === 'SCHEDULED' && !l.daysOwn) return { ...l, durationDays: value };
        return l;
      });
    });
  }

  /** "Theo chung (N ngày)" — nối lại dòng đã chỉnh riêng với số ngày chung. */
  function followMasterDays(key: string) {
    persistDraft(draftLines.map((l) => (l.key === key ? { ...l, durationDays: masterDaysOf(draftLines), daysOwn: false } : l)));
  }

  /** Chèn một câu (soạn nhanh câu dặn "Khi cần") vào ô "Hướng dẫn dùng" của dòng rồi lưu nháp. */
  function appendInstruction(key: string, sentence: string) {
    persistDraft(draftLines.map((l) => (l.key === key ? { ...l, instruction: appendSentence(l.instruction, sentence) } : l)));
  }

  /** Điều hướng bàn phím toàn bộ dòng kê đơn (Kho Thuốc GĐ5) — Enter ở ô CUỐI của 1 dòng (Hướng dẫn
   * dùng) đưa focus về ô tìm thuốc, sẵn sàng thêm dòng tiếp theo mà không cần với chuột. */
  function handleLastFieldKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      drugPickerRef.current?.focus();
    }
  }

  function handleSign() {
    if (!prescription) return;
    setSignError(null);
    signMutation.mutate(
      { version: prescription.version },
      { onError: (err) => setSignError(err instanceof ApiError ? err.message : 'Không ký được đơn thuốc, vui lòng thử lại.') },
    );
  }

  async function handlePrint(documentId: string | null = null) {
    setPrintDocumentId(documentId);
    await printMutation.mutateAsync();
    // Bấm In ngay khi vừa ký có thể thông tin bệnh nhân (CCCD, địa chỉ...) chưa nạp xong — đợi nốt để bản in không thiếu ô (lỗi nạp thì vẫn in, các ô đó tự ẩn).
    if (printInfoQuery.isFetching) await printInfoQuery.refetch().catch(() => undefined);
    setTimeout(() => window.print(), 100);
  }

  function openAmend() {
    setAmendLines((prescription?.items ?? []).map(itemToDraft));
    setAmendReason('');
    setAmendAdvice(prescription?.doctorAdvice ?? '');
    setAmendError(null);
    setAmendOpen(true);
  }

  function handleAmendSubmit() {
    if (!prescription || amendReason.trim() === '' || amendLines.length === 0) return;
    amendMutation.mutate(
      {
        amendmentReason: amendReason.trim(),
        doctorAdvice: amendAdvice,
        version: prescription.version,
        items: amendLines.map(lineToItemInput),
      },
      {
        onSuccess: () => setAmendOpen(false),
        onError: (err) => setAmendError(err instanceof ApiError ? err.message : 'Không lưu được bản đính chính, vui lòng thử lại.'),
      },
    );
  }

  if (!hasPrimaryDiagnosis) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8">
        <EmptyState icon={Warning} title="Chưa thể kê đơn" description="Phải chọn chẩn đoán chính ở tab &quot;Khám &amp; Chẩn đoán&quot; trước khi kê đơn thuốc." />
      </div>
    );
  }

  const allWarnings = prescription?.warnings ?? [];
  // Cảnh báo "không chia được" hiện ngay TRONG dòng thuốc (đúng mockup #241), không lẫn vào danh sách chung ở đầu đơn.
  const splitWarnings = allWarnings.filter((w) => w.kind === 'not_splittable');
  const warnings = allWarnings.filter((w) => w.kind !== 'not_splittable');
  const splitBlocked = splitBlockEnabled && splitWarnings.length > 0;
  const hasLineWithoutDose = draftLines.some((l) => !lineHasDose(l));
  const signBlockedMessage = splitBlocked ? 'Còn thuốc không chia được đang kê liều lẻ.' : hasLineWithoutDose ? 'Còn thuốc chưa nhập liều dùng.' : '';

  function submitAck(key: string, acknowledged: boolean) {
    if (!prescription) return;
    setAckError(null);
    ackMutation.mutate(
      { key, acknowledged, ...(acknowledged && ackReason.trim() ? { reason: ackReason.trim() } : {}), version: prescription.version },
      {
        onSuccess: () => {
          setAckOpenKey(null);
          setAckReason('');
        },
        onError: (err) => setAckError(err instanceof ApiError ? err.message : 'Không lưu được thao tác. Thử lại.'),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PrescriptionInfoHeader
        prescriptionNo={prescription?.prescriptionNo ?? null}
        doctorName={doctorName}
        signedAt={prescription?.signedAt ?? null}
        diagnosisLabel={diagnosisLabel}
      />

      {signError && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
          {signError}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {warnings.map((w) => {
            const canAck = !isSigned && w.kind === 'duplicate_active_ingredient';
            if (w.acknowledged) {
              // Đã bỏ qua trên đơn này — hiện mờ kèm dấu vết (ai, lúc nào, lý do) và nút "Bật lại" khi đơn còn nháp.
              return (
                <div key={w.key} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      Đã bỏ qua · {WARNING_KIND_LABEL[w.kind] ?? w.kind}: <span className="font-normal">{w.label}</span> — {w.drugNames.join(', ')}
                    </p>
                    <p className="text-xs text-slate-500">
                      {w.acknowledged.byName} · {new Date(w.acknowledged.at).toLocaleString('vi-VN')}
                      {w.acknowledged.reason ? ` · Lý do: ${w.acknowledged.reason}` : ''}
                    </p>
                  </div>
                  {canAck && (
                    <Button type="button" variant="secondary" className="shrink-0 px-3 py-1 text-xs" loading={ackMutation.isPending} onClick={() => submitAck(w.key, false)}>
                      Bật lại
                    </Button>
                  )}
                </div>
              );
            }
            return (
              <div
                key={w.key}
                className={`rounded-lg border p-3 text-sm font-semibold ${
                  w.kind === 'stock_insufficient' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                <div className="flex items-start gap-2">
                  <Warning size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
                  <p className="min-w-0 flex-1">
                    {WARNING_KIND_LABEL[w.kind] ?? w.kind}: <span className="font-normal">{w.label}</span> — {w.drugNames.join(', ')}
                  </p>
                  {canAck && ackOpenKey !== w.key && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0 px-3 py-1 text-xs"
                      onClick={() => {
                        setAckOpenKey(w.key);
                        setAckReason('');
                        setAckError(null);
                      }}
                    >
                      Bỏ qua cảnh báo này
                    </Button>
                  )}
                </div>
                {canAck && ackOpenKey === w.key && (
                  <form
                    className="mt-2 flex flex-wrap items-center gap-2 pl-6"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitAck(w.key, true);
                    }}
                  >
                    <input
                      type="text"
                      value={ackReason}
                      onChange={(e) => setAckReason(e.target.value)}
                      maxLength={300}
                      autoFocus
                      aria-label="Lý do bỏ qua cảnh báo (không bắt buộc)"
                      placeholder="Lý do (không bắt buộc), ví dụ: cố ý tăng liều"
                      className="min-w-[260px] flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-normal text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <Button type="submit" className="px-3 py-1.5 text-xs" loading={ackMutation.isPending}>
                      Bỏ qua cho đơn này
                    </Button>
                    <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setAckOpenKey(null)}>
                      Huỷ
                    </Button>
                  </form>
                )}
              </div>
            );
          })}
          {ackError && (
            <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-xs font-semibold text-rose-700">
              {ackError}
            </p>
          )}
        </div>
      )}

      {isSigned ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
              <CheckCircle size={16} weight="fill" aria-hidden="true" />
              Đã ký lúc {prescription!.signedAt ? new Date(prescription!.signedAt).toLocaleString('vi-VN') : ''}
              {prescription!.amendmentReason && ' (bản đính chính)'}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={openAmend}>
                <PencilSimple size={15} weight="bold" aria-hidden="true" />
                Sửa đơn
              </Button>
              {canDispense && (
                <Button type="button" variant="secondary" onClick={() => setDispenseOpen(true)}>
                  <Pill size={15} weight="bold" aria-hidden="true" />
                  Phát thuốc
                </Button>
              )}
              <PrintButton documentType="PRESCRIPTION" variant="primary" onPrint={() => void handlePrint(null)} loading={printMutation.isPending}>
                {prescription!.documents.length > 1 ? `In tất cả (${prescription!.documents.length} tờ)` : 'In đơn'}
              </PrintButton>
            </div>
          </div>
          {prescription!.documents.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-lg border border-slate-200">
              {prescription!.documents.map((doc, i) => (
                <div key={doc.id} className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 last:border-b-0">
                  <PrescriptionKindChip kind={doc.kind} />
                  <div className="min-w-0 flex-1">
                    <PrescriptionNationalCode code={doc.nationalCode} className="text-sm" />
                    <p className="text-xs text-slate-500">
                      {prescription!.documents.length > 1 ? `Đơn ${i + 1}/${prescription!.documents.length}: ` : ''}
                      {PRESCRIPTION_KIND_TEXT[doc.kind]} · {doc.itemIds.length} thuốc
                      {prescription!.signedAt ? ` · ký lúc ${new Date(prescription!.signedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </p>
                  </div>
                  {prescription!.documents.length > 1 && (
                    <PrintButton documentType="PRESCRIPTION" variant="secondary" onPrint={() => void handlePrint(doc.id)} loading={printMutation.isPending}>
                      In
                    </PrintButton>
                  )}
                </div>
              ))}
            </div>
          )}
          <PrescriptionItemsTable items={prescription!.items} />
          {prescription!.doctorAdvice && (
            <p className="mt-3 border-t border-slate-200 pt-3 text-sm text-slate-800">
              <span className="font-semibold">Lời dặn của bác sĩ: </span>
              {prescription!.doctorAdvice}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          {canEdit && (
            // Dính trên đỉnh khung cuộn (đơn dài vẫn thêm thuốc được không phải cuộn lên) — nằm ngay dưới
            // thanh chẩn đoán khi thanh này đang hiện (biến CSS đặt bởi StickyDiagnosisBar). -mx-5 để nền
            // trắng phủ hết bề ngang thẻ, không lộ dòng thuốc cuộn qua hai bên.
            <div className="sticky top-[calc(var(--sticky-diagnosis-h,0px)-1rem)] z-9 -mx-5 bg-white px-5 pb-4">
            <div className="shrink-0 rounded-lg border-2 border-blue-200 bg-blue-50 p-3 shadow-sm">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">Thêm thuốc vào đơn</span>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={handleCopyPrevious} loading={previousPrescriptionMutation.isPending}>
                    <ClockCounterClockwise size={15} weight="bold" aria-hidden="true" />
                    Sao chép đơn lần trước
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setTemplateModalOpen(true)}>
                    <Stack size={15} weight="bold" aria-hidden="true" />
                    Đơn mẫu
                  </Button>
                </div>
              </div>
              {copyPreviousError && <p className="mb-2 text-xs font-semibold text-amber-700">{copyPreviousError}</p>}
              <p className="mb-2 text-xs text-slate-500">Kiểu "Theo buổi": số lượng = (Sáng + Trưa + Chiều + Tối) × Số ngày, luôn theo đơn vị nhỏ nhất của thuốc. Kiểu "Khi cần": bác sĩ nhập thẳng số lượng.</p>
              <DrugPicker ref={drugPickerRef} highlight excludeDrugIds={draftLines.map((l) => l.drugId)} onSelect={(drug) => handleAddDrug(drug)} onAddFreeText={handleAddFreeTextDrug} />
            </div>
            </div>
          )}
          {draftLines.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">Chưa có dòng thuốc nào — tìm và thêm thuốc bên dưới.</p>
          ) : (
            <div className="mb-4 flex flex-col gap-2">
              {draftLines.map((line) => {
                const splitWarning = splitWarnings.find((w) => w.key === `not_splittable:${line.drugId}`);
                // Chế độ Chặn: bỏ qua không có tác dụng (server vẫn chặn ký) nên luôn hiện khung chặn.
                const splitState = !splitWarning ? null : splitBlockEnabled ? 'block' : splitWarning.acknowledged ? 'ack' : 'warn';
                const isMasterDays = line.key === masterLineOf(draftLines)?.key;
                const scheduledCount = draftLines.filter((l) => l.doseMode === 'SCHEDULED').length;
                const daysHintText = isMasterDays ? (scheduledCount > 1 ? 'Số ngày chung của đơn' : 'Các thuốc thêm sau sẽ lấy số ngày này') : line.daysOwn ? 'Chỉnh riêng' : 'Theo số ngày chung';
                const daysHintClass = isMasterDays ? 'text-brand-teal-active' : line.daysOwn ? 'text-amber-700' : 'text-slate-500';
                return (
                <div
                  key={line.key}
                  className={`group grid grid-cols-[1fr_auto] gap-2 rounded-md border p-3 ${splitState === 'warn' ? 'border-amber-300' : splitState === 'block' ? 'border-rose-300' : 'border-slate-200'}`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      {kindOfLine(line) && <PrescriptionKindChip kind={kindOfLine(line)!} />}
                      <p className="text-sm font-medium text-slate-900">{line.drugName}</p>
                      {!splittableOf(line) && (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Không chia được</span>
                      )}
                      {line.drugId === null && (
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          Ngoài danh mục
                        </span>
                      )}
                      {line.drugId !== null && showStock && onHandByDrugId[line.drugId] !== undefined && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${
                            onHandByDrugId[line.drugId]! > 0 ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        >
                          {onHandByDrugId[line.drugId]! > 0 ? `Tồn ${onHandByDrugId[line.drugId]}` : 'Hết hàng'}
                        </span>
                      )}
                    </div>
                    <DoseLineEditor
                      idPrefix={`dose-${line.key}`}
                      line={line}
                      canEdit={canEdit}
                      showAids
                      daysField={
                        <div className="w-16">
                          <LineInput dense label="Số ngày" type="number" value={line.durationDays} onBlurCommit={() => persistDraft(draftLines)} onChange={(v) => handleDaysChange(line.key, v)} disabled={!canEdit} />
                        </div>
                      }
                      daysHint={
                        <p className={`mt-1 flex min-h-4 items-center gap-1.5 text-[11.5px] font-semibold ${daysHintClass}`}>
                          {daysHintText}
                          {canEdit && !isMasterDays && line.daysOwn && (
                            <Button type="button" variant="info" className="px-2 py-0 text-[11px]" onClick={() => followMasterDays(line.key)}>
                              Theo chung ({masterDaysOf(draftLines)} ngày)
                            </Button>
                          )}
                        </p>
                      }
                      onPatch={(patch) => updateLine(line.key, patch)}
                      onCommit={(patch) => commitLine(line.key, patch)}
                      onAppendInstruction={(sentence) => appendInstruction(line.key, sentence)}
                    />
                    {splitState && splitWarning && (
                      <SplitDoseAlert
                        state={splitState}
                        drugName={line.drugName}
                        pending={ackMutation.isPending}
                        onAcknowledge={() => submitAck(splitWarning.key, true)}
                        onRestore={() => submitAck(splitWarning.key, false)}
                      />
                    )}
                    <div className="mt-2 flex items-end gap-2">
                      <div className="flex-1">
                        <LineInput
                          label="Hướng dẫn dùng"
                          underline
                          value={line.instruction}
                          onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.key === line.key ? { ...l, instruction: v } : l)))}
                          onChange={(v) => updateLine(line.key, { instruction: v })}
                          onKeyDown={handleLastFieldKeyDown}
                          disabled={!canEdit}
                        />
                      </div>
                      {canEdit && (
                        <div className="w-40">
                          <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-600">
                            Gợi ý thời điểm
                            <Combobox
                              id={`usage-timing-suggest-${line.key}`}
                              value=""
                              onChange={(code) => {
                                const sentence = usageTimingSentenceByCode.get(code);
                                if (!sentence) return;
                                const nextInstruction = appendSentence(line.instruction, sentence);
                                updateLine(line.key, { instruction: nextInstruction });
                                persistDraft(draftLines.map((l) => (l.key === line.key ? { ...l, instruction: nextInstruction } : l)));
                              }}
                              options={usageTimingOptions}
                              allowCreate
                              onCreateOption={onCreateUsageTimingOption}
                              placeholder="Chọn để chèn..."
                            />
                          </label>
                        </div>
                      )}
                    </div>
                    <DoseLinePreview line={line} />
                  </div>
                  {canEdit && (
                    <button type="button" onClick={() => handleRemoveLine(line.key)} className="h-fit text-slate-400 hover:text-rose-600" aria-label={`Xoá ${line.drugName}`}>
                      <X size={16} weight="bold" aria-hidden="true" />
                    </button>
                  )}
                </div>
                );
              })}
            </div>
          )}

          {canEdit && (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <div className="mb-1.5 flex items-end justify-between gap-2">
                <div>
                  <label htmlFor="prescription-advice" className="block text-sm font-semibold text-slate-800">
                    Lời dặn của bác sĩ
                  </label>
                  <p className="text-xs text-slate-500">Riêng cho đơn thuốc này, in cuối đơn</p>
                </div>
                <Button type="button" variant="secondary" onClick={() => setAdviceDialogOpen(true)}>
                  Mẫu lời dặn
                </Button>
              </div>
              <Textarea
                id="prescription-advice"
                label="Lời dặn của bác sĩ"
                hideLabel
                rows={3}
                value={advice}
                onChange={(e) => setAdvice(e.target.value)}
                onBlur={() => {
                  if (prescription !== null || draftLines.length > 0) persistDraft(draftLines, advice);
                }}
                placeholder="Nhập lời dặn cho đơn thuốc này…"
              />
            </div>
          )}

          {canEdit && standardMode && draftLines.some((l) => l.drugId === null) && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-700">
              <Info size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>Thuốc kê tự do luôn thuộc đơn loại C. Muốn kê thuốc gây nghiện hoặc hướng thần, chọn từ danh mục thuốc.</span>
            </div>
          )}

          {canEdit && willSplit && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white" aria-live="polite">
              <p className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
                <Info size={16} weight="fill" className="text-blue-600" aria-hidden="true" />
                Khi ký, đơn này tách thành {kindGroups.length} đơn thuốc riêng
              </p>
              {kindGroups.map((g, i) => (
                <div key={g.kind} className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2 text-sm text-slate-600 last:border-b-0">
                  <PrescriptionKindChip kind={g.kind} />
                  <span className="font-semibold text-slate-800">
                    Đơn {i + 1}: {PRESCRIPTION_KIND_TEXT[g.kind]}
                  </span>
                  <span className="ml-auto min-w-0 max-w-[60%] truncate text-xs text-slate-500" title={g.names.join(', ')}>
                    {g.names.length} thuốc · {g.names.join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div className="mt-4 flex items-center justify-end gap-2">
              {signBlockedMessage && (
                <p role="alert" className="mr-auto text-xs font-semibold text-rose-700">
                  {signBlockedMessage}
                </p>
              )}
              <Button type="button" variant="secondary" onClick={() => persistDraft(draftLines)} loading={saveMutation.isPending}>
                <Plus size={15} weight="bold" aria-hidden="true" />
                Lưu đơn nháp
              </Button>
              <Button
                type="button"
                onClick={handleSign}
                loading={signMutation.isPending}
                disabled={!prescription || prescription.items.length === 0 || signBlockedMessage !== ''}
              >
                {willSplit ? `Ký ${kindGroups.length} đơn` : 'Ký đơn'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Liên thông đơn thuốc quốc gia (#242 GĐ3, mockup 8a/8b) — tự ẩn khi công tắc "Có liên thông" tắt. */}
      <InteropInfoBlock encounterId={encounterId} prescription={prescription} />

      {isSigned && prescription && (
        <PrescriptionPrintView
          doctorName={doctorName}
          patientFullName={patientFullName}
          patientDob={patientDob}
          patientGender={patientGender}
          diagnosisLabel={diagnosisLabel}
          items={prescription.items}
          documents={prescription.documents}
          printDocumentId={printDocumentId}
          signedAt={prescription.signedAt!}
          advice={prescription.doctorAdvice?.trim() || adviceText}
          followUpLabel={followUpLabel}
          printInfo={printInfoQuery.data ?? null}
        />
      )}

      {dispenseOpen && prescription && (
        <DispensePrescriptionDialog prescriptionId={prescription.id} onClose={() => setDispenseOpen(false)} />
      )}

      {adviceDialogOpen && (
        <AdviceTemplateDialog
          onInsert={(texts) => {
            const merged = texts.reduce((acc, t) => appendSentence(acc, t), advice);
            setAdvice(merged);
            persistDraft(draftLines, merged);
          }}
          onClose={() => setAdviceDialogOpen(false)}
        />
      )}

      {templateModalOpen && (
        <PrescriptionTemplateModal draftLines={draftLines} onApply={applyTemplate} onClose={() => setTemplateModalOpen(false)} />
      )}

      {amendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-[15px] font-semibold text-slate-900">Sửa đơn (đính chính)</h2>
            <p className="mt-1 text-xs text-slate-500">Tạo bản đơn mới thay thế đơn đã ký — bản cũ vẫn lưu lại trong lịch sử, không mất.</p>

            <div className="scroll-hover mt-3 flex-1 space-y-2 overflow-y-auto">
              {amendLines.map((line) => (
                <div key={line.key} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      {line.drugName}
                      {line.drugId === null && (
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          Ngoài danh mục
                        </span>
                      )}
                    </p>
                    <button type="button" onClick={() => setAmendLines((prev) => prev.filter((l) => l.key !== line.key))} className="text-slate-400 hover:text-rose-600" aria-label={`Bỏ ${line.drugName} khỏi bản đính chính`}>
                      <X size={15} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                  <DoseLineEditor
                    idPrefix={`amend-dose-${line.key}`}
                    line={line}
                    canEdit
                    showAids={false}
                    daysField={
                      <div className="w-16">
                        <LineInput dense label="Số ngày" type="number" value={line.durationDays} onChange={(v) => patchAmendLine(line.key, { durationDays: v })} />
                      </div>
                    }
                    onPatch={(patch) => patchAmendLine(line.key, patch)}
                    onCommit={(patch) => patchAmendLine(line.key, patch)}
                    onAppendInstruction={(sentence) => patchAmendLine(line.key, { instruction: appendSentence(line.instruction, sentence) })}
                  />
                  <div className="mt-2">
                    <LineInput label="Hướng dẫn dùng" underline value={line.instruction} onChange={(v) => patchAmendLine(line.key, { instruction: v })} />
                  </div>
                  <DoseLinePreview line={line} />
                </div>
              ))}
              <DrugPicker
                excludeDrugIds={amendLines.map((l) => l.drugId)}
                onSelect={(drug) => setAmendLines((prev) => [...prev, emptyDoseLine(drug, masterDaysOf(prev))])}
                onAddFreeText={(name) => setAmendLines((prev) => [...prev, emptyDoseLine({ drugId: null, drugName: name, unitCode: null, isSplittable: true }, masterDaysOf(prev))])}
              />
            </div>

            <div className="mt-3">
              <Textarea id="amend-advice" label="Lời dặn của bác sĩ" rows={2} value={amendAdvice} onChange={(e) => setAmendAdvice(e.target.value)} placeholder="Lời dặn riêng cho đơn thuốc này…" />
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              <label htmlFor="amend-reason" className="text-sm font-semibold text-slate-800">
                Lý do đính chính
              </label>
              <textarea
                id="amend-reason"
                rows={2}
                value={amendReason}
                onChange={(e) => setAmendReason(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {amendError && (
              <p role="alert" className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-xs font-semibold text-rose-700">
                {amendError}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAmendOpen(false)}>
                Huỷ
              </Button>
              <Button type="button" onClick={handleAmendSubmit} loading={amendMutation.isPending} disabled={amendReason.trim() === '' || amendLines.length === 0}>
                Lưu bản đính chính
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Khung cảnh báo "thuốc không chia được nhưng kê liều lẻ" ngay trong dòng thuốc (#241, đúng mockup): `warn` = vàng + "Bỏ qua cảnh báo này",
 * `block` = đỏ (phòng khám bật chế độ Chặn — không bỏ qua được, Ký đơn bị khoá), `ack` = xám "Đã bỏ qua" + "Hiện lại".
 */
function SplitDoseAlert({
  state,
  drugName,
  pending,
  onAcknowledge,
  onRestore,
}: {
  state: 'warn' | 'block' | 'ack';
  drugName: string;
  pending: boolean;
  onAcknowledge: () => void;
  onRestore: () => void;
}) {
  if (state === 'ack') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[13px] font-semibold text-slate-600">
        Đã bỏ qua cảnh báo chia lẻ cho thuốc này.
        <Button type="button" variant="secondary" className="px-2 py-0 text-[11px]" loading={pending} onClick={onRestore}>
          Hiện lại
        </Button>
      </div>
    );
  }
  const block = state === 'block';
  return (
    <div
      role="alert"
      className={`mt-2 flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px] font-semibold ${
        block ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <Warning size={16} weight="fill" className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {drugName} không bẻ chia được.{' '}
        {block ? 'Phòng khám đang chặn kê liều lẻ cho thuốc này, hãy dùng liều nguyên.' : 'Liều lẻ có thể làm thuốc mất tác dụng hoặc gây quá liều.'}
      </span>
      {!block && (
        <Button type="button" variant="secondary" className="shrink-0 px-2.5 py-0.5 text-xs" loading={pending} onClick={onAcknowledge}>
          Bỏ qua cảnh báo này
        </Button>
      )}
    </div>
  );
}

/** Kho Thuốc GĐ5 — khối "Mã đơn thuốc/BS kê đơn/Ngày kê" + "Chẩn đoán lâm sàng" (mockup đã duyệt).
 * Hiện ở CẢ đơn nháp lẫn đã ký — nháp hiện placeholder "Cấp khi ký đơn"/"Đang soạn" cho 2 trường
 * chỉ có ý nghĩa sau khi ký. `doctorName` là actor ĐANG ĐĂNG NHẬP (không phải resolve `signedBy` từ
 * server) — cùng cách `PrescriptionPrintView` dùng cho tiêu đề in, chấp nhận được vì `prescription.
 * create/sign` đều scope `personal` (chỉ chính bác sĩ phụ trách encounter mới kê/ký được đơn này). */
function PrescriptionInfoHeader({
  prescriptionNo,
  doctorName,
  signedAt,
  diagnosisLabel,
}: {
  prescriptionNo: string | null;
  doctorName: string;
  signedAt: string | null;
  diagnosisLabel: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-3.5">
        <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-medium text-slate-500">Mã đơn thuốc</dt>
            <dd className="text-sm font-semibold text-slate-900">{prescriptionNo ?? 'Cấp khi ký đơn'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-slate-500">BS kê đơn</dt>
            <dd className="text-sm font-semibold text-slate-900">{doctorName}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-slate-500">Ngày kê</dt>
            <dd className="text-sm font-semibold text-slate-900">{signedAt ? new Date(signedAt).toLocaleString('vi-VN') : 'Đang soạn'}</dd>
          </div>
        </dl>
      </div>
      {/* data-diagnosis-anchor: StickyDiagnosisBar chỉ hiện khi khối này cuộn khuất khỏi đỉnh khung. */}
      <div data-diagnosis-anchor="" className="rounded-lg border border-amber-200 bg-amber-50 p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Chẩn đoán lâm sàng</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900">{diagnosisLabel || 'Chưa có chẩn đoán'}</p>
      </div>
    </div>
  );
}

/**
 * Kho Thuốc GĐ5 — "Đơn thuốc mẫu": modal 2 chế độ (danh sách mẫu / tạo mẫu mới từ đơn đang kê).
 * Dùng CHUNG toàn tenant, quyền `prescription_template.read`/`.manage` (xem
 * packages/core/src/rbac/permissions.ts) — nút "+ Lưu đơn hiện tại thành mẫu mới" tự ẩn nếu actor
 * không có quyền `manage` hoặc đơn đang kê chưa có dòng thuốc nào.
 */
function PrescriptionTemplateModal({
  draftLines,
  onApply,
  onClose,
}: {
  draftLines: DraftLine[];
  onApply: (template: PrescriptionTemplate) => void;
  onClose: () => void;
}) {
  const templatesQuery = usePrescriptionTemplatesQuery();
  const createMutation = useCreatePrescriptionTemplateMutation();
  const canManage = useHasPermission('prescription_template', 'manage');
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [newName, setNewName] = useState('');

  // "Đơn thuốc mẫu" LUÔN yêu cầu `drugId` thật (không đổi schema `prescription_template_item`) —
  // dòng "kê thuốc tự do" (mở rộng Kho Thuốc GĐ5) bị lọc bỏ khi lưu thành mẫu.
  const templatableLines = draftLines.filter((l): l is DraftLine & { drugId: string } => l.drugId !== null);
  const excludedFreeTextCount = draftLines.length - templatableLines.length;

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newName.trim() === '' || templatableLines.length === 0) return;
    createMutation.mutate(
      {
        name: newName.trim(),
        items: templatableLines.map((l) => ({
          drugId: l.drugId,
          ...lineDoseRequest(l),
          instruction: l.instruction.trim() || undefined,
        })),
      },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader
          icon={Stack}
          title="Đơn thuốc mẫu"
          subtitle={
            mode === 'list'
              ? templatesQuery.data
                ? `${templatesQuery.data.items.length} mẫu đã lưu`
                : undefined
              : 'Tạo mẫu mới từ đơn đang kê'
          }
          onClose={onClose}
        />

        {mode === 'list' ? (
          <>
            <div className="scroll-hover flex-1 overflow-y-auto">
              {templatesQuery.isLoading && (
                <div className="grid grid-cols-2 gap-2.5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
                  ))}
                </div>
              )}
              {templatesQuery.isSuccess && templatesQuery.data.items.length === 0 && (
                <EmptyState icon={Stack} title="Chưa có đơn thuốc mẫu nào" description="Lưu đơn đang kê thành mẫu để dùng lại nhanh cho lần sau." />
              )}
              <div className="grid grid-cols-2 gap-2.5">
                {templatesQuery.data?.items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onApply(t)}
                    className="group flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/60 hover:shadow"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-blue-50 text-blue-600 group-hover:bg-blue-100">
                        <Stack size={16} weight="fill" aria-hidden="true" />
                      </span>
                      <p className="min-w-0 flex-1 truncate pt-1.5 text-sm font-semibold text-slate-900">{t.name}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{t.items.length} thuốc</span>
                      <span className="flex items-center gap-1 text-xs font-semibold text-blue-600">
                        Dùng mẫu
                        <ArrowRight size={12} weight="bold" className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => setMode('create')}
                disabled={templatableLines.length === 0}
                title={templatableLines.length === 0 ? 'Đơn đang kê phải có ít nhất 1 dòng thuốc trong danh mục' : undefined}
                className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-blue-600 hover:border-blue-400 hover:bg-brand-teal-tint disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-300 disabled:hover:bg-transparent"
              >
                <Plus size={15} weight="bold" aria-hidden="true" />
                Lưu đơn hiện tại thành mẫu mới
              </button>
            )}
          </>
        ) : (
          <form onSubmit={handleCreateSubmit} className="flex flex-1 flex-col">
            <p className="mb-3 text-xs text-slate-500">
              Lưu {templatableLines.length} dòng thuốc đang kê thành mẫu dùng lại sau này.
              {excludedFreeTextCount > 0 && ` (${excludedFreeTextCount} dòng "Ngoài danh mục" không lưu được vào mẫu.)`}
            </p>
            <label htmlFor="template-name" className="text-sm font-semibold text-slate-800">
              Tên mẫu
            </label>
            <input
              id="template-name"
              type="text"
              autoFocus
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ví dụ: Phác đồ viêm hô hấp trên"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setMode('list')}>
                Quay lại
              </Button>
              <Button type="submit" loading={createMutation.isPending} disabled={newName.trim() === ''}>
                Lưu mẫu
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** `dense` (docs/DECISIONS.md #196, mockup đã duyệt) — ô nhập kiểu GẠCH DƯỚI (không viền khung) cho
 * liều dùng theo buổi/số ngày, thay khuôn ô viền cũ — đúng phản hồi "không dùng ô nhập có viền".
 * "Hướng dẫn dùng" giữ nguyên khuôn cũ (`dense=false`, không phải số lượng cần gọn). */
/** Export dùng chung — `PrescriptionTemplateCatalogPage.tsx` (trang quản lý "Đơn thuốc mẫu" trong
 * Quản trị, docs/DECISIONS.md #196) tái dùng nguyên input này cho cùng khuôn liều theo buổi. */
export function LineInput({
  label,
  value,
  onChange,
  onBlurCommit,
  onKeyDown,
  type = 'text',
  disabled,
  dense = false,
  underline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlurCommit?: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  type?: 'text' | 'number';
  disabled?: boolean;
  /** Ô hẹp, số căn giữa (liều theo buổi/số ngày) — kéo theo `underline`. */
  dense?: boolean;
  /** Kiểu GẠCH DƯỚI (docs/DECISIONS.md #196, mockup đã duyệt) thay khung viền cũ — dùng riêng được
   * (không hẹp) cho "Hướng dẫn dùng". */
  underline?: boolean;
}) {
  const isUnderline = dense || underline;
  return (
    <label className={`flex flex-col gap-0.5 text-xs font-semibold text-slate-600 ${dense ? 'text-center' : ''}`}>
      {label}
      <input
        type={type}
        min={dense ? 0 : undefined}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlurCommit?.(e.target.value)}
        onKeyDown={onKeyDown}
        className={
          isUnderline
            ? `w-full border-0 border-b-2 border-slate-300 bg-transparent px-0 py-1 text-sm ${dense ? 'font-semibold' : 'font-medium'} text-slate-900 focus:border-blue-500 focus:outline-none disabled:text-slate-400 ${dense ? 'text-center' : ''}`
            : 'rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50'
        }
      />
    </label>
  );
}

/** Xuất dùng chung — `EncounterHistoryDetailDialog.tsx` (xem chi tiết đợt khám cũ, chỉ đọc) tái dùng
 * nguyên bảng này cho đơn thuốc đã ký, không dựng bảng riêng. Cột "Liều dùng theo buổi" +
 * "SL"(+đơn vị) thay 3 cột "Liều dùng"/"Tần suất"/"SL" cũ (docs/DECISIONS.md #196). */
export function PrescriptionItemsTable({ items }: { items: PrescriptionItem[] }) {
  const unitNameByCode = useUnitNameByCode();
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <th className="py-2">Tên thuốc</th>
          <th className="py-2">Liều dùng</th>
          <th className="py-2 text-center">Số ngày</th>
          <th className="py-2 text-center">SL</th>
          <th className="py-2">Hướng dẫn</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-slate-100 last:border-0">
            <td className="py-2 font-medium text-slate-900">
              {item.kind && <PrescriptionKindChip kind={item.kind} className="mr-2 align-middle" />}
              {item.drugName}
              {item.drugId === null && (
                <span className="ml-1.5 rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  Ngoài danh mục
                </span>
              )}
            </td>
            <td className="py-2 text-slate-700">{formatPrescriptionDosePreview({ ...item, unitName: item.unitCode ? unitLabel(unitNameByCode, item.unitCode) : null })}</td>
            <td className="py-2 text-center text-slate-700">{item.durationDays ?? '—'}</td>
            <td className="py-2 text-center text-slate-700">
              {item.quantity} {item.unitCode ? unitLabel(unitNameByCode, item.unitCode) : ''}
            </td>
            <td className="py-2 text-slate-700">{item.instruction ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
