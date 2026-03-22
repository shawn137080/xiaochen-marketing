/**
 * 小陈自主选题系统 — 搜索竞品爆款 → LLM 分析规律 → 生成新笔记草稿 → 通知审批
 *
 * 用法: npx tsx src/discover.ts
 *
 * 触发时机: daemon 每天 16:00 EST 自动调用，生成 2 篇草稿（含去重）
 *
 * 流程:
 *   1. 读取行业轮换游标（XhsConfig）
 *   2. 搜索 4 个固定词 + 1 个行业词，过滤 likes > MIN_LIKES
 *   3. 存入 XhsInsight 表
 *   4. 读取近期用户改动偏好（userEdits）
 *   5. LLM 一次调用：分析爆款规律 + 生成 NOTES_PER_RUN 篇新笔记
 *   6. 存为 status="draft"，aiDraft 记录原始版本
 *   7. POST NOTIFY_WEBHOOK_URL 通知审批
 *   8. 更新行业游标
 */

import { db } from "./db";
import { callMcp } from "./publish";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://aiberm.com/v1").replace(/\/$/, "");
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "google/gemini-3-flash";

// 每次生成笔记数
const NOTES_PER_RUN = 2;

// 过滤阈值
const MIN_LIKES = 100;

// 固定搜索词（每次都搜）
const FIXED_KEYWORDS = [
  "漏接电话", "华人小老板", "AI接电话", "海外创业",
  "北美创业踩坑", "海外服务业痛点", "一个人在国外开公司",
];

// 行业轮换词（轮流搜，每次取一个）
const INDUSTRY_KEYWORDS = [
  "装修老板", "暖通师傅", "美容店", "搬家公司",
  "补习班", "割草园艺", "美甲店",
  "多伦多开店", "北美水管工创业", "海外家政创业",
];

// ── 配置游标 ──────────────────────────────────────────────────────────────

async function getIndustryCursor(): Promise<number> {
  const cfg = await db.xhsConfig.findUnique({ where: { key: "industry_cursor" } });
  return cfg ? parseInt(cfg.value, 10) : 0;
}

async function setIndustryCursor(idx: number) {
  await db.xhsConfig.upsert({
    where: { key: "industry_cursor" },
    create: { key: "industry_cursor", value: String(idx) },
    update: { value: String(idx) },
  });
}

// ── 搜索竞品 ─────────────────────────────────────────────────────────────

interface InsightRow {
  keyword: string;
  xhsNoteId: string;
  title: string;
  likes: number;
}

async function searchKeyword(keyword: string): Promise<InsightRow[]> {
  try {
    // 超时控制：search_feeds 有时会挂住，最多等 15 秒
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("search timeout")), 15000)
    );
    const response = await Promise.race([callMcp("search_feeds", { keyword }), timeoutPromise]);
    if (response.error) {
      console.warn(`   ⚠️  搜索 "${keyword}" 失败: ${response.error.message}`);
      return [];
    }
    const text = response.result?.content?.[0]?.text || "[]";
    let feeds: Array<{ note_id?: string; id?: string; title?: string; liked_count?: number; likes?: number }> = [];
    try {
      feeds = JSON.parse(text);
    } catch {
      // 不是 JSON，跳过
      return [];
    }

    const results: InsightRow[] = [];
    for (const f of feeds) {
      const noteId = f.note_id || f.id || "";
      const likes = f.liked_count ?? f.likes ?? 0;
      if (!noteId || likes < MIN_LIKES) continue;
      results.push({ keyword, xhsNoteId: noteId, title: f.title || "", likes });
    }
    return results;
  } catch (err) {
    console.warn(`   ⚠️  搜索 "${keyword}" 出错: ${err}`);
    return [];
  }
}

async function collectInsights(keywords: string[]): Promise<InsightRow[]> {
  const all: InsightRow[] = [];
  for (const kw of keywords) {
    const results = await searchKeyword(kw);
    console.log(`   "${kw}" → ${results.length} 条有效帖子（赞>${MIN_LIKES}）`);
    // 存入 DB
    for (const r of results) {
      await db.xhsInsight.create({
        data: { keyword: r.keyword, xhsNoteId: r.xhsNoteId, title: r.title, likes: r.likes },
      });
    }
    all.push(...results);
    await new Promise(res => setTimeout(res, 2000)); // 限速
  }
  return all;
}

// ── 读取用户改动偏好 ───────────────────────────────────────────────────────

