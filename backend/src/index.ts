import "dotenv/config";
import "./instrument";

import { createServer } from "http";
import app, { allowedOrigins } from "./app";
import { initSocket } from "./lib/socket";
import { startToastSyncJob } from "./jobs/toast-sync-job";

const httpServer = createServer(app);
const PORT = process.env.PORT ?? 4000;

initSocket(httpServer, allowedOrigins);
startToastSyncJob();

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} [${process.env.NODE_ENV ?? "development"}]`);
});
