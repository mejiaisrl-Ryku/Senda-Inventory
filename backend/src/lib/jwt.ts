import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

const SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
if (!SECRET) throw new Error("JWT_SECRET is not set");
if (!REFRESH_SECRET) throw new Error("JWT_REFRESH_SECRET is not set");

const EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "7d";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? "30d";

// Payload deliberately minimal — no PII beyond what's needed for authz.
export interface JwtPayload {
  userId: string;
  role: Role;
  restaurantId: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET!, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET!) as JwtPayload;
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, REFRESH_SECRET!, { expiresIn: REFRESH_EXPIRES_IN });
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, REFRESH_SECRET!) as JwtPayload;
}
