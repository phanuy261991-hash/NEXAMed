import type {
  CollectSpecimenTubesRequest,
  LookupSpecimenTubeResponse,
  PrintSpecimenTubesRequest,
  RecollectSpecimenTubeRequest,
  SpecimenCollectionResponse,
  SpecimenCollectionState,
  SplitSpecimenTubeRequest,
  UncollectSpecimenTubesRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/**
 * Lấy mẫu xét nghiệm có ống mẫu, mã ống (SID) và tem mã vạch (docs/DECISIONS.md #220) — chỉ nhóm Xét nghiệm (`/paraclinical/lab/...`, quyền `lab_result.*`). Mọi thao tác ghi trả
 * `{ state }` = trạng thái hộp thoại lấy mẫu của phiếu để vẽ lại.
 */

const stateOf = (res: unknown): SpecimenCollectionState => (unwrap(res as never) as SpecimenCollectionResponse).state;

export async function openSpecimenCollection(orderId: string): Promise<SpecimenCollectionState> {
  return stateOf(await getApiClient().POST('/api/v1/paraclinical/lab/orders/{orderId}/specimen-collection/open', { params: { path: { orderId } } }));
}

export async function lookupSpecimenTube(sid: string): Promise<LookupSpecimenTubeResponse> {
  return unwrap(await getApiClient().GET('/api/v1/paraclinical/lab/specimen-tubes/lookup', { params: { query: { sid } } })) as LookupSpecimenTubeResponse;
}

export async function printSpecimenTubes(body: PrintSpecimenTubesRequest): Promise<SpecimenCollectionState> {
  return stateOf(await getApiClient().POST('/api/v1/paraclinical/lab/specimen-tubes/print', { body }));
}

export async function collectSpecimenTubes(body: CollectSpecimenTubesRequest): Promise<SpecimenCollectionState> {
  return stateOf(await getApiClient().POST('/api/v1/paraclinical/lab/specimen-tubes/collect', { body }));
}

export async function uncollectSpecimenTubes(body: UncollectSpecimenTubesRequest): Promise<SpecimenCollectionState> {
  return stateOf(await getApiClient().POST('/api/v1/paraclinical/lab/specimen-tubes/uncollect', { body }));
}

export async function splitSpecimenTube(tubeId: string, body: SplitSpecimenTubeRequest): Promise<SpecimenCollectionState> {
  return stateOf(await getApiClient().POST('/api/v1/paraclinical/lab/specimen-tubes/{tubeId}/split', { params: { path: { tubeId } }, body }));
}

export async function recollectSpecimenTube(tubeId: string, body: RecollectSpecimenTubeRequest): Promise<SpecimenCollectionState> {
  return stateOf(await getApiClient().POST('/api/v1/paraclinical/lab/specimen-tubes/{tubeId}/recollect', { params: { path: { tubeId } }, body }));
}
