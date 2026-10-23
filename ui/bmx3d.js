/* Baymax 3D atrás da interface.
   O GLB (models/baymax.glb, CC BY 4.0, Cartoon cat oficial) é uma malha única
   sem esqueleto e vem em pose T. Toda a vida vem daqui: a pose dos braços é
   feita no shader (ombro, cotovelo e torção do antebraço, por peso de vértice),
   a respiração infla o corpo, o olhar segue o mouse, ele acena ao abrir a tela
   e tem a tela da barriga, de onde sai o holograma da escala de dor
   (holograma.js lê a posição dela por window.BMX3D.ancora()).
   Entra subindo quando a intro libera (evento bmx:revelar). */
import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js';

/** altura do modelo em unidades de cena (a câmera enquadra ~5.4 de altura) */
const ALTURA = 4.7;
/** centro do modelo um pouco abaixo do meio: a cabeça fica no alto do palco */
const CENTRO_Y = -0.35;
/** gire 180° aqui (Math.PI) se o modelo aparecer de costas */
const GIRO_Y = 0;

const canvas = document.getElementById('bmx3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const cena = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0, 0.15, 10);
camera.lookAt(0, 0, 0);

// luz de estúdio clara: o vinil branco do Baymax precisa de forma, não de brilho
cena.add(new THREE.HemisphereLight(0xffffff, 0xcfe0ee, 1.5));
const chave = new THREE.DirectionalLight(0xffffff, 2.1);
chave.position.set(3.5, 5, 6);
cena.add(chave);
const recorte = new THREE.DirectionalLight(0xbdefff, 1.6);
recorte.position.set(-4.5, 3, -5);
cena.add(recorte);
const preenche = new THREE.DirectionalLight(0xffffff, 0.55);
preenche.position.set(-5, 0.5, 4);
cena.add(preenche);

const pivo = new THREE.Group();      // posição/entrada/olhar
const corpo = new THREE.Group();     // respiração (escala)
pivo.add(corpo);
cena.add(pivo);

// sombra de contato: um gradiente radial num plano, sem custo de shadow map
function sombraContato(largura) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(20,50,80,0.35)');
  grad.addColorStop(1, 'rgba(20,50,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const plano = new THREE.Mesh(
    new THREE.PlaneGeometry(largura, largura * 0.32),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  plano.rotation.x = -Math.PI / 2;
  return plano;
}

/* ── pose dos braços (no shader) ─────────────────────────────────────────
   Coordenadas do arquivo (antes da matriz do nó raiz): x = lado, z = altura,
   y = profundidade. Ombro em (±1.35, 5.4), cotovelo em x = ±3.15. Cada lado
   recebe [ombro, cotovelo, torção] em radianos, já no sentido "do lado"
   (o shader espelha o lado x<0). Números conferidos num protótipo em Python
   que renderiza a malha deformada antes de ir para cá. */
const REPOUSO = [-1.32, -0.22, 0];          // braços colados ao corpo, mãos no quadril (pose de referência)
const ACENO = [-0.55, 1.95, -1.57];          // cotovelo na altura do peito, palma de frente
const braco = { d: REPOUSO.slice(), e: REPOUSO.slice() };   // d: x>0 (esquerda do Baymax) · e: x<0 (direita)
const uBracoD = { value: new THREE.Vector3() };
const uBracoE = { value: new THREE.Vector3() };
const uCabeca = { value: new THREE.Vector2() };   // [giro para os lados, inclinação]
const uPiscar = { value: 0 };                       // 0 olho aberto … 1 fechado

const POSE_GLSL = /* glsl */`
uniform vec3 uBracoD;
uniform vec3 uBracoE;
uniform vec2 uCabeca;
vec2 bmxRot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
void bmxPose(inout vec3 p, inout vec3 n) {
  vec3 p0 = p;
  // cabeça: gira em volta do pescoço (y=6.0); o peso some antes dos ombros
  float wH = smoothstep(5.85, 6.3, p0.z) * (1.0 - smoothstep(0.75, 1.0, abs(p0.x)));
  p.xy = mix(p.xy, bmxRot(p.xy, uCabeca.x), wH);
  n.xy = bmxRot(n.xy, uCabeca.x * wH);
  vec2 rr = bmxRot(vec2(p.x, p.z - 6.0), uCabeca.y);
  p.x = mix(p.x, rr.x, wH); p.z = mix(p.z, rr.y + 6.0, wH);
  n.xz = bmxRot(n.xz, uCabeca.y * wH);
  // braços: os pesos vêm da posição original
  float sinal = p0.x >= 0.0 ? 1.0 : -1.0;
  vec3 a = (p0.x >= 0.0 ? uBracoD : uBracoE) * sinal;
  float ax = abs(p0.x);
  float wY = smoothstep(4.3, 4.8, p0.z);
  float wO = smoothstep(0.95, 1.75, ax) * wY;
  float wC = smoothstep(2.8, 3.5, ax) * wY;
  vec2 t = bmxRot(vec2(p.y, p.z - 5.4), a.z);
  p.y = mix(p.y, t.x, wC); p.z = mix(p.z, t.y + 5.4, wC);
  n.yz = bmxRot(n.yz, a.z * wC);
  vec2 E = vec2(sinal * 3.15, 5.4);
  p.xz = mix(p.xz, bmxRot(p.xz - E, a.y) + E, wC);
  n.xz = bmxRot(n.xz, a.y * wC);
  vec2 S = vec2(sinal * 1.35, 5.4);
  p.xz = mix(p.xz, bmxRot(p.xz - S, a.x) + S, wO);
  n.xz = bmxRot(n.xz, a.x * wO);
}
`;

/* Piscar: os olhos estão pintados na textura (um ponto preto + traço, espelhado
   para os dois lados do rosto, em uv 0.7678,0.8977, raio 0.0082). A pálpebra cor
   de vinil cobre o ponto de cima e de baixo até sobrar só o traço, amostrando a
   pele logo ao lado de cada ponto para manter a mesma sombra. */
const PISCAR_GLSL = /* glsl */`
#ifdef USE_MAP
if (uPiscar > 0.001) {
  const vec2 OC = vec2(0.7678, 0.8977);
  const float OR = 0.0111;
  const vec2 OL = vec2(-0.9837, 0.1799);
  const vec2 OP = vec2(-0.1799, -0.9837);
  vec2 dd = (vMapUv - OC) / OR;
  float al = dot(dd, OL), ac = dot(dd, OP);
  float disco = 1.0 - smoothstep(0.95, 1.15, length(dd));
  float aberto = max(1.0 - uPiscar, 0.12);
  float tampa = disco * smoothstep(aberto, aberto + 0.08, abs(ac));
  vec2 uvPele = OC + OL * al * OR + OP * sign(ac) * OR * 1.35;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * texture2D(map, uvPele).rgb, tampa);
}
#endif
`;

function aplicarPose(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBracoD = uBracoD;
    shader.uniforms.uBracoE = uBracoE;
    shader.uniforms.uCabeca = uCabeca;
    shader.uniforms.uPiscar = uPiscar;
    shader.vertexShader = POSE_GLSL + shader.vertexShader
      .replace('#include <beginnormal_vertex>',
        'vec3 objectNormal = vec3( normal );\nvec3 bmxP = vec3( position );\nbmxPose( bmxP, objectNormal );')
      .replace('#include <begin_vertex>', 'vec3 transformed = bmxP;');
    shader.fragmentShader = 'uniform float uPiscar;\n' + shader.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + PISCAR_GLSL);
  };
  material.customProgramCacheKey = () => 'bmx-pose';
  material.needsUpdate = true;
}

