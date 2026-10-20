import { randomUUID } from 'node:crypto';
import { fail } from '../settings.mjs';
export function createUploads(catalog, clock=Date.now) {
  const pending=new Map();
  function clean(){for(const [id,item] of pending)if(item.expires<clock())pending.delete(id);}
  function item(id,owner){clean();const value=pending.get(id);if(!value || value.owner!==owner)throw fail('Envio expirado. Selecione o arquivo novamente.',404);return value;}
  return {
    start(input,owner){
      clean();
      if(pending.size>=3)throw fail('Conclua os envios em andamento e tente novamente.',429);
      if(!/^[a-f0-9-]{36}$/.test(input?.productId||'') || typeof input.name!=='string' || !input.name.length || input.name.length>180 || !['image/jpeg','image/png','image/webp','application/pdf'].includes(input.mime) || !Number.isSafeInteger(input.size) || input.size<1 || input.size>(input.mime==='application/pdf'?50:10)*1024*1024)throw fail('Arquivo inválido. Use imagens até 10 MB ou PDFs até 50 MB.');
      const id=randomUUID();pending.set(id,{...input,owner,chunks:[],received:0,expires:clock()+15*60000});return {id,chunkSize:2*1024*1024};
    },
    append(id,owner,offset,bytes){const value=item(id,owner);if(offset!==value.received)throw fail('A ordem das partes mudou. Reenvie o arquivo.',409);if(!bytes.length || bytes.length>2*1024*1024 || value.received+bytes.length>value.size)throw fail('Parte de arquivo inválida.',413);value.chunks.push(bytes);value.received+=bytes.length;value.expires=clock()+15*60000;return {received:value.received};},
    async finish(id,owner){const value=item(id,owner);if(value.received!==value.size)throw fail('Arquivo incompleto.',409);pending.delete(id);return catalog.upload(value.productId,Buffer.concat(value.chunks),value.name,value.mime);},
  };
}
