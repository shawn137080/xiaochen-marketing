/**
 * 用 Gemini API 为排期笔记生成配图
 * 两步流程：
 *   1. LLM（LLM_API_KEY）读取 skills/xhs-image-prompts/SKILL.md + 笔记内容 → 输出 Gemini 图片 prompt
 *   2. Gemini 根据 prompt 生成图片
 * 这样技能文件更新后生图质量自动提升，无需改代码。
 */
import { db } from "./db";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";
const IMAGES_DIR = process.env.XHS_IMAGES_DIR || resolve(__dirname, "../images");

// LLM 配置（用于生成 image prompt）
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://aiberm.com/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "google/gemini-3-flash";

// 加载技能指南（运行时读取，确保使用最新版本）
function loadSkillGuide(): string {
  const skillPath = resolve(__dirname, "../skills/xhs-image-prompts/SKILL.md");
  try {
    return readFileSync(skillPath, "utf-8");
  } catch {
    console.warn("   ⚠️  找不到 skills/xhs-image-prompts/SKILL.md，使用内置 prompt");
    return "";
  }
}

// ── 模板类型 ──────────────────────────────────────────────────────────────
type Template = "scene" | "data" | "tool" | "before_after" | "text_card";

interface NoteImageConfig {
  template: Template;
  hookText: string;       // 大字钩子（2行，用\n分隔）
  subText?: string;
  bigNumber?: string;
  bigLabel?: string;
  dataSub1?: string;
  dataSub2?: string;
}

const NOTE_CONFIGS: Record<string, NoteImageConfig> = {
  "美容师做着项目，电话又断了": {
    template: "scene",
    hookText: "做着项目\n电话又断了",
    subText: "你不知道那头是谁",
  },
  "华人小老板开店必装的3个AI工具": {
    template: "tool",
    hookText: "华人老板必装\n3个智能工具",
    subText: "① 自动接听  ② 自动预约  ③ 报价模板",
  },
  "补习班招生季，漏一个电话损失多少": {
    template: "data",
    hookText: "漏一个电话\n损失多少钱",
    bigNumber: "1个学生",
    bigLabel: "一年的学费你算过吗",
    dataSub1: "平均留存 8–10 个月",
    dataSub2: "接到 = 留住",
  },
  "水管师傅开车途中，那个电话断了": {
    template: "scene",
    hookText: "开车途中\n那个电话断了",
    subText: "等你回拨，他已找到别人",
  },
  "装修老板实测90天：AI接电话真实数据": {
    template: "data",
    hookText: "实测90天\n成单数据来了",
    bigNumber: "+133%",
    bigLabel: "成单数提升",
    dataSub1: "三个月，收入明显多了",
  },
  "美甲店零漏单的秘密：就这一个设置": {
    template: "tool",
    hookText: "美甲店零漏单\n就这1步设置",
    subText: "5分钟搞定，客人说「你们好专业」",
  },
  "AI时代，不用AI的老板输在哪里": {
    template: "before_after",
    hookText: "用了和没用\n差距已经出来了",
  },
  "割草旺季到了，一个人怎么接得过来": {
    template: "scene",
    hookText: "旺季电话不停\n一个人怎么接",
    subText: "漏一个，就是漏一单",
  },
  "搬家旺季：有AI接电话和没有的区别": {
    template: "before_after",
    hookText: "旺季多接好几个单\n他就靠这一个变化",
  },
  "来加拿大创业2年，我最后悔的一件事": {
    template: "text_card",
    hookText: "来加拿大创业 2 年\n最后悔的一件事",
    subText: "不是选错行业，不是定价太低\n是没早点用自动接听",
  },
  "空调季来了，暖通师傅你接得过来吗": {
    template: "scene",
    hookText: "空调季到了\n你接得过来吗",
    subText: "旺季每漏一个，损失的不只是一单",
  },
  "清洁公司收到差评那天，我反思了这件事": {
    template: "scene",
    hookText: "因为没接电话\n我收到了差评",
    subText: "客人不在乎你多努力，只在乎有没有人接",
  },
  "为什么同行接单比你快？就差这一步": {
    template: "tool",
    hookText: "同行接单\n为什么比你快",
    subText: "就差这一步 →",
  },
};

