# Entendimento de áudios do WhatsApp

O Zelo recebe mensagens de voz e arquivos de áudio nos modos QR Code e Cloud API. Baixa a mídia, transcreve a fala e usa o texto no atendimento normal, com produtos, instruções globais e histórico. A resposta continua sendo enviada em texto. Não atende ligações nem gera voz.

## Configuração

Ative pelo menos uma chave de Gemini, Groq ou OpenAI na lista de IA. A primeira chave compatível é usada para transcrever; os demais provedores ainda podem preparar a resposta. Não é necessário cadastrar o modelo de transcrição como modelo de conversa:

| Provedor | Transcrição |
| --- | --- |
| Gemini | Modelo já cadastrado na chave, desde que aceite áudio em `generateContent` |
| Groq | `whisper-large-v3-turbo` pela API de transcrições |
| OpenAI | `gpt-transcribe` pela API de transcrições |

Com troca automática habilitada, respostas HTTP 429 ou 402 e tentativas que excedam o prazo de transcrição permitem tentar a próxima chave compatível. Arquivos de até 128 KiB têm até 20 segundos por tentativa; o limite total das chamadas de transcrição continua sendo 55 segundos. Uma tentativa que excede o prazo deixa a chave em espera por um minuto. Para limite de uso, a espera dura o prazo numérico de Retry-After, limitado a um dia, ou cinco minutos se ausente. Essa espera é independente da cota de texto, é mantida em memória e reinicia com o processo. Credenciais inválidas, arquivo recusado e falhas de conexão ficam visíveis na conversa e na fila; não provocam troca silenciosa de provedor. Uma solicitação interrompida pode já ter consumido cota no provedor.

## Operação e privacidade

- Limite de 10 MiB por arquivo, divulgado no painel como 10 MB. Gemini recebe o arquivo em base64, abaixo do limite de requisição inline de 20 MB.
- A mídia é baixada somente de origens HTTPS permitidas do WhatsApp/Meta, sem seguir redirecionamentos. No QR, HMAC e SHA-256 são verificados antes do envio à IA.
- Cada ambiente usa suas próprias chaves e fila. Grupos, mensagens próprias e histórico antigo continuam ignorados no modo QR.
- A fila atende até dois contatos ao mesmo tempo por ambiente, tanto em QR quanto em Cloud API. As mensagens de um mesmo contato continuam sequenciais e cada job é reservado atomicamente no banco. Assim, um áudio lento não bloqueia todos os demais contatos. Se as duas vagas estiverem ocupadas, a próxima mensagem aguarda uma delas.
- O atendimento desligado ou fora do horário recebe o áudio sem acionar a IA e mostra somente um aviso de pausa. Novos áudios são processados automaticamente quando o atendimento está ativo. Uma pausa durante o download é conferida antes da transcrição; uma solicitação já enviada ao provedor pode ter consumido cota.
- Ao terminar a transcrição, o texto identificado como `[Áudio transcrito]` substitui a referência da mídia no job. Uma falha posterior de resposta pode ser retomada sem transcrever novamente. Envios incertos continuam bloqueados contra repetição automática.
- Áudio binário não é salvo no catálogo ou no banco. Referências necessárias para baixar novamente ficam na fila pendente/com erro. Transcrições ficam no histórico e seguem a política de guarda existente; a alteração não apaga snapshots antigos.
- Não há promessa de precisão integral: silêncio, ruído, fala longa, limites do modelo ou bloqueios podem exigir uma nova gravação ou atendimento escrito.
- A conversa identifica a etapa atual: download, transcrição ou preparação da resposta. Somente falhas de áudio exibem o botão explícito para tentar novamente, na conversa e na fila. Uma pausa não é uma falha e não mostra esse botão. A nova tentativa pode enviar a resposta ao contato e continua usando as proteções contra envio duplicado.
- Transcrição e resposta são solicitações distintas e podem consumir créditos. Observe os contratos dos provedores, especialmente a restrição do Gemini Unpaid Services sobre dados pessoais, confidenciais ou sensíveis.

## Verificação

`npm test` inclui testes com transportes controlados: contratos de Gemini/Groq/OpenAI, reserva por limite, credenciais recusadas, limite de tamanho, URLs externas bloqueadas, integridade criptográfica, webhook Cloud assinado e QR com deduplicação e atendimento pausado. Nenhuma mensagem real de cliente é necessária para esses testes.

Em 22/10/2026, uma solicitação real ao Gemini também reconheceu uma gravação sintética curta de teste. Esse teste não enviou mensagens no WhatsApp nem usou conversas de clientes. A disponibilidade de cada conta/modelo e a conexão com o celular precisam continuar sendo conferidas na operação.

Na revisão de desempenho do mesmo dia, uma gravação sintética no Gemini 3.5 Flash-Lite levou 7.346 ms para transcrever. Um teste com raciocínio mínimo explícito levou 7.484 ms, sem ganho observado; esse ajuste foi descartado. A melhoria entregue foi na espera entre contatos: os testes bloqueiam deliberadamente o primeiro áudio e verificam que um segundo contato conclui sem aguardá-lo, com limite de duas tarefas, ordem por conversa e sem repetir jobs. Esses números são amostras locais, não um prazo garantido da API nem uma medição do atendimento completo.

Teste operacional: com o servidor ativo, chave compatível liberada e atendimento ligado, envie uma mensagem de voz curta a partir de outro número. Confirme o texto reconhecido na conversa e a resposta no celular. Se falhar, veja a fila antes de reenviar ou repetir um envio sem confirmação.

## Fontes dos contratos de API

- [Groq — Speech to Text](https://console.groq.com/docs/speech-to-text)
- [Google — geração de conteúdo, incluindo áudio](https://ai.google.dev/api/generate-content)
- [Google — entendimento de áudio](https://ai.google.dev/gemini-api/docs/audio)
- [OpenAI — transcrição de arquivos](https://developers.openai.com/api/docs/guides/speech-to-text)
- Baileys 7.0.0-rc14: derivação de chaves em `getMediaKeys` e envelope AES-256-CBC com HMAC, conforme código instalado. O download explícito evita o comportamento desta versão que ignora opções de timeout/redirecionamento em `getHttpStream`.
