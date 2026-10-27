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
/** true = Baymax desativado: no palco fica só a caixa de carregamento, fechada
    (models/baymax-caixa.glb); sem aceno, sem tela da barriga. false = o Baymax de sempre. */
const DESATIVADO = true;
/** a caixa fechada fica de frente para a câmera (0); gire em radianos para virá-la */
const GIRO_CAIXA = 0;
/** Baymax dentro da cabine, em metros da cabine. Medido com a pose de repouso aplicada
    (arquivo: x = lado, y = profundidade, z = altura 0…6,83; braços a ±2,55): com 0,18 ele
    tem 1,6 m, raio máximo 0,46 (parede interna em 0,641; os conectores do quadril, até 0,433,
    encostam nos braços) e a cabeça fica a ~0,55 m do teto (2,143). Pés na plataforma (y 0,369,
    sobre as marcas de apoio em z 0,06). */
const BAYMAX_NA_CAIXA = { escala: 0.18, pesY: 0.369, pesZ: 0.06 };

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
/* Solto, o braço abre pro lado (ombro -0,55). Na cabine isso atravessaria a porta aberta
   (0,79 m do centro; as dobradiças ficam a 0,685). Pose do aceno do filme (cotovelo baixo e
   para fora, antebraço quase vertical, palma de frente) ajustada ao vão da cabine, medida com a
   malha deformada e a porta aberta: mão a ~1,4 m (altura do queixo, 0,42 m do centro), braço a no
   máximo 0,72 m do centro, só roçando a dobradiça. */
/* Aceno do Baymax na cabine, a partir da prancha humana: o braço sobe junto ao corpo, com o ombro
   levando o cotovelo bem para a frente (1,0 rad, em direção à câmera) em vez de abri-lo para o lado;
   o antebraço fica vertical com a palma de frente (torção +1,57: o polegar do Baymax fica sobre a
   palma; com -1,57 aparecia o dorso da mão) e a mão à altura da cabeça. O "oi" é giratório: a mão
   gira em volta do antebraço (±0,65 rad) enquanto o cotovelo balança um quarto de volta defasado, de
   modo que a mão desenha um pequeno círculo. Medido com a malha deformada e a porta aberta: cotovelo
   a 0,34 m do centro, braço a no máximo 0,53 m, a ≥ 13 cm da porta e sem entrar no tronco nos
   extremos do balanço e da rotação. */
const ACENO = DESATIVADO ? [-0.6, 2.0, 1.57] : [-0.55, 1.95, -1.57];
/** balanço do ombro para a frente no aceno (rad); 0 = como antes */
const FRENTE_ACENO = DESATIVADO ? 1.0 : 0;
/** o ombro vira para a frente 3× mais rápido que o cotovelo sobe: assim o braço não bate na porta */
const FRENTE_ADIANTADA = DESATIVADO ? 3 : 1;
/** amplitude [ombro, cotovelo, torção], fase (rad) de cada junta e período (ms) do balanço da mão */
const BALANCO = DESATIVADO ? [0.04, 0.22, 0.65] : [0.035, 0.13, 0.06];
const BALANCO_FASE = DESATIVADO ? [0, -Math.PI / 2, 0] : [0, 0, 0];
const BALANCO_MS = DESATIVADO ? 1000 : 1150;
const braco = { d: REPOUSO.slice(), e: REPOUSO.slice() };   // d: x>0 (esquerda do Baymax) · e: x<0 (direita)
const uBracoD = { value: new THREE.Vector3() };
const uBracoE = { value: new THREE.Vector3() };
const uCabeca = { value: new THREE.Vector2() };   // [giro para os lados, inclinação]
const uPiscar = { value: 0 };                       // 0 olho aberto … 1 fechado
/* O braço do filme é mais grosso e o aceno vem para a frente (o ombro leva o cotovelo em
   direção à câmera), por isso o braço parece curto e redondo. Só na cabine: uGrosso incha o
   braço (menos a mão) e uFrente balança o ombro para a frente, em radianos [esquerda, direita]. */