interface GeminiResponse {
  candidates?: Array<{ content: { parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }>;
  error?: { message: string };
}

// ── Step 1: LLM 根据技能指南生成 Gemini image prompt ─────────────────────

async function generateImagePromptWithSkill(
  note: { title: string; content: string; industry: string | null; contentAngle: string | null },
  cfg: NoteImageConfig,
  skillGuide: string,
): Promise<string | null> {
  if (!LLM_API_KEY) return null;

  const [hookLine1, hookLine2] = cfg.hookText.split("\n");

  const systemPrompt = `You are a Xiaohongshu (Chinese social media) viral image designer for 兜兜AI, serving Chinese-Canadian small business owners.
Write a Gemini image generation prompt IN ENGLISH. The image must contain specific Chinese text elements listed below.

Design style guide (for reference):
---
${skillGuide}
---

HARD RULES (never violate):
1. The prompt must be written IN ENGLISH
2. The Chinese text elements must appear VERBATIM in the image as specified in the user message
3. Brand name in the image must be exactly: 兜兜AI
4. Art style: FLAT 2D cartoon / Korean webtoon style — round-head stick figures, bold outlines, simple shapes, NO realistic faces, NO photographs
5. Output ONLY the prompt text, no explanations or prefixes`;

  const userPrompt = `Write an English Gemini image prompt for this Xiaohongshu post:

Note title: ${note.title}
Industry: ${note.industry ?? "general"}
Template type: ${note.contentAngle ?? cfg.template}

REQUIRED Chinese text in the image (copy exactly):
- Large headline text in TOP LEFT corner, bold coral red (#FF5C5C), two lines:
  Line 1: ${hookLine1}
  ${hookLine2 ? `Line 2: ${hookLine2}` : ""}
- Small brand text at BOTTOM CENTER: 兜兜AI (dark gray, small)
${cfg.subText ? `- Supporting subtitle text: ${cfg.subText}` : ""}
${cfg.bigNumber ? `- Giant number in center of image: ${cfg.bigNumber}
- Label below number: ${cfg.bigLabel ?? ""}` : ""}
${cfg.dataSub1 ? `- Supporting stats: ${cfg.dataSub1} ${cfg.dataSub2 ?? ""}` : ""}

Aspect ratio: ${cfg.template === "scene" || cfg.template === "before_after" ? "3:4" : "9:16"}
Background: cream white #FFF9F0 (or dark near-black for data posters)
NO watermarks, NO realistic faces, NO complex backgrounds, NO gradients`;

  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 800,
        temperature: 0.7,
      }),
    });
    const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.error(`   LLM error:`, err);
    return null;
  }
}

// ── Step 2: Gemini 根据 prompt 生成图片 ──────────────────────────────────

async function callGemini(prompt: string, aspectRatio: "3:4" | "9:16" = "3:4"): Promise<Buffer | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio },
      },
    }),
  });
  const data = (await res.json()) as GeminiResponse;
  if (data.error) { console.error(`   Gemini error: ${data.error.message}`); return null; }
  for (const part of data.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) return Buffer.from(part.inlineData.data, "base64");
  }
  return null;
}

// 根据模板类型决定比例
function getAspectRatio(template: Template): "3:4" | "9:16" {
  return template === "scene" || template === "before_after" ? "3:4" : "9:16";
}

