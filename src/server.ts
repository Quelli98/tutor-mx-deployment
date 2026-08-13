import "dotenv/config";
import { createApp } from "./app.js";
import { prisma } from "./database.js";

const port = Number(process.env.PORT ?? 3000);

const app = createApp(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

app.listen(port, () => {
  console.log(`Tutor Mx API listening on http://localhost:${port}`);
});