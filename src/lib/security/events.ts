import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/database";
import { serverEnv as env } from "@/lib/env-server";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/mail";

type SecurityEventType =
  | "mfa.totp.enabled"
  | "mfa.totp.disabled"
  | "mfa.passkey.registered"
  | "mfa.passkey.removed"
  | "mfa.backup.generated"
  | "mfa.backup.used"
  | "device.new"
  | "device.revoked"
  | "session.revoked_all";

export async function recordSecurityEvent(input: {
  userId: string;
  type: SecurityEventType;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
}) {
  try {
    await db.securityEvent.create({
      data: {
        userId: input.userId,
        type: input.type,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        // Prisma JSON fields expect InputJsonValue/JsonNull. Treat missing metadata as null.
        metadata: (input.metadata ?? null) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.warn({ err, input }, "security.event.write_failed");
  }
}

export type NotificationCategory =
  | "login"
  | "new_device"
  | "mfa_change"
  | "backup_codes"
  | "account_deletion"
  | "space_deletion";

async function shouldNotifyEmail(userId: string, cat: NotificationCategory): Promise<boolean> {
  // Globally off.
  if (env.SECURITY_EMAIL_NOTIFICATIONS !== "true") return false;

  try {
    const prefs = await db.userSecurityPrefs.findUnique({ where: { userId } });
    if (!prefs) return true; // default on

    if (cat === "login") return prefs.emailOnLogin;
    if (cat === "new_device") return prefs.emailOnNewDevice;
    if (cat === "mfa_change") return prefs.emailOnMfaChange;
    if (cat === "backup_codes") return prefs.emailOnBackupCodes;

    // High-signal categories: always notify.
    if (cat === "account_deletion") return true;
    if (cat === "space_deletion") return true;
  } catch {
    // If we can't read prefs, fail open (notify) rather than silently dropping alerts.
  }

  return true;
}

export async function notifyUser(
  userId: string,
  category: NotificationCategory,
  subject: string,
  html: string,
  text: string,
) {
  if (!(await shouldNotifyEmail(userId, category))) return;

  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!u?.email) return;

    await sendEmail({ to: u.email, subject, html, text });
  } catch (err) {
    logger.warn({ err, userId, subject }, "security.email.notify_failed");
  }
}

export async function notifyUsers(
  userIds: string[],
  category: NotificationCategory,
  subject: string,
  html: string,
  text: string,
) {
  // Intentionally sequential to avoid tripping provider rate limits.
  for (const id of userIds) {
    try {
      await notifyUser(id, category, subject, html, text);
    } catch {
      // swallow
    }
  }
}
