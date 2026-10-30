---
name: Zelo
description: Espaço de trabalho para atendimento e materiais do negócio.
colors:
  primary: "#7041db"
  primary-hover: "#5c2cc5"
  page: "#faf9fc"
  surface: "#ffffff"
  ink: "#18151e"
  muted: "#6c6577"
  border: "#e5e1ec"
  soft: "#f2edfc"
  conversation-history: "#f0ede8"
  conversation-outgoing: "#e7dcf8"
typography:
  headline:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: "1.2"
  body:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "14px"
    lineHeight: "1.55"
  label:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
rounded:
  control: "8px"
  surface: "9px"
spacing:
  compact: "8px"
  control: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    height: "44px"
---

# Design System: Zelo

## Overview

**Mesa aberta.** Navegação superior clara, conteúdo amplo e controles de contexto compactos. A identidade em roxo, branco e preto permanece. A composição substitui a antiga barra lateral escura.

A tela inicial é Produtos e materiais por escolha explícita do usuário. Conversas e Disparos continuam acessíveis diretamente. A referência vigente inclui a captura do próprio sistema aceita pelo usuário em 30/10/2026.

## Colors

**Ação em roxo.** O acento destaca a ação disponível e o item de navegação ativo; superfícies e divisórias permanecem neutras. Estados ativos do catálogo usam verde escuro sobre verde suave, acompanhados do texto Ativo.

Em Conversas, o fundo quente do histórico separa o conteúdo das superfícies de controle. Mensagens recebidas são brancas e mensagens enviadas usam lavanda; a ação de enviar conserva o roxo principal.

## Typography

Tipografia local sem dependências de rede. Títulos se distinguem pelo peso e pela escala; textos de apoio ficam entre 11 e 14 px. O título de Produtos varia entre 30 e 44 px. Campos móveis usam 16 px para manter leitura e interação adequadas.

Em Conversas, nomes de contatos usam 14 px e peso 600, mensagens usam 14 px com entrelinha 1,55 e horários usam 10 px. O campo de mensagem passa a 16 px no celular.

## Layout

Cabeçalho superior de 78 px no computador. Até 800 px, marca e conta ocupam a primeira linha e as abas ficam em uma faixa horizontal rolável; o cabeçalho passa a 118 px.

Produtos organiza catálogo e informações gerais em duas colunas na proporção 2:1; até 800 px, essas áreas se empilham. A tabela mantém sua própria rolagem no celular, sem ampliar a página. Novo produto fica junto ao título da página.

Conversas usa lista de contatos com avatares, busca e filtro de bloqueio da IA ao lado do histórico/compositor. A coluna de contatos mede 340 px, passa a 290 px até 1100 px e a 260 px entre 581 e 800 px. A conversa selecionada ocupa um painel limitado pela altura disponível, com rolagem interna independente da lista. Até 580 px, lista e conversa são telas alternadas; o contato, Voltar e a área de envio permanecem no painel da conversa, e voltar à lista restaura o contexto geral e o foco na busca.

Em computadores com largura acima de 800 px e altura até 800 px, Conversas recolhe o título da página, condensa os controles globais e mostra as opções fechadas do compositor como ícone de ajustes. Essa redução preserva área útil para o histórico; as opções continuam expansíveis.

**The Histórico legível Rule.** Em Conversas, o histórico conserva rolagem própria e o compositor permanece ancorado abaixo dele, inclusive em telas baixas.

Disparos separa preparação e histórico no computador, empilhando as áreas em telas estreitas. Controles globais da IA e detalhes da conexão ficam disponíveis por expansão no celular.

## Elevation & Depth

**Divisão antes de sombra.** Bordas finas separam as superfícies principais. A elevação mais perceptível pertence ao menu de conta, que flutua sobre o espaço de trabalho. Evitar acrescentar sombras aos painéis e à tabela.

Em Conversas, os balões recebem somente uma sombra curta e discreta; o painel continua separado por bordas e tons de fundo.

## Shapes

