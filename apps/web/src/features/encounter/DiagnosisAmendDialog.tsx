import { useRef, useState } from 'react';
import { PencilSimple, X } from '@phosphor-icons/react';
import type { DiagnosisSuggestionGroup, DiagnosisSuggestionItem, DiagnosisType, LearnedDiagnosisPair } from '@nexamed/shared';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { Button } from '../../shared/ui/Button';
import { Icd10SearchPicker, type Icd10SearchPickerHandle } from '../../shared/ui/Icd10SearchPicker';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Textarea } from '../../shared/ui/Textarea';
import { useIcd10SuggestionEnabledQuery } from '../clinic/clinic.queries';
import { DIAGNOSIS_TYPE_LABEL } from './clinical-display';
import { DiagnosisSuggestionPanel, type DiagnosisSuggestionPanelHandle } from './DiagnosisSuggestionPanel';
import { useDiagnosisSuggestionsQuery } from './encounter.queries';

export interface DiagnosisAmendItem {
  icd10Code: string;
  icd10Name: string;
  type: DiagnosisType;
  note?: string;
}

const TEXT_INPUT_ID = 'diagnosis-amend-text';
/** Khớp `learnedPairs.max(20)` của `amendDiagnosesRequestSchema`. */
const MAX_LEARNED_PAIRS = 20;

/**
 * Dialog "Đính chính chẩn đoán" (Sprint 5, S5-02/03) — tạo bản chẩn đoán mới thay bản đã ký, bắt buộc lý
 * do. Tách khỏi `EncounterConsultationPage.tsx` khi thêm "Gợi ý mã ICD-10" (docs/DECISIONS.md #206): khi
 * phòng khám bật gợi ý, bác sĩ gõ lại nội dung bệnh vào ô "Chẩn đoán" riêng (CHỈ để tìm mã — không lưu
 * vào bệnh án, muốn sửa chữ chẩn đoán thì dùng "Đính chính ghi chú khám") rồi bấm từng mã gợi ý; không
 * bao giờ tự gán. Các cặp "cụm từ ↔ mã" đã bấm gửi kèm lúc lưu để server học (nếu bật "Học từ lịch sử").
 *
 * Mount có điều kiện (chỉ khi mở) — state khởi tạo từ `initialItems` mỗi lần mở, không cần reset tay.
 * Việc gọi API + xử lý lỗi/đóng dialog thuộc về trang cha qua `onSubmit`.
 */
