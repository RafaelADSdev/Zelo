import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createClient } from '@libsql/client';
import { createBroadcasts } from '../lib/whatsapp/broadcasts.mjs';
import { contactName } from '../lib/whatsapp/contact-name.mjs';
import { startTestServer, authenticatedFetch, testDirectory } from './helpers.mjs';

test('nomes numéricos ou identificadores não viram saudação e nomes reais são preservados', () => {
  for (const value of ['5511988887777','+55 11 98888-7777','279623946485862@lid','5511988887777@s.whatsapp.net','',null]) assert.equal(contactName(value),'');
  assert.equal(contactName('  Ana\n Silva '),'Ana Silva'); assert.equal(contactName('João da Silva'),'João da Silva');
});

test('disparo usa nome das conversas, respeita nome importado e preserva a alternativa quando não conhece o contato', async () => {
  const db = createClient({ url: ':memory:' }), sent = []; let now = Date.parse('2026-10-30T15:00:00Z');
  try {
    await db.execute('CREATE TABLE qr_contacts(account TEXT,jid TEXT,name TEXT)');
    await db.batch([
      { sql: 'INSERT INTO qr_contacts VALUES(?,?,?)', args: ['a','558185932808@s.whatsapp.net','Ana Silva'] },
      { sql: 'INSERT INTO qr_contacts VALUES(?,?,?)', args: ['b','558185932808@s.whatsapp.net','Nome de outra conta'] },
      { sql: 'INSERT INTO qr_contacts VALUES(?,?,?)', args: ['a','5511977776666@s.whatsapp.net','5511977776666'] },
      { sql: 'INSERT INTO qr_contacts VALUES(?,?,?)', args: ['a','5511966665555@s.whatsapp.net','Nome da agenda'] },
    ],'write');
    const service = await createBroadcasts({ db, connection: () => 'qr:a', clock: () => now, send: async input => { sent.push(input.text); return {}; } });
    const draft = { requestId: randomUUID(), consent: true, text: 'Olá {nome|cliente}!', recipients: [{ phone:'5581985932808' }, { phone:'5511977776666' }, { phone:'5511966665555',name:'Nome da planilha' }] };
    const preview = await service.preview(draft);
    assert.equal(preview.named,2); assert.equal(preview.withoutName,1);
    assert.deepEqual(preview.recipients.map(item => item.preview.text), ['Olá Ana Silva!','Olá cliente!','Olá Nome da planilha!']);
    await db.execute("UPDATE qr_contacts SET name='Nome alterado depois da revisão' WHERE account='a' AND jid='558185932808@s.whatsapp.net'");
    const campaign = await service.create({ ...draft, recipients: preview.normalized });
    assert.equal(campaign.items[0].name,'Ana Silva');
    for (let index=0;index<3;index++) { await service.tick(); now += 30000; }
    assert.deepEqual(sent,['Olá Ana Silva!','Olá cliente!','Olá Nome da planilha!']);
    const copy = await service.duplicate(campaign.id); assert.equal(copy.recipients[0].name,'Ana Silva');
  } finally { db.close(); }
});

test('Cloud usa o nome do perfil da conta correta sem alterar a regra da janela de atendimento', async () => {
  const db = createClient({ url: ':memory:' }), now = Date.parse('2026-10-30T15:00:00Z');
  try {
    await db.execute('CREATE TABLE wa_contacts(phone TEXT,account_id TEXT,name TEXT,last_inbound INTEGER)');
    await db.batch([
      { sql:'INSERT INTO wa_contacts VALUES(?,?,?,?)',args:['5511988887777','123','Marina',now-1000] },
      { sql:'INSERT INTO wa_contacts VALUES(?,?,?,?)',args:['5511988887777','456','Outro nome',now-1000] },
      { sql:'INSERT INTO wa_contacts VALUES(?,?,?,?)',args:['5511977776666','123','5511977776666',now-90000000] },
    ],'write');
    const service = await createBroadcasts({ db, connection:()=> 'cloud:123',clock:()=>now,send:async()=>({}) });
    const preview = await service.preview({ phones:'5511988887777\n5511977776666',text:'Olá {nome|cliente}!' });
    assert.equal(preview.recipients[0].preview.text,'Olá Marina!'); assert.equal(preview.recipients[1].preview.text,'Olá cliente!');
    assert.equal(preview.canText,1); assert.equal(preview.outsideWindow,1); assert.equal(preview.ready,false);
  } finally { db.close(); }
});

