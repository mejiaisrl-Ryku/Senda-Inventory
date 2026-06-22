import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { listAllergens } from "../controllers/allergenController";

const router = Router();

router.use(authenticate as never);

router.get("/", listAllergens as never);

export default router;
