import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListWalletsQuery, SettleWalletRequest, TopUpWalletRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getWallet, listWalletTransactions, listWallets, settleWallet, topUpWallet } from './patient-wallet.api';

const WALLET_TRANSACTIONS_LIMIT = 20;
const WALLET_LIST_LIMIT = 50;

export function useWalletQuery(patientId: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'wallet', 'detail', patientId),
    queryFn: () => getWallet(patientId),
    enabled: patientId !== '',
  });
}

export function useWalletTransactionsQuery(patientId: string) {
  const { tenantId } = useAppConfig();
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, 'wallet', 'transactions', patientId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => listWalletTransactions(patientId, pageParam, WALLET_TRANSACTIONS_LIMIT),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: patientId !== '',
  });
}

/** Trang "Ví tạm ứng" tổng hợp (Sổ quỹ & Thu chi) — cursor pagination, giữ kết quả cũ khi đổi bộ lọc. */
export function useWalletListQuery(filters: Omit<ListWalletsQuery, 'cursor' | 'limit'>) {
  const { tenantId } = useAppConfig();
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, 'wallet', 'list', filters.q || undefined, filters.status),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listWallets({ ...filters, cursor: pageParam, limit: WALLET_LIST_LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

function invalidateWallet(queryClient: ReturnType<typeof useQueryClient>, tenantId: string, patientId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'wallet', 'detail', patientId) });
  void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'wallet', 'transactions', patientId) });
  void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'wallet', 'list') });
}

export function useTopUpWalletMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TopUpWalletRequest) => topUpWallet(body),
    onSuccess: (_data, variables) => invalidateWallet(queryClient, tenantId, variables.patientId),
  });
}

export function useSettleWalletMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SettleWalletRequest) => settleWallet(body),
    onSuccess: (_data, variables) => invalidateWallet(queryClient, tenantId, variables.patientId),
  });
}
