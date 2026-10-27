/* BMX · front end (base: app.js do jarvis-claude-code).
   Fala com o servidor Python em NDJSON. O cérebro é o seu `claude` CLI, então
   tudo roda na sua assinatura. A voz mora em voz.js, o 3D em bmx3d.js. */
'use strict';

var $ = function (s) { return document.querySelector(s); };
var TOKEN = document.querySelector('meta[name=bmx-token]').content;
var headers = function (extra) { return Object.assign({ 'X-BMX-Token': TOKEN }, extra || {}); };
var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};
var agora = function () { return new Date().toTimeString().slice(0, 8); };

var grafo = null, ocultos = new Set(), rodando = false, ctl = null;
var resposta = '', bolhaBmx = null, DADOS = { nodes: [], links: [], hubs: [], counts: [] };

/* ── telemetria ───────────────────────── */
function log(tipo, rotulo, msg) {
  var e = document.createElement('div');
  e.className = 'e k-' + tipo;
  e.innerHTML = '<span class="t">' + agora() + '</span><span class="k">' + esc(rotulo) + '</span>'
    + (msg ? ' <span class="m">' + esc(msg) + '</span>' : '');
  var caixa = $('#log');
  caixa.insertBefore(e, caixa.firstChild);
  while (caixa.children.length > 50) caixa.removeChild(caixa.lastChild);
}

/* A voz do Fish lê [colchetes] como direção de fala e não os pronuncia. Na tela
   viram etiquetas; a voz do navegador recebe o texto sem elas (voz.js). */
var TAG_RE = /\[([^\][]{1,90})\]/g;
/* [atlas] é a decisão do BMX de levar a conversa ao atlas 3D: serve à interface, não aparece na tela nem vira "tom" */
var ATLAS_TAG = /^\s*atlas\s*$/i;
function ultimaTag(texto) {
  var achou = null, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(texto)) !== null) { if (!ATLAS_TAG.test(m[1])) achou = m[1]; }
  return achou;
}
/* *palavra* é ênfase para a voz (persona.md); na tela vira negrito, sem os asteriscos */
function enfase(htmlEscapado) {
  return htmlEscapado.replace(/\*\*?([^*\n]{1,60})\*\*?/g, '<strong>$1</strong>');
}
function renderFalado(el, texto) {
  var html = '', ultimo = 0, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(texto)) !== null) {
    html += enfase(esc(texto.slice(ultimo, m.index))) + (ATLAS_TAG.test(m[1]) ? '' : '<span class="tag">' + esc(m[1]) + '</span>');
    ultimo = m.index + m[0].length;
  }
  el.innerHTML = html + enfase(esc(texto.slice(ultimo)));
}

function bolha(quem, texto) {
  var vazio = $('#transcricao .vazio');
  if (vazio) vazio.remove();
  var b = document.createElement('div');
  b.className = 'bolha ' + quem;
  if (quem === 'bmx') renderFalado(b, texto); else b.textContent = texto;
  $('#transcricao').appendChild(b);
  var n = $('#transcricao').querySelectorAll('.bolha.eu').length;
  $('#contaTurnos').textContent = n ? n + (n === 1 ? ' mensagem' : ' mensagens') : '';
  $('#transcricao').scrollTop = $('#transcricao').scrollHeight;
  return b;
}

var ESTADOS = {
  ocioso: ['Olá.', 'Estou aqui para ajudar.'],
  pensando: ['Analisando…', 'consultando o seu prontuário'],
  falando: ['Falando', ''],
  alerta: ['Atenção', 'procure ajuda agora']
};
/* A frase sobre a cabeça do Baymax só aparece no começo: some quando a conversa começa (qualquer estado
   diferente de "ocioso") ou 8 s depois de a interface aparecer, e não volta. */
var estadoInicial = true;
function ocultarEstadoInicial() {
  if (!estadoInicial) return;
  estadoInicial = false;
  $('#estado').classList.add('oculto');
}
if (window.__bmxRevelado) setTimeout(ocultarEstadoInicial, 8000);
else window.addEventListener('bmx:revelar', function () { setTimeout(ocultarEstadoInicial, 8000); }, { once: true });

