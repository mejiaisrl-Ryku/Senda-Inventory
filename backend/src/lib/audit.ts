/**
 * Audit logging helper.
 *
 * Writes an append-only record to the audit_logs table for every sensitive or
 * irreversible action (hard deletes, owner-account changes, cross-tenant admin
 * access).
 *
 * Design decisions:
 * - Uses `prisma` (superuser client) — the AuditLog table has no RLS policy
 *   (it is a platform-level table, not tenant-scoped) so the app-role client
 *   would fail to INSERT.
 * - Caller is responsible for pre-scrubbing `metadata` — never pass raw request
 *   bodies or financial records.
 * - `logAudit` never throws — a failed audit write logs an error but does NOT
 *   roll back the original operation (audit failure ≠ operation failure).
 *   If your operation requires a guaranteed audit trail, wrap both in a
 *   transaction instead of using this helper.
 */

import { prisma } from "./prisma";
import logger from "../utils/logger";
import { getRequestId } from "../middleware/requestId";
import { Request } from "express";

export type AuditAction =
  | "restaurant.hard_delete"
  | "restaurant.location_delete"
  | "owner_account.hard_delete"
  | "owner_account.archive"
  | "user.role_change"
  | "kyru_manager.login"
  | "kyru_manager.cross_tenant_read"
  | "partner.onboard"
  | "partner.invite_create";

export interface AuditOptions {
  action:     AuditAction;
  actorId:    string | null;
  actorRole:  string | null;
  targetType: string;
  targetId:   string;
  /** Pre-scrubbed key/value context.  Must NOT contain PII or financial data. */
  metadata?:  Record<string, unknown>;
  /** Express request — used to extract IP and request ID. */
  req?:       Pick<Request, "ip"> | null;
}

/**
 * Write an audit log entry.  Fire-and-forget — never awaited on the hot path.
 *
 * Usage:
 *   void logAudit({ action: "restaurant.hard_delete", actorId, actorRole, targetType: "restaurant", targetId: id, req });
 */
export async function logAudit(opts: AuditOptions): Promise<void> {
  const requestId = getRequestId();

  try {
    await (prisma as unknown as {
      auditLog: {
        create: (args: {
          data: {
            actorId:    string | null;
            actorRole:  string | null;
            action:     string;
            targetType: string;
            targetId:   string;
            metadata:   Record<string, unknown> | undefined;
            requestId:  string;
            ipAddress:  string | null;
          };
        }) => Promise<unknown>;
      };
    }).auditLog.create({
      data: {
        actorId:    opts.actorId,
        actorRole:  opts.actorRole,
        action:     opts.action,
        targetType: opts.targetType,
        targetId:   opts.targetId,
        metadata:   opts.metadata,
        requestId,
        ipAddress:  opts.req?.ip ?? null,
      },
    });

    // Mirror to structured log for real-time alerting (e.g. Railway log drain).
    logger.warn({
      event:      "audit",
      action:     opts.action,
      actorId:    opts.actorId,
      actorRole:  opts.actorRole,
      targetType: opts.targetType,
      targetId:   opts.targetId,
      requestId,
    });
  } catch (err) {
    // Audit failure must never crash the original operation.
    logger.error({
      event:   "audit_write_failed",
      action:  opts.action,
      error:   (err as Error).message,
      requestId,
    });
  }
}
