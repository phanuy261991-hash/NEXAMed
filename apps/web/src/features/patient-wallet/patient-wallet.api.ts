import type {
  ListWalletsResponse,
  ListWalletTransactionsResponse,
  PatientWallet,
  SettleWalletRequest,
  SettleWalletResponse,
  TopUpWalletRequest,
  TopUpWalletResponse,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function getWallet(patientId: string): Promise<PatientWallet | null> {
  return unwrap(await getApiClient().GET('/api/v1/wallet', { params: { query: { patientId } } })) as PatientWallet | null;
}

export async function listWalletTransactions(patientId: string, cursor?: string, limit?: number): Promise<ListWalletTransactionsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/wallet/transactions', { params: { query: { patientId, cursor, limit } } }),
  ) as ListWalletTransactionsResponse;
}

export async function listWallets(params: { q?: string; status?: 'ACTIVE' | 'CLOSED'; cursor?: string; limit?: number }): Promise<ListWalletsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/wallet/list', { params: { query: params } })) as ListWalletsResponse;
}

export async function topUpWallet(body: TopUpWalletRequest): Promise<TopUpWalletResponse> {
  return unwrap(await getApiClient().POST('/api/v1/wallet/topup', { body })) as TopUpWalletResponse;
}

export async function settleWallet(body: SettleWalletRequest): Promise<SettleWalletResponse> {
  return unwrap(await getApiClient().POST('/api/v1/wallet/settle', { body })) as SettleWalletResponse;
}
