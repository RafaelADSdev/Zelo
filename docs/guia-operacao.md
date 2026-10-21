# Referência detalhada de operação

Este guia preserva a configuração local e detalhes da implantação original. Para a arquitetura atual, consulte [Ambientes privados](workspaces.md), [Vercel](vercel.md) e [PWA](pwa.md).

Pasta principal do projeto: `C:\Users\Usuario\Documents\Zelo`.
Abra `INICIAR.cmd` para iniciar e `PARAR.cmd` para encerrar.
Identidade visual em `public/brand/`; cópia dos materiais do Sopro em `materiais/sopro/`.

## Login do administrador

### Instalação conectada ao Supabase

O projeto configurado usa Supabase Auth para o administrador e Postgres/Storage como fonte dos produtos, links e anexos. O primeiro administrador informa um e-mail e senha na tela, usando o código local de primeiro acesso. A senha é enviada ao Supabase Auth pelo servidor; nesta modalidade, nenhum hash ou senha é salvo em auth.json, apenas o vínculo do administrador. A sessão do painel continua protegida pelo cookie HttpOnly. Outras contas do projeto Supabase não ganham acesso ao Zelo automaticamente.

As tabelas zelo_products, zelo_product_files e zelo_runtime_snapshots têm RLS e nenhum acesso para anon/authenticated. Somente o servidor usa a chave secreta. O bucket zelo-materials é privado; imagens e PDFs são entregues pelo endpoint do Zelo, que exige login. Os arquivos locais anteriores foram mantidos como cópia; depois da ativação, alterações no catálogo são feitas diretamente na nuvem e não têm fallback silencioso para SQLite.

O worker do WhatsApp continua usando SQLite no servidor para filas, memória e sessão do QR. Uma cópia desse estado, das instruções gerais e das configurações é enviada a zelo_runtime_snapshots a cada minuto quando muda, com AES-256-GCM e compressão. A chave de descriptografia SUPABASE_BACKUP_KEY fica somente no .env deste servidor: preserve esse arquivo em local seguro para conseguir recuperar as cópias. Isso não transforma o worker em função da Vercel nem o mantém rodando com o servidor desligado.

A migração idempotente está em supabase/migrate.mjs; execute com o servidor parado. Ela preserva IDs, verifica SHA-256 de cada arquivo após ler do Storage, não sobrescreve produtos divergentes e registra o resultado em .wappy/supabase-migration.json. O SQL versionado fica em supabase/migrations/001-zelo.sql. As credenciais ficam no .env ignorado pelo Git. Não publique .env ou .wappy.

O painel exige login, inclusive nas APIs, anexos, conversas e controles de IA/WhatsApp. No primeiro acesso a `/login`, crie o administrador usando o código em `.wappy/primeiro-acesso.txt`, gerado pelo servidor. Não há cadastro público depois da criação. A senha precisa de pelo menos 12 caracteres. No modo local, somente o hash scrypt com salt aleatório é persistido em `.wappy/auth.json`; na instalação com Supabase, a senha é gerenciada pelo Supabase Auth. Esse arquivo nunca contém a senha original.

A sessão usa cookie HttpOnly, SameSite=Strict e validade absoluta de 12 horas. Sair revoga a sessão. Reiniciar o servidor exige novo login. Após cinco tentativas inválidas, o login fica bloqueado por cinco minutos. Os dados existentes e a sessão do WhatsApp continuam preservados; sair do painel não desconecta o WhatsApp.

O servidor local aceita apenas HTTP em loopback neste computador. O cookie não usa Secure nesse ambiente HTTP local. Na Vercel, `api/index.mjs` atende HTTPS com cookies Secure e origem permitida, enquanto um Daemon executa o atendimento continuamente e restaura o estado cifrado do Supabase. Veja [a configuração e os limites da hospedagem](docs/vercel.md). O webhook separado continua validando assinaturas da Meta sem exigir login de navegador. `PARAR.cmd` usa um token local de controle, válido somente para encerrar esta instância, sem abrir acesso às demais APIs.

Aplicação local com configuração pelo navegador, conexão por QR Code ou WhatsApp Cloud API e respostas pelo provedor de IA selecionado. O código da aplicação não usa respostas por regras, pedidos fictícios ou um canal de WhatsApp imitado.

