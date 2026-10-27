/* Atlas 3D de materialização: interface e direção (o motor 3D está em atlas3d.js). Tela imersiva, guiada pelo caso.

   Uma aula é uma lista de passos em estágios: escaneamento do órgão, pontos de atenção (com aproximação), montagem das
   partes, impacto de um problema, o corpo inteiro e, quando a aula nasce de um caso, o resumo do que a pessoa contou.
   A tela é só o modelo: o texto de cada passo fica ao lado do ponto observado, preso por uma seta; embaixo, a fala
   (legenda) e os controles. Nada de contagem de peças, árvore de estruturas ou camadas: só o que importa ao paciente.
   Entre um estágio e outro uma cortina azul com o nome do estágio cobre a troca de cena.
   Todo texto vindo do servidor entra na página com textContent, nunca como HTML. */
import { criarPalco } from './atlas3d.js';

const $ = function (s, r) { return (r || document).querySelector(s); };
const token = (document.querySelector('meta[name="bmx-token"]') || {}).content || '';
const NOMES = ['Escaneamento', 'Pontos de atenção', 'Montagem', 'Impacto', 'No corpo', 'Resumo', 'O que você contou'];
const CHAVE_VOZ = 'bmx-atlas-voz';
const S = { dados: null, estudo: null, palco: null, passos: [], i: 0, rodada: 0, tocando: false, voz: true, audio: null, soltar: null, ui: null,
  aberto: false, caso: false, aoFim: null, cache: new Map(), alvo: null, ultimo: null, anterior: null, tTrans: 0, ordem: [], fixo: null };
try { if (localStorage.getItem(CHAVE_VOZ) === 'off') S.voz = false; } catch (e) { /* sem armazenamento: a voz fica ligada */ }

