import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import {
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  deleteRecipe,
} from "../controllers/recipeController";

const router = Router();

// All recipe endpoints require authentication + admin role
router.use(authenticate  as never);
router.use(requireAdmin  as never);

router.get(   "/",    listRecipes  as never);
router.get(   "/:id", getRecipe    as never);
router.post(  "/",    createRecipe as never);
router.put(   "/:id", updateRecipe as never);
router.delete("/:id", deleteRecipe as never);

export default router;
