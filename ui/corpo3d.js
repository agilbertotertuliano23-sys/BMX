/* Corpo 3D do Painel do caso.
   As malhas vêm de models/anatomia (BodyParts3D 4.0 via Human Atlas, CC BY 4.0), exportadas por
   `python anatomia.py exportar`: camadas/<camada>.glb (corpo inteiro, um nó por malha) e
   regioes/<região>.glb (um nó por estrutura do catálogo, nome = id). Unidades em metros, Y para
   cima, corpo de frente para +Z, lado direito do paciente em X negativo.

   Padrão leve (RNF-04): só a pele translúcida + a região do caso. As outras camadas carregam
   quando a pessoa liga o botão. caso.js chama window.BMXCorpo.mostrar(...) a cada caso. */
import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js';

const BASE = 'models/anatomia/';
const canvas = document.getElementById('corpo');
const palco = document.getElementById('palco');
const camadaPontos = document.getElementById('pontos');
const avisoCarga = document.getElementById('carregando');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const cena = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.02, 40);
cena.add(new THREE.HemisphereLight(0xffffff, 0xd6e0ea, 1.5));
const chave = new THREE.DirectionalLight(0xffffff, 1.9);
chave.position.set(2, 4, 5);
cena.add(chave);
const recorte = new THREE.DirectionalLight(0xcfe9ff, 1.1);
recorte.position.set(-3, 2, -4);
cena.add(recorte);

const giro = new THREE.Group();      // o corpo gira aqui (arrastar)
cena.add(giro);
const loader = new GLTFLoader();

const camadas = {};                  // id -> { grupo, promessa, ligada, materiais }
let arquivosCamada = {};             // id -> caminho (vem do servidor)
let regiao = null;                   // { arquivo, grupo }
let estruturasVisiveis = new Set();
let pontos = [];                     // { id, nome, pos: Vector3, principal }
let isolado = null;
let fantasma = false;

const ALVO_CORPO = new THREE.Vector3(0, 0.88, 0);
const alvo = ALVO_CORPO.clone(), alvoSuave = ALVO_CORPO.clone();
let dist = 3.7, distSuave = 3.7, yaw = 0, yawSuave = 0;
let enquadramento = { alvo: ALVO_CORPO.clone(), dist: 3.7 };

/* ── carga ───────────────────────────── */
function carregar(rel) {
  return new Promise(function (ok, erro) { loader.load(BASE + rel, function (g) { ok(g.scene); }, undefined, erro); });
}

function prepararCamada(id, grupo) {
  const materiais = new Set();
  grupo.traverse(function (o) {
    if (!o.isMesh) return;
    if (id === 'pele') {
      // só a pele; cabelo, sobrancelha e unhas atrapalham a silhueta
      if (!/^skin$/i.test(o.userData.nome || '')) { o.visible = false; return; }
      o.material = new THREE.MeshStandardMaterial({
        color: 0xc8d3df, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false
      });
      o.renderOrder = 10;
    }
    materiais.add(o.material);
  });
  return materiais;
}

function aplicarFantasma() {
  // com a região aberta, o resto do corpo vira contexto: claro e transparente
  Object.keys(camadas).forEach(function (id) {
    const c = camadas[id];
    if (!c.materiais || id === 'pele') return;
    c.materiais.forEach(function (m) {
      m.transparent = fantasma;
      m.opacity = fantasma ? 0.12 : 1;
      m.depthWrite = !fantasma;
      m.needsUpdate = true;
    });
  });
}

function camada(id, ligar) {
  const arquivo = arquivosCamada[id];
  if (!arquivo) return Promise.resolve(false);
  let c = camadas[id];
  if (!c) {
    c = camadas[id] = { ligada: ligar, grupo: null, materiais: null };
    c.promessa = carregar(arquivo).then(function (g) {
      c.grupo = g;
      c.materiais = prepararCamada(id, g);
      g.visible = c.ligada;
      giro.add(g);
      aplicarFantasma();
      return true;
    });
  }
  c.ligada = ligar;
  if (c.grupo) c.grupo.visible = ligar;
  return c.promessa;
}

