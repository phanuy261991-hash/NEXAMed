import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CollectSpecimenTubesRequest, PrintSpecimenTubesRequest, RecollectSpecimenTubeRequest, SpecimenCollectionState, UncollectSpecimenTubesRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { collectSpecimenTubes, lookupSpecimenTube, openSpecimenCollection, printSpecimenTubes, recollectSpecimenTube, splitSpecimenTube, uncollectSpecimenTubes } from './specimen-tube.api';

/**
 * Hook lấy mẫu xét nghiệm (docs/DECISIONS.md #220). Hộp thoại giữ trạng thái bằng chính kết quả trả về của mỗi thao tác (không cache theo query) — chỉ cần làm mới hàng đợi
 * Xét nghiệm và khối "Kết quả đã có" ở màn khám mỗi khi dòng chỉ định đổi trạng thái.
 */
export function useSpecimenCollection() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const refreshQueue = () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'paraclinical', 'queue') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinical-order', 'detail') });
  };
  const after = (state: SpecimenCollectionState) => {
    refreshQueue();
    return state;
  };
  return {
    open: useMutation({ mutationFn: (orderId: string) => openSpecimenCollection(orderId), onSuccess: after }),
    split: useMutation({ mutationFn: ({ tubeId, itemId }: { tubeId: string; itemId: string }) => splitSpecimenTube(tubeId, { itemId }), onSuccess: after }),
    print: useMutation({ mutationFn: (body: PrintSpecimenTubesRequest) => printSpecimenTubes(body), onSuccess: after }),
    collect: useMutation({ mutationFn: (body: CollectSpecimenTubesRequest) => collectSpecimenTubes(body), onSuccess: after }),
    uncollect: useMutation({ mutationFn: (body: UncollectSpecimenTubesRequest) => uncollectSpecimenTubes(body), onSuccess: after }),
    recollect: useMutation({ mutationFn: ({ tubeId, ...body }: RecollectSpecimenTubeRequest & { tubeId: string }) => recollectSpecimenTube(tubeId, body), onSuccess: after }),
    lookup: useMutation({ mutationFn: (sid: string) => lookupSpecimenTube(sid) }),
  };
}