function setEstado(nome) {
  var e = ESTADOS[nome] || ESTADOS.ocioso;
  $('#estado b').textContent = e[0];
  $('#estado span').textContent = e[1];
  document.body.classList.toggle('pensando', nome === 'pensando');
  if (nome !== 'ocioso') ocultarEstadoInicial();
  window.dispatchEvent(new CustomEvent('bmx:estado', { detail: { estado: nome } }));
}

/* ── escala de dor (o quadro de rostos do Baymax) ── */
function corDor(n) { return 'hsl(' + Math.round(140 - n * 14) + ', 62%, ' + (n > 6 ? 48 : 42) + '%)'; }
function rostoDor(n) {
  var c = 1 - n / 5;                         // 1 sorri … -1 chora
  var boca = 'M8 18.5 Q13 ' + (18.5 + 4 * c).toFixed(1) + ' 18 18.5';
  var sobr = n >= 6 ? '<path d="M6.5 8 L10.5 9.5 M19.5 8 L15.5 9.5" stroke-width="1.4"/>' : '';
  var lagr = n >= 9 ? '<path d="M8.5 13 q-1 2 0 3 q1 -1 0 -3" fill="currentColor" stroke="none" opacity=".55"/>' : '';
  return '<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">'
    + '<circle cx="13" cy="13" r="11.5" stroke-width="1.4"/>'
    + '<circle cx="9" cy="11.5" r="1.4" fill="currentColor" stroke="none"/>'
    + '<circle cx="17" cy="11.5" r="1.4" fill="currentColor" stroke="none"/>'
    + sobr + lagr + '<path d="' + boca + '"/></svg>';
}
function montarDor() {
  var html = '';
  for (var n = 0; n <= 10; n++) {
    html += '<button data-n="' + n + '" style="--i:' + n + ';--c:' + corDor(n) + ';color:' + corDor(n) + '" title="Dor ' + n + ' de 10">'
      + rostoDor(n) + '<b>' + n + '</b></button>';
  }
  html += '<span class="legenda"><span>sem dor</span><span>pior dor</span></span>';
  $('#escalaDor').innerHTML = html;
  Array.prototype.forEach.call($('#escalaDor').querySelectorAll('button'), function (b) {
    b.onclick = function () {
      Array.prototype.forEach.call($('#escalaDor').querySelectorAll('button'), function (x) {
        x.classList.remove('sel'); x.style.color = x.style.getPropertyValue('--c');
      });
      b.classList.add('sel'); b.style.color = '#fff';
      enviar('/dor ' + b.dataset.n);
      // a nota foi dada: o holograma volta para a barriga
      setTimeout(function () { if (window.BMXHolo) window.BMXHolo.fechar(); }, 900);
    };
  });
}

