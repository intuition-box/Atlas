/**
 * Security events
 *
 * This module is client-safe and provides the canonical vocabulary + presentation
 * metadata for security/account events shown in user preferences.
 *
 * Principles:
 * - Strong, typed event codes (string literal unions)
 * - A single source of truth for category/level/title/description
 * - Graceful handling of unknown future codes
 */

export type SecurityEventCode =
  // MFA: TOTP
  | "mfa.totp.enabled"
  | "mfa.totp.disabled"
  // MFA: passkeys
  | "mfa.passkey.registered"
  | "mfa.passkey.removed"
  // MFA: backup codes
  | "mfa.backup.generated"
  | "mfa.backup.used"
  // Devices
  | "device.new"
  | "device.revoked"
  // Sessions
  | "session.revoked_all"
  // Auth / login (high-level)
  | "login"
  | "new_device"
  | "mfa_change"
  | "backup_codes"
  // Account / spaces
  | "account_deletion"
  | "space_deletion";

export type SecurityEventCategory =
  | "auth"
  | "mfa"
  | "device"
  | "session"
  | "account"
  | "space";

export type SecurityEventLevel = "info" | "warning" | "critical";

export type SecurityEventDefinition = {
  code: SecurityEventCode;
  category: SecurityEventCategory;
  level: SecurityEventLevel;
  /** Short label suitable for a list row. */
  title: string;
  /** Optional longer explanation shown in details panels. */
  description?: string;
};

/**
 * A minimal shape that UI and API routes can share.
 *
 * Store identity as IDs (userId/communityId). Handles are display/routing only.
 */
export type SecurityEvent = {
  id: string;
  code: string; // allow forward-compatible codes from the server
  createdAt: Date | string;

  actorUserId?: string | null;
  targetUserId?: string | null;
  communityId?: string | null;

  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;

  /** Free-form structured metadata, if needed. Keep it small. */
  meta?: Record<string, unknown> | null;
};

export const SECURITY_EVENT_DEFINITIONS: Record<SecurityEventCode, SecurityEventDefinition> = {
  // MFA: TOTP
  "mfa.totp.enabled": {
    code: "mfa.totp.enabled",
    category: "mfa",
    level: "info",
    title: "Authenticator enabled",
    description: "Time-based one-time password (TOTP) was enabled.",
  },
  "mfa.totp.disabled": {
    code: "mfa.totp.disabled",
    category: "mfa",
    level: "warning",
    title: "Authenticator disabled",
    description: "Time-based one-time password (TOTP) was disabled.",
  },

  // MFA: passkeys
  "mfa.passkey.registered": {
    code: "mfa.passkey.registered",
    category: "mfa",
    level: "info",
    title: "Passkey added",
    description: "A new passkey was registered.",
  },
  "mfa.passkey.removed": {
    code: "mfa.passkey.removed",
    category: "mfa",
    level: "warning",
    title: "Passkey removed",
    description: "A passkey was removed.",
  },

  // MFA: backup codes
  "mfa.backup.generated": {
    code: "mfa.backup.generated",
    category: "mfa",
    level: "info",
    title: "Backup codes generated",
    description: "New backup codes were generated.",
  },
  "mfa.backup.used": {
    code: "mfa.backup.used",
    category: "mfa",
    level: "warning",
    title: "Backup code used",
    description: "A backup code was used to complete authentication.",
  },

  // Devices
  "device.new": {
    code: "device.new",
    category: "device",
    level: "warning",
    title: "New device",
    description: "A new device was associated with your account.",
  },
  "device.revoked": {
    code: "device.revoked",
    category: "device",
    level: "warning",
    title: "Device revoked",
    description: "A remembered device was revoked.",
  },

  // Sessions
  "session.revoked_all": {
    code: "session.revoked_all",
    category: "session",
    level: "critical",
    title: "All sessions revoked",
    description: "All active sessions were revoked.",
  },

  // High-level legacy / UI-friendly grouping codes
  "login": {
    code: "login",
    category: "auth",
    level: "info",
    title: "Login",
    description: "A login occurred.",
  },
  "new_device": {
    code: "new_device",
    category: "device",
    level: "warning",
    title: "New device",
    description: "A login from a new device occurred.",
  },
  "mfa_change": {
    code: "mfa_change",
    category: "mfa",
    level: "warning",
    title: "MFA changed",
    description: "Multi-factor authentication settings changed.",
  },
  "backup_codes": {
    code: "backup_codes",
    category: "mfa",
    level: "warning",
    title: "Backup codes",
    description: "Backup codes were managed.",
  },

  // Account / spaces
  "account_deletion": {
    code: "account_deletion",
    category: "account",
    level: "critical",
    title: "Account deletion",
    description: "An account deletion action occurred.",
  },
  "space_deletion": {
    code: "space_deletion",
    category: "space",
    level: "critical",
    title: "Space deletion",
    description: "A space/community deletion action occurred.",
  },
};

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(SECURITY_EVENT_DEFINITIONS));

export function isSecurityEventCode(code: string): code is SecurityEventCode {
  return KNOWN_CODES.has(code);
}

export function getSecurityEventDefinition(code: string): SecurityEventDefinition | null {
  return isSecurityEventCode(code) ? SECURITY_EVENT_DEFINITIONS[code] : null;
}

export function securityEventTitle(code: string): string {
  return getSecurityEventDefinition(code)?.title ?? "Security event";
}

export function securityEventCategory(code: string): SecurityEventCategory {
  return getSecurityEventDefinition(code)?.category ?? "auth";
}

export function securityEventLevel(code: string): SecurityEventLevel {
  return getSecurityEventDefinition(code)?.level ?? "info";
}

/**
 * UI helper: normalize an event into display-friendly fields.
 * Does not format dates (leave that to the view layer).
 */
export function presentSecurityEvent(e: SecurityEvent): {
  title: string;
  description?: string;
  category: SecurityEventCategory;
  level: SecurityEventLevel;
} {
  const def = getSecurityEventDefinition(e.code);
  return {
    title: def?.title ?? "Security event",
    description: def?.description,
    category: def?.category ?? "auth",
    level: def?.level ?? "info",
  };
}