test('agenda QR e LID preenchem nomes sem criar conversas nem responder a mensagens antigas', async () => {
  const sockets = []; let sends=0,aiCalls=0;
  const app = await startTestServer({port:0,dataDir:await testDirectory(),aiFetch:async()=>{aiCalls++;throw Error('Não deve chamar IA');},qrSocketFactory:options=>{
    const socket={options,ev:new EventEmitter(),user:{id:'5511999999999:1@s.whatsapp.net',name:'Minha conta'},end(){},
      signalRepository:{lidMapping:{getLIDForPN:async jid=>jid.startsWith('5581')?'279623946485862@lid':null,getPNForLID:async()=> '558185932808@s.whatsapp.net'}},
      async onWhatsApp(jid){return [{jid,exists:true}];},async sendMessage(){sends++;return {key:{id:'test'}};}};sockets.push(socket);return socket;
  }});
  const post = input=>authenticatedFetch(app.url+'/api/broadcasts/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  try {
    await app.settings.update({whatsappMode:'qr'});await app.qr.connect();const socket=sockets[0];socket.ev.emit('connection.update',{connection:'open'});await app.qr.idle();
    assert.equal(socket.options.shouldSyncHistoryMessage({syncType:0}),true);assert.equal(socket.options.shouldSyncHistoryMessage({syncType:4}),true);assert.equal(socket.options.shouldSyncHistoryMessage({syncType:3}),false);
    socket.ev.emit('contacts.upsert',[{id:'279623946485862@lid',phoneNumber:'558185932808@s.whatsapp.net',name:'Marina Agenda'}]);
    socket.ev.emit('contacts.update',[{id:'279623946485862@lid',notify:'Marina Perfil'}]);
    socket.ev.emit('messaging-history.set',{contacts:[{id:'279623946485862@lid',notify:'Outro perfil'}],messages:[{key:{id:'antiga',remoteJid:'558185932808@s.whatsapp.net'},message:{conversation:'Mensagem antiga'},messageTimestamp:1}]});await app.qr.idle();
    const response=await post({phones:'5581985932808',text:'Olá {nome|cliente}!'});assert.equal(response.status,200);
    const preview=await response.json();assert.equal(preview.recipients[0].name,'Marina Agenda');assert.equal(preview.recipients[0].preview.text,'Olá Marina Agenda!');
    const checked=await app.qr.checkNumbers(['5581985932808']);assert.equal(checked.numbers[0].name,'Marina Agenda');
    assert.equal((await app.qr.conversations()).length,0);assert.equal((await app.qr.status()).jobs.length,0);assert.equal(sends,0);assert.equal(aiCalls,0);
    await app.runtime.client.execute({sql:'INSERT INTO qr_contacts VALUES(?,?,?,0,?)',args:[app.qr.state().account,'279623946485862@lid','Antigo perfil','Mensagem existente']});
    assert.equal((await app.qr.conversations())[0].name,'Marina Agenda');
    await app.qr.disconnect();await app.qr.connect();const next=sockets.at(-1);next.user.id='5511888888888@s.whatsapp.net';next.ev.emit('connection.update',{connection:'open'});await app.qr.idle();
    socket.ev.emit('contacts.update',[{id:'558185932808@s.whatsapp.net',name:'Evento obsoleto'}]);await app.qr.idle();
    const isolated=await (await post({phones:'5581985932808',text:'Olá {nome|cliente}!'})).json();assert.equal(isolated.recipients[0].name,'');assert.equal(isolated.recipients[0].preview.text,'Olá cliente!');
  } finally {await app.close();}
});

test('nomes legados em LID são recuperados pelo mapeamento local mesmo sem novo evento de contato', async()=>{
  let socket;
  const app=await startTestServer({port:0,dataDir:await testDirectory(),qrSocketFactory:()=>socket={ev:new EventEmitter(),user:{id:'5511999999999@s.whatsapp.net'},end(){},signalRepository:{lidMapping:{getLIDForPN:async()=> '123456789@lid'}}}});
  try {
    await app.settings.update({whatsappMode:'qr'});await app.qr.connect();socket.ev.emit('connection.update',{connection:'open'});await app.qr.idle();
    await app.runtime.client.execute({sql:'INSERT INTO qr_contacts VALUES(?,?,?,0,?)',args:[app.qr.state().account,'123456789@lid','Carla','Histórico existente']});
    assert.equal((await app.qr.contactNames(['5581985932808'])).get('5581985932808'),'Carla');
  } finally {await app.close();}
});
