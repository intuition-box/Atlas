import "server-only";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function getOptionalEnv(name: string) {
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
}

function assertSafeHeaderValue(name: string, value: string) {
  const v = value.trim();
  if (!v) throw new Error(`Invalid ${name}: empty`);
  // Prevent header injection
  if (/\r|\n/.test(v)) throw new Error(`Invalid ${name}`);
  // Prevent other ASCII control chars
  if (/[\u0000-\u001F\u007F]/.test(v)) throw new Error(`Invalid ${name}`);
}

function assertSafeKey(key: string) {
  const k = key.trim();
  if (!k) throw new Error("Invalid key: empty");
  if (k.startsWith("/")) throw new Error("Invalid key: must not start with '/'");
  if (k.includes("..")) throw new Error("Invalid key: must not contain '..'");
  if (k.length > 512) throw new Error("Invalid key: too long");

  // Allow common safe characters for object keys.
  // (Avoid spaces/control chars that can cause header/path confusion.)
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(k)) {
    throw new Error("Invalid key: contains unsupported characters");
  }
}

function assertSafeContentType(contentType: string) {
  assertSafeHeaderValue("contentType", contentType);
}

function assertSafeCacheControl(cacheControl: string) {
  assertSafeHeaderValue("cacheControl", cacheControl);
}

function assertSafeExpiresIn(expiresInSeconds: number) {
  if (!Number.isFinite(expiresInSeconds)) throw new Error("Invalid expiresInSeconds");
  // Keep presigned URLs short-lived; R2/S3 allow longer, but we standardize.
  if (expiresInSeconds < 10 || expiresInSeconds > 900) {
    throw new Error("Invalid expiresInSeconds: must be between 10 and 900");
  }
}

// Turbopack-safe singleton
const globalForR2 = globalThis as unknown as { __r2?: S3Client };

function r2Client() {
  if (globalForR2.__r2) return globalForR2.__r2;

  const endpoint = requireEnv("R2_ENDPOINT");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");

  // Cloudflare R2: region "auto" is commonly used with S3-compatible APIs.
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  globalForR2.__r2 = client;
  return client;
}

export function buildPublicUrl(key: string) {
  assertSafeKey(key);
  const k = key.trim().replace(/^\/+/, "");

  // Public base URL is OPTIONAL.
  // It should point to a publicly-accessible bucket/custom domain where objects can be fetched
  // without signing (e.g. your custom CDN domain or an R2 public bucket URL).
  const baseRaw = getOptionalEnv("R2_PUBLIC_BASE_URL");
  if (!baseRaw) return undefined;

  const base = baseRaw.replace(/\/+$/, "");
  return `${base}/${k}`;
}


export async function putR2Object(params: {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
}) {
  assertSafeKey(params.key);
  assertSafeContentType(params.contentType);
  if (params.cacheControl) assertSafeCacheControl(params.cacheControl);

  const bucket = requireEnv("R2_BUCKET");
  const client = r2Client();

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    Body: params.body,
    ContentType: params.contentType,
    CacheControl: params.cacheControl ?? "public, max-age=31536000, immutable",
  });

  await client.send(cmd);

  const publicUrl = buildPublicUrl(params.key);
  return { key: params.key, publicUrl };
}

/**
 * Fetches an external image URL and uploads it to R2.
 * Returns the R2 public URL, or null if the fetch/upload fails.
 */
export async function mirrorUrlToR2(params: {
  url: string;
  key: string;
}): Promise<string | null> {
  try {
    const res = await fetch(params.url, { redirect: "follow" });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "image/png";
    const body = new Uint8Array(await res.arrayBuffer());
    if (body.length === 0) return null;

    const result = await putR2Object({
      key: params.key,
      body,
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    });

    return result.publicUrl ?? null;
  } catch {
    return null;
  }
}

export async function signR2Upload(params: {
  key: string;
  contentType: string;
  cacheControl?: string;
  expiresInSeconds?: number;
}) {
  assertSafeKey(params.key);
  assertSafeContentType(params.contentType);
  if (params.cacheControl) assertSafeCacheControl(params.cacheControl);
  const expiresIn = params.expiresInSeconds ?? 60;
  assertSafeExpiresIn(expiresIn);

  const bucket = requireEnv("R2_BUCKET");
  const client = r2Client();

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ContentType: params.contentType,
    CacheControl: params.cacheControl ?? "public, max-age=31536000, immutable",
  });

  const uploadUrl = await getSignedUrl(client, cmd, { expiresIn });

  const publicUrl = buildPublicUrl(params.key);
  return { uploadUrl, publicUrl };
}