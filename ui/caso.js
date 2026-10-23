/* BMX · Painel do caso (caso.html). Lê /api/caso, preenche os cartões, conversa com o BMX por
   /api/run (NDJSON, o mesmo fluxo da tela de conversa) e dirige o corpo 3D (corpo3d.js). */
'use strict';

var $ = function (s) { return document.querySelector(s); };
var TOKEN = document.querySelector('meta[name=bmx-token]').content;
var headers = function (extra) { return Object.assign({ 'X-BMX-Token': TOKEN }, extra || {}); };
var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

var DADOS = null, rodando = false, falar = false, corpoPronto = false, camadasConfiguradas = false;

var NOME_CAMADA = { pele: 'Pele', musculos: 'Músculos', orgaos: 'Órgãos', arterias: 'Artérias',
  veias: 'Veias', nervos: 'Nervos', ossos: 'Ossos' };
var ESTADO_SIS = { ok: 'sem queixa', investigacao: 'em investigação', alerta: 'alerta', acompanhamento: 'em acompanhamento' };
var STATUS = { aberto: 'aberto', acompanhamento: 'em acompanhamento', encaminhado: 'encaminhado', resolvido: 'resolvido' };
var ICONES = {
  coracao: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  pulmoes: 'M12 4v8m0 0c-1 1-3 1-4 0m4 0c1 1 3 1 4 0M8 7c-3 1-4 6-4 10 0 2 2 3 4 2l2-1V9c0-1-1-2-2-2zm8 0c3 1 4 6 4 10 0 2-2 3-4 2l-2-1V9c0-1 1-2 2-2z',
  digestorio: 'M9 3v4c0 2-4 3-4 8a5 5 0 0 0 9 3c2-2 5-1 5-5 0-3-3-4-5-4h-2V3',
  rins: 'M8 5c-3 0-4 3-4 6s1 7 4 7c2 0 2-2 2-3s-1-1-1-3 1-2 1-3-1-4-2-4zm8 0c3 0 4 3 4 6s-1 7-4 7c-2 0-2-2-2-3s1-1 1-3-1-2-1-3 1-4 2-4z',
  nervoso: 'M10 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 5 2V5a3 3 0 0 0-2-1zm4 0a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-5 2',
  locomotor: 'M7 4a2 2 0 0 0-2 3 2 2 0 0 0 1 3l8 8a2 2 0 0 0 3 1 2 2 0 0 0 3-2 2 2 0 0 0-3-1l-8-8a2 2 0 0 0-1-3 2 2 0 0 0-1-1z'
};

/* ── dados ───────────────────────────── */
async function carregar(cid) {
  try {
    var r = await fetch('/api/caso' + (cid ? '?id=' + encodeURIComponent(cid) : ''), { headers: headers() });
    DADOS = await r.json();
    render();
  } catch (e) { console.warn('[caso] não carregou', e); }
}

function render() {
  var d = DADOS, c = d.caso;
  renderSeletores(d);
  renderDor(d, c);
  renderNivel(c);
  renderSinais(c);
  $('#fixa').innerHTML = d.fixa.length ? d.fixa.map(function (f) {
    return '<span class="chip ' + esc(f.tipo) + '"><i></i>' + esc(f.titulo) + '</span>';
  }).join('') : '<span class="vazio-txt">Sem alergias, remédios ou condições registrados.</span>';
  renderAchado(c);
  renderSistemas(d.sistemas);
  renderTempo(c);
  renderCamadas(d.camadas);
  mostrarCorpo();
}

function renderSeletores(d) {
  $('#selPaciente').innerHTML = d.pacientes.map(function (p) {
    return '<option value="' + esc(p.id) + '"' + (p.id === d.paciente.id ? ' selected' : '') + '>'
      + esc(p.id + (p.nome ? ' — ' + p.nome : '')) + '</option>';
  }).join('');
  var atual = d.caso ? d.caso.id : '';
  $('#selCaso').innerHTML = (d.casos.length ? '' : '<option value="">nenhum caso</option>') + d.casos.map(function (c) {
    return '<option value="' + esc(c.id) + '"' + (c.id === atual ? ' selected' : '') + '>'
      + esc(c.titulo + ' · ' + (STATUS[c.status] || c.status)) + '</option>';
  }).join('');
}

