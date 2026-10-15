import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { SYSTEM_TEST_ACTOR } from './tenant-fixture';

/**
 * Hàm hỗ trợ dùng chung cho spec HTTP e2e có nhiều tài khoản/chi nhánh (Đợt 3 chi nhánh): tạo tài khoản gắn vai trò + chi nhánh, đăng nhập, tạo mặt hàng, nhập kho, tải file.
 * `app`/`privileged` được truyền dưới dạng hàm vì spec chỉ khởi tạo chúng trong `beforeAll`. Spec mới dùng bộ này thay vì chép lại các hàm giống nhau.
 */
export function createE2eHelpers(ctx: { app: () => INestApplication; privileged: () => PrismaClient; password?: string }) {
  const password = ctx.password ?? 'Test@12345';
  const http = () => request(ctx.app().getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Tạo tài khoản gắn vai trò (theo tên vai trò đã seed, hoặc `roleId` của vai trò tuỳ biến) và — nếu có — chỉ định các chi nhánh được làm việc. */
  async function createUser(tenantId: string, role: { name: string } | { id: string }, label: string, branchIds: string[] = []): Promise<{ id: string; username: string }> {
    const privileged = ctx.privileged();
    const username = `e2e-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const roleId = 'id' in role ? role.id : (await privileged.role.findFirstOrThrow({ where: { tenantId, name: role.name } })).id;
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    for (const branchId of branchIds) {
      await privileged.userBranch.create({ data: { tenantId, userId: user.id, branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
    return { id: user.id, username };
  }

  /** Vai trò tuỳ biến chỉ có đúng các quyền `<module>.<action>` được liệt kê (scope `global`). */
  async function createRoleWithPermissions(tenantId: string, name: string, permissions: ReadonlyArray<readonly [string, string]>): Promise<string> {
    const privileged = ctx.privileged();
    const role = await privileged.role.create({ data: { tenantId, name, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    for (const [module, action] of permissions) {
      const permission = await privileged.permission.findFirstOrThrow({ where: { module, action } });
      await privileged.rolePermission.create({
        data: { tenantId, roleId: role.id, permissionId: permission.id, dataScope: 'global', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    return role.id;
  }

  async function login(tenantId: string, username: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function createDrug(token: string): Promise<string> {
    const res = await http()
      .post('/api/v1/drugs')
      .set(authed(token))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name: 'Paracetamol 500mg',
        itemType: 'MEDICINE',
        baseUnitCode: 'VIEN',
        activeIngredient: 'Paracetamol',
        unit: 'Viên',
        concentration: '500mg',
        manufacturerCode: 'TEST_MANUFACTURER',
        defaultSellPrice: 5000,
        drugGroupCode: 'TEST_GROUP',
        routeCode: 'TEST_ROUTE',
        registrationNumber: 'VD-TEST-0001',
        dosageForm: 'Viên nén',
        countryOfOrigin: 'Việt Nam',
        ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }],
        units: [],
        isBatchManaged: false,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  /** Nhập tồn đầu kỳ và DUYỆT ngay — kho `warehouseId` có `quantity` đơn vị `drugId`. */
  async function approvedOpeningReceipt(token: string, warehouseId: string, drugId: string, quantity: number): Promise<void> {
    const created = await http()
      .post('/api/v1/inventory/receipts')
      .set(authed(token))
      .send({ warehouseId, receiptType: 'OPENING_BALANCE', lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost: 1000 }] });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const approved = await http().post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(token)).send({ version: created.body.data.version });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  }

  /** Lập phiếu thu/chi tiền mặt vào quỹ `cashAccountId` (loại thu chi mặc định đã seed `TC00001`). */
  async function postVoucher(token: string, direction: 'INCOME' | 'EXPENSE', cashAccountId: string, amount: number): Promise<void> {
    const res = await http()
      .post('/api/v1/cash-vouchers')
      .set(authed(token))
      .send({ direction, incomeExpenseTypeCode: 'TC00001', cashAccountId, paymentMethodCode: 'CASH', amount, description: `Phiếu thử ${direction}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  /** Tải file nhị phân (Excel) — trả về `res` với `res.body` là Buffer khi thành công. */
  function download(path: string, token: string) {
    return http()
      .get(path)
      .set(authed(token))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  }

  return { password, http, authed, createUser, createRoleWithPermissions, login, createDrug, approvedOpeningReceipt, postVoucher, download };
}
