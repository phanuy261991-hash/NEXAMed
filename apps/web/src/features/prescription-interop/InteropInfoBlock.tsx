import { useEffect, useMemo, useState } from 'react';
import { CaretDown, CheckCircle, UploadSimple, Warning } from '@phosphor-icons/react';
import type { EncounterInteropKind, PrescriptionResponse, SaveEncounterInteropInfoRequest } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { Combobox, withLegacyValueOption } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { PRESCRIPTION_KIND_TEXT } from '../../shared/ui/PrescriptionKindChip';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Textarea } from '../../shared/ui/Textarea';
import { useHasPermission } from '../auth/usePermission';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import {
  draftFromKind,
  draftToValue,
  draftsEqual,
  guardianDraftEqual,
  kindUsesDosePeriod,
  kindUsesHerbal,
  kindUsesTreatmentForm,
  requiredProblems,
  summarizeMissing,
  validateDraft,
  type GuardianDraft,
  type KindDraft,
} from './interop-info-view';
import { useEncounterInteropInfoQuery, usePrescriptionInteropStatusQuery, useSaveEncounterInteropInfoMutation } from './prescription-interop.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-800';
const labelClassName = 'mb-1.5 block text-sm font-semibold text-slate-800';

/**
 * Khối "Thông tin liên thông đơn thuốc quốc gia" ở tab Kê đơn (docs/DECISIONS.md #242 GĐ3, mockup 8a/8b): ô bổ sung bắt buộc khi gửi đơn theo từng loại đơn (hình thức điều trị, đợt dùng thuốc,
 * số thang + cách sắc/uống), người giám hộ của trẻ dưới 72 tháng, và dải "Còn thiếu: …" (CẢNH BÁO MỀM — không chặn ký/in). Công tắc "Có liên thông" tắt thì ẩn cả khối.
 * Các ô lưu RIÊNG, không thuộc nội dung đơn đã ký: sửa được cho tới khi đơn được gửi lên cổng (loại đơn đã gửi thì khoá).
 */