Controles e superfícies têm cantos discretamente arredondados. Ícones SVG seguem o vocabulário linear existente; os círculos ficam restritos a avatares, símbolos de estado, indicadores e ações de nova conversa e envio. Balões de conversa têm cantos de 8 px e um canto superior reto junto à origem: à esquerda nas recebidas e à direita nas enviadas.

## Components

- Navegação: item ativo com texto roxo e sublinhado; conta e integrações acessíveis no canto direito.
- Automação: estado textual e ação disponível diferenciados. Quando desligada, Ligar é a ação roxa; o comando redundante de desligar fica recolhido.
- Catálogo: tabela semântica com Produto, Status, Materiais e ações acessíveis por nome. A ficha conserva descrições, preços, links e anexos.
- Negócio: nome e descrição são inicialmente somente leitura; Editar informações habilita os campos e Salvar confirma. O nome é persistido nas configurações; a descrição usa a base existente.
- Formulários: rótulos explícitos, foco visível e controles principais com altura mínima de 44 px. Metadados do destinatário ficam acessíveis por expansão ao responder uma conversa.
- Contatos: linhas planas e uniformes de 76 px, separadas por divisórias discretas. Avatares de 44 px mostram até duas iniciais, com paleta estável por telefone e símbolo de pessoa quando não há nome; o avatar selecionado fica branco. A seleção mantém estado acessível e usa prévia e horário em #675d70 sobre #eee9f7 (contraste medido de 5,22:1). O horário indica a última mensagem recebida, com data completa no título. O bloqueio aparece como cadeado junto ao nome, com descrição acessível. Busca curta por nome ou telefone e filtros Todas / IA bloqueada, com contagens, funcionam por clique direto.
- Atualizar conversas: fica junto ao título da lista, com ícone SVG de 16 px e rótulo Atualizar; fundo #f8f4fe, borda #e3d6f2, texto #7041b2 e cantos de 8 px. Altura mínima de 36 px no computador e 44 px no celular. Entre 581 e 1100 px, apenas o ícone fica visível, mantendo nome acessível e título. Durante a consulta, o botão fica indisponível e informa ocupação; o ícone gira apenas quando a preferência de movimento permite.
- Atividade do atendimento: resumo expansível de 66 px, reduzido a 46 px no computador baixo, com contagem real e ação Ver atividade / Ocultar. O resumo discrimina falhas, atendimento manual, processamento e demais pendências; no celular usa uma descrição curta. A expansão mostra contato, estado, erro e data, com Tentar responder somente quando disponível, além dos eventos recentes. Não substituir esses dados por estados genéricos ou contagens decorativas.
- Histórico: recebidas à esquerda e enviadas à direita, com horários junto ao conteúdo. Balões ocupam no máximo o menor valor entre 78% e 65 caracteres de largura; no celular, até 88%. Áudios pausados mostram estado compacto e explicação em Ver detalhes. Bloquear/desbloquear IA continua no cabeçalho do contato, com aviso no histórico.
- Compositor: permanece ancorado abaixo do histórico, com ação circular de envio de 46 px. O campo cresce com o texto até 144 px; Enter envia e Shift+Enter insere uma linha. Destinatário, tipo de mensagem e templates aprovados continuam disponíveis nas opções expansíveis. Falhas preservam o rascunho e exibem o estado de recuperação.
- Movimento: transições discretas, canceladas ao usar o teclado ou preferir movimento reduzido.

## Do's and Don'ts

Preservar os dados e as funções reais. Não inserir produtos ou métricas fictícias na aplicação; dados sintéticos são exclusivos da prévia de teste. Não reintroduzir a antiga barra lateral larga. Não ocultar ações de envio em áreas fora da rolagem acessível do painel.

Validação desta revisão: 89 testes passaram; navegação e capturas foram conferidas em larguras suportadas de 1280 e 390 px. Os três ajustes da última rodada de revisão foram classificados como resolvidos. O detector automático está indisponível por módulo ausente. A antiga comparação de 61,6% usou captura inválida e permanece sem aprovação; não representa uma aprovação de fidelidade. Não houve teste de envio real nem de teclado virtual móvel.

