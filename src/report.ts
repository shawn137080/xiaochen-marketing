/**
 * 自动生成周报/月报
 */

import { db } from "./db";
import {
  calculateEngagementRate,
  rankNotesByPerformance,
  findTopPerformingSegments,
  type NoteWithMetrics,
} from "./analytics";

export async function generateReport(
  periodType: "weekly" | "monthly",
  periodStart: Date,
  periodEnd: Date
): Promise<string> {
  // 获取期间内发布的笔记 + 最新指标
  const notes = await db.xhsNote.findMany({
    where: {
      status: "published",
      publishedAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      metrics: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
  });

  const notesWithMetrics: NoteWithMetrics[] = notes.map((n) => ({
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

  // 汇总数据
  let totalLikes = 0, totalComments = 0, totalBookmarks = 0;
  for (const n of notesWithMetrics) {
    if (n.latestMetrics) {
      totalLikes += n.latestMetrics.likes;
      totalComments += n.latestMetrics.comments;
      totalBookmarks += n.latestMetrics.bookmarks;
    }
  }

  // 排名和分析
  const ranked = rankNotesByPerformance(notesWithMetrics);
  const segments = findTopPerformingSegments(notesWithMetrics);
  const topNote = ranked[0] || null;
  const worstNote = ranked[ranked.length - 1] || null;

  // 生成 insights
  const insights: string[] = [];
  if (topNote) {
    insights.push(`🏆 最佳笔记: "${topNote.title}" (综合分 ${topNote.score}, 收藏赞比 ${topNote.bookmarkLikeRatio})`);
  }
  if (worstNote && ranked.length > 1) {
    insights.push(`📉 最弱笔记: "${worstNote.title}" (综合分 ${worstNote.score})`);
  }
  if (segments.length > 0) {
    insights.push(`📊 表现最好的方向: ${segments[0].segment} (平均互动 ${segments[0].avgEngagement})`);
  }
  const avgBookmarkLike = totalLikes > 0 ? (totalBookmarks / totalLikes).toFixed(2) : "N/A";
  insights.push(`📌 整体收藏/赞比: ${avgBookmarkLike}${Number(avgBookmarkLike) > 1 ? " ✅ 内容有高实用价值" : ""}`);

  // 生成 recommendations
  const recommendations: string[] = [];
  if (segments.length >= 2) {
    const best = segments[0];
    const worst = segments[segments.length - 1];
    recommendations.push(`多做 ${best.segment} 方向 (平均互动 ${best.avgEngagement}), 减少 ${worst.segment} (平均互动 ${worst.avgEngagement})`);
  }
  if (topNote && topNote.bookmarkLikeRatio > 1) {
    recommendations.push(`复制 "${topNote.title}" 的内容模式 — 收藏赞比 ${topNote.bookmarkLikeRatio}, 算法会持续推送`);
  }
  if (notes.length < (periodType === "weekly" ? 3 : 12)) {
    recommendations.push(`发布频率偏低 (${notes.length} 篇/${periodType === "weekly" ? "周" : "月"}), 建议增加到 ${periodType === "weekly" ? "3-4" : "12-16"} 篇`);
  }

  const insightsText = insights.join("\n");
  const recommendationsText = recommendations.join("\n");

  // 写入 DB
  const topNoteRecord = topNote
    ? await db.xhsNote.findUnique({ where: { id: topNote.id } })
    : null;

  await db.xhsReport.create({
    data: {
      periodType,
      periodStart,
      periodEnd,
      totalNotes: notes.length,
      totalLikes,
      totalComments,
      totalBookmarks,
      topNoteId: topNoteRecord?.id || null,
      insights: insightsText,
      recommendations: recommendationsText,
    },
  });

  const label = periodType === "weekly" ? "周报" : "月报";
  const summary = `
📋 ${label} (${periodStart.toISOString().split("T")[0]} ~ ${periodEnd.toISOString().split("T")[0]})
━━━━━━━━━━━━━━━━━━━━
📝 笔记数: ${notes.length}
❤️  总点赞: ${totalLikes}
💬 总评论: ${totalComments}
⭐ 总收藏: ${totalBookmarks}

${insightsText}

💡 建议:
${recommendationsText}
━━━━━━━━━━━━━━━━━━━━
`.trim();

  return summary;
}

// CLI 入口
if (process.argv[1]?.endsWith("report.ts")) {
  const type = (process.argv[2] || "weekly") as "weekly" | "monthly";
  const now = new Date();
  let start: Date;

  if (type === "monthly") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    start = new Date(now);
    start.setDate(start.getDate() - 7);
  }

  generateReport(type, start, now)
    .then((summary) => {
      console.log(summary);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