/* ── ações ────────────────────────────── */
var ACOES = [
  ['Triagem', 'guiada, passo a passo', '/triagem'],
  ['Escala de dor', 'holograma de 0 a 10', '@dor'],
  ['Sintoma', 'anotar e avaliar', '/sintoma ', 'Ex.: dor de garganta desde ontem'],
  ['Alergia', 'anotar no prontuário', '/alergia ', 'Ex.: dipirona'],
  ['Remédio', 'em uso, com dose', '/medicamento ', 'Ex.: losartana 50 mg de manhã'],
  ['Condição', 'de saúde', '/condicao ', 'Ex.: hipertensão'],
  ['Consulta', 'resumo do médico', '/consulta ', 'Ex.: cardiologista pediu ecocardiograma'],
  ['Prontuário', 'buscar', '/prontuario ', 'O que procurar?'],
  ['Meta', 'de saúde', '/meta ', 'Ex.: beber dois litros de água por dia'],
  ['Nova conversa', 'recomeçar', '/novo'],
  ['Emergência', 'números úteis', '/emergencia', null, 'perigo']
];
/* símbolos das ações: traço simples, 24×24, pintados com a cor do texto */
var ICONE_ACAO = {
  'Triagem': '<path d="M9 4h6l1 2h3v14H5V6h3z"/><path d="M8.5 13l2.2 2.2 4.3-4.6"/>',
  'Escala de dor': '<circle cx="12" cy="12" r="9"/><path d="M8 14.5c1 1.4 2.4 2 4 2s3-.6 4-2"/><path d="M9 10h.01M15 10h.01"/>',
  'Sintoma': '<path d="M10 14.8V5a2 2 0 0 1 4 0v9.8a4 4 0 1 1-4 0z"/><path d="M12 9v6"/>',
  'Alergia': '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  'Remédio': '<path d="M10.5 20.5a4.95 4.95 0 0 1-7-7l10-10a4.95 4.95 0 0 1 7 7z"/><path d="M8.5 8.5l7 7"/>',
  'Condição': '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  'Consulta': '<path d="M5 6h14v14H5z"/><path d="M5 10h14M9 3v4M15 3v4"/>',
  'Prontuário': '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',
  'Meta': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  'Nova conversa': '<path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v5M9.5 10.5h5"/>',
  'Emergência': '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>'
};
function montarAcoes() {
  $('#matriz').innerHTML = ACOES.map(function (a, i) {
    return '<button data-i="' + i + '" class="' + (a[4] || '') + '" title="' + a[1] + '">'
      + '<i class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONE_ACAO[a[0]] || '') + '</svg></i>'
      + '<b>' + a[0] + '</b><span>' + a[1] + '</span></button>';
  }).join('');
  Array.prototype.forEach.call($('#matriz').children, function (b) {
    b.onclick = function () {
      var a = ACOES[+b.dataset.i];
      if (a[2] === '@dor') { if (window.BMXHolo) window.BMXHolo.abrir(); return; }
      if (a[3]) {
        $('#pergunta').value = a[2];
        $('#pergunta').placeholder = a[3];
        $('#pergunta').focus();
      } else enviar(a[2]);
    };
  });
}

/* ── prontuário (grafo) ───────────────── */
function montarFiltro() {
  var cores = {};
  DADOS.nodes.forEach(function (n) { cores[n.type] = n.colour; });
  $('#filtro').innerHTML = DADOS.counts.map(function (par) {
    return '<li data-t="' + esc(par[0]) + '" class="' + (ocultos.has(par[0]) ? 'off' : '') + '">'
      + '<i style="background:' + esc(cores[par[0]] || '#8a9bb0') + '"></i>' + esc(par[0])
      + ' <span class="ct">' + par[1] + '</span></li>';
  }).join('');
  Array.prototype.forEach.call($('#filtro').children, function (li) {
    li.onclick = function () {
      var t = li.dataset.t;
      if (ocultos.has(t)) ocultos.delete(t); else ocultos.add(t);
      grafo.setFilter(ocultos);
      montarFiltro();
    };
  });
}

/* o texto da nota vem em markdown do Obsidian: [[link]] vira só o nome e **negrito** vira negrito */
function notaLimpa(htmlEscapado) {
  return htmlEscapado.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function (_, alvo, rotulo) { return rotulo || alvo; })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function inspetor(no, trilha) {
  var caixa = $('#inspetor');
  if (!no) {
    $('#fichaTipo').textContent = 'prontuário';
    caixa.innerHTML = '<p class="dica">Toque numa nota do prontuário para ler aqui. Quando o BMX usa uma nota '
      + 'para responder, ela acende sozinha. Use <b>Alergia</b>, <b>Remédio</b> e <b>Condição</b> para o BMX '
      + 'levar sua ficha em conta.</p>';
    return;
  }
  $('#fichaTipo').textContent = no.type;
  var viz = (grafo.adj.get(no.id) || []).slice(0, 12);
  var html = '<div class="i-titulo">' + esc(no.title) + '</div>'
    + '<div class="i-meta">' + esc(no.type) + ' · ' + no.degree + ' ligações'
    + (no.updated ? ' · ' + esc(no.updated) : '') + '</div>'
    + '<div>' + notaLimpa(esc(no.snippet || 'Sem texto.')) + '</div>';
  if (trilha && trilha.length > 1) {
    html += '<div class="i-meta" style="margin-top:10px">caminho · ' + trilha.length + ' passos</div><div>'
      + trilha.map(function (id) { var n = grafo.byId.get(id); return esc(n ? n.title : id); }).join(' → ') + '</div>';
  }
  if (viz.length) {
    html += '<div class="chips">' + viz.map(function (id) {
      var n = grafo.byId.get(id);
      return '<span class="chip" data-id="' + esc(id) + '">' + esc(n ? n.title : id) + '</span>';
    }).join('') + '</div>';
  }
  caixa.innerHTML = html;
  Array.prototype.forEach.call(caixa.querySelectorAll('.chip'), function (c) {
    c.onclick = function () { grafo.setFocus(c.dataset.id, false); };
  });
}

