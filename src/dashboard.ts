/**
 * 小陈 Dashboard — 本地轻量前端
 * 用法: npm run dashboard
 * 访问: http://localhost:3100
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = 3100;
const IMAGES_DIR = process.env.XHS_IMAGES_DIR || resolve(__dirname, "../images");

// API handlers
async function getNotesApi() {
  const notes = await db.xhsNote.findMany({
    orderBy: { scheduledAt: "asc" },
    include: {
      metrics: { orderBy: { fetchedAt: "desc" } },
      themes: true,
    },
  });
  return notes.map((n) => ({
    ...n,
    tags: JSON.parse(n.tags || "[]"),
    hasImage: existsSync(resolve(IMAGES_DIR, `${n.id}.png`)),
  }));
}

async function getReportsApi() {
  return db.xhsReport.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

async function getOptimizationHistory() {
  // 优化记录存在 report 表里（insights 包含 "自动优化"）
  const reports = await db.xhsReport.findMany({
    where: { insights: { contains: "自动优化" } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return reports;
}

async function getAnalytics() {
  const notes = await db.xhsNote.findMany({
    where: { status: "published" },
    include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 1 } },
  });

  // 按行业汇总
  const byIndustry: Record<string, { count: number; likes: number; comments: number; bookmarks: number }> = {};
  // 按内容角度汇总
  const byAngle: Record<string, { count: number; likes: number; comments: number; bookmarks: number }> = {};

  for (const n of notes) {
    const m = n.metrics[0];
    if (!m) continue;
    const ind = n.industry || "general";
    const angle = n.contentAngle || "other";

    if (!byIndustry[ind]) byIndustry[ind] = { count: 0, likes: 0, comments: 0, bookmarks: 0 };
    byIndustry[ind].count++;
    byIndustry[ind].likes += m.likes;
    byIndustry[ind].comments += m.comments;
    byIndustry[ind].bookmarks += m.bookmarks;

    if (!byAngle[angle]) byAngle[angle] = { count: 0, likes: 0, comments: 0, bookmarks: 0 };
    byAngle[angle].count++;
    byAngle[angle].likes += m.likes;
    byAngle[angle].comments += m.comments;
    byAngle[angle].bookmarks += m.bookmarks;
  }

  return {
    totalNotes: notes.length,
    totalScheduled: await db.xhsNote.count({ where: { status: "scheduled" } }),
    totalPublished: await db.xhsNote.count({ where: { status: "published" } }),
    totalDraft: await db.xhsNote.count({ where: { status: "draft" } }),
    byIndustry,
    byAngle,
  };
}

// Serve image files
function serveImage(id: string): Buffer | null {
  const imgPath = resolve(IMAGES_DIR, `${id}.png`);
  if (existsSync(imgPath)) return readFileSync(imgPath);
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    if (url.pathname === "/api/notes") {
      const data = await getNotesApi();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/reports") {
      const data = await getReportsApi();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/optimizations") {
      const data = await getOptimizationHistory();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/analytics") {
      const data = await getAnalytics();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } else if (url.pathname.startsWith("/images/")) {
      const id = url.pathname.replace("/images/", "").replace(".png", "");
      const img = serveImage(id);
      if (img) {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(img);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    } else if (url.pathname.startsWith("/api/notes/") && req.method === "POST") {
      // Save note edits
      const id = url.pathname.replace("/api/notes/", "");
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      await new Promise((r) => req.on("end", r));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        title?: string; content?: string; tags?: string[];
      };
      const updated = await db.xhsNote.update({
        where: { id },
        data: {
          ...(body.title !== undefined && { title: body.title }),
          ...(body.content !== undefined && { content: body.content }),
          ...(body.tags !== undefined && { tags: JSON.stringify(body.tags) }),
        },
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: updated.id }));
    } else {
      // Serve dashboard HTML
      const html = readFileSync(resolve(__dirname, "dashboard.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    }
  } catch (err) {
    console.error("API error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`\n🎯 小陈 Dashboard: http://localhost:${PORT}\n`);
});
