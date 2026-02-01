/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

// Mock server-only (Next.js build-time guard)
vi.mock("server-only", () => ({}));

import { api, okJson, errJson } from "./server";

// Mock dependencies
vi.mock("@/lib/auth/policy", () => ({
  AuthErrorSchema: {
    safeParse: vi.fn((e) => {
      if (e && typeof e === "object" && "code" in e && "message" in e && "status" in e) {
        return { success: true, data: e };
      }
      return { success: false };
    }),
  },
  requireAuth: vi.fn(),
  requireOnboarded: vi.fn(),
}));

vi.mock("@/lib/security/csrf", () => ({
  requireCsrf: vi.fn(),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  rateLimit: vi.fn(() => Promise.resolve({ allowed: true })),
  getRateLimitKey: vi.fn(() => "test-key"),
  buildRateLimitHeaders: vi.fn(() => ({})),
}));

vi.mock("@/lib/idempotency", () => ({
  requireIdempotencyKey: vi.fn(),
}));

import { requireAuth, requireOnboarded } from "@/lib/auth/policy";
import { requireCsrf } from "@/lib/security/csrf";
import { rateLimit } from "@/lib/security/rate-limit";
import { requireIdempotencyKey } from "@/lib/idempotency";

function createRequest(
  method: string,
  url: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...options.headers,
    },
  };

  if (options.body && method !== "GET") {
    init.body = JSON.stringify(options.body);
  }

  return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

