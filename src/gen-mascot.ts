/**
 * 兜兜浣熊 H5 网页版 — 无手机，探头姿势，去除背景
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../mascots");
mkdirSync(OUT_DIR, { recursive: true });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";

const refBase64 = readFileSync(resolve(OUT_DIR, "G1-thumbsup.png")).toString("base64");

const STYLE =
  `Keep the character IDENTICAL to the reference: same raccoon face, eye-mask, coral red bib with gold maple leaf, fur color, art style and lighting. ` +
  `Pure white background (#FFFFFF), no shadows on background. No text. Square 1:1.`;

const concepts = [
  {
    name: "web-peek-bottom",
    prompt: `Same raccoon character. The raccoon is peeking up from the very bottom edge of the image — only the top half of its body visible (head, ears, paws), as if emerging from below the frame. Both paws gripping the bottom edge, eyes wide and curious looking up at the viewer. Playful and charming. Perfect for a website footer character. Pure white background. ${STYLE}`,
  },
  {
    name: "web-peek-corner",
    prompt: `Same raccoon character. The raccoon is peeking around the bottom-right corner of the image — head tilted, one eye peeking around, one paw visible gripping the edge, expression playful and shy. Only about 1/3 of the character visible. Website corner decoration. Pure white background. ${STYLE}`,
  },
  {
    name: "web-stand-full",
    prompt: `Same raccoon character. Full body, standing upright facing viewer, arms relaxed at sides with a friendly open posture, warm smile, no props — just the character itself. Clean mascot portrait for website hero section. Pure white background. ${STYLE}`,
  },
];

async function generateImage(prompt: string): Promise<Buffer | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: "image/png", data: refBase64 } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "512" },
      },
    }),
  });

  const data = await res.json() as any;
  if (data.error) { console.error("  Gemini error:", data.error.message); return null; }

  for (const part of data.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) return Buffer.from(part.inlineData.data, "base64");
  }
  return null;
}

// 将白色背景替换成透明（用于网页叠加）
async function removeWhiteBg(buf: Buffer, outPath: string) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    // 接近白色的像素设为透明
    if (r > 230 && g > 230 && b > 230) pixels[i + 3] = 0;
  }

  await sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(outPath);
}

async function main() {
  if (!GEMINI_API_KEY) { console.error("GEMINI_API_KEY required"); process.exit(1); }
  console.log("🦝 生成网页版浣熊 (无手机)...\n");

  for (const c of concepts) {
    console.log(`生成 ${c.name}...`);
    const buf = await generateImage(c.prompt);
    if (!buf) { console.log("  ❌ 失败\n"); continue; }

    // 原图
    const pngPath = resolve(OUT_DIR, `${c.name}.png`);
    writeFileSync(pngPath, buf);
    console.log(`  ✅ mascots/${c.name}.png (${(buf.length / 1024).toFixed(0)}KB)`);

    // 透明背景版（网页用）
    const transparentPath = resolve(OUT_DIR, `${c.name}-transparent.png`);
    await removeWhiteBg(buf, transparentPath);
    console.log(`  ✅ mascots/${c.name}-transparent.png (透明背景)\n`);

    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("🎉 完成！-transparent 版本可直接用在网页上");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
