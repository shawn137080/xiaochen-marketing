import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: `file:${process.env.XHS_DB_PATH || path.resolve(__dirname, "xhs.db")}`,
  },
});
