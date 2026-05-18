import { Request } from "express";
import { JwtPayload } from "../lib/jwt";

export interface AuthRequest extends Request {
  user: JwtPayload;
}