/* ── tela da barriga ─────────────────────────────────────────────────────
   Uma faixa curvada sobre o tronco (elipse medida na malha suavizada: centro
   z≈0.13, semieixos 1.63 × 1.55 em y=3.2, afinando para cima), com as barras
   azuis do filme. Liga antes do holograma sair. */
const SECAO = [ // altura, centro_z, semi_x, semi_z (medidos em baymax-suave.glb)
  [3.2, 0.125, 1.631, 1.547], [3.5, 0.132, 1.592, 1.515], [3.8, 0.121, 1.504, 1.460]];
function secao(y) {
  const i = y <= SECAO[1][0] ? 0 : 1;
  const a = SECAO[i], b = SECAO[i + 1], k = (y - a[0]) / (b[0] - a[0]);
  return [1, 2, 3].map((j) => a[j] + (b[j] - a[j]) * k);
}
const TELA_Y = 3.42, TELA_L = 1.3, TELA_A = 0.4;
const telaCanvas = document.createElement('canvas');
telaCanvas.width = 512; telaCanvas.height = 160;
const telaTex = new THREE.CanvasTexture(telaCanvas);
telaTex.colorSpace = THREE.SRGBColorSpace;
const tela = { alvo: 0, luz: 0, barras: 0, pulso: false };

function criarTela() {
  const geo = new THREE.PlaneGeometry(TELA_L, TELA_A, 24, 4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getY(i);
    const [cz, sx, sz] = secao(TELA_Y + v);
    const th = u / sz;
    p.setXYZ(i, sx * 1.012 * Math.sin(th), TELA_Y + v, cz + sz * 1.012 * Math.cos(th));
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    map: telaTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2
  });
  const malha = new THREE.Mesh(geo, mat);
  malha.renderOrder = 2;
  const [cz, sx, sz] = secao(TELA_Y);
  const ancora = new THREE.Object3D();
  ancora.position.set(0, TELA_Y, cz + sz * 1.02);
  const borda = new THREE.Object3D();
  borda.position.set(sx * Math.sin(TELA_L / 2 / sz), TELA_Y, cz + sz * Math.cos(TELA_L / 2 / sz));
  return { malha, ancora, borda };
}

