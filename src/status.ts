/**
 * 查看当前排期和状态
 * 用法: npm run status
 */
import { db } from "./db";

async function main() {
  const notes = await db.xhsNote.findMany({
    orderBy: { scheduledAt: "asc" },
    include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 1 } },
  });

  if (notes.length === 0) {
    console.log("没有任何笔记。");
    return;
  }

  console.log(`\n📋 小陈的笔记排期 (共 ${notes.length} 篇)\n`);
  console.log("状态 | 发布时间           | 标题                    | 行业       | 互动数据");
  console.log("─".repeat(90));

  for (const note of notes) {
    const status =
      note.status === "published" ? "✅" :
      note.status === "scheduled" ? "⏰" :
      note.status === "draft" ? "📝" : "📦";

    const date = note.status === "published"
      ? note.publishedAt?.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) || ""
      : note.scheduledAt?.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) || "未排期";

    const title = note.title.padEnd(20).slice(0, 20);
    const industry = (note.industry || "通用").padEnd(10).slice(0, 10);

    const m = note.metrics[0];
    const metrics = m
      ? `赞:${m.likes} 评:${m.comments} 藏:${m.bookmarks} 转:${m.shares}`
      : "—";

    console.log(`${status}   | ${date.padEnd(18)} | ${title} | ${industry} | ${metrics}`);
  }

  // 汇总
  const scheduled = notes.filter((n) => n.status === "scheduled").length;
  const published = notes.filter((n) => n.status === "published").length;
  const draft = notes.filter((n) => n.status === "draft").length;

  console.log(`\n📊 汇总: ${scheduled} 篇排期 | ${published} 篇已发布 | ${draft} 篇草稿\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
