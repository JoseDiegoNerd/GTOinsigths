import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../public/modules/influenciadores/html.js';

test('escapeHtml escapa os cinco caracteres perigosos', () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#039;b&#039;)&quot;&gt;&amp;');
});

test('escapeHtml trata null e undefined como texto vazio', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml converte numeros em texto', () => {
  assert.equal(escapeHtml(42), '42');
});
