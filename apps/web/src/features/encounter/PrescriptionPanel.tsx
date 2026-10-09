import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle, ClockCounterClockwise, PencilSimple, Pill, Plus, Stack, Warning, X } from '@phosphor-icons/react';
import type { PrescriptionItem, PrescriptionResponse, PrescriptionTemplate } from '@nexamed/shared';
import { computePrescriptionQuantityPreview as computePrescriptionQuantity, formatDoseSummaryPreview as formatDoseSummary } from './prescription-dose-preview';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
import { usePharmacyStockTrackingEnabledQuery, useSoloClinicWorkflowEnabledQuery } from '../clinic/clinic.queries';
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
import {
  useAmendPrescriptionMutation,
  useGetPreviousPrescriptionMutation,
  usePrintPrescriptionMutation,
  useSavePrescriptionItemsMutation,
  useSignPrescriptionMutation,
} from './encounter.queries';

/** Liều dùng theo buổi Sáng/Trưa/Chiều/Tối (docs/DECISIONS.md #196, mockup đã duyệt) — thay hẳn 2 ô
 * tự do "Liều dùng"/"Tần suất" cũ. Tổng số lượng luôn TÍNH RA (không nhập tay), theo đơn vị NHỎ
 * NHẤT của thuốc (`unitCode` — CHỈ hiển thị, không có ô chọn đơn vị nào). */
interface DraftLine {
  /** Định danh RIÊNG cho thao tác sửa/xoá cục bộ ở component này — KHÔNG dùng `drugId` làm khoá vì
   * nhiều dòng "kê thuốc tự do" (mở rộng Kho Thuốc GĐ5) đều có `drugId=null`, không phân biệt được
   * nhau. Đúng khuôn `DraftLine.key` ở `DispensePrescriptionDialog.tsx`. */
  key: string;
  /** `null` = dòng "kê thuốc tự do, không qua danh mục" — xem `drugName` (luôn là tên tự do đã gõ). */
  drugId: string | null;
  drugName: string;
  /** Đơn vị nhỏ nhất của thuốc — `null` cho dòng tự do (không có danh mục để tra). */
  unitCode: string | null;
  doseMorning: string;
  doseNoon: string;
  doseAfternoon: string;
  doseEvening: string;
  durationDays: string;
  instruction: string;
}

function itemToDraft(item: PrescriptionItem): DraftLine {
  return {
    key: item.id,
    drugId: item.drugId,
    drugName: item.drugName,
    unitCode: item.unitCode,
    doseMorning: String(item.doseMorning),
    doseNoon: String(item.doseNoon),
    doseAfternoon: String(item.doseAfternoon),
    doseEvening: String(item.doseEvening),
    durationDays: String(item.durationDays),
    instruction: item.instruction ?? '',
  };
}

/** Tổng số lượng xem trước (client-side, số thật do backend tính lại lúc lưu — `computePrescriptionQuantity()` dùng chung 2 nơi). */
function draftLineTotal(line: DraftLine): number {
  return computePrescriptionQuantity(
    { doseMorning: Number(line.doseMorning) || 0, doseNoon: Number(line.doseNoon) || 0, doseAfternoon: Number(line.doseAfternoon) || 0, doseEvening: Number(line.doseEvening) || 0 },
    Number(line.durationDays) || 0,
  );
}