function renderDor(d, c) {
  var hist = d.dor || [];
  var v = c && c.dor_ultima !== '' && c.dor_ultima != null ? +c.dor_ultima
    : (hist.length ? +hist[hist.length - 1].nivel : null);
  var g = $('#gaugeValor');
  if (v == null || isNaN(v)) {
    $('#dorNum').textContent = '—';
    g.style.strokeDashoffset = 252;
    $('#dorSub').textContent = 'diga "/dor 6" ou use a escala da conversa';
    return;
  }
  $('#dorNum').textContent = v;
  g.style.strokeDashoffset = (252 * (1 - v / 10)).toFixed(1);
  g.style.stroke = v <= 3 ? 'var(--n-autocuidado)' : v <= 6 ? 'var(--n-urgente)' : 'var(--n-emergencia)';
  $('#dorSub').textContent = c && c.dor_max ? 'máxima no caso: ' + c.dor_max + '/10' : 'último registro';
}

function renderNivel(c) {
  var n = c ? c.nivel : '';
  $('#nivel').dataset.n = n || '';
  $('#nivel b').textContent = c ? c.nivel_nome : 'a definir';
  $('#nivelSub').textContent = {
    emergencia: 'Ligar 192 ou ir ao pronto-socorro agora.',
    urgente: 'UPA ou pronto atendimento ainda hoje.',
    consulta: 'UBS ou médico nos próximos dias.',
    autocuidado: 'Dá para cuidar em casa, de olho nos sinais.'
  }[n] || 'O BMX classifica quando tiver o suficiente.';
}

function renderSinais(c) {
  var lista = c ? c.discriminadores : [];
  var feitos = lista.filter(function (s) { return s.estado; }).length;
  $('#sinaisConta').textContent = lista.length ? feitos + ' de ' + lista.length + ' checados' : '';
  $('#sinais').innerHTML = lista.length ? lista.map(function (s) {
    var m = s.estado === 'sim' ? '!' : s.estado === 'nao' ? '✓' : '?';
    var txt = s.estado === 'sim' ? 'sim' : s.estado === 'nao' ? 'não' : 'não perguntado';
    return '<li class="' + (s.estado || 'pend') + '"><span class="marca-s" aria-hidden="true">' + m + '</span>'
      + '<span>' + esc(s.sinal) + '</span><small>' + esc(txt + (s.data ? ' · ' + s.data : '')) + '</small></li>';
  }).join('') : '<li class="vazio-txt">Os sinais aparecem quando o caso tiver uma queixa de entrada.</li>';
}

function renderAchado(c) {
  if (!c) {
    $('#codigo').textContent = '—';
    $('#status').textContent = '';
    $('#titulo').textContent = 'Nenhum caso aberto';
    $('#regiaoTxt').textContent = 'Conte ao BMX o que está sentindo e ele abre um caso.';
    $('#estruturas').innerHTML = '';
    ['#blocoPergunta', '#blocoAnatomia', '#blocoDev'].forEach(function (s) { $(s).hidden = true; });
    return;
  }
  $('#codigo').textContent = c.ciap2 ? 'CIAP-2 ' + c.ciap2 : c.id;
  $('#status').textContent = c.id + ' · ' + (STATUS[c.status] || c.status);
  $('#titulo').textContent = c.titulo;
  $('#regiaoTxt').textContent = [c.regiao_nome, c.lado ? 'lado ' + c.lado : '', c.inicio ? 'desde ' + c.inicio : '']
    .filter(Boolean).join(' · ');
  $('#estruturas').innerHTML = c.estruturas.map(function (e) {
    return '<button class="estrutura' + (e.centro ? '' : ' sem-malha') + '" data-id="' + esc(e.id) + '"'
      + (e.centro ? '' : ' title="Sem malha 3D nesta biblioteca"') + '><i style="background:' + esc(e.cor) + '"></i>'
      + '<span>' + esc(e.nome) + '<small>' + esc(NOME_CAMADA[e.camada] || e.camada) + '</small></span></button>';
  }).join('');
  Array.prototype.forEach.call($('#estruturas').children, function (b) {
    b.onclick = function () { if (window.BMXCorpo) window.BMXCorpo.isolar(b.dataset.id); };
  });
  $('#blocoPergunta').hidden = !c.proximo_sinal;
  $('#proxima').textContent = c.proximo_sinal ? '“' + c.proximo_sinal + '?”' : '';
  $('#blocoAnatomia').hidden = !c.anatomia.length;
  $('#anatomiaTxt').textContent = c.anatomia.join(' ');
  $('#blocoDev').hidden = !c.causas.length;
  $('#causas').textContent = c.causas.join('; ');
  $('#naoPerder').textContent = c.nao_perder.join('; ');
  $('#perguntas').textContent = c.perguntas.join(' ');
}