Refinamento inicial de Conversas em 30/10/2026: 105 testes do projeto passaram e nove cenários de navegador foram conferidos sem erros de página, com envios simulados. As evidências ficam em `.impeccable/review/conversations/`. A captura inicial em 1280 × 720 px registrou histórico com aproximadamente 351 px de altura e pelo menos três mensagens completas; a revisão final daquela rodada confirmou apenas a resolução desse ajuste de altura. Não houve comp aprovada para este refinamento restrito, aprovação visual de toda a aplicação, envio real ou teste de teclado virtual. O detector continua indisponível por módulo ausente.

Refinamento de contatos, atividade e Atualizar em 30/10/2026: 128 testes do projeto, nove cenários de regressão de Conversas e seis verificações específicas de navegador passaram sem erros de página. As capturas e medições ficam em `.impeccable/review/inbox-refinement/`; o histórico atual em 1280 × 720 px mede aproximadamente 348 px de altura. A revisão final liberou o ajuste de contraste e o botão Atualizar dentro desse recorte, sem representar aprovação visual de toda a aplicação. Sem comp aprovada ou envios reais; o detector foi tentado uma vez e falhou pela ausência de `detect-url.mjs`.


Refinamento de Disparos em 30/10/2026: composição em uma coluna, com largura máxima de 1000 px e conteúdo de 760 px. Resumo da campanha recolhido abaixo do formulário em todos os tamanhos; a expansão é controlada pelo usuário. Importação em linha, sem caixa decorativa ou instruções repetidas. Verificação de números, seleção de conversas e nome opcional ficam em “Mais opções de contatos”. Resultados individuais da verificação só abrem automaticamente quando há números ausentes. Contadores sem ocorrências não aparecem no resumo de destinatários. Preservadas as três etapas, validação, revisão e confirmação de envio.

Verificação: 115 testes passaram. Navegador em 1440 e 390 px com dados sintéticos e APIs simuladas confirmou etapas, expansão, verificação de números e preservação dos campos ao voltar, sem erros de página ou transbordamento horizontal. Evidências em `.impeccable/review/broadcast-distill/`. Sem envio real. O detector automático segue indisponível por módulo ausente.


Simplificação da etapa Mensagem em 30/10/2026: editor e tipo de mensagem aparecem primeiro. Produto e assistente de escrita ficam em uma expansão após o editor, com preço e ações sem cartão de fundo. Personalização tem ajuda expansível. Ao abrir a IA, o rascunho permanece preservado e seu editor é temporariamente recolhido para evitar dois textos concorrentes. A sugestão pronta recolhe orientação e confirmação de custo; “Usar esta mensagem” é a ação principal e restaura o editor com foco. Voltar restaura o rascunho sem aplicar; descartar mantém o texto anterior. Campo obrigatório vazio reabre o editor durante a validação.

Validação desta etapa: 120 testes passaram; navegador em 1440 e 390 px com produto e geração simulados confirmou consentimento de custo, aplicação, descarte, troca de formato, foco, validação e navegação, sem erros de página ou transbordamento horizontal. Evidências em `.impeccable/review/message-distill/`. Não houve cobrança de API ou envio real. Detector automático indisponível por módulo ausente.


Correção de prioridade em 30/10/2026, após retorno do usuário: produto é essencial ao fluxo e fica sempre visível antes do formato e da mensagem, sem expansão nem rótulo de recurso opcional. O vínculo continua tecnicamente facultativo para preservar campanhas existentes. Preço e ações de produto ficam juntos; detalhes manuais e JSON de template ficam em uma única expansão de ajustes avançados. A caixa da mensagem permanece visível ao abrir a IA, preservando o rascunho até a aplicação explícita da sugestão. Esta decisão substitui a orientação anterior de ocultar temporariamente o editor.

Validação: 120 testes passaram na revisão de produto e template. A correção posterior de visibilidade foi conferida no navegador em 1440 e 390 px, incluindo abrir IA, gerar, descartar, aplicar, alternar formato e validar mensagem vazia, sem erros de página ou transbordamento. Dados de produto e geração simulados, sem cobrança ou envio. Evidências em `.impeccable/review/product-priority/`; detector automático indisponível por módulo ausente.


