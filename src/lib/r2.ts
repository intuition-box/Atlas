import "server-only";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
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
  const ct = contentType.trim();
  if (!ct) throw new Error("Invalid contentType: empty");
  // Prevent header injection
  if (/\r|\n/.test(ct)) throw new Error("Invalid contentType");
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
  const base = requireEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
  return `${base}/${key.replace(/^\/+/, "")}`;
}

export async function signR2Upload(params: {
  key: string;
  contentType: string;
  cacheControl?: string;
  expiresInSeconds?: number;
}) {
  assertSafeKey(params.key);
  assertSafeContentType(params.contentType);

  const bucket = requireEnv("R2_BUCKET");
  const client = r2Client();

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ContentType: params.contentType,
    CacheControl: params.cacheControl ?? "public, max-age=31536000, immutable",
  });

  const uploadUrl = await getSignedUrl(client, cmd, {
    expiresIn: params.expiresInSeconds ?? 60,
  });

  const publicUrl = buildPublicUrl(params.key);
  return { uploadUrl, publicUrl };
}