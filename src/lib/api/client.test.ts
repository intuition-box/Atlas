/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPost, resetCsrf, __testing__ } from "@/lib/api/client";

// Mock fetch globally
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string, status: number, issues?: Array<{ path: (string | number)[]; message: string }>): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message, status, issues } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api/client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    __testing__.resetCsrfFetcher();
    __testing__.setCsrfFetcher(() => Promise.resolve("test-csrf-token"));
  });

  afterEach(() => {
    __testing__.resetCsrfFetcher();
  });

  describe("apiGet", () => {
    it("makes a GET request and returns success result", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ users: ["alice", "bob"] }));

      const result = await apiGet<{ users: string[] }>("/api/users/list");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.users).toEqual(["alice", "bob"]);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/users/list",
        expect.objectContaining({
          method: "GET",
          credentials: "same-origin",
        }),
      );
    });

    it("appends query parameters to URL", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await apiGet("/api/users/list", { page: 1, limit: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/users/list?page=1&limit=20",
        expect.any(Object),
      );
    });

    it("handles array query parameters", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await apiGet("/api/users/list", { ids: ["a", "b", "c"] });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/users/list?ids=a&ids=b&ids=c",
        expect.any(Object),
      );
    });

    it("filters null and undefined query values", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await apiGet("/api/users/list", { page: 1, filter: null, sort: undefined });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/users/list?page=1",
        expect.any(Object),
      );
    });
  });

  describe("apiPost", () => {
    it("makes a POST request with JSON body", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "123" }));

      const result = await apiPost<{ id: string }>("/api/users/create", { name: "Alice" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe("123");
      }

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/users/create",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Alice" }),
        }),
      );
    });

    it("includes CSRF token in POST requests", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await apiPost("/api/users/create", { name: "Alice" });

      const [, init] = mockFetch.mock.calls[0];
      expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("test-csrf-token");
    });

    it("skips CSRF when csrf: false", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await apiPost("/api/webhook", {}, { csrf: false });

      const [, init] = mockFetch.mock.calls[0];
      expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("returns error result for API errors", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse("NOT_FOUND", "User not found", 404));

      const result = await apiGet("/api/users/get");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect(result.error.message).toBe("User not found");
        expect(result.error.status).toBe(404);
      }
    });

    it("returns CLIENT_NETWORK_ERROR on fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failed"));

      const result = await apiGet("/api/users/list", undefined, { maxRetries: 0 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CLIENT_NETWORK_ERROR");
      }
    });

    it("returns CLIENT_NON_JSON_RESPONSE for non-JSON responses", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("Internal Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      );

      const result = await apiGet("/api/users/list");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CLIENT_NON_JSON_RESPONSE");
      }
    });

    it("returns CLIENT_INVALID_RESPONSE for invalid JSON structure", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: "structure" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await apiGet("/api/users/list");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CLIENT_INVALID_RESPONSE");
      }
    });

    it("extracts issues from validation error", async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse("INVALID_REQUEST", "Validation failed", 400, [
          { path: ["name"], message: "Required" },
          { path: ["email"], message: "Invalid email" },
        ]),
      );

      const result = await apiPost("/api/users/create", {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.issues).toEqual([
          { path: ["name"], message: "Required" },
          { path: ["email"], message: "Invalid email" },
        ]);
      }
    });
  });

  describe("CSRF retry", () => {
    it("retries once on CSRF failure and refreshes token", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse("CSRF_FAILED", "CSRF validation failed", 419));
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

      let callCount = 0;
      __testing__.setCsrfFetcher(() => {
        callCount++;
        return Promise.resolve(`csrf-token-${callCount}`);
      });

      const result = await apiPost("/api/users/create", {});

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(callCount).toBe(2);
    });

    it("does not retry CSRF more than once", async () => {
      mockFetch.mockResolvedValue(errorResponse("CSRF_FAILED", "CSRF validation failed", 419));

      const result = await apiPost("/api/users/create", {});

      expect(result.ok).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("network retry with backoff", () => {
    it("retries on network error", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network failed"))
        .mockRejectedValueOnce(new Error("Network failed"))
        .mockResolvedValueOnce(jsonResponse({ success: true }));

      const result = await apiPost("/api/users/create", {}, { maxRetries: 2 });

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("retries on 502/503/504 server errors", async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse("SERVER_ERROR", "Bad Gateway", 502))
        .mockResolvedValueOnce(jsonResponse({ success: true }));

      const result = await apiGet("/api/users/list", undefined, { maxRetries: 1 });

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("does not retry on 4xx errors", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse("NOT_FOUND", "Not found", 404));

      const result = await apiGet("/api/users/get", undefined, { maxRetries: 2 });

      expect(result.ok).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("respects maxRetries: 0 to disable retries", async () => {
      mockFetch.mockRejectedValue(new Error("Network failed"));

      const result = await apiGet("/api/users/list", undefined, { maxRetries: 0 });

      expect(result.ok).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("timeout", () => {
    it("aborts request after timeout", async () => {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000)),
      );

      const result = await apiGet("/api/slow", undefined, { timeoutMs: 50, maxRetries: 0 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CLIENT_REQUEST_TIMEOUT");
      }
    });

    it("respects external abort signal", async () => {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000)),
      );

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);

      const result = await apiGet("/api/slow", undefined, {
        signal: controller.signal,
        timeoutMs: 0,
        maxRetries: 0,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CLIENT_REQUEST_ABORTED");
      }
    });
  });

  describe("request ID", () => {
    it("generates unique request ID", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}));

      await apiGet("/api/test1");
      await apiGet("/api/test2");

      const [call1, call2] = mockFetch.mock.calls;
      const id1 = (call1[1]?.headers as Record<string, string>)["X-Request-ID"];
      const id2 = (call2[1]?.headers as Record<string, string>)["X-Request-ID"];

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it("uses provided requestId", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await apiGet("/api/test", undefined, { requestId: "custom-id-123" });

      const [, init] = mockFetch.mock.calls[0];
      expect((init?.headers as Record<string, string>)["X-Request-ID"]).toBe("custom-id-123");
    });

    it("preserves requestId across retries", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network failed"))
        .mockResolvedValueOnce(jsonResponse({}));

      await apiGet("/api/test", undefined, { maxRetries: 1 });

      const [call1, call2] = mockFetch.mock.calls;
      const id1 = (call1[1]?.headers as Record<string, string>)["X-Request-ID"];
      const id2 = (call2[1]?.headers as Record<string, string>)["X-Request-ID"];

      expect(id1).toBe(id2);
    });

    it("includes requestId in error meta", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse("NOT_FOUND", "Not found", 404));

      const result = await apiGet("/api/test", undefined, { requestId: "trace-123" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error.meta as { requestId?: string })?.requestId).toBe("trace-123");
      }
    });
  });

  describe("idempotency", () => {
    it("includes Idempotency-Key header when provided", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await apiPost("/api/payments/create", {}, { idempotencyKey: "payment-123" });

      const [, init] = mockFetch.mock.calls[0];
      expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("payment-123");
    });
  });

  describe("If-Match (optimistic concurrency)", () => {
    it("includes If-Match header when provided", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await apiPost("/api/users/update", {}, { ifMatch: '"abc123"' });

      const [, init] = mockFetch.mock.calls[0];
      expect((init?.headers as Record<string, string>)["If-Match"]).toBe('"abc123"');
    });
  });
});
