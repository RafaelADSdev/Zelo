import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep, basename } from "node:path";
import { randomUUID } from "node:crypto";

const directory = await mkdtemp(join(tmpdir(), "wappy-test-run-"));
const ownership = randomUUID();
await writeFile(join(directory, ".owner"), ownership);
let exitCode = 1;
try {
  const child = spawn(process.execPath, ["--test", "--test-timeout=45000", ...process.argv.slice(2), "test/*.test.mjs"], { windowsHide: true, stdio: "inherit", env: { ...process.env, WAPPY_TEST_ROOT: directory } });
  exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => resolve(code ?? 1)); });
} finally {
  const resolved = await realpath(directory), temporary = await realpath(tmpdir());
  if (!resolved.startsWith(temporary + sep) || !basename(resolved).startsWith("wappy-test-run-") || await readFile(join(resolved, ".owner"), "utf8") !== ownership) throw new Error("Limpeza recusada: raiz ou propriedade do diretório inválida.");
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
process.exitCode = exitCode;
