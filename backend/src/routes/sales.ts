import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createSale, listSales, createSaleSchema } from "../controllers/salesController";

const router = Router();

router.use(authenticate as never);

router.post("/", validate(createSaleSchema), createSale as never);
router.get("/", listSales as never);

export default router;
