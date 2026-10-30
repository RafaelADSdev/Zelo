# Wappy — painel de trabalho

Paleta solicitada pelo usuário: roxo, branco e preto. A tela inicial é Produtos e materiais, área que ele informou usar mais. Preservar integrações reais, dados cadastrados e todos os controles.

## Sistema

- Navegação escura (#18151e), seleção e ação principal roxas (#7041db), superfícies brancas e fundo neutro (#f6f5f9). Sem gradientes. Bordas #e5e1ec e sombras discretas com deslocamento nas superfícies de trabalho.
- Tipografia Segoe UI, títulos de página em 32 px, seções em 21–22 px, campos em 14 px e apoio em 12–13 px. Texto secundário #6d6579. Fontes locais evitam dependências de rede.
- Ícones SVG lineares consistentes, sem imagens inventadas para produtos. A capa usa o primeiro arquivo de imagem cadastrado, com estado vazio explícito quando não há imagem.
- Sidebar de 256 px no desktop e 224 px em telas intermediárias; navegação abaixo da marca em telas menores. Formulários passam a uma coluna; catálogo utiliza grid adaptável; conversas passam para uma coluna no celular. Campos móveis usam 16 px e os controles principais têm pelo menos 44 px de altura.
- Controle global da IA em faixa compacta; programação expandida sob demanda. Conexões se organizam por provedores, assistente e WhatsApp. Ocorrências recolhidas sob demanda.
- Estados de foco visíveis, contraste, seleção, campos, controles e movimento reduzido fazem parte do sistema.

## Verificação

Revisão de 30/10/2026: entrada conferida no servidor local; painel conferido em prévia isolada com APIs de leitura e dados vazios, sem usar a conta do usuário. Navegação entre produtos, conversas, disparos e configurações e abertura/fechamento da ficha de produto verificadas. Layout inspecionado no desktop, em 1024 px e em 390 px, sem transbordamento horizontal nas telas medidas. Os 83 testes do projeto passaram. O detector da skill permanece indisponível por módulo local ausente; a verificação visual foi feita diretamente no navegador. Fluxos autenticados com dados reais e envios não foram exercitados nesta revisão visual.
