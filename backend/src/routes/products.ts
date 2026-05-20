import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  createProductSchema,
  updateProductSchema,
} from "../controllers/productsController";

const router = Router();

router.use(authenticate as never);

router.get("/", listProducts as never);
router.get("/:id", getProduct as never);
router.post("/", requireAdmin as never, validate(createProductSchema), createProduct as never);
router.put("/:id", requireAdmin as never, validate(updateProductSchema), updateProduct as never);
router.delete("/:id", requireAdmin as never, deleteProduct as never);

export default router;