function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function limpar(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function esperar(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
const estreito = function () { return window.matchMedia('(max-width: 640px)').matches; };

/* ── dados ────────────────────────────────────────────────────────────────────────────────────── */
async function carregarDados() {
  if (S.dados) return S.dados;
  const r = await fetch('/api/atlas');
  if (!r.ok) throw new Error('erro ' + r.status);
  S.dados = await r.json();
  return S.dados;
}

/* ── biblioteca (cartões) ─────────────────────────────────────────────────────────────────────── */
function cartaoEstudo(e) {
  const b = el('button', 'atl-card'); b.type = 'button'; b.dataset.atlas = e.id; b.style.setProperty('--cor', e.cor);
  b.appendChild(el('span', 'atl-card-sis', e.sistema));
  b.appendChild(el('b', null, e.titulo));
  b.appendChild(el('em', null, e.subtitulo));
  b.appendChild(el('p', null, e.resumo));
  b.appendChild(el('span', 'atl-card-go', 'Ver no atlas'));
  return b;
}
function preencherGrade(alvo) {
  limpar(alvo);
  S.dados.estudos.forEach(function (e) { alvo.appendChild(cartaoEstudo(e)); });
}

/* ── fala: a mesma voz do BMX na conversa (/api/speak); sem ela, a do navegador, em ritmo normal ── */
const FILA = { livres: 2, espera: [] };
function pegar() { return new Promise(function (ok) { if (FILA.livres > 0) { FILA.livres--; ok(); } else FILA.espera.push(ok); }); }
function devolver() { const n = FILA.espera.shift(); if (n) n(); else FILA.livres++; }
function buscar(texto) {
  return pegar().then(function () {
    return fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bmx-token': token }, body: JSON.stringify({ text: texto }) });
  }).then(function (r) {
    if (!r.ok || !/audio/.test(r.headers.get('content-type') || '')) throw new Error('sem voz do servidor');
    return r.blob();
  }).catch(function () { return null; }).then(function (b) { devolver(); return b; });
}
/** Pede a voz com antecedência: o passo seguinte já está pronto quando o atual termina. */
function preparar(texto) {
  if (!S.voz || !texto) return null;
  if (!S.cache.has(texto)) S.cache.set(texto, buscar(texto));
  return S.cache.get(texto);
}
function falarNavegador(texto) {
  return new Promise(function (ok) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return ok('sem');
    const u = new SpeechSynthesisUtterance(texto); u.lang = 'pt-BR';
    const v = speechSynthesis.getVoices().filter(function (x) { return /^pt/i.test(x.lang); })[0];
    if (v) u.voice = v;
    let comecou = false, fim = false;
    const acaba = function (r) { if (!fim) { fim = true; ok(r); } };
    u.onstart = function () { comecou = true; };
    u.onend = function () { acaba('ok'); };
    u.onerror = function () { acaba('sem'); };
    speechSynthesis.cancel(); speechSynthesis.speak(u);
    setTimeout(function () { if (!comecou && !fim) { speechSynthesis.cancel(); acaba('sem'); } }, 1800);
  });
}
function pararFala() {
  if (S.audio) { try { S.audio.pause(); } catch (e) { /* já parou */ } S.audio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (S.soltar) { const f = S.soltar; S.soltar = null; f(); }
}
function falar(texto, rodada) {
  return new Promise(function (ok) {
    let feito = false;
    function fim() { if (!feito) { feito = true; S.soltar = null; ok(); } }
    S.soltar = fim;
    function lido() { const t = setTimeout(fim, Math.max(2600, texto.split(/\s+/).length * 300)); S.soltar = function () { clearTimeout(t); fim(); }; }
    if (!S.voz) return lido();
    function navegador() {
      if (rodada !== S.rodada) return fim();
      falarNavegador(texto).then(function (r) { if (r === 'ok') fim(); else lido(); });
    }
    preparar(texto).then(function (blob) {
      if (rodada !== S.rodada) return fim();
      if (!blob) return navegador();
      const a = new Audio(URL.createObjectURL(blob)); S.audio = a;
      a.onended = function () { URL.revokeObjectURL(a.src); fim(); };
      a.onerror = navegador;
      return a.play().catch(navegador);
    });
  });
}
function legenda(texto) { S.ui.legenda.textContent = texto || ''; S.ui.legenda.hidden = !texto; }

/* ── textos de cada passo (a fala e o que fica na tela saem daqui) ─────────────────────────────── */
const T = {
  scan: function (e) {
    return S.caso && e.contexto_caso ? (e.resumo || e.titulo) : e.titulo + '. ' + (e.resumo || '');   // no caso, a abertura é o passo "O que você contou"
  },
  ponto: function (pt) {
    return pt.titulo + '. ' + pt.texto + (pt.caso ? ' ' + pt.caso : '') + (pt.atencao ? ' Ponto de atenção: ' + pt.atencao : '');
  },
  montagem: function (e) { return e.montagem.texto; },
  impacto: function (pr, k) {
    return { abre: (k === 0 ? 'Agora, onde um problema pode impactar. ' : '') + pr.titulo + '. '
      + (pr.contexto_educativo ? pr.contexto_educativo + ' ' : '') + pr.mecanismo + (pr.motivo ? ' ' + pr.motivo : ''),
      cadeia: pr.cadeia, fim: 'Sinais possíveis: ' + pr.sinais.join(', ') + '. ' + pr.ajuda };
  },
  corpo: function (e) { return e.corpo.texto + (e.corpo.ajuda ? ' ' + e.corpo.ajuda : ''); },
  contexto: function (e) { return e.contexto_caso || ''; },
  fecho: function (e) { return e.fecho_caso || ''; }
};
function textosDe(passo) {
  const e = S.estudo;
  if (!passo || !e) return [];
  if (passo.tipo === 'scan') return [T.scan(e)];
  if (passo.tipo === 'ponto') return [T.ponto(e.pontos[passo.k])];
  if (passo.tipo === 'montagem') return [T.montagem(e)];
  if (passo.tipo === 'impacto') { const t = T.impacto(e.problemas[passo.k], passo.k); return [t.abre].concat(t.cadeia, [t.fim]); }
  if (passo.tipo === 'corpo') return [T.corpo(e)];
  if (passo.tipo === 'contexto') return [T.contexto(e)];
  return [T.fecho(e)];
}

/* ── estrutura da tela ────────────────────────────────────────────────────────────────────────── */
const HTML = [
  '<main class="atl-palco" id="atlPalco">',
  '  <canvas aria-label="Modelo 3D da estrutura em estudo"></canvas>',
  '  <svg class="atl-linha" id="atlLinha" aria-hidden="true"><defs><marker id="atlSeta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs><path/></svg>',
  '  <div class="atl-marcas" aria-hidden="true"></div>',
  '  <div class="atl-call" id="atlCall" hidden><i></i><div><b></b><p></p><small></small><em></em></div></div>',
  '  <div class="atl-prog" aria-hidden="true"><i id="atlProg"></i></div>',
  '  <header class="atl-topo">',
  '    <div class="atl-marca-bmx"><svg viewBox="0 0 64 40" aria-hidden="true"><ellipse cx="32" cy="20" rx="30" ry="18" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="19" cy="20" r="4.5" fill="currentColor"/><circle cx="45" cy="20" r="4.5" fill="currentColor"/><rect x="19" y="19" width="26" height="2" fill="currentColor"/></svg><b>Atlas</b></div>',
  '    <div class="atl-centro"><p class="atl-etapa" id="atlEtapa"></p><p class="atl-passo" id="atlPasso"></p></div>',
  '    <div class="atl-topo-dir">',
  '      <button type="button" id="atlPerguntar" class="atl-btn atl-perg" data-bf="chat" title="Pausa a aula e deixa você perguntar sobre o que está vendo">Perguntar</button>',
  '      <button type="button" id="atlVoz" class="atl-btn" aria-pressed="true" title="Ligar ou desligar a voz">Voz</button>',
  '      <button type="button" id="atlDemo" class="atl-btn" hidden title="Abrir a demonstração guiada deste caso">Demonstração</button>',
  '      <button type="button" id="atlPular" class="atl-btn atl-pular" hidden>Ver painel</button>',
  '      <button type="button" class="atl-btn atl-so-larga" data-bf="feedback" title="Conte o que melhorar ou o que está inconsistente">Sugestão</button>',
  '      <button type="button" class="atl-btn atl-ajuda" data-bf="ajuda" aria-label="Tutorial do atlas" title="Ver o tutorial do atlas">?</button>',
  '      <button type="button" id="atlFechar" class="atl-btn atl-x" aria-label="Fechar o atlas">×</button>',
  '    </div>',
  '  </header>',
  '  <p class="atl-legenda" id="atlLegenda" aria-live="polite" hidden></p>',
  '  <section class="atl-fecho" id="atlFecho" hidden></section>',
  '  <details class="atl-referencias" id="atlReferencias"><summary>Fontes e exemplo</summary><div></div></details>',
  '  <footer class="atl-base">',
  '    <div class="atl-ctrl"><button type="button" id="atlAnt" class="atl-btn" aria-label="Passo anterior">‹</button>',
  '      <button type="button" id="atlPlay" class="atl-btn atl-play">Pausar</button>',
  '      <button type="button" id="atlProx" class="atl-btn" aria-label="Próximo passo">›</button></div>',
  '    <div class="atl-trilha" id="atlTrilha" role="group" aria-label="Passos da aula"></div>',
  '  </footer>',
  '  <div class="atl-trans" id="atlTrans" aria-hidden="true"><span class="atl-trans-n"></span><b></b><i></i></div>',
  '  <div class="atl-carregando" id="atlCarregando" hidden><i></i><span>preparando o modelo…</span></div>',
  '</main>',
  '<section class="atl-lib" id="atlLib" hidden><div class="atl-lib-int">',
  '  <button type="button" class="atl-btn atl-x atl-lib-x" id="atlLibX" aria-label="Fechar o atlas">×</button>',
  '  <p class="atl-sobre">ATLAS 3D</p><h2>Escolha uma estrutura</h2>',
  '  <p class="atl-lib-txt">Cada aula escaneia o órgão, mostra onde olhar, monta as partes, mostra onde um problema impacta e termina no corpo inteiro. É um atlas de referência: não mostra o seu exame.</p>',
  '  <div class="atl-lib-grade" id="atlLibGrade"></div></div></section>'
].join('\n');

function montarTela() {
  if (S.ui) return S.ui;
  const raiz = el('div', 'atl'); raiz.id = 'atlas'; raiz.hidden = true;
  raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-modal', 'true'); raiz.setAttribute('aria-label', 'Atlas 3D');
  raiz.innerHTML = HTML;   // HTML estático acima: nenhum dado externo entra aqui
  document.body.appendChild(raiz);
  const call = $('#atlCall', raiz);
  S.ui = {
    raiz: raiz, palco: $('#atlPalco', raiz), trilha: $('#atlTrilha', raiz), legenda: $('#atlLegenda', raiz), etapa: $('#atlEtapa', raiz),
    passo: $('#atlPasso', raiz), prog: $('#atlProg', raiz),
    carregando: $('#atlCarregando', raiz), lib: $('#atlLib', raiz), linha: $('#atlLinha', raiz), play: $('#atlPlay', raiz),
    call: call, callN: call.querySelector('i'), callT: call.querySelector('b'), callP: call.querySelector('p'), callC: call.querySelector('small'), callA: call.querySelector('em'),
    trans: $('#atlTrans', raiz), fecho: $('#atlFecho', raiz), pular: $('#atlPular', raiz), demo: $('#atlDemo', raiz), voz: $('#atlVoz', raiz)
  };
  $('#atlFechar', raiz).onclick = function () { fechar('fechar'); };
  $('#atlLibX', raiz).onclick = function () { fechar('fechar'); };
  S.ui.pular.onclick = function () { concluir('pular'); };
  S.ui.demo.onclick = function () { concluir('demo'); };
  $('#atlProx', raiz).onclick = function () { tocarDe(S.i + 1); };
  $('#atlAnt', raiz).onclick = function () { tocarDe(S.i - 1); };
  S.ui.play.onclick = function () {
    if (S.tocando) { S.rodada++; S.tocando = false; S.palco.cancelar(); pararFala(); botaoPlay(); } else tocarDe(S.i);
  };
  S.ui.voz.classList.toggle('on', S.voz); S.ui.voz.setAttribute('aria-pressed', S.voz);
  S.ui.voz.onclick = function () {
    S.voz = !S.voz; this.setAttribute('aria-pressed', S.voz); this.classList.toggle('on', S.voz);
    try { localStorage.setItem(CHAVE_VOZ, S.voz ? 'on' : 'off'); } catch (e) { /* sem armazenamento */ }
    if (!S.voz) pararFala();
  };
  raiz.addEventListener('click', function (e) { const c = e.target.closest && e.target.closest('[data-atlas]'); if (c) abrirEstudo(c.dataset.atlas); });
  document.addEventListener('keydown', function (e) {
    if (!S.aberto) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;   // digitando no chat: as setas e o espaço são do texto
    if (e.key === 'Escape') fechar('fechar');
    else if (e.key === 'ArrowRight') tocarDe(S.i + 1);
    else if (e.key === 'ArrowLeft') tocarDe(S.i - 1);
    else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); S.ui.play.click(); }
  });
  window.addEventListener('resize', ajustarEnquadramento);
  return S.ui;
}
function ajustarEnquadramento() { if (S.palco) S.palco.deslocar(estreito() ? 0.15 : 0.07); }

