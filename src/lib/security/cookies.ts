import "server-only";

import crypto from "node:crypto";

import { cookies } from "next/headers";

import { serverEnv as env, isProd } from "@/lib/env-server";

const COOKIE_NAME = "orbyt_mfa";

async function cookieStore() {
  return await cookies();
}

function sign(input: string): string {
  const h = crypto.createHmac("sha256", env.AUTH_SECRET).update(input).digest("base64url");
  return `${input}.${h}`;
}

function verify(signed: string): string | null {
  const i = signed.lastIndexOf(".");
  if (i <= 0) return null;

  const raw = signed.slice(0, i);
  const expected = sign(raw);

  const a = Buffer.from(expected);
  const b = Buffer.from(signed);

  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? raw : null;
}

export type RememberToken = {
  did: string; // device id
  uid: string; // user id
  exp: number; // epoch seconds
  iat: number; // epoch seconds
};

export function createRememberToken(payload: RememberToken): string {
  const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return sign(raw);
}

export function parseRememberToken(token: string): RememberToken | null {
  const raw = verify(token);
  if (!raw) return null;
  try {
    const obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as RememberToken;
    if (typeof obj.did !== "string" || typeof obj.uid !== "string") return null;
    if (typeof obj.exp !== "number" || typeof obj.iat !== "number") return null;
    if (obj.exp <= Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch {
    return null;
  }
}

export async function setRememberCookie(token: string) {
  const maxAge = 60 * 60 * 24 * 30; // 30 days
  const store = await cookieStore();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function getRememberCookie(): Promise<string | undefined> {
  const store = await cookieStore();
  return store.get(COOKIE_NAME)?.value;
}

export async function clearRememberCookie() {
  const store = await cookieStore();
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
