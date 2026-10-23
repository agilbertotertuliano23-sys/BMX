/* Voz do BMX (base: a parte de voz do app.js do jarvis-claude-code).
   - falar(): Fish Audio pelo servidor quando há chave; senão a voz pt-BR do
     navegador. Resolve quando a fala TERMINA (a escuta depende disso).
   - falarIntro(): a apresentação ao recarregar. Navegador bloqueou áudio sem
     clique? Mostra "Toque para ouvir" e fala no primeiro toque.
   - Escuta: conversa contínua. Com whisper/Fish no servidor, grava e corta pela
     pausa (como a base); sem eles, usa o reconhecimento de fala do Chrome em
     pt-BR. Nos dois casos fica surda enquanto o BMX fala, senão ele se ouve. */
(function (global) {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var TAG_RE = /\[([^\][]{1,90})\]/g;
  function semTags(t) { return String(t || '').replace(TAG_RE, ' ').replace(/\s{2,}/g, ' ').trim(); }

  function estado(nome) { global.dispatchEvent(new CustomEvent('bmx:estado', { detail: { estado: nome } })); }
  function painel(txt, cls) {
    var e = $('#vozEstado'), d = $('#vozDot');
    if (e) e.textContent = txt;
    if (d) d.className = 'dot ' + (cls || '');
  }
  function log(k, l, m) { if (global.BMX && BMX.log) BMX.log(k, l, m); }
  function status() { return (global.BMX && BMX.status) || Promise.resolve({}); }

  /* ── voz do navegador ─────────────────── */
  var vozPt = null;
  function escolherVoz() {
    if (!global.speechSynthesis) return;
    var vs = speechSynthesis.getVoices();
    var pt = vs.filter(function (v) { return /^pt(-|_)BR/i.test(v.lang); });
    if (!pt.length) pt = vs.filter(function (v) { return /^pt/i.test(v.lang); });
    var nota = function (v) {
      return (/natural|online/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0)
        + (/antonio|daniel|male/i.test(v.name) ? 1 : 0);
    };
    pt.sort(function (a, b) { return nota(b) - nota(a); });
    vozPt = pt[0] || null;
  }
  if (global.speechSynthesis) {
    escolherVoz();
    speechSynthesis.onvoiceschanged = escolherVoz;
  }

  /* 'ok' quando termina; 'bloqueado' se o navegador recusou sem gesto (o Chrome
     às vezes nem dispara erro — por isso o prazo para a fala começar). */
  function falarNavegador(texto) {
    return new Promise(function (resolve) {
      if (!global.speechSynthesis) return resolve('ok');
      var u = new SpeechSynthesisUtterance(semTags(texto));
      u.lang = 'pt-BR';
      if (vozPt) u.voice = vozPt;
      u.rate = 0.96; u.pitch = 0.98;   // o Baymax fala devagar e macio
      var comecou = false, fim = false;
      var acaba = function (r) { if (!fim) { fim = true; resolve(r); } };
      u.onstart = function () { comecou = true; };
      u.onend = function () { acaba('ok'); };
      u.onerror = function (e) { acaba(e && e.error === 'not-allowed' ? 'bloqueado' : 'ok'); };
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      setTimeout(function () {
        if (!comecou && !fim) { speechSynthesis.cancel(); acaba('bloqueado'); }
      }, 1800);
    });
  }

  /* fonte: Blob (resposta do servidor) ou URL (fala gravada) */
  function tocar(fonte) {
    return new Promise(function (resolve) {
      var criada = typeof fonte !== 'string';
      var url = criada ? URL.createObjectURL(fonte) : fonte;
      var a = new Audio(url);
      var fim = function (r) { if (criada) URL.revokeObjectURL(url); resolve(r); };
      a.onended = function () { fim('ok'); };
      a.onerror = function () { fim('erro'); };
      a.play().catch(function (e) { fim(e && e.name === 'NotAllowedError' ? 'bloqueado' : 'erro'); });
    });
  }

  /* ── falas gravadas do Baymax (voz/falas.json) ───────────────────────────
     Frase que existe gravada toca o arquivo na hora, sem pedir nada ao servidor. O resto vai à voz do
     servidor em blocos: o 1º é só a 1ª frase (começa a falar logo); os seguintes juntam frases até
     ~180 letras. Os pedidos saem em paralelo (no máximo 2) e a reprodução segue a ordem do texto. */
  var falasMapa = null, LIM_PEDIDOS = 2, BLOCO_MAX = 180;

  function chave(t) {
    return semTags(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function carregarFalas() {
    if (falasMapa) return Promise.resolve(falasMapa);
    return fetch('/voz/falas.json').then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; })
      .then(function (lista) {
        falasMapa = {};
        lista.forEach(function (f) { falasMapa[chave(f.texto)] = '/voz/' + f.arq; });
        return falasMapa;
      });
  }

  function planejar(texto, mapa) {
    var frases = String(texto).split(/(?<=[.!?…])\s+/).filter(function (f) { return f.trim(); });
    // o tom do começo da resposta ([calm], [soft tone]…) vale para ela toda: sem isso só o 1º bloco o recebe
    var tom = ((String(texto).match(/^\s*((?:\[[^\]]{1,40}\]\s*)+)/) || ['', ''])[1].match(/\[[^\]]+\]/g) || [])
      .filter(function (t) { return !/^\[\s*n[ií]vel/i.test(t); }).join(' ');
    var plano = [], bloco = '', primeiro = true;
    function fechar() {
      if (!bloco) return;
      if (tom && !/^\s*\[/.test(bloco)) bloco = tom + ' ' + bloco;
      plano.push({ texto: bloco }); bloco = ''; primeiro = false;
    }
    frases.forEach(function (f) {
      var url = mapa[chave(f)];
      if (url) { fechar(); plano.push({ url: url, texto: f }); return; }
      bloco = bloco ? bloco + ' ' + f : f;
      if (primeiro || bloco.length >= BLOCO_MAX) fechar();
    });
    fechar();
    return plano;
  }

  async function executar(plano, temServidor) {
    var livres = LIM_PEDIDOS, fila = [];
    function pegar() { return new Promise(function (ok) { if (livres > 0) { livres--; ok(); } else fila.push(ok); }); }
    function soltar() { var n = fila.shift(); if (n) n(); else livres++; }
    function buscar(texto) {
      return pegar().then(function () {
        return fetch('/api/speak', {
          method: 'POST', headers: BMX.headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({ text: texto })
        }).then(function (res) { return res.ok ? res.blob() : null; });
      }).catch(function () { return null; }).then(function (b) { soltar(); return b; });
    }
    plano.forEach(function (p) { if (!p.url && temServidor) p.pedido = buscar(p.texto); });
    for (var i = 0; i < plano.length; i++) {
      var p = plano[i], r = 'erro';
      // avisa a tela o que está sendo dito agora: o painel do caso destaca a parte correspondente (app.js)
      global.dispatchEvent(new CustomEvent('bmx:fala', { detail: { texto: p.texto, i: i, n: plano.length } }));
      if (p.url) r = await tocar(p.url);
      else if (p.pedido) { var b = await p.pedido; if (b) r = await tocar(b); }
      if (r === 'bloqueado') return r;
      if (r === 'erro') {
        log('nota', 'VOZ', 'trecho sem voz do servidor, usando a do navegador');
        r = await falarNavegador(p.texto);
        if (r === 'bloqueado') return r;
      }
    }
    return 'ok';
  }
  /* ── fim das falas gravadas ── */

  var Voz = { falando: false };

  async function falar(texto) {
    texto = String(texto || '').trim();
    if (!texto) return 'ok';
    Voz.falando = true;
    global.dispatchEvent(new CustomEvent('bmx:fala-inicio'));   // a tela trava a entrada até a fala terminar
    Escuta.pausar();
    document.body.classList.add('falando');
    estado('falando');
    painel('FALANDO', 'quente');
    try {
      var s = await status();
      var temServidor = !!(s && s.server_voice);
      var plano = planejar(texto, await carregarFalas());
      // as falas gravadas tocam mesmo sem voz de servidor
      if (temServidor || plano.some(function (p) { return p.url; })) {
        try { return await executar(plano, temServidor); }
        catch (e) { log('nota', 'VOZ', 'a reprodução falhou, usando a voz do navegador'); }
      }
      return await falarNavegador(texto);
    } finally {
      Voz.falando = false;
      global.dispatchEvent(new CustomEvent('bmx:fala-fim'));
      document.body.classList.remove('falando');
      estado(Escuta.on ? 'ouvindo' : 'ocioso');
      painel(Escuta.on ? 'OUVINDO' : 'PRONTO', Escuta.on ? 'quente' : '');
      Escuta.retomar();
    }
  }

  var introFeita = false;
  async function falarIntro(texto) {
    if (introFeita) return;
    introFeita = true;
    var r = await falar(texto);
    if (r !== 'bloqueado') return;
    log('nota', 'VOZ', 'o navegador pediu um clique antes de tocar áudio');
    var botao = $('#ouvir');
    if (botao) botao.hidden = false;
    var vai = function () {
      document.removeEventListener('pointerdown', vai, true);
      document.removeEventListener('keydown', vai, true);
      if (botao) botao.hidden = true;
      falar(texto);
    };
    document.addEventListener('pointerdown', vai, true);
    document.addEventListener('keydown', vai, true);
  }

  /* ── escuta contínua ──────────────────── */
  var SILENCIO_MS = 950, FALA_MIN_MS = 350, FALA_MAX_MS = 20000;
  var SR = global.SpeechRecognition || global.webkitSpeechRecognition;

  var Escuta = {
    on: false, modo: null,
    // modo servidor (MediaRecorder + VAD), igual à base
    stream: null, ctx: null, analyser: null, dados: null, rec: null, pedacos: [], raf: 0,
    limiar: 0.02, inicio: 0, ultimaVoz: 0, armado: false, enviando: false,
    // modo navegador
    sr: null, srRodando: false,

    async ligar() {
      if (Escuta.on) return;
      var s = await status();
      Escuta.modo = s && s.server_stt ? 'servidor' : (SR ? 'navegador' : null);
      if (!Escuta.modo) {
        log('erro', 'VOZ', 'sem reconhecimento de fala: use o Chrome/Edge ou instale o whisper.cpp');
        return;
      }
      if (Escuta.modo === 'servidor') { if (!(await Escuta.abrirMic())) return; }
      Escuta.on = true;
      document.body.classList.add('ouvindo');
      $('#btnMic').classList.add('ativo');
      $('#btnMic .mic-txt').textContent = 'Ouvindo';
      $('#vozDica').textContent = Escuta.modo === 'servidor' ? 'fale e faça uma pausa' : 'reconhecimento pt-BR';
      estado('ouvindo');
      if (Escuta.modo === 'servidor') {
        painel('CALIBRANDO', 'quente');
        await Escuta.calibrar();
        Escuta.laco();
      } else {
        Escuta.iniciarSR();
      }
      painel('OUVINDO', 'quente');
      log('ok', 'VOZ', 'conversa por voz ligada (' + Escuta.modo + ') — é só falar');
    },

    desligar() {
      Escuta.on = false;
      Escuta.armado = false;
      cancelAnimationFrame(Escuta.raf);
      try { if (Escuta.rec && Escuta.rec.state === 'recording') Escuta.rec.stop(); } catch (e) {}
      if (Escuta.stream) Escuta.stream.getTracks().forEach(function (t) { t.stop(); });
      if (Escuta.ctx) { try { Escuta.ctx.close(); } catch (e) {} }
      Escuta.stream = Escuta.ctx = Escuta.analyser = null;
      if (Escuta.sr) { try { Escuta.sr.abort(); } catch (e) {} }
      Escuta.srRodando = false;
      document.body.classList.remove('ouvindo');
      $('#btnMic').classList.remove('ativo');
      $('#btnMic .mic-txt').textContent = 'Falar';
      $('#vozDica').textContent = 'clique em Falar';
      Escuta.medidor(0);
      painel('PRONTO', '');
      estado('ocioso');
      log('nota', 'VOZ', 'conversa por voz desligada');
    },

    /* enquanto o BMX pensa ou fala, a escuta fica surda */
    pausar() { if (Escuta.modo === 'navegador' && Escuta.sr && Escuta.srRodando) { try { Escuta.sr.abort(); } catch (e) {} } },
    retomar() {
      if (!Escuta.on || Escuta.modo !== 'navegador' || Voz.falando || BMX.ocupado()) return;
      setTimeout(Escuta.iniciarSR, 250);
    },

    iniciarSR() {
      if (!Escuta.on || Escuta.srRodando || Voz.falando || BMX.ocupado()) return;
      if (!Escuta.sr) {
        Escuta.sr = new SR();
        Escuta.sr.lang = 'pt-BR';
        Escuta.sr.continuous = true;
        Escuta.sr.interimResults = true;
        Escuta.sr.onstart = function () { Escuta.srRodando = true; };
        Escuta.sr.onend = function () {
          Escuta.srRodando = false;
          if (Escuta.on && !Voz.falando && !BMX.ocupado()) setTimeout(Escuta.iniciarSR, 300);
        };
        Escuta.sr.onerror = function (e) {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            log('erro', 'VOZ', 'microfone negado pelo navegador');
            Escuta.desligar();
          } else if (e.error === 'network') {
            log('erro', 'VOZ', 'o reconhecimento do navegador precisa de internet (ou instale o whisper.cpp)');
          }
        };
        Escuta.sr.onresult = function (ev) {
          var parcial = '', final = '';
          for (var i = ev.resultIndex; i < ev.results.length; i++) {
            if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
            else parcial += ev.results[i][0].transcript;
          }
          if (parcial) { $('#vozDica').textContent = parcial.slice(-40); painel('ESCUTANDO', 'quente'); }
          final = final.trim();
          if (final && !Voz.falando && !BMX.ocupado()) {
            $('#vozDica').textContent = 'reconhecimento pt-BR';
            log('nota', 'VOZ', 'ouvi: "' + final + '"');
            BMX.enviar(final);
          }
        };
      }
      try { Escuta.sr.start(); } catch (e) { /* já rodando */ }
    },

    async abrirMic() {
      try {
        Escuta.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      } catch (e) {
        log('erro', 'VOZ', 'microfone indisponível: ' + String(e).slice(0, 70));
        return false;
      }
      Escuta.ctx = new (global.AudioContext || global.webkitAudioContext)();
      if (Escuta.ctx.state === 'suspended') await Escuta.ctx.resume();
      Escuta.analyser = Escuta.ctx.createAnalyser();
      Escuta.analyser.fftSize = 1024;
      Escuta.dados = new Uint8Array(Escuta.analyser.fftSize);
      Escuta.ctx.createMediaStreamSource(Escuta.stream).connect(Escuta.analyser);
      return true;
    },

    /* mede o ruído da sala e fica acima dele */
    calibrar() {
      return new Promise(function (resolve) {
        var amostras = [], t0 = performance.now();
        (function passo() {
          if (!Escuta.on) return resolve();
          amostras.push(Escuta.nivel());
          if (performance.now() - t0 < 700) return requestAnimationFrame(passo);
          amostras.sort(function (a, b) { return a - b; });
          var piso = amostras[Math.floor(amostras.length / 2)] || 0.005;
          Escuta.limiar = Math.max(piso * 3.2, 0.015);
          resolve();
        })();
      });
    },

    nivel() {
      if (!Escuta.analyser) return 0;
      Escuta.analyser.getByteTimeDomainData(Escuta.dados);
      var soma = 0;
      for (var i = 0; i < Escuta.dados.length; i++) {
        var v = (Escuta.dados[i] - 128) / 128;
        soma += v * v;
      }
      return Math.sqrt(soma / Escuta.dados.length);
    },

    medidor(rms) {
      var el = $('#vuBarra');
      if (!el) return;
      el.style.width = Math.min(100, Math.round((rms / (Escuta.limiar * 4)) * 100)) + '%';
      el.className = Escuta.armado ? 'vu-barra quente' : 'vu-barra';
    },

    laco() {
      if (!Escuta.on) return;
      Escuta.raf = requestAnimationFrame(Escuta.laco);
      if (BMX.ocupado() || Voz.falando) {
        if (Escuta.armado) Escuta.descartar();
        Escuta.medidor(0);
        return;
      }
      var rms = Escuta.nivel(), agora = performance.now();
      Escuta.medidor(rms);
      if (rms > Escuta.limiar) Escuta.ultimaVoz = agora;
      if (!Escuta.armado) { if (rms > Escuta.limiar) Escuta.gravar(agora); return; }
      if (agora - Escuta.inicio > FALA_MAX_MS) return Escuta.fechar();
      if (agora - Escuta.ultimaVoz > SILENCIO_MS) {
        if (agora - Escuta.inicio - SILENCIO_MS > FALA_MIN_MS) Escuta.fechar();
        else Escuta.descartar();
      }
    },

    gravar(agora) {
      try {
        Escuta.pedacos = [];
        Escuta.rec = new MediaRecorder(Escuta.stream);
        Escuta.rec.ondataavailable = function (e) { if (e.data.size) Escuta.pedacos.push(e.data); };
        Escuta.rec.onstop = function () {
          var blob = new Blob(Escuta.pedacos, { type: Escuta.rec.mimeType || 'audio/webm' });
          if (Escuta.enviando) { Escuta.enviando = false; Escuta.transcrever(blob); }
        };
        Escuta.rec.start();
        Escuta.armado = true;
        Escuta.inicio = Escuta.ultimaVoz = agora;
        painel('ESCUTANDO', 'quente');
      } catch (e) {
        log('erro', 'VOZ', 'gravador falhou: ' + String(e).slice(0, 60));
        Escuta.armado = false;
      }
    },

    fechar() {
      Escuta.armado = false;
      Escuta.enviando = true;
      painel('TRANSCREVENDO', 'quente');
      try { Escuta.rec.stop(); } catch (e) { Escuta.enviando = false; }
    },

    descartar() {
      Escuta.armado = false;
      Escuta.enviando = false;
      try { if (Escuta.rec && Escuta.rec.state === 'recording') Escuta.rec.stop(); } catch (e) {}
      painel(Escuta.on ? 'OUVINDO' : 'PRONTO', Escuta.on ? 'quente' : '');
    },

    async transcrever(blob) {
      try {
        var res = await fetch('/api/listen', {
          method: 'POST', headers: BMX.headers({ 'content-type': blob.type || 'audio/webm' }), body: blob
        });
        var dados = await res.json();
        var texto = (dados && dados.text || '').trim();
        if (!res.ok || texto.replace(/[^\p{L}\p{N}]/gu, '').length < 2) {
          painel('OUVINDO', 'quente');
          return;
        }
        log('nota', 'VOZ', 'ouvi: "' + texto + '"');
        await BMX.enviar(texto);
      } catch (e) {
        log('erro', 'VOZ', 'transcrição falhou: ' + String(e).slice(0, 70));
      }
      painel(Escuta.on ? 'OUVINDO' : 'PRONTO', Escuta.on ? 'quente' : '');
    }
  };

  global.BMXVoz = {
    falar: falar,
    falarIntro: falarIntro,
    semTags: semTags,
    alternarEscuta: function () { if (Escuta.on) Escuta.desligar(); else Escuta.ligar(); },
    escutando: function () { return Escuta.on; },
    falando: function () { return Voz.falando; },
    retomarEscuta: function () { Escuta.retomar(); }
  };
})(window);