function renderSistemas(lista) {
  $('#sistemas').innerHTML = lista.map(function (s) {
    return '<div class="sistema ' + s.estado + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="'
      + (ICONES[s.id] || '') + '"/></svg><b>' + esc(s.nome) + '</b><span><i></i>' + esc(ESTADO_SIS[s.estado]) + '</span></div>';
  }).join('');
}

/* *palavra* é ênfase para a voz (persona.md); na tela vira negrito, sem os asteriscos */
function enfase(htmlEscapado) {
  return htmlEscapado.replace(/\*\*?([^*\n]{1,60})\*\*?/g, '<strong>$1</strong>');
}

function renderTempo(c) {
  var linha = c ? c.linha.slice().reverse() : [];
  $('#tempoConta').textContent = linha.length ? linha.length + (linha.length === 1 ? ' registro' : ' registros') : '';
  $('#visitas').innerHTML = linha.length ? linha.map(function (l) {
    return '<li class="visita"><b>' + esc(l.quando) + '</b>' + enfase(esc(l.texto.slice(0, 150))) + '</li>';
  }).join('') : '<li class="vazio-txt">As conversas sobre este caso aparecem aqui.</li>';
  var plano = c ? c.plano.concat(c.desfecho.map(function (x) { return 'Desfecho: ' + x; })) : [];
  $('#plano').innerHTML = plano.length ? plano.map(function (p) { return '<li>' + enfase(esc(p)) + '</li>'; }).join('')
    : '<li class="vazio-txt">O plano aparece quando o BMX classificar o nível.</li>';
}

/* ── corpo 3D ────────────────────────── */
function renderCamadas(lista) {
  var caixa = $('#camadas');
  caixa.innerHTML = lista.filter(function (c) { return c.arquivo; }).map(function (c) {
    var on = window.BMXCorpo ? window.BMXCorpo.ligada(c.id) : c.id === 'pele';
    return '<button data-id="' + esc(c.id) + '" aria-pressed="' + on + '"><i style="background:' + esc(c.cor) + '"></i>'
      + esc(NOME_CAMADA[c.id] || c.nome) + '</button>';
  }).join('');
  Array.prototype.forEach.call(caixa.children, function (b) {
    b.onclick = function () {
      if (!window.BMXCorpo) return;
      var ligar = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(ligar));
      b.classList.add('carregando-c');
      window.BMXCorpo.camada(b.dataset.id, ligar).finally(function () { b.classList.remove('carregando-c'); });
    };
  });
}

function mostrarCorpo(transitorio) {
  if (!corpoPronto || !DADOS) return;
  if (!camadasConfiguradas) { camadasConfiguradas = true; window.BMXCorpo.configurar(DADOS.camadas); }
  var c = transitorio || DADOS.caso;
  window.BMXCorpo.mostrar(c ? { estruturas: c.estruturas, regiao3d: c.regiao3d, lado: c.lado } : {});
}

window.addEventListener('bmx:corpo-pronto', function () { corpoPronto = true; mostrarCorpo(); });
window.addEventListener('corpo:estrutura', function (e) {
  Array.prototype.forEach.call($('#estruturas').children, function (b) {
    b.classList.toggle('sel', b.dataset.id === e.detail.id);
  });
});

/* ── conversa ────────────────────────── */
function mostrarAlerta(ev) {
  $('#alertaTitulo').textContent = ev.title || 'Possível emergência';
  $('#alertaTexto').textContent = ev.level === 'crise'
    ? 'Você não está sozinho. Tem gente pronta para ouvir agora.'
    : 'Ligue agora ou vá ao pronto-socorro mais próximo.';
  $('#alertaFones').innerHTML = (ev.phones || []).map(function (f) {
    return '<a href="tel:' + esc(String(f.number).replace(/\s+/g, '')) + '">' + esc(f.name) + ' ' + esc(f.number) + '</a>';
  }).join('');
  $('#alerta').hidden = false;
}

var TAG_RE = /\[([^\][]{1,90})\]/g;
function renderFalado(el, texto) {
  var html = '', ultimo = 0, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(texto)) !== null) {
    html += esc(texto.slice(ultimo, m.index)) + '<span class="tag">' + esc(m[1]) + '</span>';
    ultimo = m.index + m[0].length;
  }
  el.innerHTML = html + esc(texto.slice(ultimo));
}

