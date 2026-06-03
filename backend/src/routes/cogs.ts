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

// Every route requires a valid JWT.
router.use(authenticate as never);

// GET is used by form dropdowns for any authenticated user whose restaurant
// belongs to an owner account — ADMIN, STAFF, and owner roles all need it.
router.get("/", listCogsCategories as never);

// Mutations are restricted to the owner or Kyru manager.
router.post("/",    requireOwnerOrKyruManager as never, validate(createCogsCategorySchema), createCogsCategory as never);
router.put("/:id",  requireOwnerOrKyruManager as never, validate(updateCogsCategorySchema), updateCogsCategory as never);
router.delete("/:id", requireOwnerOrKyruManager as never, deleteCogsCategory as never);

export default router;
