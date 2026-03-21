/**
 * 发布脚本 — 从 DB 读取草稿，通过 MCP 发布到小红书，回填 DB
 *
 * 用法: npx tsx src/publish.ts <noteId>
 * 或由小陈在 Claude Code 中直接调用
 */

import { db } from "./db";
import { sanitizeNote } from "./sanitize";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const IMAGES_DIR = resolve(__dirname, "../images");

const MCP_URL = process.env.XHS_MCP_URL || "http://localhost:18060/mcp";

interface McpResponse {
  result?: {
    content?: Array<{ type: string; text: string }>;
  };
  error?: { message: string; code?: number };
}

let mcpSessionId: string | null = null;

async function ensureMcpSession(): Promise<string> {
  if (mcpSessionId) return mcpSessionId;

  // 1. Initialize
  const initRes = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "xhs-daemon", version: "1.0" },
      },
    }),
  });

  const sessionId = initRes.headers.get("Mcp-Session-Id");
  if (!sessionId) throw new Error("MCP server did not return session ID");

  // 2. Send initialized notification
  await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
  });

  mcpSessionId = sessionId;
  return sessionId;
}

async function callMcp(tool: string, args: Record<string, unknown>): Promise<McpResponse> {
  const sessionId = await ensureMcpSession();

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  if (!res.ok) {
    throw new Error(`MCP request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as McpResponse;

  // Session 过期时重试一次
  if (data.error?.message?.includes("session initialization")) {
    mcpSessionId = null;
    return callMcp(tool, args);
  }

  return data;
}

async function publish(noteId: string) {
  // 1. 从 DB 读取草稿
  const note = await db.xhsNote.findUnique({ where: { id: noteId } });
  if (!note) {
    console.error(`Note ${noteId} not found`);
    process.exit(1);
  }
  if (note.status === "published") {
    console.error(`Note ${noteId} is already published (xhsNoteId: ${note.xhsNoteId})`);
    process.exit(1);
  }

  // 2. 脱敏处理
  const sanitized = sanitizeNote({
    title: note.title,
    content: note.content,
    tags: note.tags || "[]",
  });

  if (sanitized.changes.length > 0) {
    console.log("🔤 脱敏替换:");
    sanitized.changes.forEach(c => console.log("   ", c));
  } else {
    console.log("🔤 脱敏检查通过，无需替换");
  }

  const tags: string[] = JSON.parse(sanitized.tags);

  console.log(`Publishing: "${sanitized.title}"`);
  console.log(`Tags: ${tags.join(", ")}`);

  // 3. 通过 MCP 发布
  const imagePath = resolve(IMAGES_DIR, `${noteId}.png`);
  const hasImage = existsSync(imagePath);

  if (!hasImage && note.noteType !== "video") {
    console.error(`No image found at images/${noteId}.png. publish_content requires images.`);
    process.exit(1);
  }

  const mcpArgs: Record<string, unknown> = {
    title: sanitized.title,
    content: sanitized.content,
    ...(tags.length > 0 && { tags }),
    ...(hasImage && { images: [imagePath] }),
  };

  // 只有定时时间在 65 分钟以上才传 schedule_at（XHS 要求至少 1 小时后）
  if (note.scheduledAt && note.scheduledAt.getTime() > Date.now() + 65 * 60 * 1000) {
    mcpArgs.schedule_at = note.scheduledAt.toISOString();
  }

  const toolName = note.noteType === "video" ? "publish_with_video" : "publish_content";
  const response = await callMcp(toolName, mcpArgs);

  if (response.error) {
    console.error("MCP publish failed:", response.error.message);
    // 即使失败也记录尝试
    await db.xhsNote.update({
      where: { id: noteId },
      data: { updatedAt: new Date() },
    });
    process.exit(1);
  }

  // 4. 解析返回的笔记 ID
  const resultText = response.result?.content?.[0]?.text || "";
  console.log("MCP response:", resultText);

  // 检查 MCP 文本里是否包含失败信息
  if (resultText.includes("失败") || resultText.includes("failed") || resultText.includes("error")) {
    console.error("❌ Publish failed (detected in response text)");
    process.exit(1);
  }

  // 尝试从返回文本中提取笔记 ID（格式因 MCP 版本而异）
  const idMatch = resultText.match(/note[_\s]?id[:\s]*([a-zA-Z0-9]+)/i)
    || resultText.match(/([a-f0-9]{24})/);
  const xhsNoteId = idMatch?.[1] || null;

  // 5. 更新 DB
  const updated = await db.xhsNote.update({
    where: { id: noteId },
    data: {
      status: "published",
      publishedAt: new Date(),
      ...(xhsNoteId && { xhsNoteId }),
    },
  });

  console.log(`✅ Published! DB status: ${updated.status}`);
  if (xhsNoteId) {
    console.log(`   XHS Note ID: ${xhsNoteId}`);
  } else {
    console.log("   ⚠️  Could not extract XHS note ID from response. Backfill manually.");
  }

  return updated;
}

export { publish, callMcp };

// CLI 入口
if (process.argv[1]?.endsWith("publish.ts")) {
  const noteId = process.argv[2];
  if (!noteId) {
    console.error("Usage: npx tsx src/publish.ts <noteId>");
    process.exit(1);
  }

  publish(noteId)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Publish error:", err);
      process.exit(1);
    });
}
