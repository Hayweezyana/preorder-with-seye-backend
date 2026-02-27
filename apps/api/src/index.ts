import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase } from "./db/connect.js";

await connectDatabase();

const app = createApp();
app.listen(env.PORT, () => {
  console.log(`[api] running on http://localhost:${env.PORT}`);
});
