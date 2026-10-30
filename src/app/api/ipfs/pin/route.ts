import "server-only";

import { pinThing } from "@0xintuition/sdk";
import { z } from "zod";

import { api, errJson, okJson } from "@/lib/api/server";

export const runtime = "nodejs";

/**
 * Pin Thing metadata to IPFS. The Intuition pinning endpoint is API-key gated,
 * so pinning is proxied here to keep INTUITION_PIN_API_KEY off the client.
 */
const BodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  image: z.string().max(2048).optional(),
  url: z.string().max(2048).optional(),
});

type PinOk = { uri: string };

export const POST = api(BodySchema, async (ctx) => {
  const pinApiKey = process.env.INTUITION_PIN_API_KEY;
  if (!pinApiKey) {
    console.error("[ipfs/pin] INTUITION_PIN_API_KEY is not set", { requestId: ctx.requestId });
    return errJson({ code: "PIN_UNAVAILABLE", message: "IPFS pinning is not configured", status: 503 });
  }

  try {
    const uri = await pinThing(ctx.json, {
      pinApiKey,
      pinApiUrl: process.env.INTUITION_PIN_API_URL || undefined,
    });
    return okJson<PinOk>({ uri });
  } catch (error) {
    console.error("[ipfs/pin] pin failed", {
      requestId: ctx.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errJson({ code: "PIN_FAILED", message: "Failed to pin to IPFS", status: 502 });
  }
}, { auth: "auth" });
