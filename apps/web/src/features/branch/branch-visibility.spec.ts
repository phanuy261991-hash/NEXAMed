import { describe, expect, it } from 'vitest';
import type { BranchLite } from '@nexamed/shared';
import { getAuthRedirect } from '../auth/auth-redirect';
import { findCurrentBranch, hasMultipleBranches, needsBranchSelection, showBranchInfo } from './branch-visibility';

const b1: BranchLite = { id: '11111111-1111-4111-8111-111111111111', code: 'CN00001', name: 'Cơ sở chính', address: null, isDefault: true };
const b2: BranchLite = { id: '22222222-2222-4222-8222-222222222222', code: 'CN00002', name: 'Chi nhánh Quận 7', address: 'Q7', isDefault: false };

describe('hiện/ẩn giao diện chi nhánh', () => {
  it('công ty/tài khoản 1 chi nhánh: ẩn hoàn toàn, không bao giờ phải chọn', () => {
    const user = { branches: [b1], currentBranchId: b1.id };
    expect(hasMultipleBranches(user)).toBe(false);
    expect(needsBranchSelection(user)).toBe(false);
    expect(needsBranchSelection({ branches: [b1], currentBranchId: null })).toBe(false);
  });

  it('chưa có user → không hiện gì', () => {
    expect(hasMultipleBranches(null)).toBe(false);
    expect(needsBranchSelection(undefined)).toBe(false);
    expect(findCurrentBranch(null)).toBeNull();
  });

  it('gán từ 2 chi nhánh mà phiên chưa chọn → phải chọn; đã chọn thì không', () => {
    expect(needsBranchSelection({ branches: [b1, b2], currentBranchId: null })).toBe(true);
    expect(needsBranchSelection({ branches: [b1, b2], currentBranchId: b2.id })).toBe(false);
  });

  it('findCurrentBranch trả đúng chi nhánh hiện hành, null nếu chưa chọn hoặc id lạ', () => {
    expect(findCurrentBranch({ branches: [b1, b2], currentBranchId: b2.id })).toEqual(b2);
    expect(findCurrentBranch({ branches: [b1, b2], currentBranchId: null })).toBeNull();
    expect(findCurrentBranch({ branches: [b1, b2], currentBranchId: '33333333-3333-4333-8333-333333333333' })).toBeNull();
  });
});

describe('showBranchInfo (nhãn/cột/tab chi nhánh trên chứng từ)', () => {
  it('công ty 1 chi nhánh: ẩn', () => {
    expect(showBranchInfo({ branches: [b1], currentBranchId: b1.id, multiBranchCompany: false })).toBe(false);
    expect(showBranchInfo(null)).toBe(false);
  });

  it('nhân viên chỉ thuộc 1 chi nhánh nhưng công ty có nhiều chi nhánh: vẫn hiện (để thấy phiếu đến từ chi nhánh khác)', () => {
    expect(showBranchInfo({ branches: [b2], currentBranchId: b2.id, multiBranchCompany: true })).toBe(true);
    expect(hasMultipleBranches({ branches: [b2], currentBranchId: b2.id, multiBranchCompany: true })).toBe(false);
  });

  it('được gán nhiều chi nhánh: hiện', () => {
    expect(showBranchInfo({ branches: [b1, b2], currentBranchId: b1.id })).toBe(true);
  });
});

describe('getAuthRedirect (route guard)', () => {
  const multiUnchosen = { mustChangePassword: false, branches: [b1, b2], currentBranchId: null };

  it('được vào bình thường: 1 chi nhánh, hoặc đã chọn chi nhánh', () => {
    expect(getAuthRedirect({ mustChangePassword: false, branches: [b1], currentBranchId: b1.id }, '/patients')).toBeNull();
    expect(getAuthRedirect({ ...multiUnchosen, currentBranchId: b1.id }, '/patients')).toBeNull();
  });

  it('nhiều chi nhánh chưa chọn → chuyển tới /choose-branch, trừ chính trang đó (tránh vòng lặp)', () => {
    expect(getAuthRedirect(multiUnchosen, '/')).toBe('/choose-branch');
    expect(getAuthRedirect(multiUnchosen, '/patients')).toBe('/choose-branch');
    expect(getAuthRedirect(multiUnchosen, '/choose-branch')).toBeNull();
  });

  it('buộc đổi mật khẩu đi TRƯỚC chọn chi nhánh', () => {
    const user = { ...multiUnchosen, mustChangePassword: true };
    expect(getAuthRedirect(user, '/')).toBe('/change-password');
    expect(getAuthRedirect(user, '/choose-branch')).toBe('/change-password');
    expect(getAuthRedirect(user, '/change-password')).toBeNull();
  });
});