async function carregarGrafo(forca) {
  try {
    var res = await fetch('/api/graph' + (forca ? '?force=1' : ''), { headers: headers() });
    DADOS = await res.json();
    grafo.setData(DADOS);
    montarFiltro();
    $('#contaNotas').textContent = DADOS.total + ' notas';
    setTimeout(function () { grafo.fit(); }, 350);
  } catch (e) { log('erro', 'PRONTUÁRIO', 'não carregou: ' + String(e).slice(0, 80)); }
}

function carregarStatus() {
  var p = fetch('/api/status', { headers: headers() }).then(function (r) { return r.json(); });
  p.then(function (s) {
    $('#pServidor').textContent = 'online :' + location.port;
    $('#dServidor').className = 'dot ok';
    var NOME_CEREBRO = { claude: 'Claude ' + String(s.version || '').split(' ')[0], anthropic: 'Claude API', gemini: 'Gemini' };
    var on = !!NOME_CEREBRO[s.runtime];
    $('#pCerebro').textContent = on ? NOME_CEREBRO[s.runtime] : 'offline';
    $('#pCerebro').title = s.model || '';
    $('#dCerebro').className = 'dot ' + (on ? 'ok' : 'erro');
    $('#pVoz').textContent = s.server_voice ? 'Fish Audio' : 'navegador pt-BR';
    $('#dVoz').className = 'dot ' + (s.server_voice ? 'ok' : 'aviso');
    $('#sModelo').textContent = s.model;
  }).catch(function () {
    $('#pServidor').textContent = 'offline';
    $('#dServidor').className = 'dot erro';
  });
  return p.catch(function () { return {}; });
}

/* ── alerta ───────────────────────────── */
function mostrarAlerta(ev) {
  $('#alertaTitulo').textContent = ev.title || 'Possível emergência';
  $('#alerta .alerta-txt span').textContent = ev.level === 'crise'
    ? 'Você não está sozinho. Tem gente pronta para ouvir agora.'
    : 'Ligue agora ou vá ao pronto-socorro mais próximo.';
  $('#alertaFones').innerHTML = (ev.phones || []).map(function (f) {
    return '<a href="tel:' + esc(String(f.number).replace(/\s+/g, '')) + '"><small>' + esc(f.name) + '</small>'
      + esc(f.number) + '</a>';
  }).join('');
  $('#alerta').hidden = false;
  document.body.classList.add('alerta-on');
  setEstado('alerta');
  log('alerta', 'ALERTA', (ev.title || '') + ' → ' + (ev.phones || []).map(function (f) { return f.number; }).join(' · '));
}
function fecharAlerta() {
  $('#alerta').hidden = true;
  document.body.classList.remove('alerta-on');
  if (!rodando) setEstado('ocioso');
}

/* ── painel do caso incorporado: o Baymax passa para o esquema do caso e volta ─────────────
   O painel (caso.html?incorporado=1, num iframe) cobre o centro e a coluna da direita; a conversa fica
   à esquerda. Enquanto o BMX fala, cada frase diz qual parte do painel destacar (nível, sinais, tempo,
   plano, ficha fixa, corpo). Aberto sozinho, o painel volta ao Baymax depois da fala; aberto à mão,
   só fecha à mão (botão, Esc ou o próprio botão do topo). */
