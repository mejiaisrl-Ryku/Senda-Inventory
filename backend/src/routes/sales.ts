import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createSale, listSales, deleteSale, createSaleSchema } from "../controllers/salesController";

const router = Router();

router.use(authenticate as never);

router.get("/", listSales as never);
router.post("/", validate(createSaleSchema), createSale as never);
router.delete("/:id", requireAdmin as never, deleteSale as never);

export default router;
