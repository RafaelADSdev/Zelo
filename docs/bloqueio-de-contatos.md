# Bloquear a IA para um contato

Em **Conversas**, selecione uma pessoa e use **Bloquear IA** no cabeçalho. O botão muda para **Desbloquear IA** e a conversa mostra um aviso. O filtro **Somente com IA bloqueada** exibe os contatos bloqueados entre as conversas carregadas no painel.

O bloqueio é do atendimento automático do Zelo; não adiciona a pessoa à lista de bloqueio do aplicativo WhatsApp. O operador pode continuar enviando mensagens manualmente.

- Mensagens recebidas continuam visíveis no painel, mas não geram respostas ou transcrições pela IA enquanto o contato está bloqueado.
- O bloqueio é verificado antes do processamento, depois do download de áudio e antes de cada resposta/anexo. Uma solicitação de IA já em andamento pode consumir cota; uma mensagem já enviada ao WhatsApp não pode ser recolhida por este controle.
- Tentativas de resposta pela fila também respeitam o bloqueio.
- Desbloquear libera as próximas mensagens. Mensagens já marcadas como bloqueadas não são retomadas automaticamente, evitando respostas atrasadas em lote.
- Os registros ficam na tabela SQLite `contact_blocks`, separados por ambiente, modo de conexão e conta/número conectado. Reiniciar o serviço não remove o bloqueio. Na configuração com backup remoto, a tabela acompanha o snapshot cifrado existente.
- No QR Code, o bloqueio usa o identificador apresentado pela conexão para o contato selecionado, inclusive `@lid`. Identificadores de contas ou conexões diferentes não são associados automaticamente.

`POST /api/whatsapp/block` recebe `{ "phone": "identificador do contato", "blocked": true }` ou `false`, sob a mesma autenticação e proteção de origem das demais ações do painel. Não recebe um identificador de outro ambiente: a conta é determinada pelo servidor.

Os testes cobrem persistência, isolamento entre contas/conexões/ambientes, áudio bloqueado sem download ou transcrição, bloqueio durante geração da resposta, proibição de retomada e desbloqueio sem reenvio de mensagens antigas.
