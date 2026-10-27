/* Materiais e objetos do "programa de materialização" do Atlas 3D (ui/atlas3d.js).

   A cena de referência (holograma de armadura, malha azul, sensor varrendo a peça) vira três coisas aqui:
   - materialSolido: a superfície só existe ATRÁS da linha do sensor (descarta o que está à frente) e brilha
     numa faixa azul logo atrás dela; também aceita brilho de encaixe (uFlash), alerta de problema (uAlert)
     e contorno holográfico (uHolo).
   - materialArame: a malha de triângulos da mesma geometria, acesa à frente do sensor e apenas um resíduo
     tênue atrás dele.
   - criarSensor: o anel azul com cortina de luz que sobe pela peça; criarBase: a plataforma holográfica.
   Tudo usa a posição no MUNDO (vWp), então vale para peças deslocadas na montagem. Eixo da varredura: Y. */
import * as THREE from 'three';

export const AZUL = new THREE.Color(0x35c8ff);
const AZUL_CLARO = new THREE.Color(0xbdf0ff);

/** Uniforms compartilhados pelo material sólido e pelo de arame de UMA peça. */
export function uniformesScanner() {
  return {
    uScan: { value: -1e3 },            // altura (Y do mundo) da linha do sensor; +1e3 = peça inteira revelada
    uBand: { value: 0.02 },            // largura do brilho atrás da linha
    uOn: { value: 0 },                 // 1 enquanto o sensor passa por esta peça
    uAxis: { value: new THREE.Vector3(0, 1, 0) },
    uCol: { value: AZUL.clone() },
    uHolo: { value: 0 },               // contorno holográfico (fresnel)
    uFlash: { value: 0 },              // brilho de encaixe/foco
    uFlashCol: { value: new THREE.Color(0x8fe3ff) },
    uAlert: { value: new THREE.Vector4(1, 0.2, 0.2, 0) },   // rgb + intensidade do alerta de problema
    uWireOn: { value: 0 },             // 0..1: liga a malha
    uAhead: { value: 0.3 },            // opacidade da malha à frente do sensor (aditiva: malha densa satura em branco)
    uResidual: { value: 0.05 }         // opacidade da malha atrás do sensor
  };
}

const VERT_DECL = '#include <common>\nvarying vec3 vWp;';
const VERT_USO = '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;';

export function materialSolido(cor, u) {
  const m = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.46, metalness: 0.06, transparent: true });
  m.onBeforeCompile = function (sh) {
    ['uScan', 'uBand', 'uOn', 'uAxis', 'uCol', 'uHolo', 'uFlash', 'uFlashCol', 'uAlert'].forEach(function (k) { sh.uniforms[k] = u[k]; });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', VERT_DECL)
      .replace('#include <project_vertex>', VERT_USO);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vWp;\n'
        + 'uniform float uScan; uniform float uBand; uniform float uOn; uniform float uHolo; uniform float uFlash;\n'
        + 'uniform vec3 uAxis; uniform vec3 uCol; uniform vec3 uFlashCol; uniform vec4 uAlert;')
      .replace('#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n'
        + 'float kS = dot(vWp, uAxis) - uScan;\n'
        + 'if (kS > 0.0) discard;')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n'
        + 'float behindS = 1.0 - smoothstep(0.0, max(uBand, 1e-4), -kS);\n'
        + 'totalEmissiveRadiance += uCol * behindS * 2.4 * uOn;\n'
        + 'float frS = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.2);\n'
        + 'totalEmissiveRadiance += uCol * frS * uHolo;\n'
        + 'totalEmissiveRadiance += uFlashCol * uFlash + uAlert.rgb * uAlert.a;');
  };
  return m;
}

export function materialArame(u) {
  const m = new THREE.MeshBasicMaterial({
    color: 0x4fd2ff, wireframe: true, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  m.onBeforeCompile = function (sh) {
    ['uScan', 'uAxis', 'uCol', 'uWireOn', 'uAhead', 'uResidual'].forEach(function (k) { sh.uniforms[k] = u[k]; });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', VERT_DECL)
      .replace('#include <project_vertex>', VERT_USO);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vWp;\n'
        + 'uniform float uScan; uniform float uWireOn; uniform float uAhead; uniform float uResidual;\n'
        + 'uniform vec3 uAxis; uniform vec3 uCol;')
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n'
        + 'float kW = dot(vWp, uAxis) - uScan;\n'
        + 'float aheadW = step(0.0, kW);\n'
        + 'float nearW = exp(-abs(kW) * 38.0);\n'
        + 'diffuseColor.rgb = mix(uCol, vec3(0.85, 0.98, 1.0), nearW);\n'
        + 'diffuseColor.a *= mix(uResidual, uAhead, aheadW) * uWireOn * (0.6 + 0.9 * nearW);');
  };
  return m;
}

