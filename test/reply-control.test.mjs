import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyPresentation } from '../public/reply-schedule.js';

test('controle diferencia ligado, desligado e espera da programação sem confundir conexão com ativação', () => {
  const dashboard = {settings:{whatsappMode:'qr',aiReadyConfigured:true},qr:{status:'connected'},replyStatus:{active:true,mode:'always'}};
  assert.equal(replyPresentation(dashboard).label,'Ligado');
  assert.equal(replyPresentation(dashboard).state,'on');
  dashboard.replyStatus={active:false,mode:'off'};
  assert.equal(replyPresentation(dashboard).label,'Desligado');
  assert.equal(replyPresentation(dashboard).state,'off');
  dashboard.replyStatus={active:false,mode:'scheduled'};
  assert.equal(replyPresentation(dashboard).label,'Aguardando horário');
  assert.equal(replyPresentation(dashboard).state,'waiting');
  dashboard.replyStatus={active:true,mode:'scheduled'};
  assert.equal(replyPresentation(dashboard).label,'Ligado');
  assert.match(replyPresentation(dashboard).description,/programação/);
  dashboard.qr.status='disconnected';
  assert.match(replyPresentation(dashboard).description,/conecte o WhatsApp/);
  dashboard.settings.aiReadyConfigured=false;
  assert.match(replyPresentation(dashboard).description,/chave de IA/);
});
