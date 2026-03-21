# 小陈自主选题系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小陈每周三次自动搜索竞品爆款、提炼规律、生成新笔记草稿、通知用户审批，并从用户改动中学习风格偏好。

**Architecture:** `discover.ts` 驱动完整流程（搜索→分析→生成→通知），结果存入扩展后的 DB schema；daemon 按 Mon/Wed/Fri 02:00 触发；dashboard 新增草稿审批区，记录 diff 供下次生成参考。

**Tech Stack:** TypeScript + Prisma 7 (SQLite) + XHS MCP + LLM API (google/gemini-3-flash) + Node.js HTTP server

---

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `prisma/schema.prisma` | 新增 XhsInsight、XhsConfig 表；XhsNote 加 aiDraft/userEdits/approvedAt |
| 新建 | `src/discover.ts` | 搜索→分析→生成→通知完整流程 |
| 修改 | `src/daemon.ts` | 新增 Mon/Wed/Fri 02:00 触发 discover |
| 修改 | `src/dashboard.ts` | 新增草稿列表 API + 审批 API（含 diff 计算） |
| 修改 | `src/dashboard.html` | 新增草稿审批 UI 区块 |
| 修改 | `.env.example` | 新增 NOTIFY_WEBHOOK_URL |

---

## Task 1: DB Schema 扩展

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 在 XhsNote 加 3 个字段**

```prisma
model XhsNote {
  // ... 现有字段不变 ...
  aiDraft     String?   // AI 原始生成版本（确认后不变）
  userEdits   String?   // JSON: {titleChanged, contentChanged, summary}
  approvedAt  DateTime? // 用户点确认的时间
}
```

- [ ] **Step 2: 新增 XhsInsight 表（竞品爆款存档）**

```prisma
model XhsInsight {
  id        String   @id @default(cuid())
  keyword   String   // 搜索词
  xhsNoteId String   // 原帖 ID（不加 @unique，同一帖可被多个关键词抓到）
  title     String
  likes     Int      @default(0)
  summary   String?  // LLM 提取的亮点摘要
  createdAt DateTime @default(now())
}
```

- [ ] **Step 3: 新增 XhsConfig 表（key-value 配置）**

```prisma
model XhsConfig {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

用途：存 `industry_cursor`（当前轮换行业索引），避免用文件系统。

- [ ] **Step 4: 生成 migration**

```bash
npx prisma migrate dev --name add_discover_tables
npx prisma generate
```

期望输出：`✔ Generated Prisma Client`

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(db): add XhsInsight, XhsConfig; extend XhsNote for draft approval"
```

---

## Task 2: discover.ts — 搜索 + 分析 + 生成

**Files:**
- Create: `src/discover.ts`

整体结构：

```typescript
// 固定搜索词
const FIXED_KEYWORDS = ["漏接电话", "华人小老板", "AI接电话", "海外创业"];

// 轮换行业词（7 个，循环）
const INDUSTRY_KEYWORDS = [
  "装修老板", "暖通师傅", "美容店", "搬家公司",
  "补习班", "割草园艺", "美甲店"
];

// 每次生成笔记数
const NOTES_PER_RUN = 2;

// 点赞过滤阈值
const MIN_LIKES = 100;
```

- [ ] **Step 1: 实现 `getIndustryCursor()` / `setIndustryCursor()`**

```typescript
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
```

- [ ] **Step 2: 实现 `searchKeyword(keyword)` — 调用 XHS MCP**

