/**
 * Client-safe error parsing utilities.
 *
 * Transforms ApiError responses into UI-friendly objects for forms and toasts.
 *
 * @see @/lib/api/shapes for ApiErrorSchema
 */

import { ApiErrorSchema, type ApiIssue } from "@/lib/api/shapes";

// ============================================================================
// Types
// ============================================================================

/** UI-friendly error parsed from ApiError, ready for forms and toasts. */
export type ApiFormError = {
  fieldErrors: Record<string, string>;
  formError?: string;
  code?: string;
  status?: number;
  meta?: unknown;
};

// ============================================================================
// Parsing
// ============================================================================

/**
 * Extract field-level errors from API issues.
 * Uses dot notation for nested paths (e.g., ["user", "profile", "name"] → "user.profile.name").
 * Compatible with React Hook Form's nested field naming.
 */
function extractFieldErrors(issues: ApiIssue[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of issues) {
    if (issue.path.length === 0) continue;
    const key = issue.path.map(String).join(".");
    if (!fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }

  return fieldErrors;
}

/**
 * Parse an ApiError into a UI-friendly ApiFormError.
 *
 * @example
 * const result = await apiPost('/api/users/create', data);
 * if (!result.ok) {
 *   const { fieldErrors, formError } = parseApiError(result.error);
 * }
 */
export function parseApiError(error: unknown): ApiFormError {
  const parsed = ApiErrorSchema.safeParse(error);

  if (!parsed.success) {
    return { fieldErrors: {} };
  }

  const { code, message, status, issues, meta } = parsed.data;

  return {
    fieldErrors: issues?.length ? extractFieldErrors(issues) : {},
    formError: message || undefined,
    code,
    status,
    meta,
  };
}
