import { describe, it, expect } from "vitest";
import {
  calculateEngagementRate,
  calculateBookmarkLikeRatio,
  calculateGrowthRates,
  rankNotesByPerformance,
  findTopPerformingSegments,
  isThemeDuplicate,
  type MetricSnapshot,
  type NoteWithMetrics,
} from "./analytics";

const metrics = (
  likes: number,
  comments: number,
  bookmarks: number,
  shares: number
): MetricSnapshot => ({ likes, comments, bookmarks, shares });

const note = (
  id: string,
  title: string,
  m: MetricSnapshot,
  opts: Partial<NoteWithMetrics> = {}
): NoteWithMetrics => ({
  id,
  title,
  industry: opts.industry ?? null,
  contentAngle: opts.contentAngle ?? null,
  titleFormula: opts.titleFormula ?? null,
  publishedAt: opts.publishedAt ?? new Date(),
  latestMetrics: m,
});

describe("calculateEngagementRate", () => {
  it("returns 0 for zero metrics", () => {
    expect(calculateEngagementRate(metrics(0, 0, 0, 0))).toBe(0);
  });

  it("weights bookmarks highest", () => {
    const likesOnly = calculateEngagementRate(metrics(10, 0, 0, 0));
    const bookmarksOnly = calculateEngagementRate(metrics(0, 0, 10, 0));
    expect(bookmarksOnly).toBeGreaterThan(likesOnly);
  });

  it("weights comments higher than likes", () => {
    const likesOnly = calculateEngagementRate(metrics(10, 0, 0, 0));
    const commentsOnly = calculateEngagementRate(metrics(0, 10, 0, 0));
    expect(commentsOnly).toBeGreaterThan(likesOnly);
  });

  it("calculates weighted score correctly", () => {
    // 10*1 + 5*2 + 3*3 + 2*1.5 = 10 + 10 + 9 + 3 = 32
    expect(calculateEngagementRate(metrics(10, 5, 3, 2))).toBe(32);
  });
});

describe("calculateBookmarkLikeRatio", () => {
  it("returns 0 for both zero", () => {
    expect(calculateBookmarkLikeRatio(0, 0)).toBe(0);
  });

  it("returns Infinity for bookmarks with no likes", () => {
    expect(calculateBookmarkLikeRatio(5, 0)).toBe(Infinity);
  });

  it("calculates ratio correctly", () => {
    expect(calculateBookmarkLikeRatio(30, 10)).toBe(3);
  });

  it("returns <1 when likes dominate", () => {
    expect(calculateBookmarkLikeRatio(5, 100)).toBe(0.05);
  });
});

describe("calculateGrowthRates", () => {
  it("returns 0 for identical snapshots", () => {
    const m = metrics(10, 5, 3, 2);
    const rates = calculateGrowthRates(m, m);
    expect(rates.likes).toBe(0);
    expect(rates.total).toBe(0);
  });

  it("calculates 100% for zero-to-nonzero", () => {
    const rates = calculateGrowthRates(metrics(0, 0, 0, 0), metrics(10, 5, 3, 2));
    expect(rates.likes).toBe(100);
    expect(rates.total).toBe(100);
  });

  it("calculates correct percentage", () => {
    const rates = calculateGrowthRates(metrics(10, 10, 10, 10), metrics(20, 15, 10, 10));
    expect(rates.likes).toBe(100); // 10 → 20
    expect(rates.comments).toBe(50); // 10 → 15
    expect(rates.bookmarks).toBe(0); // unchanged
  });
});

describe("rankNotesByPerformance", () => {
  it("returns empty for no notes", () => {
    expect(rankNotesByPerformance([])).toEqual([]);
  });

  it("filters out notes without metrics", () => {
    const notes: NoteWithMetrics[] = [
      { id: "1", title: "A", industry: null, contentAngle: null, titleFormula: null, publishedAt: null, latestMetrics: null },
    ];
    expect(rankNotesByPerformance(notes)).toEqual([]);
  });

  it("ranks higher engagement first", () => {
    const ranked = rankNotesByPerformance([
      note("1", "Low", metrics(1, 0, 0, 0)),
      note("2", "High", metrics(10, 10, 10, 10)),
    ]);
    expect(ranked[0].id).toBe("2");
    expect(ranked[1].id).toBe("1");
  });

  it("boosts notes with high bookmark/like ratio", () => {
    // Same total engagement but different bookmark ratios
    const ranked = rankNotesByPerformance([
      note("1", "Likes heavy", metrics(20, 5, 2, 3)), // low bookmark ratio
      note("2", "Bookmarks heavy", metrics(2, 5, 20, 3)), // high bookmark ratio
    ]);
    expect(ranked[0].id).toBe("2");
  });
});

describe("findTopPerformingSegments", () => {
  it("returns empty for no notes", () => {
    expect(findTopPerformingSegments([])).toEqual([]);
  });

  it("groups by industry and angle", () => {
    const notes = [
      note("1", "A", metrics(10, 5, 3, 2), { industry: "renovation", contentAngle: "pain_point" }),
      note("2", "B", metrics(20, 10, 5, 3), { industry: "renovation", contentAngle: "case_study" }),
      note("3", "C", metrics(5, 2, 1, 1), { industry: "cleaning", contentAngle: "pain_point" }),
    ];
    const segments = findTopPerformingSegments(notes);
    const industries = segments.filter((s) => s.segment.startsWith("industry:"));
    const angles = segments.filter((s) => s.segment.startsWith("angle:"));

    expect(industries.length).toBe(2);
    expect(angles.length).toBe(2);
    // renovation should rank higher than cleaning
    expect(industries[0].segment).toBe("industry:renovation");
  });
});

describe("isThemeDuplicate", () => {
  const existing = ["装修漏电话损失", "清洁公司接单技巧", "HVAC 淡季策略"];

  it("detects exact match", () => {
    expect(isThemeDuplicate("装修漏电话损失", existing)).toBe(true);
  });

  it("detects substring match", () => {
    expect(isThemeDuplicate("漏电话损失", existing)).toBe(true);
  });

  it("detects containing match", () => {
    expect(isThemeDuplicate("多伦多装修漏电话损失分析", existing)).toBe(true);
  });

  it("returns false for unrelated theme", () => {
    expect(isThemeDuplicate("搬家公司获客方法", existing)).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isThemeDuplicate("hvac 淡季策略", existing)).toBe(true);
  });

  it("handles empty existing list", () => {
    expect(isThemeDuplicate("任何选题", [])).toBe(false);
  });
});