```typescript
async function searchKeyword(keyword: string): Promise<XhsInsight[]> {
  const mcpUrl = process.env.XHS_MCP_URL || "http://localhost:18060/mcp";
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "tools/call",
      params: { name: "search_feeds", arguments: { keyword, limit: 10 } },
    }),
  });
  const data = await res.json();
  const text = data.result?.content?.[0]?.text || "[]";
  const feeds = JSON.parse(text) as Array<{ note_id: string; title: string; liked_count: number }>;

  // 过滤 likes > MIN_LIKES，存入 XhsInsight
  const insights: XhsInsight[] = [];
  for (const f of feeds) {
    if ((f.liked_count ?? 0) < MIN_LIKES) continue;
    const insight = await db.xhsInsight.create({
      data: { keyword, xhsNoteId: f.note_id, title: f.title || "", likes: f.liked_count ?? 0 },
    });
    insights.push(insight);
  }
  return insights;
}
```

- [ ] **Step 3: 实现 `loadUserEditsContext()` — 读近期改动偏好**

```typescript
async function loadUserEditsContext(): Promise<string> {
  const recent = await db.xhsNote.findMany({
    where: { userEdits: { not: null }, approvedAt: { not: null } },
    orderBy: { approvedAt: "desc" },
    take: 10,
    select: { userEdits: true },
  });
  if (recent.length === 0) return "（暂无用户改动记录）";
  const edits = recent.map(n => n.userEdits).filter(Boolean);
  return `近期用户改动记录（用于学习风格偏好）：\n${edits.join("\n")}`;
}
```

- [ ] **Step 4: 实现 `analyzeAndGenerate(insights, userEditsCtx)` — LLM 一次调用**

```typescript
async function analyzeAndGenerate(
  insights: XhsInsight[],
  agentContext: string,
  userEditsCtx: string,
): Promise<Array<{ title: string; content: string; industry: string; contentAngle: string; tags: string[] }>> {
  const insightList = insights.map(i => `- 「${i.title}」（${i.keyword}，赞${i.likes}）`).join("\n");

  const prompt = `${agentContext}

## 任务：根据竞品爆款分析，为兜兜AI生成 ${NOTES_PER_RUN} 篇新笔记草稿

### 竞品爆款参考（今日抓取，赞 > ${MIN_LIKES}）
${insightList}

### 用户风格偏好（从历史改动学习）
${userEditsCtx}

### 输出要求
- 分析爆款规律（1-2句）
- 生成 ${NOTES_PER_RUN} 篇笔记，每篇包含：
  - title: 标题（≤20字）
  - content: 正文（200-400字，含 #标签）
  - industry: 行业（renovation/hvac/beauty/moving/landscaping/tutoring/general 之一）
  - contentAngle: pain_point | tool_review | case_study | data | comparison
  - tags: 3-5个标签

以 JSON 数组返回，格式：
[{"title":"...","content":"...","industry":"...","contentAngle":"...","tags":["..."]}]

只输出 JSON，不要其他文字。`;

  const llmRes = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM_API_KEY}` },
    body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 2000 }),
  });
  const data = await llmRes.json() as { choices: Array<{ message: { content: string } }> };
  const raw = data.choices[0]?.message?.content?.trim() || "[]";

  // 提取 JSON（LLM 有时会加 markdown 代码块）
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
}
```

- [ ] **Step 5: 实现 `saveDrafts(notes)` — 存 DB**

```typescript
async function saveDrafts(notes: GeneratedNote[]): Promise<string[]> {
  const ids: string[] = [];
  for (const n of notes) {
    const note = await db.xhsNote.create({
      data: {
        title: n.title,
        content: n.content,
        tags: JSON.stringify(n.tags),
        industry: n.industry,
        contentAngle: n.contentAngle,
        status: "draft",
        aiDraft: n.content, // 保存原始 AI 版本
      },
    });
    ids.push(note.id);
  }
  return ids;
}
```

- [ ] **Step 6: 实现 `sendNotification(drafts)` — 发通知**

```typescript
async function sendNotification(drafts: Array<{ title: string }>) {
  const webhookUrl = process.env.NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("   ℹ️  NOTIFY_WEBHOOK_URL 未设置，跳过通知");
    return;
  }
  const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:3100";
  const body = {
    text: [
      "🌟 小陈新选题到了！",
      "",
      ...drafts.map((d, i) => `📝 ${i + 1}. 「${d.title}」`),
      "",
      `👉 去审批：${dashboardUrl}`,
    ].join("\n"),
  };
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 7: 实现 `main()` 串联全流程**

