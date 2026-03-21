/**
 * Docker 入口：同时启动 dashboard + daemon
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function start(name: string, script: string) {
  const proc = spawn("node", ["--import", "tsx", script], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env },
  });
  proc.on("exit", (code) => {
    console.error(`[${name}] 进程退出，code=${code}，正在重启...`);
    setTimeout(() => start(name, script), 3000);
  });
  console.log(`[${name}] 已启动`);
}

start("dashboard", "src/dashboard.ts");
start("daemon", "src/daemon.ts");