function desenharTela(t) {
  const g = telaCanvas.getContext('2d');
  const W = telaCanvas.width, H = telaCanvas.height;
  g.clearRect(0, 0, W, H);
  // fundo branco luminoso, cantos bem redondos
  const grad = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W / 1.6);
  grad.addColorStop(0, 'rgba(255,255,255,0.98)');
  grad.addColorStop(1, 'rgba(225,246,255,0.75)');
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 46); g.fill();
  // alto-falante, como no filme
  g.fillStyle = '#2bb7e6';
  g.beginPath(); g.moveTo(70, 66); g.lineTo(84, 66); g.lineTo(100, 52); g.lineTo(100, 108); g.lineTo(84, 94); g.lineTo(70, 94); g.closePath(); g.fill();
  // barras
  const n = 10, x0 = 128, larg = 18, esp = 12;
  for (let i = 0; i < n; i++) {
    const acesa = i < Math.round(tela.barras * n);
    const brilho = tela.pulso && acesa ? 0.75 + 0.25 * Math.sin(t * 5 - i * 0.6) : 1;
    g.fillStyle = acesa ? `rgba(30,170,230,${brilho})` : 'rgba(150,200,225,0.35)';
    g.shadowColor = acesa ? 'rgba(43,196,232,0.9)' : 'transparent';
    g.shadowBlur = acesa ? 14 : 0;
    g.beginPath(); g.roundRect(x0 + i * (larg + esp), 38, larg, 84, 6); g.fill();
  }
  g.shadowBlur = 0;
  telaTex.needsUpdate = true;
}

/* ── modelo ──────────────────────────────────────────────────────────── */
let modelo = null, sombra = null, escalaBase = 1, baseY = 0, telaObj = null;
let estado = 'ocioso';
let entrada = null;                     // instante em que a subida começou
let acenoDesde = null, acenoPendente = false;
const alvo = { x: 0, y: 0 };            // mouse normalizado -1..1

/* baymax-suave.glb: o mesmo modelo com subdivisão de Loop x2 (models/suavizar_glb.py),
   arredondado como o personagem; o original fica de reserva. */
const carregador = new GLTFLoader();
function carregarModelo(url, reserva) {
  carregador.load(url, montar, undefined, (err) => {
    if (reserva) { console.warn('[BMX] ' + url + ' falhou; usando ' + reserva, err); carregarModelo(reserva, null); }
    else console.warn('[BMX] não consegui carregar o modelo 3D', err);
  });
}
carregarModelo('models/baymax-suave.glb', 'models/baymax.glb');