```typescript
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

  // 2. 搜索并过滤
  const allInsights: XhsInsight[] = [];
  for (const kw of keywords) {
    const results = await searchKeyword(kw);
    console.log(`   "${kw}" → ${results.length} 条有效帖子`);
    allInsights.push(...results);
    await new Promise(r => setTimeout(r, 2000)); // 限速
  }

  if (allInsights.length === 0) {
    console.log("   没有找到足够的竞品数据，跳过本次生成");
    return;
  }

  // 3. 加载上下文
  const agentContext = loadAgentContext(); // 复用 optimize.ts 的函数
  const userEditsCtx = await loadUserEditsContext();

  // 4. LLM 分析 + 生成
  console.log("   🧠 LLM 分析爆款规律并生成新笔记...");
  const generated = await analyzeAndGenerate(allInsights, agentContext, userEditsCtx);
  console.log(`   生成 ${generated.length} 篇草稿`);

  // 5. 存 DB
  const ids = await saveDrafts(generated);

  // 6. 发通知
  await sendNotification(generated.map(n => ({ title: n.title })));

  // 7. 更新行业轮换游标
  await setIndustryCursor((cursor + 1) % INDUSTRY_KEYWORDS.length);

  console.log(`✅ 选题发现完成！草稿 ID: ${ids.join(", ")}`);
}
```

- [ ] **Step 8: Commit**

```bash
git add src/discover.ts
git commit -m "feat: add discover.ts — competitor research + LLM note generation"
```

---

## Task 3: Daemon 集成

**Files:**
- Modify: `src/daemon.ts`

- [ ] **Step 1: 导入 runDiscover**

```typescript
import { runDiscover } from "./discover";
```

- [ ] **Step 2: 新增 `checkAndDiscover()` 函数**

跟现有 `checkWeeklyReport()` 同样的模式：

```typescript
let lastDiscover = "";

async function checkAndDiscover() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  const hour = now.getHours();
  const dateStr = now.toISOString().split("T")[0];

  // 只在周一(1)、周三(3)、周五(5) 的 02:00-02:59 执行
  if (![1, 3, 5].includes(dayOfWeek)) return;
  if (hour !== 2) return;
  if (lastDiscover === dateStr) return;

  console.log(`[${now.toLocaleTimeString()}] 🔍 Running discover...`);
  try {
    await runDiscover();
    lastDiscover = dateStr;
  } catch (err) {
    console.error("Discover failed:", err);
  }
}
```

- [ ] **Step 3: 加入主循环**

在 `run()` 里的 `setInterval` 回调中加：

```typescript
await checkAndDiscover();
```

也在启动时的立即执行区块加一行：

```typescript
await checkAndDiscover();
```

以及 console.log 说明里加：

```typescript
console.log(`   Auto-discover: Mon/Wed/Fri 02:00 — competitor research + draft generation`);
```

- [ ] **Step 4: Commit**

```bash
git add src/daemon.ts
git commit -m "feat(daemon): trigger discover on Mon/Wed/Fri 02:00"
```

---

## Task 4: Dashboard 审批 API

**Files:**
- Modify: `src/dashboard.ts`

- [ ] **Step 1: 新增 `getDraftsApi()`**

```typescript
async function getDraftsApi() {
  const drafts = await db.xhsNote.findMany({
    where: { status: "draft" },
    orderBy: { createdAt: "desc" },
  });
  return drafts.map(n => ({
    ...n,
    tags: JSON.parse(n.tags || "[]"),
    hasImage: existsSync(resolve(IMAGES_DIR, `${n.id}.png`)),
  }));
}
```

- [ ] **Step 2: 新增 GET `/api/drafts` 路由**

在现有 GET 路由区块加：

