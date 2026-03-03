import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase } from "./db/connect.js";
import { startEmbeddedNotificationWorker } from "./services/embeddedNotificationWorker.js";

await connectDatabase();
startEmbeddedNotificationWorker();

const app = createApp();
app.listen(env.PORT, () => {
  console.log(`[api] running on http://localhost:${env.PORT}`);
});