var visaoCaso = $('#visaoCaso'), casoFrame = $('#casoFrame'), btnCaso = $('#btnCaso'), chkSeguir = $('#chkSeguir');
var casoIdAtual = null, abertoAuto = false, voltaTimer = null, casoFramePronto = false, focoPendente = null;
var SEGUIR_CHAVE = 'bmx-seguir';

/* Trava da entrada: enquanto o BMX pensa ou fala, a tela não aceita outra mensagem (campo, botões,
   microfone e o próprio enviar(), por onde passam as Ações, a escala de dor e a voz). Libera quando a
   fala termina, para as vozes não se atropelarem. */
var emFala = false, placeholderLivre = null;
function entradaBloqueada() {
  return !!(rodando || emFala || (window.BMXVoz && window.BMXVoz.falando && window.BMXVoz.falando()));
}
function atualizarEntrada() {
  var bloqueada = entradaBloqueada(), campo = $('#pergunta');
  if (bloqueada && placeholderLivre === null) placeholderLivre = campo.placeholder;
  campo.disabled = bloqueada;
  $('#btnEnviar').disabled = bloqueada;
  $('#btnMic').disabled = bloqueada;
  document.body.classList.toggle('entrada-travada', bloqueada);
  if (bloqueada) campo.placeholder = 'Aguarde o BMX terminar de falar…';
  else if (placeholderLivre !== null) { campo.placeholder = placeholderLivre; placeholderLivre = null; }
}
window.addEventListener('bmx:fala-inicio', atualizarEntrada);
window.addEventListener('bmx:fala-fim', atualizarEntrada);

/* O servidor só manda o evento de caso quando a mensagem tem sintoma; uma frase como "estou esperando a
   ambulância" não gera nenhum. Por isso o caso ativo também é perguntado ao abrir a página e antes de falar. */
function descobrirCaso() {
  return fetch('/api/caso', { headers: headers() }).then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.caso && d.caso.id) casoIdAtual = d.caso.id; mostrarBotaoAtlas(); })
    .catch(function () { /* sem caso: o painel não abre sozinho */ });
}
descobrirCaso();
function mostrarBotaoAtlas() { $('#btnAtlasAgora').hidden = !casoIdAtual; }

function podeIncorporar() { return true; }   // em tela estreita o painel abre por cima, em tela cheia (styles.css)
function casoAberto() { return document.body.classList.contains('modo-caso'); }
function enviarAoCaso(msg) {
  try { if (casoFrame.contentWindow) casoFrame.contentWindow.postMessage(msg, location.origin); } catch (e) { /* iframe ainda não existe */ }
}
window.addEventListener('message', function (e) {
  if (e.origin !== location.origin || e.source !== casoFrame.contentWindow || !e.data || e.data.t !== 'rascunho') return;
  var campo = $('#pergunta');
  campo.value = String(e.data.texto || '').slice(0, 500);
  campo.focus();
  campo.setSelectionRange(campo.value.length, campo.value.length);
});
function atualizarCaso() { if (casoFramePronto) enviarAoCaso({ t: 'atualizar', id: casoIdAtual }); }
function focarNoCaso(secao) {
  if (casoFramePronto) enviarAoCaso({ t: 'foco', secao: secao });
  else focoPendente = secao;
}
casoFrame.addEventListener('load', function () {
  casoFramePronto = true;
  if (focoPendente) {
    var s = focoPendente; focoPendente = null;
    setTimeout(function () { enviarAoCaso({ t: 'foco', secao: s }); }, 900);   // dá tempo de o painel desenhar
  }
});
function abrirCaso(auto) {
  if (!podeIncorporar()) { if (!auto) location.href = 'caso.html'; return; }
  clearTimeout(voltaTimer);
  if (!casoFrame.getAttribute('src')) casoFrame.src = 'caso.html?incorporado=1';
  if (!casoAberto()) abertoAuto = !!auto;           // quem abriu à mão fecha à mão
  document.body.classList.add('modo-caso');
  visaoCaso.setAttribute('aria-hidden', 'false');
  btnCaso.textContent = 'Voltar ao Baymax';
  atualizarCaso();
}
function voltarCaso() {
  clearTimeout(voltaTimer);
  abertoAuto = false;
  document.body.classList.remove('modo-caso');
  visaoCaso.setAttribute('aria-hidden', 'true');
  btnCaso.textContent = 'Explorar sintomas';
}
btnCaso.addEventListener('click', function (e) {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;   // abrir em outra aba continua valendo
  if (!podeIncorporar()) return;                                  // tela pequena: vai para a página inteira
  e.preventDefault();
  if (casoAberto()) voltarCaso(); else abrirCaso(false);
});
$('#btnVoltar').addEventListener('click', voltarCaso);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && casoAberto()) voltarCaso(); });
try { if (localStorage.getItem(SEGUIR_CHAVE) === 'off') chkSeguir.checked = false; } catch (e) { /* sem armazenamento */ }
chkSeguir.addEventListener('change', function () {
  try { localStorage.setItem(SEGUIR_CHAVE, chkSeguir.checked ? 'on' : 'off'); } catch (e) { /* sem armazenamento */ }
});

