import { DomainError } from './domain-error';

/** DB trả unique violation trên `(category, code)` — trùng mã trong cùng danh mục. */
export class ReferenceCatalogDuplicateCodeError extends DomainError {
  readonly code = 'REFERENCE_CATALOG_DUPLICATE_CODE';

  constructor() {
    super('Mã này đã tồn tại trong danh mục.');
  }
}
