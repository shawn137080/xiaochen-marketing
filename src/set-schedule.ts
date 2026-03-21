import { db } from "./db";

const in2min = new Date(Date.now() + 2 * 60 * 1000);
const first = await db.xhsNote.findFirst({ orderBy: { scheduledAt: "asc" } });
if (!first) { console.error("No notes found"); process.exit(1); }
await db.xhsNote.update({ where: { id: first.id }, data: { scheduledAt: in2min } });
console.log(`✅ 「${first.title}」将在 ${in2min.toLocaleTimeString()} 发布`);
