import { useState } from 'react';
import { Check as CheckIcon } from '@phosphor-icons/react';
import type { MedicineLabelConfig, PrescriptionInfoConfig, PrintDocumentType, PrintPaperInfo, PrintTemplateConfig } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { useAuthStore } from '../auth/auth.store';
import { showBranchInfo } from '../branch/branch-visibility';
import { Textarea } from '../../shared/ui/Textarea';
import { ALL_ON_PRESCRIPTION_INFO } from '../encounter/prescription-print-fields';
import { useInsuranceEnabledQuery } from '../clinic/clinic.queries';
import { DEFAULT_INSURANCE_PRINT, INSURANCE_PRINT_DOCUMENT_TYPES } from '../insurance-card/insurance-print';
import { DEFAULT_RECORD_BUNDLE, RECORD_BUNDLE_DOCUMENT_TYPES, recordBundleSummary } from '../../shared/print/record-bundle';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

type HeaderKey = keyof PrintTemplateConfig['header'];
type LabelKey = keyof NonNullable<PrintTemplateConfig['label']>;

/** Thông tin in THÊM trên tem ống nghiệm (docs/DECISIONS.md #220); mã vạch, mã ống, họ tên, năm sinh, giới tính luôn in nên không có công tắc. */
const LABEL_TOGGLES: { key: LabelKey; label: string }[] = [
  { key: 'showPatientCode', label: 'Mã bệnh nhân' },
  { key: 'showGroup', label: 'Nhóm xét nghiệm (viết tắt)' },
  { key: 'showCapColor', label: 'Loại ống / màu nắp' },
  { key: 'showDate', label: 'Ngày lấy mẫu (DD/MM)' },
];
const DEFAULT_LABEL_OPTIONS: NonNullable<PrintTemplateConfig['label']> = { showPatientCode: false, showGroup: true, showCapColor: false, showDate: true };

/**
 * Nội dung "Nhãn thuốc" (docs/DECISIONS.md #267, mockup 6 đã chốt): ba khối luôn in (không tắt được) + ba trường tuỳ chọn mặc định TẮT.
 * Bản cũ chưa có khối `medicineLabel` (vd. sau "Khôi phục mặc định") coi như tắt hết, ghi đủ khối khi người dùng đổi một ô.
 */
const MEDICINE_LABEL_ALWAYS: { label: string }[] = [{ label: 'Họ tên – năm sinh' }, { label: 'Tên thuốc (hàm lượng) và số lượng' }, { label: 'Câu dặn' }];
const MEDICINE_LABEL_TOGGLES: { key: keyof MedicineLabelConfig; label: string; hint: string }[] = [
  { key: 'showClinic', label: 'Tên phòng khám và số điện thoại', hint: 'In ở đầu nhãn, lấy từ thông tin phòng khám (theo chi nhánh phát thuốc).' },
  { key: 'showDate', label: 'Ngày phát', hint: 'Ngày phát thuốc thực tế.' },
  { key: 'showLot', label: 'Lô và hạn dùng', hint: 'Lấy từ lô đã xuất, chỉ có với thuốc quản lý theo lô.' },
];
const DEFAULT_MEDICINE_LABEL_OPTIONS: MedicineLabelConfig = { showClinic: false, showDate: false, showLot: false };

/** Số lượng dưới 10 in hai chữ số trên đơn thuốc (#267) — mặc định BẬT. */
const RX_QUANTITY_TOGGLE: RxToggle = {
  key: 'padSmallQuantity',
  label: 'In số lượng dưới 10 bằng hai chữ số',
  hint: '05 Gói, 01 Hộp. Từ 10 trở lên giữ nguyên (12 Viên). Mặc định bật, giống toa mẫu.',
};
type MarginKey = keyof PrintTemplateConfig['margins'];

