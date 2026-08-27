import { describe, expect, it } from 'vitest';
import type { EncounterStatus } from '@nexamed/shared';
import { ENCOUNTER_STATUSES } from '@nexamed/shared';
import { canTransitionEncounter, assertEncounterTransition } from './encounter-state-machine';
import { EncounterInvalidTransitionError } from '../errors/encounter-errors';

const VALID_EDGES: [EncounterStatus, EncounterStatus][] = [
  ['SCHEDULED', 'CHECKED_IN'],
  ['SCHEDULED', 'CANCELLED'],
  ['SCHEDULED', 'NO_SHOW'],
  ['CHECKED_IN', 'IN_CONSULTATION'],
  ['CHECKED_IN', 'CANCELLED'],
  ['IN_CONSULTATION', 'COMPLETED'],
  // #085 — khách bỏ về giữa chừng / bác sĩ trả ca về hàng chờ chung.
  ['IN_CONSULTATION', 'CANCELLED'],
  ['IN_CONSULTATION', 'CHECKED_IN'],
];

describe('canTransitionEncounter', () => {
  it('cho phép đúng 8 cạnh hợp lệ theo .claude/docs/clinical-workflow.md', () => {
    for (const [from, to] of VALID_EDGES) {
      expect(canTransitionEncounter(from, to)).toBe(true);
    }
  });

  it('chặn mọi cặp còn lại trong ma trận 6×6 (không nhảy cóc, không tự chuyển về chính mình)', () => {
    const validSet = new Set(VALID_EDGES.map(([from, to]) => `${from}->${to}`));
    let invalidCount = 0;
    for (const from of ENCOUNTER_STATUSES) {
      for (const to of ENCOUNTER_STATUSES) {
        const key = `${from}->${to}`;
        if (validSet.has(key)) continue;
        invalidCount += 1;
        expect(canTransitionEncounter(from, to)).toBe(false);
      }
    }
    // 6×6 = 36 cặp, 8 hợp lệ → 28 cặp phải bị chặn (bao gồm mọi trạng thái giữ nguyên, mọi cạnh
    // đi ra khỏi COMPLETED/CANCELLED/NO_SHOW).
    expect(invalidCount).toBe(28);
  });

  it('#085 — IN_CONSULTATION có đúng 3 đường ra, KHÔNG có đường về SCHEDULED/NO_SHOW', () => {
    expect(canTransitionEncounter('IN_CONSULTATION', 'COMPLETED')).toBe(true);
    expect(canTransitionEncounter('IN_CONSULTATION', 'CANCELLED')).toBe(true);
    expect(canTransitionEncounter('IN_CONSULTATION', 'CHECKED_IN')).toBe(true);
    expect(canTransitionEncounter('IN_CONSULTATION', 'SCHEDULED')).toBe(false);
    expect(canTransitionEncounter('IN_CONSULTATION', 'NO_SHOW')).toBe(false);
  });

  it('không có đường lùi từ trạng thái cuối (COMPLETED/CANCELLED/NO_SHOW)', () => {
    for (const terminal of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      for (const to of ENCOUNTER_STATUSES) {
        expect(canTransitionEncounter(terminal, to)).toBe(false);
      }
    }
  });
});

describe('assertEncounterTransition', () => {
  it('không ném lỗi với cạnh hợp lệ', () => {
    expect(() => assertEncounterTransition('CHECKED_IN', 'IN_CONSULTATION')).not.toThrow();
  });

  it('ném EncounterInvalidTransitionError với cạnh không hợp lệ, giữ nguyên from/to để debug', () => {
    try {
      assertEncounterTransition('CHECKED_IN', 'COMPLETED');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EncounterInvalidTransitionError);
      const typed = err as EncounterInvalidTransitionError;
      expect(typed.code).toBe('ENCOUNTER_INVALID_TRANSITION');
      expect(typed.from).toBe('CHECKED_IN');
      expect(typed.to).toBe('COMPLETED');
    }
  });
});
