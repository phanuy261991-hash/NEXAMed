import { useState } from 'react';
import { Check as CheckIcon } from '@phosphor-icons/react';
import type { PrintPaperInfo, PrintTemplateConfig } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { Textarea } from '../../shared/ui/Textarea';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

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
type MarginKey = keyof PrintTemplateConfig['margins'];

const HEADER_TOGGLES: { key: HeaderKey; label: string }[] = [
  { key: 'showLogo', label: 'Logo phòng khám' },
  { key: 'showClinicName', label: 'Tên phòng khám' },
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
      <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">{title}</h3>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-slate-700">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-blue-600" />
      {label}
    </label>
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
  const currentNotice = config.notice ?? (notice ? { show: true, title: notice.title, text: notice.defaultText } : undefined);
  const setNotice = (patch: Partial<NonNullable<PrintTemplateConfig['notice']>>) => {
    if (currentNotice) onConfigChange({ ...config, notice: { ...currentNotice, ...patch } });
  };
  const isLabel = paper.paperSize === 'LABEL_35X22' || paper.paperSize === 'LABEL_50X30';
  const labelOptions = config.label ?? DEFAULT_LABEL_OPTIONS;
  const setLabelOption = (key: LabelKey, value: boolean) => onConfigChange({ ...config, label: { ...labelOptions, [key]: value } });
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

      {isLabel && (
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
          {HEADER_TOGGLES.map((t) => (
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