type RxToggleKey = Exclude<keyof PrescriptionInfoConfig, 'nationalIdWhenMissing'>;
interface RxToggle {
  key: RxToggleKey;
  label: string;
  hint: string;
  /** Nhãn loại đơn áp dụng (chỉ các mục riêng của đơn "N"/"H"). */
  tag?: string;
}
/** Thông tin bệnh nhân in trên MỌI loại đơn thuốc (mockup "Mẫu in đơn thuốc" đã duyệt 20/10/2026, docs/DECISIONS.md #242). Họ tên, ngày sinh, giới tính, bác sĩ, chẩn đoán luôn in. */
const RX_PATIENT_TOGGLES: RxToggle[] = [
  { key: 'showPatientCode', label: 'Mã bệnh nhân', hint: 'Lấy từ hồ sơ bệnh nhân.' },
  { key: 'showNationalId', label: 'Số CCCD của bệnh nhân', hint: 'Lấy từ hồ sơ (đã mã hoá, chỉ giải mã khi in và ghi nhật ký xem).' },
  { key: 'showAddress', label: 'Địa chỉ liên hệ', hint: 'Địa chỉ trong hồ sơ.' },
  { key: 'showPhone', label: 'Số điện thoại liên hệ', hint: 'Số điện thoại trong hồ sơ.' },
  { key: 'showWeight', label: 'Cân nặng', hint: 'Lấy từ sinh hiệu của lượt khám; chưa đo thì in dòng chấm để viết tay.' },
  { key: 'showGuardian', label: 'Người giám hộ (trẻ dưới 72 tháng)', hint: 'Họ tên, quan hệ lấy từ "Người thân" trong hồ sơ; số CCCD người giám hộ chưa lưu nên in dòng chấm. Chỉ hiện với trẻ dưới 72 tháng.' },
];
/** Mục riêng theo mẫu đơn "N"/"H" của Thông tư 52/2017/TT-BYT. */
const RX_CONTROLLED_TOGGLES: RxToggle[] = [
  { key: 'showCourse', label: 'Đợt: từ ngày … đến hết ngày …', hint: 'Chưa có dữ liệu nên in dòng chấm để viết tay.', tag: 'Đơn N' },
  { key: 'showQuantityInWords', label: 'Số lượng viết bằng chữ', hint: 'Quy định bắt buộc với thuốc gây nghiện: "Sáu viên", chữ đầu viết hoa.', tag: 'Đơn N' },
  { key: 'showReceiverBox', label: 'Ô người nhận thuốc', hint: 'Ký, ghi rõ họ tên và số CCCD/CMND của người nhận thuốc.', tag: 'Đơn N · H' },
];

/**
 * Ô tích "Số thẻ BHYT" + lựa chọn khi lượt khám tự chi trả (S2-04, docs/DECISIONS.md #243, mockup màn 5). Khoá mờ khi công tắc tổng "Áp dụng BHYT" tắt.
 * Dùng chung cho đơn thuốc (nằm cạnh CCCD), phiếu thu và bệnh án PDF.
 */