/* Conversa → atlas → painel: quem decide a hora é o BMX (a LLM). Quando ele termina a resposta com a marcação [atlas],
   o servidor manda o evento `atlas`; depois que a fala acaba, o atlas explica no corpo o que a pessoa contou e, ao fim,
   o painel do caso abre e fica aberto até a pessoa voltar ao Baymax. A mesma situação do caso não repete a aula.
   O botão "Mostrar no atlas 3D agora" abre a aula quando a pessoa quiser (`forcar`), sem esperar o BMX. */
var atlasPedido = false, aulasVistas = {};
function explicarNoAtlas(forcar) {
  if (!atlasPedido && !forcar) return;
  atlasPedido = false;
  if (!casoIdAtual || !window.BMXAtlas || window.BMXAtlas.aberto()) return;
  if (!forcar && !chkSeguir.checked) return;
  var cid = casoIdAtual;
  fetch('/api/atlas?caso=' + encodeURIComponent(cid), { headers: headers() })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (aula) {
      if (!aula || !aula.assinatura) return;
      if (!forcar && aulasVistas[cid] === aula.assinatura) return;           // nada novo para explicar
      aulasVistas[cid] = aula.assinatura;
      return window.BMXAtlas.abrirCaso(cid, function (motivo) {
        if (motivo === 'fechar') return;
        abrirCaso(false);
        if (motivo === 'remedios') focarNoCaso('remedios');                     // "Ver remédios" no fim da aula
        if (motivo === 'demo') setTimeout(function () { enviarAoCaso({ t: 'demo' }); }, casoFramePronto ? 900 : 3500);   // o painel começa a demonstração do contexto
      })
        .then(function (ok) { if (!ok) abrirCaso(false); });       // sem aula possível, vai direto ao painel
    })
    .catch(function () { /* sem atlas: a conversa segue normalmente */ });
}

