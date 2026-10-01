import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildAbbreviationLookup,
  CLINIC_CONFIG_READER_PORT,
  rankIcd10Candidates,
  splitDiagnosisPhrases,
  stripVietnameseDiacritics,
  type ClinicConfigReaderPort,
  type Icd10SuggestionCandidate,
} from '@nexamed/core';
import type { DataScope, DiagnosisSuggestionRequest, DiagnosisSuggestionResponse, LearnedDiagnosisPair } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { EncounterRepository } from './encounter.repository';
import { Icd10SuggestionRepository } from './icd10-suggestion.repository';

/**
 * "Gợi ý mã ICD-10 từ ô Chẩn đoán" (docs/DECISIONS.md). Chỉ ĐỀ XUẤT mã có trong danh mục BYT
 * (`icd10_catalog`) — không bao giờ tự gán vào chẩn đoán, bác sĩ phải bấm chọn từng mã ở màn khám.
 * Phần thuần (tách cụm/viết tắt/xếp hạng) ở `packages/core/src/icd10/suggest/`; class này chỉ nối
 * dữ liệu (ứng viên, lịch sử dùng mã, cụm từ đã học) rồi gọi các hàm thuần đó.
 */
@Injectable()
export class DiagnosisSuggestionService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly encounterRepository: EncounterRepository,
    private readonly suggestionRepository: Icd10SuggestionRepository,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  /**
   * `groups` rỗng (không lỗi) khi: tenant chưa bật tính năng, ô Chẩn đoán trống, hoặc lượt khám không ở
   * `IN_CONSULTATION` (đang khám — chọn mã ở màn khám) / `COMPLETED` (đã ký — chọn mã trong dialog
   * "Đính chính chẩn đoán", #206); đã huỷ/chưa khám thì không gợi ý. 404 nếu không có lượt khám hoặc
   * ngoài phạm vi `personal` của bác sĩ (cùng triết lý các endpoint khác).
   */
  async suggest(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    encounterId: string,
    dto: DiagnosisSuggestionRequest,
  ): Promise<DiagnosisSuggestionResponse> {
    // Đọc cấu hình TRƯỚC khi mở transaction — `ClinicConfigReaderPort` tự mở transaction riêng, không lồng được.
    const [enabled, learningSetting] = await Promise.all([
      this.clinicConfigReader.getIcd10SuggestionEnabled(tenantId),
      this.clinicConfigReader.getIcd10SuggestionLearningEnabled(tenantId),
    ]);
    // "Học từ lịch sử chọn mã" chỉ có nghĩa khi bản thân gợi ý đang bật.
    const learningEnabled = enabled && learningSetting;

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const encounter = await this.encounterRepository.findByIdWithConsultationContext(tx, tenantId, encounterId);
      if (!encounter || (dataScope === 'personal' && encounter.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      if (!enabled || (encounter.status !== 'IN_CONSULTATION' && encounter.status !== 'COMPLETED')) {
        return { groups: [] };
      }
      const lookupAbbreviation = buildAbbreviationLookup(await this.suggestionRepository.listActiveAbbreviations(tx));
      const phrases = splitDiagnosisPhrases(dto.text, lookupAbbreviation);
      if (phrases.length === 0) {
        return { groups: [] };
      }
      const patientGender = encounter.patient.gender;

      const phraseUsage = learningEnabled
        ? await this.suggestionRepository.findPhraseUsage(tx, tenantId, actorId, phrases.map((p) => p.phraseKey))
        : {};

      // Ứng viên cho từng cụm (khớp tên) + mã đã học của cụm đó (dù tên mã không khớp từ khoá).
      const candidatesByPhrase: Icd10SuggestionCandidate[][] = [];
      for (const phrase of phrases) {
        const [matched, learned] = await Promise.all([
          this.suggestionRepository.findCandidates(tx, phrase.tokens.map(stripVietnameseDiacritics), patientGender),
          this.suggestionRepository.findByCodes(tx, Object.keys(phraseUsage[phrase.phraseKey] ?? {}), patientGender),
        ]);
        const merged = new Map<string, Icd10SuggestionCandidate>();
        for (const candidate of [...matched, ...learned]) {
          merged.set(candidate.code, candidate);
        }
        candidatesByPhrase.push([...merged.values()]);
      }

      const allCodes = [...new Set(candidatesByPhrase.flat().map((c) => c.code))];
      const doctorCodeUsage = await this.suggestionRepository.countDoctorUsage(tx, tenantId, actorId, allCodes);

      return {
        groups: phrases.map((phrase, index) => {
          const ranked = rankIcd10Candidates(phrase.tokens, candidatesByPhrase[index] ?? [], {
            patientGender,
            doctorCodeUsage,
            phraseCodeUsage: phraseUsage[phrase.phraseKey],
          });
          return {
            phrase: phrase.raw,
            phraseKey: phrase.phraseKey,
            expandedText: phrase.expandedText,
            followUp: phrase.followUp,
            items: ranked.map((r) => ({
              icd10Code: r.candidate.code,
              icd10Name: r.candidate.nameVi,
              reason: r.reason,
              usageCount: r.usageCount,
            })),
          };
        }),
      };
    });
  }

  /**
   * Ghi "học cụm từ → mã" lúc "Hoàn tất khám" — gọi TRONG transaction của `completeConsultation()`,
   * và lúc lưu "Đính chính chẩn đoán" (`amendDiagnoses()`, #206 — đính chính xảy ra SAU hoàn tất nên
   * không còn bước "Hoàn tất khám" để gửi kèm).
   * Chỉ ghi cặp mà mã VẪN nằm trong chẩn đoán cuối cùng của lượt khám (bác sĩ bấm gợi ý rồi gỡ mã đi
   * thì không tính), khử trùng lặp. `learningEnabled` do caller đọc trước khi mở transaction.
   */
  async recordLearnedPairs(
    tx: Prisma.TransactionClient,
    tenantId: string,
    doctorId: string,
    finalCodes: readonly string[],
    pairs: readonly LearnedDiagnosisPair[] | undefined,
  ): Promise<void> {
    if (!pairs || pairs.length === 0) {
      return;
    }
    const finalSet = new Set(finalCodes);
    const unique = new Map<string, LearnedDiagnosisPair>();
    for (const pair of pairs) {
      if (finalSet.has(pair.icd10Code)) {
        unique.set(`${pair.phraseKey}|${pair.icd10Code}`, pair);
      }
    }
    await this.suggestionRepository.recordUsage(tx, tenantId, doctorId, [...unique.values()]);
  }
}
