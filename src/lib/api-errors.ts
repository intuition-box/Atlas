/**
 * Helpers to turn API errors (including Zod issues) into field + form errors, V3-only.
 * Works with our ApiResponse<T> error envelope and the RpcError thrown by rpc-client.
 */

import { isApiResponse, type ApiResponse } from "@/types/api";

/**
 * We intentionally avoid importing RpcError from the client module to prevent
 * server<->client coupling. Treat errors structurally instead.
 */
export type RpcErrorLike = Error & {
  status?: number;
  code?: string | number;
  details?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRpcErrorLike(err: unknown): err is RpcErrorLike {
  if (!isRecord(err)) return false;
  const message = err["message"];
  if (typeof message !== "string") return false;
  return "status" in err || "code" in err || "details" in err;
}

export type ParsedApiError = {
  fieldErrors: Record<string, string>;
  formError?: string;
  code?: number;
  status?: number;
};

type ParseOptions = {
  /**
   * Optional mapping from API issue paths to local field names.
   * Example: { 'title': 'title', 'spaceSlug': 'space', 'boardId': 'board' }
   */
  fieldMap?: Record<string, string>;
};

type ApiIssue = {
  path?: string | (string | number)[];
  message?: string;
  code?: string;
};

type IssuesLike = ApiIssue[] | { issues?: ApiIssue[] } | null | undefined;

function extractIssues(details: unknown): ApiIssue[] | undefined {
  if (!details) return undefined;
  if (Array.isArray(details)) return details as ApiIssue[];
  if (isRecord(details)) {
    const maybe = details.issues;
    if (Array.isArray(maybe)) return maybe as ApiIssue[];
  }
  return undefined;
}

function pathToKey(path: ApiIssue['path']): string {
  if (Array.isArray(path)) return path.map(String).join(".");
  if (typeof path === "string") return path;
  return "";
}

function applyIssues(
  out: ParsedApiError,
  issues: ApiIssue[] | null | undefined,
  fieldMap: Record<string, string>,
) {
  if (!issues || issues.length === 0) return;
  for (const issue of issues) {
    const raw = pathToKey(issue?.path);
    const field = fieldMap[raw] ?? raw;
    const message = String(issue?.message ?? "Invalid value");
    if (field && !out.fieldErrors[field]) {
      out.fieldErrors[field] = message;
    }
  }
}

/**
 * Parse an ApiResponse<T> error payload (server standard).
 * Shape: { success: false, error: { code, message, details?: ApiIssue[] } }
 */
export function parseApiErrorPayload(payload: ApiResponse<unknown>, opts: ParseOptions = {}): ParsedApiError {
  const { fieldMap = {} } = opts;
  const out: ParsedApiError = { fieldErrors: {} };

  if (payload.success !== false || typeof payload.error?.message !== "string") {
    out.formError = "Unexpected server response";
    return out;
  }

  out.formError = payload.error.message;
  applyIssues(out, extractIssues(payload.error.details), fieldMap);
  return out;
}

/**
 * Parse a failing fetch Response that returns our ApiResponse<T> envelope.
 * Keep this only for low-level calls; prefer using rpc-client and parseRpcError in UI code.
 */
export async function parseApiError(res: Response, opts: ParseOptions = {}): Promise<ParsedApiError> {
  const out: ParsedApiError = { fieldErrors: {}, status: res.status };
  if (res.ok) return out;

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    out.formError = res.statusText || `Request failed (${res.status})`;
    return out;
  }

  if (!isApiResponse(payload)) {
    out.formError = "Unexpected server response";
    return out;
  }

  const parsed = parseApiErrorPayload(payload, opts);
  return { ...parsed, status: res.status };
}

/**
 * Preferred path in the UI: catch RpcError from `rpc-client` and parse it here.
 */
export function parseRpcError(err: unknown, opts: ParseOptions = {}): ParsedApiError {
  const { fieldMap = {} } = opts;
  const out: ParsedApiError = { fieldErrors: {} };

  if (isRpcErrorLike(err)) {
    const numericCode = typeof err.code === "number" ? err.code : undefined;
    out.code = numericCode;
    out.status = typeof err.status === "number" ? err.status : numericCode;
    out.formError = err.message || "Request failed";
    applyIssues(out, extractIssues(err.details), fieldMap);
    return out;
  }

  if (isRecord(err) && err["success"] === false && isApiResponse(err)) {
    return parseApiErrorPayload(err, opts);
  }

  out.formError = isRecord(err) && typeof err["message"] === "string" ? err["message"] : "Request failed";
  return out;
}