async function enviar(msg, silencioso) {
  msg = (msg || '').trim();
  if (!msg || rodando) return;
  rodando = true;
  $('#btnEnviar').disabled = true;
  var resposta = '', casoId = null;
  if (!silencioso) {
    $('#resposta').hidden = false;
    $('#resposta').classList.add('pensando');
    $('#respostaTxt').textContent = '';
  }
  try {
    var res = await fetch('/api/run', {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ message: msg })
    });
    if (!res.ok) throw new Error((await res.json().catch(function () { return {}; })).error || 'HTTP ' + res.status);
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
        if (ev.t === 'alert') mostrarAlerta(ev);
        else if (ev.t === 'anatomia' && !(DADOS && DADOS.caso)) mostrarCorpo(ev);
        else if (ev.t === 'caso') { casoId = ev.id; if (ev.como !== 'atualizado') carregar(ev.id); }
        else if (ev.t === 'ficha') window.open(ev.url, '_blank', 'noopener');
        else if (ev.t === 'delta') { resposta += ev.text; if (!silencioso) renderFalado($('#respostaTxt'), resposta); }
        else if (ev.t === 'error' && !silencioso) $('#respostaTxt').textContent = ev.message || 'erro';
      }
    }
  } catch (e) {
    if (!silencioso) $('#respostaTxt').textContent = String(e.message || e).slice(0, 200);
  }
  rodando = false;
  $('#btnEnviar').disabled = false;
  $('#resposta').classList.remove('pensando');
  await carregar(casoId || (DADOS && DADOS.caso ? DADOS.caso.id : ''));
  if (falar && resposta && window.speechSynthesis) {
    var u = new SpeechSynthesisUtterance(resposta.replace(TAG_RE, ' '));
    u.lang = 'pt-BR';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}

$('#form').onsubmit = function (e) {
  e.preventDefault();
  var v = $('#entrada').value;
  $('#entrada').value = '';
  enviar(v);
};
$('#btnVoz').onclick = function () {
  falar = !falar;
  this.setAttribute('aria-pressed', String(falar));
  if (!falar && window.speechSynthesis) speechSynthesis.cancel();
};
$('#selPaciente').onchange = function () { enviar('/paciente ' + this.value, true); };
$('#selCaso').onchange = function () { if (this.value) enviar('/caso ' + this.value, true); };
$('#btnFicha').onclick = function () {
  if (DADOS && DADOS.caso) window.open('/ficha?caso=' + encodeURIComponent(DADOS.caso.id), '_blank', 'noopener');
};
$('#alertaX').onclick = function () { $('#alerta').hidden = true; };
$('#vFrente').onclick = function () { if (window.BMXCorpo) window.BMXCorpo.vista('frente'); };
$('#vCostas').onclick = function () { if (window.BMXCorpo) window.BMXCorpo.vista('costas'); };
$('#vRegiao').onclick = function () { if (window.BMXCorpo) window.BMXCorpo.vista('regiao'); };

/* ── incorporado à tela do Baymax: o pai diz quando atualizar e qual parte está sendo explicada ── */
var SECOES = { dor: '.medida:nth-of-type(1)', nivel: '.medida:nth-of-type(2)', sinais: '#sinais', fixa: '#fixa',
  achado: '#achado', tempo: '.tempo', plano: '.plano', corpo: '#palco' };
var focoTimer = null;
function focar(secao) {
  Array.prototype.forEach.call(document.querySelectorAll('.foco'), function (n) { n.classList.remove('foco'); });
  var alvo = SECOES[secao] && document.querySelector(SECOES[secao]);
  if (!alvo) return;
  alvo = alvo.closest('.card') || alvo;
  alvo.classList.add('foco');
  alvo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (secao === 'corpo' && window.BMXCorpo) window.BMXCorpo.vista('regiao');
  clearTimeout(focoTimer);
  focoTimer = setTimeout(function () { alvo.classList.remove('foco'); }, 4500);
}
window.addEventListener('message', function (e) {
  if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
  if (e.data.t === 'atualizar') carregar(e.data.id || (DADOS && DADOS.caso ? DADOS.caso.id : ''));
  else if (e.data.t === 'foco') focar(e.data.secao);
});

carregar('');
