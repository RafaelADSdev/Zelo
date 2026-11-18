import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSupabaseCatalog } from '../lib/supabase/supabase-catalog.mjs';

test('catálogo remoto lista os anexos em lotes e hidrata apenas os produtos escolhidos para a IA', async () => {
  const owner = randomUUID();
  const products = Array.from({ length: 100 }, (_, index) => ({
    id: randomUUID(), name: `Produto ${index}`, links: [], description: index < 4 ? 'Aurora' : '', active: index !== 0, revision: '1', updated: '1',
  }));
  const files = products.flatMap(product => Array.from({ length: 100 }, (_, index) => ({
    id: `${product.id}-${index}`, product_id: product.id, name: `${index}.pdf`, mime: 'application/pdf', size: '12',
  })));
  const requested = [];
  const catalog = createSupabaseCatalog({ async request(path) {
    const { pathname, searchParams } = new URL(path, 'https://fixture.test');
    assert.equal(searchParams.get('owner_id'), `eq.${owner}`);
    requested.push({ pathname, searchParams });
    if (pathname.endsWith('/zelo_products')) return products.filter(product => !searchParams.has('active') || product.active);
    const ids = new Set(searchParams.get('product_id').slice(4, -1).split(','));
    return files.filter(file => ids.has(file.product_id)).slice(0, 1000);
  } }, owner);

  const listed = await catalog.list();
  assert.equal(requested.length, 11);
  assert.equal(listed.length, 100);
  assert.ok(listed.every(product => product.files.length === 100));
  assert.equal(listed[1].files[99].name, '99.pdf');

  requested.length = 0;
  const result = await catalog.search('Aurora');
  assert.deepEqual(result.products.map(product => product.name), ['Produto 1', 'Produto 2', 'Produto 3']);
  assert.equal(requested.length, 2);
  assert.equal(requested[0].searchParams.get('active'), 'eq.true');
  assert.equal(requested[1].searchParams.get('product_id'), `in.(${products.slice(1, 4).map(product => product.id).join(',')})`);
  assert.ok(result.products.every(product => product.files.length === 100));
});
