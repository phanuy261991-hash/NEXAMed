import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { HttpEPrescriptionGatewayAdapter } from './http-e-prescription-gateway.adapter';

/**
 * Kiểm adapter gọi cổng Đơn thuốc quốc gia ĐÚNG TÀI LIỆU Quyết định 808/QĐ-BYT (`docs/product/references/qd-808-donthuocquocgia-api.md`): đường dẫn, phương thức POST, header
 * (`Content-Type: application/json`, `Authorization: bearer {token}`), TÊN TRƯỜNG của thân yêu cầu, và cách đọc phản hồi/lỗi (200 + token, 422 + danh_sach_cac_loi, 401...). Máy chủ
 * giả cục bộ ghi lại từng yêu cầu thật mà adapter gửi. CHƯA kiểm với cổng thật (chưa có môi trường thử).
 */
interface Captured {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  rawBody: string;
  body: Record<string, unknown> | undefined;
}

type Handler = (req: Captured, res: ServerResponse) => void | Promise<void>;

describe('HttpEPrescriptionGatewayAdapter — gọi cổng đúng tài liệu QĐ 808', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  const captured: Captured[] = [];
  const config = (mode: 'single' | 'saas') => ({ get: () => mode }) as unknown as ConfigService<Env, true>;
  const adapter = new HttpEPrescriptionGatewayAdapter(config('single'));
  const endpoint = () => ({ baseUrl, timeoutMs: 5000 });

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json;charset=UTF-8');
    res.end(JSON.stringify(body));
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let body: Record<string, unknown> | undefined;
        try {
          body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined;
        } catch {
          body = undefined;
        }
        const entry: Captured = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, rawBody, body };
        captured.push(entry);
        void Promise.resolve(handler(entry, res));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    captured.length = 0;
    vi.restoreAllMocks();
  });

  describe('III. Đăng nhập cơ sở khám chữa bệnh — POST /api/auth/dang-nhap-co-so-kham-chua-benh', () => {
    it('gửi đúng đường dẫn, POST, Content-Type JSON, thân CHỈ gồm ma_lien_thong_co_so_kham_chua_benh + password, không có Authorization', async () => {
      handler = (_req, res) => json(res, 200, { token: 'tok-co-so', token_type: 'bearer' });
      const result = await adapter.loginFacility(endpoint(), { facilityCode: 'CS-790010421', password: 'mat-khau-co-so' });
      expect(result).toEqual({ kind: 'ok', data: { token: 'tok-co-so' } });
      expect(captured).toHaveLength(1);
      const req = captured[0]!;
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/auth/dang-nhap-co-so-kham-chua-benh');
      expect(req.headers['content-type']).toMatch(/^application\/json/);
      expect(req.headers.authorization).toBeUndefined();
      expect(Object.keys(req.body!).sort()).toEqual(['ma_lien_thong_co_so_kham_chua_benh', 'password']);
      expect(req.body).toEqual({ ma_lien_thong_co_so_kham_chua_benh: 'CS-790010421', password: 'mat-khau-co-so' });
    });

    it('422 (mã liên thông hoặc mật khẩu không đúng) → rejected kèm danh_sach_cac_loi', async () => {
      handler = (_req, res) => json(res, 422, { danh_sach_cac_loi: ['Mã liên thông hoặc mật khẩu không đúng'] });
      expect(await adapter.loginFacility(endpoint(), { facilityCode: 'x', password: 'y' })).toEqual({ kind: 'rejected', status: 422, errors: ['Mã liên thông hoặc mật khẩu không đúng'] });
    });

    it('422 không có thân/không phải JSON → vẫn là rejected, errors rỗng', async () => {
      handler = (_req, res) => {
        res.statusCode = 422;
        res.end('lỗi thô không phải JSON');
      };
      expect(await adapter.loginFacility(endpoint(), { facilityCode: 'x', password: 'y' })).toEqual({ kind: 'rejected', status: 422, errors: [] });
    });
  });

  describe('VI. Đăng nhập bác sĩ — POST /api/auth/dang-nhap-bac-si', () => {
    it('thân gồm ĐÚNG 3 trường: ma_lien_thong_bac_si + ma_lien_thong_co_so_kham_chua_benh + password (của bác sĩ), không có Authorization', async () => {
      handler = (_req, res) => json(res, 200, { token: 'tok-bac-si', token_type: 'bearer' });
      const result = await adapter.loginDoctor(endpoint(), { doctorCode: 'BS-0098213', facilityCode: 'CS-790010421', password: 'mat-khau-bac-si' });
      expect(result).toEqual({ kind: 'ok', data: { token: 'tok-bac-si' } });
      const req = captured[0]!;
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/auth/dang-nhap-bac-si');
      expect(req.headers['content-type']).toMatch(/^application\/json/);
      expect(req.headers.authorization).toBeUndefined();
      expect(Object.keys(req.body!).sort()).toEqual(['ma_lien_thong_bac_si', 'ma_lien_thong_co_so_kham_chua_benh', 'password']);
      expect(req.body).toEqual({ ma_lien_thong_bac_si: 'BS-0098213', ma_lien_thong_co_so_kham_chua_benh: 'CS-790010421', password: 'mat-khau-bac-si' });
    });

    it('tài liệu ghi sai chính tả `tocken_type` ở mục VI: vẫn đọc được token', async () => {
      handler = (_req, res) => json(res, 200, { token: 'tok-bs', tocken_type: 'bearer' });
      expect(await adapter.loginDoctor(endpoint(), { doctorCode: 'a', facilityCode: 'b', password: 'c' })).toEqual({ kind: 'ok', data: { token: 'tok-bs' } });
    });

    it('422 "Bác sĩ chưa được thêm vào cơ sở khám chữa bệnh" → rejected kèm đúng nội dung lỗi', async () => {
      handler = (_req, res) => json(res, 422, { danh_sach_cac_loi: ['Bác sĩ chưa được thêm vào cơ sở khám chữa bệnh.'] });
      expect(await adapter.loginDoctor(endpoint(), { doctorCode: 'a', facilityCode: 'b', password: 'c' })).toEqual({
        kind: 'rejected',
        status: 422,
        errors: ['Bác sĩ chưa được thêm vào cơ sở khám chữa bệnh.'],
      });
    });

    it('422 "mã liên thông hoặc mật khẩu không đúng" → rejected', async () => {
      handler = (_req, res) => json(res, 422, { danh_sach_cac_loi: ['Mã liên thông hoặc mật khẩu không đúng'] });
      expect((await adapter.loginDoctor(endpoint(), { doctorCode: 'a', facilityCode: 'b', password: 'c' })).kind).toBe('rejected');
    });
  });

  describe('IV/V. Thêm và xoá bác sĩ — POST /api/v1/them-bac-si, /api/v1/xoa-bac-si (token CƠ SỞ)', () => {
    it('thêm: header Authorization: bearer {token cơ sở} (chữ thường như tài liệu), thân CHỈ có ma_lien_thong_bac_si, đọc success', async () => {
      handler = (_req, res) => json(res, 200, { success: 'Bạn đã thêm bác sĩ thành công' });
      const result = await adapter.addDoctorToFacility(endpoint(), 'tok-co-so', 'BS-0098213');
      expect(result).toEqual({ kind: 'ok', data: { message: 'Bạn đã thêm bác sĩ thành công' } });
      const req = captured[0]!;
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/v1/them-bac-si');
      expect(req.headers.authorization).toBe('bearer tok-co-so');
      expect(req.headers['content-type']).toMatch(/^application\/json/);
      expect(req.body).toEqual({ ma_lien_thong_bac_si: 'BS-0098213' });
    });

    it('xoá: đường dẫn xoa-bac-si, cùng header và thân, đọc success', async () => {
      handler = (_req, res) => json(res, 200, { success: 'Bạn đã xóa bác sĩ khỏi cơ sở khám chữa bệnh thành công' });
      const result = await adapter.removeDoctorFromFacility(endpoint(), 'tok-co-so', 'BS-0098213');
      expect(result).toEqual({ kind: 'ok', data: { message: 'Bạn đã xóa bác sĩ khỏi cơ sở khám chữa bệnh thành công' } });
      const req = captured[0]!;
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/v1/xoa-bac-si');
      expect(req.headers.authorization).toBe('bearer tok-co-so');
      expect(req.body).toEqual({ ma_lien_thong_bac_si: 'BS-0098213' });
    });

    it('422 + danh_sach_cac_loi (ví dụ bác sĩ chưa có mã liên thông) → rejected', async () => {
      handler = (_req, res) => json(res, 422, { danh_sach_cac_loi: ['Mã liên thông bác sĩ không tồn tại'] });
      expect(await adapter.addDoctorToFacility(endpoint(), 't', 'x')).toEqual({ kind: 'rejected', status: 422, errors: ['Mã liên thông bác sĩ không tồn tại'] });
      expect(await adapter.removeDoctorFromFacility(endpoint(), 't', 'x')).toEqual({ kind: 'rejected', status: 422, errors: ['Mã liên thông bác sĩ không tồn tại'] });
    });

    it('401 (token cơ sở hết hạn/sai) → unauthorized để nơi gọi đăng nhập lại', async () => {
      handler = (_req, res) => json(res, 401, { message: 'Unauthenticated.' });
      expect(await adapter.addDoctorToFacility(endpoint(), 'het-han', 'x')).toEqual({ kind: 'unauthorized', errors: ['Unauthenticated.'] });
    });

    it('thành công nhưng không có success → message rỗng (vẫn ok)', async () => {
      handler = (_req, res) => json(res, 200, {});
      expect(await adapter.addDoctorToFacility(endpoint(), 't', 'x')).toEqual({ kind: 'ok', data: { message: '' } });
    });
  });

  describe('VII. Gửi đơn thuốc — POST /api/v1/gui-don-thuoc (token BÁC SĨ)', () => {
    const payload = { loai_don_thuoc: 'c', ma_don_thuoc: '790010000043-C', ho_ten_benh_nhan: 'Lê Quang Huy', thong_tin_don_thuoc: [{ ma_thuoc: 'ABCDEFGHIJ0123456789' }] };

    it('đúng đường dẫn, POST, Content-Type JSON, header Authorization: bearer {token bác sĩ} (chữ thường), thân là NGUYÊN gói đã dựng (không thêm/bớt trường), đọc success', async () => {
      handler = (_req, res) => json(res, 200, { success: 'Đơn thuốc đã được gửi' });
      const result = await adapter.submitPrescription(endpoint(), 'tok-bac-si', payload);
      expect(result).toEqual({ kind: 'ok', data: { message: 'Đơn thuốc đã được gửi' } });
      const req = captured[0]!;
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/v1/gui-don-thuoc');
      expect(req.headers.authorization).toBe('bearer tok-bac-si');
      expect(req.headers['content-type']).toMatch(/^application\/json/);
      expect(req.body).toEqual(payload);
    });

    it('422 + danh_sach_cac_loi → rejected kèm nguyên văn từng lỗi và mã trạng thái', async () => {
      handler = (_req, res) => json(res, 422, { danh_sach_cac_loi: ['hinh_thuc_dieu_tri: bắt buộc với đơn loại c', 'thong_tin_don_thuoc.0.ma_thuoc: không hợp lệ'] });
      expect(await adapter.submitPrescription(endpoint(), 't', payload)).toEqual({
        kind: 'rejected',
        status: 422,
        errors: ['hinh_thuc_dieu_tri: bắt buộc với đơn loại c', 'thong_tin_don_thuoc.0.ma_thuoc: không hợp lệ'],
      });
    });

    it('401 (token bác sĩ hết hạn) → unauthorized để nơi gọi đăng nhập lại bác sĩ rồi thử một lần', async () => {
      handler = (_req, res) => json(res, 401, { message: 'Unauthenticated.' });
      expect(await adapter.submitPrescription(endpoint(), 'het-han', payload)).toEqual({ kind: 'unauthorized', errors: ['Unauthenticated.'] });
    });

    it('cổng lỗi 503 → unreachable (đáng thử lại), KHÔNG bị coi là đơn bị từ chối', async () => {
      handler = (_req, res) => json(res, 503, { message: 'Service Unavailable' });
      const result = await adapter.submitPrescription(endpoint(), 't', payload);
      expect(result.kind).toBe('unreachable');
    });
  });

  describe('lỗi kết nối và phản hồi bất thường — không bao giờ ném lỗi, luôn trả kết quả phân loại', () => {
    it('cổng lỗi 500/502/503 → unreachable (đáng thử lại), không phải rejected', async () => {
      for (const status of [500, 502, 503]) {
        handler = (_req, res) => json(res, status, { message: 'Server Error' });
        const r = await adapter.loginFacility(endpoint(), { facilityCode: 'a', password: 'b' });
        expect(r.kind, `status ${status}`).toBe('unreachable');
      }
    });

    it('429 (quá tải/giới hạn tần suất) → unreachable (thử lại sau)', async () => {
      handler = (_req, res) => json(res, 429, { message: 'Too Many Attempts.' });
      const r = await adapter.loginFacility(endpoint(), { facilityCode: 'a', password: 'b' });
      expect(r).toMatchObject({ kind: 'unreachable' });
    });

    it('lỗi 4xx khác (400/403/404) → rejected kèm status, không bị coi là mất kết nối', async () => {
      for (const status of [400, 403, 404]) {
        handler = (_req, res) => json(res, status, { danh_sach_cac_loi: ['từ chối'] });
        expect(await adapter.addDoctorToFacility(endpoint(), 't', 'x'), `status ${status}`).toEqual({ kind: 'rejected', status, errors: ['từ chối'] });
      }
    });

    it('hết thời gian chờ → unreachable, thông báo nêu số giây, không treo', async () => {
      handler = () => new Promise<void>(() => undefined); // không bao giờ trả lời
      const started = Date.now();
      const r = await adapter.loginFacility({ baseUrl, timeoutMs: 1200 }, { facilityCode: 'a', password: 'b' });
      expect(Date.now() - started).toBeLessThan(4000);
      expect(r).toEqual({ kind: 'unreachable', message: 'hết thời gian chờ 1 giây' });
    });

    it('không kết nối được (cổng đóng) → unreachable', async () => {
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
      const port = (closed.address() as AddressInfo).port;
      await new Promise<void>((resolve) => closed.close(() => resolve()));
      const r = await adapter.loginFacility({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 3000 }, { facilityCode: 'a', password: 'b' });
      expect(r).toEqual({ kind: 'unreachable', message: 'lỗi kết nối mạng' });
    });

    it('tên miền không tồn tại → unreachable', async () => {
      const r = await adapter.loginFacility({ baseUrl: 'http://khong-ton-tai.invalid', timeoutMs: 3000 }, { facilityCode: 'a', password: 'b' });
      expect(r.kind).toBe('unreachable');
    });

    it('thành công (200) nhưng thân không có token / không phải JSON → unreachable (phản hồi không đọc được), không báo thành công giả', async () => {
      handler = (_req, res) => json(res, 200, { token_type: 'bearer' });
      expect((await adapter.loginFacility(endpoint(), { facilityCode: 'a', password: 'b' })).kind).toBe('unreachable');
      handler = (_req, res) => json(res, 200, { token: '' });
      expect((await adapter.loginDoctor(endpoint(), { doctorCode: 'a', facilityCode: 'b', password: 'c' })).kind).toBe('unreachable');
      handler = (_req, res) => {
        res.statusCode = 200;
        res.end('<html>trang bảo trì</html>');
      };
      expect((await adapter.loginFacility(endpoint(), { facilityCode: 'a', password: 'b' })).kind).toBe('unreachable');
    });

    it('cổng chuyển hướng (3xx) không được đi theo (tránh lộ mật khẩu sang địa chỉ khác) → unreachable', async () => {
      handler = (_req, res) => {
        res.statusCode = 302;
        // Chuyển hướng về CHÍNH máy chủ giả: nếu adapter đi theo thì `captured` sẽ có 2 yêu cầu (kèm mật khẩu gửi lần nữa).
        res.setHeader('Location', `${baseUrl}/da-chuyen-huong`);
        res.end();
      };
      const r = await adapter.loginFacility(endpoint(), { facilityCode: 'a', password: 'b' });
      expect(r.kind).toBe('unreachable');
      expect(captured.map((c) => c.url)).toEqual(['/api/auth/dang-nhap-co-so-kham-chua-benh']);
    });

    it('phản hồi quá lớn (> 1 MB) bị bỏ qua, không làm sập', async () => {
      handler = (_req, res) => {
        res.statusCode = 422;
        res.end(JSON.stringify({ danh_sach_cac_loi: ['x'.repeat(1_200_000)] }));
      };
      expect(await adapter.loginFacility(endpoint(), { facilityCode: 'a', password: 'b' })).toEqual({ kind: 'rejected', status: 422, errors: [] });
    });
  });

  describe('an toàn', () => {
    it('chế độ SaaS: từ chối http, máy cục bộ và IP riêng TRƯỚC khi gọi mạng (không có yêu cầu nào tới máy chủ giả)', async () => {
      const saas = new HttpEPrescriptionGatewayAdapter(config('saas'));
      handler = (_req, res) => json(res, 200, { token: 't' });
      for (const url of [baseUrl, 'http://api.donthuocquocgia.vn', 'https://127.0.0.1', 'https://localhost', 'https://10.0.0.5', 'https://192.168.1.10', 'https://169.254.169.254', 'https://172.20.0.1', 'https://[::1]', 'https://may-chu.local', 'https://db.internal']) {
        const r = await saas.loginFacility({ baseUrl: url, timeoutMs: 2000 }, { facilityCode: 'a', password: 'b' });
        expect(r, url).toMatchObject({ kind: 'unreachable', message: expect.stringContaining('không được phép') });
      }
      expect(captured).toHaveLength(0);
    });

    it('chế độ SaaS: địa chỉ https công khai KHÔNG bị chặn bởi bộ lọc (lỗi nếu có chỉ là lỗi mạng)', async () => {
      const saas = new HttpEPrescriptionGatewayAdapter(config('saas'));
      const r = await saas.loginFacility({ baseUrl: 'https://khong-ton-tai.invalid', timeoutMs: 3000 }, { facilityCode: 'a', password: 'b' });
      expect(r).toMatchObject({ kind: 'unreachable' });
      expect((r as { message: string }).message).not.toContain('không được phép');
    });

    it('địa chỉ sai định dạng → unreachable, không ném lỗi', async () => {
      const r = await adapter.loginFacility({ baseUrl: 'không phải địa chỉ', timeoutMs: 2000 }, { facilityCode: 'a', password: 'b' });
      expect(r).toEqual({ kind: 'unreachable', message: 'địa chỉ máy chủ không hợp lệ' });
    });

    it('KHÔNG ghi mật khẩu/token/mã liên thông vào nhật ký hệ thống (kể cả khi lỗi)', async () => {
      const logged: string[] = [];
      vi.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => void logged.push(String(m)));
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => void logged.push(String(m)));
      handler = (_req, res) => json(res, 200, { token: 'TOKEN-BI-MAT' });
      await adapter.loginFacility(endpoint(), { facilityCode: 'MA-CO-SO-BI-MAT', password: 'MAT-KHAU-BI-MAT' });
      handler = (_req, res) => json(res, 422, { danh_sach_cac_loi: ['sai'] });
      await adapter.loginDoctor(endpoint(), { doctorCode: 'MA-BAC-SI-BI-MAT', facilityCode: 'x', password: 'MAT-KHAU-BS-BI-MAT' });
      await adapter.addDoctorToFacility({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 1500 }, 'TOKEN-BI-MAT', 'MA-BAC-SI-BI-MAT');
      const all = logged.join('\n');
      expect(all.length).toBeGreaterThan(0);
      for (const secret of ['TOKEN-BI-MAT', 'MA-CO-SO-BI-MAT', 'MAT-KHAU-BI-MAT', 'MA-BAC-SI-BI-MAT', 'MAT-KHAU-BS-BI-MAT']) expect(all).not.toContain(secret);
    });
  });
});