const WARNING_KIND_LABEL: Record<string, string> = {
  duplicate_active_ingredient: 'Trùng hoạt chất',
  allergy: 'Trùng dị nguyên đã biết của bệnh nhân',
  // Kho Thuốc GĐ5 — kê vượt TỔNG tồn kho toàn phòng khám, CẢNH BÁO MỀM (chặn cứng là lỗi 422 riêng
  // khi ký, không đi qua mảng `warnings` này — xem `EncounterConsultationPage`/backend).
  stock_insufficient: 'Kê vượt tồn kho',
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

  const isSigned = prescription !== null && prescription.signedAt !== null;
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
  const unitNameByCode = useUnitNameByCode();

  const [draftLines, setDraftLines] = useState<DraftLine[]>(() => (prescription?.items ?? []).map(itemToDraft));
  const [draftKey, setDraftKey] = useState(prescription?.id ?? 'new');
  // Đơn đổi sang bản khác hẳn (vd sau "Sửa đơn" tạo id mới) — nạp lại draft từ server thay vì giữ
  // state cũ đã lỗi thời. Không dùng useEffect (tránh 1 nhịp render lệch) — so sánh ngay trong
  // render, đúng mẫu "derived state reset theo key" của React.
  const currentKey = prescription?.id ?? 'new';
  if (currentKey !== draftKey) {
    setDraftKey(currentKey);
    setDraftLines((prescription?.items ?? []).map(itemToDraft));
  }

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
  const previousPrescriptionMutation = useGetPreviousPrescriptionMutation(encounterId);
  const [copyPreviousError, setCopyPreviousError] = useState<string | null>(null);

  function persistDraft(lines: DraftLine[]) {
    setDraftLines(lines);
    saveMutation.mutate({
      items: lines.map((l) => ({
        // "Kê thuốc tự do" — đúng 1 trong 2 (superRefine ở `packages/shared/src/prescription.ts`).
        ...(l.drugId !== null ? { drugId: l.drugId } : { freeTextDrugName: l.drugName }),
        doseMorning: Number(l.doseMorning) || 0,
        doseNoon: Number(l.doseNoon) || 0,
        doseAfternoon: Number(l.doseAfternoon) || 0,
        doseEvening: Number(l.doseEvening) || 0,
        durationDays: Math.max(1, Number(l.durationDays) || 1),
        instruction: l.instruction.trim() || undefined,
      })),
    });
  }

  function handleAddDrug(drug: { drugId: string; drugName: string; unitCode: string | null }) {
    setDraftLines((prev) => [
      ...prev,
      { key: crypto.randomUUID(), drugId: drug.drugId, drugName: drug.drugName, unitCode: drug.unitCode, doseMorning: '', doseNoon: '', doseAfternoon: '', doseEvening: '', durationDays: '5', instruction: '' },
    ]);
  }

  /** "Kê thuốc tự do, không qua danh mục" (mở rộng Kho Thuốc GĐ5) — thêm 1 dòng chỉ có tên tự do,
   * `drugId=null`. Chỉ gọi được khi `DrugPicker.tsx` tự xác nhận tenant đã bật công tắc. */
  function handleAddFreeTextDrug(name: string) {
    setDraftLines((prev) => [
      ...prev,
      { key: crypto.randomUUID(), drugId: null, drugName: name, unitCode: null, doseMorning: '', doseNoon: '', doseAfternoon: '', doseEvening: '', durationDays: '5', instruction: '' },
    ]);
  }

  /** Kho Thuốc GĐ5 — "Đơn thuốc mẫu": chèn cả cụm dòng thuốc của mẫu vào đơn đang kê (bỏ qua thuốc
   * đã có sẵn trong đơn, tránh trùng) — CHƯA lưu ngay, bác sĩ sửa tiếp rồi tự bấm "Lưu đơn nháp",
   * đúng khuôn `handleAddDrug` (thêm 1 thuốc) ở trên. Mẫu LUÔN tham chiếu thuốc thật (`drugId`
   * bắt buộc ở `prescription_template_item`) — không có nhánh tự do ở đây. */
  function applyTemplate(template: PrescriptionTemplate) {
    setDraftLines((prev) => {
      const existingIds = new Set(prev.map((l) => l.drugId));
      const additions: DraftLine[] = template.items
        .filter((item) => !existingIds.has(item.drugId))
        .map((item) => ({
          key: crypto.randomUUID(),
          drugId: item.drugId,
          drugName: item.drugName,
          unitCode: item.unitCode,
          doseMorning: String(item.doseMorning),
          doseNoon: String(item.doseNoon),
          doseAfternoon: String(item.doseAfternoon),
          doseEvening: String(item.doseEvening),
          durationDays: String(item.durationDays),
          instruction: item.instruction ?? '',
        }));
      return [...prev, ...additions];
    });
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
        setDraftLines((prev) => {
          const existingIds = new Set(prev.map((l) => l.drugId));
          const additions: DraftLine[] = previous.items.filter((item) => !existingIds.has(item.drugId)).map((item) => ({
            key: crypto.randomUUID(),
            drugId: item.drugId,
            drugName: item.drugName,
            unitCode: item.unitCode,
            doseMorning: String(item.doseMorning),
            doseNoon: String(item.doseNoon),
            doseAfternoon: String(item.doseAfternoon),
            doseEvening: String(item.doseEvening),
            durationDays: String(item.durationDays),
            instruction: item.instruction ?? '',
          }));
          return [...prev, ...additions];
        });
      },
      onError: (err) => setCopyPreviousError(err instanceof ApiError ? err.message : 'Không sao chép được đơn lần trước, vui lòng thử lại.'),
    });
  }

  function handleRemoveLine(key: string) {
    persistDraft(draftLines.filter((l) => l.key !== key));
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setDraftLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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

  async function handlePrint() {
    await printMutation.mutateAsync();
    setTimeout(() => window.print(), 100);
  }

  function openAmend() {
    setAmendLines((prescription?.items ?? []).map(itemToDraft));
    setAmendReason('');
    setAmendOpen(true);
  }

  function handleAmendSubmit() {
    if (!prescription || amendReason.trim() === '' || amendLines.length === 0) return;
    amendMutation.mutate(
      {
        amendmentReason: amendReason.trim(),
        version: prescription.version,
        items: amendLines.map((l) => ({
          ...(l.drugId !== null ? { drugId: l.drugId } : { freeTextDrugName: l.drugName }),
          doseMorning: Number(l.doseMorning) || 0,
          doseNoon: Number(l.doseNoon) || 0,
          doseAfternoon: Number(l.doseAfternoon) || 0,
          doseEvening: Number(l.doseEvening) || 0,
          durationDays: Math.max(1, Number(l.durationDays) || 1),
          instruction: l.instruction.trim() || undefined,
        })),
      },
      { onSuccess: () => setAmendOpen(false) },
    );
  }

  if (!hasPrimaryDiagnosis) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8">
        <EmptyState icon={Warning} title="Chưa thể kê đơn" description="Phải chọn chẩn đoán chính ở tab &quot;Khám &amp; Chẩn đoán&quot; trước khi kê đơn thuốc." />
      </div>
    );
  }

  const warnings = prescription?.warnings ?? [];

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
          {warnings.map((w, i) => (
            <p
              key={i}
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm font-semibold ${
                w.kind === 'stock_insufficient' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
            >
              <Warning size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
              {WARNING_KIND_LABEL[w.kind] ?? w.kind}: <span className="font-normal">{w.label}</span> — {w.drugNames.join(', ')}
            </p>
          ))}
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
              <PrintButton documentType="PRESCRIPTION" variant="primary" onPrint={() => void handlePrint()} loading={printMutation.isPending}>
                In đơn
              </PrintButton>
            </div>
          </div>
          <PrescriptionItemsTable items={prescription!.items} />
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          {canEdit && (
            <div className="mb-4 flex-shrink-0 rounded-lg border-2 border-blue-200 bg-blue-50 p-3 shadow-sm">
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
              <p className="mb-2 text-xs text-slate-500">Tổng số lượng = (Sáng + Trưa + Chiều + Tối) × Số ngày — luôn theo đơn vị nhỏ nhất của thuốc, không đổi được.</p>
              <DrugPicker ref={drugPickerRef} highlight excludeDrugIds={draftLines.map((l) => l.drugId)} onSelect={(drug) => handleAddDrug(drug)} onAddFreeText={handleAddFreeTextDrug} />
            </div>
          )}
          {draftLines.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">Chưa có dòng thuốc nào — tìm và thêm thuốc bên dưới.</p>
          ) : (
            <div className="mb-4 flex flex-col gap-2">
              {draftLines.map((line) => (
                <div key={line.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-slate-200 p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900">{line.drugName}</p>
                      {line.drugId === null && (
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                          Ngoài danh mục
                        </span>
                      )}
                      {line.drugId !== null && showStock && onHandByDrugId[line.drugId] !== undefined && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${
                            onHandByDrugId[line.drugId]! > 0 ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        >
                          {onHandByDrugId[line.drugId]! > 0 ? `Tồn ${onHandByDrugId[line.drugId]}` : 'Hết hàng'}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-end gap-4">
                      <div className="w-14">
                        <LineInput dense label="Sáng" type="number" value={line.doseMorning} onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.key === line.key ? { ...l, doseMorning: v } : l)))} onChange={(v) => updateLine(line.key, { doseMorning: v })} disabled={!canEdit} />
                      </div>
                      <div className="w-14">
                        <LineInput dense label="Trưa" type="number" value={line.doseNoon} onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.key === line.key ? { ...l, doseNoon: v } : l)))} onChange={(v) => updateLine(line.key, { doseNoon: v })} disabled={!canEdit} />
                      </div>
                      <div className="w-14">
                        <LineInput dense label="Chiều" type="number" value={line.doseAfternoon} onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.key === line.key ? { ...l, doseAfternoon: v } : l)))} onChange={(v) => updateLine(line.key, { doseAfternoon: v })} disabled={!canEdit} />
                      </div>
                      <div className="w-14">
                        <LineInput dense label="Tối" type="number" value={line.doseEvening} onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.key === line.key ? { ...l, doseEvening: v } : l)))} onChange={(v) => updateLine(line.key, { doseEvening: v })} disabled={!canEdit} />
                      </div>
                      <span className="pb-1.5 text-lg font-bold text-slate-300">×</span>
                      <div className="w-16">
                        <LineInput dense label="Số ngày" type="number" value={line.durationDays} onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.key === line.key ? { ...l, durationDays: v } : l)))} onChange={(v) => updateLine(line.key, { durationDays: v })} disabled={!canEdit} />
                      </div>
                      <span className="pb-1.5 text-lg font-bold text-slate-300">=</span>
                      <div className="rounded-md bg-brand-teal-tint px-3 py-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tổng số</div>
                        <div className="text-[15px] font-bold text-blue-700">
                          {draftLineTotal(line)} {line.unitCode ? unitLabel(unitNameByCode, line.unitCode) : ''}
                        </div>
                      </div>
                    </div>
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
                  </div>
                  {canEdit && (
                    <button type="button" onClick={() => handleRemoveLine(line.key)} className="h-fit text-slate-400 hover:text-rose-600" aria-label={`Xoá ${line.drugName}`}>
                      <X size={16} weight="bold" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => persistDraft(draftLines)} loading={saveMutation.isPending}>
                <Plus size={15} weight="bold" aria-hidden="true" />
                Lưu đơn nháp
              </Button>
              <Button type="button" onClick={handleSign} loading={signMutation.isPending} disabled={!prescription || prescription.items.length === 0}>
                Ký đơn
              </Button>
            </div>
          )}
        </div>
      )}

      {isSigned && prescription && (
        <PrescriptionPrintView
          doctorName={doctorName}
          patientFullName={patientFullName}
          patientDob={patientDob}
          patientGender={patientGender}
          diagnosisLabel={diagnosisLabel}
          items={prescription.items}
          signedAt={prescription.signedAt!}
          advice={adviceText}
          followUpLabel={followUpLabel}
        />
      )}

      {dispenseOpen && prescription && (
        <DispensePrescriptionDialog prescriptionId={prescription.id} onClose={() => setDispenseOpen(false)} />
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
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                          Ngoài danh mục
                        </span>
                      )}
                    </p>
                    <button type="button" onClick={() => setAmendLines((prev) => prev.filter((l) => l.key !== line.key))} className="text-slate-400 hover:text-rose-600">
                      <X size={15} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-4">
                    <div className="w-14">
                      <LineInput dense label="Sáng" type="number" value={line.doseMorning} onChange={(v) => setAmendLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, doseMorning: v } : l)))} />
                    </div>
                    <div className="w-14">
                      <LineInput dense label="Trưa" type="number" value={line.doseNoon} onChange={(v) => setAmendLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, doseNoon: v } : l)))} />
                    </div>
                    <div className="w-14">
                      <LineInput dense label="Chiều" type="number" value={line.doseAfternoon} onChange={(v) => setAmendLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, doseAfternoon: v } : l)))} />
                    </div>
                    <div className="w-14">
                      <LineInput dense label="Tối" type="number" value={line.doseEvening} onChange={(v) => setAmendLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, doseEvening: v } : l)))} />
                    </div>
                    <span className="pb-1.5 text-lg font-bold text-slate-300">×</span>
                    <div className="w-16">
                      <LineInput dense label="Số ngày" type="number" value={line.durationDays} onChange={(v) => setAmendLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, durationDays: v } : l)))} />
                    </div>
                    <span className="pb-1.5 text-lg font-bold text-slate-300">=</span>
                    <div className="rounded-md bg-brand-teal-tint px-3 py-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tổng số</div>
                      <div className="text-[15px] font-bold text-blue-700">
                        {draftLineTotal(line)} {line.unitCode ? unitLabel(unitNameByCode, line.unitCode) : ''}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <DrugPicker
                excludeDrugIds={amendLines.map((l) => l.drugId)}
                onSelect={(drug) => setAmendLines((prev) => [...prev, { key: crypto.randomUUID(), drugId: drug.drugId, drugName: drug.drugName, unitCode: drug.unitCode, doseMorning: '', doseNoon: '', doseAfternoon: '', doseEvening: '', durationDays: '5', instruction: '' }])}
                onAddFreeText={(name) => setAmendLines((prev) => [...prev, { key: crypto.randomUUID(), drugId: null, drugName: name, unitCode: null, doseMorning: '', doseNoon: '', doseAfternoon: '', doseEvening: '', durationDays: '5', instruction: '' }])}
              />
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
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">Chẩn đoán lâm sàng</p>
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
          doseMorning: Number(l.doseMorning) || 0,
          doseNoon: Number(l.doseNoon) || 0,
          doseAfternoon: Number(l.doseAfternoon) || 0,
          doseEvening: Number(l.doseEvening) || 0,
          durationDays: Math.max(1, Number(l.durationDays) || 1),
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
                      <p className="min-w-0 flex-1 truncate pt-1.5 text-sm font-bold text-slate-900">{t.name}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{t.items.length} thuốc</span>
                      <span className="flex items-center gap-1 text-xs font-bold text-blue-600">
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
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
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
            ? `w-full border-0 border-b-2 border-slate-300 bg-transparent px-0 py-1 text-sm ${dense ? 'font-bold' : 'font-medium'} text-slate-900 focus:border-blue-500 focus:outline-none disabled:text-slate-400 ${dense ? 'text-center' : ''}`
            : 'rounded-md border border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50'
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
        <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
          <th className="py-2">Tên thuốc</th>
          <th className="py-2">Liều dùng theo buổi</th>
          <th className="py-2 text-center">Số ngày</th>
          <th className="py-2 text-center">SL</th>
          <th className="py-2">Hướng dẫn</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-slate-100 last:border-0">
            <td className="py-2 font-medium text-slate-900">
              {item.drugName}
              {item.drugId === null && (
                <span className="ml-1.5 rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                  Ngoài danh mục
                </span>
              )}
            </td>
            <td className="py-2 text-slate-700">{formatDoseSummary(item)}</td>
            <td className="py-2 text-center text-slate-700">{item.durationDays}</td>
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
