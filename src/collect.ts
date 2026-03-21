/**
 * 数据采集脚本 — 从 MCP 抓取所有已发布笔记的最新指标，写入 DB
 *
 * 用法: npx tsx src/collect.ts           # 采集所有已发布笔记
 *       npx tsx src/collect.ts <noteId>  # 采集单篇笔记
 */

import { db } from "./db";
import { callMcp } from "./publish";

interface FeedMetrics {
  likes: number;
  comments: number;
  bookmarks: number;
  shares: number;
}

function parseMetricsFromResponse(text: string): FeedMetrics | null {
  try {
    // MCP get_feed_detail 返回 JSON 格式的帖子详情
    const data = JSON.parse(text);
    return {
      likes: data.liked_count ?? data.likes ?? 0,
      comments: data.comment_count ?? data.comments ?? 0,
      bookmarks: data.collected_count ?? data.bookmarks ?? 0,
      shares: data.shared_count ?? data.shares ?? 0,
    };
  } catch {
    // 如果不是 JSON，尝试正则提取
    const extract = (pattern: RegExp) => {
      const match = text.match(pattern);
      return match ? parseInt(match[1], 10) : 0;
    };
    return {
      likes: extract(/(?:like|赞)[^\d]*(\d+)/i),
      comments: extract(/(?:comment|评论)[^\d]*(\d+)/i),
      bookmarks: extract(/(?:collect|bookmark|收藏)[^\d]*(\d+)/i),
      shares: extract(/(?:share|分享)[^\d]*(\d+)/i),
    };
  }
}

async function collectOne(noteId: string, xhsNoteId: string): Promise<boolean> {
  try {
    const response = await callMcp("get_feed_detail", { note_id: xhsNoteId });

    if (response.error) {
      console.error(`  ❌ MCP error for ${xhsNoteId}: ${response.error.message}`);
      return false;
    }

    const text = response.result?.content?.[0]?.text || "";
    const metrics = parseMetricsFromResponse(text);

    if (!metrics) {
      console.error(`  ❌ Could not parse metrics for ${xhsNoteId}`);
      return false;
    }

    await db.xhsNoteMetric.create({
      data: {
        noteId,
        likes: metrics.likes,
        comments: metrics.comments,
        bookmarks: metrics.bookmarks,
        shares: metrics.shares,
      },
    });

    console.log(
      `  ✅ 赞:${metrics.likes} 评:${metrics.comments} 藏:${metrics.bookmarks} 转:${metrics.shares}`
    );
    return true;
  } catch (err) {
    console.error(`  ❌ Failed for ${xhsNoteId}:`, err);
    return false;
  }
}

async function collectAll() {
  const notes = await db.xhsNote.findMany({
    where: {
      status: "published",
      xhsNoteId: { not: null },
    },
    select: { id: true, title: true, xhsNoteId: true },
  });

  if (notes.length === 0) {
    console.log("No published notes with XHS IDs found.");
    return;
  }

  console.log(`Collecting metrics for ${notes.length} notes...\n`);

  let success = 0;
  for (const note of notes) {
    console.log(`📊 "${note.title}" (${note.xhsNoteId})`);
    const ok = await collectOne(note.id, note.xhsNoteId!);
    if (ok) success++;
    // 避免被限流，每次请求间隔 1 秒
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n✅ Done: ${success}/${notes.length} notes collected.`);
}

async function collectSingle(noteId: string) {
  const note = await db.xhsNote.findUnique({
    where: { id: noteId },
    select: { id: true, title: true, xhsNoteId: true, status: true },
  });

  if (!note) {
    console.error(`Note ${noteId} not found`);
    process.exit(1);
  }
  if (!note.xhsNoteId) {
    console.error(`Note ${noteId} has no XHS ID (not published yet?)`);
    process.exit(1);
  }

  console.log(`📊 "${note.title}" (${note.xhsNoteId})`);
  await collectOne(note.id, note.xhsNoteId);
}

export { collectOne, collectAll };

// CLI 入口
if (process.argv[1]?.endsWith("collect.ts")) {
  const arg = process.argv[2];
  if (arg) {
    collectSingle(arg)
      .then(() => process.exit(0))
      .catch((err) => { console.error(err); process.exit(1); });
  } else {
    collectAll()
      .then(() => process.exit(0))
      .catch((err) => { console.error(err); process.exit(1); });
  }
}
