import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, inspectNumbers, phoneNumber, spreadsheetRows, readContactFile } from '../public/broadcast-import.js';

test('CSV aceita BOM, separadores brasileiros, aspas, quebras de linha e arquivo sem cabeçalho', () => {
  assert.deepEqual(parseCsv('\uFEFFsep=;\r\nNome;Telefone\r\n"Ana; Silva";"+55 (11) 98888-7777"\r\n"Bia\nSouza";5511977776666'), [['Nome','Telefone'],['Ana; Silva','+55 (11) 98888-7777'],['Bia\nSouza','5511977776666']]);
  assert.deepEqual(parseCsv('nome,telefone\n"Ana ""Silva""",5511988887777'), [['nome','telefone'],['Ana "Silva"', '5511988887777']]);
  assert.deepEqual(parseCsv('5511988887777\n5511977776666'), [['5511988887777'], ['5511977776666']]);
  assert.deepEqual(parseCsv('Nome\tCelular\nAna\t5511988887777'), [['Nome','Celular'],['Ana','5511988887777']]);
  assert.throws(() => parseCsv('Nome,telefone\n"não termina'), /aspas/);
});
test('importação separa inválidos, vazios e duplicados, usa só a coluna escolhida e preserva DDI', () => {
  const data = [['ID','WhatsApp'], ['1000','(11) 98888-7777'], ['1001','5511988887777'], ['1002','abc'], ['1003', null], ['1004', 5521977776666]];
  const result = inspectNumbers(data, { column: 1, header: true, country: '55' });
  assert.deepEqual(result.phones, ['5511988887777','5521977776666']);
  assert.equal(result.duplicates, 1); assert.equal(result.empty, 1);
  assert.deepEqual(result.invalid.map(item => item.row), [4]);
  assert.equal(phoneNumber('=5511988887777'), null);
  assert.equal(phoneNumber('5.511988887777e12'), null);
  assert.equal(phoneNumber(5511988887777), '5511988887777');
  assert.equal(phoneNumber(new Date()), null);
  assert.equal(phoneNumber('(11) 98888-7777', '55'), '5511988887777');
  assert.equal(phoneNumber('+1 202 555 0123'), '12025550123');
  assert.equal(phoneNumber('(11) 98888-7777'), '11988887777');
  assert.equal(inspectNumbers(parseCsv('Telefone\n\ninválido'), { header: true }).invalid[0].row, 3);
  const invalid = '5511988887777' + ' '.repeat(120) + 'abc';
  assert.equal(inspectNumbers([[invalid]]).invalid[0].value, invalid);
});
test('limites de importação não cortam a lista silenciosamente', () => {
  assert.throws(() => parseCsv('1\n'.repeat(5002)), /5.000/);
  assert.throws(() => spreadsheetRows([new Array(61).fill('x')]), /60 colunas/);
  const result = inspectNumbers(Array.from({ length: 501 }, (_, i) => [String(5511988800000 + i)]), { column: 0 });
  assert.equal(result.phones.length, 501);
});
test('leitura de arquivo aceita CSV do Excel em Windows-1252 e rejeita formatos ou tamanhos indevidos', async () => {
  const bytes = Uint8Array.from([78,111,109,101,59,84,101,108,101,102,111,110,101,10,74,111,227,111,59,53,53,49,49,57,56,56,56,56,55,55,55,55]);
  const result = await readContactFile(new File([bytes], 'contatos.csv'));
  assert.equal(result[0].data[1][0], 'João');
  await assert.rejects(readContactFile(new File(['not excel'], 'contatos.xlsx')), /xlsx válida/);
  await assert.rejects(readContactFile(new File(['old excel'], 'contatos.xls')), /salve como .xlsx/);
  await assert.rejects(readContactFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'contatos.csv')), /2 MB/);
});