const uFrente = { value: new THREE.Vector2() };
const uGrosso = { value: DESATIVADO ? 1.15 : 1 };

const POSE_GLSL = /* glsl */`
uniform vec3 uBracoD;
uniform vec3 uBracoE;
uniform vec2 uCabeca;
uniform vec2 uFrente;
uniform float uGrosso;
varying vec3 vObj;      // posição no arquivo (antes da pose): o desenho dos olhos é feito nela
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
  // braço mais grosso em volta do eixo dele (y=0, z=5.55), sem mexer na mão
  float kG = 1.0 + (uGrosso - 1.0) * smoothstep(1.6, 2.2, ax) * (1.0 - smoothstep(3.8, 4.3, ax)) * wY;
  p.y *= kG; p.z = 5.55 + (p.z - 5.55) * kG;
  // Torção, dobra e ombro giram cada vértice por uma FRAÇÃO do ângulo (não misturam a posição girada
  // com a parada), senão a seção do braço encolhe e a malha se dobra para dentro no cotovelo.
  // A torção vai crescendo ao longo do antebraço (do cotovelo ao pulso) e a dobra usa uma zona larga.
  float wT = smoothstep(3.0, 4.4, ax) * wY;
  float wB = smoothstep(2.3, 3.9, ax) * wY;
  vec2 t = bmxRot(vec2(p.y, p.z - 5.4), a.z * wT);
  p.y = t.x; p.z = t.y + 5.4;
  n.yz = bmxRot(n.yz, a.z * wT);
  vec2 E = vec2(sinal * 3.15, 5.4);
  p.xz = bmxRot(p.xz - E, a.y * wB) + E;
  n.xz = bmxRot(n.xz, a.y * wB);
  vec2 S = vec2(sinal * 1.35, 5.4);
  p.xz = bmxRot(p.xz - S, a.x * wO) + S;
  n.xz = bmxRot(n.xz, a.x * wO);
  // balanço do ombro para a frente (eixo vertical): braço pendurado não muda, braço erguido vem para a câmera
  float fw = -sinal * (p0.x >= 0.0 ? uFrente.x : uFrente.y);
  p.xy = bmxRot(p.xy - vec2(sinal * 1.35, 0.0), fw * wO) + vec2(sinal * 1.35, 0.0);
  n.xy = bmxRot(n.xy, fw * wO);
}
`;

/* Olhos. Na textura eles são um ponto pequeno e borrado + traço, e em volta há o contorno do oval da
   textura, que aparece como um crescente cinza em cima de cada olho (as "sobrancelhas"). A malha dos
   olhos tem UV comprimido, então o desenho é feito pela posição 3D no arquivo (vObj: x = lado, y =
   profundidade, z = altura): a região dos olhos é apagada com a cor da pele e os olhos são redesenhados
   nítidos, como no logo do BMX (topo esquerdo): dois pontos pretos grandes ligados por um traço fino,
   cor #14212e, na mesma proporção (ponto 0,18 da distância entre os olhos; traço 0,2 do diâmetro).
   Olhos em (±0,231; z 6,357). A piscada achata só os pontos (até 8% da altura), como no logo. */
const PISCAR_GLSL = /* glsl */`
{
  const float XO = 0.231;          // meia distância entre os olhos
  const float ZO = 6.357;          // altura dos olhos
  const float RAIO = 0.08;         // raio do ponto (0,35 da meia distância... 0,18 da distância toda)
  const float TRACO = 0.016;       // meia espessura do traço
  float frente = 1.0 - smoothstep(-0.36, -0.30, vObj.y);          // só a frente do rosto
  // 1) apaga a região dos olhos (pontos, traço, sombra e o contorno do oval) com a cor da pele
  vec2 e = vec2(abs(vObj.x) / 0.47, (vObj.z - 6.46) / 0.37);
  float apaga = (1.0 - smoothstep(0.84, 1.0, length(e))) * frente;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.81, 0.82), apaga);
  // 2) desenha o olho do logo; piscando, o ponto vira uma elipse achatada
  float sy = max(1.0 - uPiscar * 0.92, 0.08);
  float aa = max(length(fwidth(vObj.xz)) * 0.7, 1e-4);
  float dPonto = (length(vec2(abs(vObj.x) - XO, (vObj.z - ZO) / sy)) - RAIO) * mix(sy, 1.0, 0.5);
  float dTraco = max(abs(vObj.z - ZO) - TRACO, abs(vObj.x) - XO);
  float tinta = (1.0 - smoothstep(-aa, aa, min(dPonto, dTraco))) * frente;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.007, 0.015, 0.027), tinta);
}
`;

