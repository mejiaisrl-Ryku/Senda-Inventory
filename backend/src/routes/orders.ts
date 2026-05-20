import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
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
// Cancelling/updating order status is an admin action
router.put("/:id", requireAdmin as never, validate(updateOrderSchema), updateOrder as never);
router.post("/:id/receive", receiveOrder as never);

export default router;
