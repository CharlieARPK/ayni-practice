import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/storage.js';

test('LANのHTTP環境でも曲の保存IDを生成できる', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const realCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    getRandomValues: realCrypto.getRandomValues.bind(realCrypto)
  } });
  t.after(() => Object.defineProperty(globalThis, 'crypto', original));
  const data = { title: 'スマートフォン確認用' };
  const first = createEntry(data), second = createEntry(data);
  assert.match(first.id, /^[a-f0-9]{32}$/);
  assert.notEqual(first.id, second.id);
  assert.equal(first.data, data);
  assert.ok(Number.isFinite(Date.parse(first.addedAt)));
});
