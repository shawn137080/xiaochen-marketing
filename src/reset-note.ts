import { db } from "./db";

const noteId = process.argv[2];
if (!noteId) { console.error("Usage: npx tsx src/reset-note.ts <noteId>"); process.exit(1); }

const note = await db.xhsNote.findUnique({ where: { id: noteId } });
if (!note) { console.error("Not found"); process.exit(1); }

await db.xhsNote.update({
  where: { id: noteId },
  data: { status: "scheduled", publishedAt: null, xhsNoteId: null },
});
console.log(`✅ Reset "${note.title}" → scheduled`);