Refinamento de Envio e Revisão em 30/10/2026: preparação começa pela escolha de início em uma faixa lavanda discreta. Condições vigentes aparecem em lista de horários, dias, ritmo e limite diário, atualizada ao alterar os campos. Edição do ritmo e avisos operacionais ficam em expansões identificadas. Revisão apresenta destinatários, início e duração estimada em uma faixa de informações, com detalhes técnicos e da lista disponíveis por expansão. Produto permanece visível antes da prévia; consentimento tem área própria e ações de editar, testar e confirmar permanecem explícitas. O resumo inferior redundante fica oculto apenas na revisão.

Validação: 125 testes passaram. Em navegador isolado, larguras de 1440 e 390 px confirmaram horários, atualização de ritmo, agendamento com data obrigatória, revisão agendada e imediata, consentimento não preenchido e preservação dos ajustes ao editar, sem erros de página nem transbordamento horizontal. Prévia de API e produto simulados; nenhum envio ou agendamento real foi realizado. Evidências em `.impeccable/review/delivery-refine/`. O detector automático continua indisponível por módulo ausente.


Refinamento de Descadastros em 30/10/2026: painel permanente com título próprio, inclusão manual como ação principal roxa, importação por expansão e lista em seção separada com carregar/atualizar e exportar. Regras de descadastro e mensagem de confirmação ficam em expansões identificadas. Campos conservam rótulos, ajuda e foco visível; no celular as ações se acomodam à largura disponível. Durante operações, botões e importação ficam indisponíveis; erros e salvamento têm mensagens específicas.

Revisão visual manual em 1440 e 390 px concluída, incluindo lista vazia e conteúdo expandido. Verificação isolada confirmou validação, inclusão, importação CSV, exportação, remoção e persistência da confirmação com API simulada, sem erros de página nem transbordamento horizontal. Evidências em `.impeccable/review/suppression-refine/`. Testes gerais: 127 passaram, um falhou por módulo `/broadcast-history-model.js` ausente no trabalho de histórico concomitante. Sem alteração de contatos reais, teste de XLSX nesta rodada ou envio pelo WhatsApp.


Ajuste de exposição das condições de envio em 30/10/2026: no modo Após confirmação, as condições começam recolhidas; ao escolher Agendar data e horário, abrem automaticamente. A expansão continua controlável pelo usuário e não é redefinida ao editar campos. Alternar o modo preserva os limites e horários configurados, que continuam aplicados. Verificado em navegador nas larguras de 1440 e 390 px, incluindo resumo oculto/visível, manutenção do ritmo e revisão agendada/imediata, sem erros de página ou transbordamento.

Histórico de Disparos em 30/10/2026: campanhas agrupadas pelo identificador do produto, com seção Sem produto para registros sem vínculo. Filtros combináveis de produto, situação e busca; alternância entre grupos e ordem cronológica. O resumo reflete apenas os disparos exibidos. Mensagens completas ficam em expansão; resultados por destinatário, CSV e ações operacionais são preservados. Barras de progresso aparecem apenas em filas ativas ou pausadas. Campanhas concluídas com falhas ou resultados incertos mostram indicação de conferência, acompanhada de contadores destacados. O limite existente de 30 campanhas permanece explícito na ajuda.

Validação: 128 testes passaram; verificações em navegador nas larguras de 1440, 768, 390 e 320 px confirmaram filtros, limpeza, agrupamento, expansões preservadas na atualização, pausa, retomada, cancelamento, CSV e erro de conexão, sem erros de página ou transbordamento. Dados e ações simulados, sem envio real. Evidências em `.impeccable/review/history-refine/`. Detector indisponível por módulo ausente. Servidor local reiniciado para registrar os novos arquivos estáticos; saúde HTTP 200 confirmada.

### Login — revisão de 30/10/2026

O acesso preserva roxo, branco, texto escuro e Segoe UI. **The Acesso primeiro Rule.** Nesta superfície, o formulário branco vem antes do painel lavanda de identidade, tanto na leitura quanto no código. A composição central tem largura limitada; até 760 px, o painel de identidade desaparece e a página branca apresenta marca, formulário e rodapé, com recuo lateral mínimo de 24 px. Marca e formulário compartilham o mesmo eixo; o rodapé permanece centralizado. A composição completa está registrada em `.impeccable/surfaces/public-login-html.md`, sem se tornar regra para telas operacionais.