function montar(gltf) {
  modelo = gltf.scene;
  modelo.rotation.y = GIRO_Y;
  modelo.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material.side = THREE.FrontSide;
      if (o.material.map) o.material.map.anisotropy = 4;
      aplicarPose(o.material);
      o.frustumCulled = false;          // a pose muda a caixa da malha no shader
    }
  });
  // normaliza: centra no X/Z, pé no chão local, altura = ALTURA
  const caixa = new THREE.Box3().setFromObject(modelo);
  const tam = caixa.getSize(new THREE.Vector3());
  const centro = caixa.getCenter(new THREE.Vector3());
  escalaBase = ALTURA / tam.y;
  modelo.position.set(-centro.x, -caixa.min.y, -centro.z);
  telaObj = criarTela();
  modelo.add(telaObj.malha, telaObj.ancora, telaObj.borda);
  corpo.add(modelo);
  corpo.scale.setScalar(escalaBase);
  // a caixa ainda é da pose T (braços abertos): a sombra usa a largura do tronco
  sombra = sombraContato(3.6 * escalaBase);
  sombra.position.y = 0.01;
  pivo.add(sombra);
  baseY = CENTRO_Y - ALTURA / 2;
  ajusta();
  if (window.__bmxRevelado) entrar();
}

function entrar() {
  if (entrada !== null || !modelo) return;
  entrada = performance.now();
  canvas.classList.add('pronto');
  if (acenoPendente) { acenoPendente = false; acenar(); }
}
window.addEventListener('bmx:revelar', entrar);
window.addEventListener('bmx:estado', (e) => { estado = (e.detail && e.detail.estado) || 'ocioso'; });

window.addEventListener('pointermove', (e) => {
  alvo.x = (e.clientX / window.innerWidth) * 2 - 1;
  alvo.y = (e.clientY / window.innerHeight) * 2 - 1;
}, { passive: true });

