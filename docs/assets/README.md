# Origem das imagens

- `capa.svg`: composição vetorial própria, reutilizando o símbolo de `public/brand/icon.svg`.
- `painel-ias.png`, `mobile-conexoes.png` e `mobile-whatsapp.png`: capturas da revisão local de Conexões em 30/10/2026. Origem: `.impeccable/review/connections/`, geradas com conta de teste e credenciais sintéticas, sem validar chaves ou conectar um WhatsApp real.
- `painel-conversas.png`, `mobile-lista.png` e `mobile-conversa.png`: capturas da revisão de Conversas em 30/10/2026. Origem: `.impeccable/review/inbox-refinement/`, com contatos, mensagens e contagens sintéticos. Não representam clientes ou métricas reais de uso.
- As capturas são copiadas para esta pasta para que o README não dependa de arquivos de revisão ignorados pelo Git. Nenhuma chave real é exibida. A área de Conexões mostra configurações de demonstração; a de Conversas inclui estados de pausa e falha simulados para ilustrar a operação.
- Ícones em `public/brand/pwa`: rasterização determinística do SVG existente sobre fundo #151419; maskable com símbolo na área segura central.