function aplicarPose(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBracoD = uBracoD;
    shader.uniforms.uBracoE = uBracoE;
    shader.uniforms.uCabeca = uCabeca;
    shader.uniforms.uPiscar = uPiscar;
    shader.uniforms.uFrente = uFrente;
    shader.uniforms.uGrosso = uGrosso;
    shader.vertexShader = POSE_GLSL + shader.vertexShader
      .replace('#include <beginnormal_vertex>',
        'vec3 objectNormal = vec3( normal );\nvec3 bmxP = vec3( position );\nbmxPose( bmxP, objectNormal );')
      .replace('#include <begin_vertex>', 'vec3 transformed = bmxP;\nvObj = position;');
    shader.fragmentShader = 'uniform float uPiscar;\nvarying vec3 vObj;\n' + shader.fragmentShader
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
let acordado = false;                   // na cabine: só reage depois que as portas abrem e ele acorda
let proxyBaymax = null;                 // cilindro invisível onde os cliques "acertam" o Baymax
let baymaxCabine = null;                // o Baymax dentro da cabine (a cabine em si não se mexe)
const alvo = { x: 0, y: 0 };            // mouse normalizado -1..1

/* baymax-suave.glb: o mesmo modelo com subdivisão de Loop x2 (models/suavizar_glb.py),
   arredondado como o personagem; o original fica de reserva. */
const carregador = new GLTFLoader();
function carregarModelo(url, reserva) {
  carregador.load(url, DESATIVADO ? montarCaixa : montar, undefined, (err) => {
    if (reserva) { console.warn('[BMX] ' + url + ' falhou; usando ' + reserva, err); carregarModelo(reserva, null); }
    else console.warn('[BMX] não consegui carregar o modelo 3D', err);
  });
}
/* Abertura da cabine, depois que a interface abre e a caixa termina de subir:
   a câmera se aproxima do controlador da porta direita, segura um instante e então
   as portas abrem (±105° nas dobradiças, mesmo ângulo do arquivo do Blender) enquanto
   a câmera recua para enquadrar a cabine aberta. Tempos em ms, contados da entrada. */
const CABINE = { espera: 2400, aproxima: 1900, segura: 1000, abre: 2400, recua: 2800 };
const PORTA_ABERTA = 105 * Math.PI / 180;
/** ele acorda quando as portas já abriram 70% */
const ACORDA_EM = CABINE.espera + CABINE.aproxima + CABINE.segura + CABINE.abre * 0.7;
const cabine = { d: null, e: null, controle: null };
const camBase = camera.position.clone();
const camFoco = new THREE.Vector3(), camAlvo = new THREE.Vector3(), camPerto = new THREE.Vector3();

/** onde a câmera termina: rosto e tronco do Baymax (centro em y 1,2 m da cabine; ~1,3 m de altura visível) */
const ROSTO_CORPO = { centro: new THREE.Vector3(0, 1.2, BAYMAX_NA_CAIXA.pesZ), distancia: 4.8 };
const camBaymax = new THREE.Vector3(), alvoBaymax = new THREE.Vector3();

function animarCabine(ms) {
  const aAbre = CABINE.espera + CABINE.aproxima + CABINE.segura;
  let foco = 0;                                   // 0 = enquadramento normal … 1 = em cima do controlador
  if (ms >= CABINE.espera) foco = ms < aAbre ? suaveIO(Math.min(1, (ms - CABINE.espera) / CABINE.aproxima)) : 1;
  const aberta = ms < aAbre ? 0 : suaveIO(Math.min(1, (ms - aAbre) / CABINE.abre));
  const segue = ms < aAbre ? 0 : suaveIO(Math.min(1, (ms - aAbre) / CABINE.recua));   // do controlador para o Baymax
  if (cabine.d) cabine.d.rotation.y = aberta * PORTA_ABERTA;
  if (cabine.e) cabine.e.rotation.y = -aberta * PORTA_ABERTA;
  if (!cabine.controle || !modelo) return;
  cabine.controle.getWorldPosition(camFoco);      // acompanha o controlador enquanto a porta gira
  camAlvo.set(0, 0, 0).lerp(camFoco, foco);
  camPerto.copy(camFoco).add(new THREE.Vector3(-0.25, 0.1, 3.4));
  camera.position.lerpVectors(camBase, camPerto, foco);
  if (segue > 0) {                                // portas abrindo: a câmera vai do controlador ao rosto e corpo dele
    modelo.localToWorld(alvoBaymax.copy(ROSTO_CORPO.centro));
    camBaymax.copy(alvoBaymax).add(new THREE.Vector3(0, 0.05, ROSTO_CORPO.distancia));
    camera.position.lerp(camBaymax, segue);
    camAlvo.lerp(alvoBaymax, segue);
  }
  camera.lookAt(camAlvo);
}

if (DESATIVADO) carregarModelo('models/baymax-caixa.glb', null);
else carregarModelo('models/baymax-suave.glb', 'models/baymax.glb');

/* Baymax desativado: a caixa de carregamento (2,4 m × 1,6 m) ocupa o lugar dele.
   Mesma normalização do Baymax (centro no X/Z, base no chão, altura = ALTURA),
   sem pose no shader e sem tela da barriga (telaObj fica null). */
function montarCaixa(gltf) {
  modelo = gltf.scene;
  modelo.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
    // pivôs das portas (nas dobradiças) e a tela do controlador, que é filho da porta direita
    if (/PORTA.*DIREITA/.test(o.name)) cabine.d = o;
    else if (/PORTA.*ESQUERDA/.test(o.name)) cabine.e = o;
    else if (/Controle.*tela/.test(o.name)) cabine.controle = o;
  });
  const caixa = new THREE.Box3().setFromObject(modelo);
  const tam = caixa.getSize(new THREE.Vector3());
  const centro = caixa.getCenter(new THREE.Vector3());
  escalaBase = ALTURA / tam.y;
  modelo.position.set(-centro.x, -caixa.min.y, -centro.z);
  // o giro fica num grupo à parte para ser em volta do centro da caixa
  const giro = new THREE.Group();
  giro.add(modelo);
  giro.rotation.y = GIRO_CAIXA;
  corpo.add(giro);
  corpo.scale.setScalar(escalaBase);
  sombra = sombraContato(Math.max(tam.x, tam.z) * escalaBase * 1.5);
  sombra.position.y = 0.01;
  pivo.add(sombra);
  baseY = CENTRO_Y - ALTURA / 2;
  colocarBaymax('models/baymax-suave.glb', 'models/baymax.glb');
  // a luz fria do anel do teto (na prancha o interior brilha azul-claro) banha o Baymax por cima
  const luzInterior = new THREE.PointLight(0xbfe6ff, 0.7, 6, 1.5);
  luzInterior.position.set(0, 2.0, 0.2);
  modelo.add(luzInterior);
  ajusta();
  if (window.__bmxRevelado) entrar();
}

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

