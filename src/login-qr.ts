/**
 * 在终端打印小红书登录二维码
 * 用法: npm run login-qr
 *
 * 适用于 VPS / 无 UI 容器环境
 */
import QRCode from "qrcode-terminal";
import { callMcp } from "./publish";

async function main() {
  console.log("🔍 检查登录状态...");

  const statusRes = await callMcp("check_login_status", {});
  const statusText = statusRes.result?.content?.[0]?.text || "";
  const isLoggedIn =
    statusText.includes("已登录") || statusText.includes("登录状态") ||
    statusText.includes("处于登录") || statusText.includes("logged in");

  if (isLoggedIn) {
    console.log("✅ 已登录小红书，无需扫码");
    console.log("   " + statusText.split("\n")[0]);
    return;
  }

  console.log("❌ 未登录，正在获取二维码...\n");

  const qrRes = await callMcp("get_login_qrcode", {});
  const qrText = qrRes.result?.content?.[0]?.text || "";

  // 提取二维码 URL（MCP 返回的文本里通常包含 URL）
  const urlMatch = qrText.match(/https?:\/\/[^\s\n"']+/);
  if (!urlMatch) {
    console.log("MCP 返回内容:");
    console.log(qrText);
    return;
  }

  const qrUrl = urlMatch[0];
  console.log("📱 请用小红书 App 扫描以下二维码登录:\n");
  QRCode.generate(qrUrl, { small: true });
  console.log("\n二维码 URL:", qrUrl);
  console.log("\n扫码后等待几秒，再次运行此脚本确认登录状态。");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
