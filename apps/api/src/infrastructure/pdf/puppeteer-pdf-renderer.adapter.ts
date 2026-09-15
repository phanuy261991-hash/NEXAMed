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

  async renderHtmlToPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // HTML tự chứa toàn bộ CSS (không tải resource ngoài) — `load` là đủ, `setContent()` không hỗ
      // trợ `networkidle0`/`networkidle2` (khác `page.goto()`).
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
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
      this.browserPromise = this.launchBrowser();
    }
    return this.browserPromise;
  }

  private async launchBrowser(): Promise<Browser> {
    const { launch } = await import('puppeteer-core');
    const executablePath = this.resolveExecutablePath();
    this.logger.log(`Khởi động Chromium cho xuất PDF (${executablePath}).`);
    return launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
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
