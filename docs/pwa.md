# PWA e experiência móvel

## Instalação

O manifest `/manifest.webmanifest` define identidade `/`, escopo `/`, início `/`, modo `standalone`, ícones PNG de 192/512 px e maskable de 512 px. O Apple Touch tem 180 px. Todos derivam do SVG original do Zelo; o maskable mantém o símbolo na área central segura.

Em navegadores compatíveis, `beforeinstallprompt` libera **Instalar Zelo**. O prompt só abre após o clique. No iOS, use Safari → Compartilhar → Adicionar à Tela de Início. Apps já instalados escondem o botão. Navegadores sem suporte continuam acessando o site.

Use HTTPS em produção; loopback pode ser usado no desenvolvimento. A instalação depende do navegador. Instalação nativa em aparelho físico não faz parte dos testes automatizados.

## Offline e limites

O service worker `/sw.js` guarda uma lista fechada de recursos públicos: `/offline`, seu CSS, manifest e ícones. Navegações usam a rede; falhas de rede/servidor mostram a recuperação pública. Nenhuma página autenticada é salva. URLs com query, Authorization, métodos diferentes de GET, APIs e anexos ficam fora do cache.

Não há fila de mensagens offline no navegador. O painel precisa de rede e sessão para consultar dados ou enviar. O atendimento automático só continua com servidor e integrações operantes; o PWA não executa o worker WhatsApp no dispositivo. HTTP 401 não é substituído pela tela offline.

## Atualização

O registro usa `updateViaCache: none`. Não força `skipWaiting`, evitando substituir a versão em uso com formulários não salvos. Feche todas as janelas do app e reabra para ativar uma versão em espera. A ativação remove somente caches antigos com prefixo `zelo-public-`. Ao alterar recursos que precisem de novo precache, atualize a versão do cache.

## Mobile

- Até 580 px, lista e conversa aberta alternam. **Voltar** retorna à busca sem apagar o rascunho. **Nova mensagem** abre o destinatário vazio.
- A partir de 581 px, lista e conversa continuam lado a lado.
- Campos usam 16 px no mobile para legibilidade e para evitar zoom automático no iOS.
- Prioridades das IAs recebem botões de 44 px; menus preservam foco e nomes acessíveis.
- Safe-area e altura dinâmica acomodam recortes e barras móveis. Movimento reduzido continua respeitado.

## Verificação

`npm test` cobre cache, navegação sem persistência, exclusão de APIs/arquivos/mutações/queries, HTTP 401, limpeza restrita e dimensões dos PNGs. A navegação mobile é conferida no navegador com dados sintéticos.

Referências: [MDN — PWAs instaláveis](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [MDN — service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), [Chrome — estratégias de cache](https://developer.chrome.com/docs/workbox/caching-strategies-overview/).
