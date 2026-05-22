import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createSession,
  listSessions,
  getSession,
  bulkUpsertEntries,
  closeSession,
  getReport,
  createSessionSchema,
  bulkUpsertEntriesSchema,
} from "../controllers/countController";
import { exportCountXlsx } from "../controllers/countXlsxController";

const router = Router();

// All count routes require authentication
router.use(authenticate as never);

router.post(  "/",                  validate(createSessionSchema),      createSession      as never);
router.get(   "/",                                                       listSessions       as never);
router.get(   "/:id",                                                    getSession         as never);
router.put(   "/:id/entries",       validate(bulkUpsertEntriesSchema),  bulkUpsertEntries  as never);
router.put(   "/:id/close",                                              closeSession       as never);
router.get(   "/:id/report",                                             getReport          as never);
router.get(   "/:id/export-xlsx",                                        exportCountXlsx    as never);

export default router;
