import jwt, { SignOptions } from "jsonwebtoken";
import { Role } from "@prisma/client";

// Throws at startup if a required env var is absent — fails fast before any request is served.
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

const SECRET = requireEnv("JWT_SECRET");
const REFRESH_SECRET = requireEnv("JWT_REFRESH_SECRET");

// Cast to SignOptions["expiresIn"] (number | StringValue) — the ms library uses a branded
// string type so plain `string` isn't assignable without the assertion.
const EXPIRES_IN = (process.env.JWT_EXPIRES_IN ?? "7d") as SignOptions["expiresIn"];
const REFRESH_EXPIRES_IN = (process.env.JWT_REFRESH_EXPIRES_IN ?? "30d") as SignOptions["expiresIn"];

// Payload deliberately minimal — no PII beyond what's needed for authz.
export interface JwtPayload {
  userId: string;
  role: Role;
  restaurantId: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, REFRESH_SECRET) as JwtPayload;
}

// ── Invite tokens ─────────────────────────────────────────────────────────────

export interface InvitePayload {
  purpose: "invite";
  restaurantId: string;
  restaurantName: string;
  role: "STAFF" | "ADMIN";
  email: string;
}

/** Short-lived invite link token — signed with the same secret as access tokens. */
export function signInviteToken(
  data: Omit<InvitePayload, "purpose">
): string {
  return jwt.sign({ ...data, purpose: "invite" }, SECRET, {
    expiresIn: "7d" as SignOptions["expiresIn"],
  });
}

export function verifyInviteToken(token: string): InvitePayload {
  const decoded = jwt.verify(token, SECRET) as InvitePayload;
  if (decoded.purpose !== "invite") throw new Error("Invalid token purpose");
  return decoded;
}
