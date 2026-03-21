import { describe, it, expect } from "vitest";
import { sanitize, sanitizeNote } from "./sanitize";

describe("sanitize", () => {
  it("替换独立的 AI 为 兜兜", () => {
    const { result } = sanitize("用AI帮你接电话");
    expect(result).not.toContain("AI");
  });

  it("替换 兜兜AI 为 兜兜", () => {
    const { result } = sanitize("兜兜AI帮你省时间");
    expect(result).toBe("兜兜帮你省时间");
  });

  it("替换 AI接电话", () => {
    const { result } = sanitize("AI接电话不漏单");
    expect(result).toBe("兜兜帮你接不漏单");
    // 组合词整体替换，"接电话" 中的"电话"二字被一并吸收
  });

  it("不影响正常文本", () => {
    const { result, changes } = sanitize("帮华人老板省时间赚更多钱");
    expect(result).toBe("帮华人老板省时间赚更多钱");
    expect(changes).toHaveLength(0);
  });

  it("记录改动日志", () => {
    const { changes } = sanitize("AI帮你接电话，100%保证不漏单");
    expect(changes.length).toBeGreaterThan(0);
  });
});

describe("sanitizeNote", () => {
  it("同时处理标题和正文", () => {
    const { title, content, changes } = sanitizeNote({
      title: "AI接电话不漏单",
      content: "用AI帮你省时间，人工智能时代",
      tags: '["AI助手","智能接单"]',
    });
    expect(title).not.toContain("AI");
    expect(content).not.toContain("AI");
    expect(changes.length).toBeGreaterThan(0);
  });

  it("正确处理 tags JSON", () => {
    const { tags } = sanitizeNote({
      title: "测试",
      content: "测试",
      tags: '["AI工具","效率"]',
    });
    const parsed = JSON.parse(tags);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed.some((t: string) => t.includes("AI"))).toBe(false);
  });
});