## Iniciar e encerrar

Requer Node.js 22 ou superior. Abra `INICIAR.cmd` e acesse http://127.0.0.1:4173. Mantenha o computador e o servidor ligados para receber mensagens. Para encerrar o servidor e o túnel, abra `PARAR.cmd` ou use Ctrl+C no terminal que iniciou o servidor.

Pelo terminal:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd start
```

A porta 4173 serve o painel somente neste computador. A porta 4174 serve exclusivamente `/webhook` para a Meta. O túnel gerado pelo painel aponta apenas para a porta do webhook. As rotas administrativas não são servidas nessa porta.

## Chaves de IA e instruções globais

O painel usa uma única **lista de prioridade**, em **Conexões**. Cadastre até 20 chaves de Google Gemini, OpenAI/GPT, Anthropic/Claude, xAI/Grok, DeepSeek, OpenRouter ou Groq. Cada registro tem nome, provedor, ID exato do modelo e segredo próprios; são aceitas várias chaves diferentes do mesmo provedor. A configuração individual foi removida da interface. Dados antigos continuam preservados para compatibilidade, mas não são usados como reserva oculta quando a lista está em uso.

Use **Subir/Descer** para salvar a ordem, **Pausar/Ativar** para controlar a participação e **Validar** para testar uma chave (a chamada real pode consumir créditos). O campo de segredo vazio ao editar mantém o valor cadastrado. **Excluir** pede confirmação, remove o registro e seu segredo da lista e apaga sua referência de última utilização. Não revoga a chave no site do provedor. Ao excluir a última chave ativa, o atendimento fica sem chave disponível. A exclusão não recria registros ao reiniciar; uma solicitação já em andamento pode terminar.

O **nome e as instruções do assistente são globais**, na seção própria. São utilizados por todas as chaves e provedores, inclusive após troca automática. Salvar essas instruções não altera chaves, modelos nem a ordem da lista.

Com a troca automática ligada, cada geração tenta a primeira chave ativa e fora de espera. HTTP 429 e 402, além de erros de créditos/limite de gastos identificados na Claude em HTTP 400, permitem seguir para a próxima. A espera respeita Retry-After, limitada a 24 horas; sem prazo informado, é de cinco minutos. Depois disso a chave volta a ser elegível, o que não garante renovação da cota. Chaves do mesmo projeto podem compartilhar limites. **Liberar nova tentativa** apenas retira a espera local. Chave inválida, falta de permissão, modelo incorreto, falhas de rede e formato inválido não disparam troca automática.

Com a troca automática desligada, apenas a primeira chave ativa da lista é usada. Sem chaves ativas ou com todas em espera, a aplicação informa indisponibilidade; não usa uma chave antiga da configuração individual. Cada chave é tentada no máximo uma vez por geração, com prazo total de 55 segundos. A última chave usada e os motivos de falha/espera aparecem no painel.

Chaves, ordem e situação são persistidos em .wappy/settings.json, ignorado pelo Git. O navegador recebe somente indicadores e metadados. O contexto pode ser enviado aos provedores habilitados na sua lista. Os testes usam transportes controlados para verificar cada protocolo, instruções globais, ordem, limites, exclusão e persistência.

**Groq:** o cadastro sugere openai/gpt-oss-20b. Crie a chave em https://console.groq.com/keys; a faixa gratuita tem limites por conta e modelo (https://console.groq.com/docs/rate-limits). A integração usa JSON Schema estrito nos modelos conhecidos compatíveis e JSON Object validado no servidor nos demais. A validação real depende de chave, acesso ao modelo e cota disponíveis.

## Conectar por QR Code

1. Abra **Conexões** e selecione **QR Code · vincular meu WhatsApp**.
2. Confira o controle **Atendimento automático** no topo do painel. Use **Ligar agora**, **Desligar** ou **Programar horário**. Preencha também a base de informações do negócio.
3. Clique em **Gerar QR Code**. O código exibido é recebido do WhatsApp e se renova automaticamente enquanto a vinculação está em andamento.
4. No celular, abra **WhatsApp → Aparelhos conectados → Conectar aparelho** e escaneie o código do painel.
5. Aguarde o painel indicar **WhatsApp conectado**. Envie uma mensagem de texto usando outro WhatsApp e acompanhe em **WhatsApp** no painel.

Esse modo usa [Baileys](https://github.com/WhiskeySockets/Baileys), uma biblioteca não oficial do WhatsApp Web. Pode sofrer mudanças, desconexões ou restrições da plataforma. Não precisa de token Meta, webhook nem túnel. O QR não substitui a chave da API de IA selecionada.

A sessão e as chaves Signal ficam na tabela `qr_auth` do banco local `.wappy/wappy.db`, sem serem enviadas ao navegador. **Pausar conexão** mantém a sessão; **Gerar QR Code** reconecta uma sessão já registrada sem exigir novo QR, quando possível. **Desvincular e apagar sessão** solicita logout e remove a autenticação local. Também é possível revogar o dispositivo pelo celular. Ao encerrar e abrir o servidor, uma conexão ativa é restaurada automaticamente.

O modo QR atende apenas mensagens individuais novas de texto. Ignora mensagens próprias, grupos, status, mídia e sincronização antiga. IDs recebidos e envios são persistidos para evitar repetição. Se um envio ficar sem confirmação, confira no celular antes de enviar novamente. Conversas ficam isoladas por conta vinculada. Os testes automatizados usam um socket injetado; o aplicativo usa a conexão real Baileys. Receber o QR real não confirma login: a conta só fica conectada após escanear e receber a confirmação do WhatsApp.

## Conectar pela Cloud API oficial

Selecione **Cloud API · API oficial da Meta** nas conexões. Somente o modo selecionado atende mensagens automaticamente.

1. Entre em **Conexões** no painel.
2. Escolha seu provedor de IA e confira chave, modelo, nome e instruções. Use **Salvar e validar IA** para testar a conexão real.
3. No seu aplicativo do [Meta for Developers](https://developers.facebook.com/apps/), obtenha o **token de acesso**, **Phone Number ID**, **WhatsApp Business Account ID (WABA)** e **App Secret**. Preencha os campos correspondentes. O token precisa das permissões e do acesso à conta/número que você vai usar.
4. Clique em **Salvar e validar número na Meta**. O número e o nome retornados pela Meta aparecerão na tela.
5. Clique em **Inscrever aplicativo na WABA**. Isso chama a API oficial de inscrição da conta.
6. Preencha sua URL pública HTTPS estável, ou clique em **Gerar URL pública temporária**. Na primeira execução, a aplicação baixa o `cloudflared` do repositório oficial da Cloudflare, verifica o SHA-256 informado pelo GitHub e inicia o processo sem abrir uma janela.
7. Copie a **URL de callback** e o **token de verificação** para a configuração de Webhooks do aplicativo na Meta. Clique em **Verificar e salvar** na Meta e assine o campo **messages** do objeto `whatsapp_business_account`.
8. Ative **Responder automaticamente com a IA selecionada** e salve.
9. Envie uma mensagem de texto de outro WhatsApp para o número conectado. Abra **WhatsApp** no painel para acompanhar a entrada, a resposta e os status enviados pela Meta.

Se você usa o número de teste oficial da Meta, autorize os destinatários no painel dela. As mensagens desse ambiente continuam passando pelo WhatsApp real. Para um número próprio, conclua o cadastro e as aprovações exigidas pela sua conta Meta.

O token de verificação do webhook é gerado pela aplicação. Ele é diferente do token de acesso da Meta e diferente do App Secret.

## O que funciona

- Salvar e alterar credenciais, número, modelo e instruções sem editar código ou reiniciar.
- Validar a IA selecionada com uma chamada real e validar o número com a Graph API.
- Inscrever o aplicativo na WABA e listar os templates aprovados da conta.
- Verificar o desafio GET da Meta e a assinatura HMAC-SHA256 de cada POST sobre os bytes originais.
- Aceitar apenas eventos do número configurado; deduplicar os IDs de mensagem.
- Persistir o recebimento antes de responder HTTP 200 e processar a fila separadamente.
- Gerar respostas reais com a IA selecionada usando o histórico de cada contato e as informações do negócio.
- Enviar respostas e mensagens manuais de texto pela API oficial.
- Bloquear texto livre sem mensagem recebida nas últimas 24 horas; enviar templates aprovados para iniciar ou reabrir o atendimento.
- Preencher variáveis de templates por posição ou por nome; informar componentes JSON quando o template exigir cabeçalho ou botões.
- Exibir status de mensagem aceita, entregue, lida e falha a partir dos eventos reais da Meta, sem confundir aceitação com entrega.
- Pausar respostas automáticas, responder manualmente e solicitar nova tentativa com IA pelo painel.
- Retomar mensagens pendentes após reiniciar. Envios cujo resultado ficou desconhecido não são repetidos automaticamente, para evitar duplicação.
- Separar o histórico da conversa local e o histórico de cada contato/número do WhatsApp.

## Informações e alcance do assistente

### Catálogo de produtos e materiais

Em **Informações do negócio**, use **Novo produto** para cadastrar uma ficha com nome, descrição, preço/condições de referência, links HTTPS e anexos. Edite cada ficha separadamente. Desmarcar **Produto ativo** arquiva a ficha e a retira das consultas do catálogo, mantendo os dados. Informações que também estiverem na base geral continuam disponíveis por essa base.

São aceitos até 100 produtos, 15 links e 100 arquivos por produto. Cada arquivo pode ter até 10 MB; o armazenamento local do catálogo tem limite de 500 MB. Formatos: JPG, PNG, WebP e PDF. Os bytes são validados e guardados em tabelas SQLite locais em `.wappy/wappy.db`. Nenhum upload é publicado na internet. O painel permite visualizar imagens e baixar PDFs.

O assistente consulta as descrições e links dos produtos ativos. Quando o cliente pede imagens, book ou PDF, a IA pode selecionar até três anexos disponíveis no contexto. A seleção é conferida no servidor; IDs inventados são descartados. No modo QR, os arquivos são enviados pelo socket real. Na Cloud API, são carregados na Meta por multipart e enviados pelo ID da mídia, respeitando a janela de atendimento. Nesse modo, imagens devem ser JPG/PNG de até 5 MB; WebP é aceito no modo QR. Os links públicos podem ser compartilhados na resposta textual. Endereços locais de download nunca devem ser enviados ao cliente no WhatsApp.

O conteúdo de PDFs e imagens não é extraído nem interpretado automaticamente. Cadastre na descrição as informações que a IA deve conhecer e dê nomes claros aos arquivos. Não inclua documentos privados ou materiais que não queira disponibilizar aos clientes. A orientação de encaminhar pedidos de imagens do Sopro para o site continua válida.

As alterações usam revisão da ficha para detectar edição concorrente. Envios de anexos têm registro próprio e não são repetidos silenciosamente quando o resultado fica desconhecido. Os testes usam arquivos e transportes injetados, sem enviar mensagens para contatos reais.

A base começa vazia. Cadastre os dados reais em **Informações do negócio**. A consulta usa BM25 por palavras, com normalização de acentos, e os trechos recuperados são enviados ao provedor selecionado.

O atendimento automático desta versão é **por texto**. No modo QR, mídia é ignorada; na Cloud API, ao receber mídia sem texto, o bot pede uma descrição escrita. O assistente não alega ter ouvido áudio ou analisado imagem. A aplicação não inclui sistemas externos de pedidos, pagamentos, estoque ou agenda. Essas ações precisam das respectivas integrações e não são inventadas pelo modelo.

A tela inicial é a seção **WhatsApp**, com contatos, histórico de atendimento, envios e fila. A tela de conversa local com a IA foi removida da interface.

## URL pública e operação contínua

O Quick Tunnel da Cloudflare é temporário, muda de hostname ao reiniciar e não oferece disponibilidade garantida. Para manter o atendimento contínuo, configure uma URL HTTPS estável apontando para `http://127.0.0.1:4174`, preserve o computador/servidor ligado e configure monitoramento e reinício do processo no ambiente escolhido. Nunca encaminhe publicamente a porta do painel.

