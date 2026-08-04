/**
 * The package throws its own error type rather than either consumer's `CustomError`, so the
 * grammar can be shared without dragging a repo's error hierarchy along with it. Consumers
 * catch `FilterSyntaxError` and map `code` onto whatever they already return — bank-core to a
 * 400 `VALIDATION_ERROR`, the proxy to a refusal.
 */
export type FilterErrorCode =
  | 'INVALID_FILTER_SYNTAX'
  | 'FILTER_TOO_LONG'
  | 'FILTER_TOO_DEEP'
  | 'FILTER_TOO_COMPLEX';

export interface FilterErrorDetails {
  /** 1-based index into the original expression, so a caller can point at the offending token. */
  position?: number;
  field?: string;
  detail?: string;
  max?: number;
}

export class FilterSyntaxError extends Error {
  readonly code: FilterErrorCode;
  readonly details: FilterErrorDetails;

  constructor(code: FilterErrorCode, details: FilterErrorDetails = {}) {
    super(details.detail ?? code);
    this.name = 'FilterSyntaxError';
    this.code = code;
    this.details = details;
  }
}
