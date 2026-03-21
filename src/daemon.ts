/**
 * 自动化 daemon — 启动后持续运行，自动完成：
 * 1. 采集数据后自动优化待发布笔记（基于已发布数据 AI 重写）
 * 2. 定时发布排期笔记（status=scheduled, scheduledAt 到期）
 * 3. 发布 24h 后自动采集指标
 * 4. 发布 72h 后再次采集
 * 5. 每周日自动生成周报
 *
 * 用法: npm run daemon
 * 前提: xiaohongshu-mcp 已启动 (http://localhost:18060)
 */

import { db } from "./db";
import { collectOne } from "./collect";
import { callMcp } from "./publish";
import { generateReport } from "./report";
import { optimizeNote } from "./optimize";
import { runDiscover } from "./discover";
import { existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const IMAGES_DIR = resolve(__dirname, "../images");

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 每 10 分钟检查一次
const STATUS_FILE = resolve(__dirname, "../.daemon-status.json");
const COLLECT_AFTER_HOURS = [24, 72]; // 发布后多少小时采集

function hoursSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

async function checkAndPublishScheduled() {
  const now = new Date();
  const scheduledNotes = await db.xhsNote.findMany({
    where: {
      status: "scheduled",
      scheduledAt: { lte: now },
    },
  });

  for (const note of scheduledNotes) {
    // 发布前先用 AI 优化（基于已有数据）
    if (process.env.LLM_API_KEY) {
      console.log(
        `[${now.toLocaleTimeString()}] 🧠 Optimizing before publish: "${note.title}"`
      );
      try {
        const result = await optimizeNote(note.id);
        if (result.optimized) {
          console.log(`   ✅ Optimized: ${result.reason}`);
        }
      } catch (err) {
        console.log(`   ⚠️  Optimization skipped: ${err}`);
      }
    }

    // 重新读取（可能被优化过了）
    const freshNote = await db.xhsNote.findUnique({ where: { id: note.id } });
    if (!freshNote || freshNote.status !== "scheduled") continue;

    console.log(
      `[${now.toLocaleTimeString()}] 🚀 Auto-publishing: "${freshNote.title}"`
    );

    const tags: string[] = JSON.parse(freshNote.tags || "[]");

    // 查找配图（按 noteId 命名）
    const imagePath = resolve(IMAGES_DIR, `${note.id}.png`);
    const hasImage = existsSync(imagePath);

    if (!hasImage && freshNote.noteType !== "video") {
      console.log(`   ⚠️  No image found at images/${note.id}.png, skipping publish`);
      continue;
    }

    const mcpArgs: Record<string, unknown> = {
      title: freshNote.title,
      content: freshNote.content,
      ...(tags.length > 0 && { tags }),
      ...(hasImage && { images: [imagePath] }),
    };

    const toolName = freshNote.noteType === "video" ? "publish_with_video" : "publish_content";

    try {
      const response = await callMcp(toolName, mcpArgs);

      if (response.error) {
        console.error(`   ❌ MCP error: ${response.error.message}`);
        continue;
      }

      const resultText = response.result?.content?.[0]?.text || "";
      const idMatch =
        resultText.match(/note[_\s]?id[:\s]*([a-zA-Z0-9]+)/i) ||
        resultText.match(/([a-f0-9]{24})/);
      const xhsNoteId = idMatch?.[1] || null;

      await db.xhsNote.update({
        where: { id: note.id },
        data: {
          status: "published",
          publishedAt: new Date(),
          ...(xhsNoteId && { xhsNoteId }),
        },
      });

      console.log(`   ✅ Published! ${xhsNoteId ? `XHS ID: ${xhsNoteId}` : "(ID pending backfill)"}`);
    } catch (err) {
      console.error(`   ❌ Publish failed:`, err);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function checkAndCollect() {
  // 找到所有已发布、有 xhsNoteId 的笔记
  const notes = await db.xhsNote.findMany({
    where: {
      status: "published",
      xhsNoteId: { not: null },
      publishedAt: { not: null },
    },
    include: {
      metrics: { orderBy: { fetchedAt: "desc" } },
    },
  });

  for (const note of notes) {
    if (!note.publishedAt || !note.xhsNoteId) continue;

    const hours = hoursSince(note.publishedAt);
    const collectCount = note.metrics.length;

    // 检查是否需要采集：已过目标小时数且还没做过对应次序的采集
    const expectedCollects = COLLECT_AFTER_HOURS.filter((h) => hours >= h).length;
    if (collectCount < expectedCollects) {
      console.log(
        `[${new Date().toLocaleTimeString()}] 📊 Auto-collecting "${note.title}" (${Math.round(hours)}h since publish, snapshot #${collectCount + 1})`
      );
      await collectOne(note.id, note.xhsNoteId);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

let lastOptimizeRun: string | null = null;

async function checkAndOptimize() {
  // 每天最多优化一次（避免频繁 API 调用）
  if (!process.env.LLM_API_KEY) return;

  const today = new Date().toISOString().split("T")[0];
  if (lastOptimizeRun === today) return;

  const scheduledCount = await db.xhsNote.count({ where: { status: "scheduled" } });
  const publishedWithMetrics = await db.xhsNote.count({
    where: { status: "published", metrics: { some: {} } },
  });

  if (scheduledCount === 0 || publishedWithMetrics < 3) return;

  console.log(`[${new Date().toLocaleTimeString()}] 🧠 Daily optimization: ${scheduledCount} scheduled notes, ${publishedWithMetrics} data points`);

  const { optimizeAllScheduled } = await import("./optimize");
  await optimizeAllScheduled();
  lastOptimizeRun = today;
}

let lastWeeklyReport: string | null = null;

async function checkWeeklyReport() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const dateStr = now.toISOString().split("T")[0];

  // 每周日执行一次
  if (dayOfWeek !== 0) return;
  if (lastWeeklyReport === dateStr) return; // 今天已经跑过了

  console.log(`[${now.toLocaleTimeString()}] 📋 Generating weekly report...`);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  try {
    const summary = await generateReport("weekly", weekStart, now);
    console.log(summary);
    lastWeeklyReport = dateStr;
  } catch (err) {
    console.error("Weekly report failed:", err);
  }
}

let lastDiscover = "";

async function checkAndDiscover() {
  const now = new Date();
  // 用美东时间判断（自动处理 EST/EDT 切换）
  const estHour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(now),
    10,
  );
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now); // YYYY-MM-DD

  // 每天 16:00–16:59 EST/EDT 执行一次
  if (estHour !== 16) return;
  if (lastDiscover === dateStr) return;

  console.log(`[${now.toLocaleTimeString()}] 🔍 Running discover (competitor research + draft generation)...`);
  try {
    await runDiscover();
    lastDiscover = dateStr;
  } catch (err) {
    console.error("Discover failed:", err);
  }
}

async function checkMcpHealth(): Promise<boolean> {
  try {
    const mcpUrl = process.env.XHS_MCP_URL || "http://localhost:18060/mcp";
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function run() {
  console.log("🤖 XHS Marketing Daemon started");
  console.log(`   Check interval: ${CHECK_INTERVAL_MS / 1000 / 60} minutes`);
  console.log(`   Auto-optimize: rewrites scheduled notes based on performance data`);
  console.log(`   Auto-publish: scheduled notes published when due`);
  console.log(`   Auto-collect at: ${COLLECT_AFTER_HOURS.join("h, ")}h after publish`);
  console.log(`   Weekly report: every Sunday`);
  console.log(`   Auto-discover: daily 16:00 EST — competitor research + draft generation`);
  console.log("");

  // 检查 MCP 是否在线
  const mcpOk = await checkMcpHealth();
  if (mcpOk) {
    console.log("✅ xiaohongshu-mcp is online");
  } else {
    console.log("⚠️  xiaohongshu-mcp is offline — will retry on each check");
  }
  console.log("");

  // 立即执行一次
  await checkAndPublishScheduled();
  await checkAndCollect();
  await checkAndOptimize();
  await checkWeeklyReport();
  await checkAndDiscover();

  function writeStatus() {
    const now = Date.now();
    writeFileSync(STATUS_FILE, JSON.stringify({
      lastCheck: now,
      nextCheck: now + CHECK_INTERVAL_MS,
      intervalMs: CHECK_INTERVAL_MS,
    }));
  }

  writeStatus();

  // 定时循环
  setInterval(async () => {
    try {
      await checkAndPublishScheduled();
      await checkAndCollect();
      await checkAndOptimize();
      await checkWeeklyReport();
      await checkAndDiscover();
      writeStatus();
    } catch (err) {
      console.error(`[${new Date().toLocaleTimeString()}] Daemon error:`, err);
    }
  }, CHECK_INTERVAL_MS);
}

run().catch((err) => {
  console.error("Daemon failed to start:", err);
  process.exit(1);
});
