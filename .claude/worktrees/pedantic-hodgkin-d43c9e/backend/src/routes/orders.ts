import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createOrder,
  listOrders,
  updateOrder,
  receiveOrder,
  createOrderSchema,
  updateOrderSchema,
} from "../controllers/ordersController";

const router = Router();

router.use(authenticate as never);

router.post("/", validate(createOrderSchema), createOrder as never);
router.get("/", listOrders as never);
router.put("/:id", validate(updateOrderSchema), updateOrder as never);
router.post("/:id/receive", receiveOrder as never);

export default router;