/* Ambiente de reflexo só do Baymax (na prancha de referência ele é de vinil branco liso e brilhante,
   com reflexos claros de caixas de luz e um fundo azulado vindo da iluminação interna da cabine).
   É um panorama pintado num canvas, convertido uma vez em mapa de reflexo. */
let ambienteBaymax = null;
function criarAmbienteBaymax() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.35, '#e3f3ff');
  grad.addColorStop(0.55, '#a9d6f2'); grad.addColorStop(0.78, '#4d6f8a'); grad.addColorStop(1, '#1d2e3d');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
  g.shadowColor = '#ffffff'; g.shadowBlur = 34; g.fillStyle = '#ffffff';
  [[96, 78], [416, 78], [256, 46]].forEach(([x, y]) => g.fillRect(x - 44, y - 24, 88, 48));
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const gerador = new THREE.PMREMGenerator(renderer);
  const env = gerador.fromEquirectangular(tex).texture;
  gerador.dispose(); tex.dispose();
  return env;
}

/** o Baymax desativado em pé na plataforma, braços ao longo do corpo, olhos fechados (ver quadro) */
function colocarBaymax(url, reserva) {
  carregador.load(url, (gltf) => {
    const b = gltf.scene;
    b.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material.side = THREE.FrontSide;
        if (o.material.map) o.material.map.anisotropy = 4;
        // vinil branco liso e brilhante, levemente frio, como na prancha (a textura original é cinza e fosca)
        ambienteBaymax = ambienteBaymax || criarAmbienteBaymax();
        o.material.envMap = ambienteBaymax;
        o.material.envMapIntensity = 0.45;
        o.material.roughness = 0.5;
        o.material.color.setRGB(1.0, 1.0, 1.02);
        aplicarPose(o.material);
        o.frustumCulled = false;
      }
    });
    b.scale.setScalar(BAYMAX_NA_CAIXA.escala);
    // a matriz do nó raiz do arquivo põe a altura em y e a frente em +z
    b.position.set(0, BAYMAX_NA_CAIXA.pesY, BAYMAX_NA_CAIXA.pesZ);
    modelo.add(b);
    baymaxCabine = b;
    // alvo invisível dos cliques: a pose é feita no shader, então a malha não serve para o raycast
    proxyBaymax = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.45, 1.25, 12), new THREE.MeshBasicMaterial({ visible: false }));
    proxyBaymax.position.set(0, BAYMAX_NA_CAIXA.pesY + 0.62, BAYMAX_NA_CAIXA.pesZ);
    modelo.add(proxyBaymax);
  }, undefined, (err) => {
    if (reserva) { console.warn('[BMX] ' + url + ' falhou; usando ' + reserva, err); colocarBaymax(reserva, null); }
    else console.warn('[BMX] não consegui carregar o Baymax da cabine', err);
  });
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
  if (DESATIVADO && !acordado) return;
  if (!modelo || entrada === null) { acenoPendente = true; return; }
  acenoDesde = performance.now();
}

