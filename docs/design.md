# Wappy — painel de trabalho

Paleta solicitada pelo usuário: roxo, branco e preto. A tela inicial é Produtos e materiais, área que ele informou usar mais. Preservar integrações reais, dados cadastrados e todos os controles.

## Sistema

- Navegação preta (#151419), superfícies brancas, fundo neutro (#f7f7fa), ação principal roxa (#7041db). Sem gradientes.
- Tipografia Segoe UI, hierarquia 32/19/15/14/12 px, textos secundários em #686873. Fontes locais evitam dependências de rede.
- Ícones SVG lineares consistentes, sem imagens inventadas para produtos. A capa usa o primeiro arquivo de imagem cadastrado, com estado vazio explícito quando não há imagem.
- Sidebar de 240 px no desktop e navegação horizontal abaixo da marca em telas menores. Formulários passam a uma coluna; catálogo utiliza grid adaptável; conversas passam para uma coluna no celular.
- Controle global da IA em faixa compacta; programação expandida sob demanda. Conexões se organizam por provedores, assistente e WhatsApp. Ocorrências recolhidas sob demanda.
- Estados de foco visíveis, contraste, seleção, campos, controles e movimento reduzido fazem parte do sistema.

## Verificação

Navegação, busca com/sem resultados, abertura de ficha e telas de conexões e conversas conferidas no navegador. Testes do projeto: 23 passaram. O detector da skill está indisponível por módulo local ausente; a verificação visual foi feita diretamente no navegador. Emulação de viewport móvel indisponível no controle de navegador desta sessão; regras responsivas implementadas e inspecionadas no código.
