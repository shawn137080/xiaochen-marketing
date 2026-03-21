/**
 * 在终端打印小红书登录二维码
 * 用法: npm run login-qr
 *
 * 适用于 VPS / 无 UI 容器环境
 */
import sharp from "sharp";
import jsQR from "jsqr";
import QRCode from "qrcode-terminal";

const MCP_BASE = (process.env.XHS_MCP_URL || "http://localhost:18060").replace(/\/mcp$/, "");

async function fetchQrcode(): Promise<{ isLoggedIn: boolean; img?: string; timeout?: string }> {
  const res = await fetch(`${MCP_BASE}/api/v1/login/qrcode`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = (await res.json()) as { success: boolean; data: { is_logged_in: boolean; img?: string; timeout?: string } };
  return {
    isLoggedIn: json.data.is_logged_in,
    img: json.data.img,
    timeout: json.data.timeout,
  };
}


async function decodeQrFromBase64(dataUrl: string): Promise<string | null> {
  // Strip "data:image/png;base64," prefix if present
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const buf = Buffer.from(base64, "base64");
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return code?.data ?? null;
}

async function main() {
  console.log("🔍 检查登录状态...");

  const { isLoggedIn, img, timeout } = await fetchQrcode();

  if (isLoggedIn) {
    console.log("✅ 已登录小红书，无需扫码");
    return;
  }

  if (!img) {
    console.error("❌ 服务器未返回二维码，请确认 xiaohongshu-mcp 正在运行");
    process.exit(1);
  }

  const qrData = await decodeQrFromBase64(img);
  if (!qrData) {
    console.error("❌ 无法解码二维码图片，请检查图片格式");
    process.exit(1);
  }

  console.log("\n📱 请用小红书 App 或微信扫描以下二维码登录:\n");
  QRCode.generate(qrData, { small: true });
  if (timeout) console.log(`\n⏱  有效期: ${timeout}`);
  console.log("\n扫码后请关闭浏览器窗口，登录完成。");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
