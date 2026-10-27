/* Holograma da escala de dor: sai da tela da barriga do Baymax.
   bmx3d.js dá a posição da tela na janela (window.BMX3D.ancora()); aqui o painel
   cresce a partir desse ponto, com um feixe de luz ligando a barriga ao painel.

   Abertura da tela (evento bmx:revelar): ele sobe, acena, a tela da barriga
   acende e a escala sai como holograma, junto com a pergunta falada.
   Depois reabre quando o BMX pergunta "de zero a dez" (app.js) ou pelo botão
   "Escala de dor" das Ações, e se recolhe quando a pessoa escolhe a nota. */
(function () {
  'use strict';

  var ACENO_MS = 1100;      // depois de revelar: dá tempo de ele terminar de subir
  var TELA_MS = 4200;       // o braço já desceu e assentou (aceno: 2,6 s no alto): a barriga acende
  var HOLO_MS = 4800;       // a escala sai junto com "Em uma escala de zero a dez…"
  var HOLO_CABINE_MS = 3800; // na cabine, contado da abertura (quando a fala começa)

  var holo = document.getElementById('holo');
  var painel = holo.querySelector('.holo-painel');
  var feixe = holo.querySelector('.holo-feixe polygon');
  var aberto = false, quadroId = null, fechando = null;

  function com3d(fn) {
    if (window.BMX3D) fn();
    else window.addEventListener('bmx:3d-pronto', fn, { once: true });
  }

  function posicionar() {
    var W = window.innerWidth, H = window.innerHeight;
    var a = window.BMX3D && window.BMX3D.ancora();
    var bx = a ? a.x : W / 2, by = a ? a.y : H * 0.55, bw = a ? Math.max(40, a.w) : 120;
    var pw = painel.offsetWidth, ph = painel.offsetHeight;
    var px = Math.min(Math.max(bx - pw / 2, 12), W - pw - 12);
    // o painel flutua acima da barriga, na altura do peito, sem subir para o topo
    var py = Math.max(by - ph - Math.max(36, H * 0.06), 76);
    painel.style.left = px + 'px';
    painel.style.top = py + 'px';
    painel.style.transformOrigin = (bx - px) + 'px ' + (by - py) + 'px';
    var base = py + ph - 2;
    feixe.setAttribute('points', [
      (bx - bw / 2) + ',' + by, (bx + bw / 2) + ',' + by,
      (px + pw - 28) + ',' + base, (px + 28) + ',' + base].join(' '));
    if (aberto) quadroId = requestAnimationFrame(posicionar);
  }

  function abrir() {
    if (aberto) return;
    clearTimeout(fechando);
    aberto = true;
    holo.hidden = false;
    holo.dataset.estado = 'abrindo';
    com3d(function () { window.BMX3D.tela('pulso'); });
    cancelAnimationFrame(quadroId);
    posicionar();
    // dois quadros: o navegador pinta o estado "abrindo" antes de animar para "aberto"
    requestAnimationFrame(function () { requestAnimationFrame(function () { holo.dataset.estado = 'aberto'; }); });
  }

  function fechar() {
    if (!aberto) return;
    holo.dataset.estado = 'fechando';
    fechando = setTimeout(function () {
      aberto = false;
      cancelAnimationFrame(quadroId);
      holo.hidden = true;
      holo.dataset.estado = 'fechado';
      com3d(function () { window.BMX3D.tela('off'); });
    }, 520);
  }

  function abertura() {
    com3d(function () {
      if (window.BMX3D.desativado) {
        // Baymax na cabine: sem barriga que acenda; a escala sai do peito dele, junto com a fala
        // (que começa quando a cabine abre), "…escala de 1 a 10" uns segundos depois
        window.addEventListener('bmx:cabine-aberta', function () { setTimeout(abrir, HOLO_CABINE_MS); }, { once: true });
        return;
      }
      setTimeout(function () { window.BMX3D.acenar(); }, ACENO_MS);
      setTimeout(function () { window.BMX3D.tela('on'); }, TELA_MS);
      setTimeout(abrir, HOLO_MS);
    });
  }

  document.getElementById('holoX').onclick = fechar;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fechar(); });
  window.addEventListener('resize', function () { if (aberto) posicionar(); });

  if (window.__bmxRevelado) abertura();
  else window.addEventListener('bmx:revelar', abertura, { once: true });

  window.BMXHolo = { abrir: abrir, fechar: fechar, aberto: function () { return aberto; } };
})();
