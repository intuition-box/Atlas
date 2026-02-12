import { HandleOwnerType } from "@prisma/client";
import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import {
  checkHandle,
  checkHandlePubliclyAvailable,
} from "@/lib/handle-registry";

export const runtime = "nodejs";

const QuerySchema = z.object({
  handle: z.string().trim().min(1),
  ownerType: z.enum(["USER", "COMMUNITY"]),
  ownerId: z.string().trim().min(1).optional(),
});

type CheckHandleOk = {
  available: true;
  handle: string;
};

export const GET = api(QuerySchema, async (ctx) => {
  const { handle, ownerType, ownerId } = ctx.json;

  const result = ownerId
    ? await checkHandle({
        handle,
        owner: { ownerType: ownerType as HandleOwnerType, ownerId },
      })
    : await checkHandlePubliclyAvailable({ handle });

  if (!result.ok) {
    return errJson({
      code: result.error.code,
      message: result.error.message,
      status: result.error.status,
      ...(result.error.meta ? { meta: result.error.meta } : {}),
    });
  }

  return okJson<CheckHandleOk>({
    available: true,
    handle: result.value.handle,
  });
}, { methods: ["GET"], auth: "auth" });
