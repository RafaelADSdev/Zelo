# Zelo
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Usuário que configura atendimento de WhatsApp com IA. Em 30/10/2026 confirmou que utiliza principalmente Conversas e Disparos. Depois escolheu explicitamente Produtos e materiais como primeira tela; as outras tarefas ficam acessíveis no menu superior.

## Product Purpose
Cadastrar produtos com descrições, links, imagens e PDFs e permitir que um assistente consulte esse conteúdo para atender pelo WhatsApp.

## Capabilities and Constraints
Node.js com HTML, CSS e JavaScript nativos. Integrações reais por QR e Cloud API; múltiplos provedores e chaves em ordem de prioridade; instruções globais; atendimento manual; programação semanal com datas opcionais. Dados e credenciais persistidos localmente. O redesenho deve preservar esses comportamentos e dados. O servidor precisa permanecer em execução para receber mensagens.

## Brand Commitments
Nome Zelo. Interface em português. Usuário pediu explicitamente roxo, branco e preto para o novo visual.

## Evidence on Hand
Aplicação em http://127.0.0.1:4173/, catálogo e conversas reais. Não inventar métricas, produtos, depoimentos ou imagens de imóveis.


## Disparos v2

Campanhas de texto e templates aprovados, importação de telefone/nome/variáveis, revisão do servidor e confirmação de consentimento com operador e horário. Descadastro por palavras-chave, confirmação configurável e lista de supressão por ambiente/conexão. O QR registra envios na memória da conversa.

Ritmo, jitter, limites por minuto/dia e janela com fuso são persistidos. Três falhas consecutivas, autenticação recusada ou limitação da Meta pausam a campanha. Mensagens incertas não são repetidas sem decisão explícita e auditada. A fila mantém a conexão original e não a substitui por outra conta.

O histórico usa contadores agregados e destinatários paginados, com entrega/leitura quando confirmadas pelo transporte. Campanhas anteriores sem consentimento ficam pausadas. A ferramenta não garante ausência de bloqueio e não certifica adequação jurídica; a empresa deve conservar evidência da autorização e definir retenção e atendimento aos direitos dos titulares.

P1 pendente: mídia em campanhas, verificação QR de existência no WhatsApp e filtros/listas/etiquetas avançados. P2 opcional permanece fora desta versão. Veja [Disparos v2](disparos.md) para operação, riscos conhecidos, motivos das pendências, resumo por arquivo e roteiro de teste com segundo número.
