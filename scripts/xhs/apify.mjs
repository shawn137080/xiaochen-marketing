// Apify：同步运行 actor 并取回 dataset。
// https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post

function fill(template, vars) {
  if (typeof template === "string") {
    const whole = template.match(/^\{\{(\w+)\}\}$/);
    if (whole) return vars[whole[1]]; // 保留数字类型
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
  }
  if (Array.isArray(template)) return template.map((t) => fill(t, vars));
  if (template && typeof template === "object")
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fill(v, vars)]));
  return template;
}

export function buildInput(preset, vars) {
  return fill(preset.input, vars);
}

/** @returns {Promise<any[]>} */
export async function runActor(preset, vars, { token, timeoutSecs = 300 } = {}) {
  if (!token) throw new Error("缺少 APIFY_TOKEN：在 .env 或云端环境变量里设置");
  const actor = preset.actor.replace("/", "~");
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=${timeoutSecs}&clean=true`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(buildInput(preset, vars)),
    signal: AbortSignal.timeout((timeoutSecs + 30) * 1000),
  });
  if (!res.ok) throw new Error(`Apify ${preset.actor} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}
