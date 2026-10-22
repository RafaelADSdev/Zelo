import { test } from "node:test";
import assert from "node:assert/strict";
import { audioStatus, audioPreview, canRetryJob } from "../public/audio-status.js";
import { allowedPath } from "../deployment/routes.mjs";

test("áudio: falha e pausa nunca aparecem como aguardando transcrição", () => {
  assert.ok(allowedPath("/audio-status.js"));
  const failed = { id: "one", audio: true, state: "failed", error: "A conexão com a IA falhou." };
  assert.equal(audioStatus(failed).title, "Não foi possível transcrever este áudio");
  assert.equal(audioStatus(failed).retry, true);
  assert.match(audioPreview("[Áudio recebido — aguardando transcrição]", failed), /Falha/);
  assert.match(audioPreview("[Áudio recebido — aguardando transcrição]", { ...failed, state: "manual" }), /pausado/);
  assert.equal(audioPreview("Resposta posterior", failed), "Resposta posterior");
  assert.equal(audioStatus({ ...failed, state: "done" }), null);
  assert.equal(audioStatus({ ...failed, audio: false }), null);
  assert.match(audioStatus({ ...failed, state: "blocked" }).short, /IA bloqueada/);
  assert.equal(audioStatus({ ...failed, stage: "reply" }).title, "Áudio entendido; a resposta falhou");
  assert.equal(audioStatus({ ...failed, state: "processing", stage: "download" }).title, "Baixando áudio do WhatsApp");
  assert.equal(audioStatus({ ...failed, state: "processing", stage: "transcribe" }).title, "Transcrevendo áudio");
});

test("áudio: botão de tentar novamente aparece somente em falha", () => {
  for (const state of ["pending", "requested", "processing", "manual", "blocked", "done", "failed"]) {
    const job = { audio: true, state };
    assert.equal(canRetryJob(job), state === "failed", state);
    if (audioStatus(job)) assert.equal(audioStatus(job).retry, state === "failed", state);
  }
  assert.equal(canRetryJob({ audio: false, state: "manual" }), true);
  assert.ok(!audioStatus({ audio: true, state: "manual" }).detail.includes("botão"));
});