/* ── região do caso ──────────────────── */
async function carregarRegiao(arquivo) {
  if (regiao && regiao.arquivo === arquivo) return regiao.grupo;
  if (regiao) { giro.remove(regiao.grupo); regiao = null; }
  if (!arquivo) return null;
  const g = await carregar(arquivo);
  g.traverse(function (o) {
    if (!o.isMesh) return;
    o.material = o.material.clone();           // cada estrutura acende sozinha
    o.material.emissive = new THREE.Color(0xe0453a);
    o.material.emissiveIntensity = 0;
    o.material.roughness = 0.45;
  });
  giro.add(g);
  regiao = { arquivo: arquivo, grupo: g };
  return g;
}

function estilizarRegiao() {
  if (!regiao) return;
  regiao.grupo.traverse(function (o) {
    if (!o.isMesh) return;
    o.visible = estruturasVisiveis.has(o.name);
    const apagado = isolado && o.name !== isolado;
    o.material.transparent = !!apagado;
    o.material.opacity = apagado ? 0.18 : 1;
    o.material.depthWrite = !apagado;
    o.material.needsUpdate = true;
  });
}

function vec(p) { return p ? new THREE.Vector3(p[0], p[1], p[2]) : null; }

async function mostrar(d) {
  d = d || {};
  const lista = (d.estruturas || []).filter(function (e) { return e.centro; });
  estruturasVisiveis = new Set(lista.map(function (e) { return e.id; }));
  isolado = null;
  fantasma = lista.length > 0;
  aplicarFantasma();
  pontos = lista.map(function (e, i) {
    return { id: e.id, nome: e.nome, pos: vec((d.lado && e.lados && e.lados[d.lado]) || e.centro), principal: i === 0 };
  });
  desenharPontos();
  const r3 = d.regiao3d;
  if (r3 && r3.arquivo) {
    try { await carregarRegiao(r3.arquivo); } catch (e) { console.warn('[corpo] região não carregou', e); }
  } else if (regiao) { giro.remove(regiao.grupo); regiao = null; }
  estilizarRegiao();
  if (pontos.length) {
    const foco = pontos[0].pos.clone();
    const raio = (r3 && r3.raio) || 0.35;
    enquadramento = { alvo: new THREE.Vector3(foco.x * 0.5, foco.y, 0), dist: Math.min(3.6, Math.max(1.0, raio * 3.4)) };
  } else {
    enquadramento = { alvo: ALVO_CORPO.clone(), dist: 3.7 };
  }
  vista('regiao');
}

function isolar(id) {
  isolado = isolado === id ? null : id;
  estilizarRegiao();
  pontos.forEach(function (p, i) { p.principal = isolado ? p.id === isolado : i === 0; });
  desenharPontos();
  const p = pontos.find(function (x) { return x.id === isolado; });
  if (p) { alvo.set(p.pos.x * 0.6, p.pos.y, 0); dist = Math.max(0.8, enquadramento.dist * 0.75); }
  else vista('regiao');
  window.dispatchEvent(new CustomEvent('corpo:estrutura', { detail: { id: isolado } }));
}

function vista(qual) {
  if (qual === 'frente') { yaw = 0; alvo.copy(ALVO_CORPO); dist = 3.7; }
  else if (qual === 'costas') { yaw = Math.PI; alvo.copy(ALVO_CORPO); dist = 3.7; }
  else { yaw = 0; alvo.copy(enquadramento.alvo); dist = enquadramento.dist; }
}

/* ── pontos e linha-guia ─────────────── */
const guia = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
guia.setAttribute('class', 'guia');
guia.setAttribute('aria-hidden', 'true');
guia.innerHTML = '<path/><circle r="4"/>';
document.body.appendChild(guia);

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

function desenharPontos() {
  camadaPontos.innerHTML = pontos.map(function (p, i) {
    return '<div class="ponto' + (p.principal ? ' principal' : '') + '" data-i="' + i + '" title="' + esc(p.nome)
      + '"><span>' + esc(p.nome) + '</span></div>';
  }).join('');
  Array.prototype.forEach.call(camadaPontos.children, function (el) {
    el.onclick = function () { isolar(pontos[+el.dataset.i].id); };
  });
}

