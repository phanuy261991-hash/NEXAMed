import { describe, expect, it } from 'vitest';
import { evaluateBackupStatus } from './backup-status';
import type { BackupStatusSnapshot } from '../ports/backup-status.port';

const NOW = new Date('2026-09-15T08:00:00Z');

describe('evaluateBackupStatus', () => {
  it('chưa từng cấu hình/chưa có file trạng thái (snapshot null) — cần cảnh báo NEVER_RUN', () => {
    expect(evaluateBackupStatus(null, NOW)).toEqual({ needsAttention: true, reason: 'NEVER_RUN' });
  });

  it('có snapshot nhưng chưa từng thành công lần nào (lastSuccessAt null) — cần cảnh báo NEVER_RUN', () => {
    const snapshot: BackupStatusSnapshot = {
      lastRunAt: '2026-09-15T02:00:03+00:00',
      lastRunOk: false,
      lastSuccessAt: null,
      consecutiveFailures: 3,
      lastError: 'pg_dump: connection refused',
    };
    expect(evaluateBackupStatus(snapshot, NOW)).toEqual({ needsAttention: true, reason: 'NEVER_RUN' });
  });

  it('lần chạy gần nhất thất bại dù trước đó từng thành công — cần cảnh báo LAST_RUN_FAILED', () => {
    const snapshot: BackupStatusSnapshot = {
      lastRunAt: '2026-09-15T02:00:03+00:00',
      lastRunOk: false,
      lastSuccessAt: '2026-09-13T02:00:03+00:00',
      consecutiveFailures: 1,
      lastError: 'disk full',
    };
    expect(evaluateBackupStatus(snapshot, NOW)).toEqual({ needsAttention: true, reason: 'LAST_RUN_FAILED' });
  });

  it('thành công gần đây, trong ngưỡng — không cần cảnh báo', () => {
    const snapshot: BackupStatusSnapshot = {
      lastRunAt: '2026-09-15T02:00:03+00:00',
      lastRunOk: true,
      lastSuccessAt: '2026-09-15T02:00:03+00:00',
      consecutiveFailures: 0,
      lastError: null,
    };
    expect(evaluateBackupStatus(snapshot, NOW)).toEqual({ needsAttention: false, reason: null });
  });

  it('thành công lần cuối đã hơn 30 giờ (trễ hạn/im lặng) — cần cảnh báo STALE', () => {
    const snapshot: BackupStatusSnapshot = {
      lastRunAt: '2026-09-13T02:00:03+00:00',
      lastRunOk: true,
      lastSuccessAt: '2026-09-13T02:00:03+00:00',
      consecutiveFailures: 0,
      lastError: null,
    };
    expect(evaluateBackupStatus(snapshot, NOW)).toEqual({ needsAttention: true, reason: 'STALE' });
  });

  it('đúng biên ngưỡng tuỳ chỉnh — 29h59p trong ngưỡng 30h thì chưa cảnh báo, 30h01p thì cảnh báo', () => {
    const withinThreshold: BackupStatusSnapshot = {
      lastRunAt: '2026-09-14T02:00:59+00:00',
      lastRunOk: true,
      lastSuccessAt: '2026-09-14T02:00:59+00:00',
      consecutiveFailures: 0,
      lastError: null,
    };
    expect(evaluateBackupStatus(withinThreshold, NOW).needsAttention).toBe(false);

    const pastThreshold: BackupStatusSnapshot = {
      lastRunAt: '2026-09-14T01:58:59+00:00',
      lastRunOk: true,
      lastSuccessAt: '2026-09-14T01:58:59+00:00',
      consecutiveFailures: 0,
      lastError: null,
    };
    expect(evaluateBackupStatus(pastThreshold, NOW)).toEqual({ needsAttention: true, reason: 'STALE' });
  });

  it('ngưỡng tuỳ chỉnh (staleThresholdHours) được tôn trọng', () => {
    const snapshot: BackupStatusSnapshot = {
      lastRunAt: '2026-09-15T06:00:00Z',
      lastRunOk: true,
      lastSuccessAt: '2026-09-15T06:00:00Z',
      consecutiveFailures: 0,
      lastError: null,
    };
    // Cách NOW đúng 2 giờ — ngưỡng 1 giờ thì đã trễ hạn, ngưỡng 3 giờ thì chưa.
    expect(evaluateBackupStatus(snapshot, NOW, 1)).toEqual({ needsAttention: true, reason: 'STALE' });
    expect(evaluateBackupStatus(snapshot, NOW, 3)).toEqual({ needsAttention: false, reason: null });
  });
});