A Meta precisa conseguir acessar a URL; preencher o campo local não altera sozinho a configuração de webhook no painel da Meta.

## Configuração e dados locais

- `.wappy/settings.json`: credenciais e instruções salvas no painel. Os segredos não são retornados pela API administrativa; os campos vazios preservam os valores salvos.
- `.wappy/wappy.db`: SQLite com histórico, perfil, fila de entrada, saída, eventos e status.
- `.wappy/base.txt`: informações reais cadastradas pelo usuário.
- `.env`: chave inicial do Gemini, modelo e portas. A configuração salva no painel tem prioridade nas próximas inicializações.
- `.wappy/bin/`: cloudflared oficial e checksum para o túnel opcional.

`.env`, `.wappy/` e `node_modules/` são ignorados pelo Git. Mantenha os arquivos de configuração protegidos no seu computador e preserve o banco para não perder a deduplicação e o histórico. As mensagens e o contexto necessário à resposta são transmitidos ao provedor de IA selecionado; mensagens de WhatsApp passam pela Meta e, quando usado, pelo túnel da Cloudflare.

A versão anterior usava `.wappy/teste.db` e `conhecimento.txt`. Esses arquivos foram preservados, mas não alimentam esta aplicação. Não há migração automática de dados fictícios para a base real.