function InsurancePrintRow({
  idPrefix,
  value,
  onChange,
  enabled,
}: {
  idPrefix: string;
  value: NonNullable<PrintTemplateConfig['insurance']>;
  onChange: (value: NonNullable<PrintTemplateConfig['insurance']>) => void;
  enabled: boolean;
}) {
  return (
    <div className={enabled ? undefined : 'opacity-60'}>
      <Check id={`${idPrefix}-show`} label="Số thẻ BHYT" checked={value.show} onChange={(v) => onChange({ ...value, show: v })} disabled={!enabled} />
      <p className="ml-6 mt-0.5 text-[11px] leading-snug text-slate-500">
        {enabled
          ? 'Lấy từ thẻ đã chụp vào lượt khám lúc Tiếp nhận (số thẻ, hiệu lực, mức hưởng, nơi đăng ký KCB).'
          : 'Đang khoá vì phòng khám chưa bật "Áp dụng BHYT" (Cấu hình phòng khám → Thẻ BHYT).'}
      </p>
      {value.show && enabled && (
        <div className="mb-1 ml-6 mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
          <label htmlFor={`${idPrefix}-whenSelfPay`}>Khi lượt khám tự chi trả:</label>
          <select
            id={`${idPrefix}-whenSelfPay`}
            value={value.whenSelfPay}
            onChange={(e) => onChange({ ...value, whenSelfPay: e.target.value === 'selfPay' ? 'selfPay' : 'hide' })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-normal text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="hide">Ẩn cả dòng</option>
            <option value="selfPay">In &quot;Tự chi trả&quot;</option>
          </select>
        </div>
      )}
    </div>
  );
}

function RxToggleRow({ toggle, checked, onChange }: { toggle: RxToggle; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="border-b border-slate-100 py-2 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <Check id={`pt-rx-${toggle.key}`} label={toggle.label} checked={checked} onChange={onChange} />
        {toggle.tag && <span className="flex-shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{toggle.tag}</span>}
      </div>
      <p className="ml-6 mt-0.5 text-[11px] leading-snug text-slate-500">{toggle.hint}</p>
    </div>
  );
}

const HEADER_TOGGLES: { key: HeaderKey; label: string }[] = [
  { key: 'showLogo', label: 'Logo phòng khám' },
  { key: 'showClinicName', label: 'Tên phòng khám' },
  { key: 'showBranchName', label: 'Tên chi nhánh' },
  { key: 'showAddress', label: 'Địa chỉ' },
  { key: 'showPhone', label: 'Điện thoại' },
  { key: 'showTaxCode', label: 'Mã số thuế' },
  { key: 'showDivider', label: 'Đường kẻ dưới' },
];

const MARGIN_FIELDS: { key: MarginKey; label: string }[] = [
  { key: 'topMm', label: 'Lề trên' },
  { key: 'bottomMm', label: 'Lề dưới' },
  { key: 'leftMm', label: 'Lề trái' },
  { key: 'rightMm', label: 'Lề phải' },
];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200">
      <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">{title}</h3>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Check({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-slate-700">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-blue-600" />
      {label}
    </label>
  );
}

/**
 * Một dòng của khối "Bộ hồ sơ khi in một lượt khám" (#272): có `onChange` = ô tích chọn được; không có = phần LUÔN in (ô tích khoá, kèm nhãn "Luôn in").
 */
function BundleRow({ id, label, hint, checked, onChange }: { id?: string; label: string; hint?: string; checked?: boolean; onChange?: (value: boolean) => void }) {
  const fixed = onChange === undefined;
  return (
    <div className="flex items-start gap-2.5 border-b border-slate-100 py-2 last:border-b-0">
      <input
        id={id}
        type="checkbox"
        checked={fixed ? true : checked === true}
        disabled={fixed}
        onChange={(e) => onChange?.(e.target.checked)}
        aria-label={fixed ? `${label} luôn in` : undefined}
        className="mt-0.5 h-4 w-4 flex-none accent-blue-600"
      />
      <div className="min-w-0 flex-1">
        {fixed ? (
          <span className="text-sm font-semibold text-slate-600">{label}</span>
        ) : (
          <label htmlFor={id} className="cursor-pointer text-sm font-semibold text-slate-800">
            {label}
          </label>
        )}
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </div>
      {fixed && <span className="flex-none rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">Luôn in</span>}
    </div>
  );
}

/** Ô nhập lề (mm) — giữ chuỗi gõ dở, chỉ ghi vào cấu hình khi là số nguyên 0-40. */
function MarginInput({ id, label, value, onCommit }: { id: string; label: string; value: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] text-slate-500">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 40) onCommit(n);
        }}
        onBlur={() => setText(String(value))}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-center font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
    </div>
  );
}

/**
 * Khối cấu hình của MỘT bản mẫu in ("Quản lý mẫu in", docs/DECISIONS.md #211, vùng giữa của mockup): tên, khổ giấy & lề,
 * đầu trang (+ tiêu đề), cuối trang & chữ ký, số liên. Thuần trình bày — trạng thái nháp do `PrintTemplatePage` giữ để
 * vùng xem trước cập nhật ngay.
 */