/* ── seta e texto junto ao ponto observado ────────────────────────────────────────────────────── */
/** Mostra o texto ao lado do ponto (chave de marcador do motor) com uma seta até ele. */
function apontar(chave, o) {
  const u = S.ui;
  S.alvo = { chave: chave, tipo: o.tipo }; S.fixo = null;   // novo balão: o lugar fixo é escolhido de novo
  u.callN.textContent = o.numero || ''; u.callN.hidden = !o.numero;
  u.callT.textContent = o.titulo || ''; u.callP.textContent = o.texto || ''; u.callP.hidden = !o.texto;
  u.callC.textContent = o.caso || ''; u.callC.hidden = !o.caso;
  u.callA.textContent = o.atencao || ''; u.callA.hidden = !o.atencao;
  u.call.className = 'atl-call t-' + (o.tipo || 'ponto');   // prefixo: caso.css tem .ponto, que não pode pegar aqui
  u.call.hidden = false; u.raiz.dataset.call = '1';
  u.call.style.visibility = 'hidden';   // só aparece quando o marcador estiver na tela
}
function soltarSeta() {
  S.alvo = null;
  if (!S.ui) return;
  S.ui.call.hidden = true; S.ui.linha.style.display = 'none'; delete S.ui.raiz.dataset.call;
}
function guia() {
  const u = S.ui;
  const pos = S.alvo && S.palco && !u.call.hidden ? S.palco.posTela(S.alvo.chave) : null;
  if (!pos) { u.linha.style.display = 'none'; if (S.alvo) u.call.style.visibility = 'hidden'; return; }
  const W = u.palco.clientWidth, H = u.palco.clientHeight, cw = u.call.offsetWidth, ch = u.call.offsetHeight;
  const topo = 58, base = estreito() ? 168 : 112, m = 10;
  // o balão fica PARADO: o lugar é escolhido uma vez por passo, longe do ponto (na margem do lado oposto), e não
  // acompanha a câmera; só a seta segue o ponto
  if (!S.fixo) {
    if (estreito()) {
      S.fixo = { x: Math.min(Math.max((W - cw) / 2, m), Math.max(m, W - cw - m)), y: topo + 4 };
    } else {
      const esq = pos.x > W * 0.5;
      S.fixo = { x: esq ? m + 22 : Math.max(m, W - cw - m - 22), y: Math.min(Math.max(H * 0.36 - ch / 2, topo), Math.max(topo, H - base - ch)) };
    }
  }
  const x = S.fixo.x, y = S.fixo.y;
  u.call.style.transform = 'translate(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px)';
  u.call.style.visibility = '';
  let fx, fy;                            // a seta sai da borda do balão mais próxima do ponto
  if (estreito()) { fx = Math.min(Math.max(pos.x, x + 14), x + cw - 14); fy = y + ch; }
  else if (pos.x > x + cw) { fx = x + cw; fy = Math.min(Math.max(pos.y, y + 12), y + ch - 12); }
  else if (pos.x < x) { fx = x; fy = Math.min(Math.max(pos.y, y + 12), y + ch - 12); }
  else { fx = Math.min(Math.max(pos.x, x + 14), x + cw - 14); fy = pos.y > y + ch ? y + ch : y; }
  const dx = pos.x - fx, dy = pos.y - fy, d = Math.hypot(dx, dy) || 1, r = 19;   // a seta para antes do anel do marcador
  const ex = pos.x - dx / d * r, ey = pos.y - dy / d * r;
  u.linha.lastElementChild.setAttribute('d', 'M' + fx.toFixed(1) + ' ' + fy.toFixed(1) + ' L' + ex.toFixed(1) + ' ' + ey.toFixed(1));
  u.linha.style.display = '';
}

