import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import type { Browser } from 'puppeteer-core';
import type { PdfRendererPort } from '@nexamed/core';
import type { Env } from '../../config/env.schema';

/** Ứng viên đường dẫn Chromium/Chrome hệ thống khi `CHROMIUM_EXECUTABLE_PATH` không đặt — đúng vị
 * trí `apt-get install chromium` cài trên Debian bookworm (`apps/api/Dockerfile`, S6-06). Thứ tự
 * ưu tiên: Chromium trước (nhẹ hơn, cài trong image), rồi các bí danh/Chrome khác có thể có sẵn
 * trên máy dev Linux/macOS. Máy dev Windows BẮT BUỘC đặt `CHROMIUM_EXECUTABLE_PATH` tường minh
 * (không nằm trong danh sách này). */
const FALLBACK_EXECUTABLE_PATHS = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];

/** Hạn chờ Chromium khởi động (puppeteer mặc định 30 giây là quá ngắn khi máy bận). */
export const BROWSER_LAUNCH_TIMEOUT_MS = 120_000;

/**
 * Adapter thật của `PdfRendererPort` (S6-06, ADM-05) — dùng `puppeteer-core` (không tự tải
 * Chromium bundled, tránh phụ thuộc mạng lúc `pnpm install` — xem docs/DECISIONS.md) trỏ tới
 * Chromium hệ thống. Giữ MỘT trình duyệt sống suốt vòng đời tiến trình API (khởi động Chromium mất
 * ~1 giây, không launch mới mỗi request) — mở 1 tab mới mỗi lần render, đóng lại ngay sau khi lấy
 * xong buffer PDF.
 */
@Injectable()
export class PuppeteerPdfRendererAdapter implements PdfRendererPort, OnModuleDestroy {
  private readonly logger = new Logger(PuppeteerPdfRendererAdapter.name);
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly configService: ConfigService<Env, true>) {}

  async renderHtmlToPdf(html: string, options?: { marginsMm?: { top: number; right: number; bottom: number; left: number } }): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // HTML tự chứa toàn bộ CSS (không tải resource ngoài) — `load` là đủ, `setContent()` không hỗ
      // trợ `networkidle0`/`networkidle2` (khác `page.goto()`).
      await page.setContent(html, { waitUntil: 'load' });
      const m = options?.marginsMm ?? { top: 10, right: 10, bottom: 10, left: 10 };
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: `${m.top}mm`, bottom: `${m.bottom}mm`, left: `${m.left}mm`, right: `${m.right}mm` } });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise.catch(() => null);
    await browser?.close();
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      const attempt = this.launchBrowser();
      this.browserPromise = attempt;
      // Lần khởi động thất bại KHÔNG được nhớ lại: nếu không, một lần Chromium khởi động chậm/lỗi sẽ làm hỏng mọi lần xuất PDF
      // sau đó cho tới khi khởi động lại API. Quên lời hứa lỗi để lần sau thử khởi động lại.
      attempt.catch(() => {
        if (this.browserPromise === attempt) this.browserPromise = null;
      });
    }
    return this.browserPromise;
  }

  private async launchBrowser(): Promise<Browser> {
    const { launch } = await import('puppeteer-core');
    const executablePath = this.resolveExecutablePath();
    this.logger.log(`Khởi động Chromium cho xuất PDF (${executablePath}).`);
    // `timeout` mặc định của puppeteer chỉ 30 giây — khởi động nguội trên máy chủ/CI đang bận đo được 10–30 giây+; hạn này
    // phải LỚN HƠN hạn làm nóng của test (120 giây) nếu không bước làm nóng vẫn chết ở 30 giây (CI đỏ 10/11/2026).
    return launch({ executablePath, headless: true, timeout: BROWSER_LAUNCH_TIMEOUT_MS, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  }

  /** Báo lỗi rõ ràng ngay lúc khởi động trình duyệt nếu không tìm thấy Chromium — không để lỗi mơ hồ
   * lúc render (đúng nguyên tắc "không nuốt lỗi thành PDF rỗng"). */
  private resolveExecutablePath(): string {
    const configured = this.configService.get('CHROMIUM_EXECUTABLE_PATH', { infer: true });
    if (configured) return configured;
    const found = FALLBACK_EXECUTABLE_PATHS.find((p) => existsSync(p));
    if (found) return found;
    throw new Error(
      'Không tìm thấy Chromium để xuất PDF. Đặt biến môi trường CHROMIUM_EXECUTABLE_PATH trỏ tới file thực thi Chrome/Chromium ' +
        `(đã thử: ${FALLBACK_EXECUTABLE_PATHS.join(', ')}).`,
    );
  }
}
