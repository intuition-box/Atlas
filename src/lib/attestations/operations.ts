/**
 * Attestation Database Operations
 *
 * CRUD operations for attestations using Prisma.
 * Handles soft-delete, supersession, and conflict resolution.
 */

import "server-only";

import { db } from "@/lib/db/client";
import type { AttestationType } from "./definitions";
import type { Result } from "@/lib/api/shapes";
import { ok, err } from "@/lib/api/shapes";

// ============================================================================
// Types
// ============================================================================

export type AttestationUser = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
};

export type Attestation = {
  id: string;
  fromUserId: string;
  toUserId: string;
  type: AttestationType;
  confidence: number | null;
  createdAt: Date;
  revokedAt: Date | null;
  supersededById: string | null;
  fromUser: AttestationUser;
  toUser: AttestationUser;
};

export type AttestationSummary = {
  id: string;
  type: AttestationType;
  confidence: number | null;
  createdAt: Date;
};

export type AttestationCounts = {
  given: number;
  received: number;
  givenByType: Record<AttestationType, number>;
  receivedByType: Record<AttestationType, number>;
};

export type AttestationError = {
  code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INVALID_REQUEST";
  message: string;
  status: number;
};

// ============================================================================
// Selects (reusable Prisma select objects)
// ============================================================================

const attestationUserSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  headline: true,
} as const;

const attestationSelect = {
  id: true,
  fromUserId: true,
  toUserId: true,
  type: true,
  confidence: true,
  createdAt: true,
  revokedAt: true,
  supersededById: true,
  fromUser: { select: attestationUserSelect },
  toUser: { select: attestationUserSelect },
} as const;

const attestationSummarySelect = {
  id: true,
  type: true,
  confidence: true,
  createdAt: true,
} as const;

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Get a single attestation by ID.
 */
export async function getAttestation(id: string): Promise<Attestation | null> {
  const row = await db.attestation.findUnique({
    where: { id },
    select: attestationSelect,
  });

  if (!row) return null;

  return {
    ...row,
    type: row.type as AttestationType,
  };
}

/**
 * Get the active attestation between two users for a specific type.
 * Returns null if no active attestation exists.
 */
export async function getActiveAttestation(
  fromUserId: string,
  toUserId: string,
  type: AttestationType,
): Promise<AttestationSummary | null> {
  const row = await db.attestation.findFirst({
    where: {
      fromUserId,
      toUserId,
      type,
      revokedAt: null,
      supersededById: null,
    },
    select: attestationSummarySelect,
  });

  if (!row) return null;

  return {
    ...row,
    type: row.type as AttestationType,
  };
}

/**
 * Check if an active attestation exists between two users for a specific type.
 */
export async function hasActiveAttestation(
  fromUserId: string,
  toUserId: string,
  type: AttestationType,
): Promise<boolean> {
  const count = await db.attestation.count({
    where: {
      fromUserId,
      toUserId,
      type,
      revokedAt: null,
      supersededById: null,
    },
  });

  return count > 0;
}

/**
 * Get all active attestation types from one user to another.
 * Useful for checking which attestations already exist.
 */
export async function getActiveAttestationTypes(
  fromUserId: string,
  toUserId: string,
): Promise<AttestationType[]> {
  const rows = await db.attestation.findMany({
    where: {
      fromUserId,
      toUserId,
      revokedAt: null,
      supersededById: null,
    },
    select: { type: true },
  });

  return rows.map((r) => r.type as AttestationType);
}

/**
 * Get attestations given by a user.
 */
