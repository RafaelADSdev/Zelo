import test from 'node:test';
import assert from 'node:assert/strict';
import { productKey, historyView } from '../public/broadcast-history-model.js';
const campaigns = [
  {id:'a',product:{id:'p1',name:'Sopro'},text:'Olá',state:'completed',created:3},
  {id:'b',product:{id:'p2',name:'Sopro'},text:'Oferta',state:'paused',created:2},
  {id:'c',text:'Olá',state:'completed',created:1},
  {id:'d',product:{id:'p1',name:'Sopro antigo'},text:'Oferta',state:'completed',created:0},
];
test('histórico separa produtos por identidade e mantém campanhas sem produto', () => {
  const view = historyView(campaigns, {});
  assert.deepEqual(view.groups.map(g => g.items.map(c => c.id)), [['a','d'],['b'],['c']]);
  assert.equal(view.groups[2].name, 'Sem empreendimento');
  assert.notEqual(productKey(campaigns[0]), productKey(campaigns[1]));
});
test('filtros de produto, situação e busca se combinam sem alterar o histórico', () => {
  assert.deepEqual(historyView(campaigns, {product:productKey(campaigns[0]),search:'oferta',state:'completed'}).visible.map(c=>c.id), ['d']);
  assert.equal(historyView(campaigns, {product:'none'}).visible[0].id, 'c');
  assert.equal(historyView(campaigns, {search:'inexistente'}).groups.length, 0);
  assert.equal(campaigns.length, 4);
});
test('lista cronológica ordena campanhas e reconhece produtos legados sem id', () => {
  assert.deepEqual(historyView([...campaigns].reverse(), {}).visible.map(c=>c.id), ['a','b','c','d']);
  assert.equal(productKey({product:{name:'Legado'}}), 'name:Legado');
});
