import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  deleteRecipe,
} from "../controllers/recipeController";

const router = Router();

// All recipe endpoints require authentication; no admin restriction —
// every logged-in user can view and manage recipes.
router.use(authenticate as never);

router.get(   "/",    listRecipes  as never);
router.get(   "/:id", getRecipe    as never);
router.post(  "/",    createRecipe as never);
router.put(   "/:id", updateRecipe as never);
router.delete("/:id", deleteRecipe as never);

export default router;
