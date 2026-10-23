/**
 * Máy chủ HTTP của trình cài đặt (Node thuần, không framework — docs/DECISIONS.md #238). Phục vụ giao diện tĩnh ở `public/` và API JSON `/api/*` cho SetupService.
 * Bảo vệ: mã `?key=` một lần (máy chủ không màn hình), kiểm tra tiêu đề Host (chống DNS rebinding), giới hạn kích thước thân yêu cầu.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { backupDirForCompose } from './lib/profiles';
import { assessPassword, validateBackupDir, validateDomain, validatePort } from './lib/validators';
import type { SetupService } from './service';

export interface ServerOptions {
  service: SetupService;
  publicDir: string;
  /** Mã bắt buộc kèm link (`?key=`); rỗng = không cần mã (cổng chỉ gắn 127.0.0.1). */
  key: string;
  /** Tên máy được phép trong tiêu đề Host ngoài localhost/IP số. */
  allowedHosts?: string[];
  onFinish: () => void;
}

const MAX_BODY = 512 * 1024;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function readCookie(req: IncomingMessage, name: string): string {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function hostAllowed(req: IncomingMessage, extra: string[]): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === '[::1]') return true;
  return extra.map((h) => h.toLowerCase()).includes(host);
}

/** Sau khi trả 413, vẫn rút cạn phần thân còn lại nhưng không quá chừng này (chặn thân vô tận). */
const DRAIN_LIMIT_MS = 10_000;

/**
 * Đọc thân JSON có giới hạn. KHÔNG dùng `for await (const chunk of req)` rồi ném lỗi giữa chừng: thoát vòng lặp sớm làm Node HUỶ luồng yêu cầu
 * và đóng kết nối TRƯỚC khi kịp gửi 413, nên máy khách (nhất là trên máy chậm) chờ mãi — lỗi chập chờn phát hiện ở CI GitHub 23/10/2026 (docs/DECISIONS.md #254).
 * Vượt giới hạn: báo 413 ngay nhưng vẫn rút cạn (bỏ) phần thân còn lại để phản hồi tới được máy khách, có hạn chót.
 */
function readBody(req: IncomingMessage): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    let drainTimer: NodeJS.Timeout | undefined;
    req.on('data', (chunk: Buffer) => {
      if (tooBig) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        tooBig = true;
        chunks.length = 0;
        drainTimer = setTimeout(() => req.destroy(), DRAIN_LIMIT_MS);
        reject(new HttpError(413, 'Dữ liệu gửi lên quá lớn.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (drainTimer) clearTimeout(drainTimer);
      if (!tooBig) resolve(chunks);
    });
    req.on('close', () => drainTimer && clearTimeout(drainTimer));
    req.on('error', (err) => reject(err));
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks = await readBody(req);
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // rơi xuống lỗi bên dưới
  }
  throw new HttpError(400, 'Dữ liệu gửi lên không đúng định dạng.');
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(text);
}

