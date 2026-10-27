/* BMX · ajuda por fase: o que cada tela oferece além do seu conteúdo.
     - Tutorial: nas 3 primeiras conexões da pessoa (o servidor conta em /api/tutorial), uma vez por tela em cada
       conexão; o botão "?" abre de novo quando quiser. Os passos ficam em tutoriais.js.
     - Conversar: pergunta aberta sobre o que está na tela (/api/fase). Não abre caso nem muda nada: só explica.
       As trocas ficam gravadas no servidor e voltam quando a pessoa reabre o chat.
     - Sugestão ou erro: o que melhorar ou alguma inconsistência do modelo (/api/feedback), com a descrição da tela.
   Cada página monta uma fase (montar); o atlas e a demonstração entram por cima (entrar/sair).
   Todo texto vindo do servidor entra na página com textContent, nunca como HTML. */
(function () {
  'use strict';
  var token = (document.querySelector('meta[name="bmx-token"]') || {}).content || '';
  var TITULOS = { entrada: 'Entrada', atendimento: 'Atendimento', atlas: 'Atlas 3D', painel: 'Painel do caso', demo: 'Demonstração guiada' };
  var pilha = [], ui = null, botoes = null, ocupado = false, tut = null, tutAtual = null, conexaoP = null;
  var msgs = {}, carregadas = {};

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function limpar(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function atual() { return pilha.length ? pilha[pilha.length - 1] : null; }

  /* armazenamento do navegador: pode estar bloqueado, então nada daqui pode quebrar a página */
  function ler(onde, chave) { try { return window[onde].getItem(chave); } catch (e) { return null; } }
  function gravar(onde, chave, valor) { try { window[onde].setItem(chave, valor); } catch (e) { /* sem armazenamento */ } }

  function api(rota, corpo) {
    var opc = corpo === undefined ? { headers: { 'x-bmx-token': token } }
      : { method: 'POST', body: JSON.stringify(corpo), headers: { 'content-type': 'application/json', 'x-bmx-token': token } };
    return fetch(rota, opc).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, dados: d }; });
    }).catch(function () { return { ok: false, status: 0, dados: { error: 'Sem conexão com o servidor.' } }; });
  }

  /* ── conexões: o tutorial vale para as 3 primeiras ─────────────────────────────────────────── */
  function localConta() {   // tela de entrada (ainda não se sabe quem é) ou servidor fora do ar: conta neste aparelho
    var n = +ler('sessionStorage', 'bmx-conexao-local');
    if (!n) { n = (+ler('localStorage', 'bmx-conexoes-local') || 0) + 1; gravar('localStorage', 'bmx-conexoes-local', n); gravar('sessionStorage', 'bmx-conexao-local', n); }
    return { entradas: n, vezes: 3 };
  }
  function conexao(fase) {
    if (conexaoP) return conexaoP;
    var salva = +ler('sessionStorage', 'bmx-conexao');
    if (salva) return (conexaoP = Promise.resolve({ entradas: salva, vezes: 3 }));
    conexaoP = fase === 'entrada' ? Promise.resolve(localConta()) : api('/api/tutorial', {}).then(function (r) {
      if (!r.ok || !r.dados.entradas) return localConta();
      gravar('sessionStorage', 'bmx-conexao', r.dados.entradas);
      return r.dados;
    });
    return conexaoP;
  }
  function vistos() { try { return JSON.parse(ler('sessionStorage', 'bmx-tut-vistos') || '{}'); } catch (e) { return {}; } }
  function marcarVisto(fase) { var v = vistos(); v[fase] = 1; gravar('sessionStorage', 'bmx-tut-vistos', JSON.stringify(v)); }

  /* ── tutorial ──────────────────────────────────────────────────────────────────────────────── */
  function alvoDe(p) {
    if (!p.alvo) return null;
    var n = null;
    try { n = document.querySelector(p.alvo); } catch (e) { return null; }
    if (!n) return null;
    var r = n.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth ? r : null;
  }
  function posicionar(card, r) {
    var cw = card.offsetWidth, ch = card.offsetHeight, W = innerWidth, H = innerHeight, x, y;
    if (!r || (r.width > W * 0.7 && r.height > H * 0.6)) { x = (W - cw) / 2; y = (H - ch) / 2; }
    else {
      x = Math.min(Math.max(r.left + r.width / 2 - cw / 2, 8), W - cw - 8);
      if (r.bottom + 14 + ch <= H - 8) y = r.bottom + 14;
      else if (r.top - 14 - ch >= 8) y = r.top - 14 - ch;
      else { y = Math.min(Math.max(r.top + 12, 8), H - ch - 8); x = r.left > W / 2 ? Math.max(8, r.left - cw - 14) : Math.min(W - cw - 8, r.right + 14); }
    }
    card.style.left = Math.round(x) + 'px'; card.style.top = Math.round(y) + 'px';
  }

  function abrirTutorial(fase, passos, c, forcado) {
    return new Promise(function (fim) {
      var cfg = atual(), raiz = el('div', 'bf-tut'), fundo = el('div', 'bf-tut-fundo'), foco = el('div', 'bf-tut-foco'), card = el('div', 'bf-tut-card');
      raiz.dataset.tema = cfg && cfg.fase === fase && cfg.tema ? cfg.tema : (fase === 'atlas' ? 'escuro' : 'claro');
      raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-modal', 'true'); raiz.setAttribute('aria-label', 'Tutorial: ' + (TITULOS[fase] || fase));
      raiz.appendChild(fundo); raiz.appendChild(foco); raiz.appendChild(card);
      document.documentElement.appendChild(raiz);   // fora do <body>: o painel embutido usa `zoom` no body e desalinharia o destaque
      var i = 0;
      tut = raiz;

      function mostrar() {
        var p = passos[i], ult = i === passos.length - 1;
        limpar(card);
        card.appendChild(el('span', 'bf-tut-tag', 'Tutorial · ' + (TITULOS[fase] || fase) + ' · ' + (i + 1) + ' de ' + passos.length));
        card.appendChild(el('b', null, p.titulo));
        card.appendChild(el('p', null, p.texto));
        var pontos = el('div', 'bf-tut-pontos');
        passos.forEach(function (_, k) { pontos.appendChild(el('i', k === i ? 'on' : '')); });
        card.appendChild(pontos);
        var acoes = el('div', 'bf-tut-acoes');
        var pula = el('button', 'pula', 'Pular tutorial'); pula.type = 'button'; pula.onclick = fechar; pula.hidden = ult;
        acoes.appendChild(pula);
        if (i > 0) { var vol = el('button', null, 'Voltar'); vol.type = 'button'; vol.onclick = function () { i--; mostrar(); }; acoes.appendChild(vol); }
        var prox = el('button', 'prox', ult ? 'Entendi' : 'Próximo'); prox.type = 'button';
        prox.onclick = function () { if (ult) fechar(); else { i++; mostrar(); } };
        acoes.appendChild(prox);
        card.appendChild(acoes);
        card.appendChild(el('small', 'bf-tut-rodape', forcado
          ? 'O botão ? abre este guia de novo quando você quiser.'
          : 'Visita ' + c.entradas + ' de ' + c.vezes + ': este guia aparece nas suas ' + c.vezes + ' primeiras conexões. O botão ? abre de novo.'));
        var alvo = null;
        try { alvo = p.alvo ? document.querySelector(p.alvo) : null; } catch (e) { alvo = null; }
        if (alvo && alvo.scrollIntoView) { try { alvo.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* sem rolagem */ } }
        var r = alvoDe(p);
        if (r) {
          var m = 6;
          foco.style.left = (r.left - m) + 'px'; foco.style.top = (r.top - m) + 'px';
          foco.style.width = (r.width + 2 * m) + 'px'; foco.style.height = (r.height + 2 * m) + 'px';
        }
        foco.hidden = !r; fundo.hidden = !!r;
        posicionar(card, r);
        prox.focus();
      }
      function tecla(e) {
        if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); fechar(); }
        else if (e.key === 'ArrowRight' && i < passos.length - 1) { e.stopImmediatePropagation(); i++; mostrar(); }
        else if (e.key === 'ArrowLeft' && i > 0) { e.stopImmediatePropagation(); i--; mostrar(); }
      }
      function refazer() { if (tut === raiz) mostrar(); }
      function fechar() {
        document.removeEventListener('keydown', tecla, true); window.removeEventListener('resize', refazer);
        if (raiz.parentNode) raiz.parentNode.removeChild(raiz);
        if (tut === raiz) tut = null;
        fim(true);
      }
      document.addEventListener('keydown', tecla, true); window.addEventListener('resize', refazer);
      mostrar();
    });
  }

  /** Abre o tutorial da tela se for uma das 3 primeiras conexões da pessoa e ele ainda não passou nesta conexão. */
  function tutorial(fase, forcar) {
    var passos = (window.BMX_TUTORIAIS || {})[fase];
    if (!passos || !passos.length) return Promise.resolve(false);
    if (tut) return tutAtual.then(function () { return tutorial(fase, forcar); });   // um guia por vez: o seguinte espera o aberto fechar
    return conexao(fase).then(function (c) {
      if (!forcar && (c.entradas > c.vezes || vistos()[fase])) return false;
      if (tut) return tutAtual.then(function () { return tutorial(fase, forcar); });   // outro abriu enquanto a conexão era contada
      marcarVisto(fase);
      tutAtual = abrirTutorial(fase, passos, c, !!forcar);
      return tutAtual;
    });
  }

  /* ── painel: conversa e sugestão ───────────────────────────────────────────────────────────── */
  var PAINEL = [
    '<div class="bf-cab"><b></b><button type="button" class="bf-x" aria-label="Fechar">×</button></div>',
    '<div class="bf-abas" role="tablist">',
    '  <button type="button" role="tab" data-aba="chat">Conversar</button>',
    '  <button type="button" role="tab" data-aba="feedback">Sugestão ou erro</button>',
    '</div>',
    '<div class="bf-chat" style="display:flex;flex-direction:column;min-height:0;flex:1">',
    '  <div class="bf-msgs" aria-live="polite"></div><div class="bf-sug"></div><div class="bf-alerta" hidden></div>',
    '  <form class="bf-form"><input maxlength="600" autocomplete="off" aria-label="Pergunta ao BMX"><button class="bf-enviar">Enviar</button></form>',
    '</div>',
    '<div class="bf-fb" hidden>',
    '  <label>O que você quer registrar?<select class="bf-tipo"><option value="sugestao">Sugestão de melhoria</option><option value="inconsistencia">Algo errado ou inconsistente</option></select></label>',
    '  <label>Conte com as suas palavras<textarea maxlength="1500" placeholder="O que poderia melhorar? Ou o que o BMX disse ou mostrou que não faz sentido?"></textarea></label>',
    '  <small>Junto vai uma descrição do que estava na tela, para eu conseguir reproduzir o problema.</small>',
    '  <button type="button" class="bf-enviar">Enviar retorno</button><div class="bf-ok" role="status"></div>',
    '</div>'
  ].join('\n');

  function montarUi() {
    if (ui) return ui;
    var raiz = el('div', 'bf'), p = el('section', 'bf-painel'); p.hidden = true; p.setAttribute('role', 'dialog');
    p.innerHTML = PAINEL;   // HTML estático acima: nenhum dado externo entra aqui
    raiz.appendChild(p); document.documentElement.appendChild(raiz);
    ui = { raiz: raiz, painel: p, titulo: p.querySelector('.bf-cab b'), msgs: p.querySelector('.bf-msgs'), sug: p.querySelector('.bf-sug'),
      alerta: p.querySelector('.bf-alerta'), form: p.querySelector('.bf-form'), campo: p.querySelector('.bf-form input'),
      chat: p.querySelector('.bf-chat'), fb: p.querySelector('.bf-fb'), tipo: p.querySelector('.bf-tipo'), texto: p.querySelector('.bf-fb textarea'),
      ok: p.querySelector('.bf-ok'), abaChat: p.querySelector('[data-aba="chat"]'), abaFb: p.querySelector('[data-aba="feedback"]'), aba: 'chat' };
    p.querySelector('.bf-x').onclick = fechar;
    ui.abaChat.onclick = function () { abrir('chat'); };
    ui.abaFb.onclick = function () { abrir('feedback'); };
    ui.form.onsubmit = function (e) { e.preventDefault(); var v = ui.campo.value; ui.campo.value = ''; perguntar(v); };
    p.querySelector('.bf-fb .bf-enviar').onclick = enviarRetorno;
    p.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } });
    return ui;
  }

  function contexto() {
    var c = atual();
    try { return c && c.contexto ? String(c.contexto() || '') : ''; } catch (e) { return ''; }
  }
  function balao(tipo, texto) {
    var b = el('div', 'bf-msg ' + tipo, texto);
    ui.msgs.appendChild(b); ui.msgs.scrollTop = ui.msgs.scrollHeight;
    return b;
  }
  function desenharConversa() {
    var c = atual(), lista = msgs[c.fase] || [];
    limpar(ui.msgs); limpar(ui.sug); ui.alerta.hidden = true;
    if (!lista.length) ui.msgs.appendChild(el('p', 'bf-vazio', c.vazio || 'Pergunte o que quiser sobre o que está na tela. Eu respondo sem mexer no seu caso.'));
    lista.forEach(function (t) { balao('eu', t.q); balao('bmx', t.a); });
    (c.sugestoes || []).forEach(function (s) {
      var b = el('button', null, s); b.type = 'button'; b.onclick = function () { perguntar(s); }; ui.sug.appendChild(b);
    });
    ui.campo.placeholder = c.placeholder || 'Pergunte sobre esta tela…';
  }
  function carregarHistorico(fase) {
    if (carregadas[fase]) return Promise.resolve();
    carregadas[fase] = true;
    return api('/api/fase?fase=' + encodeURIComponent(fase)).then(function (r) {
      if (r.ok && Array.isArray(r.dados) && r.dados.length && !(msgs[fase] || []).length) {
        msgs[fase] = r.dados.map(function (x) { return { q: String(x.q || ''), a: String(x.a || '') }; });
        var c = atual();
        if (c && c.fase === fase && ui && !ui.painel.hidden && ui.aba === 'chat') desenharConversa();
      }
    });
  }

  function perguntar(texto) {
    texto = String(texto || '').trim();
    var c = atual();
    if (!texto || ocupado || !c) return;
    ocupado = true; ui.alerta.hidden = true;
    var vazio = ui.msgs.querySelector('.bf-vazio'); if (vazio) vazio.remove();
    balao('eu', texto);
    var pens = balao('bmx pensando', 'pensando…');
    var lista = msgs[c.fase] = msgs[c.fase] || [];
    api('/api/fase', { fase: c.fase, pergunta: texto, contexto: contexto(), historico: lista.slice(-4) }).then(function (r) {
      if (r.ok && r.dados.resposta) {
        pens.className = 'bf-msg bmx'; pens.textContent = r.dados.resposta;
        lista.push({ q: texto, a: r.dados.resposta });
        if (r.dados.alerta) mostrarAlerta(r.dados.alerta);
      } else {
        pens.className = 'bf-msg erro'; pens.textContent = r.dados.error || 'Não consegui responder agora.';
      }
    }).then(function () { ocupado = false; ui.msgs.scrollTop = ui.msgs.scrollHeight; ui.campo.focus(); });
  }
  function mostrarAlerta(a) {
    limpar(ui.alerta);
    ui.alerta.appendChild(document.createTextNode(a.title || 'Possível emergência'));
    (a.phones || []).forEach(function (f) {
      var l = el('a', null, f.name + ' ' + f.number); l.href = 'tel:' + String(f.number).replace(/\s+/g, ''); ui.alerta.appendChild(l);
    });
    ui.alerta.hidden = false;
  }

  function enviarRetorno() {
    var c = atual(), texto = ui.texto.value.trim(), btn = ui.fb.querySelector('.bf-enviar');
    if (texto.length < 3) { ui.ok.textContent = 'Escreva um pouco mais para eu registrar.'; return; }
    btn.disabled = true; ui.ok.textContent = '';
    api('/api/feedback', { fase: c.fase, tipo: ui.tipo.value, texto: texto, contexto: contexto() }).then(function (r) {
      btn.disabled = false;
      if (r.ok) { ui.texto.value = ''; ui.ok.textContent = 'Registrado. Obrigado por ajudar a melhorar o BMX.'; }
      else ui.ok.textContent = r.dados.error || 'Não consegui registrar agora. Tente de novo.';
    });
  }

  function abrir(qual) {
    var c = atual();
    if (!c) return;
    if (qual === 'ajuda') {
      if (c.pausar) { try { c.pausar(); } catch (e) { /* a tela cuida de si */ } }   // a aula não segue por baixo do guia
      tutorial(c.fase, true);
      return;
    }
    if (qual === 'chat' && !c.chat) qual = 'feedback';
    montarUi();
    if (!ui.painel.hidden && ui.aba === qual) { fechar(); return; }
    var abrindo = ui.painel.hidden;
    ui.aba = qual;
    ui.raiz.dataset.tema = c.tema || 'claro';
    ui.titulo.textContent = (TITULOS[c.fase] || 'BMX') + ' · ' + (qual === 'chat' ? 'conversar' : 'sugestão ou erro');
    ui.abaChat.hidden = !c.chat;
    ui.abaChat.setAttribute('aria-selected', String(qual === 'chat')); ui.abaFb.setAttribute('aria-selected', String(qual === 'feedback'));
    ui.chat.hidden = qual !== 'chat'; ui.fb.hidden = qual !== 'feedback'; ui.ok.textContent = '';
    ui.painel.hidden = false;
    if (abrindo && c.pausar) { try { c.pausar(); } catch (e) { /* a tela cuida de si */ } }   // a aula ou demonstração para enquanto a pessoa pergunta
    if (qual === 'chat') { desenharConversa(); carregarHistorico(c.fase); ui.campo.focus(); } else ui.texto.focus();
  }
  function fechar() { if (ui) ui.painel.hidden = true; }

  /* ── botões da tela e fases empilhadas ─────────────────────────────────────────────────────── */
  function desenharBotoes() {
    if (botoes && botoes.parentNode) botoes.parentNode.removeChild(botoes);
    botoes = null;
    var c = atual();
    if (!c || c.botoes === false) return;
    var ancora = c.ancora ? document.querySelector(c.ancora) : null;
    botoes = el('div', 'bf-botoes' + (ancora ? '' : ' solto'));
    function botao(qual, rotulo, titulo, cls) {
      var b = el('button', 'bf-btn' + (cls ? ' ' + cls : ''), rotulo); b.type = 'button'; b.dataset.bf = qual; b.title = titulo; return b;
    }
    if (c.chat) botoes.appendChild(botao('chat', 'Perguntar', 'Tire dúvidas sobre esta tela'));
    if (c.feedback !== false) botoes.appendChild(botao('feedback', 'Sugestão', 'Conte o que melhorar ou o que está inconsistente'));
    if ((window.BMX_TUTORIAIS || {})[c.fase]) { var q = botao('ajuda', '?', 'Ver o tutorial desta tela', 'redondo'); q.setAttribute('aria-label', 'Tutorial desta tela'); botoes.appendChild(q); }
    if (ancora) ancora.insertBefore(botoes, c.antes ? ancora.querySelector(c.antes) : null);
    else document.documentElement.appendChild(botoes);
  }

  /** A página monta a sua fase. cfg: {fase, chat, feedback, ancora, antes, botoes, tema, contexto(), pausar(), sugestoes[], vazio, placeholder} */
  function montar(cfg) { pilha = [cfg]; fechar(); desenharBotoes(); return window.BMXFase; }
  /** Uma tela por cima (atlas, demonstração): troca a fase até sair(). */
  function entrar(cfg) { pilha = pilha.filter(function (c) { return c.fase !== cfg.fase; }); pilha.push(cfg); fechar(); desenharBotoes(); }
  function sair(fase) {
    if (pilha.length < 2 || !pilha.some(function (c) { return c.fase === fase; })) return;
    pilha = pilha.filter(function (c) { return c.fase !== fase; }); fechar(); desenharBotoes();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-bf]');
    if (b && atual()) abrir(b.dataset.bf);
  });

  window.BMXFase = { montar: montar, entrar: entrar, sair: sair, abrir: abrir, fechar: fechar, tutorial: tutorial,
    tutorialAberto: function () { return !!tut; } };
})();