// ── 主流程 ────────────────────────────────────────────────────────────────
async function main() {
  if (!GEMINI_API_KEY) { console.error("GEMINI_API_KEY is required"); process.exit(1); }

  const skillGuide = loadSkillGuide();
  const useSkill = !!skillGuide && !!LLM_API_KEY;
  console.log(useSkill
    ? "🧠 技能模式：LLM 读取 SKILL.md → 生成 prompt → Gemini 生图\n"
    : "⚙️  标准模式：使用内置 prompt（未配置 LLM_API_KEY 或找不到技能文件）\n"
  );

  const allNotes = await db.xhsNote.findMany({
    where: { status: "scheduled" },
    orderBy: { scheduledAt: "asc" },
  });

  const notes = allNotes.filter(n => NOTE_CONFIGS[n.title]);
  console.log(`🎨 生成 ${notes.length} 篇笔记配图\n`);

  for (const note of notes) {
    const cfg = NOTE_CONFIGS[note.title];
    const filepath = resolve(IMAGES_DIR, `${note.id}.png`);
    const ratio = getAspectRatio(cfg.template);

    console.log(`📐 [${cfg.template}/${ratio}] "${note.title}"`);

    let imagePrompt: string | null = null;

    // Step 1: 用技能指南生成 image prompt（有 LLM 时）
    if (useSkill) {
      imagePrompt = await generateImagePromptWithSkill(
        { title: note.title, content: note.content, industry: note.industry, contentAngle: note.contentAngle },
        cfg,
        skillGuide,
      );
      if (imagePrompt) {
        console.log(`   🧠 LLM prompt: ${imagePrompt.slice(0, 80)}...`);
      } else {
        console.log(`   ⚠️  LLM 未返回 prompt，使用内置模板`);
      }
    }

    // Step 2: 生成图片（用 LLM prompt 或内置 fallback）
    if (!imagePrompt) {
      // 内置 fallback prompt（精简版）
      const [h1, h2] = cfg.hookText.split("\n");
      imagePrompt = cfg.template === "data"
        ? `设计小红书竖版9:16数据海报，深色背景，核心数字"${cfg.bigNumber ?? ""}"超大珊瑚红字体居中，左上角白色粗黑体标题"${h1} ${h2}"，中部说明"${cfg.bigLabel ?? ""}"，支撑数据"${cfg.dataSub1 ?? ""} ${cfg.dataSub2 ?? ""}"，右侧点缀扁平卡通小人表情包元素，底部居中小字"兜兜AI"。简洁专业。无水印。`
        : cfg.template === "tool"
        ? `创作扁平漫画风格信息图卡片，比例9:16竖版，奶油米白背景，左上角珊瑚红粗黑体大标题"${h1} ${h2}"，副标题"${cfg.subText ?? ""}"，画面穿插小红书爆款扁平线条小人插画（手机/电话场景），底部居中小字"兜兜AI"。无水印，无失真人脸。`
        : cfg.template === "text_card"
        ? `设计小红书竖版9:16文字卡，暖奶油色背景，左上角大标题"${h1}"深灰色粗黑体、"${h2}"珊瑚红色，中部副文字"${cfg.subText ?? ""}"，点缀简单扁平卡通表情或线条插画，底部居中小字"兜兜AI"。无水印。`
        : `扁平漫画插画风格，3:4竖版，加拿大华人小老板工作场景（行业：${note.industry ?? "通用"}），卡通线条人物漏接电话的情绪动作，左上角白色/珊瑚红粗黑体大字"${h1} ${h2}"，底部居中小字"兜兜AI"。无水印，无失真人脸，扁平简洁背景。`;
    }

    try {
      const buf = await callGemini(imagePrompt, ratio);
      if (buf) {
        writeFileSync(filepath, buf);
        console.log(`   ✅ 保存 (${(buf.length / 1024).toFixed(0)}KB)\n`);
      } else {
        console.log(`   ❌ Gemini 生成失败，跳过\n`);
      }
    } catch (err) {
      console.error(`   ❌ 出错:`, err);
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  await db.$disconnect();
  console.log("🎉 全部完成！");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