export function createSetupServer(options: ServerOptions): Server {
  const { service, publicDir, key } = options;

  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^([/\\])+/, '');
    if (rel.includes('..')) throw new HttpError(404, 'Không tìm thấy.');
    try {
      const data = await readFile(join(publicDir, rel));
      res.writeHead(200, {
        'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
      });
      res.end(data);
    } catch {
      throw new HttpError(404, 'Không tìm thấy.');
    }
  }

  async function api(req: IncomingMessage, res: ServerResponse, method: string, path: string, url: URL): Promise<void> {
    const route = `${method} ${path}`;
    const body = method === 'POST' ? await readJson(req) : {};
    switch (route) {
      case 'GET /api/state':
        return sendJson(res, 200, { data: { detect: await service.detect(), job: service.jobView() } });
      case 'GET /api/preflight': {
        const mode = url.searchParams.get('mode') === 'upgrade' ? 'upgrade' : 'install';
        return sendJson(res, 200, { data: await service.preflight(mode) });
      }
      case 'POST /api/check/port': {
        const port = validatePort(body.port as number);
        if (!port.ok) throw new HttpError(400, port.error);
        return sendJson(res, 200, { data: await service.checkPort(port.value) });
      }
      case 'POST /api/check/backup': {
        const dir = validateBackupDir(String(body.path ?? ''));
        if (!dir.ok) return sendJson(res, 200, { data: { id: 'backup', title: 'Thư mục sao lưu', detail: dir.error, status: 'bad', value: 'lỗi' } });
        return sendJson(res, 200, { data: await service.checkBackupDir(backupDirForCompose(dir.value)) });
      }
      case 'POST /api/check/dns': {
        const domain = validateDomain(String(body.domain ?? ''));
        if (!domain.ok) throw new HttpError(400, domain.error);
        return sendJson(res, 200, { data: await service.checkDns(domain.value) });
      }
      case 'POST /api/password':
        return sendJson(res, 200, { data: assessPassword(String(body.password ?? '')) });
      case 'POST /api/cert': {
        const domain = validateDomain(String(body.baseDomain ?? ''));
        if (!domain.ok) throw new HttpError(400, domain.error);
        return sendJson(res, 200, { data: service.checkCertificate(String(body.crt ?? ''), String(body.key ?? ''), domain.value) });
      }
      case 'POST /api/validate': {
        const checked = service.validate(body as never);
        return sendJson(res, 200, { data: checked.ok ? { ok: true } : { ok: false, errors: checked.errors } });
      }
      case 'POST /api/review': {
        const checked = service.validate(body as never);
        if (!checked.ok) return sendJson(res, 200, { data: { ok: false, errors: checked.errors } });
        return sendJson(res, 200, { data: { ok: true, ...service.review(checked.value) } });
      }
      case 'POST /api/install': {
        const started = service.startInstall(body as never);
        return sendJson(res, started.ok ? 200 : 422, started.ok ? { data: { ok: true } } : { error: { message: 'Câu trả lời chưa hợp lệ.', details: started.errors } });
      }
      case 'POST /api/upgrade': {
        const retry = body.retry === true ? service.startUpgrade() : await service.beginUpgrade();
        return sendJson(res, retry.ok ? 200 : 409, retry.ok ? { data: { ok: true } } : { error: { message: retry.error } });
      }
      case 'POST /api/rollback': {
        const started = await service.beginRollback();
        return sendJson(res, started.ok ? 200 : 409, started.ok ? { data: { ok: true } } : { error: { message: started.error } });
      }
      case 'GET /api/job':
        return sendJson(res, 200, { data: service.jobView() });
      case 'GET /api/otp': {
        // Trả null (không phải 404) khi không có bước OTP: giao diện hỏi mỗi lần tải lại trang, 404 sẽ hiện thành lỗi đỏ trong Console.
        return sendJson(res, 200, { data: service.otpView() });
      }
      case 'POST /api/otp/verify':
        return sendJson(res, 200, { data: { ok: service.verifyOtp(String(body.code ?? '')) } });
      case 'GET /api/result': {
        const result = service.takeResult();
        if (!result) throw new HttpError(404, 'Chưa có kết quả.');
        return sendJson(res, 200, { data: result });
      }
      case 'POST /api/ack':
        service.acknowledge();
        return sendJson(res, 200, { data: { ok: true } });
      case 'POST /api/finish':
        sendJson(res, 200, { data: { ok: true } });
        setTimeout(options.onFinish, 400);
        return;
      default:
        throw new HttpError(404, 'Không tìm thấy.');
    }
  }

  return createServer((req, res) => {
    void (async () => {
      try {
        if (!hostAllowed(req, options.allowedHosts ?? [])) throw new HttpError(400, 'Địa chỉ truy cập không được phép.');
        const url = new URL(req.url ?? '/', 'http://localhost');
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'POST') throw new HttpError(405, 'Phương thức không được hỗ trợ.');

        if (key) {
          const given = url.searchParams.get('key') ?? '';
          const cookie = readCookie(req, 'nexamed_setup_key');
          if (given && safeEqual(given, key)) {
            // Lần đầu mở link: ghi cookie rồi chuyển về địa chỉ sạch (không để mã nằm trên thanh địa chỉ).
            res.writeHead(302, { 'Set-Cookie': `nexamed_setup_key=${encodeURIComponent(key)}; Path=/; HttpOnly; SameSite=Strict`, Location: url.pathname, 'Cache-Control': 'no-store' });
            res.end();
            return;
          }
          if (!cookie || !safeEqual(cookie, key)) throw new HttpError(401, 'Cần mở đúng link có mã do lệnh cài đặt in ra.');
        }

        if (url.pathname.startsWith('/api/')) {
          if (method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Cần gửi JSON.');
          if (url.pathname === '/api/handoff.txt' && method === 'GET') {
            const text = service.handoff();
            if (!text) throw new HttpError(404, 'Không có file bàn giao.');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="NEXAMed-ban-giao.txt"', 'Cache-Control': 'no-store' });
            res.end('﻿' + text);
            return;
          }
          await api(req, res, method, url.pathname, url);
          return;
        }
        await serveStatic(req, res, url.pathname);
      } catch (err) {
        if (err instanceof HttpError) return sendJson(res, err.status, { error: { message: err.message } });
        sendJson(res, 500, { error: { message: 'Lỗi không xác định trong trình cài đặt.' } });
      }
    })();
  });
}
