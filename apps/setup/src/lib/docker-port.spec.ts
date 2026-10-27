import { describe, expect, it } from 'vitest';
import { FakeShell } from '../testing/fake-shell';
import { DockerClient } from './docker';

function client(shell: FakeShell) {
  return new DockerClient(shell, { workDir: '/work', hostInstallDir: '/c/NEXAMed', probeImage: 'nexamed-setup:0.9.0' }, async () => undefined);
}

describe('DockerClient.portFree (kiểm cổng web của máy)', () => {
  it('thăm dò bằng cổng GẮN KÈM IP (0.0.0.0:<cổng>:80), như docker-compose.yml mở cổng web — `-p <cổng>:80` trần không phát hiện cổng bị Apache/IIS giữ trên Docker Desktop (#261)', async () => {
    const shell = new FakeShell();
    await client(shell).portFree(8080);
    const run = shell.calls.find((c) => c.args[0] === 'run')!;
    const published = run.args[run.args.indexOf('-p') + 1];
    expect(published).toBe('0.0.0.0:8080:80');
  });

  it('Docker từ chối gắn cổng (mã thoát khác 0) → cổng bị chiếm; gắn được → còn trống', async () => {
    const busy = new FakeShell([() => ({ code: 125, stderr: 'ports are not available: exposing port TCP 0.0.0.0:8080 -> 127.0.0.1:0' })]);
    expect(await client(busy).portFree(8080)).toBe(false);
    expect(await client(new FakeShell()).portFree(8081)).toBe(true);
  });

  it('có thể chỉ định IP gắn khác (kiểu "chỉ trên máy này")', async () => {
    const shell = new FakeShell();
    await client(shell).portFree(8081, '127.0.0.1');
    const run = shell.calls.find((c) => c.args[0] === 'run')!;
    expect(run.args[run.args.indexOf('-p') + 1]).toBe('127.0.0.1:8081:80');
  });
});
