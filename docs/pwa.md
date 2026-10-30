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

Ao voltar ao app ou recuperar a conexão, uma nova verificação é feita, com intervalo mínimo de um minuto entre tentativas e sem consultas enquanto estiver offline. A ativação remove somente caches antigos com prefixo `zelo-public-`. O cache público atual é `zelo-public-v3`; a cada publicação com mudanças no app, atualize essa versão em `public/sw.js` para disparar a detecção da nova versão e renovar o precache. Os arquivos do painel continuam vindo da rede, incluindo as atualizações de conversas e disparos.

O fluxo segue o ciclo de atualização documentado pela [MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration) e a [ativação por mensagem após escolha do usuário](https://developer.chrome.com/docs/workbox/modules/workbox-window).

## Mobile

- Até 580 px, lista e conversa aberta alternam. **Voltar** retorna à busca sem apagar o rascunho. **Nova mensagem** abre o destinatário vazio.
- A partir de 581 px, lista e conversa continuam lado a lado.
- Campos usam 16 px no mobile para legibilidade e para evitar zoom automático no iOS.
- Prioridades das IAs recebem botões de 44 px; menus preservam foco e nomes acessíveis.
- Conexões mantém abas de IA, WhatsApp e assistente. No celular, abas de texto/áudio são compactas, ajudas e menus têm áreas de toque de 44 px e ações de formulário ocupam a largura disponível. O QR Code mantém sua área de leitura; antes de ser gerado, o estado fica compacto. A tela orienta abrir o Zelo em outro dispositivo ao vincular o WhatsApp do próprio celular.
- Safe-area e altura dinâmica acomodam recortes e barras móveis. Movimento reduzido continua respeitado.

## Verificação

`npm test` cobre cache, navegação sem persistência, exclusão de APIs/arquivos/mutações/queries, HTTP 401, limpeza restrita e dimensões dos PNGs. A navegação mobile é conferida no navegador com dados sintéticos.

Conexões foi conferida em 320, 390, 768 e 1440 px: abas, lista de texto/áudio, editor, menus de ações, preservação de rascunhos entre abas, campos da Cloud API e estados desconectado, QR disponível e conectado. QR e estados de conexão foram simulados, sem vincular número real. Os 132 testes passaram; não houve teste em aparelho físico ou com teclado virtual. O detector Impeccable está indisponível por falta do módulo `detect-url.mjs`; a revisão usou o navegador e capturas locais.

Referências: [MDN — PWAs instaláveis](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [MDN — service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), [Chrome — estratégias de cache](https://developer.chrome.com/docs/workbox/caching-strategies-overview/).