export async function getAttestationsGiven(
  userId: string,
  opts?: {
    type?: AttestationType;
    includeRevoked?: boolean;
    take?: number;
    cursor?: string;
  },
): Promise<{ attestations: Attestation[]; nextCursor: string | null }> {
  const take = opts?.take ?? 50;

  const rows = await db.attestation.findMany({
    where: {
      fromUserId: userId,
      ...(opts?.type ? { type: opts.type } : {}),
      ...(opts?.includeRevoked ? {} : { revokedAt: null, supersededById: null }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: attestationSelect,
  });

  const hasMore = rows.length > take;
  const page = rows.slice(0, take);
  const nextCursor = hasMore ? page[page.length - 1]!.id : null;

  return {
    attestations: page.map((r) => ({ ...r, type: r.type as AttestationType })),
    nextCursor,
  };
}

/**
 * Get attestations received by a user.
 */
export async function getAttestationsReceived(
  userId: string,
  opts?: {
    type?: AttestationType;
    includeRevoked?: boolean;
    take?: number;
    cursor?: string;
  },
): Promise<{ attestations: Attestation[]; nextCursor: string | null }> {
  const take = opts?.take ?? 50;

  const rows = await db.attestation.findMany({
    where: {
      toUserId: userId,
      ...(opts?.type ? { type: opts.type } : {}),
      ...(opts?.includeRevoked ? {} : { revokedAt: null, supersededById: null }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: attestationSelect,
  });

  const hasMore = rows.length > take;
  const page = rows.slice(0, take);
  const nextCursor = hasMore ? page[page.length - 1]!.id : null;

  return {
    attestations: page.map((r) => ({ ...r, type: r.type as AttestationType })),
    nextCursor,
  };
}

/**
 * Get attestation counts for a user (for profile summary).
 */
export async function getAttestationCounts(userId: string): Promise<AttestationCounts> {
  const [givenRows, receivedRows] = await Promise.all([
    db.attestation.groupBy({
      by: ["type"],
      where: {
        fromUserId: userId,
        revokedAt: null,
        supersededById: null,
      },
      _count: { _all: true },
    }),
    db.attestation.groupBy({
      by: ["type"],
      where: {
        toUserId: userId,
        revokedAt: null,
        supersededById: null,
      },
      _count: { _all: true },
    }),
  ]);

  const givenByType = {} as Record<AttestationType, number>;
  const receivedByType = {} as Record<AttestationType, number>;

  let given = 0;
  let received = 0;

  for (const row of givenRows) {
    const type = row.type as AttestationType;
    givenByType[type] = row._count._all;
    given += row._count._all;
  }

  for (const row of receivedRows) {
    const type = row.type as AttestationType;
    receivedByType[type] = row._count._all;
    received += row._count._all;
  }

  return { given, received, givenByType, receivedByType };
}

// ============================================================================
// Write Operations
// ============================================================================

/**
 * Create or update an attestation.
 * If an active attestation of the same type already exists:
 * - If confidence matches, returns existing (idempotent)
 * - If confidence differs, supersedes existing with new one
 */
export async function createAttestation(
  fromUserId: string,
  toUserId: string,
  type: AttestationType,
  confidence?: number | null,
): Promise<Result<{ attestation: AttestationSummary; alreadyExists: boolean }, AttestationError>> {
  const normalizedConfidence = confidence ?? null;

  // Wrap the entire read+write in a serializable transaction to prevent
  // duplicate active attestations from concurrent requests.
  return db.$transaction(async (tx) => {
    const existing = await tx.attestation.findFirst({
      where: {
        fromUserId,
        toUserId,
        type,
        revokedAt: null,
        supersededById: null,
      },
      select: { id: true, type: true, confidence: true, createdAt: true },
    });

    // Idempotent: return existing if same confidence
    if (existing) {
      if (existing.confidence === normalizedConfidence) {
        return ok({
          attestation: { ...existing, type: existing.type as AttestationType },
          alreadyExists: true,
        });
      }

      // Supersede existing
      const replacement = await tx.attestation.create({
        data: {
          fromUserId,
          toUserId,
          type,
          confidence: normalizedConfidence,
        },
        select: attestationSummarySelect,
      });

      await tx.attestation.update({
        where: { id: existing.id },
        data: { supersededById: replacement.id },
      });

      return ok({
        attestation: { ...replacement, type: replacement.type as AttestationType },
        alreadyExists: false,
      });
    }

    // Create new
    const created = await tx.attestation.create({
      data: {
        fromUserId,
        toUserId,
        type,
        confidence: normalizedConfidence,
      },
      select: attestationSummarySelect,
    });

    return ok({
      attestation: { ...created, type: created.type as AttestationType },
      alreadyExists: false,
    });
  }, { isolationLevel: "Serializable" });
}

/**
 * Retract (soft-delete) an attestation.
 * Only the author can retract their own attestation.
 */
export async function retractAttestation(
  attestationId: string,
  viewerId: string,
  reason?: string,
): Promise<Result<{ alreadyRevoked: boolean }, AttestationError>> {
  return db.$transaction(async (tx) => {
    const row = await tx.attestation.findUnique({
      where: { id: attestationId },
      select: {
        id: true,
        fromUserId: true,
        revokedAt: true,
        supersededById: true,
      },
    });

    if (!row) {
      return err({ code: "NOT_FOUND", message: "Attestation not found", status: 404 });
    }

    if (row.revokedAt) {
      return ok({ alreadyRevoked: true });
    }

    if (row.supersededById) {
      return err({
        code: "CONFLICT",
        message: "Attestation can't be removed (superseded)",
        status: 409,
      });
    }

    if (row.fromUserId !== viewerId) {
      return err({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
    }

    await tx.attestation.update({
      where: { id: row.id },
      data: {
        revokedAt: new Date(),
        revokedByUserId: viewerId,
        revokedReason: reason ?? null,
      },
    });

    return ok({ alreadyRevoked: false });
  });
}

/**
 * Supersede an attestation with updated values.
 * Only the author can supersede their own attestation.
 */
export async function supersedeAttestation(
  attestationId: string,
  viewerId: string,
  changes: { confidence?: number | null },
): Promise<Result<{ attestation: AttestationSummary; supersedesId: string }, AttestationError>> {
  if (changes.confidence === undefined) {
    return err({
      code: "INVALID_REQUEST",
      message: "Nothing to change",
      status: 400,
    });
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.attestation.findUnique({
      where: { id: attestationId },
      select: {
        id: true,
        fromUserId: true,
        toUserId: true,
        type: true,
        confidence: true,
        revokedAt: true,
        supersededById: true,
      },
    });

    if (!existing) {
      return err({ code: "NOT_FOUND", message: "Attestation not found", status: 404 });
    }

    if (existing.revokedAt) {
      return err({ code: "CONFLICT", message: "Attestation is revoked", status: 409 });
    }

    if (existing.supersededById) {
      return err({
        code: "CONFLICT",
        message: "Attestation is already superseded",
        status: 409,
      });
    }

    if (existing.fromUserId !== viewerId) {
      return err({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
    }

    const nextConfidence = changes.confidence === null ? null : changes.confidence;

    // No-op check
    if (nextConfidence === (existing.confidence ?? null)) {
      return err({
        code: "INVALID_REQUEST",
        message: "Nothing to change",
        status: 400,
      });
    }

    const replacement = await tx.attestation.create({
      data: {
        fromUserId: existing.fromUserId,
        toUserId: existing.toUserId,
        type: existing.type,
        confidence: nextConfidence,
      },
      select: attestationSummarySelect,
    });

    await tx.attestation.update({
      where: { id: existing.id },
      data: { supersededById: replacement.id },
    });

    return ok({
      attestation: { ...replacement, type: replacement.type as AttestationType },
      supersedesId: existing.id,
    });
  });
}
