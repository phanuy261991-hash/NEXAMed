import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.schema';

const launchMock = vi.fn();
vi.mock('puppeteer-core', () => ({ launch: (...args: unknown[]) => launchMock(...args) }));

import { BROWSER_LAUNCH_TIMEOUT_MS, PuppeteerPdfRendererAdapter } from './puppeteer-pdf-renderer.adapter';

function makeAdapter() {
  const config = { get: () => 'chromium-gia' } as unknown as ConfigService<Env, true>;
  return new PuppeteerPdfRendererAdapter(config);
}

function fakeBrowser() {
  const page = { setContent: vi.fn(), pdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])), close: vi.fn() };
  return { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() };
}

describe('PuppeteerPdfRendererAdapter — khởi động Chromium', () => {
  beforeEach(() => launchMock.mockReset());

  it('truyền hạn khởi động dài hơn mặc định 30 giây của puppeteer', async () => {
    launchMock.mockResolvedValue(fakeBrowser());
    await makeAdapter().renderHtmlToPdf('<html></html>');
    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({ timeout: BROWSER_LAUNCH_TIMEOUT_MS }));
    expect(BROWSER_LAUNCH_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  it('một lần khởi động thất bại KHÔNG bị nhớ lại: lần xuất sau khởi động lại và thành công', async () => {
    launchMock.mockRejectedValueOnce(new Error('Timed out after 30000 ms while waiting for the WS endpoint URL')).mockResolvedValueOnce(fakeBrowser());
    const adapter = makeAdapter();
    await expect(adapter.renderHtmlToPdf('<html></html>')).rejects.toThrow(/WS endpoint/);
    const pdf = await adapter.renderHtmlToPdf('<html></html>');
    expect(pdf.length).toBe(3);
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('khởi động thành công thì dùng lại cùng một trình duyệt (không launch mỗi lần)', async () => {
    launchMock.mockResolvedValue(fakeBrowser());
    const adapter = makeAdapter();
    await adapter.renderHtmlToPdf('<html></html>');
    await adapter.renderHtmlToPdf('<html></html>');
    expect(launchMock).toHaveBeenCalledTimes(1);
  });
});
