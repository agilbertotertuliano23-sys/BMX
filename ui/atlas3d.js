/* Motor 3D do Atlas de materialização (a direção e a interface ficam em atlas.js).

   Cada estudo é montado a partir de peças (uma malha por estrutura, no espaço do corpo: metros, Y para cima,
   corpo de frente para +Z, lado direito do paciente em X negativo) e passa por 5 estágios:
     scan()      o órgão principal é varrido por um sensor azul: a malha se acende, a superfície se fecha atrás
     ponto()     a câmera circula entre os pontos de atenção; partes internas são "reveladas" por mini-scans
     montagem()  as partes saem espalhadas e se encaixam em ordem, com brilho e anel no encaixe
     impacto*()  o problema nasce na origem, a energia viaja por conectores e acende o que é afetado
     corpo()     a câmera recua, a pele e o esqueleto são escaneados e a estrutura aparece no lugar certo
   Todas as animações são promessas (anim) que cancelar() resolve de uma vez; quem dirige (atlas.js) confere o
   "token" de rodada depois de cada await. Respeita prefers-reduced-motion (animações ~3x mais curtas, sem órbita). */
import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js';
import { uniformesScanner, materialSolido, materialArame, criarSensor, criarBase } from './scanner.js';

const BASE = 'models/anatomia/';
const V3 = THREE.Vector3;
const ZERO = new V3();
const reduz = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const ease = {
  io: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  out: function (t) { return 1 - Math.pow(1 - t, 3); },
  back: function (t) { const c = 1.15; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  lin: function (t) { return t; }
};
const clamp = THREE.MathUtils.clamp;

function texturaBrilho() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,190,120,0.85)'); g.addColorStop(1, 'rgba(255,90,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function criarPalco(el) {
  const canvas = el.querySelector('canvas');
  const camadaMarcas = el.querySelector('.atl-marcas');
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 60);
  cena.add(new THREE.HemisphereLight(0xcfe9ff, 0x0a1220, 1.35));
  const chave = new THREE.DirectionalLight(0xffffff, 2.1);
  chave.position.set(2, 4, 5);
  cena.add(chave);
  const recorte = new THREE.DirectionalLight(0x4cc9ff, 2.4);
  recorte.position.set(-3, 2, -4);
  cena.add(recorte);
  const mundo = new THREE.Group();
  cena.add(mundo);
  const sensor = criarSensor();
  const base = criarBase();
  cena.add(sensor.grupo, base.grupo);
  const loader = new GLTFLoader();
  const brilho = texturaBrilho();

  /* ── estado ──────────────────────────────────────────────────────────────────────────────── */
  const api = { aoQuadro: null, aoEscolher: null, aoMarca: null };
  let estudo = null, pecas = new Map(), corpoCtx = null;
  let impacto = null, efeitos = [];
  let tempo = 0, ativo = true, raf = 0, ultimo = 0, ultimoToque = -99, arrasto = null;
  const tweens = new Set();
  let gen = 0;                       // sobe a cada cancelar(): passo interrompido vê que mudou e para de mexer na cena
  const marcas = new Map();
  const cam = { alvo: new V3(0, 1.2, 0), raio: 2, az: 0.5, el: 0.2 };
  let orbita = reduz ? 0 : 0.15;
  let desvio = 0.07;                 // fração da altura reservada embaixo (legenda); atlas.js ajusta para telas estreitas

  /* ── animação ────────────────────────────────────────────────────────────────────────────── */
  function anim(dur, fn, ez, canal) {
    return new Promise(function (ok) {
      if (canal) tweens.forEach(function (t) { if (t.canal === canal) { tweens.delete(t); t.ok(); } });
      const d = reduz ? dur * 0.35 : dur;
      if (d <= 0) { fn(1, 1); ok(); return; }
      tweens.add({ t0: tempo, dur: d, fn: fn, ez: ez || ease.io, ok: ok, canal: canal || '' });
    });
  }
  function espera(s) { return anim(s, function () {}, ease.lin); }
  function cancelar() { gen++; tweens.forEach(function (t) { tweens.delete(t); t.ok(); }); }

  /* ── carga ───────────────────────────────────────────────────────────────────────────────── */
  const cacheGlb = new Map();
  function glb(rel) {
    if (!cacheGlb.has(rel)) cacheGlb.set(rel, new Promise(function (ok, erro) { loader.load(BASE + rel, function (g) { ok(g.scene); }, undefined, erro); }));
    return cacheGlb.get(rel);
  }

  function criarPeca(info, geo) {
    const u = uniformesScanner();
    const sol = new THREE.Mesh(geo, materialSolido(new THREE.Color(info.cor), u));
    const ar = new THREE.Mesh(geo, materialArame(u));
    sol.renderOrder = 2; ar.renderOrder = 3;
    sol.userData.peca = info.id;
    const g = new THREE.Group();
    g.add(sol, ar);
    g.visible = false;
    mundo.add(g);
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox.clone();
    const p = {
      info: info, g: g, sol: sol, ar: ar, u: u, box: box, centro: box.getCenter(new V3()), tam: box.getSize(new V3()),
      mostrar: false, oculta: false, revelada: false, opac: 1, pulso: 0, off: new V3(), alerta: null,
      verts: geo.attributes.position.count, tris: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3
    };
    pecas.set(info.id, p);
    return p;
  }

  async function carregar(e) {
    descarregar();
    estudo = e;
    const raizes = {};
    await Promise.all(Array.from(new Set(e.pecas.map(function (p) { return p.arquivo; }))).map(function (a) {
      return glb(a).then(function (r) { raizes[a] = r; }).catch(function (err) { console.warn('[atlas] malha não carregou', a, err); });
    }));
    e.pecas.forEach(function (info) {
      const raiz = raizes[info.arquivo];
      let malha = raiz && raiz.getObjectByName(info.id);
      if (malha && !malha.isMesh) { const m = malha; malha = null; m.traverse(function (o) { if (!malha && o.isMesh) malha = o; }); }
      if (malha && malha.geometry) criarPeca(info, malha.geometry);
    });
    return pecas.size;
  }

  function descarregar() {
    cancelar();
    limparExtras();
    pecas.forEach(function (p) { mundo.remove(p.g); p.sol.material.dispose(); p.ar.material.dispose(); });
    pecas = new Map();
    estudo = null;
    corpoLiberar();
    cacheGlb.forEach(function (pr) { pr.then(function (raiz) { raiz.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }, function () {}); });
    cacheGlb.clear();
    sensor.grupo.visible = base.grupo.visible = false;
  }

  /* ── utilidades de peça ──────────────────────────────────────────────────────────────────── */
  const papel = function (x) { return Array.from(pecas.values()).filter(function (p) { return p.info.papel === x; }); };
  const principais = function () { return papel('principal'); };
  const partes = function () { return papel('parte'); };
  const contextos = function () { return papel('contexto'); };
  const estudadas = function () { return Array.from(pecas.values()).filter(function (p) { return p.info.papel !== 'contexto'; }); };
  const caixa = function (p) { return p.box.clone().translate(p.g.position); };
  const centroDe = function (p) { return p.centro.clone().add(p.g.position); };
  function uniao(lista) { const b = new THREE.Box3(); lista.forEach(function (p) { b.union(caixa(p)); }); return b; }
  function opac(p, v) { p.opac = v; p.sol.material.opacity = v; p.sol.material.depthWrite = v > 0.9; p.sol.visible = v > 0.01; }
  function ehCasca(p) {
    const ps = partes();
    return ps.length > 0 && ps.filter(function (q) { return p.box.containsPoint(q.centro); }).length >= Math.ceil(ps.length / 2);
  }

  function esconder(p) {
    p.mostrar = false; p.revelada = false; p.g.position.set(0, 0, 0); p.pulso = 0; p.alerta = null;
    const u = p.u;
    u.uScan.value = -1e3; u.uOn.value = 0; u.uWireOn.value = 0; u.uHolo.value = 0; u.uFlash.value = 0; u.uAlert.value.w = 0;
    u.uAhead.value = 0.3; u.uResidual.value = 0.05;
    opac(p, 1);
  }
  function mostrarJa(p, o) {
    o = o || {};
    esconder(p);
    p.mostrar = true; p.revelada = true;
    p.u.uScan.value = 1e3;
    p.u.uWireOn.value = o.arame != null ? o.arame : 1;
    p.u.uHolo.value = o.holo || 0;
    opac(p, o.op != null ? o.op : 1);
  }

  function limparExtras() {
    marcas.forEach(function (m) { m.el.remove(); if (m.obj.parent) m.obj.parent.remove(m.obj); });
    marcas.clear();
    impactoLimpar();
    efeitos.forEach(function (f) { cena.remove(f.obj); f.obj.geometry.dispose(); f.obj.material.dispose(); });
    efeitos = [];
    sensor.grupo.visible = false;
  }
  function reset() {
    cancelar();
    limparExtras();
    pecas.forEach(esconder);
    corpoVisivel(false);
  }

  /* ── câmera ──────────────────────────────────────────────────────────────────────────────── */
  function posCamera() {
    const ce = Math.cos(cam.el);
    camera.position.set(cam.alvo.x + cam.raio * ce * Math.sin(cam.az), cam.alvo.y + cam.raio * Math.sin(cam.el), cam.alvo.z + cam.raio * ce * Math.cos(cam.az));
    camera.lookAt(cam.alvo);
  }
  function irPara(o, dur) {
    const a0 = cam.alvo.clone(), r0 = cam.raio, az0 = cam.az, el0 = cam.el;
    const a1 = o.alvo ? o.alvo.clone() : a0, r1 = o.raio != null ? o.raio : r0, el1 = o.el != null ? o.el : el0;
    const d = o.az != null ? ((o.az - az0 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI : (o.giro || 0);
    return anim(dur != null ? dur : 1.6, function (k) {
      cam.alvo.lerpVectors(a0, a1, k); cam.raio = r0 + (r1 - r0) * k; cam.az = az0 + d * k; cam.el = el0 + (el1 - el0) * k;
    }, ease.io, 'camera');
  }
  function enquadrar(box, folga) {
    const c = box.getCenter(new V3()), r = Math.max(box.getSize(new V3()).length() / 2, 0.01);
    const fv = THREE.MathUtils.degToRad(camera.fov), fh = 2 * Math.atan(Math.tan(fv / 2) * camera.aspect);
    return { alvo: c, raio: Math.max(r / Math.sin(Math.min(fv, fh) / 2) * (folga || 1.05), 0.18) };
  }
  function caixaFoco(lista) {
    if (estudo && estudo.foco && pecas.get(estudo.foco.comp)) {
      return new THREE.Box3().setFromCenterAndSize(centroDe(pecas.get(estudo.foco.comp)), new V3(1, 1, 1).multiplyScalar(estudo.foco.raio * 2));
    }
    return uniao(lista);
  }
  function enquadramentoInicial() {
    const e = enquadrar(caixaFoco(estudadas().length ? estudadas() : Array.from(pecas.values())), 1.1);
    cam.alvo.copy(e.alvo); cam.raio = e.raio; cam.az = 0.5; cam.el = 0.2;
  }

  /* ── marcadores 2D presos a pontos 3D ────────────────────────────────────────────────────── */
  function marca(chave, o) {
    desmarcar(chave);
    const obj = new THREE.Object3D();
    obj.position.copy(o.local || ZERO);
    (o.peca ? o.peca.g : mundo).add(obj);
    const e = document.createElement('div');
    e.className = 'atl-marca' + (o.classe ? ' m-' + o.classe : '');   // prefixo: caso.css tem .alerta, .ponto… que não podem pegar aqui
    const i = document.createElement('i'), b = document.createElement('b'), s = document.createElement('span');
    b.textContent = o.numero != null ? String(o.numero) : '';
    s.textContent = o.texto || '';
    e.append(i, b, s);
    if (o.clicavel) e.addEventListener('click', function () { if (api.aoMarca) api.aoMarca(chave); });
    camadaMarcas.appendChild(e);
    marcas.set(chave, { obj: obj, el: e, x: 0, y: 0, vis: false });
    return e;
  }
  function desmarcar(prefixo) {
    Array.from(marcas.keys()).forEach(function (k) {
      if (k === prefixo || k.indexOf(prefixo + ':') === 0 || (prefixo.slice(-1) === '*' && k.indexOf(prefixo.slice(0, -1)) === 0)) {
        const m = marcas.get(k);
        m.el.remove(); if (m.obj.parent) m.obj.parent.remove(m.obj);
        marcas.delete(k);
      }
    });
  }
  const tmp = new V3();
  function projetarMarcas() {
    const w = el.clientWidth, h = el.clientHeight;
    marcas.forEach(function (m) {
      tmp.setFromMatrixPosition(m.obj.matrixWorld).project(camera);
      m.x = (tmp.x + 1) / 2 * w; m.y = (1 - tmp.y) / 2 * h;
      m.vis = tmp.z < 1 && m.x > -20 && m.y > -20 && m.x < w + 20 && m.y < h + 20;
      m.el.style.display = m.vis ? '' : 'none';
      if (m.vis) m.el.style.transform = 'translate(' + m.x.toFixed(1) + 'px,' + m.y.toFixed(1) + 'px)';
    });
  }
  function posTela(chave) { const m = marcas.get(chave); return m && m.vis ? { x: m.x, y: m.y } : null; }
  const localDe = function (p, a) {
    a = a || [0, 0, 0];
    return new V3(p.centro.x + a[0] * p.tam.x / 2, p.centro.y + a[1] * p.tam.y / 2, p.centro.z + a[2] * p.tam.z / 2);
  };

  /* ── efeitos pontuais ────────────────────────────────────────────────────────────────────── */
  function pulsoAnel(pos, raio, cor, dur) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64),
      new THREE.MeshBasicMaterial({ color: cor, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.copy(pos);
    cena.add(m);
    const f = { obj: m };
    efeitos.push(f);
    return anim(dur || 1.1, function (k) {
      m.lookAt(camera.position); m.scale.setScalar(raio * (0.25 + 1.4 * k)); m.material.opacity = (1 - k) * 0.9;
    }, ease.out).then(function () {
      cena.remove(m); m.geometry.dispose(); m.material.dispose(); efeitos = efeitos.filter(function (x) { return x !== f; });
    });
  }
  function brilhar(p, forca, dur) {
    return anim(dur || 0.9, function (k) { p.u.uFlash.value = forca * (1 - k); });
  }

  /* ── varredura de um conjunto de peças (usada por scan, revelarParte e corpo) ────────────────── */
  async function varrer(lista, dur, o) {
    o = o || {};
    const g = gen;
    const b = uniao(lista), alt = Math.max(b.max.y - b.min.y, 0.02), banda = o.banda || Math.max(alt * 0.07, 0.006);
    const y0 = b.min.y - banda, y1 = b.max.y + banda * 0.5;
    // mapa do tempo para a altura: com `foco`, 80% do tempo é gasto dentro da janela visível
    let f0 = y0, f1 = y1;
    if (o.janela) { f0 = clamp(o.janela[0], y0, y1); f1 = clamp(o.janela[1], y0, y1); }
    const mapa = function (k) {
      if (f1 - f0 >= y1 - y0 - 1e-6) return y0 + (y1 - y0) * k;
      if (k < 0.1) return y0 + (f0 - y0) * (k / 0.1);
      if (k > 0.9) return f1 + (y1 - f1) * ((k - 0.9) / 0.1);
      return f0 + (f1 - f0) * ((k - 0.1) / 0.8);
    };
    const c = b.getCenter(new V3()), tam = b.getSize(new V3());
    const raio = (o.raio || Math.max(tam.x, tam.z) / 2 * 1.25) + 0.012;
    lista.forEach(function (p) {
      p.mostrar = true; p.u.uBand.value = banda; p.u.uScan.value = -1e3; p.u.uOn.value = 1; p.u.uWireOn.value = 1;
      p.u.uAhead.value = 0.3; p.u.uResidual.value = 0.05;
    });
    sensor.posicionar(c.x, y0, c.z, raio);
    sensor.opacidade(1);
    sensor.grupo.visible = true;
    await anim(dur, function (k) {
      const y = mapa(k);
      lista.forEach(function (p) { p.u.uScan.value = y; });
      sensor.mover(y);
      if (o.aoProgresso) o.aoProgresso(k);
    }, ease.io, o.canal);
    if (g !== gen) return;
    await anim(0.9, function (k) {
      lista.forEach(function (p) { p.u.uScan.value = 1e3; p.u.uOn.value = 1 - k; });
      sensor.opacidade(1 - k);
    }, ease.out);
    sensor.grupo.visible = false;
    lista.forEach(function (p) { p.revelada = true; });
  }

  function estatisticas(lista) {
    lista = lista || principais();
    const b = uniao(lista), t = b.getSize(new V3());
    return {
      verts: lista.reduce(function (s, p) { return s + p.verts; }, 0), tris: Math.round(lista.reduce(function (s, p) { return s + p.tris; }, 0)),
      dim: [t.x * 100, t.y * 100, t.z * 100], pecas: lista.length
    };
  }

  /* ── ESTÁGIO 1 · scan ───────────────────────────────────────────────────────────────────── */
  async function scan(aoProgresso) {
    reset();
    const g = gen;
    const lista = principais();
    if (!lista.length) return estatisticas(lista);
    lista.forEach(function (p) { opac(p, 1); });
    const b = uniao(lista), c = b.getCenter(new V3());
    const enq = enquadrar(caixaFoco(lista), 1.12);
    cam.alvo.copy(enq.alvo); cam.raio = enq.raio * 1.55; cam.az = 0.2; cam.el = 0.38;
    irPara({ alvo: enq.alvo, raio: enq.raio, giro: 1.5, el: 0.2 }, 6.2);
    const raioBase = Math.max(b.getSize(new V3()).x, b.getSize(new V3()).z) / 2 * 1.5 + 0.02;
    base.posicionar(c.x, b.min.y - 0.012, c.z, raioBase);
    base.grupo.visible = true;
    await espera(0.6);
    if (g !== gen) return estatisticas(lista);
    const janela = estudo && estudo.foco ? [caixaFoco(lista).min.y, caixaFoco(lista).max.y] : null;
    await varrer(lista, 4.4, { aoProgresso: aoProgresso, janela: janela, canal: 'scan' });
    return estatisticas(lista);
  }

  /* ── ESTÁGIO 2 · pontos de atenção ──────────────────────────────────────────────────────── */
  async function revelarParte(p) {
    opac(p, 1);
    await varrer([p], 1.4, { canal: 'parte' });
    brilhar(p, 0.7, 0.8);
  }

  async function ponto(pt, idx) {
    const p = pecas.get(pt.comp);
    if (!p) return;
    const g = gen;
    base.grupo.visible = true;
    const emCasca = p.info.papel !== 'principal';
    // quem não é o alvo vira contexto translúcido; um órgão que envolve a parte vira casca
    pecas.forEach(function (q) { q.pulso = 0; });
    const alvoOp = function (q) {
      if (q === p) return 1;
      if (q.info.papel === 'principal') return emCasca ? 0.18 : 0.3;
      return 0.2;
    };
    const de = new Map(), deArame = new Map();
    pecas.forEach(function (q) { if (q.mostrar) { de.set(q, q.opac); deArame.set(q, q.u.uWireOn.value); } });
    // as outras peças viram sombra: sem o arame delas por cima, a vista de perto não vira uma massa de linhas
    anim(0.8, function (k) {
      de.forEach(function (v, q) {
        opac(q, v + (alvoOp(q) - v) * k);
        const w = deArame.get(q), wa = q === p ? 1 : 0.06;
        q.u.uWireOn.value = w + (wa - w) * k;
      });
    }, ease.io, 'opac');

    // aproximação: sobre o ponto exato quando o roteiro marca um (a ≠ 0), senão sobre a peça inteira
    const local = localDe(p, pt.a);
    const centro = centroDe(p), ancora = local.clone().add(p.g.position);
    const exato = !!pt.a && (pt.a[0] !== 0 || pt.a[1] !== 0 || pt.a[2] !== 0);
    const zona = exato ? new THREE.Box3().setFromCenterAndSize(ancora, new V3(1, 1, 1).multiplyScalar(Math.max(p.tam.length() * 0.42, 0.05)))
      : caixa(p);
    const rp = enquadrar(zona, exato ? 1.1 : 1.18).raio * (pt.zoom || 1);
    base.grupo.visible = false;           // de perto, a base holográfica só atrapalha
    const lado = idx % 2 ? -1 : 1;
    const camP = irPara({ alvo: exato ? ancora : centro.clone().lerp(ancora, 0.3), raio: Math.max(rp, 0.14), giro: 0.8 * lado, el: 0.2 + 0.08 * (idx % 3) }, 2.2);
    desmarcar('ponto*');
    marca('ponto:' + idx, { peca: p, local: local, numero: idx + 1, classe: 'sel' });
    if (!p.revelada) await revelarParte(p); else p.mostrar = true;
    if (g !== gen) return;
    p.pulso = 0.16;
    await camP;
    if (g !== gen) return;
    pulsoAnel(ancora, clamp(rp * 0.1, 0.008, 0.05), 0xffb703, 1.3);   // anel âmbar no ponto observado
  }

  /* ── ESTÁGIO 3 · montagem ───────────────────────────────────────────────────────────────── */
  async function montagem(ordem, aoEncaixar) {
    reset();
    const g = gen;
    const lista = estudadas();
    const R = Math.max(uniao(lista).getBoundingSphere(new THREE.Sphere()).radius, 0.04);
    const C = uniao(lista).getCenter(new V3());      // centro do conjunto montado, antes de deslocar qualquer peça
    lista.forEach(function (p, i) {
      const dir = centroDe(p).sub(C);
      if (ehCasca(p)) dir.set(0, 1, 0);
      else if (dir.length() < R * 0.08) dir.set(Math.sin(i * 2.4), 0.35, Math.cos(i * 2.4));
      dir.normalize();
      p.off.copy(dir).multiplyScalar(ehCasca(p) ? R * 1.9 + p.tam.y / 2 : R * 1.15 + p.tam.length() * 0.35);
      p.g.position.copy(p.off);
      mostrarJa(p, { op: 0, arame: 0.5, holo: 1.1 });
      p.g.position.copy(p.off);
    });
    const exp = enquadrar(uniao(lista), 1.08);
    base.posicionar(exp.alvo.x, uniao(lista).min.y - R * 1.0, exp.alvo.z, R * 2.4);
    base.grupo.visible = true;
    irPara({ alvo: exp.alvo, raio: exp.raio, giro: 0.8, el: 0.24 }, 1.6);
    // entram aos poucos, ainda espalhadas
    lista.forEach(function (p) { anim(0.6, function (k) { opac(p, k); }, ease.out); });
    await espera(1.5);
    if (g !== gen) return;
    const seq = (ordem || []).filter(function (id) { return pecas.has(id) && lista.indexOf(pecas.get(id)) >= 0; });
    lista.forEach(function (p) { if (seq.indexOf(p.info.id) < 0) seq.push(p.info.id); });
    const fim = [];
    for (let i = 0; i < seq.length; i++) {
      const p = pecas.get(seq[i]), de = p.off.clone();
      fim.push(anim(1.05, function (k) { p.g.position.lerpVectors(de, ZERO, ease.back(k)); }, ease.lin).then(function () {
        if (g !== gen) return;
        p.g.position.set(0, 0, 0);
        brilhar(p, 1.0, 1.1);
        anim(0.7, function (k) { p.u.uHolo.value = 1.1 * (1 - k); p.u.uWireOn.value = 0.5 + 0.5 * k; });
        pulsoAnel(centroDe(p), Math.max(p.tam.length() / 2, 0.02) * 1.4, 0x6fd8ff, 1.1);
        marca('encaixe:' + p.info.id, { peca: p, local: p.centro.clone(), texto: p.info.nome, classe: 'chip' });
        setTimeout(function () { desmarcar('encaixe:' + p.info.id); }, 2300);
        if (aoEncaixar) aoEncaixar(p.info, i, seq.length);
      }));
      await espera(0.62);
      if (g !== gen) return;
    }
    await Promise.all(fim);
    if (g !== gen) return;
    // montagem pronta: casca vira vidro para mostrar o interior; o contexto aparece como sombra
    pecas.forEach(function (p) { p.u.uResidual.value = 0.05; p.u.uWireOn.value = 1; });
    const cascas = lista.filter(ehCasca);
    contextos().forEach(function (p) { mostrarJa(p, { op: 0, arame: 0 }); anim(1.0, function (k) { opac(p, 0.13 * k); }); });
    cascas.forEach(function (p) { anim(1.0, function (k) { opac(p, 1 - 0.7 * k); }); });
    const fin = enquadrar(uniao(lista), 1.12);
    irPara({ alvo: fin.alvo, raio: fin.raio, giro: 0.9, el: 0.2 }, 2.2);
    base.posicionar(fin.alvo.x, uniao(lista).min.y - 0.012, fin.alvo.z, Math.max(uniao(lista).getSize(new V3()).x, uniao(lista).getSize(new V3()).z) * 0.8 + 0.03);
    await espera(1.0);
  }

  /* ── ESTÁGIO 4 · impacto ────────────────────────────────────────────────────────────────── */
  function impactoLimpar() {
    if (!impacto) return;
    impacto.linhas.forEach(function (l) { cena.remove(l.linha); l.linha.geometry.dispose(); l.linha.material.dispose(); cena.remove(l.ponto); l.ponto.material.dispose(); });
    pecas.forEach(function (p) { p.alerta = null; p.u.uAlert.value.w = 0; });
    impacto = null;
  }

  function montado() {
    // estado "montagem pronta" sem animação, para quando se pula direto para o impacto
    const lista = estudadas();
    pecas.forEach(function (p) { mostrarJa(p, { op: p.info.papel === 'contexto' ? 0.13 : (ehCasca(p) ? 0.3 : 1), arame: p.info.papel === 'contexto' ? 0 : 0.6 }); });
    const b = uniao(lista);
    base.posicionar(b.getCenter(new V3()).x, b.min.y - 0.012, b.getCenter(new V3()).z, Math.max(b.getSize(new V3()).x, b.getSize(new V3()).z) * 0.8 + 0.03);
    base.grupo.visible = true;
    return b;
  }

  function impactoIniciar(prob) {
    reset();
    const b = montado();
    const o = pecas.get(prob.origem);
    if (!o) return;
    const afetadas = (prob.afeta || []).map(function (id) { return pecas.get(id); }).filter(Boolean);
    pecas.forEach(function (p) { if (p.info.papel === 'contexto') opac(p, 0.07); else opac(p, p === o ? 1 : 0.16); });
    o.u.uWireOn.value = 0.6;
    o.alerta = { base: 0, alvo: 0, amp: 0.18, fase: 0 };
    o.u.uAlert.value.set(1, 0.16, 0.2, 0);
    afetadas.forEach(function (a, i) {
      opac(a, 0.8);
      a.alerta = { base: 0, alvo: 0, amp: 0.12, fase: i * 1.3 };
      a.u.uAlert.value.set(1, 0.62, 0.1, 0);
    });
    // conectores origem -> afetada, com uma centelha que corre pela curva
    const co = centroDe(o), linhas = [];
    afetadas.forEach(function (a, i) {
      const ca = centroDe(a), meio = co.clone().lerp(ca, 0.5);
      meio.y += co.distanceTo(ca) * 0.35 + 0.01;
      const curva = new THREE.QuadraticBezierCurve3(co, meio, ca);
      const linha = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curva.getPoints(48)),
        new THREE.LineBasicMaterial({ color: 0xff8a4d, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      const ponto = new THREE.Sprite(new THREE.SpriteMaterial({ map: brilho, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      ponto.scale.setScalar(Math.max(co.distanceTo(ca) * 0.2, 0.025));
      cena.add(linha, ponto);
      linhas.push({ curva: curva, linha: linha, ponto: ponto, alvo: a, ativa: 0, fase: i * 0.37 });
    });
    impacto = { prob: prob, origem: o, afetadas: afetadas, linhas: linhas };
    const enq = enquadrar(uniao([o].concat(afetadas)), 1.18);
    irPara({ alvo: enq.alvo, raio: enq.raio, giro: 0.7, el: 0.22 }, 2.0);
    marca('origem', { peca: o, local: o.centro.clone(), texto: 'Origem · ' + o.info.nome, classe: 'alerta' });
    return afetadas.length;
  }

  /** k = 0: o problema nasce; k >= 1: a energia chega à k-ésima estrutura afetada */
  function impactoPasso(k) {
    if (!impacto) return;
    const o = impacto.origem, n = impacto.afetadas.length;
    if (k === 0 || !n) {
      o.alerta.alvo = 0.5;
      pulsoAnel(centroDe(o), Math.max(o.tam.length() / 2, 0.03) * 1.2, 0xff4a55, 1.4);
      brilhar(o, 0.8, 1.2);
      return;
    }
    const i = (k - 1) % n, a = impacto.afetadas[i], l = impacto.linhas[i], g = gen;
    l.ativa = 1;
    anim(0.9, function (t) { l.linha.material.opacity = 0.85 * t; });
    a.alerta.alvo = 0.42;
    o.alerta.alvo = 0.6;
    setTimeout(function () {
      if (g !== gen) return;
      pulsoAnel(centroDe(a), Math.max(a.tam.length() / 2, 0.03) * 1.2, 0xffa63c, 1.2);
      brilhar(a, 0.7, 1.0);
      marca('afetada:' + a.info.id, { peca: a, local: a.centro.clone(), texto: a.info.nome, classe: 'afetada' });
    }, reduz ? 0 : 700);
    const alvo = centroDe(a);
    irPara({ alvo: cam.alvo.clone().lerp(alvo, 0.3), giro: 0.5 }, 1.6);
  }
  function impactoFim() { desmarcar('origem'); desmarcar('afetada*'); impactoLimpar(); }

  /* ── ESTÁGIO 5 · corpo ──────────────────────────────────────────────────────────────────── */
  async function carregarCorpo() {
    if (corpoCtx) return corpoCtx;
    const uc = uniformesScanner();
    const pele = new THREE.Group(), ossos = new THREE.Group();
    const [rp, ro] = await Promise.all([glb('camadas/pele.glb'), glb('camadas/ossos.glb').catch(function () { return null; })]);
    const matPele = materialSolido(new THREE.Color(0x7fd0ff), uc);
    matPele.opacity = 0.2; matPele.depthWrite = false;
    rp.traverse(function (o) {
      if (o.isMesh && /^skin$/i.test(o.userData.nome || '')) { const m = new THREE.Mesh(o.geometry, matPele); m.renderOrder = 1; pele.add(m); }
    });
    const matOssos = materialSolido(new THREE.Color(0xdbeaf7), uc);
    matOssos.opacity = 0.32; matOssos.depthWrite = false;
    if (ro) ro.traverse(function (o) { if (o.isMesh) { const m = new THREE.Mesh(o.geometry, matOssos); m.renderOrder = 1; ossos.add(m); } });
    pele.visible = ossos.visible = false;
    cena.add(pele, ossos);
    corpoCtx = { u: uc, pele: pele, ossos: ossos, matPele: matPele, matOssos: matOssos, feixe: null };
    return corpoCtx;
  }
  function corpoVisivel(on) {
    if (!corpoCtx) return;
    corpoCtx.pele.visible = corpoCtx.ossos.visible = on;
    if (corpoCtx.feixe) corpoCtx.feixe.visible = on;
  }
  function corpoLiberar() {
    if (!corpoCtx) return;
    cena.remove(corpoCtx.pele, corpoCtx.ossos);
    corpoCtx.matPele.dispose(); corpoCtx.matOssos.dispose();
    if (corpoCtx.feixe) { cena.remove(corpoCtx.feixe); corpoCtx.feixe.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    corpoCtx = null;
  }
  /** contexto opcional nos estágios 1-4: pele e esqueleto como sombra holográfica */
  async function contextoCorpo(on) {
    if (!on) { corpoVisivel(false); return false; }
    const c = await carregarCorpo();
    c.u.uScan.value = 1e3; c.u.uOn.value = 0; c.u.uHolo.value = 1.4;
    corpoVisivel(true);
    return true;
  }

  async function corpo(aoProgresso) {
    cancelar();
    limparExtras();
    const g = gen;
    const lista = estudadas();
    pecas.forEach(function (p) {
      if (p.info.papel === 'contexto') esconder(p); else mostrarJa(p, { op: ehCasca(p) ? 0.55 : 1, arame: 0 });
    });
    const c = await carregarCorpo();
    if (g !== gen) return;
    c.u.uScan.value = -1e3; c.u.uOn.value = 1; c.u.uHolo.value = 1.5; c.u.uBand.value = 0.06; c.u.uWireOn.value = 0;
    corpoVisivel(true);
    base.posicionar(0, 0.0, 0, 0.8);
    base.grupo.visible = true;
    irPara({ alvo: new V3(0, 0.95, 0), raio: 4.9, giro: 1.4, el: 0.14 }, 3.0);
    sensor.posicionar(0, -0.1, 0, 0.55);
    sensor.opacidade(1);
    sensor.grupo.visible = true;
    await anim(4.6, function (k) {
      const y = -0.1 + 2.1 * k;
      c.u.uScan.value = y; sensor.mover(y);
      if (aoProgresso) aoProgresso(k);
    }, ease.io, 'corpo');
    if (g !== gen) return;
    c.u.uScan.value = 1e3;
    await anim(0.8, function (k) { c.u.uOn.value = 1 - k; sensor.opacidade(1 - k); }, ease.out);
    if (g !== gen) return;
    sensor.grupo.visible = false;
    // sinalização: raio de luz até a estrutura e um anel no ponto exato
    const b = uniao(lista), ctr = b.getCenter(new V3());
    marca('corpo', { local: ctr.clone(), texto: estudo ? estudo.titulo : '', classe: 'corpo' });
    pulsoAnel(ctr, Math.max(b.getSize(new V3()).length() / 2, 0.05) * 1.5, 0xffc857, 1.6);
    lista.forEach(function (p) { p.pulso = 0.12; });
    await irPara({ alvo: ctr.clone().lerp(new V3(0, 0.95, 0), 0.45), raio: 3.1, giro: 0.9, el: 0.1 }, 3.0);
  }

  /* ── navegação a partir da interface ────────────────────────────────────────────────────── */
  function focar(id) {
    const p = pecas.get(id);
    if (!p || !p.mostrar) return;
    pecas.forEach(function (q) { q.pulso = 0; });
    p.pulso = 0.2;
    const enq = enquadrar(caixa(p), 1.3);
    irPara({ alvo: enq.alvo, raio: Math.max(enq.raio, 0.22), giro: 0.5 }, 1.2);
  }
  function alternar(id, on) { const p = pecas.get(id); if (p) p.oculta = !on; }
  function peca(id) { return pecas.get(id); }

  /* ── estado para saltar direto a um estágio ─────────────────────────────────────────────── */
  function estado(n) {
    reset();
    enquadramentoInicial();
    if (n >= 1) principais().forEach(function (p) { mostrarJa(p, { op: 1, arame: 1 }); });
    if (n >= 3) montado();
    base.posicionar(0, 0, 0, 0.3);
    const b = uniao(n >= 1 ? estudadas() : principais());
    if (!b.isEmpty()) base.posicionar(b.getCenter(new V3()).x, b.min.y - 0.012, b.getCenter(new V3()).z, Math.max(b.getSize(new V3()).x, b.getSize(new V3()).z) * 0.8 + 0.03);
    base.grupo.visible = n >= 1;
  }

  /* ── interação direta ───────────────────────────────────────────────────────────────────── */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  canvas.addEventListener('pointerdown', function (e) {
    arrasto = { x: e.clientX, y: e.clientY, moveu: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!arrasto) return;
    const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) arrasto.moveu = true;
    cam.az -= dx * 0.008; cam.el = clamp(cam.el + dy * 0.006, -1.2, 1.35);
    arrasto.x = e.clientX; arrasto.y = e.clientY; ultimoToque = tempo;
  });
  canvas.addEventListener('pointerup', function (e) {
    if (arrasto && !arrasto.moveu && api.aoEscolher) {
      const r = canvas.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const alvos = [];
      pecas.forEach(function (p) { if (p.mostrar && !p.oculta && p.opac > 0.3) alvos.push(p.sol); });
      const hit = ray.intersectObjects(alvos, false)[0];
      if (hit) api.aoEscolher(hit.object.userData.peca);
    }
    arrasto = null;
  });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    cam.raio = clamp(cam.raio * (1 + e.deltaY * 0.0012), 0.12, 9);
    ultimoToque = tempo;
  }, { passive: false });

  /* ── laço ───────────────────────────────────────────────────────────────────────────────── */
  function redimensionar() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.setViewOffset(w, h, 0, h * desvio, w, h);   // sobe o modelo um pouco: a legenda fica embaixo dele, não sobre ele
    camera.updateProjectionMatrix();
  }
  const olho = new ResizeObserver(redimensionar);
  olho.observe(el);
  redimensionar();

  function quadro(agora) {
    raf = requestAnimationFrame(quadro);
    if (!ativo) return;
    const dt = Math.min((agora - (ultimo || agora)) / 1000, 0.1);
    ultimo = agora;
    tempo += dt;
    tweens.forEach(function (t) {
      const k = Math.min(1, (tempo - t.t0) / t.dur);
      t.fn(t.ez(k), k);
      if (k >= 1) { tweens.delete(t); t.ok(); }
    });
    if (orbita && !arrasto && tempo - ultimoToque > 2.5) cam.az += orbita * dt;
    posCamera();
    // respiração do foco, alertas e centelhas
    pecas.forEach(function (p) {
      p.g.visible = p.mostrar && !p.oculta;
      if (p.pulso) p.u.uFlash.value = p.pulso * (0.5 + 0.5 * Math.sin(tempo * 3.2));
      if (p.alerta) {
        p.alerta.base += (p.alerta.alvo - p.alerta.base) * Math.min(1, dt * 3);
        p.u.uAlert.value.w = p.alerta.base > 0.01 ? p.alerta.base + p.alerta.amp * Math.sin(tempo * 4 + p.alerta.fase) * (p.alerta.base / 0.5) : 0;
      }
    });
    if (impacto) {
      impacto.linhas.forEach(function (l) {
        l.ponto.material.opacity = l.ativa ? 0.95 : 0;
        if (l.ativa) l.ponto.position.copy(l.curva.getPoint(((tempo * 0.55) + l.fase) % 1));
      });
    }
    sensor.girar(tempo); base.girar(tempo);
    if (corpoCtx && corpoCtx.feixe) corpoCtx.feixe.rotation.y = tempo * 0.4;
    mundo.updateMatrixWorld(true);
    renderer.render(cena, camera);
    projetarMarcas();
    if (api.aoQuadro) api.aoQuadro();
  }
  raf = requestAnimationFrame(quadro);

  Object.assign(api, {
    carregar: carregar, descarregar: descarregar, estado: estado, cancelar: cancelar, reset: reset,
    scan: scan, ponto: ponto, montagem: montagem,
    impactoIniciar: impactoIniciar, impactoPasso: impactoPasso, impactoFim: impactoFim, corpo: corpo,
    focar: focar, alternar: alternar, peca: peca, contextoCorpo: contextoCorpo, estatisticas: estatisticas,
    posTela: posTela, desmarcar: desmarcar,
    pausar: function (v) { ativo = !v; if (ativo) ultimo = 0; },
    orbitar: function (v) { orbita = reduz ? 0 : v; },
    deslocar: function (f) { desvio = f; redimensionar(); },
    enquadramentoInicial: enquadramentoInicial,
    destruir: function () { cancelAnimationFrame(raf); olho.disconnect(); descarregar(); sensor.dispose(); base.dispose(); renderer.dispose(); }
  });
  return api;
}
