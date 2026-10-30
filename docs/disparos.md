# Disparos v2

Evolução sobre `6b1f36c`, preservando fila persistente, QR/Cloud, importação, agendamento, pausa e cancelamento. A revisão não enfileira mensagens: o envio da campanha exige **Confirmar e enviar**, com consentimento marcado. **Enviar teste ao próprio número** cria somente um teste separado, por ação explícita.

## Preparar e revisar

Cole números ou importe CSV/XLSX de até 2 MB. Escolha aba, telefone, nome e até 32 colunas extras. Somente as colunas selecionadas são enviadas ao servidor; a planilha original permanece no navegador. Cada variável aceita até 1.000 caracteres e nomes de até 200 caracteres. A carga total da revisão/criação/teste está limitada a 512 KB; demais rotas mantêm 64 KB. O aumento pontual permite transportar metadados dos contatos sem ampliar a exposição dos outros endpoints.

O servidor valida novamente os números, remove duplicados e retorna inválidos com linha e motivo. Para números brasileiros com DDI 55, valida DDD e acrescenta o nono dígito em celulares antigos de oito dígitos iniciados por 6–9; telefones fixos não recebem esse dígito. Adicionar DDI 55 a números nacionais exige a seleção correspondente na importação ou `country: "55"` na API. Isso não verifica se o telefone possui WhatsApp.

Use `{nome}`, `{cidade}` ou outra chave exibida na importação. `{nome|cliente}` define uma alternativa. Variável vazia sem alternativa bloqueia a campanha inteira, inclusive se o primeiro contato tiver valor. A prévia usa o primeiro destinatário elegível, mas todos são validados. Templates têm mapeador visual para variáveis do corpo, valores fixos e alternativas; campos manuais/JSON avançado continuam disponíveis. Ao duplicar um template sem seus metadados textuais carregados, a revisão mostra parâmetros resolvidos; recarregue o template aprovado para conferir o corpo completo.

A revisão mostra válidos disponíveis, duplicados, inválidos, suprimidos, classificação de 24 horas, duração estimada, janela, ritmo e consentimento. A estimativa não inclui esperas por janela, limite diário, hospedagem ou reconexão. O nome da campanha é opcional.

## Consentimento, descadastro e dados pessoais