describe("api/server", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: auth succeeds
    vi.mocked(requireAuth).mockResolvedValue({
      session: { user: { id: "user-1" } } as any,
      userId: "user-1",
    });

    vi.mocked(requireOnboarded).mockResolvedValue({
      session: { user: { id: "user-1" } } as any,
      userId: "user-1",
      handle: "alice",
    });

    // Default: CSRF passes
    vi.mocked(requireCsrf).mockResolvedValue(undefined);

    // Default: rate limit passes
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true } as any);
  });

  describe("okJson", () => {
    it("returns success envelope with data", async () => {
      const response = okJson({ id: "123", name: "Test" });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        ok: true,
        data: { id: "123", name: "Test" },
      });
    });

    it("sets Cache-Control: no-store by default", () => {
      const response = okJson({});
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it("preserves custom Cache-Control if set", () => {
      const response = okJson({}, { headers: { "Cache-Control": "max-age=60" } });
      expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    });
  });

  describe("errJson", () => {
    it("returns error envelope", async () => {
      const response = errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({
        ok: false,
        error: { code: "NOT_FOUND", message: "User not found", status: 404 },
      });
    });

    it("includes issues in error envelope", async () => {
      const response = errJson({
        code: "INVALID_REQUEST",
        message: "Validation failed",
        status: 400,
        issues: [{ path: ["name"], message: "Required" }],
      });
      const body = await response.json();

      expect(body.error.issues).toEqual([{ path: ["name"], message: "Required" }]);
    });
  });

  describe("api() - method validation", () => {
    it("rejects disallowed methods", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler, { methods: ["POST"] });

      const req = createRequest("DELETE", "/api/test");
      const response = await route(req);
      const body = await response.json();

      expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
      expect(handler).not.toHaveBeenCalled();
    });

    it("allows configured methods", async () => {
      const schema = z.object({ foo: z.string() });
      const handler = vi.fn().mockImplementation((ctx) => okJson({ foo: ctx.json.foo }));
      const route = api(schema, handler, { methods: ["GET"], auth: "public" });

      const req = createRequest("GET", "/api/test?foo=bar");
      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data.foo).toBe("bar");
    });
  });

  describe("api() - authentication", () => {
    it("requires auth by default", async () => {
      vi.mocked(requireAuth).mockRejectedValue({
        code: "AUTH_REQUIRED",
        message: "Sign in required",
        status: 401,
      });

      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", { body: {} });
      const response = await route(req);
      const body = await response.json();

      expect(body.error.code).toBe("AUTH_REQUIRED");
      expect(handler).not.toHaveBeenCalled();
    });

    it("skips auth for public routes", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockImplementation((ctx) => okJson({ viewerId: ctx.viewerId }));
      const route = api(schema, handler, { auth: "public" });

      const req = createRequest("POST", "/api/test", { body: {} });
      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data.viewerId).toBeNull();
    });

    it("provides handle for onboarded routes", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockImplementation((ctx) => okJson({ handle: ctx.handle }));
      const route = api(schema, handler, { auth: "onboarded" });

      const req = createRequest("POST", "/api/test", { body: {} });
      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data.handle).toBe("alice");
    });
  });

  describe("api() - CSRF validation", () => {
    it("validates CSRF for POST by default", async () => {
      vi.mocked(requireCsrf).mockRejectedValue({ status: 419, message: "Invalid CSRF token" });

      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", { body: {} });
      const response = await route(req);
      const body = await response.json();

      expect(body.error.code).toBe("CSRF_FAILED");
      expect(handler).not.toHaveBeenCalled();
    });

    it("skips CSRF when csrf: false", async () => {
      vi.mocked(requireCsrf).mockRejectedValue({ status: 419 });

      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler, { csrf: false });

      const req = createRequest("POST", "/api/test", { body: {} });
      await route(req);

      expect(requireCsrf).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalled();
    });

    it("skips CSRF for GET requests", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler, { methods: ["GET"], auth: "public" });

      const req = createRequest("GET", "/api/test");
      await route(req);

      expect(requireCsrf).not.toHaveBeenCalled();
    });
  });

  describe("api() - rate limiting", () => {
    it("rejects when rate limited", async () => {
      vi.mocked(rateLimit).mockResolvedValue({ allowed: false } as any);

      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", { body: {} });
      const response = await route(req);

      expect(response.status).toBe(429);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("api() - body parsing", () => {
    it("parses JSON body for POST", async () => {
      const schema = z.object({ name: z.string() });
      const handler = vi.fn().mockImplementation((ctx) => okJson({ name: ctx.json.name }));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", { body: { name: "Alice" } });
      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data.name).toBe("Alice");
    });

    it("rejects invalid JSON", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler);

      const req = new NextRequest("http://localhost:3000/api/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: "not json",
      });

      const response = await route(req);
      const body = await response.json();

      expect(body.error.code).toBe("INVALID_JSON");
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects non-JSON content type", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler);

      const req = new NextRequest("http://localhost:3000/api/test", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Origin: "http://localhost:3000",
        },
        body: "hello",
      });

      const response = await route(req);
      const body = await response.json();

      expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("api() - query parsing", () => {
    it("parses query params for GET", async () => {
      const schema = z.object({ name: z.string(), age: z.string() });
      const handler = vi.fn().mockImplementation((ctx) => okJson(ctx.json));
      const route = api(schema, handler, { methods: ["GET"], auth: "public" });

      const req = createRequest("GET", "/api/test?name=Alice&age=30");
      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data).toEqual({ name: "Alice", age: "30" });
    });
  });

  describe("api() - schema validation", () => {
    it("validates against schema", async () => {
      const schema = z.object({ name: z.string().min(1) });
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", { body: { name: "" } });
      const response = await route(req);
      const body = await response.json();

      expect(body.error.code).toBe("INVALID_REQUEST");
      expect(body.error.issues).toHaveLength(1);
      expect(body.error.issues[0].path).toEqual(["name"]);
      expect(handler).not.toHaveBeenCalled();
    });

    it("passes valid data", async () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const handler = vi.fn().mockImplementation((ctx) => okJson(ctx.json));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", { body: { name: "Alice", age: 30 } });
      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data).toEqual({ name: "Alice", age: 30 });
    });
  });

  describe("api() - idempotency", () => {
    it("extracts optional idempotency key", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockImplementation((ctx) => okJson({ key: ctx.idempotencyKey }));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", {
        body: {},
        headers: { "Idempotency-Key": "abc-123" },
      });

      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data.key).toBe("abc-123");
    });

    it("requires idempotency when configured", async () => {
      vi.mocked(requireIdempotencyKey).mockImplementation(() => {
        throw { status: 400, message: "Idempotency-Key required" };
      });

      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler, { requireIdempotency: true });

      const req = createRequest("POST", "/api/test", { body: {} });
      const response = await route(req);
      const body = await response.json();

      expect(body.error.code).toBe("IDEMPOTENCY_REQUIRED");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("api() - request ID", () => {
    it("uses X-Request-ID from header if present", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockImplementation((ctx) => okJson({ requestId: ctx.requestId }));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", {
        body: {},
        headers: { "X-Request-ID": "trace-abc-123" },
      });

      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data.requestId).toBe("trace-abc-123");
    });

    it("generates request ID if not in header", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockImplementation((ctx) => okJson({ requestId: ctx.requestId }));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", { body: {} });
      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data.requestId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });
  });

  describe("api() - If-Match header", () => {
    it("extracts If-Match header", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockImplementation((ctx) => okJson({ ifMatch: ctx.ifMatch }));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", {
        body: {},
        headers: { "If-Match": '"etag-123"' },
      });

      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data.ifMatch).toBe('"etag-123"');
    });
  });

  describe("api() - handler execution", () => {
    it("builds a route handler that returns context to handler", async () => {
      const schema = z.object({ name: z.string() });
      const handler = vi.fn().mockResolvedValue(okJson({ success: true }));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", { body: { name: "Alice" } });
      const response = await route(req);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          json: { name: "Alice" },
          viewerId: "user-1",
          authMode: "auth", // default auth mode
        }),
      );

      const body = await response.json();
      expect(body).toEqual({ ok: true, data: { success: true } });
    });

    it("includes authMode in context for observability", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockImplementation((ctx) => okJson({ authMode: ctx.authMode }));
      const route = api(schema, handler, { auth: "onboarded" });

      const req = createRequest("POST", "/api/test", { body: {} });
      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.data.authMode).toBe("onboarded");
    });

    it("returns error response without calling handler on validation failure", async () => {
      const schema = z.object({ name: z.string().min(1) });
      const handler = vi.fn();
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", { body: { name: "" } });
      const response = await route(req);

      expect(handler).not.toHaveBeenCalled();
      expect(response.status).toBe(400);
    });

    it("catches unexpected errors and returns 500", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockRejectedValue(new Error("Unexpected database error"));
      const route = api(schema, handler);

      const req = createRequest("POST", "/api/test", { body: {} });
      const response = await route(req);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).toBe("Internal server error");
    });
  });

  describe("api() - origin validation", () => {
    it("rejects requests without Origin header", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({}));
      const route = api(schema, handler);

      const req = new NextRequest("http://localhost:3000/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await route(req);
      const body = await response.json();

      expect(body.error.code).toBe("FORBIDDEN");
      expect(handler).not.toHaveBeenCalled();
    });

    it("allows custom origin allowlist", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({ success: true }));
      const route = api(schema, handler, { allowOrigins: ["https://trusted.com"] });

      const req = new NextRequest("http://localhost:3000/api/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://trusted.com",
        },
        body: JSON.stringify({}),
      });

      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
    });

    it("skips origin check when disabled", async () => {
      const schema = z.object({});
      const handler = vi.fn().mockResolvedValue(okJson({ success: true }));
      const route = api(schema, handler, { checkOrigin: false });

      const req = new NextRequest("http://localhost:3000/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await route(req);
      const body = await response.json();

      expect(body.ok).toBe(true);
    });
  });
});