## Diagnóstico

- **Sem resposta:** confira a validação da IA selecionada, a opção de resposta automática, a inscrição da WABA, a assinatura do campo `messages`, a URL pública e a fila de ocorrências.
- **Código 190:** token inválido ou expirado; atualize o token na configuração.
- **Código 131030:** destinatário ainda não autorizado no ambiente de teste da Meta.
- **Código 131047 / janela fechada:** use um template aprovado ou espere uma mensagem do contato.
- **Envio sem confirmação:** confira o WhatsApp e os status da Meta antes de fazer um novo envio. A aplicação bloqueia a repetição automática dessa operação.
- **Webhook 403:** confira App Secret, assinatura, token de verificação e configuração da Meta.
- **URL temporária mudou:** atualize o callback na Meta e faça nova verificação.

## Verificação técnica

```powershell
npm.cmd test
```

Os testes usam os servidores HTTP, o banco e os pacotes Wappy reais, com transportes externos controlados exclusivamente nos testes. Cobrem ausência de credenciais sem resposta simulada, assinatura inválida, número incorreto, isolamento do painel, desafio da Meta, persistência antes do processamento, deduplicação, geração e envio, janela de 24 horas, templates, idempotência de envio manual, status fora de ordem, retomada após reiniciar, resultado desconhecido e separação por número configurado.

