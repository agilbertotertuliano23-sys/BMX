/* Intro do BMX (ver intro.css). Como o intro-entrada.ts do PROMETEUS: só age
   se o <head> pôs `html.intro-on`; espera a fonte, põe `html.intro-go`, fala a
   apresentação, avisa o 3D na hora da interface (bmx:revelar) e limpa no fim.

   A fala sai a cada recarga. Se o navegador bloquear áudio sem um clique
   (política de autoplay), voz.js mostra "Toque para ouvir" e fala no 1º toque. */
(function () {
  'use strict';

  // As três frases existem gravadas em ui/voz/falas (bmx0130, bmx0103, bmx0185): tocam na hora, com a
  // voz do Baymax, sem pedir nada ao servidor. Mudar o texto faz a frase ir para a voz sintetizada.
  var TEXTO = 'Olá! Eu sou Baymax, seu assistente pessoal de saúde. '
    + 'Numa escala de 1 a 10, como avalia a sua dor?';
  /** quando a interface começa a aparecer (= --i-ui) */
  var UI_MS = 3550;
  /** fim da sequência CSS (--i-ui + 1.3 s de entrada) + folga */
  var FIM_MS = 5100;
  /** a fala começa quando ele já subiu e ergue a mão para acenar (holograma.js
      acena 1.1 s depois de revelar); "…zero a dez" coincide com a escala saindo da barriga */
  var FALA_APOS_REVELAR_MS = 1000;
  /** não segura a intro esperando fonte lenta */
  var ESPERA_FONTE_MS = 800;

  var raiz = document.documentElement;

  // bmx3d.js é módulo (carrega depois): a flag cobre o caso de ele chegar tarde
  function revelar() { window.__bmxRevelado = true; window.dispatchEvent(new Event('bmx:revelar')); }
  function dizer() { if (window.BMXVoz) window.BMXVoz.falarIntro(TEXTO); }
  /** Baymax na cabine (bmx3d.js, DESATIVADO): só fala quando a cabine abre e ele acorda
      (evento bmx:cabine-aberta). Sem o aviso em 20 s, fala mesmo assim. */
  function falar() {
    if (!(window.BMX3D && window.BMX3D.desativado)) { dizer(); return; }
    var dito = false;
    function umaVez() { if (!dito) { dito = true; dizer(); } }
    window.addEventListener('bmx:cabine-aberta', umaVez, { once: true });
    setTimeout(umaVez, 20000);
  }

  if (!raiz.classList.contains('intro-on')) {
    // sem intro (movimento reduzido ou #sem-intro): interface direto, fala igual
    revelar();
    setTimeout(falar, FALA_APOS_REVELAR_MS);
    return;
  }

  function encerrar() {
    raiz.classList.remove('intro-on', 'intro-go');
    var el = document.querySelector('.intro');
    if (el) el.remove();
  }

  function iniciar() {
    window.scrollTo(0, 0);
    raiz.classList.add('intro-go');
    setTimeout(revelar, UI_MS);
    setTimeout(falar, UI_MS + FALA_APOS_REVELAR_MS);
    setTimeout(encerrar, FIM_MS);
  }

  var fonte = document.fonts && document.fonts.load
    ? document.fonts.load("900 1em 'Nunito'").catch(function () {})
    : Promise.resolve();
  var limite = new Promise(function (ok) { setTimeout(ok, ESPERA_FONTE_MS); });
  Promise.race([fonte, limite]).then(iniciar);
})();
