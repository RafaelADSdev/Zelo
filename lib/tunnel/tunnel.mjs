import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fail } from "../core/settings.mjs";

// Official Cloudflare release asset digests, verified against GitHub on 2026-10-21.
// Pinning avoids GitHub release-discovery rate limits and surprise binary upgrades.
const release = '2026.10.3';
const digests = {
  'cloudflared-linux-amd64': '053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0',
  'cloudflared-linux-arm64': '89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8',
  'cloudflared-windows-amd64.exe': '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2',
};
export function createTunnel({ dataDir, port, settings, fetchImpl = fetch }) {
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
    if (!digests[name]) throw fail("Não há cloudflared verificado para esta arquitetura.", 502);
    const response = await fetchImpl(`https://github.com/cloudflare/cloudflared/releases/download/${release}/${name}`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || Number(response.headers.get("content-length")) > 150_000_000) {
      const error = fail("Falha ao baixar cloudflared.", 502); error.code = `CLOUDFLARED_DOWNLOAD_${response.status}`; throw error;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length > 150_000_000 || checksum !== digests[name]) throw fail("Checksum do cloudflared inválido.", 502);
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