function ajusta() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // tela em pé: afasta a câmera para o Baymax caber na largura
  const visivelL = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  camera.zoom = Math.min(1, visivelL / (ALTURA * 1.15));
  // o canvas cobre a janela inteira, mas o espaço livre é o palco (entre as colunas): leva o Baymax para o meio dele
  const palco = document.querySelector('.palco');
  const dx = palco ? palco.getBoundingClientRect().left + palco.clientWidth / 2 - w / 2 : 0;
  camera.setViewOffset(w, h, -dx, 0, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', ajusta);
ajusta();

/* ── aceno ───────────────────────────────────────────────────────────────
   Como no vídeo de referência: o braço SOBE RÁPIDO (~0,3 s) e passa um pouco do
   ponto, SEGURA a mão ao lado do rosto ~2,5 s com um balanço lento e pequeno,
   e DESCE RÁPIDO, assentando como vinil inflado. Quem dá a fluidez é uma mola
   (cada junta persegue o alvo); o alvo só troca de fase. */
const reduz = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Corpo em pose: sem respirar, quicar ao falar nem girar atrás do mouse. O aceno e
   a cabeça (olhar para os lados, piscar) continuam. false = volta ao movimento antigo. */
const CORPO_PARADO = true;
const suaveIO = (p) => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
const ACENO_SEGURA_MS = 2600;
const molaE = { pos: REPOUSO.slice(), vel: [0, 0, 0] };   // braço que acena (direito do Baymax)
let ultimoQuadro = 0;

function acenar() {
  if (!modelo || entrada === null) { acenoPendente = true; return; }
  acenoDesde = performance.now();
}

/** alvo do braço que acena em cada instante (ms desde o início), ou null quando acabou */
function alvoAceno(ms) {
  if (ms < ACENO_SEGURA_MS) {
    if (reduz) return ACENO;
    // balanço lento do antebraço, entrando aos poucos para não dar tranco
    const entra = Math.min(1, ms / 450);
    const f = Math.sin(ms / 1150 * Math.PI * 2);
    return [ACENO[0] + 0.035 * f * entra, ACENO[1] + 0.13 * f * entra, ACENO[2] + 0.06 * f * entra];
  }
  return ms < ACENO_SEGURA_MS + 1100 ? REPOUSO : null;
}

/** mola amortecida por junta: ω alto = rápido; ζ < 1 = passa um pouco do ponto e volta */
function passoMola(m, alvo, dt, w, z) {
  for (let i = 0; i < 3; i++) {
    const a = w * w * (alvo[i] - m.pos[i]) - 2 * z * w * m.vel[i];
    m.vel[i] += a * dt;
    m.pos[i] += m.vel[i] * dt;
  }
}

/** quanto o braço está erguido (0 repouso … 1 aceno): move corpo e cabeça junto */
function erguido() {
  return Math.min(1, Math.max(0, (molaE.pos[1] - REPOUSO[1]) / (ACENO[1] - REPOUSO[1])));
}

/* ── piscar e olhar para os lados ────── */
const sorteio = (a, b) => a + Math.random() * (b - a);
let piscarEm = 0, piscarDesde = null, piscarDuplo = false;
let olharEm = 0, olharDesde = null, olharLado = 1;

function valorPiscar(ms) {          // fecha em 70 ms, abre em 120 ms
  if (ms < 70) return ms / 70;
  if (ms < 190) return 1 - (ms - 70) / 120;
  return null;
}

/** olha para um lado, depois para o outro e volta ao centro (2,8 s) */
function valorOlhar(ms) {
  const G = 0.36 * olharLado;
  const k = [[0, 0], [520, G], [1100, G], [1850, -G * 0.85], [2350, -G * 0.85], [2800, 0]];
  for (let i = 1; i < k.length; i++) {
    if (ms <= k[i][0]) {
      const p = suaveIO((ms - k[i - 1][0]) / (k[i][0] - k[i - 1][0]));
      return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * p;
    }
  }
  return null;
}

function animarRosto(agora, ergue) {
  // piscar: a cada 2,5–6 s, às vezes duas vezes seguidas
  if (!piscarEm) piscarEm = agora + 1800;
  if (piscarDesde === null && agora >= piscarEm) {
    piscarDesde = agora;
    piscarDuplo = Math.random() < 0.25;
    piscarEm = agora + sorteio(2500, 6000);
  }
  uPiscar.value = 0;
  if (piscarDesde !== null) {
    const ms = agora - piscarDesde;
    let v = valorPiscar(ms);
    if (v === null && piscarDuplo) v = valorPiscar(ms - 260);
    if (v === null && (!piscarDuplo || ms > 520)) piscarDesde = null;
    uPiscar.value = Math.max(0, v || 0);
  }
  // cabeça: de tempos em tempos olha de um lado para o outro, só quando está ocioso
  if (!olharEm) olharEm = agora + 7500;     // depois do aceno e do holograma
  if (olharDesde === null && agora >= olharEm && estado === 'ocioso' && acenoDesde === null && !reduz) {
    olharDesde = agora;
    olharLado = Math.random() < 0.5 ? 1 : -1;
  }
  let giro = 0;
  if (olharDesde !== null) {
    const g = valorOlhar(agora - olharDesde);
    if (g === null) { olharDesde = null; olharEm = agora + sorteio(6500, 10000); } else giro = g;
  }
  // acenando, a cabeça inclina para o lado da mão
  uCabeca.value.set(giro, giro * 0.14 + 0.08 * ergue);
}

/* ── laço ────────────────────────────── */
const relogio = new THREE.Clock();
const suave = (a, b, k) => a + (b - a) * k;
const saida = (p) => 1 - Math.pow(1 - p, 3);

function quadro() {
  requestAnimationFrame(quadro);
  if (!modelo || entrada === null) return;
  const t = relogio.getElapsedTime();

  // subida de entrada: 1.4 s, de baixo e um pouco menor
  const p = Math.min(1, (performance.now() - entrada) / 1400);
  const e = saida(p);

  // respiração: mais rápida em alerta, mais funda falando
  const ritmo = estado === 'alerta' ? 2.4 : 1.25;
  const fundo = estado === 'falando' ? 0.016 : 0.01;
  const r = CORPO_PARADO ? 0 : Math.sin(t * ritmo);
  corpo.scale.set(
    escalaBase * (1 + r * fundo * 0.6),
    escalaBase * (1 + r * fundo),
    escalaBase * (1 + r * fundo * 0.6)
  );

  // braços: repouso balançando com a respiração; aceno com a mão direita, por mola
  // dt próprio: o getElapsedTime() acima já consome o delta do relógio
  const agoraMs = performance.now();
  const dt = Math.min(1 / 30, Math.max(0, (agoraMs - (ultimoQuadro || agoraMs)) / 1000));
  ultimoQuadro = agoraMs;
  const balanco = reduz ? 0 : r * 0.02;
  const repouso = [REPOUSO[0] + balanco, REPOUSO[1], REPOUSO[2]];
  let alvoE = repouso;
  if (acenoDesde !== null) {
    const a = alvoAceno(performance.now() - acenoDesde);
    if (a) alvoE = a === REPOUSO ? repouso : a; else acenoDesde = null;
  }
  // subindo e descendo: mola rápida que passa um pouco do ponto; parado no alto: macia
  const segurando = acenoDesde !== null && performance.now() - acenoDesde < ACENO_SEGURA_MS && performance.now() - acenoDesde > 400;
  // ω=9 → sobe/desce em ~250 ms, como no vídeo (conferido em simulação a 60 qps)
  passoMola(molaE, alvoE, dt, segurando ? 8 : 9, segurando ? 0.9 : 0.68);
  const k = erguido();
  braco.d = [repouso[0] + 0.05 * k, repouso[1], repouso[2]];   // o outro braço abre um tiquinho junto
  braco.e = molaE.pos;
  uBracoD.value.fromArray(braco.d);
  uBracoE.value.fromArray(braco.e);
  animarRosto(performance.now(), k);

  // tela da barriga: acende, enche as barras, pulsa enquanto o holograma está aberto
  tela.luz = suave(tela.luz, tela.alvo, 0.08);
  tela.barras = tela.alvo ? Math.min(1, tela.barras + 0.025) : Math.max(0, tela.barras - 0.04);
  if (telaObj) {
    telaObj.malha.material.opacity = tela.luz;
    telaObj.malha.visible = tela.luz > 0.01;
    if (telaObj.malha.visible) desenharTela(t);
  }

  let y = baseY - (1 - e) * 1.6;
  if (estado === 'falando' && !CORPO_PARADO) y += Math.abs(Math.sin(t * 5.2)) * 0.035;
  pivo.position.y = y;
  pivo.scale.setScalar(0.92 + 0.08 * e);

  // olhar: segue o mouse devagar; pensando, inclina a cabeça de leve
  const giroAlvo = CORPO_PARADO ? 0 : alvo.x * 0.32 + Math.sin(t * 0.35) * 0.05;
  pivo.rotation.y = suave(pivo.rotation.y, giroAlvo, 0.04);
  pivo.rotation.x = suave(pivo.rotation.x, CORPO_PARADO ? 0 : alvo.y * 0.05, 0.04);
  // pensando, inclina de leve; acenando, o corpo pende um pouco para o lado da mão
  const incl = (estado === 'pensando' && !CORPO_PARADO ? Math.sin(t * 1.6) * 0.035 + 0.03 : 0) + 0.035 * k;
  pivo.rotation.z = suave(pivo.rotation.z, incl, 0.08);

  if (sombra) sombra.material.opacity = 0.85 + r * 0.1;
  renderer.render(cena, camera);
}
quadro();

/* ── API para holograma.js ───────────── */
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
function paraTela(obj, v) {
  obj.getWorldPosition(v).project(camera);
  return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
}
window.BMX3D = {
  acenar: acenar,
  /** 'on' acende a tela da barriga; 'pulso' faz as barras respirarem; 'off' apaga */
  tela: (modo) => { tela.alvo = modo === 'off' ? 0 : 1; tela.pulso = modo === 'pulso'; },
  /** centro e largura da tela da barriga em pixels da janela, ou null antes do modelo */
  ancora: () => {
    if (!telaObj || entrada === null) return null;
    const c = paraTela(telaObj.ancora, v1), b = paraTela(telaObj.borda, v2);
    return { x: c.x, y: c.y, w: Math.abs(b.x - c.x) * 2 };
  }
};
window.dispatchEvent(new Event('bmx:3d-pronto'));
