/**
 * 自进化优化器 — 基于已发布笔记的数据，自动优化待发布笔记
 *
 * 工作逻辑：
 * 1. 读取最近发布的笔记 + 指标数据
 * 2. 读取待发布的排期笔记
 * 3. 让 LLM 分析什么 pattern 效果好，重写待发布笔记
 * 4. 更新 DB，保留原版（存在 analysis 字段）
 *
 * 用法: npm run optimize
 *
 * 配置 (env):
 *   LLM_API_KEY    — API key（必填）
 *   LLM_BASE_URL   — OpenAI 兼容接口地址（默认 https://aiberm.com/v1）
 *   LLM_MODEL      — 模型名（默认 google/gemini-3-flash）
 *
 * daemon 在每次发布前自动调用
 */

import { db } from "./db";
import {
  calculateEngagementRate,
  calculateBookmarkLikeRatio,
  rankNotesByPerformance,
  type NoteWithMetrics,
} from "./analytics";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://aiberm.com/v1";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "google/gemini-3-flash";

async function callLLM(prompt: string): Promise<string> {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY is required. Set it in .env or environment.");
  }

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LLM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM request failed: ${res.status} ${body}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content || "";
}

// 读取小陈的 agent 文件作为系统 prompt 的一部分
function loadAgentContext(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const agentPath = resolve(__dirname, "../../../docs/agents/xiaohongshu-specialist.md");
    return readFileSync(agentPath, "utf-8");
  } catch {
    return "（agent 文件未找到，使用默认上下文）";
  }
}

interface PublishedNoteData {
  title: string;
  content: string;
  industry: string | null;
  contentAngle: string | null;
  titleFormula: string | null;
  likes: number;
  comments: number;
  bookmarks: number;
  shares: number;
  engagementScore: number;
  bookmarkLikeRatio: number;
}

