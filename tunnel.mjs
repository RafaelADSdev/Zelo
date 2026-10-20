import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fail } from "./settings.mjs";

export function createTunnel({ dataDir, port, settings }) {
  let child, starting, error = "", url = "", generation = 0;
  async function binary() {
    const name = process.platform === "win32" ? "cloudflared-windows-amd64.exe" : `cloudflared-linux-${process.arch === "arm64" ? "arm64" : "amd64"}`;
    if (!["win32", "linux"].includes(process.platform)) throw fail("Configure seu próprio túnel HTTPS nesta plataforma.");
    const directory = join(dataDir, "bin");
    const path = join(directory, name);
    await mkdir(directory, { recursive: true });
    try {
      await access(path);
      const checksum = (await readFile(path + ".sha256", "utf8")).trim();
      if (createHash("sha256").update(await readFile(path)).digest("hex") === checksum) return path;
      throw fail("O cloudflared local não passou na verificação de integridade.", 500);
    } catch (failure) { if (failure.code !== "ENOENT") throw failure; }
    const release = await fetch("https://api.github.com/repos/cloudflare/cloudflared/releases/latest", { headers: { "User-Agent": "wappy-local" }, signal: AbortSignal.timeout(20000) });
    if (!release.ok) throw fail("Não foi possível consultar a versão oficial do cloudflared.", 502);
    const metadata = await release.json();
    const asset = metadata.assets?.find(item => item.name === name);
    if (!asset?.digest?.startsWith("sha256:") || !asset.browser_download_url?.startsWith("https://github.com/cloudflare/cloudflared/releases/download/")) throw fail("Download oficial sem checksum disponível. Instale seu próprio túnel e preencha a URL pública.", 502);
    const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || Number(response.headers.get("content-length")) > 150_000_000) throw fail("Falha ao baixar cloudflared.", 502);
    const bytes = Buffer.from(await response.arrayBuffer());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length > 150_000_000 || checksum !== asset.digest.slice(7)) throw fail("Checksum do cloudflared inválido.", 502);
    await writeFile(path, bytes, { mode: 0o700 });
    await writeFile(path + ".sha256", checksum);
    return path;
  }
  return {
    state: () => ({ running: Boolean(child), starting: Boolean(starting), url, error }),
    start() {
      if (starting) return starting;
      if (child && url) return Promise.resolve(this.state());
      error = "";
      const attempt = ++generation;
      starting = (async () => {
        const executable = await binary();
        if (attempt !== generation) throw fail("Inicialização do túnel cancelada.", 409);
        await new Promise((resolve, reject) => {
          const process = spawn(executable, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`, "--protocol", "http2"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
          child = process;
          const timeout = setTimeout(() => { process.kill(); reject(fail("O túnel não iniciou a tempo. Tente novamente ou use sua URL HTTPS.", 502)); }, 45000);
          const processOutput = chunk => {
            const match = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
            if (match && !url) { url = match[0]; clearTimeout(timeout); resolve(); }
          };
          process.stdout.on("data", processOutput); process.stderr.on("data", processOutput);
          process.on("error", () => { clearTimeout(timeout); if (child === process) child = null; reject(fail("Não foi possível executar cloudflared.", 502)); });
          process.on("exit", () => { clearTimeout(timeout); if (child === process) { child = null; url = ""; } reject(fail("O túnel foi encerrado. Gere uma nova URL pública.", 502)); });
        });
        if (attempt !== generation) throw fail("Inicialização do túnel cancelada.", 409);
        await settings.update({ publicUrl: url });
        return this.state();
      })().catch(failure => { error = failure.message; throw failure; }).finally(() => { starting = null; });
      return starting;
    },
    stop() { generation++; child?.kill(); child = null; url = ""; return this.state(); },
  };
}