export function InteropInfoBlock({ encounterId, prescription }: { encounterId: string; prescription: PrescriptionResponse }) {
  const statusQuery = usePrescriptionInteropStatusQuery();
  const enabled = statusQuery.data?.enabled === true;
  const canSave = useHasPermission('prescription', 'create');
  const hasPrescription = prescription !== null && prescription.items.length > 0;
  const infoQuery = useEncounterInteropInfoQuery(encounterId, prescription?.version ?? null, enabled && hasPrescription);
  const saveMutation = useSaveEncounterInteropInfoMutation(encounterId);
  const treatmentFormQuery = useReferenceCatalogQuery('TREATMENT_FORM');

  const [expanded, setExpanded] = useState(true);
  const [drafts, setDrafts] = useState<Partial<Record<string, KindDraft>>>({});
  const [guardianEdit, setGuardianEdit] = useState<GuardianDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const info = infoQuery.data;
  // Dữ liệu máy chủ đổi (lưu xong, đơn đổi phiên bản) → bỏ bản nháp cục bộ, hiện lại đúng giá trị đã lưu + gợi ý.
  const serverSignature = useMemo(() => (info ? JSON.stringify({ kinds: info.kinds.map((k) => [k.kind, k.info, k.suggested, k.editable]), guardian: info.guardian }) : ''), [info]);
  useEffect(() => {
    setDrafts({});
    setGuardianEdit(null);
  }, [serverSignature]);

  const treatmentFormOptions = useMemo(() => (treatmentFormQuery.data?.items ?? []).filter((i) => i.isActive).map((i) => ({ value: i.code, label: `${i.code} — ${i.name}` })), [treatmentFormQuery.data]);

  if (!enabled || !hasPrescription) return null;
  if (infoQuery.isPending) return <div className="h-12 animate-pulse rounded-lg border border-slate-200 bg-slate-50" aria-hidden="true" />;
  if (infoQuery.isError || !info) return <ErrorBanner message="Không tải được thông tin liên thông đơn thuốc quốc gia." onRetry={() => void infoQuery.refetch()} />;
  if (!info.enabled) return null;

  const draftOf = (k: EncounterInteropKind): KindDraft => drafts[k.kind] ?? draftFromKind(k);
  const baseGuardian: GuardianDraft = { fullName: info.guardian?.fullName ?? '', phone: info.guardian?.phone ?? '', address: info.guardian?.address ?? '' };
  const guardianDraft = guardianEdit ?? baseGuardian;
  const guardianEditable = canSave && info.guardian?.canEdit === true;

  const dirtyKinds = info.kinds.filter((k) => k.editable && drafts[k.kind] !== undefined && !draftsEqual(draftOf(k), draftFromKind(k)));
  const guardianDirty = guardianEdit !== null && !guardianDraftEqual(guardianEdit, baseGuardian);
  const dirty = dirtyKinds.length > 0 || guardianDirty;
  const missing = requiredProblems(info.problems);
  const missingText = summarizeMissing(info.problems);
  const validationError = info.kinds.map((k) => validateDraft(k.kind, draftOf(k))).find((m) => m !== null) ?? null;

  function setField(k: EncounterInteropKind, patch: Partial<KindDraft>) {
    setSaved(false);
    setDrafts((prev) => ({ ...prev, [k.kind]: { ...(prev[k.kind] ?? draftFromKind(k)), ...patch } }));
  }

  function setGuardianField(patch: Partial<GuardianDraft>) {
    setSaved(false);
    setGuardianEdit({ ...guardianDraft, ...patch });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || validationError || saveMutation.isPending || !info) return;
    setError(null);
    const body: SaveEncounterInteropInfoRequest = {
      kinds: dirtyKinds.map((k) => ({ kind: k.kind, ...draftToValue(k.kind, draftOf(k)) })),
      ...(guardianDirty && info.guardian
        ? {
            guardian: {
              patientVersion: info.guardian.patientVersion,
              ...(guardianDraft.fullName.trim() !== '' ? { fullName: guardianDraft.fullName.trim() } : {}),
              ...(guardianDraft.phone.trim() !== '' ? { phone: guardianDraft.phone.trim() } : {}),
              ...(guardianDraft.address.trim() !== '' ? { address: guardianDraft.address.trim() } : {}),
            },
          }
        : {}),
    };
    saveMutation.mutate(body, {
      onSuccess: () => setSaved(true),
      onError: (err) => setError(err instanceof ApiError ? err.message : 'Không lưu được thông tin liên thông. Thử lại sau.'),
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm" aria-label="Thông tin liên thông đơn thuốc quốc gia">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 border-b border-slate-100 px-5 py-3 text-left"
      >
        <UploadSimple size={16} weight="fill" className="shrink-0 text-blue-600" aria-hidden="true" />
        <span className="text-sm font-semibold text-slate-800">Thông tin liên thông đơn thuốc quốc gia</span>
        {info.kinds.length > 0 && (missing.length > 0 ? <StatusBadge tone="warning">Thiếu {missing.length} mục</StatusBadge> : <StatusBadge tone="success">Đủ dữ liệu</StatusBadge>)}
        <span className="ml-auto flex items-center gap-1 text-xs text-slate-500">
          {expanded ? 'Thu gọn' : 'Mở rộng'}
          <CaretDown size={13} weight="bold" aria-hidden="true" className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {expanded && (
        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          {!info.standardMode && (
            <p className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
              Chế độ mã đơn &quot;Chuẩn Bộ Y tế&quot; chưa bật nên đơn này chưa có mã chuẩn và chưa gửi liên thông được. Bật ở Cấu hình hệ thống → Cấu hình mẫu mã phát sinh.
            </p>
          )}

          {info.kinds.map((k) => {
            const draft = draftOf(k);
            const lockedKind = !k.editable || !canSave;
            const idPrefix = `interop-${k.kind}`;
            return (
              <BoxedSection key={k.kind} badge={`Đơn ${k.kind} · ${PRESCRIPTION_KIND_TEXT[k.kind]}`}>
                {!k.editable && (
                  <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-600">
                    <CheckCircle size={16} weight="fill" className="text-emerald-500" aria-hidden="true" />
                    {k.submissionStatus === 'SENT' ? 'Đã gửi lên cổng — không sửa được nữa.' : 'Đã đính chính sau khi gửi — không sửa được nữa.'}
                  </p>
                )}

                {kindUsesTreatmentForm(k.kind) && (
                  <div>
                    <label htmlFor={`${idPrefix}-treatment-form`} className={labelClassName}>
                      Hình thức điều trị <span className="text-rose-500">*</span>
                    </label>
                    <Combobox
                      id={`${idPrefix}-treatment-form`}
                      value={draft.treatmentFormCode}
                      options={withLegacyValueOption(treatmentFormOptions, draft.treatmentFormCode)}
                      onChange={(v) => setField(k, { treatmentFormCode: v })}
                      disabled={lockedKind}
                      placeholder="Chọn theo danh mục của Bộ Y tế"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      {treatmentFormQuery.isSuccess && treatmentFormOptions.length === 0
                        ? 'Chưa có hình thức điều trị nào trong danh mục. Thêm ở Danh mục dùng chung → Hình thức điều trị (mã số theo danh mục của Bộ Y tế).'
                        : 'Bắt buộc với đơn loại C. Danh mục do Bộ Y tế ban hành (giá trị số).'}
                    </p>
                  </div>
                )}

                {kindUsesDosePeriod(k.kind) && (
                  <div>
                    <div className={`grid grid-cols-1 gap-4 ${kindUsesHerbal(k.kind) ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                      <div>
                        <label htmlFor={`${idPrefix}-period`} className={labelClassName}>
                          Đợt dùng thuốc <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id={`${idPrefix}-period`}
                          type="number"
                          min={1}
                          className={`${inputClassName} text-center`}
                          value={draft.dosePeriodNumber}
                          onChange={(e) => setField(k, { dosePeriodNumber: e.target.value })}
                          disabled={lockedKind}
                        />
                      </div>
                      <div>
                        <label htmlFor={`${idPrefix}-from`} className={labelClassName}>
                          Từ ngày <span className="text-rose-500">*</span>
                        </label>
                        <DateInput id={`${idPrefix}-from`} value={draft.doseFrom} onChange={(v) => setField(k, { doseFrom: v })} disabled={lockedKind} />
                      </div>
                      <div>
                        <label htmlFor={`${idPrefix}-to`} className={labelClassName}>
                          Đến ngày <span className="text-rose-500">*</span>
                        </label>
                        <DateInput id={`${idPrefix}-to`} value={draft.doseTo} onChange={(v) => setField(k, { doseTo: v })} disabled={lockedKind} />
                      </div>
                      {kindUsesHerbal(k.kind) && (
                        <div>
                          <label htmlFor={`${idPrefix}-herbal-doses`} className={labelClassName}>
                            Số thang thuốc <span className="text-rose-500">*</span>
                          </label>
                          <input
                            id={`${idPrefix}-herbal-doses`}
                            type="number"
                            min={1}
                            className={`${inputClassName} text-center`}
                            value={draft.herbalDoses}
                            onChange={(e) => setField(k, { herbalDoses: e.target.value })}
                            disabled={lockedKind}
                          />
                        </div>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Bắt buộc cho đơn N, H, Y. Tự điền: từ ngày = ngày kê, đến ngày = ngày kê cộng số ngày thuốc dài nhất của đơn trừ 1. Sửa được.
                      {kindUsesHerbal(k.kind) ? ' Đơn Y có thêm ô "Số thang thuốc".' : ''}
                    </p>
                  </div>
                )}

                {kindUsesHerbal(k.kind) && (
                  <div className="mt-4">
                    <Textarea
                      id={`${idPrefix}-herbal-instruction`}
                      label="Cách sắc thuốc và cách uống"
                      rows={2}
                      value={draft.herbalInstruction}
                      onChange={(e) => setField(k, { herbalInstruction: e.target.value })}
                      disabled={lockedKind}
                      maxLength={1000}
                    />
                    <p className="mt-1 text-xs text-slate-500">Tài liệu yêu cầu mô tả thêm cho đơn Y; gộp vào lời dặn khi gửi. Để trống thì chỉ cảnh báo, không chặn.</p>
                  </div>
                )}
              </BoxedSection>
            );
          })}

          {info.guardian && (
            <BoxedSection badge="Người giám hộ · bệnh nhân dưới 72 tháng tuổi">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="interop-guardian-name" className={labelClassName}>
                    Họ tên người giám hộ <span className="text-rose-500">*</span>
                  </label>
                  <input id="interop-guardian-name" className={inputClassName} value={guardianDraft.fullName} onChange={(e) => setGuardianField({ fullName: e.target.value })} disabled={!guardianEditable} maxLength={200} />
                </div>
                <div>
                  <label htmlFor="interop-guardian-phone" className={labelClassName}>
                    Số điện thoại <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="interop-guardian-phone"
                    className={inputClassName}
                    value={guardianDraft.phone}
                    onChange={(e) => setGuardianField({ phone: e.target.value })}
                    disabled={!guardianEditable}
                    placeholder="Chưa có trong hồ sơ"
                    maxLength={30}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="interop-guardian-address" className={labelClassName}>
                    Địa chỉ <span className="text-rose-500">*</span>
                  </label>
                  <input id="interop-guardian-address" className={inputClassName} value={guardianDraft.address} onChange={(e) => setGuardianField({ address: e.target.value })} disabled={!guardianEditable} maxLength={500} />
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Chỉ hiện khi bệnh nhân dưới 72 tháng tuổi. Tự lấy từ người thân đã nhập ở hồ sơ bệnh nhân; thiếu gì thì điền ở đây và lưu ngược về hồ sơ.
                {!guardianEditable ? ' Bạn không có quyền sửa hồ sơ bệnh nhân nên chỉ xem được.' : ''}
              </p>
            </BoxedSection>
          )}

          {missingText !== '' && (
            <p role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <Warning size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-semibold">Còn thiếu:</span> {missingText}. Vẫn ký và in được.
              </span>
            </p>
          )}
          {missing.length === 0 && info.kinds.length > 0 && info.problems.some((p) => !p.required) && (
            <p className="text-xs text-slate-500">{[...new Set(info.problems.filter((p) => !p.required).map((p) => p.message))].join(' ')}</p>
          )}

          {validationError && (
            <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {validationError}
            </p>
          )}
          {error && <ErrorBanner message={error} />}

          {canSave && info.kinds.some((k) => k.editable) && (
            <div className="flex items-center justify-end gap-3">
              {saved && !dirty && <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><CheckCircle size={16} weight="fill" aria-hidden="true" />Đã lưu</span>}
              <Button type="submit" loading={saveMutation.isPending} disabled={!dirty || validationError !== null}>
                Lưu thông tin liên thông
              </Button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}

