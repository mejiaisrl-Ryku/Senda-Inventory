import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createLabor, listLabor, deleteLabor, createLaborSchema } from "../controllers/laborController";

const router = Router();

router.use(authenticate as never);
router.use(requireAdmin as never);

router.get("/", listLabor as never);
router.post("/", validate(createLaborSchema), createLabor as never);
router.delete("/:id", deleteLabor as never);

export default router;