/* ── o atendimento ────────────────────── */
async function enviar(mensagem) {
  mensagem = (mensagem || '').trim();
  if (!mensagem) return;
  if (/^\/limpar\b/i.test(mensagem)) {
    $('#transcricao').innerHTML = '<div class="vazio">Tela limpa. A conversa continua.</div>';
    $('#contaTurnos').textContent = '';
    return;
  }
  if (entradaBloqueada()) { log('nota', 'OCUPADO', 'o BMX ainda está respondendo ou falando — "' + mensagem.slice(0, 36) + '" não foi enviado'); return; }
  rodando = true;
  atualizarEntrada();
  resposta = '';
  var alertou = false;
  setEstado('pensando');
  if (grafo) grafo.setActivity(1);
  $('#tomAgora').textContent = '';
  bolha('eu', mensagem);
  bolhaBmx = bolha('bmx', '');
  bolhaBmx.classList.add('pensando');
  log('run', 'PERGUNTA', mensagem.slice(0, 70));

  var t0 = performance.now();
  try {
    ctl = new AbortController();
    var res = await fetch('/api/run', {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ message: mensagem, fresh: /^\/novo\b/i.test(mensagem) }),
      signal: ctl.signal
    });
    if (!res.ok) {
      var corpo = await res.json().catch(function () { return {}; });
      throw new Error(corpo.error || ('servidor HTTP ' + res.status));
    }
    var leitor = res.body.getReader(), dec = new TextDecoder(), buf = '';
    while (true) {
      var pedaco = await leitor.read();
      if (pedaco.done) break;
      buf += dec.decode(pedaco.value, { stream: true });
      var nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        var linha = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!linha) continue;
        var ev = JSON.parse(linha);
        if (ev.t === 'alert') alertou = true;
        evento(ev);
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') log('nota', 'CANCELADO', 'resposta interrompida');
    else { log('erro', 'ERRO', String(e.message || e).slice(0, 160)); bolhaBmx.textContent = String(e.message || e).slice(0, 200); }
  }
  ctl = null;
  rodando = false;
  emFala = !!resposta.trim();               // a fala vem a seguir: a entrada continua travada até ela terminar
  atualizarEntrada();
  if (emFala) setTimeout(function () {       // proteção: se a fala nunca começar, não deixa a entrada presa
    if (emFala && !(window.BMXVoz && window.BMXVoz.falando())) { emFala = false; atualizarEntrada(); }
  }, 20000);
  if (grafo) grafo.setActivity(0);
  bolhaBmx.classList.remove('pensando');
  if (!bolhaBmx.textContent.trim()) bolhaBmx.textContent = '…';
  $('#sLatencia').textContent = Math.round(performance.now() - t0) + ' ms';
  setEstado(alertou ? 'alerta' : 'ocioso');
  // o BMX pediu a nota da dor: a escala sai da barriga enquanto ele fala
  if (/de zero a dez|de 0 a 10|escala de dor/i.test(resposta) && window.BMXHolo) window.BMXHolo.abrir();
  if (resposta.trim()) {
    await descobrirCaso();
    try { await window.BMXVoz.falar(resposta.trim()); } finally { emFala = false; atualizarEntrada(); }
    explicarNoAtlas();                       // só abre se o BMX marcou [atlas] nesta resposta
  }
  else window.BMXVoz.retomarEscuta();
}

function evento(ev) {
  switch (ev.t) {
    case 'status':
      if (ev.session_id) $('#sSessao').textContent = ev.session_id.slice(0, 8);
      if (ev.model) $('#sModelo').textContent = ev.model;
      log('ok', 'CLAUDE', 'online · ferramentas=' + (ev.tools || 0) + ' · permissão=' + (ev.permission || '—'));
      break;
    case 'latency':
      $('#sLatencia').textContent = ev.ms + ' ms';
      log('nota', 'LATÊNCIA', 'primeira palavra em ' + ev.ms + ' ms');
      break;
    case 'tool':
      if (ev.phase === 'use') log('tool', 'FERRAMENTA', '→ ' + ev.name + '(' + (ev.input || '') + ')');
      else log('tool', 'FERRAMENTA', ev.ok === false ? '✗ erro' : '✓ ok');
      break;
    case 'focus':
      if (grafo.setFocus(ev.id, false)) log('mem', 'PRONTUÁRIO', 'usando → ' + ev.id);
      break;
    case 'graph':
      carregarGrafo(true);
      break;
    case 'alert':
      mostrarAlerta(ev);
      break;
    case 'delta':
      resposta += ev.text;
      renderFalado(bolhaBmx, resposta);
      var tag = ultimaTag(resposta);
      if (tag) $('#tomAgora').textContent = tag;
      $('#transcricao').scrollTop = $('#transcricao').scrollHeight;
      break;
    case 'usage':
      $('#sTokens').textContent = (ev.total_tokens || 0).toLocaleString('pt-BR');
      break;
    case 'note':
      log('nota', 'NOTA', ev.message || '');
      break;
    case 'caso':
      if (ev.como !== 'atualizado') log('mem', 'CASO', (ev.como || '') + ' → ' + ev.id + ' · ' + (ev.titulo || ''));
      casoIdAtual = ev.id;
      mostrarBotaoAtlas();
      if (casoAberto()) atualizarCaso();
      break;
    case 'atlas':                            // o BMX decidiu que já dá para mostrar no corpo
      if (ev.caso) casoIdAtual = ev.caso;
      atlasPedido = true;
      break;
    case 'ficha':
      window.open(ev.url, '_blank', 'noopener');
      break;
    case 'error':
      log('erro', 'ERRO', ev.message || '');
      bolhaBmx.textContent = ev.message || 'erro';
      break;
    case 'complete':
      if (ev.session_id) $('#sSessao').textContent = String(ev.session_id).slice(0, 8);
      log('ok', 'PRONTO', (ev.ms || 0) + ' ms');
      break;
  }
}

