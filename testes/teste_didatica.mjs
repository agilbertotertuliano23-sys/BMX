// Exercita a composição de fala real usada pelo navegador, sem depender do serviço de voz.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fonte = readFileSync(new URL('../ui/demo.js', import.meta.url), 'utf8');
const funcao = fonte.match(/  function compor\(p\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(funcao, 'função de composição de fala encontrada');
const alerta = 'Perda súbita da visão: procure atendimento imediatamente.';
for (const nivel of ['simples', 'intermediario', 'aprofundado']) {
  const compor = vm.runInNewContext('(' + funcao.trim() + ')', { st: { nivel } });
  const passo = { resumo: 'Observe os sinais.', explicacao: 'Entenda a prioridade.',
    aprofundar: 'A avaliação é presencial.', acao: { tipo: 'alerta', texto: alerta } };
  assert.ok(compor(passo).includes(alerta), 'alerta falado integralmente em ' + nivel);
  passo.resumo = alerta;
  assert.equal(compor(passo).split(alerta).length - 1, 1, 'sem duplicar alerta já incluído');
}
console.log('OK: navegador preserva alerta integral nos três níveis de explicação.');
