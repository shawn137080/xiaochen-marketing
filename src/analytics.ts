/**
 * 小红书数据分析工具 — 纯函数，无副作用
 */

export interface MetricSnapshot {
  likes: number;
  comments: number;
  bookmarks: number;
  shares: number;
}

export interface NoteWithMetrics {
  id: string;
  title: string;
  industry: string | null;
  contentAngle: string | null;
  titleFormula: string | null;
  publishedAt: Date | null;
  latestMetrics: MetricSnapshot | null;
}

export interface GrowthRates {
  likes: number;
  comments: number;
  bookmarks: number;
  shares: number;
  total: number;
}

export interface RankedNote {
  id: string;
  title: string;
  score: number;
  engagementRate: number;
  bookmarkLikeRatio: number;
}

export interface SegmentAnalysis {
  segment: string;
  noteCount: number;
  avgEngagement: number;
  totalLikes: number;
  totalBookmarks: number;
}

// 互动总量
function totalEngagement(m: MetricSnapshot): number {
  return m.likes + m.comments + m.bookmarks + m.shares;
}

/**
 * 互动率 = (赞 + 评 + 藏 + 转) 的加权分
 * 权重：收藏 > 评论 > 点赞 > 分享（收藏代表实用价值，评论代表互动深度）
 */
export function calculateEngagementRate(metrics: MetricSnapshot): number {
  const weighted =
    metrics.likes * 1 +
    metrics.comments * 2 +
    metrics.bookmarks * 3 +
    metrics.shares * 1.5;
  return weighted;
}

/**
 * 收藏/赞比 — >1 说明内容有高实用价值，算法会持续推送
 */
export function calculateBookmarkLikeRatio(
  bookmarks: number,
  likes: number
): number {
  if (likes === 0) return bookmarks > 0 ? Infinity : 0;
  return bookmarks / likes;
}

/**
 * 两次快照间的增长率（百分比）
 */
export function calculateGrowthRates(
  earlier: MetricSnapshot,
  later: MetricSnapshot
): GrowthRates {
  const rate = (prev: number, curr: number) =>
    prev === 0 ? (curr > 0 ? 100 : 0) : ((curr - prev) / prev) * 100;

  return {
    likes: rate(earlier.likes, later.likes),
    comments: rate(earlier.comments, later.comments),
    bookmarks: rate(earlier.bookmarks, later.bookmarks),
    shares: rate(earlier.shares, later.shares),
    total: rate(totalEngagement(earlier), totalEngagement(later)),
  };
}

/**
 * 综合评分排名
 */
export function rankNotesByPerformance(notes: NoteWithMetrics[]): RankedNote[] {
  return notes
    .filter((n) => n.latestMetrics !== null)
    .map((n) => {
      const m = n.latestMetrics!;
      const engagementRate = calculateEngagementRate(m);
      const bookmarkLikeRatio = calculateBookmarkLikeRatio(
        m.bookmarks,
        m.likes
      );
      // 综合分 = 加权互动 + 收藏赞比加成
      const score =
        engagementRate * (1 + Math.min(bookmarkLikeRatio, 3) * 0.2);
      return {
        id: n.id,
        title: n.title,
        score: Math.round(score * 100) / 100,
        engagementRate: Math.round(engagementRate * 100) / 100,
        bookmarkLikeRatio: Math.round(bookmarkLikeRatio * 100) / 100,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * 找出表现最好的行业和内容角度
 */
export function findTopPerformingSegments(
  notes: NoteWithMetrics[]
): SegmentAnalysis[] {
  const segments = new Map<string, { total: number; count: number; likes: number; bookmarks: number }>();

  for (const note of notes) {
    if (!note.latestMetrics) continue;
    const keys = [
      note.industry ? `industry:${note.industry}` : null,
      note.contentAngle ? `angle:${note.contentAngle}` : null,
    ].filter(Boolean) as string[];

    for (const key of keys) {
      const existing = segments.get(key) || { total: 0, count: 0, likes: 0, bookmarks: 0 };
      existing.total += calculateEngagementRate(note.latestMetrics);
      existing.count += 1;
      existing.likes += note.latestMetrics.likes;
      existing.bookmarks += note.latestMetrics.bookmarks;
      segments.set(key, existing);
    }
  }

  return Array.from(segments.entries())
    .map(([segment, data]) => ({
      segment,
      noteCount: data.count,
      avgEngagement: Math.round((data.total / data.count) * 100) / 100,
      totalLikes: data.likes,
      totalBookmarks: data.bookmarks,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);
}

/**
 * 选题去重检查 — 简单的关键词包含匹配
 */
export function isThemeDuplicate(
  newTheme: string,
  existingThemes: string[]
): boolean {
  const normalized = newTheme.toLowerCase().trim();
  return existingThemes.some((t) => {
    const existing = t.toLowerCase().trim();
    return (
      existing.includes(normalized) ||
      normalized.includes(existing) ||
      jaroWinklerSimilarity(normalized, existing) > 0.85
    );
  });
}

/**
 * Jaro-Winkler 字符串相似度（0-1）
 */
function jaroWinklerSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchWindow = Math.max(Math.floor(Math.max(s1.length, s2.length) / 2) - 1, 0);
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler boost for common prefix (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}