const tmp = new THREE.Vector3();
function atualizarPontos() {
  const caixa = canvas.getBoundingClientRect();
  let principal = null;
  pontos.forEach(function (p, i) {
    const el = camadaPontos.children[i];
    if (!el) return;
    tmp.copy(p.pos).applyMatrix4(giro.matrixWorld).project(camera);
    const x = (tmp.x + 1) / 2 * caixa.width, y = (1 - tmp.y) / 2 * caixa.height;
    const fora = tmp.z > 1 || x < 0 || y < 0 || x > caixa.width || y > caixa.height;
    el.style.display = fora ? 'none' : '';
    el.style.left = x.toFixed(1) + 'px';
    el.style.top = y.toFixed(1) + 'px';
    if (p.principal && !fora) principal = { x: caixa.left + x, y: caixa.top + y };
  });
  const cartao = document.getElementById('achado');
  const caminho = guia.firstChild, bola = guia.lastChild;
  const ret = cartao && cartao.getBoundingClientRect();
  if (principal && ret && ret.width && ret.left > principal.x + 40) {
    const fx = ret.left, fy = Math.min(Math.max(principal.y, ret.top + 40), ret.top + 120);
    const meio = (principal.x + fx) / 2;
    caminho.setAttribute('d', 'M' + principal.x + ' ' + principal.y + ' C' + meio + ' ' + principal.y + ' '
      + meio + ' ' + fy + ' ' + fx + ' ' + fy);
    bola.setAttribute('cx', fx); bola.setAttribute('cy', fy);
    guia.style.display = '';
  } else guia.style.display = 'none';
}

/* ── interação: arrastar gira, roda aproxima, clique escolhe ── */
let arrastando = null;
canvas.addEventListener('pointerdown', function (e) {
  arrastando = { x: e.clientX, moveu: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', function (e) {
  if (!arrastando) return;
  const dx = e.clientX - arrastando.x;
  if (Math.abs(dx) > 2) arrastando.moveu = true;
  yaw += dx * 0.008;
  arrastando.x = e.clientX;
});
canvas.addEventListener('pointerup', function (e) {
  if (arrastando && !arrastando.moveu && regiao) {
    const caixa = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((e.clientX - caixa.left) / caixa.width * 2 - 1,
      -(e.clientY - caixa.top) / caixa.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const alvos = [];
    regiao.grupo.traverse(function (o) { if (o.isMesh && o.visible) alvos.push(o); });
    const hit = ray.intersectObjects(alvos, false)[0];
    if (hit) isolar(hit.object.name);
  }
  arrastando = null;
});
canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  dist = Math.min(5, Math.max(0.5, dist * (1 + e.deltaY * 0.001)));
}, { passive: false });
canvas.addEventListener('dblclick', function () { vista('regiao'); });

/* ── laço ────────────────────────────── */
function redimensionar() {
  const w = palco.clientWidth, h = palco.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(redimensionar).observe(palco);
redimensionar();

const reduz = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const relogio = new THREE.Clock();
function quadro() {
  const t = relogio.getElapsedTime();
  const k = reduz ? 1 : 0.12;
  yawSuave += (yaw - yawSuave) * k;
  distSuave += (dist - distSuave) * k;
  alvoSuave.lerp(alvo, k);
  giro.rotation.y = yawSuave;
  camera.position.set(alvoSuave.x, alvoSuave.y + distSuave * 0.06, alvoSuave.z + distSuave);
  camera.lookAt(alvoSuave);
  if (regiao) {
    const pulso = reduz ? 0.3 : 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t * 3));
    const principal = isolado || (pontos[0] && pontos[0].id);
    regiao.grupo.traverse(function (o) {
      if (o.isMesh) o.material.emissiveIntensity = o.name === principal ? pulso : 0.04;
    });
  }
  renderer.render(cena, camera);
  atualizarPontos();
  requestAnimationFrame(quadro);
}
requestAnimationFrame(quadro);

/* ── API para caso.js ────────────────── */
function configurar(lista) {
  arquivosCamada = {};
  (lista || []).forEach(function (c) { if (c.arquivo) arquivosCamada[c.id] = c.arquivo; });
  return camada('pele', true).then(function () { avisoCarga.hidden = true; })
    .catch(function (e) { avisoCarga.textContent = 'não consegui carregar o corpo 3D'; console.warn('[corpo]', e); });
}

window.BMXCorpo = {
  configurar: configurar, mostrar: mostrar, camada: camada, isolar: isolar, vista: vista,
  ligada: function (id) { return !!(camadas[id] && camadas[id].ligada); }
};
window.dispatchEvent(new CustomEvent('bmx:corpo-pronto'));