/* ── inicialização (o script fica no fim do <body>, o DOM já existe) ── */
window.BMX = {
  headers: headers,
  log: log,
  enviar: enviar,
  ocupado: function () { return rodando; },
  status: carregarStatus()
};

grafo = new MemoryGraph($('#grafo'), { onSelect: function (no, trilha) { inspetor(no, trilha); } });
montarDor();
montarAcoes();
inspetor(null);
carregarGrafo(false);
$('#vozDica').textContent = 'clique em Falar';
$('#btnAtlasAgora').addEventListener('click', function () { explicarNoAtlas(true); });

/* ── ajuda por fase (fase.js): tutorial nas 3 primeiras conexões e sugestão/erro. A conversa sobre a tela
   fica no atlas, no painel e nas demonstrações; aqui o próprio Atendimento já é o chat. ── */
function contextoAtendimento() {
  var falas = Array.prototype.slice.call(document.querySelectorAll('#transcricao .bolha')).slice(-4).map(function (b) {
    return (b.classList.contains('eu') ? 'Pessoa: ' : 'BMX: ') + b.textContent.slice(0, 260);
  });
  return ('Tela: Atendimento, a conversa principal com o BMX. Caso em foco: ' + (casoIdAtual || 'nenhum')
    + '. Últimas mensagens: ' + (falas.join(' | ') || 'nenhuma ainda') + '.').slice(0, 1200);
}
if (window.BMXFase) {
  window.BMXFase.montar({ fase: 'atendimento', ancora: '.topo', antes: '.btn-192', chat: false, contexto: contextoAtendimento });
  var abrirGuia = function () { setTimeout(function () { window.BMXFase.tutorial('atendimento'); }, 600); };
  if (window.__bmxRevelado) abrirGuia(); else window.addEventListener('bmx:revelar', abrirGuia, { once: true });
}
/* com o painel do caso aberto, os botões da barra dele falam com a ajuda que mora dentro do painel (iframe) */
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-bf-pai]');
  if (b) enviarAoCaso({ t: 'bf', aba: b.dataset.bfPai });
});

$('#btnEnviar').onclick = function () { var v = $('#pergunta').value; $('#pergunta').value = ''; enviar(v); };
$('#pergunta').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { var v = $('#pergunta').value; $('#pergunta').value = ''; enviar(v); }
});
$('#btnMic').onclick = function () { window.BMXVoz.alternarEscuta(); };
$('#alertaX').onclick = fecharAlerta;

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (ctl) ctl.abort();
    fetch('/api/cancel', { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: '{}' });
    if (window.speechSynthesis) speechSynthesis.cancel();
    grafo.setFocus(null);
  }
  if (e.key === '/' && document.activeElement !== $('#pergunta')) { e.preventDefault(); $('#pergunta').focus(); }
});

setInterval(function () { window.BMX.status = carregarStatus(); }, 30000);
log('ok', 'BOOT', 'BMX online · claude code · prontuário local');
