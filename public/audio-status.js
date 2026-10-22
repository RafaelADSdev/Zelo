export function canRetryJob(job) {
  return job?.state === "failed" || !job?.audio && job?.state === "manual";
}
export function audioStatus(job) {
  if (!job?.audio || job.state === "done") return null;
  const reply = job.stage === "reply";
  if (job.state === "blocked") return { title: "Áudio não processado: IA bloqueada", short: "Áudio recebido · IA bloqueada", detail: "A IA não processa mensagens deste contato. O atendimento manual continua disponível.", retry: false, tone: "paused" };
  if (job.state === "failed") return { title: reply ? "Áudio entendido; a resposta falhou" : "Não foi possível transcrever este áudio", short: reply ? "Falha ao responder ao áudio" : "Falha na transcrição · tentar novamente", detail: job.error || "Confira a conexão com a IA e tente novamente.", retry: true, tone: "error" };
  if (job.state === "manual") return { title: "Áudio recebido com atendimento pausado", short: "Áudio pausado", detail: "Este áudio foi recebido com o atendimento pausado ou fora do horário. Novos áudios são processados automaticamente quando o atendimento está ativo.", retry: false, tone: "paused" };
  if (job.state === "processing") {
    const title = job.stage === "download" ? "Baixando áudio do WhatsApp" : reply ? "Áudio entendido · preparando resposta" : "Transcrevendo áudio";
    return { title, short: title, detail: "A resposta aparecerá nesta conversa. Se ocorrer uma falha, ela será mostrada aqui.", retry: false, tone: "progress" };
  }
  return { title: "Áudio na fila de atendimento", short: "Áudio na fila", detail: "Aguardando uma vaga de processamento ou a mensagem anterior deste contato.", retry: false, tone: "progress" };
}
export function audioPreview(text, job) {
  return text?.startsWith("[Áudio recebido") ? audioStatus(job)?.short || "Áudio recebido · confira a atividade" : text;
}
