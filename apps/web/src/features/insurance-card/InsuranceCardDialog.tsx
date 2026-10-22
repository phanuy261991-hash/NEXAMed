import { Camera, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { InsuranceCard, InsuranceCardPhotoSide, InsuranceCardWarning } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { DateInput } from '../../shared/ui/DateInput';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { detectInsuranceCardKind, formatWarningMessage, KIND_CHIP_CLASS, KIND_LABEL, normalizeInsuranceCardNo, QUICK_BENEFIT_RATES, type InsuranceCardDraft } from './insurance-card-view';
import { useSaveInsuranceCardMutation, useUploadInsuranceCardPhotoMutation } from './insurance-card.queries';

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const inputClassName =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[15px] font-normal text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const labelClassName = 'mb-1 block text-sm font-semibold text-slate-800';

type BenefitChoice = '100' | '95' | '80' | 'other' | null;

function initialBenefit(rate: number | null): { choice: BenefitChoice; other: string } {
  if (rate === null) return { choice: null, other: '' };
  if ((QUICK_BENEFIT_RATES as readonly number[]).includes(rate)) return { choice: String(rate) as BenefitChoice, other: '' };
  return { choice: 'other', other: String(rate) };
}

/** Ô ảnh thẻ (mặt trước/sau) — chọn tệp JPG/PNG ≤ 3MB; hiện ảnh đang có hoặc ảnh vừa chọn. Ảnh chỉ được tải lên lúc bấm Lưu. */
function PhotoSlot({ label, currentUrl, file, onPick }: { label: string; currentUrl: string | null; file: File | null; onPick: (file: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);
  const shown = previewUrl ?? currentUrl;

  function handleFile(next: File | undefined) {
    setError(null);
    if (!next) return;
    if (next.type !== 'image/jpeg' && next.type !== 'image/png') {
      setError('Chỉ nhận ảnh JPG hoặc PNG.');
      return;
    }
    if (next.size > MAX_PHOTO_BYTES) {
      setError('Ảnh vượt quá 3MB.');
      return;
    }
    onPick(next);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex h-[92px] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border-[1.5px] border-dashed border-slate-300 bg-slate-50 text-[13px] font-semibold text-slate-500 hover:border-blue-400 hover:bg-blue-50"
        aria-label={shown ? `Đổi ảnh ${label.toLowerCase()}` : `Chọn ảnh ${label.toLowerCase()}`}
      >
        {shown ? (
          <img src={shown} alt={`Ảnh thẻ ${label.toLowerCase()}`} className="h-full w-full object-cover" />
        ) : (
          <>
            <Camera size={22} className="text-slate-400" aria-hidden="true" />
            {label}
          </>
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png" className="sr-only" tabIndex={-1} onChange={(e) => handleFile(e.target.files?.[0])} />
      {shown && <p className="mt-1 text-xs text-slate-500">{label} · bấm để đổi ảnh</p>}
      {error && <p className="mt-1 text-xs font-semibold text-rose-700">{error}</p>}
    </div>
  );
}

/**
 * Hộp thoại Thêm/Sửa thẻ BHYT (S2-04, docs/DECISIONS.md #243, mockup màn 2). Số thẻ tự chuẩn hoá (bỏ khoảng trắng/gạch nối, chữ hoa) và tự nhận diện kiểu thẻ
 * (12 chữ số = mới, 15 ký tự chữ+số = cũ, khác = cảnh báo mềm — vẫn lưu được). Ô trống số thẻ + bệnh nhân đã có CCCD 12 số thì gợi ý điền nhanh bằng số CCCD (chỉ điền, không tự lưu).
 * Hạn thẻ để trống = "chưa rõ hạn". Mức hưởng chọn nhanh 100/95/80 hoặc "Khác" (nhập 0–100), KHÔNG chọn sẵn. Ảnh thẻ (mặt trước/sau, tuỳ chọn) tải lên sau khi lưu thẻ.
 */
export function InsuranceCardDialog({
  patientId,
  patientName,
  patientNationalId,
  card,
  onClose,
  onSaved,
  onDraft,
}: {
  /** `null` = hồ sơ MỚI chưa lưu (Tiếp nhận) — phải truyền `onDraft`, hộp thoại không gọi máy chủ mà trả thẻ nháp. */
  patientId: string | null;
  patientName: string;
  patientNationalId: string | null;
  /** `null` = Thêm thẻ mới; có giá trị = Sửa thẻ đó. */
  card: InsuranceCard | null;
  onClose: () => void;
  /** `photoError`: thẻ ĐÃ lưu nhưng tải ảnh lỗi — nơi gọi báo cho người dùng. */
  onSaved: (warnings: InsuranceCardWarning[], photoError: string | null) => void;
  /** Chế độ nháp (hồ sơ mới): nhận thẻ đã nhập, KHÔNG lưu máy chủ. */
  onDraft?: (draft: InsuranceCardDraft) => void;
}) {
  const saveMutation = useSaveInsuranceCardMutation(patientId ?? '');
  const photoMutation = useUploadInsuranceCardPhotoMutation(patientId ?? '');
  const [cardNo, setCardNo] = useState(card?.cardNo ?? '');
  const [validFrom, setValidFrom] = useState(card?.validFrom ?? '');
  const [validTo, setValidTo] = useState(card?.validTo ?? '');
  const [facilityCode, setFacilityCode] = useState(card?.facilityCode ?? '');
  const [facilityName, setFacilityName] = useState(card?.facilityName ?? '');
  const initial = initialBenefit(card?.benefitRate ?? null);
  const [benefitChoice, setBenefitChoice] = useState<BenefitChoice>(initial.choice);
  const [benefitOther, setBenefitOther] = useState(initial.other);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const numberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    numberRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const normalized = normalizeInsuranceCardNo(cardNo);
  const kind = detectInsuranceCardKind(normalized);
  const cccdSuggestion = patientNationalId && detectInsuranceCardKind(normalizeInsuranceCardNo(patientNationalId)) === 'NEW_12' ? normalizeInsuranceCardNo(patientNationalId) : null;
  const rangeInvalid = validFrom !== '' && validTo !== '' && validTo < validFrom;
  const benefitOtherNumber = benefitOther.trim() === '' ? null : Number(benefitOther);
  const benefitOtherInvalid = benefitChoice === 'other' && (benefitOtherNumber === null || !Number.isInteger(benefitOtherNumber) || benefitOtherNumber < 0 || benefitOtherNumber > 100);
  const facilityCodeInvalid = facilityCode !== '' && !/^\d{5}$/.test(facilityCode);
  const canSubmit = normalized.length > 0 && !rangeInvalid && !benefitOtherInvalid && !facilityCodeInvalid && !pending;

  function resolveBenefit(): number | null {
    if (benefitChoice === null) return null;
    if (benefitChoice === 'other') return benefitOtherNumber;
    return Number(benefitChoice);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setPending(true);
    try {
      const fields = {
        validFrom: validFrom || null,
        validTo: validTo || null,
        facilityCode: facilityCode.trim() || null,
        facilityName: facilityName.trim() || null,
        benefitRate: resolveBenefit(),
      };
      if (onDraft) {
        onDraft({ cardNo: normalized, ...fields, frontFile, backFile });
        return;
      }
      const result = await saveMutation.mutateAsync(
        card ? { cardId: card.id, update: { cardNo, version: card.version, ...fields } } : { cardId: null, create: { cardNo, ...fields } },
      );
      let version = result.card.version;
      let photoError: string | null = null;
      const staged: Array<[InsuranceCardPhotoSide, File | null]> = [
        ['front', frontFile],
        ['back', backFile],
      ];
      for (const [side, file] of staged) {
        if (!file) continue;
        try {
          const uploaded = await photoMutation.mutateAsync({ cardId: result.card.id, side, version, file });
          version = uploaded.card.version;
        } catch (err) {
          photoError = err instanceof ApiError ? err.message : 'Không tải được ảnh thẻ.';
          break;
        }
      }
      onSaved(result.warnings, photoError);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được thẻ, vui lòng thử lại.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label={card ? 'Sửa thẻ BHYT' : 'Thêm thẻ BHYT'}>
      <form onSubmit={(e) => void handleSubmit(e)} className="my-auto w-full max-w-[620px] rounded-xl bg-white p-5 shadow-xl">
        <ModalHeader icon={ShieldCheck} title={card ? 'Sửa thẻ BHYT' : 'Thêm thẻ BHYT'} subtitle={`Bệnh nhân: ${patientName}`} onClose={onClose} />

        <div className="grid grid-cols-1 gap-x-3.5 gap-y-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="insurance-card-no" className={labelClassName}>
              Số thẻ BHYT <span className="text-rose-500">*</span>
            </label>
            <input
              ref={numberRef}
              id="insurance-card-no"
              value={cardNo}
              onChange={(e) => setCardNo(e.target.value)}
              onBlur={() => normalized && setCardNo(normalized)}
              autoComplete="off"
              maxLength={24}
              placeholder="12 chữ số (thẻ mới) hoặc 15 ký tự (thẻ cũ)"
              className={`${inputClassName} text-[17px] tracking-[0.06em] tabular-nums`}
            />
            <div className="mt-1.5 flex min-h-[26px] flex-wrap items-center gap-2" aria-live="polite">
              {normalized === '' ? (
                cccdSuggestion && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setCardNo(cccdSuggestion);
                        numberRef.current?.focus();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-blue-500 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      Dùng số CCCD <span className="tabular-nums tracking-wide">{cccdSuggestion}</span>
                    </button>
                    <span className="text-xs text-slate-500">Gợi ý từ hồ sơ bệnh nhân</span>
                  </>
                )
              ) : (
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${KIND_CHIP_CLASS[kind]}`}>{KIND_LABEL[kind]}</span>
              )}
            </div>
            {normalized !== '' && kind === 'UNKNOWN' && (
              <p role="alert" className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
                <WarningCircle size={16} weight="fill" className="mt-0.5 flex-none text-amber-500" aria-hidden="true" />
                <span>{formatWarningMessage(normalized)}</span>
              </p>
            )}
          </div>

          <div>
            <label htmlFor="insurance-valid-from" className={labelClassName}>
              Hiệu lực từ ngày
            </label>
            <DateInput id="insurance-valid-from" value={validFrom} onChange={setValidFrom} />
          </div>
          <div>
            <label htmlFor="insurance-valid-to" className={labelClassName}>
              Hiệu lực đến ngày
            </label>
            <DateInput id="insurance-valid-to" value={validTo} onChange={setValidTo} />
            <p className={`mt-1 text-xs ${rangeInvalid ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
              {rangeInvalid ? 'Hạn thẻ phải sau hoặc bằng ngày bắt đầu hiệu lực.' : 'Để trống nếu thẻ không in hạn: thẻ hiện nhãn "Chưa rõ hạn".'}
            </p>
          </div>

          <div>
            <label htmlFor="insurance-facility-code" className={labelClassName}>
              Mã cơ sở KCB ban đầu
            </label>
            <input
              id="insurance-facility-code"
              value={facilityCode}
              onChange={(e) => setFacilityCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              placeholder="5 chữ số"
              className={inputClassName}
            />
            {facilityCodeInvalid && <p className="mt-1 text-xs font-semibold text-rose-700">Mã cơ sở KCB gồm 5 chữ số.</p>}
          </div>
          <div>
            <label htmlFor="insurance-facility-name" className={labelClassName}>
              Tên cơ sở KCB ban đầu
            </label>
            <input id="insurance-facility-name" value={facilityName} onChange={(e) => setFacilityName(e.target.value)} maxLength={200} placeholder="Ví dụ: Trạm Y tế Phường 12" className={inputClassName} />
          </div>

          <div className="sm:col-span-2">
            <span id="insurance-benefit-label" className={labelClassName}>
              Mức hưởng
            </span>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="insurance-benefit-label">
              {([...QUICK_BENEFIT_RATES.map(String), 'other'] as Array<'100' | '95' | '80' | 'other'>).map((value) => {
                const selected = benefitChoice === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setBenefitChoice(selected ? null : value)}
                    className={`min-w-16 rounded-md border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                      selected ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:bg-brand-teal-tint'
                    }`}
                  >
                    {value === 'other' ? 'Khác' : `${value}%`}
                  </button>
                );
              })}
              {benefitChoice === 'other' && (
                <span className="inline-flex items-center gap-1.5">
                  <input
                    aria-label="Mức hưởng khác (phần trăm)"
                    value={benefitOther}
                    onChange={(e) => setBenefitOther(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    inputMode="numeric"
                    placeholder="0–100"
                    className={`${inputClassName} w-24`}
                  />
                  <span className="text-sm font-semibold text-slate-700">%</span>
                </span>
              )}
            </div>
            <p className={`mt-1 text-xs ${benefitOtherInvalid ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
              {benefitOtherInvalid ? 'Nhập số nguyên từ 0 đến 100.' : 'Chỉ để hiển thị và in, hệ thống không tính chi trả. Bấm lại mức đang chọn để bỏ chọn.'}
            </p>
          </div>

          <div className="sm:col-span-2">
            <span className={labelClassName}>Ảnh thẻ (tuỳ chọn)</span>
            <div className="grid grid-cols-2 gap-2.5">
              <PhotoSlot label="Mặt trước" currentUrl={card?.photoFrontUrl ?? null} file={frontFile} onPick={setFrontFile} />
              <PhotoSlot label="Mặt sau" currentUrl={card?.photoBackUrl ?? null} file={backFile} onPick={setBackFile} />
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="text-xs text-slate-500">Số thẻ được mã hoá khi lưu</span>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" loading={pending} disabled={!canSubmit}>
              Lưu
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