```typescript
} else if (url.pathname === "/api/drafts") {
  const data = await getDraftsApi();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
```

- [ ] **Step 3: 新增 POST `/api/notes/:id/approve` 路由**

计算 diff，存 userEdits，更新 status → scheduled：

```typescript
} else if (url.pathname.match(/^\/api\/notes\/[^/]+\/approve$/) && req.method === "POST") {
  const id = url.pathname.split("/")[3];
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  await new Promise(r => req.on("end", r));
  const body = JSON.parse(Buffer.concat(chunks).toString()) as {
    title?: string;
    content?: string;
    scheduledAt?: string;
  };

  // 读取当前笔记（含 aiDraft）
  const note = await db.xhsNote.findUnique({ where: { id } });
  if (!note) { res.writeHead(404); res.end("Not found"); return; }

  // 计算 diff
  const finalTitle = body.title ?? note.title;
  const finalContent = body.content ?? note.content;
  const userEdits = JSON.stringify({
    titleChanged: finalTitle !== note.title,
    contentChanged: finalContent !== note.content,
    originalTitle: note.aiDraft ? note.title : undefined,
    summary: [
      finalTitle !== note.title ? `标题改动: 「${note.title}」→「${finalTitle}」` : null,
      finalContent !== note.content ? "正文有修改" : null,
    ].filter(Boolean).join("；") || "未修改",
  });

  // 计算排期（默认明天同一时间）
  const scheduledAt = body.scheduledAt
    ? new Date(body.scheduledAt)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.xhsNote.update({
    where: { id },
    data: {
      title: finalTitle,
      content: finalContent,
      status: "scheduled",
      scheduledAt,
      approvedAt: new Date(),
      userEdits,
    },
  });

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
```

- [ ] **Step 4: Commit**

```bash
git add src/dashboard.ts
git commit -m "feat(dashboard): add GET /api/drafts + POST /api/notes/:id/approve"
```

---

## Task 5: Dashboard UI — 草稿审批区

**Files:**
- Modify: `src/dashboard.html`

- [ ] **Step 1: 在导航栏加「草稿审批」标签**

找到现有 tab 导航（通常是 `<button onclick="showTab(...)">` 或类似），加一个：

```html
<button onclick="showTab('drafts')" id="tab-drafts">
  草稿审批 <span id="draft-badge" class="badge" style="display:none"></span>
</button>
```

- [ ] **Step 2: 新增草稿审批面板 HTML**

```html
<div id="tab-content-drafts" class="tab-content" style="display:none">
  <h2>待审批草稿</h2>
  <div id="drafts-list"></div>
</div>
```

- [ ] **Step 3: 新增 JS — 加载草稿**

```javascript
async function loadDrafts() {
  const res = await fetch('/api/drafts');
  const drafts = await res.json();

  // 更新 badge
  const badge = document.getElementById('draft-badge');
  if (drafts.length > 0) {
    badge.textContent = drafts.length;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }

  const container = document.getElementById('drafts-list');
  if (drafts.length === 0) {
    container.innerHTML = '<p style="color:#888">暂无待审批草稿</p>';
    return;
  }

  container.innerHTML = drafts.map(d => `
    <div class="draft-card" id="draft-${d.id}" style="border:1px solid #f0c040;border-radius:8px;padding:16px;margin-bottom:16px;background:#fffef0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:12px;color:#888">${new Date(d.createdAt).toLocaleString()} · ${d.industry || 'general'} · ${d.contentAngle || ''}</span>
      </div>
      <input id="title-${d.id}" value="${escapeHtml(d.title)}"
        style="width:100%;font-size:16px;font-weight:bold;border:1px solid #ddd;border-radius:4px;padding:6px;margin-bottom:8px">
      <textarea id="content-${d.id}" rows="8"
        style="width:100%;border:1px solid #ddd;border-radius:4px;padding:8px;font-size:14px;line-height:1.6">${escapeHtml(d.content)}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button onclick="approveDraft('${d.id}')"
          style="background:#1a7f37;color:#fff;border:none;border-radius:6px;padding:8px 20px;cursor:pointer;font-size:14px">
          ✅ 确认排期
        </button>
        <button onclick="discardDraft('${d.id}')"
          style="background:#cf222e;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:14px">
          🗑 丢弃
        </button>
      </div>
    </div>
  `).join('');
}

async function approveDraft(id) {
  const title = document.getElementById(`title-${id}`).value;
  const content = document.getElementById(`content-${id}`).value;
  await fetch(`/api/notes/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });
  document.getElementById(`draft-${id}`).remove();
  alert('✅ 已排期！');
  loadDrafts();
}

