import { db } from '@/lib/database';
import { logger } from '@/lib/logger';
import { serverEnv as env } from '@/lib/env-server';
import { sendEmail } from '@/lib/mail';

type SecurityEventType =
  | 'mfa.totp.enabled'
  | 'mfa.totp.disabled'
  | 'mfa.passkey.registered'
  | 'mfa.passkey.removed'
  | 'mfa.backup.generated'
  | 'mfa.backup.used'
  | 'device.new'
  | 'device.revoked'
  | 'session.revoked_all';

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
        metadata: input.metadata as any,
      },
    });
  } catch (e) {
    logger.warn(e as any, 'security.event.write_failed', input);
  }
}

export type NotificationCategory = 'login' | 'new_device' | 'mfa_change' | 'backup_codes' | 'account_deletion' | 'space_deletion';

async function shouldNotifyEmail(userId: string, cat: NotificationCategory): Promise<boolean> {
  if (env.SECURITY_EMAIL_NOTIFICATIONS !== 'true') return false; // globally off
  try {
    const prefs = await db.userSecurityPrefs.findUnique({ where: { userId } });
    if (!prefs) return true; // default on
    if (cat === 'login') return prefs.emailOnLogin;
    if (cat === 'new_device') return prefs.emailOnNewDevice;
    if (cat === 'mfa_change') return prefs.emailOnMfaChange;
    if (cat === 'backup_codes') return prefs.emailOnBackupCodes;
    if (cat === 'account_deletion') return true;
    if (cat === 'space_deletion') return true;
  } catch {}
  return true;
}

export async function notifyUser(userId: string, category: NotificationCategory, subject: string, html: string, text: string) {
  if (!(await shouldNotifyEmail(userId, category))) return;
  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!u?.email) return;
    await sendEmail({ to: u.email, subject, html, text });
  } catch (e) {
    logger.warn(e as any, 'security.email.notify_failed', { userId, subject });
  }
}

export async function notifyUsers(userIds: string[], category: NotificationCategory, subject: string, html: string, text: string) {
  for (const id of userIds) {
    try { await notifyUser(id, category, subject, html, text); } catch {}
  }
}
