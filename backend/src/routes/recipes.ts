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

router.get(   "/",    listRecipes);
router.get(   "/:id", getRecipe);
router.post(  "/",    createRecipe);
router.put(   "/:id", updateRecipe);
router.delete("/:id", deleteRecipe);

export default router;
