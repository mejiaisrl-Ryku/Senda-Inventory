import { Router } from "express";
import { authenticate, requireOwnerOrKyruManager } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  listCogsCategories,
  createCogsCategory,
  updateCogsCategory,
  deleteCogsCategory,
  createCogsCategorySchema,
  updateCogsCategorySchema,
} from "../controllers/cogsController";

const router = Router();

// All COGS category routes require an authenticated owner (or Kyru manager)
router.use(authenticate as never);
router.use(requireOwnerOrKyruManager as never);

router.get("/",     listCogsCategories as never);
router.post("/",    validate(createCogsCategorySchema), createCogsCategory as never);
router.put("/:id",  validate(updateCogsCategorySchema), updateCogsCategory as never);
router.delete("/:id", deleteCogsCategory as never);

export default router;
