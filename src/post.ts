/**
 * 一键发布 — 存 DB + 发小红书，一步完成
 *
 * 用法 1（JSON 参数）:
 *   npm run post -- --title "标题" --content "正文" --tags "#tag1,#tag2" --industry renovation
 *
 * 用法 2（stdin JSON，适合小陈在 Claude Code 中调用）:
 *   echo '{"title":"标题","content":"正文","tags":["#tag1"],"industry":"renovation"}' | npm run post
 *
 * 用法 3（定时发布）:
 *   npm run post -- --title "标题" --content "正文" --schedule "2026-03-25T10:00:00"
 *   → 存为 scheduled 状态，daemon 到时间自动发
 */

import { db } from "./db";
import { callMcp } from "./publish";

interface PostInput {
  title: string;
  content: string;
  tags?: string[];
  noteType?: "image" | "video";
  industry?: string;
  contentAngle?: string;
  titleFormula?: string;
  schedule?: string; // ISO 日期，设了就定时发布
}

function parseArgs(): PostInput | null {
  const args = process.argv.slice(2);
  if (args.length === 0) return null; // 走 stdin

  const input: Partial<PostInput> = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--title": input.title = args[++i]; break;
      case "--content": input.content = args[++i]; break;
      case "--tags": input.tags = args[++i]?.split(",").map((t) => t.trim()); break;
      case "--industry": input.industry = args[++i]; break;
      case "--angle": input.contentAngle = args[++i]; break;
      case "--formula": input.titleFormula = args[++i]; break;
      case "--type": input.noteType = args[++i] as "image" | "video"; break;
      case "--schedule": input.schedule = args[++i]; break;
    }
  }

  if (!input.title || !input.content) return null;
  return input as PostInput;
}

async function readStdin(): Promise<PostInput | null> {
  // 检查 stdin 是否有数据（非 TTY）
  if (process.stdin.isTTY) return null;

  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });
    // 3 秒超时
    setTimeout(() => resolve(null), 3000);
  });
}

async function post(input: PostInput) {
  const isScheduled = !!input.schedule;
  const tags = input.tags || [];

  // 1. 选题去重检查
  const themeKey = input.title.toLowerCase();
  const existingThemes = await db.xhsContentTheme.findMany({
    select: { theme: true },
  });
  const isDup = existingThemes.some(
    (t) => t.theme.toLowerCase().includes(themeKey) || themeKey.includes(t.theme.toLowerCase())
  );
  if (isDup) {
    console.log("⚠️  选题可能重复，相似的主题已发过。继续发布...");
  }

  // 2. 存 DB
  const note = await db.xhsNote.create({
    data: {
      title: input.title,
      content: input.content,
      tags: JSON.stringify(tags),
      noteType: input.noteType || "image",
      industry: input.industry || null,
      contentAngle: input.contentAngle || null,
      titleFormula: input.titleFormula || null,
      status: isScheduled ? "scheduled" : "draft",
      scheduledAt: isScheduled ? new Date(input.schedule!) : null,
    },
  });

  // 记录选题
  await db.xhsContentTheme.create({
    data: { theme: input.title, noteId: note.id },
  });

  // 3. 如果是定时发布，存好就行，daemon 会处理
  if (isScheduled) {
    console.log(`⏰ 已排期: "${input.title}"`);
    console.log(`   发布时间: ${input.schedule}`);
    console.log(`   Note ID: ${note.id}`);
    console.log("   daemon 会在到期时自动发布");
    return note;
  }

  // 4. 立即发布
  console.log(`🚀 Publishing: "${input.title}"`);

  const mcpArgs: Record<string, unknown> = {
    title: input.title,
    content: input.content,
    ...(tags.length > 0 && { tags }),
  };

  const toolName = input.noteType === "video" ? "publish_with_video" : "publish_content";
  const response = await callMcp(toolName, mcpArgs);

  if (response.error) {
    console.error("❌ MCP publish failed:", response.error.message);
    await db.xhsNote.update({ where: { id: note.id }, data: { status: "draft" } });
    return note;
  }

  // 5. 解析笔记 ID，更新 DB
  const resultText = response.result?.content?.[0]?.text || "";
  const idMatch = resultText.match(/note[_\s]?id[:\s]*([a-zA-Z0-9]+)/i)
    || resultText.match(/([a-f0-9]{24})/);
  const xhsNoteId = idMatch?.[1] || null;

  const updated = await db.xhsNote.update({
    where: { id: note.id },
    data: {
      status: "published",
      publishedAt: new Date(),
      ...(xhsNoteId && { xhsNoteId }),
    },
  });

  console.log(`✅ Done!`);
  console.log(`   DB ID: ${updated.id}`);
  if (xhsNoteId) console.log(`   XHS ID: ${xhsNoteId}`);
  console.log("   24h/72h 后 daemon 会自动采集指标");

  return updated;
}

// 入口
(async () => {
  const input = parseArgs() || (await readStdin());

  if (!input || !input.title || !input.content) {
    console.error(`Usage:
  npm run post -- --title "标题" --content "正文" [--tags "#t1,#t2"] [--industry renovation] [--schedule "2026-03-25T10:00:00"]

  Or pipe JSON:
  echo '{"title":"标题","content":"正文"}' | npm run post`);
    process.exit(1);
  }

  await post(input);
  process.exit(0);
})();

export { post };