export function DiagnosisAmendDialog({
  encounterId,
  initialItems,
  submitting,
  onSubmit,
  onClose,
}: {
  encounterId: string;
  initialItems: DiagnosisAmendItem[];
  submitting: boolean;
  onSubmit: (payload: { items: DiagnosisAmendItem[]; reason: string; learnedPairs: LearnedDiagnosisPair[] }) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<DiagnosisAmendItem[]>(initialItems);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const learnedPairsRef = useRef<Map<string, LearnedDiagnosisPair>>(new Map());
  const suggestionPanelRef = useRef<DiagnosisSuggestionPanelHandle>(null);
  const pickerRef = useRef<Icd10SearchPickerHandle>(null);

  const suggestionEnabledQuery = useIcd10SuggestionEnabledQuery();
  const suggestionEnabled = suggestionEnabledQuery.data?.enabled ?? false;
  const debouncedText = useDebouncedValue(text, 600).trim();
  const suggestionsActive = suggestionEnabled && debouncedText !== '';
  const suggestionsQuery = useDiagnosisSuggestionsQuery(encounterId, debouncedText, suggestionsActive);
  const suggestionGroups: DiagnosisSuggestionGroup[] = suggestionsActive && !suggestionsQuery.isError ? (suggestionsQuery.data?.groups ?? []) : [];

  const isInvalid = reason.trim() === '' || items.length === 0;

  function addItem(item: { icd10Code: string; icd10Name: string }) {
    setItems((prev) => [...prev, { icd10Code: item.icd10Code, icd10Name: item.icd10Name, type: prev.length === 0 ? 'PRIMARY' : 'SECONDARY' }]);
  }

  function addSuggestion(item: DiagnosisSuggestionItem, group: DiagnosisSuggestionGroup) {
    learnedPairsRef.current.set(`${group.phraseKey}|${item.icd10Code}`, { phraseKey: group.phraseKey, icd10Code: item.icd10Code });
    addItem({ icd10Code: item.icd10Code, icd10Name: item.icd10Name });
  }

  function setPrimary(code: string) {
    setItems((prev) => prev.map((d) => ({ ...d, type: d.icd10Code === code ? 'PRIMARY' : 'SECONDARY' })));
  }

  function removeItem(code: string) {
    setItems((prev) => {
      const removed = prev.find((d) => d.icd10Code === code);
      const remaining = prev.filter((d) => d.icd10Code !== code);
      if (removed?.type === 'PRIMARY' && remaining.length > 0 && !remaining.some((d) => d.type === 'PRIMARY')) {
        remaining[0] = { ...remaining[0]!, type: 'PRIMARY' };
      }
      return remaining;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid || submitting) return;
    // Chỉ gửi cặp có mã VẪN còn trong danh sách cuối (server cũng lọc lại, đây chỉ để payload gọn).
    const finalCodes = new Set(items.map((d) => d.icd10Code));
    const learnedPairs = [...learnedPairsRef.current.values()].filter((p) => finalCodes.has(p.icd10Code)).slice(0, MAX_LEARNED_PAIRS);
    onSubmit({ items, reason: reason.trim(), learnedPairs });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader
          icon={PencilSimple}
          title="Đính chính chẩn đoán"
          subtitle="Bản cũ vẫn lưu trong lịch sử, không mất"
          onClose={onClose}
        />

        <div className="scroll-hover min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            {items.length === 0 && <p className="text-xs text-slate-500">Chưa chọn chẩn đoán nào.</p>}
            {items.map((d) => (
              <div
                key={d.icd10Code}
                className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                  d.type === 'PRIMARY' ? 'border-l-4 border-l-blue-600 border-y-slate-200 border-r-slate-200 bg-blue-50' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="min-w-0 text-sm text-slate-900">
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${d.type === 'PRIMARY' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>
                    {DIAGNOSIS_TYPE_LABEL[d.type]}
                  </span>
                  <strong>{d.icd10Code}</strong> — {d.icd10Name}
                </div>
                <div className="flex flex-none items-center gap-2">
                  {d.type !== 'PRIMARY' && (
                    <Button type="button" variant="info" className="px-2.5 py-1 text-xs" onClick={() => setPrimary(d.icd10Code)}>
                      Đặt làm bệnh chính
                    </Button>
                  )}
                  <RowActionButton icon={X} tone="danger" label={`Bỏ chẩn đoán ${d.icd10Code}`} onClick={() => removeItem(d.icd10Code)} />
                </div>
              </div>
            ))}
          </div>

          {suggestionEnabled && (
            <div>
              <Textarea
                id={TEXT_INPUT_ID}
                label="Chẩn đoán (gõ để gợi ý mã ICD-10)"
                dense
                rows={2}
                value={text}
                placeholder="VD: THA, đái tháo đường type 2 — chỉ dùng để tìm mã, không lưu vào bệnh án"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Cùng 3 đường vào khối gợi ý bằng bàn phím như ô "Chẩn đoán" ở màn khám: Alt+↓, Ctrl+↓, hoặc ↓ khi con trỏ ở CUỐI ô.
                  if (e.key !== 'ArrowDown' && e.code !== 'ArrowDown') return;
                  const el = e.currentTarget;
                  const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
                  if ((e.altKey || e.ctrlKey || (atEnd && !e.shiftKey && !e.metaKey)) && suggestionPanelRef.current?.focusFirst()) {
                    e.preventDefault();
                  }
                }}
              />
            </div>
          )}

          {suggestionsActive && !suggestionsQuery.isError && (
            <DiagnosisSuggestionPanel
              ref={suggestionPanelRef}
              groups={suggestionGroups}
              isLoading={suggestionsQuery.isPending || debouncedText !== text.trim()}
              chosenCodes={items.map((d) => d.icd10Code)}
              onAdd={addSuggestion}
              onManualSearch={(searchText) => pickerRef.current?.search(searchText)}
              onRequestInputFocus={() => document.getElementById(TEXT_INPUT_ID)?.focus()}
            />
          )}

          {/* Enter trong ô tìm ICD-10 chỉ để lọc danh sách, KHÔNG được submit cả form (.claude/docs/ui-guidelines.md mục 4.4, ngoại lệ ô tìm lồng trong form). */}
          <div
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
            }}
          >
            <Icd10SearchPicker ref={pickerRef} excludeCodes={items.map((d) => d.icd10Code)} onSelect={addItem} />
          </div>

          <div>
            <Textarea
              id="diagnosis-amend-reason"
              label="Lý do đính chính"
              required
              dense
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting} disabled={isInvalid}>
            Lưu bản đính chính
          </Button>
        </div>
      </form>
    </div>
  );
}
