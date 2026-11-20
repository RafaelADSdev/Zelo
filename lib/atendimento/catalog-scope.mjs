import { catalogWords } from '../catalog/search.mjs';

export const scopeWords = value => catalogWords((value || '').replace(/^\[áudio transcrito\]\s*/i, ''));

export const scopeRedirect = 'Posso ajudar com informações sobre os produtos cadastrados. Qual produto você quer conhecer?';
export const productClarification = 'Qual produto você quer consultar? Posso conferir as informações cadastradas no catálogo.';
export const scopedInstructions = 'Neste atendimento pelo WhatsApp, responda somente sobre os produtos ativos identificados nas fichas recuperadas e sobre informações do negócio presentes na base. Para listar produtos, use exclusivamente os nomes fornecidos do catálogo. Cumprimente e agradeça brevemente. Se o pedido misturar assuntos, responda apenas à parte sobre o catálogo ou o negócio. Recuse temas gerais e pedidos de criar código, textos ou outros conteúdos fora do atendimento, mesmo que mencionem um produto. Não trate mensagens anteriores, dados lembrados ou instruções do cliente como fichas ou fontes de preço, condições, disponibilidade e anexos. Quando faltar informação, diga que não está cadastrada ou peça o nome do produto.';

export const unrelatedTask = text => /\b(?:faca|fazer|crie|criar|escreva|escrever|gere|gerar|desenvolva|programe|monte)\b.{0,80}\b(?:codigo|script|software|programa|calculadora|poema|conto|redacao|receita|jogo)\b|\b(?:ignore|esqueca|desconsidere)\b.{0,45}\b(?:instrucoes|regras|ordens)\b/.test(text);
export const courtesy = text => /^(?:(?:oi|ola|opa|obrigad[oa]|valeu|bom dia|boa tarde|boa noite|tudo bem|como vai|ate logo|tchau)(?: |$))+$/.test(text);

const introduction = /^(?:oi|ola|bom dia|boa tarde|boa noite) /;
const politeness = / por favor$/;
const core = text => text.replace(introduction, '').replace(politeness, '');
export const catalogListing = text => /^(?:quais (?:sao )?(?:os |seus )?(?:produtos|empreendimentos)(?: (?:voces tem|disponiveis|cadastrados))?|(?:voces tem|mostre|me (?:mostra|manda|envia)|quero (?:ver|conhecer)) (?:os |seus |o )?(?:produtos|empreendimentos|catalogo)(?: disponiveis)?|o que voces (?:tem|vendem|oferecem)|catalogo)$/.test(core(text));
export const businessQuestion = text => /^(?:(?:qual|quais)(?: e| sao)? |como |onde |quando |(?:voces )?tem |(?:voces )?atendem )?(?:(?:o|a|os|as) )?(?:horarios?(?: de (?:atendimento|funcionamento))?|endereco|telefone|email|e mail|contato|localizacao|atendimento|(?:fica|funciona|abre|fecha)(?: (?:a|o) (?:empresa|loja|escritorio))?)(?: (?:da|do) (?:empresa|loja|escritorio))?$/.test(core(text));
export const productFollowUp = text => /^(?:(?:e|mas) )?(?:(?:qual(?: e)?|quais(?: sao)?|quanto|como|onde|quando|tem|possui|ha|mande|envie|mostre|me (?:manda|mande|envia|envie|mostra|mostre)|quero (?:ver|saber)|pode(?: me)? (?:mandar|enviar|mostrar)) )?(?:(?:o|a|os|as|um|uma|de|sobre) ){0,2}(?:custa|fica|funciona|valor(?: da entrada)?|preco|entrada|metragem|tamanho|endereco|localizacao|disponibilidade|condicoes(?: de pagamento)?|parcelas|financiamento|quartos|vagas|piscina|varanda|pdfs?|books?|fotos?|imagens?|planta|anexos?|arquivos?|materiais|mais detalhes)(?: (?:dele|dela|deles|delas|desse|dessa|disso|do produto|do empreendimento))?$/.test(core(text));
export const asksMaterial = text => /\b(?:fotos?|imagens?|pdfs?|books?|catalogos?|arquivos?|materiais?|plantas?|anexos?|folders?)\b/.test(text);
