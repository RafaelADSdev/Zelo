import { readFile } from "node:fs/promises";
try { process.loadEnvFile(new URL(".env", import.meta.url)); } catch (error) { if (error.code !== "ENOENT") throw error; }
const base = `http://127.0.0.1:${Number(process.env.PORT || 4173)}`;
try {
  const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(5000) });
  const state = await response.json();
  if (state.app !== "wappy" || !state.instanceId) throw new Error("O serviço nessa porta não é esta aplicação Zelo.");
  const control = (await readFile(new URL(".wappy/control-token", import.meta.url), "utf8")).trim();
  const result = await fetch(base + "/api/shutdown", { method: "POST", headers: { "Content-Type": "application/json", "X-Zelo-Control": control }, body: JSON.stringify({ instanceId: state.instanceId }), signal: AbortSignal.timeout(5000) });
  if (!result.ok) throw new Error("Não foi possível encerrar esta instância.");
  console.log("Zelo está encerrando o servidor e o túnel.");
} catch (error) { console.log(error.message === "fetch failed" ? "O Zelo não está respondendo nessa porta." : error.message); process.exitCode = 1; }
