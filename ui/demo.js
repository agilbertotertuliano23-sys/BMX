/* Demonstrações guiadas do BMX: o servidor devolve um roteiro (passos com ação, resumo, explicação, termos e
   aprofundamento) e este arquivo o toca: fala + câmera e destaques no corpo 3D (window.BMXCorpo) + cartões.
   Profundidade: Simples (só o resumo), Intermediário (+ explicação e glossário) e Aprofundado (+ aprofundamento).
   Todo texto vindo do servidor entra na página com textContent, nunca como HTML. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var token = (document.querySelector('meta[name="bmx-token"]') || {}).content || '';
  var NIVEIS = [['simples', 'Simples'], ['intermediario', 'Intermediário'], ['aprofundado', 'Aprofundado']];
  var CAMADAS_PARA_LIGAR = ['musculos', 'orgaos', 'arterias', 'veias', 'nervos', 'ossos'];
  var st = { r: null, i: 0, nivel: lerNivel(), rodada: 0, tocando: false, isolado: null, audio: null, soltaFala: null };
  var catalogo = [], filtroTipo = 'todos', busca = '';

  function lerNivel() {
    try { var n = localStorage.getItem('bmx-demo-nivel'); if (NIVEIS.some(function (x) { return x[0] === n; })) return n; } catch (e) { /* sem storage */ }
    return 'intermediario';
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function limpar(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  async function api(rota, corpo, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms || 30000);
    try {
      var r = await fetch(rota, corpo === undefined ? { signal: ctl.signal } : {
        method: 'POST', signal: ctl.signal, body: JSON.stringify(corpo),
        headers: { 'content-type': 'application/json', 'x-bmx-token': token } });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.error || ('erro ' + r.status));
      return j;
    } finally { clearTimeout(t); }
  }

  /* ── catálogo ─────────────────────────────────────────────────────── */
  function desenharCatalogo() {
    var tipos = [['todos', 'Todos']].concat(catalogo.reduce(function (a, c) {
      if (!a.some(function (x) { return x[0] === c.tipo; })) a.push([c.tipo, c.rotulo]); return a; }, []));
    var barra = limpar($('#demosFiltros'));
    tipos.forEach(function (t) {
      var b = el('button', 'demo-filtro' + (filtroTipo === t[0] ? ' on' : ''), t[1]);
      b.type = 'button'; b.onclick = function () { filtroTipo = t[0]; desenharCatalogo(); };
      barra.appendChild(b);
    });
    var q = busca.toLowerCase();
    var itens = catalogo.filter(function (c) {
      return (filtroTipo === 'todos' || c.tipo === filtroTipo) && (!q || (c.titulo + ' ' + c.rotulo).toLowerCase().indexOf(q) >= 0); });
    $('#demosConta').textContent = itens.length + ' de ' + catalogo.length;
    var grade = limpar($('#demosGrade'));
    itens.forEach(function (c) {
      var card = el('article', 'demo-card');
      card.appendChild(el('span', 'demo-tag t-' + c.tipo, c.rotulo));
      card.appendChild(el('h3', null, c.titulo));
      card.appendChild(el('p', null, c.passos + ' passos · cerca de ' + Math.max(1, Math.round(c.segundos / 60)) + ' min'));
      var b = el('button', 'demo-btn', '▶ Assistir'); b.type = 'button'; b.dataset.demo = c.id;
      card.appendChild(b); grade.appendChild(card);
    });
    if (!itens.length) grade.appendChild(el('p', 'vazio-txt', 'Nenhuma demonstração com esse filtro.'));
  }

  /* ── fala ─────────────────────────────────────────────────────────── */
  function pararFala() {
    if (st.audio) { try { st.audio.pause(); } catch (e) { /* */ } st.audio = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (st.soltaFala) { var f = st.soltaFala; st.soltaFala = null; f(); }
  }
  function falar(texto, rodada) {
    return new Promise(function (ok) {
      var feito = false;
      function fim() { if (!feito) { feito = true; st.soltaFala = null; ok(); } }
      st.soltaFala = fim;
      function navegador() {
        if (rodada !== st.rodada) return fim();
        if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
          var u = new SpeechSynthesisUtterance(texto); u.lang = 'pt-BR'; u.rate = 1.0;
          u.onend = fim; u.onerror = fim; speechSynthesis.speak(u);
        } else setTimeout(fim, Math.max(1500, texto.split(/\s+/).length * 380));   // sem voz: o texto na tela marca o ritmo
      }
      fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bmx-token': token },
        body: JSON.stringify({ text: texto }) }).then(function (r) {
        if (!r.ok || !/audio/.test(r.headers.get('content-type') || '')) throw new Error('sem voz do servidor');
        return r.blob();
      }).then(function (blob) {
        if (rodada !== st.rodada) return fim();
        var a = new Audio(URL.createObjectURL(blob)); st.audio = a;
        a.onended = fim; a.onerror = navegador;
        return a.play().catch(navegador);
      }).catch(navegador);
    });
  }

  /* ── efeitos no corpo 3D ───────────────────────────────────────────── */
  function desligarCamadas(C) { CAMADAS_PARA_LIGAR.forEach(function (id) { if (C.ligada(id)) C.camada(id, false); }); }
  async function agir(a, rodada) {
    var C = window.BMXCorpo;
    if (!C) return;
    try {
      if (a.tipo === 'corpo') { desligarCamadas(C); await C.mostrar({}); st.isolado = null; }
      else if (a.tipo === 'regiao') { await C.mostrar({ estruturas: a.estruturas, regiao3d: a.regiao3d, lado: '' }); st.isolado = null; }
      else if (a.tipo === 'estrutura') { if (st.isolado !== a.id) { C.isolar(a.id); st.isolado = a.id; } }
      else if (a.tipo === 'camadas') {
        desligarCamadas(C); await C.mostrar({}); st.isolado = null;
        for (var k = 0; k < a.ids.length; k++) {
          if (rodada !== st.rodada) return;
          await C.camada(a.ids[k], true); await espera(1400);
        }
        if (rodada === st.rodada) desligarCamadas(C);
      }
    } catch (e) { console.warn('[demo]', e); }
  }

  /* ── tela ─────────────────────────────────────────────────────────── */
  function compor(p) {
    var t = [p.resumo];
    if (st.nivel !== 'simples' && p.explicacao) t.push(p.explicacao);
    if (st.nivel === 'aprofundado' && p.aprofundar) t.push(p.aprofundar);
    return t.join(' ');
  }
  function cartao(a) {
    var c = limpar($('#demoCartao')); c.hidden = true; c.className = 'demo-cartao';
    function lista(itens) { var u = el('ul'); itens.forEach(function (x) { u.appendChild(el('li', null, x)); }); return u; }
    if (a.tipo === 'alerta') {
      c.className += ' demo-alerta'; c.appendChild(el('b', null, 'Quando procurar ajuda')); c.appendChild(el('p', null, a.texto));
      if ((a.nao_perder || []).length) c.appendChild(lista(a.nao_perder));
    } else if (a.tipo === 'remedio') {
      c.className += ' remedio'; c.appendChild(el('b', null, a.titulo)); c.appendChild(el('p', null, a.texto));
      var cau = Array.isArray(a.cautelas) ? a.cautelas : (a.cautelas ? [a.cautelas] : []);
      if (cau.length) c.appendChild(lista(cau));
      var fotos = el('div', 'demo-fotos');
      (a.fotos || []).forEach(function (f) {
        var fig = el('figure'); var img = el('img'); img.src = f.arquivo; img.alt = f.nome; img.loading = 'lazy';
        var leg = el('figcaption', null, f.nome + ' · '); var ln = el('a', null, f.autor + ', ' + f.licenca);
        ln.href = f.fonte; ln.target = '_blank'; ln.rel = 'noopener noreferrer'; leg.appendChild(ln);
        fig.appendChild(img); fig.appendChild(leg); fotos.appendChild(fig);
      });
      c.appendChild(fotos); c.appendChild(el('small', null, 'Fotos ilustrativas: não indicam o que usar nem a dose. Converse com um farmacêutico ou com o seu médico.'));
    } else if (a.tipo === 'observar') {
      c.className += ' observar'; c.appendChild(el('b', null, 'O que observar'));
      (a.pistas || []).forEach(function (p) {
        var d = el('div', 'pista'); d.appendChild(el('span', null, p.rotulo)); d.appendChild(el('strong', null, p.pergunta));
        d.appendChild(el('small', null, p.por_que)); c.appendChild(d); });
    } else if (a.tipo === 'afeta') {
      c.className += ' afeta'; c.appendChild(el('b', null, 'Sistemas envolvidos'));
      var ch = el('div', 'chips'); a.sistemas.forEach(function (s) { ch.appendChild(el('span', 'chip', s)); }); c.appendChild(ch);
    } else if (a.tipo === 'queixas') {
      c.appendChild(el('b', null, 'Queixas ligadas')); var q = el('div', 'chips');
      a.lista.forEach(function (x) { var b = el('button', 'chip', x.queixa); b.type = 'button'; b.dataset.demo = 'queixa:' + x.id; q.appendChild(b); });
      c.appendChild(q);
    } else if (a.tipo === 'fim') {
      c.appendChild(el('b', null, 'Para levar à conversa')); c.appendChild(el('p', null, 'Anote o que chamou a sua atenção e conte ao BMX e a um profissional.'));
    } else return;
    c.hidden = false;
  }
  function mostrarPasso(p) {
    $('#demoResumo').textContent = p.resumo;
    var ex = $('#demoExplicacao'); ex.textContent = st.nivel === 'simples' ? '' : p.explicacao; ex.hidden = st.nivel === 'simples';
    var tm = limpar($('#demoTermos')); tm.hidden = st.nivel === 'simples' || !(p.termos || []).length;
    (p.termos || []).forEach(function (t) { var s = el('span', 'termo'); s.appendChild(el('b', null, t.tecnico)); s.appendChild(document.createTextNode(' = ' + t.simples)); tm.appendChild(s); });
    var ap = $('#demoAprofundar'); ap.textContent = p.aprofundar || ''; ap.hidden = st.nivel !== 'aprofundado' || !p.aprofundar;
    $('#demoContagem').textContent = 'Passo ' + (st.i + 1) + ' de ' + st.r.passos.length + ' · ' + p.titulo;
    Array.prototype.forEach.call($('#demoTrilha').children, function (b, k) { b.className = k < st.i ? 'feito' : (k === st.i ? 'atual' : ''); });
    cartao(p.acao);
  }
  function botaoPlay() { $('#demoPlay').textContent = st.tocando ? 'Pausar' : 'Continuar'; }

  async function tocarDe(i) {
    pararFala(); var rodada = ++st.rodada; st.tocando = true; botaoPlay();
    // ao pular direto para uma estrutura, a região dela precisa estar aberta: refaz o passo de região anterior
    if (st.r.passos[i].acao.tipo === 'estrutura') {
      for (var k = i - 1; k >= 0; k--) {
        if (st.r.passos[k].acao.tipo === 'regiao') { await agir(st.r.passos[k].acao, rodada); break; }
      }
    }
    if (rodada !== st.rodada) return;
    for (st.i = i; st.i < st.r.passos.length; st.i++) {
      var p = st.r.passos[st.i]; mostrarPasso(p); agir(p.acao, rodada);
      await falar(compor(p), rodada);
      if (rodada !== st.rodada) return;
      await espera(500);
      if (rodada !== st.rodada) return;
    }
    st.i = st.r.passos.length - 1; st.tocando = false; botaoPlay();
  }
  function irPara(i) { tocarDe(Math.max(0, Math.min(st.r.passos.length - 1, i))); }

  function montarPalco(r) {
    $('#demoRotulo').textContent = 'Demonstração'; $('#demoTitulo').textContent = r.titulo; $('#demoAviso').textContent = r.aviso;
    var tr = limpar($('#demoTrilha'));
    r.passos.forEach(function (p, k) { var b = el('button', null, ''); b.type = 'button'; b.title = p.titulo; b.setAttribute('aria-label', 'Ir ao passo ' + (k + 1) + ': ' + p.titulo); b.onclick = function () { irPara(k); }; tr.appendChild(b); });
    var nv = limpar($('#demoNiveis'));
    NIVEIS.forEach(function (n) {
      var b = el('button', st.nivel === n[0] ? 'on' : '', n[1]); b.type = 'button';
      b.onclick = function () { st.nivel = n[0]; try { localStorage.setItem('bmx-demo-nivel', n[0]); } catch (e) { /* */ } montarPalco(st.r); irPara(st.i); };
      nv.appendChild(b);
    });
  }
  function fechar() { st.rodada++; st.tocando = false; pararFala(); $('#demo').hidden = true; document.body.classList.remove('em-demo'); }

  async function assistir(rid) {
    var box = $('#demo'); box.hidden = false; document.body.classList.add('em-demo');
    st.rodada++; pararFala();
    $('#demoTitulo').textContent = 'Preparando…'; $('#demoAviso').textContent = '';
    $('#demoResumo').textContent = 'A IA está escrevendo a explicação deste roteiro. Na primeira vez pode levar alguns segundos.';
    $('#demoExplicacao').textContent = ''; limpar($('#demoTermos')); $('#demoAprofundar').textContent = ''; $('#demoCartao').hidden = true;
    var palco = $('#palco'); if (palco && palco.scrollIntoView) palco.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var r;
    try { r = await api('/api/demo', { roteiro: rid }, 40000); }
    catch (e) {                                  // LLM lenta ou fora do ar: começa já com o texto básico do roteiro
      try { r = await api('/api/demo', { roteiro: rid, rapido: true }, 15000); }
      catch (e2) { $('#demoResumo').textContent = 'Não consegui preparar esta demonstração agora: ' + (e2.message || 'erro') + '.'; return; }
    }
    st.r = r; montarPalco(r); irPara(0);
  }

  /* ── abas: Investigar sintoma | Demonstrações (uma de cada vez) ─────── */
  function criarAbas() {
    var itens = [['investigar', 'Investigar sintoma', '.explorar'], ['demos', 'Demonstrações guiadas', '.demos-secao']];
    document.body.dataset.aba = document.body.dataset.aba || 'investigar';
    itens.forEach(function (alvo) {
      var card = $(alvo[2]); if (!card) return;
      var nav = el('div', 'abas'); nav.setAttribute('role', 'tablist');
      itens.forEach(function (it) {
        var b = el('button', document.body.dataset.aba === it[0] ? 'on' : '', it[1]); b.type = 'button';
        b.setAttribute('role', 'tab'); b.dataset.aba = it[0];
        b.onclick = function () {
          document.body.dataset.aba = it[0];
          Array.prototype.forEach.call(document.querySelectorAll('.abas button'), function (x) { x.className = x.dataset.aba === it[0] ? 'on' : ''; });
          var destino = $(it[0] === 'demos' ? '.demos-secao' : '.explorar'); if (destino && destino.scrollIntoView) destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        nav.appendChild(b);
      });
      card.insertBefore(nav, card.firstChild);
    });
  }

  /* ── ligação ──────────────────────────────────────────────────────── */
  function ligar() {
    criarAbas();
    document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-demo]'); if (b) assistir(b.dataset.demo); });
    $('#demoFechar').onclick = fechar;
    $('#demoPlay').onclick = function () { if (st.tocando) { st.rodada++; st.tocando = false; pararFala(); botaoPlay(); } else irPara(st.i); };
    $('#demoAnt').onclick = function () { irPara(st.i - 1); };
    $('#demoProx').onclick = function () { irPara(st.i + 1); };
    $('#demosBusca').addEventListener('input', function () { busca = this.value.trim(); desenharCatalogo(); });
    api('/api/demos').then(function (c) { catalogo = c; desenharCatalogo(); })
      .catch(function () { limpar($('#demosGrade')).appendChild(el('p', 'vazio-txt', 'Não consegui carregar as demonstrações.')); });
  }
  if ($('#demos')) ligar();
})();