export function PrintTemplateConfigPanel({
  documentType,
  name,
  onNameChange,
  paper,
  config,
  onConfigChange,
  defaultTitle,
  notice,
  disabled,
  isDefault,
  onSetDefault,
}: {
  documentType: PrintDocumentType;
  name: string;
  onNameChange: (name: string) => void;
  paper: PrintPaperInfo;
  config: PrintTemplateConfig;
  onConfigChange: (config: PrintTemplateConfig) => void;
  defaultTitle: string;
  /** Khối khuyến cáo mặc định của chứng từ; `null` = chứng từ không có khối này (không hiện mục cấu hình). */
  notice: { title: string; defaultText: string } | null;
  disabled: boolean;
  /** Bản mẫu này đang là khổ in mặc định của chứng từ. */
  isDefault: boolean;
  /** Đặt bản này làm khổ in mặc định; `null` = chưa đặt được (bản dựng sẵn chưa lưu, hoặc còn thay đổi chưa lưu). */
  onSetDefault: (() => void) | null;
}) {
  // Công tắc "Tên chi nhánh" chỉ có nghĩa khi công ty có từ 2 chi nhánh — công ty 1 chi nhánh: giao diện không đổi (docs/DECISIONS.md #233).
  const user = useAuthStore((s) => s.user);
  const headerToggles = showBranchInfo(user) ? HEADER_TOGGLES : HEADER_TOGGLES.filter((t) => t.key !== 'showBranchName');
  const currentNotice = config.notice ?? (notice ? { show: true, title: notice.title, text: notice.defaultText } : undefined);
  const setNotice = (patch: Partial<NonNullable<PrintTemplateConfig['notice']>>) => {
    if (currentNotice) onConfigChange({ ...config, notice: { ...currentNotice, ...patch } });
  };
  const isLabel = paper.paperSize === 'LABEL_35X22' || paper.paperSize === 'LABEL_50X30' || paper.paperSize === 'LABEL_70X40' || paper.paperSize === 'LABEL_60X40';
  const labelOptions = config.label ?? DEFAULT_LABEL_OPTIONS;
  const setLabelOption = (key: LabelKey, value: boolean) => onConfigChange({ ...config, label: { ...labelOptions, [key]: value } });
  const medicineLabelOptions = config.medicineLabel ?? DEFAULT_MEDICINE_LABEL_OPTIONS;
  const setMedicineLabelOption = (key: keyof MedicineLabelConfig, value: boolean) => onConfigChange({ ...config, medicineLabel: { ...medicineLabelOptions, [key]: value } });
  // Khối "Thông tin trên đơn" chỉ của chứng từ Đơn thuốc; cấu hình chưa có khối (vd. sau "Khôi phục mặc định") coi như bật hết, ghi đủ khối khi người dùng đổi một công tắc.
  const rxInfo = documentType === 'PRESCRIPTION' ? (config.prescriptionInfo ?? ALL_ON_PRESCRIPTION_INFO) : undefined;
  const setRxInfo = (patch: Partial<PrescriptionInfoConfig>) => {
    if (rxInfo) onConfigChange({ ...config, prescriptionInfo: { ...rxInfo, ...patch } });
  };
  // Dòng "Số thẻ BHYT" (S2-04): chỉ đơn thuốc/phiếu thu/bệnh án PDF; khoá khi công tắc tổng "Áp dụng BHYT" tắt (chưa tải xong coi như tắt).
  const insuranceEnabled = useInsuranceEnabledQuery().data?.enabled === true;
  const hasInsuranceRow = INSURANCE_PRINT_DOCUMENT_TYPES.includes(documentType as (typeof INSURANCE_PRINT_DOCUMENT_TYPES)[number]);
  const insurancePrint = config.insurance ?? DEFAULT_INSURANCE_PRINT;
  const setInsurancePrint = (value: NonNullable<PrintTemplateConfig['insurance']>) => onConfigChange({ ...config, insurance: value });
  // Khối "Bộ hồ sơ khi in một lượt khám" (#272): chỉ bản mẫu Bệnh án; cấu hình chưa có khối (vd. sau "Khôi phục mặc định") coi như kèm hết, ghi đủ khối khi người dùng đổi một ô.
  const hasRecordBundle = RECORD_BUNDLE_DOCUMENT_TYPES.includes(documentType);
  const recordBundle = config.recordBundle ?? DEFAULT_RECORD_BUNDLE;
  const setRecordBundle = (patch: Partial<typeof recordBundle>) => onConfigChange({ ...config, recordBundle: { ...recordBundle, ...patch } });
  const setHeader = (key: HeaderKey, value: boolean) => onConfigChange({ ...config, header: { ...config.header, [key]: value } });
  const setMargin = (key: MarginKey, value: number) => onConfigChange({ ...config, margins: { ...config.margins, [key]: value } });
  const setCopyCount = (count: number) => onConfigChange({ ...config, copies: { ...config.copies, count } });
  const setCopyLabel = (index: number, value: string) => {
    const labels = [...config.copies.labels];
    while (labels.length <= index) labels.push('');
    labels[index] = value;
    onConfigChange({ ...config, copies: { ...config.copies, labels } });
  };

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3 border-0 p-0">
      <div>
        <label htmlFor="pt-name" className="mb-1 block text-sm font-semibold text-slate-800">
          Tên bản mẫu
        </label>
        <input id="pt-name" value={name} onChange={(e) => onNameChange(e.target.value)} maxLength={100} className={inputClassName} />
      </div>

      <Block title="Khổ giấy & lề">
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-slate-900">{paper.label}</span> <span className="font-mono text-xs text-slate-500">· {paper.description}</span>
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          {isDefault ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <CheckIcon size={13} weight="bold" aria-hidden="true" />
              Khổ in mặc định — bấm In sẽ in theo khổ này
            </span>
          ) : (
            <>
              <span className="text-xs text-slate-500">Chưa phải khổ in mặc định.</span>
              <Button type="button" variant="secondary" className="h-8 flex-shrink-0 px-2.5 text-xs" onClick={onSetDefault ?? undefined} disabled={!onSetDefault}>
                Đặt làm khổ in mặc định
              </Button>
            </>
          )}
        </div>
        {!isDefault && !onSetDefault && <p className="mt-1 text-[11px] text-slate-400">Lưu thay đổi trước khi đặt làm mặc định.</p>}
        <p className="mt-1 text-[11px] text-slate-400">Cần khổ giấy chưa có? Bấm &quot;Thêm bản mẫu&quot; ở trên, tick &quot;Đặt làm bản mặc định&quot; nếu muốn in theo khổ đó.</p>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {MARGIN_FIELDS.map((f) => (
            <MarginInput key={f.key} id={`pt-margin-${f.key}`} label={f.label} value={config.margins[f.key]} onCommit={(v) => setMargin(f.key, v)} />
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Đơn vị: milimét</p>
      </Block>

      {isLabel && documentType === 'MEDICINE_LABEL' && (
        <Block title="Nội dung nhãn">
          {MEDICINE_LABEL_ALWAYS.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 border-b border-slate-100 py-2">
              <Check id={`pt-medlabel-always-${row.label}`} label={row.label} checked onChange={() => undefined} disabled />
              <span className="flex-shrink-0 text-[11px] text-slate-500">Luôn in</span>
            </div>
          ))}
          {MEDICINE_LABEL_TOGGLES.map((t) => (
            <div key={t.key} className="border-b border-slate-100 py-2 last:border-b-0">
              <Check id={`pt-medlabel-${t.key}`} label={t.label} checked={medicineLabelOptions[t.key]} onChange={(v) => setMedicineLabelOption(t.key, v)} />
              <p className="ml-6 mt-0.5 text-[11px] leading-snug text-slate-500">{t.hint}</p>
            </div>
          ))}
          <p className="mt-2 text-[11px] text-slate-400">Số lượng trên nhãn là số thực phát. Các trường tuỳ chọn dùng chung cho mọi khổ tem của nhãn thuốc.</p>
        </Block>
      )}

      {isLabel && documentType === 'SPECIMEN_LABEL' && (
        <Block title={`Thông tin in thêm trên khổ ${paper.label}`}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {LABEL_TOGGLES.map((t) => (
              <Check key={t.key} id={`pt-label-${t.key}`} label={t.label} checked={labelOptions[t.key]} onChange={(v) => setLabelOption(t.key, v)} />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Mã vạch, mã ống, họ tên (IN HOA), năm sinh và giới tính luôn in, không tắt được. Mỗi khổ tem có bộ tuỳ chọn riêng.</p>
        </Block>
      )}

      {!isLabel && (
        <>
      <Block title="Đầu trang & tiêu đề">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {headerToggles.map((t) => (
            <Check key={t.key} id={`pt-header-${t.key}`} label={t.label} checked={config.header[t.key]} onChange={(v) => setHeader(t.key, v)} />
          ))}
        </div>
        <label htmlFor="pt-title" className="mb-1 mt-3 block text-sm font-semibold text-slate-800">
          Tiêu đề chứng từ
        </label>
        <input
          id="pt-title"
          value={config.title.text}
          onChange={(e) => onConfigChange({ ...config, title: { text: e.target.value } })}
          maxLength={60}
          placeholder={defaultTitle ? `Mặc định: ${defaultTitle}` : 'Mặc định theo loại phiếu (Phiếu thu / Phiếu chi)'}
          className={inputClassName}
        />
      </Block>

      {rxInfo && (
        <>
          <Block title="Thông tin bệnh nhân — mọi loại đơn">
            {RX_PATIENT_TOGGLES.map((toggle) => (
              <div key={toggle.key}>
                <RxToggleRow toggle={toggle} checked={rxInfo[toggle.key]} onChange={(v) => setRxInfo({ [toggle.key]: v })} />
                {toggle.key === 'showNationalId' && rxInfo.showNationalId && (
                  <div className="mb-2 ml-6 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
                    <label htmlFor="pt-rx-nationalIdWhenMissing">Khi bệnh nhân chưa có CCCD (vd. trẻ em):</label>
                    <select
                      id="pt-rx-nationalIdWhenMissing"
                      value={rxInfo.nationalIdWhenMissing}
                      onChange={(e) => setRxInfo({ nationalIdWhenMissing: e.target.value === 'dots' ? 'dots' : 'hide' })}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-normal text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      <option value="hide">Ẩn cả dòng</option>
                      <option value="dots">In dòng chấm để viết tay</option>
                    </select>
                  </div>
                )}
                {toggle.key === 'showNationalId' && hasInsuranceRow && (
                  <div className="border-b border-slate-100 py-2">
                    <InsurancePrintRow idPrefix="pt-insurance" value={insurancePrint} onChange={setInsurancePrint} enabled={insuranceEnabled} />
                  </div>
                )}
              </div>
            ))}
          </Block>

          <Block title="Mục riêng của đơn “N” và “H”">
            {RX_CONTROLLED_TOGGLES.map((toggle) => (
              <RxToggleRow key={toggle.key} toggle={toggle} checked={rxInfo[toggle.key]} onChange={(v) => setRxInfo({ [toggle.key]: v })} />
            ))}
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              <span className="font-semibold text-slate-700">Số bản:</span> đơn “N” và “H” theo quy định in 03 bản. Mục “Số liên” ở phần Cuối trang vẫn do phòng khám chọn; không tự đổi.
            </p>
          </Block>
          <Block title="Số lượng thuốc">
            <RxToggleRow toggle={RX_QUANTITY_TOGGLE} checked={rxInfo.padSmallQuantity} onChange={(v) => setRxInfo({ padSmallQuantity: v })} />
          </Block>
          <p className="px-1 text-[11px] leading-snug text-slate-400">Tiêu đề đơn “N” và “H” được cố định theo mẫu, bản mẫu in không đổi được.</p>
        </>
      )}

      {hasInsuranceRow && !rxInfo && (
        <Block title="Thông tin bảo hiểm y tế">
          <InsurancePrintRow idPrefix="pt-insurance" value={insurancePrint} onChange={setInsurancePrint} enabled={insuranceEnabled} />
        </Block>
      )}

      {hasRecordBundle && (
        <Block title="Bộ hồ sơ khi in một lượt khám">
          <div className="flex flex-col">
            <BundleRow label="Tờ bệnh án ngoại trú" hint="Theo mẫu MS 15/BV-01" />
            <BundleRow label="Tổng kết bệnh án" />
            <BundleRow id="pt-bundle-cls" label="Phiếu kết quả cận lâm sàng" hint="Mỗi dịch vụ đã duyệt một phiếu" checked={recordBundle.includeParaclinical} onChange={(v) => setRecordBundle({ includeParaclinical: v })} />
            <BundleRow id="pt-bundle-rx" label="Đơn thuốc" hint="Các đơn đã ký của lượt khám" checked={recordBundle.includePrescriptions} onChange={(v) => setRecordBundle({ includePrescriptions: v })} />
          </div>
          <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hộp "In bộ hồ sơ" sẽ ghi</p>
            <p className="mt-0.5 text-sm text-slate-800">Bộ hồ sơ gồm: {recordBundleSummary({ paraclinical: 1, prescriptions: 1 }, recordBundle)}.</p>
          </div>
        </Block>
      )}

      {notice && currentNotice && (
        <Block title="Khuyến cáo (in sau bảng kết quả)">
          <Check id="pt-notice-show" label="In khối khuyến cáo" checked={currentNotice.show} onChange={(v) => setNotice({ show: v })} />
          {currentNotice.show && (
            <div className="mt-3 flex flex-col gap-3">
              <div>
                <label htmlFor="pt-notice-title" className="mb-1 block text-sm font-semibold text-slate-800">
                  Tiêu đề khối
                </label>
                <input id="pt-notice-title" value={currentNotice.title} onChange={(e) => setNotice({ title: e.target.value })} maxLength={60} className={inputClassName} />
              </div>
              <Textarea
                id="pt-notice-text"
                label="Nội dung (mỗi dòng là một ý)"
                dense
                rows={6}
                maxLength={1000}
                value={currentNotice.text}
                onChange={(e) => setNotice({ text: e.target.value })}
              />
              <div>
                <Button type="button" variant="secondary" className="h-8 px-2.5 text-xs" onClick={() => setNotice({ title: notice.title, text: notice.defaultText })}>
                  Khôi phục nội dung mặc định
                </Button>
              </div>
            </div>
          )}
        </Block>
      )}

      <Block title="Cuối trang & chữ ký">
        <label htmlFor="pt-note" className="mb-1 block text-sm font-semibold text-slate-800">
          Dòng ghi chú
        </label>
        <input
          id="pt-note"
          value={config.footer.note}
          onChange={(e) => onConfigChange({ ...config, footer: { ...config.footer, note: e.target.value } })}
          maxLength={200}
          placeholder="Ví dụ: Tái khám theo lịch hẹn"
          className={inputClassName}
        />
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          <Check id="pt-sign" label="Ô chữ ký" checked={config.footer.showSignature} onChange={(v) => onConfigChange({ ...config, footer: { ...config.footer, showSignature: v } })} />
          <Check
            id="pt-sign-hint"
            label={'"(Ký, ghi rõ họ tên)"'}
            checked={config.footer.showSignatureHint}
            onChange={(v) => onConfigChange({ ...config, footer: { ...config.footer, showSignatureHint: v } })}
          />
        </div>

        <div className="mt-3">
          <span id="pt-copies-label" className="mb-1.5 block text-sm font-semibold text-slate-800">
            Số liên in mỗi lần
          </span>
          <div role="radiogroup" aria-labelledby="pt-copies-label" className="grid grid-cols-3 gap-1.5">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={config.copies.count === n}
                onClick={() => setCopyCount(n)}
                className={`h-8 whitespace-nowrap rounded-md border px-2 text-sm font-semibold ${
                  config.copies.count === n ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 text-slate-600 hover:border-blue-400 hover:bg-brand-teal-tint'
                }`}
              >
                {n} liên
              </button>
            ))}
          </div>
        </div>
        {config.copies.count > 1 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {Array.from({ length: config.copies.count }, (_, i) => (
              <input
                key={i}
                aria-label={`Nhãn liên ${i + 1}`}
                value={config.copies.labels[i] ?? ''}
                onChange={(e) => setCopyLabel(i, e.target.value)}
                maxLength={40}
                placeholder={`Nhãn liên ${i + 1}`}
                className={inputClassName}
              />
            ))}
          </div>
        )}
      </Block>
        </>
      )}
    </fieldset>
  );
}
