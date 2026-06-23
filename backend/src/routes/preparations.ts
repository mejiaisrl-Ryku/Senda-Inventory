import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  listPreparations,
  getPreparation,
  createPreparation,
  updatePreparation,
  deletePreparation,
  producePreparation,
} from "../controllers/preparationController";

const router = Router();

router.use(authenticate as never);

router.get(   "/",          listPreparations  as never);
router.get(   "/:id",       getPreparation    as never);
router.post(  "/",          createPreparation as never);
router.patch( "/:id",       updatePreparation as never);
router.delete("/:id",       deletePreparation as never);
router.post(  "/:id/produce", producePreparation as never);

export default router;
