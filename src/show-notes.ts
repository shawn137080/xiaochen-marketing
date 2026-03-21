import { db } from "./db";
async function main() {
  const notes = await db.xhsNote.findMany({ orderBy: { scheduledAt: "asc" } });
  for (const n of notes) {
    console.log("=== " + n.title + " ===");
    console.log("industry:", n.industry, "| angle:", n.contentAngle);
    console.log("tags:", n.tags);
    console.log(n.content);
    console.log();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