/** alvo do braço que acena em cada instante (ms desde o início), ou null quando acabou */
function alvoAceno(ms) {
  if (ms < ACENO_SEGURA_MS) {
    if (reduz) return ACENO;
    // balanço do antebraço, entrando aos poucos para não dar tranco
    const entra = Math.min(1, ms / 450);
    const fase = ms / BALANCO_MS * Math.PI * 2;
    return [0, 1, 2].map((i) => ACENO[i] + BALANCO[i] * Math.sin(fase + BALANCO_FASE[i]) * entra);
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
  if (olharDesde === null && agora >= olharEm && estado === 'ocioso' && acenoDesde === null && !reduz && !DESATIVADO) {
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

/* ── Baymax na cabine: acorda e reage ────────────────────────────────────
   Dorme (olhos fechados, cabeça pendida) até as portas quase terminarem de abrir; aí abre
   os olhos, levanta a cabeça e acena. Depois: a cabeça acompanha o mouse, o clique nele
   faz acenar de novo, pensando inclina a cabeça e falando balança de leve. */
let seguirX = 0, inclinaY = 0;
function acordar(agora, ergue, t) {
  const acorda = suaveIO(Math.min(1, Math.max(0, (agora - entrada - ACORDA_EM) / 700)));
  if (acorda <= 0) { uPiscar.value = 1; uCabeca.value.set(0, 0.08); return; }
  if (acorda >= 1 && !acordado) {
    acordado = true;
    acenar();
    window.dispatchEvent(new Event('bmx:cabine-aberta'));   // intro.js começa a falar agora
  }
  animarRosto(agora, ergue);
  uPiscar.value = Math.max(uPiscar.value, 1 - acorda);            // os olhos abrem
  seguirX = suave(seguirX, acordado ? alvo.x * 0.4 : 0, 0.08);    // olha para onde o mouse está
  const fala = estado === 'falando' ? Math.sin(t * 3.2) * 0.05 : 0;
  inclinaY = suave(inclinaY, (estado === 'pensando' ? 0.1 : 0) + 0.08 * (1 - acorda), 0.08);
  uCabeca.value.x += seguirX + fala;
  uCabeca.value.y += inclinaY;
}

const raio = new THREE.Raycaster(), ponto = new THREE.Vector2();
/** o ponteiro está sobre o Baymax (e não sobre um painel, botão ou campo da interface)? */
function sobreBaymax(e) {
  if (!proxyBaymax || !acordado) return false;
  if (e.target.closest && e.target.closest('button,a,input,textarea,select,.coluna,.barra,header,aside,#holo,#visaoCaso')) return false;
  ponto.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight * 2 - 1));
  raio.setFromCamera(ponto, camera);
  return raio.intersectObject(proxyBaymax).length > 0;
}
if (DESATIVADO) {
  let mao = false;
  window.addEventListener('pointermove', (e) => {
    const sobre = sobreBaymax(e);
    if (sobre !== mao) { mao = sobre; document.body.style.cursor = sobre ? 'pointer' : ''; }
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => { if (sobreBaymax(e) && acenoDesde === null) acenar(); });
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
  if (DESATIVADO) animarCabine(performance.now() - entrada);

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
  // na cabine a mola de segurar é mais dura para acompanhar o balanço da mão sem amortecer
  passoMola(molaE, alvoE, dt, segurando ? (DESATIVADO ? 14 : 8) : 9, segurando ? 0.9 : 0.68);
  const k = erguido();
  uFrente.value.set(0, Math.min(1, k * FRENTE_ADIANTADA) * FRENTE_ACENO);                     // o ombro leva o braço que acena para a frente
  braco.d = [repouso[0] + 0.05 * k, repouso[1], repouso[2]];   // o outro braço abre um tiquinho junto
  braco.e = molaE.pos;
  uBracoD.value.fromArray(braco.d);
  uBracoE.value.fromArray(braco.e);
  if (DESATIVADO) acordar(performance.now(), k, t);
  else animarRosto(performance.now(), k);

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
  if (DESATIVADO) {
    // na cabine, quem pende é só o Baymax (em volta dos pés); a cabine fica parada
    if (baymaxCabine) baymaxCabine.rotation.z = suave(baymaxCabine.rotation.z, incl, 0.08);
  } else pivo.rotation.z = suave(pivo.rotation.z, incl, 0.08);

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
  desativado: DESATIVADO,
  _dbg: () => ({ camera, modelo, baymaxCabine, cena, renderer }),  tela: (modo) => { tela.alvo = modo === 'off' ? 0 : 1; tela.pulso = modo === 'pulso'; },
  /** centro e largura da tela da barriga em pixels da janela, ou null antes do modelo */
  ancora: () => {
    if (DESATIVADO && proxyBaymax && entrada !== null) {          // na cabine: o peito do Baymax
      proxyBaymax.getWorldPosition(v1);
      const c = paraTela(proxyBaymax, v1), b = paraTela(proxyBaymax, v2.copy(v1));
      return { x: c.x, y: c.y, w: 90 };
    }
    if (!telaObj || entrada === null) return null;
    const c = paraTela(telaObj.ancora, v1), b = paraTela(telaObj.borda, v2);
    return { x: c.x, y: c.y, w: Math.abs(b.x - c.x) * 2 };
  }
};
window.dispatchEvent(new Event('bmx:3d-pronto'));