O servidor exige confirmação booleana e grava o horário e o identificador do usuário autenticado. O identificador é obtido da sessão, não do formulário. Esse registro documenta a declaração do operador; a empresa ainda precisa conservar a origem e a evidência da autorização do destinatário. A política do WhatsApp exige permissão para comunicações e respeito aos pedidos de saída, inclusive recebidos fora do aplicativo. [Política oficial de mensagens](https://business.whatsapp.com/policy).

Textos equivalentes a **SAIR, PARAR, CANCELAR, STOP e NÃO QUERO RECEBER**, ignorando caixa, acentos e pontuação final básica, registram supressão sem gerar resposta de IA. O recebimento é deduplicado. A confirmação curta é configurável por conexão; deixe vazia para não responder. Pedidos de saída recebidos como notificações antigas do QR também são preservados, sem liberar respostas retroativas da IA a outras mensagens.

Em **Descadastro e lista de supressão**, adicione, importe, exporte ou remova contatos. A importação usa a primeira aba e a coluna Telefone; cargas maiores são divididas em lotes. Remova somente após nova autorização. A supressão fica isolada por ambiente e conexão e é conferida na criação, no processamento e novamente antes da chamada ao transporte. Suprimidos durante a campanha ficam `skipped`, com motivo. Um ID LID sem telefone resolvido bloqueia todas as campanhas daquela conta até conferência; registre o telefone real antes de remover esse bloqueio. O atendimento de solicitações posteriores do contato continua disponível; o descadastro impede campanhas.

A LGPD prevê requisitos para demonstrar consentimento e permitir revogação, além de princípios de necessidade e segurança. A configuração do Zelo não substitui a definição da finalidade, base legal e procedimentos do responsável pelo tratamento. Consulte os arts. 6º, 8º e 18 da [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm). Importe apenas os dados necessários. Histórico, nomes, variáveis e auditoria são persistidos no ambiente e entram nos snapshots existentes; não há expurgo automático específico deste módulo. Defina retenção e procedimentos de atendimento dos direitos dos titulares.

## Ritmo, janela e conexão

| Configuração padrão | QR | Cloud API |
| --- | --- | --- |
| Intervalo base | 8 s | 1 s |
| Jitter adicional | 0–17 s | 0–1 s |
| Limite por minuto | 5 | 30 |
| Teto diário | 100 tentativas | 1.000 tentativas |
| Janela e fuso | 08:00–20:00, America/Sao_Paulo | 08:00–20:00, America/Sao_Paulo |

O formulário inicia com o perfil conservador QR, inclusive se a conexão for Cloud. A API aplica padrões conforme o transporte; o operador pode ajustar o formulário dentro das faixas validadas. O QR exige base de pelo menos 8 s e jitter configurado de pelo menos 1 s, permite até 5/min e teto de até 500/dia. Cloud aceita base a partir de 1 s, até 60/min e teto de até 10.000/dia. Esses valores são controles locais, não cotas concedidas pelo WhatsApp.

A fila confere campanhas a cada segundo e processa um destinatário por vez por conexão. Jitter, próximo envio, tentativas por minuto e uso diário persistem; criar outra campanha ou reiniciar não zera o consumo. Cada campanha compara o consumo total da conta com seu teto configurado. O dia de cota vira à meia-noite em São Paulo. Esperas por ritmo ou cota não geram falha. Tentativas sem confirmação também consomem a cota, por precaução.

O operador escolhe fuso, dias e horários. Horários iguais permitem o dia inteiro; faixas noturnas pertencem ao dia de início. A data de agendamento é convertida a partir do dispositivo; a janela diária usa o fuso salvo na campanha. Fora da janela, a fila espera. Três falhas consecutivas pausam a campanha; erros classificados de autenticação ou limite da Meta pausam imediatamente, com motivo visível. Retomar exige ação do operador e preserva cotas e pendências.

QR/Baileys é integração não oficial. Nenhuma combinação de ritmo e jitter garante proteção contra restrição ou bloqueio. O servidor precisa permanecer ativo; após reinício, o ambiente precisa voltar a ficar ativo e a conexão original deve estar disponível. A fila não migra automaticamente para outro número conectado.

## Cloud: 24 horas e comprovantes

Texto livre usa a janela iniciada pela mensagem do contato. Fora dela, use um template aprovado, conforme a [regra oficial da plataforma](https://business.whatsapp.com/policy). A prévia considera a data agendada quando futura. Escolha enviar somente a quem está na janela ou usar template para todos. Se a janela fechar antes do processamento, o item é ignorado com motivo, sem gerar uma sequência de erros de envio.

**Envio aceito** significa que o transporte confirmou a solicitação. **Entregue** e **Lida** dependem dos comprovantes da Meta ou do WhatsApp QR. A contagem de entregues inclui lidas; lidas é um subconjunto. Falha de entrega recebida após o aceite aparece separadamente. O botão de reenvio em lote considera apenas o estado local `failed`; falhas posteriores de entrega podem ser revistas individualmente e usadas em uma nova campanha após conferência.

O histórico traz somente contadores agregados das 30 campanhas recentes. Destinatários são consultados sob demanda, em páginas de 50, com máximo de 100 por requisição. Somente cartões alterados são atualizados automaticamente. O CSV é montado por páginas e separa estado do envio, comprovante, motivo, tentativas e decisão do operador. Confirmação manual de entrega tem rótulo próprio e não inventa comprovante da Meta.

## Interrupções, reenvio e auditoria

O item é reivindicado de forma atômica e gravado antes da chamada externa. Reinício transforma `sending` em `unknown`. Incertos não voltam automaticamente à fila. O operador pode confirmar entrega ou autorizar nova tentativa após conferir a conversa; ambas as decisões exigem confirmação e registram quem decidiu. Reenviar um incerto que já chegou pode duplicar a mensagem: essa incerteza não pode ser eliminada sem o comprovante ou a conferência do destinatário.

Cada ação de resolução/reenvio tem chave persistente: repetir a mesma requisição não cria outra tentativa. A primeira tentativa usa `item.id`; um reenvio explicitamente autorizado recebe `send_id` novo e persistido, mantendo o mesmo item lógico e a auditoria. Essa extensão é necessária porque os transportes bloqueiam a reutilização de uma chave com resultado incerto. A troca só ocorre em ação explícita; nunca em reinício ou rotina automática. A conexão esperada também é conferida no transporte.

Mensagens QR manuais e de campanha entram na memória como `agent`, com idempotência; Cloud preserva seu registro existente. Campanhas anteriores à v2 sem consentimento ficam pausadas e devem ser duplicadas e revisadas. A migração acrescenta colunas por `PRAGMA table_info`/`ALTER TABLE`, sem apagar dados e sem depender de recriar tabelas.

## P1 pendente e P2

| Item | Estado e motivo |
| --- | --- |
| Checagem `onWhatsApp` no QR | Pendente. Precisa de uma fila própria com ritmo, cancelamento e resultados persistidos; consultar centenas de contatos na revisão HTTP bloquearia a operação. Normalização não é prova de existência. |
| Imagem/PDF com legenda na campanha | Pendente. Os transportes já enviam materiais em outros fluxos; ainda falta estender a identidade da tentativa, o upload e a legenda das campanhas com testes de interrupção antes/depois do upload. Não há um controle de mídia parcialmente funcional na tela. |
| Filtros avançados de conversas, listas salvas e etiquetas | Pendente. A seleção simples permanece; o serviço atual limita a lista de conversas a 100. Filtros globais e listas reutilizáveis precisam de consulta paginada e armazenamento próprios. |
| Template com mídia/cabeçalho/botões parametrizados | Mapeador visual cobre o corpo. Componentes avançados permanecem em JSON; a prévia textual não representa arquivos externos. |
| Teste ao próprio número na Cloud | A ação está implementada, vinculada ao número validado. Exige janela ou template e depende de a Meta aceitar o próprio número como destinatário; uma recusa fica visível no histórico. Não substitui o teste com um segundo número autorizado. |

P2 não implementado nesta entrega: indicador de resposta/atalho para conversa, alternativas aleatórias de texto, limite de contatos configurável e estimativa de custo. O limite continua 500. A prioridade desta versão foi concluir P0 sem contornar regras da plataforma.

## Validação e roteiro manual

Baseline: `npm ci --ignore-scripts`, 89 testes passando e auditoria sem vulnerabilidades. Ao final, 105 testes passam e `npm audit --omit=dev` continua sem vulnerabilidades. Os testes usam transportes controlados, sem mensagens reais. O runner já descobre automaticamente `test/*.test.mjs`, incluindo `broadcast-optout.test.mjs` e os demais novos arquivos. No navegador, foram exercitados navegação, CSV/XLSX, 500 contatos, nome/variáveis, mapeador de template, consentimento, supressão, pausa/retomada/cancelamento, duplicação, leitura e exportação de resultados. Layouts foram medidos em 320, 768 e 1440 px; as capturas incluem desktop e celular. Teclado virtual e sessões reais do WhatsApp não foram exercitados.

Para um teste manual real, use um segundo número que autorizou o contato:

1. Conecte o número de envio e crie uma lista só com o segundo número. Importe nome/cidade e escreva `Olá {nome|cliente}, novidades em {cidade}.`.
2. Confira a prévia. Deixe consentimento desmarcado e confirme que nada é criado. Marque-o somente após conferir a autorização e confirme um único envio.
3. No segundo aparelho, confira mensagem, entrega e leitura. Atualize o histórico e baixe o CSV; os comprovantes dependem do transporte.
4. Responda **SAIR** no segundo número. Confira a confirmação configurada e a supressão, sem resposta de IA para esse comando.
5. Revise outra campanha para o mesmo contato. Ele deve aparecer suprimido. Para testar saída durante uma fila, use uma lista pequena e peça o descadastro antes de o destinatário ser processado: ele deve ficar ignorado.
6. Teste pausa/retomada e uma janela futura. Não reduza limites do QR abaixo do validado. Teste com a IA desligada para confirmar a independência da campanha.
7. Na Cloud, compare texto com janela aberta e contato fora da janela. O segundo exige seleção de template ou exclusão explícita; não deve gerar falhas em massa.
8. Confira um incerto na conversa antes de escolher a resolução. Prefira simular interrupção em ambiente de teste; não force queda de conexão de produção apenas para produzir esse estado.

## Resumo por arquivo

| Arquivo | Alteração |
| --- | --- |
| `lib/whatsapp/broadcasts.mjs` | Estende criação, processamento, consentimento, políticas, prévia e teste; preserva fila e ações existentes. |
| `lib/whatsapp/broadcast-schema.mjs` | Migração idempotente e tabelas de cotas, tentativas, decisões e auditoria. |
| `lib/whatsapp/optouts.mjs` | Descadastro, deduplicação, configuração de confirmação e supressão isolada por conta. |
| `lib/whatsapp/broadcast-policy.mjs` | Validação de ritmo, cotas, fuso e dias; cálculo da janela. |
| `lib/whatsapp/broadcast-preview.mjs` | Normalização brasileira, validação de metadados e classificação de destinatários. |
| `lib/whatsapp/broadcast-content.mjs` | Personalização e resolução de parâmetros, com bloqueio de variáveis ausentes. |
| `lib/whatsapp/broadcast-actions.mjs` | Resolução idempotente, auditoria, reenvio de falhas e cópia sem enfileirar. |
| `lib/whatsapp/broadcast-history.mjs` | Agregação, comprovantes e detalhes paginados. |
| `lib/whatsapp/whatsapp.mjs` | Recebe opt-out Cloud, confere supressão/conexão e preserva classificação de erros da Meta. |
| `lib/whatsapp/whatsapp-qr.mjs` | Recebe opt-out QR/LID, confere supressão/conexão e registra mensagens na memória. |
| `server.mjs` | Rotas autenticadas, ator da sessão, limite JSON pontual, número próprio, assets e timer de 1 s. |
| `deployment/routes.mjs` | Permite os novos assets e endpoints no gateway. |
| `public/index.html` | Consentimento, revisão completa, ritmo/janela, supressão, metadados e teste. |
| `public/broadcasts.js` | Coordena prévia, consentimento, configurações e duplicação no formulário. |
| `public/broadcast-import.js` | Extrai telefone/nome/variáveis de forma testável. |
| `public/broadcast-import-ui.js` | Mapeia nome e colunas extras sem importar dados não selecionados. |
| `public/broadcast-template-map.js` | Mapeador visual das variáveis do corpo. |
| `public/broadcast-suppression.js` | Gestão/importação/exportação e confirmação do descadastro. |
| `public/broadcast-history.js` | Resumos e atualização por cartão alterado. |
| `public/broadcast-results.js` | Paginação, decisões individuais e CSV com comprovantes. |
| `public/broadcasts.css` | Ajusta controles de dias ao sistema visual existente. |
| `test/broadcasts.test.mjs` | Adapta contratos de consentimento/ritmo e valida o grafo dos módulos HTTP. |
| `test/broadcast-import.test.mjs` | Verifica seleção de nome/variáveis sem vazamento de colunas extras. |
| `test/broadcast-optout.test.mjs` | Descadastro nos dois transportes, LID, atraso e supressão durante envio. |
| `test/broadcast-policy.test.mjs` | Jitter, cotas, fuso, janela e pausa automática. |
| `test/broadcast-preview.test.mjs` | 24 horas, normalização, fallback e variáveis obrigatórias. |
| `test/broadcast-actions.test.mjs` | Decisões, reenvios, auditoria, duplicação e teste ao próprio número. |
| `test/broadcast-history.test.mjs` | Comprovantes, paginação e migração sobre banco legado. |
| `test/broadcast-api.test.mjs` | Autenticação, novas rotas, corpo JSON e paginação. |
| `README.md` | Atualiza uso, limites e acesso ao guia. |
| `docs/product.md` | Registra capacidade e restrições do produto. |
| `docs/disparos.md` | Operação, decisões técnicas, pendências e roteiro manual desta versão. |
