import { Router } from "express";
import { authLimiter } from "../middleware/rateLimiter";
import { validate } from "../middleware/validate";
import { authenticate } from "../middleware/auth";
import {
  register,
  login,
  refresh,
  logout,
  me,
  registerSchema,
  loginSchema,
  refreshSchema,
} from "../controllers/authController";
import { AuthRequest } from "../types";

const router = Router();

router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/refresh", authLimiter, validate(refreshSchema), refresh);
router.post("/logout", authenticate as never, logout as never);
router.get("/me", authenticate as never, (req, res, next) =>
  me(req as AuthRequest, res, next)
);

export default router;