async function getRecentPerformance(): Promise<{
  notes: PublishedNoteData[];
  topPatterns: string;
  weakPatterns: string;
}> {
  const published = await db.xhsNote.findMany({
    where: {
      status: "published",
      publishedAt: { not: null },
    },
    include: {
      metrics: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
    orderBy: { publishedAt: "desc" },
    take: 20, // 最近 20 篇
  });

  const notesWithMetrics: NoteWithMetrics[] = published.map((n) => ({
    id: n.id,
    title: n.title,
    industry: n.industry,
    contentAngle: n.contentAngle,
    titleFormula: n.titleFormula,
    publishedAt: n.publishedAt,
    latestMetrics: n.metrics[0]
      ? {
          likes: n.metrics[0].likes,
          comments: n.metrics[0].comments,
          bookmarks: n.metrics[0].bookmarks,
          shares: n.metrics[0].shares,
        }
      : null,
  }));

  const ranked = rankNotesByPerformance(notesWithMetrics);

  const notes: PublishedNoteData[] = published
    .filter((n) => n.metrics.length > 0)
    .map((n) => {
      const m = n.metrics[0];
      return {
        title: n.title,
        content: n.content.slice(0, 200) + "...",
        industry: n.industry,
        contentAngle: n.contentAngle,
        titleFormula: n.titleFormula,
        likes: m.likes,
        comments: m.comments,
        bookmarks: m.bookmarks,
        shares: m.shares,
        engagementScore: calculateEngagementRate(m),
        bookmarkLikeRatio: calculateBookmarkLikeRatio(m.bookmarks, m.likes),
      };
    });

  const top3 = ranked.slice(0, 3);
  const bottom3 = ranked.slice(-3);

  const topPatterns = top3
    .map((n) => `"${n.title}" (分数:${n.score}, 收藏赞比:${n.bookmarkLikeRatio})`)
    .join("\n");

  const weakPatterns = bottom3
    .map((n) => `"${n.title}" (分数:${n.score}, 收藏赞比:${n.bookmarkLikeRatio})`)
    .join("\n");

  return { notes, topPatterns, weakPatterns };
}

export async function optimizeNote(
  noteId: string,
  performanceData?: Awaited<ReturnType<typeof getRecentPerformance>>
): Promise<{ optimized: boolean; reason: string }> {
  const note = await db.xhsNote.findUnique({ where: { id: noteId } });
  if (!note) return { optimized: false, reason: "Note not found" };
  if (note.status !== "scheduled") return { optimized: false, reason: "Not a scheduled note" };

  const perf = performanceData || (await getRecentPerformance());

  if (perf.notes.length < 3) {
    return { optimized: false, reason: "Not enough published data to optimize (need ≥3 notes)" };
  }

  const agentContext = loadAgentContext();

  const prompt = `你是小陈，AllDayAnswer 的小红书获客专家。

以下是你的完整角色设定：
${agentContext.slice(0, 3000)}

---

## 最近发布笔记的数据表现

### 表现最好的 Top 3：
${perf.topPatterns}

### 表现最弱的 Bottom 3：
${perf.weakPatterns}

### 全部数据（最近 ${perf.notes.length} 篇）：
${perf.notes
  .map(
    (n) =>
      `- "${n.title}" | ${n.industry || "通用"} | ${n.contentAngle || "未分类"} | ${n.titleFormula || "未分类"} | 赞:${n.likes} 评:${n.comments} 藏:${n.bookmarks} | 互动分:${n.engagementScore} | 藏赞比:${n.bookmarkLikeRatio}`
  )
  .join("\n")}

---

## 待优化的笔记

标题: ${note.title}
正文:
${note.content}

标签: ${note.tags}
行业: ${note.industry || "未指定"}
内容角度: ${note.contentAngle || "未指定"}
标题公式: ${note.titleFormula || "未指定"}

---

## 任务

根据已发布笔记的数据表现，优化这篇待发布的笔记。具体要求：

1. 分析数据 pattern：什么样的标题、角度、行业组合效果最好？
2. 基于 pattern 优化标题（保持 ≤20 字）
3. 优化正文：学习效果好的笔记的结构和表达方式
4. 调整标签：优先使用带来高互动的标签，补足到 8-10 个（小红书最多支持10个，尽量填满）
5. 保持内容真实感，不要过度营销

请按以下 JSON 格式输出（不要包含 markdown 代码块标记）：
{
  "analysis": "数据分析总结（什么 pattern 效果好，为什么优化这些地方）",
  "title": "优化后的标题",
  "content": "优化后的正文",
  "tags": ["标签1", "标签2"],
  "contentAngle": "建议的内容角度",
  "titleFormula": "使用的标题公式",
  "changes": "改动说明（改了哪些地方，为什么）"
}`;

  try {
    const text = await callLLM(prompt);

    // 解析 JSON（可能有 markdown 包裹）
    const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(jsonStr);

    // 更新 DB — 保留原版信息
    const originalBackup = JSON.stringify({
      title: note.title,
      content: note.content,
      tags: note.tags,
      contentAngle: note.contentAngle,
      titleFormula: note.titleFormula,
    });

    await db.xhsNote.update({
      where: { id: noteId },
      data: {
        title: result.title || note.title,
        content: result.content || note.content,
        tags: result.tags ? JSON.stringify(result.tags) : note.tags,
        contentAngle: result.contentAngle || note.contentAngle,
        titleFormula: result.titleFormula || note.titleFormula,
      },
    });

    // 记录优化历史到 report 表（复用 insights 字段）
    await db.xhsReport.create({
      data: {
        periodType: "weekly",
        periodStart: new Date(),
        periodEnd: new Date(),
        topNoteId: noteId,
        insights: `🔄 自动优化笔记 "${note.title}"\n\n${result.analysis}\n\n改动: ${result.changes}\n\n原版备份: ${originalBackup}`,
        recommendations: result.changes,
      },
    });

    console.log(`   📝 分析: ${result.analysis}`);
    console.log(`   ✏️  标题: "${note.title}" → "${result.title}"`);
    console.log(`   🔧 改动: ${result.changes}`);

    return { optimized: true, reason: result.changes };
  } catch (err) {
    console.error(`   ❌ Optimize failed:`, err);
    return { optimized: false, reason: String(err) };
  }
}

export async function optimizeAllScheduled(): Promise<number> {
  const scheduled = await db.xhsNote.findMany({
    where: { status: "scheduled" },
    orderBy: { scheduledAt: "asc" },
  });

  if (scheduled.length === 0) {
    console.log("No scheduled notes to optimize.");
    return 0;
  }

  const perf = await getRecentPerformance();
  if (perf.notes.length < 3) {
    console.log("Not enough published data yet (need ≥3 notes with metrics). Skipping optimization.");
    return 0;
  }

  console.log(`\n🧠 Optimizing ${scheduled.length} scheduled notes based on ${perf.notes.length} published data points...\n`);

  let optimized = 0;
  for (const note of scheduled) {
    console.log(`📝 "${note.title}"`);
    const result = await optimizeNote(note.id, perf);
    if (result.optimized) optimized++;
    console.log("");
    // 避免 API 限流
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`✅ Optimized ${optimized}/${scheduled.length} notes.`);
  return optimized;
}

// CLI 入口
if (process.argv[1]?.endsWith("optimize.ts")) {
  const noteId = process.argv[2];
  if (noteId) {
    optimizeNote(noteId)
      .then((r) => { console.log(r); process.exit(0); })
      .catch((e) => { console.error(e); process.exit(1); });
  } else {
    optimizeAllScheduled()
      .then(() => process.exit(0))
      .catch((e) => { console.error(e); process.exit(1); });
  }
}
