/**
 * The package throws its own error type rather than a consumer's, so the grammar can be
 * shared without dragging one application's error hierarchy along with it. Catch
 * `FilterSyntaxError` and map `code` onto whatever you already return — a 400, a refusal,
 * whatever fits.
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
