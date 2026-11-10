# PWA e experiência móvel

## Instalação

O manifest `/manifest.webmanifest` define identidade `/`, escopo `/`, início `/`, modo `standalone`, ícones PNG de 192/512 px e maskable de 512 px. O Apple Touch tem 180 px. Todos derivam do SVG original do Zelo; o maskable mantém o símbolo na área central segura.

Em navegadores compatíveis, `beforeinstallprompt` libera **Instalar Zelo**. O prompt só abre após o clique. No iOS, use Safari → Compartilhar → Adicionar à Tela de Início. Apps já instalados escondem o botão. Navegadores sem suporte continuam acessando o site.

Use HTTPS em produção; loopback pode ser usado no desenvolvimento. A instalação depende do navegador. Instalação nativa em aparelho físico não faz parte dos testes automatizados.

## Offline e limites

O service worker `/sw.js` guarda uma lista fechada de recursos públicos: `/offline`, seu CSS, manifest e ícones. Navegações usam a rede; falhas de rede/servidor mostram a recuperação pública. Nenhuma página autenticada é salva. URLs com query, Authorization, métodos diferentes de GET, APIs e anexos ficam fora do cache.

Não há fila de mensagens offline no navegador. O painel precisa de rede e sessão para consultar dados ou enviar. O atendimento automático só continua com servidor e integrações operantes; o PWA não executa o worker WhatsApp no dispositivo. HTTP 401 não é substituído pela tela offline.

## Atualização

O registro usa `updateViaCache: none`. Quando há uma versão em espera, aparece **Atualizar Zelo**, acompanhado do aviso para salvar as edições. A ativação antecipada só ocorre após o clique; a janela que solicitou a atualização recarrega uma única vez quando o novo service worker assume. Outras janelas não recarregam automaticamente. Também é possível fechar todas as janelas do app e reabrir para ativar a versão em espera.

Ao voltar ao app ou recuperar a conexão, uma nova verificação é feita, com intervalo mínimo de um minuto entre tentativas e sem consultas enquanto estiver offline. A ativação remove somente caches antigos com prefixo `zelo-public-`. O cache público atual é `zelo-public-v4`; a cada publicação com mudanças no app, atualize essa versão em `public/sw.js` para disparar a detecção da nova versão e renovar o precache. Os arquivos do painel continuam vindo da rede, incluindo as atualizações de conversas e disparos.

O fluxo segue o ciclo de atualização documentado pela [MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration) e a [ativação por mensagem após escolha do usuário](https://developer.chrome.com/docs/workbox/modules/workbox-window).

## Mobile

- Até 800 px, Produtos, Conversas, Disparos e Conexões ficam na navegação inferior, com ícones e nomes visíveis, sem rolagem lateral. Marca e conta ocupam um cabeçalho de 64 px, acrescido da área segura. O acesso administrativo continua disponível para contas autorizadas.
- Até 580 px, lista e conversa aberta alternam. A conversa ocupa a tela acima da navegação e tem cabeçalho próprio. **Voltar** retorna ao contato selecionado sem apagar o rascunho nem abrir o teclado. **Nova mensagem** abre o destinatário vazio.
- A navegação participa do histórico do navegador: voltar e avançar percorrem áreas e a abertura da conversa. `/#conversas`, `/#disparos` e `/#conexoes` permitem reabrir diretamente a área; `/` mantém Produtos como início. Rascunhos não são persistidos após recarregar a página.
- Atendimento automático começa compacto no celular e tablet; **Ajustar** expande a explicação e as ações de ligar, pausar e programar. A programação permanece acessível por rolagem quando expandida.
- Até 580 px, o catálogo apresenta produto, status, materiais e edição em linhas adaptadas, sem exigir rolagem lateral da tabela.
- A partir de 581 px, lista e conversa continuam lado a lado.
- Campos usam 16 px no mobile para legibilidade e para evitar zoom automático no iOS.
- Prioridades das IAs recebem botões de 44 px; menus preservam foco e nomes acessíveis.
- Conexões mantém abas de IA, WhatsApp e assistente. No celular, abas de texto/áudio são compactas, ajudas e menus têm áreas de toque de 44 px e ações de formulário ocupam a largura disponível. O QR Code mantém sua área de leitura; antes de ser gerado, o estado fica compacto. A tela orienta abrir o Zelo em outro dispositivo ao vincular o WhatsApp do próprio celular.
- Safe-area e altura dinâmica acomodam recortes e barras móveis. Na conversa do celular, a VisualViewport ajusta a área de resposta quando detecta o teclado; a navegação inferior é temporariamente recolhida. O zoom por gesto permanece disponível. Movimento reduzido continua respeitado.
- A cor do navegador e do manifest acompanha o cabeçalho branco. O status bar do iOS usa o modo padrão para manter os indicadores legíveis.

## Verificação

`npm test` cobre cache, navegação sem persistência, exclusão de APIs/arquivos/mutações/queries, HTTP 401, limpeza restrita e dimensões dos PNGs. A navegação mobile é conferida no navegador com dados sintéticos.

Conexões foi conferida em 320, 390, 768 e 1440 px: abas, lista de texto/áudio, editor, menus de ações, preservação de rascunhos entre abas, campos da Cloud API e estados desconectado, QR disponível e conectado. QR e estados de conexão foram simulados, sem vincular número real. Os 132 testes passaram; não houve teste em aparelho físico ou com teclado virtual. O detector Impeccable está indisponível por falta do módulo `detect-url.mjs`; a revisão usou o navegador e capturas locais.

Revisão móvel de 10/11/2026: as quatro áreas foram conferidas no Chrome isolado em 320 × 568, 375 × 667, 390 × 844, 430 × 932, 580 × 800, 768 × 1024, 844 × 390, 1280 × 720 e 1440 × 1000, sem transbordamento horizontal ou erros de página. Treze fluxos cobrem histórico, rascunho da conversa, nova mensagem, filtros, busca, programação, abertura direta e recarga, abas por teclado e editor de produto. A redução da VisualViewport foi simulada para conferir a posição do botão de enviar; não substitui um teste com teclado físico do dispositivo ou teclado virtual real. Evidências locais em `.impeccable/review/pwa-mobile/`, com dados sintéticos e nenhum envio ao WhatsApp.

Referências: [MDN — PWAs instaláveis](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [MDN — service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), [Chrome — estratégias de cache](https://developer.chrome.com/docs/workbox/caching-strategies-overview/).
