# Publicação na Vercel

Para a implantação atual com múltiplas contas, seguir também [Ambientes privados por conta](workspaces.md). Aplicar as migrações `001` e `002`. O worker restaura um snapshot por login e aceita somente usuários da lista de autorização. Os detalhes de vínculo único de administrador abaixo descrevem a inicialização legada, preservada apenas para migrar o ambiente original.

O projeto usa uma Function HTTP (`api/index.mjs`) e um Vercel Daemon (`deployment/worker.mjs`, uma instância de 1 GiB em iad1). Não executar `server.mjs` diretamente como Function: SQLite, sessões e o socket do WhatsApp precisam do processo contínuo.

## Variáveis de Production

Configurar como Secret: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_BACKUP_KEY`, `ZELO_SETUP_TOKEN` e `ZELO_PUBLIC_ORIGIN`. A chave de backup tem 32 bytes em hexadecimal e deve ser exatamente a usada na migração. Nunca regenerá-la sem migrar os registros cifrados. O código de primeiro acesso também tem 64 caracteres hexadecimais; somente seu proprietário deve conhecê-lo. Após criar o administrador, o vínculo salvo no backup impede novas criações, mesmo que o código ainda exista no ambiente.

Antes da primeira publicação, executar a migração do Supabase e parar a instância local. O backup `primary` deve existir. Não executar simultaneamente o servidor local e o daemon com a mesma sessão do WhatsApp.

## Persistência e inicialização

O worker adquire uma posse exclusiva no Supabase usando operações condicionais; aguarda o anterior parar antes de restaurar. Restaura a cópia AES-GCM verificada para SQLite temporário e carrega configurações, memória e credenciais QR. Produtos e anexos usam diretamente Postgres e Storage privados. O runtime publica backups a cada minuto e no encerramento normal. Uma queda abrupta pode perder alterações de atendimento desde o último backup; o catálogo remoto não depende desse backup. Depois de um reinício é necessário entrar novamente no painel.

O daemon não aceita HTTP de entrada na Vercel. Por isso, abre um túnel HTTPS de saída com o cloudflared oficial, validado por SHA256. O endereço e um segredo de acesso aleatório ficam cifrados no Supabase. A Function lê esse registro no servidor, exige a origem configurada e encaminha somente rotas permitidas. O gateway exige seu segredo antes de encaminhar a solicitação; o aplicativo continua exigindo o login do administrador. Cookies em produção têm HttpOnly, SameSite=Strict e Secure. Arquivos privados usam links assinados de 60 segundos após verificar a sessão; uploads seguem em partes de 2 MiB.

Sem heartbeat válido por 90 segundos, a Function responde 503. Se o controle exclusivo ou o túnel falhar, o worker encerra e a Vercel pode reiniciá-lo. Em trocas de versão, SIGTERM encerra o socket e grava backup antes de liberar a posse. A proteção impede dois daemons ativos; não coordena um servidor local iniciado manualmente.

## Verificação

Executar `npm test` e `npm audit --omit=dev`. Confirmar no painel da Vercel a conclusão do deploy e o daemon ativo. `/` deve redirecionar para `/login`; `/api/auth/status` deve retornar JSON; catálogo, anexos e configurações sem sessão devem retornar 401. Arquivos `.env` e rotas de encerramento não são publicados. No primeiro acesso, o proprietário escolhe seu e-mail e senha com o código de bootstrap. Não criar conta de demonstração em produção.

Daemons são beta. No Hobby, a cota é de 10 horas de CPU ativa por mês; esperar trabalho não consome CPU ativa. Ao atingir a cota, a Vercel para os daemons até o próximo mês. O túnel gratuito também não possui garantia de disponibilidade. Uma operação com SLA deve substituir esse gateway por infraestrutura permanente com endpoint estável e persistência transacional do atendimento.

Referências: https://vercel.com/docs/daemons e https://vercel.com/docs/daemons/limits.