/* ── o sensor: anel azul + cortina de luz que fica atrás da linha ─────────────────────────────── */
const CORTINA_FRAG = [
  'uniform vec3 uColor; uniform float uAlpha;',
  'varying float vY; varying vec2 vXZ;',
  'void main() {',
  '  float h = clamp(1.0 + vY / 0.4, 0.0, 1.0);',                    // 1 na linha, 0 no fim da cortina
  '  float seg = 0.7 + 0.3 * step(0.5, fract(atan(vXZ.y, vXZ.x) * 3.8197));',
  '  gl_FragColor = vec4(uColor, pow(h, 2.2) * 0.5 * seg * uAlpha);',
  '}'].join('\n');
const CORTINA_VERT = [
  'varying float vY; varying vec2 vXZ;',
  'void main() { vY = position.y; vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
].join('\n');

function aditivo(extra) {
  return Object.assign({ transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }, extra);
}
function linhas(pontos, cor, opacidade) {
  return new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pontos, 3)),
    new THREE.LineBasicMaterial(aditivo({ color: cor, opacity: opacidade })));
}
function liberar(g) {
  g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}

export function criarSensor() {
  const g = new THREE.Group();
  g.visible = false;
  const anel = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 128).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial(aditivo({ color: AZUL_CLARO })));
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1, 0.04, 8, 128).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial(aditivo({ color: AZUL, opacity: 0.28 })));
  const disco = new THREE.Mesh(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial(aditivo({ color: AZUL, opacity: 0.07, side: THREE.DoubleSide })));
  const cortina = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.4, 96, 1, true).translate(0, -0.2, 0), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: AZUL.clone() }, uAlpha: { value: 1 } }, vertexShader: CORTINA_VERT, fragmentShader: CORTINA_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false
  }));
  const marcas = [];                       // réguas radiais no disco
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2, r0 = i % 6 === 0 ? 0.9 : 0.95;
    marcas.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a), 0, Math.sin(a));
  }
  const reguas = linhas(marcas, AZUL, 0.6);
  g.add(disco, cortina, halo, anel, reguas);
  return {
    grupo: g,
    /** centro (x, z) e raio da varredura; y é a altura da linha */
    posicionar: function (cx, y, cz, raio) { g.position.set(cx, y, cz); g.scale.setScalar(raio); },
    mover: function (y) { g.position.y = y; },
    opacidade: function (v) {
      cortina.material.uniforms.uAlpha.value = v;
      anel.material.opacity = v; halo.material.opacity = 0.28 * v; disco.material.opacity = 0.07 * v; reguas.material.opacity = 0.6 * v;
    },
    girar: function (t) { reguas.rotation.y = t * 0.6; },
    dispose: function () { liberar(g); }
  };
}

/* ── a plataforma holográfica sob a peça ──────────────────────────────────────────────────────── */
export function criarBase() {
  const g = new THREE.Group();
  g.visible = false;
  const duplo = { side: THREE.DoubleSide };
  const aro = function (a, b, op) {
    return new THREE.Mesh(new THREE.RingGeometry(a, b, 128).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial(aditivo(Object.assign({ color: AZUL, opacity: op }, duplo))));
  };
  const miolo = new THREE.Mesh(new THREE.CircleGeometry(0.9, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial(aditivo(Object.assign({ color: 0x0b3a5c, opacity: 0.35 }, duplo))));
  const arcos = new THREE.Group();
  arcos.add(aro(0.985, 1.0, 0.9), aro(0.78, 0.79, 0.45), aro(0.52, 0.525, 0.3));
  const giratorio = new THREE.Group();     // marcas que giram devagar, como o aro de um scanner
  const seg = [];
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * Math.PI * 2, r0 = i % 8 === 0 ? 1.02 : 1.04;
    seg.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * 1.08, 0, Math.sin(a) * 1.08);
  }
  giratorio.add(linhas(seg, AZUL_CLARO, 0.8));
  g.add(miolo, arcos, giratorio, linhas([-1, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 1], AZUL, 0.25));
  return {
    grupo: g,
    posicionar: function (cx, y, cz, raio) { g.position.set(cx, y, cz); g.scale.setScalar(raio); },
    girar: function (t) { giratorio.rotation.y = -t * 0.25; arcos.rotation.y = t * 0.08; },
    dispose: function () { liberar(g); }
  };
}