async function discardDraft(id) {
  if (!confirm('确定丢弃这篇草稿吗？')) return;
  await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  document.getElementById(`draft-${id}`).remove();
  loadDrafts();
}
```

- [ ] **Step 4: 在页面加载时 / tab 切换时调用 loadDrafts()**

```javascript
// 页面加载时
window.addEventListener('load', () => {
  loadDrafts();
  // 每 5 分钟刷新一次 badge
  setInterval(loadDrafts, 5 * 60 * 1000);
});
```

- [ ] **Step 5: 新增 DELETE `/api/notes/:id` 路由（丢弃草稿）**

在 `dashboard.ts` 的路由区加：

```typescript
} else if (url.pathname.match(/^\/api\/notes\/[^/]+$/) && req.method === "DELETE") {
  const id = url.pathname.replace("/api/notes/", "");
  await db.xhsNote.delete({ where: { id } });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
```

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.html src/dashboard.ts
git commit -m "feat(dashboard): add draft review UI with approve/discard"
```

---

## Task 6: 环境变量 + 部署

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`

- [ ] **Step 1: 更新 .env.example**

```bash
# 选题发现通知
NOTIFY_WEBHOOK_URL=   # POST JSON {text:"..."} 到这个 URL（可以是微信机器人、飞书、自建 webhook）
DASHBOARD_URL=http://your-vps-ip:3100  # 通知里的审批链接
```

- [ ] **Step 2: 更新 docker-compose.yml**

在 `tools` service 的 environment 区加：

```yaml
- NOTIFY_WEBHOOK_URL=${NOTIFY_WEBHOOK_URL:-}
- DASHBOARD_URL=${DASHBOARD_URL:-http://localhost:3100}
```

- [ ] **Step 3: 推到 GitHub + 部署 VPS**

```bash
# 同步到 pipeline repo
cp -r src/ prisma/ .env.example docker-compose.yml /path/to/xhs-pipeline/

cd /path/to/xhs-pipeline
git add -A
git commit -m "feat: xhs self-discovery — competitor research, draft review, user learning"
git push origin main

# VPS 部署
ssh root@72.61.74.110 'cd /opt/xhs-marketing && bash deploy.sh'
```

- [ ] **Step 4: 验证**

```bash
# 手动触发一次 discover（VPS 上）
ssh root@72.61.74.110 'docker exec xhs-marketing-tools-1 npx tsx src/discover.ts'

# 检查草稿是否出现在 dashboard
open http://72.61.74.110:3100
```

- [ ] **Step 5: Commit**

```bash
git add .env.example docker-compose.yml
git commit -m "chore: add NOTIFY_WEBHOOK_URL and DASHBOARD_URL env vars"
```

---

## 完成后的验证清单

- [ ] `npx prisma validate` 通过
- [ ] `docker exec ... npx tsx src/discover.ts` 成功运行，DB 里有草稿
- [ ] Dashboard 草稿审批区显示新草稿
- [ ] 点「确认排期」后草稿消失，状态变 `scheduled`
- [ ] `userEdits` 字段有内容（改了标题时显示改动，没改时显示「未修改」）
- [ ] 再次运行 `discover.ts`，行业轮换词换下一个