Campos e ação principal mantêm altura mínima de 54 px, texto de entrada de 16 px, rótulos explícitos e foco roxo visível. Mostrar/Ocultar senha é uma ação textual com estado acessível; erros aparecem junto ao formulário. A linguagem em português acolhe e orienta o acesso, o primeiro cadastro e o convite sem expor o nome do provedor.

Validação informada pela revisão: 128 testes do projeto passaram; navegador em 1440, 2548, 768, 390 e 320 px confirmou ausência de erros de página e transbordamento, além de erros de autenticação simulados, Mostrar/Ocultar senha, primeiro acesso e convite. Capturas em `.impeccable/review/login/`. Revisão local a partir do código, sem comp aprovada ou autenticação real; detector indisponível por módulo ausente. Os cantos de 24 px do contêiner, sua sombra suave e a ilustração de balões são escolhas locais do login, sem promoção a tokens globais.

Histórico recolhível por empreendimento em 30/10/2026: cada grupo começa fechado, mostrando nome e quantidade de disparos. O cabeçalho nativo abre e recolhe o grupo por clique ou teclado. A escolha de expansão é mantida durante atualizações, filtros e alternância de organização na mesma página. A nomenclatura da área passa a Empreendimento; os vínculos existentes com produtos são preservados. Conferido no navegador em 1440, 768, 390 e 320 px, incluindo teclado, atualização e ações do histórico, sem erros de página nem transbordamento. Três testes de agrupamento e filtros passaram. Evidências em `.impeccable/review/history-collapse/`. Nenhum envio real.

Animações de Disparos em 30/10/2026: abertura dos empreendimentos com revelação de conteúdo em 260 ms; grupos vizinhos acompanham a expansão ou o recolhimento com movimento de até 240 ms. Etapas do formulário transitam horizontalmente em 190 ms conforme o sentido da navegação. Abas e indicadores de etapa animam a seleção; cabeçalhos e setas respondem à interação. Atualização manual mostra indicador de carregamento apenas durante a solicitação, removido ao concluir, usar teclado ou ocultar a tela. Atualizações automáticas não acionam esse indicador. Movimento reduzido e teclado preservam mudanças imediatas, e novas interações cancelam animações anteriores.

Validação: 128 testes passaram. Seis cenários de navegador cobriram 1440, 768, 390 e 320 px, além de computador e celular com movimento reduzido; conferidos navegação, filtros, expansões, cliques rápidos, teclado, atualização manual lenta, erro de conexão e ações do histórico com API simulada. Sem erros de página, transbordamento ou envio real. Evidências em `.impeccable/review/broadcast-motion/`. Detector continua indisponível por módulo ausente. Nenhuma nova dependência ou reinicialização do servidor necessária.

Exclusão do histórico em 30/10/2026: cada disparo concluído ou cancelado oferece Excluir do histórico em cor de atenção, com confirmação identificando campanha, horário e empreendimento. Filas ativas ou pausadas devem ser canceladas antes; envios ainda em andamento impedem a operação no servidor. A ação autenticada e serializada marca removed_at e registra o operador em auditoria; a listagem filtra os removidos antes do limite de 30 registros. Registros de mensagens, destinatários, tentativas, contadores e identificadores são conservados para preservar o histórico operacional e impedir reenvio por repetição da criação. Os removidos não voltam à fila por resolução ou reenvio de falhas. Nenhum disparo real foi excluído durante a implementação.

Validação: 129 testes passaram; teste específico cobre confirmação, filas ativas, envio em andamento após cancelamento, remoção idempotente, persistência, auditoria e preservação de tentativas. API confere autenticação, confirmação e estados permitidos. Navegador com API simulada em 1440, 768, 390 e 320 px confirmou desistência, confirmação, falha recuperável, remoção e atualização dos grupos. Evidências em `.impeccable/review/history-delete/`. Detector indisponível por módulo ausente. Servidor reiniciado para carregar rota e migração, com saúde HTTP 200 confirmada.