async function loadUserEditsContext(): Promise<string> {
  const recent = await db.xhsNote.findMany({
    where: { userEdits: { not: null }, approvedAt: { not: null } },
    orderBy: { approvedAt: "desc" },
    take: 10,
    select: { userEdits: true },
  });
  if (recent.length === 0) return "（暂无用户改动记录，这是第一批草稿）";
  const summaries = recent
    .map(n => {
      try {
        const e = JSON.parse(n.userEdits!);
        return e.summary || null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return `近期用户改动摘要（${summaries.length} 条）：\n${summaries.map(s => `- ${s}`).join("\n")}`;
}

// ── 读取 agent 上下文 ─────────────────────────────────────────────────────

function loadAgentContext(): string {
  const paths = [
    resolve(__dirname, "../../agents/xiaohongshu-specialist.md"),
    resolve(__dirname, "../agents/xiaohongshu-specialist.md"),
    resolve(__dirname, "../../docs/agents/xiaohongshu-specialist.md"),
    resolve(__dirname, "../docs/agents/xiaohongshu-specialist.md"),
  ];
  for (const p of paths) {
    try {
      return readFileSync(p, "utf-8");
    } catch { /* 继续尝试 */ }
  }
  console.warn("   ⚠️  找不到 xiaohongshu-specialist.md，使用默认上下文");
  return "你是小陈，AllDayAnswer 的小红书增长负责人，专注加拿大华人小老板市场。";
}

// ── 读取爆款大脑 skill ────────────────────────────────────────────────────

function loadViralBrain(): string {
  const paths = [
    // Docker 容器内路径（COPY skills ./skills → /app/skills/）
    resolve(__dirname, "../skills/xhs-viral-brain/SKILL.md"),
    resolve(__dirname, "../../skills/xhs-viral-brain/SKILL.md"),
    // 本地开发路径
    resolve(process.env.HOME || "/root", ".claude/skills/xhs-viral-brain/SKILL.md"),
  ];
  for (const p of paths) {
    try {
      const content = readFileSync(p, "utf-8");
      console.log(`   🧠 爆款大脑已加载: ${p}`);
      return content;
    } catch { /* 继续尝试 */ }
  }
  console.warn("   ⚠️  找不到 xhs-viral-brain/SKILL.md，不使用爆款大脑");
  return "";
}

// ── LLM 分析 + 生成 ──────────────────────────────────────────────────────

interface GeneratedNote {
  title: string;
  content: string;
  industry: string;
  contentAngle: string;
  tags: string[];
}

async function analyzeAndGenerate(
  insights: InsightRow[],
  agentContext: string,
  userEditsCtx: string,
  viralBrain: string,
): Promise<GeneratedNote[]> {
  if (!LLM_API_KEY) throw new Error("LLM_API_KEY 未设置");

  const insightList = insights
    .slice(0, 20) // 最多传 20 条，避免超长
    .map(i => `- 「${i.title}」（搜索词: ${i.keyword}，赞${i.likes}）`)
    .join("\n");

  const brainSection = viralBrain
    ? `\n---\n\n## 爆款写作大脑（必须严格遵守）\n\n${viralBrain}\n\n---\n`
    : "";

  const prompt = `${agentContext}${brainSection}

---

## 任务：根据竞品爆款分析，为兜兜AI生成 ${NOTES_PER_RUN} 篇新笔记草稿

### 竞品爆款参考（今日抓取，赞 > ${MIN_LIKES}）
${insightList}

### 用户风格偏好（从历史改动学习）
${userEditsCtx}

### 输出要求
1. 先用 1-2 句话分析爆款规律（哪些角度在火）
2. 生成 ${NOTES_PER_RUN} 篇新笔记，每篇：
   - 标题要有钩子感（≤20字）
   - 正文 200-400 字，口语化，符合小红书风格
   - 必须包含兜兜AI真实功能（短信通知/一键确认/日历接入），不要编造没有的功能
   - industry: renovation | hvac | beauty | moving | landscaping | tutoring | general 其中之一
   - contentAngle: pain_point | tool_review | case_study | data | comparison 其中之一
   - tags: 8-10 个标签（小红书最多支持10个，尽量填满）

### 输出格式（严格 JSON，不要其他文字）
{
  "analysis": "爆款规律分析...",
  "notes": [
    {
      "title": "标题",
      "content": "正文内容...",
      "industry": "hvac",
      "contentAngle": "pain_point",
      "tags": ["AI接电话", "华人老板", "漏接电话"]
    }
  ]
}`;

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM_API_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM 请求失败: ${res.status} ${body}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const raw = data.choices[0]?.message?.content?.trim() || "{}";

  // 提取 JSON（LLM 有时会加 markdown 代码块）
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("   ⚠️  LLM 输出不是有效 JSON:", raw.slice(0, 200));
    return [];
  }

  const parsed = JSON.parse(jsonMatch[0]) as { analysis?: string; notes?: GeneratedNote[] };
  if (parsed.analysis) {
    console.log(`   📊 爆款规律: ${parsed.analysis}`);
  }
  return parsed.notes || [];
}

// ── 存草稿 ────────────────────────────────────────────────────────────────

function tokenize(title: string): string[] {
  return title.split(/[\s，。！？、""''「」《》【】\-—·]/g).filter(w => w.length > 1);
}

function isSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const aWords = new Set(tokenize(a));
  const bWords = new Set(tokenize(b));
  if (aWords.size === 0 || bWords.size === 0) return false;
  const overlap = [...aWords].filter(w => bWords.has(w)).length;
  return overlap >= Math.min(aWords.size, bWords.size) * 0.6;
}

async function saveDrafts(notes: GeneratedNote[]): Promise<Array<{ id: string; title: string }>> {
  // 查现有 draft/scheduled 标题，用于去重
  const existing = await db.xhsNote.findMany({
    where: { status: { in: ["draft", "scheduled"] } },
    select: { title: true },
  });
  const existingTitles = existing.map(n => n.title);

  const saved: Array<{ id: string; title: string }> = [];
  for (const n of notes) {
    const dup = existingTitles.find(t => isSimilar(t, n.title));
    if (dup) {
      console.log(`   ⏭️  跳过重复草稿: 「${n.title}」（与「${dup}」相似）`);
      continue;
    }
    const note = await db.xhsNote.create({
      data: {
        title: n.title,
        content: n.content,
        tags: JSON.stringify(n.tags || []),
        industry: n.industry || "general",
        contentAngle: n.contentAngle || "pain_point",
        status: "draft",
        aiDraft: n.content, // 保存 AI 原始版本，用于后续 diff
      },
    });
    existingTitles.push(note.title); // 防止同批次内重复
    saved.push({ id: note.id, title: note.title });
    console.log(`   ✅ 草稿已存: 「${note.title}」(${note.id})`);
  }
  return saved;
}

// ── 发通知 ────────────────────────────────────────────────────────────────

async function sendNotification(drafts: Array<{ title: string }>) {
  const webhookUrl = process.env.NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("   ℹ️  NOTIFY_WEBHOOK_URL 未设置，跳过通知");
    return;
  }
  const dashboardUrl = (process.env.DASHBOARD_URL || "http://localhost:3100").replace(/\/$/, "");
  const text = [
    "🌟 小陈新选题到了！",
    "",
    ...drafts.map((d, i) => `📝 ${i + 1}. 「${d.title}」`),
    "",
    `👉 去审批：${dashboardUrl}`,
  ].join("\n");

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    console.log("   📬 通知已发送");
  } catch (err) {
    console.warn(`   ⚠️  通知发送失败: ${err}`);
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────

export async function runDiscover() {
  if (!LLM_API_KEY) {
    console.log("⚠️  LLM_API_KEY 未设置，跳过选题发现");
    return;
  }

  console.log("🔍 开始选题发现...");

  // 1. 确定本次行业轮换词
  const cursor = await getIndustryCursor();
  const industryKeyword = INDUSTRY_KEYWORDS[cursor % INDUSTRY_KEYWORDS.length];
  const keywords = [...FIXED_KEYWORDS, industryKeyword];
  console.log(`   关键词: ${keywords.join(" / ")}`);
  console.log(`   行业轮换: ${industryKeyword} (${cursor + 1}/${INDUSTRY_KEYWORDS.length})\n`);

  // 2. 搜索竞品爆款（无结果也继续，用爆款大脑直接生成）
  const insights = await collectInsights(keywords);
  if (insights.length === 0) {
    console.log("   ℹ️  竞品数据为空，跳过竞品分析，直接用爆款大脑生成");
  } else {
    console.log(`\n   共收集 ${insights.length} 条有效爆款\n`);
  }

  // 3. 加载上下文
  const agentContext = loadAgentContext();
  const userEditsCtx = await loadUserEditsContext();
  const viralBrain = loadViralBrain();

  // 4. LLM 分析 + 生成
  console.log("   🧠 LLM 分析爆款规律并生成新笔记...");
  let generated: GeneratedNote[] = [];
  try {
    generated = await analyzeAndGenerate(insights, agentContext, userEditsCtx, viralBrain);
  } catch (err) {
    console.error("   ❌ LLM 生成失败:", err);
    await db.$disconnect();
    return;
  }

  if (generated.length === 0) {
    console.log("   ❌ LLM 未返回有效笔记");
    await db.$disconnect();
    return;
  }
  console.log(`   生成 ${generated.length} 篇草稿\n`);

  // 5. 存 DB
  const saved = await saveDrafts(generated);

  // 6. 发通知
  await sendNotification(saved);

  // 7. 更新行业游标
  await setIndustryCursor((cursor + 1) % INDUSTRY_KEYWORDS.length);

  console.log(`\n✅ 选题发现完成！草稿 ID: ${saved.map(s => s.id).join(", ")}`);
  await db.$disconnect();
}

// CLI 入口
if (process.argv[1]?.endsWith("discover.ts")) {
  runDiscover()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