/* ── cortina entre estágios ───────────────────────────────────────────────────────────────────── */
function cobrir(numero, nome) {
  const t = S.ui.trans;
  t.querySelector('.atl-trans-n').textContent = numero; t.querySelector('b').textContent = nome;
  clearTimeout(S.tTrans);
  t.classList.remove('sai'); t.classList.add('on');
}
function descobrir(atraso) {
  clearTimeout(S.tTrans);
  S.tTrans = setTimeout(function () {
    const t = S.ui.trans;
    t.classList.add('sai');
    S.tTrans = setTimeout(function () { t.classList.remove('on', 'sai'); }, 560);
  }, atraso || 0);
}
async function transicao(est) {
  cobrir(pad(S.ordem.indexOf(est) + 1), NOMES[est]);
  await esperar(420);
  descobrir(750);        // a cena já trocou por baixo: a cortina sobe enquanto o passo começa
}

/* ── direção ──────────────────────────────────────────────────────────────────────────────────── */
function montarPassos(e) {
  const p = S.caso && e.contexto_caso ? [{ est: 6, tipo: 'contexto', titulo: 'O que você contou' }] : [];
  p.push({ est: 0, tipo: 'scan', titulo: 'Escaneamento' });
  e.pontos.forEach(function (pt, k) { p.push({ est: 1, tipo: 'ponto', k: k, titulo: pt.titulo }); });
  p.push({ est: 2, tipo: 'montagem', titulo: 'Montagem' });
  e.problemas.forEach(function (pr, k) { p.push({ est: 3, tipo: 'impacto', k: k, titulo: pr.titulo }); });
  if (!S.caso) p.push({ est: 4, tipo: 'corpo', titulo: 'No corpo' });
  if (S.caso && e.fecho_caso) p.push({ est: 5, tipo: 'fecho', titulo: 'Resumo' });
  S.ordem = p.map(function (x) { return x.est; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
  return p;
}
function desenharTrilha() {
  const t = limpar(S.ui.trilha);
  S.passos.forEach(function (p, i) {
    const b = el('button'); b.type = 'button'; b.dataset.i = i; b.dataset.est = p.est; b.title = p.titulo; b.setAttribute('aria-label', 'Ir a ' + p.titulo);
    b.onclick = function () { tocarDe(i); };
    t.appendChild(b);
  });
}
function marcarPasso() {
  const passo = S.passos[S.i];
  Array.prototype.forEach.call(S.ui.trilha.querySelectorAll('button'), function (b) {
    const i = +b.dataset.i; b.className = i < S.i ? 'feito' : (i === S.i ? 'atual' : '');
  });
  const doEst = S.passos.filter(function (p) { return p.est === passo.est; });
  const n = doEst.indexOf(passo) + 1;
  S.ui.etapa.textContent = NOMES[passo.est] + (doEst.length > 1 ? ' · ' + n + ' de ' + doEst.length : '');
  S.ui.passo.textContent = 'Passo ' + (S.i + 1) + ' de ' + S.passos.length + ' · ' + passo.titulo;   // onde a pessoa está na aula
  S.ui.prog.style.width = ((S.i + 1) / S.passos.length * 100).toFixed(1) + '%';
  S.ui.raiz.dataset.tipo = passo.tipo;
}
function botaoPlay() { S.ui.play.textContent = S.tocando ? 'Pausar' : 'Continuar'; }

async function tocarDe(i) {
  if (!S.estudo) return;
  if (window.BMXFase && window.BMXFase.tutorialAberto()) return;   // com o guia aberto a aula espera (as setas são do guia)
  S.rodada++;
  const r = S.rodada;
  S.palco.cancelar(); pararFala();
  S.i = Math.max(0, Math.min(S.passos.length - 1, i));
  S.tocando = true; botaoPlay();
  for (; S.i < S.passos.length; S.i++) {
    if (r !== S.rodada) return;
    await executar(S.passos[S.i], r);
    if (r !== S.rodada) return;
  }
  S.i = S.passos.length - 1; S.tocando = false; botaoPlay();
  if (S.caso) concluir('fim');
}

/** Cartão com o que a pessoa contou (abertura da aula) ou com o que falta (fecho). */
function mostrarFecho(modo) {
  const e = S.estudo, c = e.conversa || {}, box = limpar(S.ui.fecho);
  box.appendChild(el('b', null, modo === 'contexto' ? 'O que você contou ao BMX' : 'Para o próximo passo'));
  if (modo === 'contexto' && c.relato) box.appendChild(el('p', 'atl-relato', '“' + c.relato + '”'));
  if (c.onde) box.appendChild(el('p', null, c.onde + (c.dor ? ' · dor ' + c.dor + '/10' : '')));
  const grupos = modo === 'contexto' ? [['sim', 'Confirmou', c.confirmou], ['nao', 'Descartou', c.descartou]]
    : [['falta', 'Falta checar', c.falta]];
  grupos.forEach(function (g) {
    if (!g[2] || !g[2].length) return;
    const linha = el('div', 'atl-fecho-linha ' + g[0]); linha.appendChild(el('span', null, g[1]));
    g[2].forEach(function (t) { linha.appendChild(el('i', null, t)); });
    box.appendChild(linha);
  });
  if (modo !== 'contexto' && c.nivel && c.nivel_nome) box.appendChild(el('p', null, 'Nível de atendimento: ' + c.nivel_nome));
  if (modo !== 'contexto' && c.remedios) {   // os remédios do caso moram no painel: daqui dá para ir direto a eles
    const rem = el('button', 'atl-btn atl-remedios', 'Ver alívio e remédios no painel'); rem.type = 'button';
    rem.onclick = function () { concluir('remedios'); };
    box.appendChild(rem);
  }
  box.appendChild(el('small', null, 'Atlas de referência: não é o seu exame nem um diagnóstico.'));
  box.hidden = false;
}

async function executar(passo, r) {
  const e = S.estudo, P = S.palco, prev = S.ultimo;
  S.ultimo = null;                       // só vale como "cena pronta" se o passo terminar sem ser interrompido
  marcarPasso();
  soltarSeta(); P.desmarcar('ponto*'); legenda(''); S.ui.fecho.hidden = true;
  textosDe(S.passos[S.i + 1]).forEach(preparar);   // a voz do próximo passo já vai sendo pedida
  if (S.anterior && S.anterior.est !== passo.est) { await transicao(passo.est); if (r !== S.rodada) return; }
  S.anterior = passo;
  if (passo.tipo === 'contexto') {
    const texto = T.contexto(e);
    legenda(texto);
    mostrarFecho('contexto');
    const fala = falar(texto, r);
    await P.corpo();
    if (r !== S.rodada) return;
    apontar('corpo', { tipo: 'corpo', titulo: e.titulo, texto: e.conversa && e.conversa.onde ? e.conversa.onde : '' });
    await fala;
  } else if (passo.tipo === 'scan') {
    const texto = T.scan(e);
    legenda(texto);
    const fala = falar(texto, r);
    await P.scan();
    if (r !== S.rodada) return;
    await fala;
  } else if (passo.tipo === 'ponto') {
    const pt = e.pontos[passo.k];
    // vindo direto do scan (ou de outro ponto) a cena já está pronta; num salto, remonta o órgão escaneado
    if (prev !== 'scan' && prev !== 'ponto') P.estado(1);
    const texto = T.ponto(pt);
    legenda(pt.texto + (pt.caso ? ' ' + pt.caso : ''));
    apontar('ponto:' + passo.k, { tipo: 'ponto', numero: pad(passo.k + 1), titulo: pt.titulo, texto: pt.texto, caso: pt.caso, atencao: pt.atencao });
    await Promise.all([P.ponto(pt, passo.k), falar(texto, r)]);
  } else if (passo.tipo === 'montagem') {
    legenda(e.montagem.texto);
    const fala = falar(T.montagem(e), r);
    await P.montagem(e.montagem.ordem);
    if (r !== S.rodada) return;
    await fala;
  } else if (passo.tipo === 'impacto') {
    const pr = e.problemas[passo.k], t = T.impacto(pr, passo.k);
    const afetadas = pr.afeta.filter(function (id) { return P.peca(id); });
    P.impactoIniciar(pr);
    await esperar(1500);
    if (r !== S.rodada) return;
    const explicacao = (pr.contexto_educativo ? pr.contexto_educativo + ' ' : '') + pr.mecanismo;
    legenda(explicacao);
    apontar('origem', { tipo: 'impacto', titulo: pr.titulo, texto: explicacao, caso: pr.motivo });
    P.impactoPasso(0);
    await falar(t.abre, r);
    for (let j = 0; j < pr.cadeia.length; j++) {
      if (r !== S.rodada) return;
      legenda(pr.cadeia[j]);
      const id = afetadas.length ? afetadas[j % afetadas.length] : null, info = id && e.pecas.find(function (p) { return p.id === id; });
      if (id) apontar('afetada:' + id, { tipo: 'impacto', numero: String(j + 1), titulo: info ? info.nome : '', texto: pr.cadeia[j] });
      P.impactoPasso(j + 1);
      await falar(pr.cadeia[j], r);
    }
    if (r !== S.rodada) return;
    soltarSeta();
    legenda(pr.ajuda);
    await falar(t.fim, r);
    P.impactoFim();
  } else if (passo.tipo === 'corpo') {
    const texto = T.corpo(e);
    legenda(e.corpo.texto);
    const fala = falar(texto, r);
    await P.corpo();
    if (r !== S.rodada) return;
    const c = e.conversa;
    apontar('corpo', { tipo: 'corpo', titulo: e.titulo, texto: c && c.onde ? c.onde : '' });
    await fala;
  } else if (passo.tipo === 'fecho') {
    const texto = T.fecho(e);
    legenda(texto);
    soltarSeta();
    mostrarFecho('fecho');
    S.ui.pular.hidden = false;
    await falar(texto, r);
    if (r !== S.rodada) return;
    await esperar(900);
  }
  if (r !== S.rodada) return;
  S.ultimo = passo.tipo;
  await esperar(500);
}

/* ── ajuda por fase (fase.js): conversar sobre o passo em exibição; abrir o chat pausa a aula ──── */
function contextoAtlas() {
  const e = S.estudo;
  if (!e) return 'Tela: Atlas 3D, biblioteca de estudos. A pessoa ainda não escolheu uma aula.';
  const p = S.passos[Math.min(S.i, S.passos.length - 1)], c = e.conversa || {};
  const linhas = ['Tela: Atlas 3D, aula "' + e.titulo + '"' + (S.caso ? ', montada a partir do caso da pessoa.' : ', de referência (não é o caso dela).')];
  if (p) linhas.push('Passo ' + (S.i + 1) + ' de ' + S.passos.length + ' (' + NOMES[p.est] + '): ' + p.titulo + '.', 'O que a aula diz neste passo: ' + textosDe(p).join(' '));
  if (S.caso && c.relato) {
    linhas.push('Relato da pessoa: ' + c.relato + (c.onde ? ' Região: ' + c.onde + '.' : '') + (c.dor ? ' Dor ' + c.dor + '/10.' : ''),
      'Confirmou: ' + ((c.confirmou || []).join('; ') || 'nada') + '. Descartou: ' + ((c.descartou || []).join('; ') || 'nada') + '. Falta checar: ' + ((c.falta || []).join('; ') || 'nada') + '.');
    if (c.nivel_nome) linhas.push('Nível de atendimento: ' + c.nivel_nome + '.');
  }
  return linhas.join('\n').slice(0, 3000);
}
function pausarAula() {
  if (!S.tocando) return;
  S.rodada++; S.tocando = false; if (S.palco) S.palco.cancelar(); pararFala(); botaoPlay();
}
function entrarFase() {
  if (!window.BMXFase) return;
  window.BMXFase.entrar({ fase: 'atlas', tema: 'escuro', botoes: false, chat: true, contexto: contextoAtlas, pausar: pausarAula,
    sugestoes: ['O que estou vendo agora?', 'Por que isso importa no meu caso?', 'Explique de um jeito mais simples'],
    vazio: 'Pergunte sobre o que está na tela. A aula fica em pausa enquanto você conversa; depois é só tocar em Continuar.' });
}

/* ── abrir e fechar ───────────────────────────────────────────────────────────────────────────── */
function mostrarBiblioteca() {
  const u = montarTela();
  S.rodada++; if (S.palco) S.palco.cancelar(); pararFala(); S.tocando = false;
  preencherGrade($('#atlLibGrade', u.raiz));
  u.lib.hidden = false;
}

function mostrarReferencias(e) {
  const caixa = $('#atlReferencias', S.ui.raiz), corpo = caixa.querySelector('div');
  corpo.replaceChildren(); caixa.open = false;
  (e.fontes || []).forEach(function (f) {
    if (!/^https:\/\//.test(f.url || '')) return;
    const a = document.createElement('a');
    a.href = f.url; a.textContent = f.titulo; a.target = '_blank'; a.rel = 'noopener noreferrer';
    corpo.appendChild(a);
  });
  if (e.exemplo && e.exemplo.tipo === 'ficticio') {
    const titulo = document.createElement('b'); titulo.textContent = 'Exemplo fictício'; corpo.appendChild(titulo);
    ['relato', 'pergunta', 'resposta'].forEach(function (campo) {
      const p = document.createElement('p'); p.textContent = e.exemplo[campo] || ''; corpo.appendChild(p);
    });
  }
  caixa.hidden = !corpo.childElementCount;
}

async function iniciarAula(e, caso) {
  const u = montarTela();
  mostrarReferencias(e);
  S.rodada++; pararFala(); S.ultimo = null; S.anterior = null; S.cache.clear();
  S.caso = caso;
  u.raiz.hidden = false; u.raiz.classList.remove('saindo'); S.aberto = true; document.body.classList.add('atl-aberto');
  u.lib.hidden = true; u.fecho.hidden = true; soltarSeta(); legenda('');
  u.passo.textContent = ''; u.etapa.textContent = ''; u.prog.style.width = '0';   // nada da aula anterior
  u.pular.hidden = !caso; u.demo.hidden = !caso;
  cobrir('', e.titulo);
  if (!S.palco) S.palco = criarPalco(u.palco);
  S.palco.cancelar();
  S.estudo = e;
  u.raiz.style.setProperty('--cor', e.cor);
  S.palco.aoQuadro = guia;
  S.palco.aoEscolher = null;
  S.palco.pausar(false);
  ajustarEnquadramento();
  const n = await S.palco.carregar(e);
  if (!n) { descobrir(0); legenda('Não consegui carregar o modelo deste estudo.'); return false; }
  S.passos = montarPassos(e);
  desenharTrilha();
  S.palco.estado(0);
  textosDe(S.passos[0]).concat(textosDe(S.passos[1])).forEach(preparar);
  descobrir(500);
  entrarFase();
  if (caso && window.BMXFase) {                    // nas 3 primeiras conexões, o guia do atlas vem antes da aula
    const r = S.rodada;
    await esperar(900);                            // a cortina sobe primeiro
    await window.BMXFase.tutorial('atlas');
    if (!S.aberto || S.estudo !== e || r !== S.rodada) return true;   // a pessoa fechou ou mudou de aula durante o guia
  }
  tocarDe(0);
  return true;
}

async function abrirEstudo(id) {
  montarTela();
  let dados;
  try { dados = await carregarDados(); } catch (err) { alert('Não consegui abrir o atlas agora: ' + (err.message || 'erro')); return; }
  const e = dados.estudos.find(function (x) { return x.id === id; });
  if (e) { S.aoFim = null; iniciarAula(e, false); }
}

/** Aula montada a partir do caso (conversa → atlas → painel). `aoFim(motivo)`: 'fim' | 'pular' | 'fechar'. */
async function abrirCaso(cid, aoFim) {
  montarTela();
  let aula;
  try {
    const r = await fetch('/api/atlas?caso=' + encodeURIComponent(cid || ''));
    if (!r.ok) return false;
    aula = await r.json();
  } catch (err) { return false; }
  if (!aula || !aula.estudos || !aula.estudos.length) return false;
  S.aoFim = aoFim || null;
  return iniciarAula(aula.estudos[0], true);
}

function ocultar() {
  S.ui.raiz.hidden = true; S.ui.raiz.classList.remove('saindo'); S.aberto = false; S.estudo = null; S.caso = false;
  if (window.BMXFase) window.BMXFase.sair('atlas');
  document.body.classList.remove('atl-aberto');
  descobrir(0);
}
function parar() {
  S.rodada++; S.tocando = false; pararFala(); soltarSeta();
  if (S.palco) { S.palco.cancelar(); S.palco.pausar(true); S.palco.descarregar(); }
}
/** A aula acabou (ou foi pulada): a tela se desfaz aos poucos e quem chamou segue (abre o painel do caso). */
function concluir(motivo) {
  if (!S.ui || !S.aberto) return;
  const cb = S.aoFim; S.aoFim = null;
  parar();
  S.ui.raiz.classList.add('saindo');
  setTimeout(function () { ocultar(); if (cb) cb(motivo); }, 480);
}
function fechar(motivo) {
  if (!S.ui || !S.aberto) return;
  const cb = S.aoFim; S.aoFim = null;
  parar(); ocultar();
  if (cb) cb(motivo || 'fechar');
}

/* ── ligação com a página do caso ─────────────────────────────────────────────────────────────── */
async function abrir(id) {
  montarTela();
  if (id) return abrirEstudo(id);
  try { await carregarDados(); } catch (err) { alert('Não consegui abrir o atlas agora.'); return; }
  S.ui.raiz.hidden = false; S.aberto = true; document.body.classList.add('atl-aberto');
  if (!S.palco) S.palco = criarPalco(S.ui.palco);
  entrarFase();
  mostrarBiblioteca();
}

async function iniciar() {
  const secao = $('#atlasGrade');
  document.addEventListener('click', function (e) {
    const c = e.target.closest && e.target.closest('[data-atlas]');
    if (c && !(S.ui && S.ui.raiz.contains(c))) abrirEstudo(c.dataset.atlas);
    const bt = e.target.closest && e.target.closest('[data-atlas-abrir]');
    if (bt) {   // botão do painel do caso: a aula do caso aberto; sem caso, a biblioteca
      const cid = window.BMXCaso && window.BMXCaso.id ? window.BMXCaso.id() : '';
      if (cid) abrirCaso(cid).then(function (ok) { if (!ok) abrir(); }); else abrir();
    }
  });
  const vista = $('.vista');
  if (vista) {
    const b = el('button', 'vista-atlas', 'Atlas 3D'); b.id = 'vAtlas'; b.type = 'button'; b.title = 'Ver no atlas 3D o que você contou ao BMX';
    b.setAttribute('data-atlas-abrir', '1'); vista.appendChild(b);
  }
  if (secao) {
    try { await carregarDados(); preencherGrade(secao); const n = $('#atlasConta'); if (n) n.textContent = S.dados.estudos.length + ' estudos'; }
    catch (err) { limpar(secao).appendChild(el('p', 'vazio-txt', 'Não consegui carregar o atlas agora.')); }
  }
}

window.BMXAtlas = { abrir: abrir, abrirCaso: abrirCaso, fechar: fechar, aberto: function () { return S.aberto; } };
iniciar();
