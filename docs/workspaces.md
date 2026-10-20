# Ambientes privados por conta

Em produção, cada login autorizado no Supabase possui um ambiente próprio. O servidor identifica o usuário pelo resultado da autenticação e pela sessão HttpOnly; não aceita um `owner_id` enviado pelo navegador para selecionar o ambiente.

O isolamento inclui credenciais e ordem das IAs, instruções do assistente, horários, WhatsApp QR e Cloud API, contatos, mensagens, memória, base de conhecimento, produtos e anexos. Sair do painel mantém o atendimento funcionando. Suspender uma conta revoga suas sessões e encerra sua conexão de WhatsApp, preservando os dados.

## Convites

Somente a conta original tem o papel `owner`. Em **Conexões e IA → Contas e convites**, ela informa o e-mail e gera um link para compartilhar manualmente. Não há envio automático de e-mail. O link contém um segredo aleatório de 256 bits no fragmento da URL; somente seu hash é armazenado. Ele expira em 48 horas, é vinculado ao e-mail e é consumido uma única vez. A pessoa escolhe sua senha na página de ativação. Se já existir uma conta desse e-mail no Supabase, deve usar a senha existente: o convite não redefine senhas.

O cadastro direto no Supabase não libera acesso ao Zelo. A tabela privada `zelo_workspaces` é a lista de autorização e somente o backend pode alterá-la. O administrador pode suspender e reativar acessos, mas não recebe uma função de abrir o ambiente de outra pessoa. Convites nunca concedem o papel de administrador. O limite inicial é de dez contas, incluindo convites pendentes e contas suspensas; é um limite de proteção do servidor, não uma garantia de capacidade para dez números ocupados simultaneamente.

## Persistência e migração

Aplicar `supabase/migrations/002-workspaces.sql` antes de publicar o worker novo. A migração é aditiva: cria a lista de acesso, colunas `owner_id`, índices e RPCs que exigem proprietário. Mantém RLS e revogação de acesso direto para `anon` e `authenticated`. O backend usa a chave de serviço e aplica o proprietário em todas as leituras e mutações, inclusive anexos e URLs assinadas. Arquivos novos usam `usuario/produto/arquivo` no Storage privado. Os caminhos antigos continuam funcionando apenas para o proprietário original.

Na primeira inicialização, o worker identifica a conta original dentro do backup cifrado `primary`, valida seu vínculo em `auth.users` e atribui a ela os produtos e anexos existentes. Restaura o ambiente original sem copiar seus dados para outras pessoas. Preserva `primary` para recuperação e passa a publicar um snapshot independente `workspace:<uuid>` por conta. A chave AES-GCM de cada ambiente é derivada por HMAC-SHA256 da chave mestra e do UUID. A chave mestra permanece somente no servidor.

Cada ambiente tem seu próprio diretório e banco SQLite em execução. O worker restaura todos os ambientes autorizados ao iniciar, permitindo que os WhatsApps continuem funcionando sem o painel aberto. Os snapshots são gravados a cada minuto e no encerramento normal; uma queda abrupta pode perder alterações posteriores ao último backup. Produtos e arquivos são persistidos diretamente no Supabase. O lease continua exclusivo para o daemon inteiro, evitando duas instâncias com as mesmas sessões QR.

O webhook Cloud API novo é `https://SEU_DOMINIO/w/UUID/webhook`. Cada conta vê seu próprio endereço e deve cadastrá-lo no aplicativo da Meta. O endpoint antigo `/webhook` permanece vinculado exclusivamente ao administrador original para compatibilidade. Ambos exigem o token de verificação ou a assinatura HMAC do aplicativo daquela conta.

O comando de desenvolvimento `node server.mjs` continua sendo o servidor de ambiente único usado nos testes locais. A implantação com múltiplos usuários é iniciada por `deployment/worker.mjs`. Nunca executar o servidor local com as credenciais e a sessão de produção enquanto o daemon estiver ativo.

## Validação e recuperação

`npm test` inclui login de duas contas, convite expirado/reutilizado, usuário Supabase sem autorização, suspensão e reativação, tentativas de forjar o ambiente via cabeçalhos, acesso a produto/arquivo de outra conta, QR independente e restauração de snapshots com chaves distintas. Os transportes externos são controlados nos testes e não enviam WhatsApp real.

Antes da atualização, preservar o snapshot `primary` e a chave mestra. Depois, verificar um snapshot por conta e conferir que os produtos existentes possuem somente o proprietário original. Um rollback do código antigo só é seguro antes de aceitar novos usuários e depois de copiar o snapshot atual do administrador de volta ao formato/chave de `primary`; voltar apenas o commit faria o servidor antigo usar um backup desatualizado e o catálogo sem filtro de proprietário. Para múltiplas contas já ativas, priorizar correção no worker novo e manter o acesso fechado até resolver.