Testes automatizados não confirmam permissões, registro do número ou entrega na conta Meta do usuário. Essa confirmação requer as credenciais reais e o teste enviando e recebendo pelo seu número.

## Referências

- [Wappy Kit](https://github.com/csr1010/wappy-kit)
- [Meta: Webhooks do WhatsApp](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks)
- [Meta: mensagens](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages)
- [Gemini generateContent](https://ai.google.dev/api/generate-content)
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

## Contas e ambientes privados em produção

Cada conta autorizada tem seu próprio WhatsApp, APIs, produtos, materiais, conversas e instruções. A conta original administra convites em **Gestão de acessos**, exclusiva da conta de administrador master. O link vale por 48 horas e é compartilhado manualmente; não há cadastro público. A pessoa escolhe sua própria senha. É possível suspender o acesso e pausar o WhatsApp sem apagar os dados. Consulte [a configuração e a migração de ambientes](docs/workspaces.md).

## Programação do atendimento automático

O controle no topo de todas as telas vale para QR Code e Cloud API. **Ligar agora** ativa continuamente e desativa a programação. **Desligar** pausa até nova ação. Em **Programar horário**, escolha dias da semana, início/fim ou dia inteiro e, opcionalmente, datas inicial/final inclusivas. Clique em **Salvar e ativar programação**. O fuso é America/Sao_Paulo, independentemente do fuso do computador. Uma faixa 22:00–02:00 pertence ao dia de início, inclusive no limite da data final.

A configuração persiste após reiniciar. O servidor deve estar ligado e conectado: ele não liga o computador. Mensagens recebidas fora do período não são respondidas automaticamente quando a faixa seguinte começa; ficam para atendimento manual. Envios manuais e **Tentar responder** são ações explícitas do operador e continuam disponíveis. O worker verifica o horário antes de gerar e antes de enviar texto/anexos; um envio já transmitido ao WhatsApp não pode ser cancelado.
