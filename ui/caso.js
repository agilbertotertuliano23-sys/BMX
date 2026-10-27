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
window.BMXCaso = { id: function () { return DADOS && DADOS.caso ? DADOS.caso.id : ''; } };   // o botão "Atlas 3D" abre a aula deste caso
var pacienteGuia = '';
var tutorialChamado = false, INCORPORADO = document.documentElement.classList.contains('incorporado');
var imagensRemedios = [], DEMOS = [];
var nomesTemasImagem = { dor_febre: 'Dor e febre', antiinflamatorio: 'Anti-inflamatório',
  reidratacao: 'Reidratação', urticaria: 'Alergia e urticária', alivio_tosse: 'Tosse e garganta' };

function imagensDoTema(tema, max) {
  return imagensRemedios.filter(function (x) { return x.tema === tema; }).slice(0, max || 3);
}

fetch('remedios/catalogo.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(function (lista) {
    imagensRemedios = lista.filter(function (x) { return nomesTemasImagem[x.tema] && /^remedios\/\d{2}\.jpe?g$/.test(x.arquivo); });
    if (DADOS) renderParaCaso(DADOS);
  }).catch(function () { /* sem fotos: o cartão do remédio aparece só com o texto */ });
fetch('/api/demos').then(function (r) { return r.ok ? r.json() : []; })
  .then(function (lista) { DEMOS = Array.isArray(lista) ? lista : []; if (DADOS) renderParaCaso(DADOS); })
  .catch(function () { /* sem catálogo: o cartão não oferece demonstrações */ });

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
  pacienteGuia = d.paciente.id;
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
  renderParaCaso(d);
  mostrarCorpo();
  if (c && !tutorialChamado && window.BMXFase) { tutorialChamado = true; setTimeout(function () { window.BMXFase.tutorial('painel'); }, 900); }
}

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function fontesHtml(fontes) {
  return (fontes || []).map(function (f) {
    if (!/^https:\/\//.test(f.url || '')) return '';
    return '<a href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer">' + esc(f.titulo) + '</a>';
  }).join('');
}

/* ── Para este caso: o que é do contexto, num só cartão ─────────────────────────────────────
   Atlas 3D e demonstrações guiadas da queixa (e dos remédios, se não há sinal de alerta); o que observar;
   possibilidades para discutir; e, sem sinal de alerta, os remédios do guia com as fotos do catálogo. */
function linkSeguro(url, texto) {
  return /^https:\/\//.test(url || '') ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(texto) + '</a>' : esc(texto);
}
/** Miniatura da foto (o nome vai no title); a autoria e a licença ficam juntas, numa linha, abaixo das fotos do remédio. */
function fotoHtml(img) {
  return '<figure class="med-foto" title="' + esc(img.nome + ' — ' + img.descricao) + '"><img src="' + esc(img.arquivo) + '" alt="' + esc(img.descricao) + '" loading="lazy"></figure>';
}
function creditosHtml(imgs) {
  return imgs.length ? '<small class="med-creditos">Fotos ilustrativas: ' + imgs.map(function (i) {
    return esc(i.autor) + ' (' + linkSeguro(i.licenca_url, i.licenca) + ', ' + linkSeguro(i.fonte, 'origem') + ')';
  }).join(' · ') + '</small>' : '';
}

function renderParaCaso(d) {
  var box = $('#paraCaso'), c = d.caso;
  if (!c) { box.hidden = true; return; }
  box.hidden = false;
  var g = (d.catalogo || []).find(function (x) { return x.id === c.queixa_id; });
  $('#paraCasoSub').textContent = c.titulo + (c.lado ? ' · lado ' + c.lado : '');
  var alerta = c.nivel === 'emergencia' || (c.discriminadores || []).some(function (x) { return x.estado === 'sim'; });
  var ficha = d.fixa || [];
  var fixa = ficha.some(function (f) { return f.tipo === 'alergia' || f.tipo === 'medicamento' || f.tipo === 'condicao'; });
  var alergias = ficha.filter(function (f) { return f.tipo === 'alergia'; }).map(function (f) { return semAcento(f.titulo); });
  var meds = g && !alerta ? g.medicamentos : [];
  var ids = (c.queixa_id ? ['queixa:' + c.queixa_id] : []).concat(meds.map(function (m) { return 'remedio:' + m.id; }));
  var demos = ids.map(function (id) { return DEMOS.find(function (x) { return x.id === id; }); }).filter(Boolean);
  $('#paraCasoAcoes').innerHTML = '<button type="button" class="btn-atlas" data-atlas-abrir="1">Ver no atlas 3D</button>'
    + (meds.length ? '<button type="button" class="btn-remedios" data-foco-remedios="1">Ver remédios<small>' + meds.length + (meds.length === 1 ? ' opção' : ' opções') + '</small></button>' : '')
    + demos.map(function (x) {
      return '<button type="button" class="demo-btn" data-demo="' + esc(x.id) + '">▶ ' + esc(x.titulo) + '<small>demonstração guiada</small></button>';
    }).join('');
  if (!g) { $('#paraCasoCorpo').innerHTML = ''; return; }
  var html = '';
  if (g.medicamentos.length) {
    html += '<div class="pc-remedios destaque" id="pcRemedios"><div class="pc-rem-topo"><span class="pc-rem-icone" aria-hidden="true">'
      + '<svg viewBox="0 0 24 24"><path d="M10.5 20.5a4.95 4.95 0 0 1-7-7l10-10a4.95 4.95 0 0 1 7 7z"/><path d="M8.5 8.5l7 7"/></svg></span>'
      + '<h3>Alívio e remédios <small>informação geral para adultos</small></h3>'
      + (alerta ? '' : '<span class="pc-rem-conta">' + g.medicamentos.length + (g.medicamentos.length === 1 ? ' opção' : ' opções') + '</span>') + '</div>';
    if (alerta) html += '<p class="pc-aviso">Há sinal de alerta neste caso. Procure atendimento antes de pensar em remédios para aliviar os sintomas.</p>';
    else {
      html += '<p class="pc-regra">Não é prescrição nem escolha individual de medicamento.'
        + (fixa ? ' Confira as alergias, condições e medicamentos da Ficha fixa com um profissional.' : ' Informe alergias, doenças, gravidez e remédios em uso ao farmacêutico ou profissional.') + '</p>'
        + '<div class="med-lista">' + meds.map(function (m) {
          var exemplos = m.exemplos || [];
          var bloqueados = exemplos.filter(function (nome) { return alergias.some(function (a) { return a.indexOf(semAcento(nome)) >= 0; }); });
          var disponiveis = exemplos.filter(function (nome) { return bloqueados.indexOf(nome) < 0; });
          var fotos = imagensDoTema(m.id, 3);
          return '<article class="med-card"><div class="med-fotos"><div class="med-fotos-linha">' + fotos.map(fotoHtml).join('') + '</div>' + creditosHtml(fotos) + '</div><div class="med-texto"><b>' + esc(m.titulo) + '</b><p>' + esc(m.texto) + '</p>'
            + (bloqueados.length ? '<p class="alergia-aviso">Sua ficha registra alergia a ' + esc(bloqueados.join(', ')) + '. Evite essa opção e confirme o registro com um profissional.</p>' : '')
            + (disponiveis.length ? '<p><b>Exemplo para conferir:</b> ' + esc(disponiveis.join(' ou ')) + '.</p>' : '')
            + '<p class="cautela">' + esc(m.cautelas) + '</p><div class="fontes">' + fontesHtml(m.referencias) + '</div></div></article>';
        }).join('') + '</div>';
    }
    html += '</div>';
  }
  html += '<details class="guia-detalhes"><summary>O que observar</summary><div class="pistas">' + g.pistas.map(function (p, i) {
    return '<article class="pista"><span class="pista-num">' + (i + 1) + '</span><div><b>' + esc(p.rotulo) + '</b><p class="pista-pergunta">' + esc(p.pergunta) + '</p><p>' + esc(p.por_que) + '</p></div></article>';
  }).join('') + '</div><div class="guia-alerta"><b>Quando procurar ajuda</b><p>' + esc(g.cuidado) + '</p></div></details>'
    + '<div class="pc-possib"><h3>Possibilidades para discutir com um profissional <small>não calcula chance nem confirma uma causa</small></h3>'
    + '<div class="possibilidades">' + g.possibilidades.map(function (p) {
      return '<span class="possibilidade" title="' + (p.tipo === 'atenção' ? 'Não deixar passar' : 'Também pode ser') + '"><small>' + (p.tipo === 'atenção' ? 'Não deixar passar' : 'Também pode ser') + '</small>' + esc(p.nome) + '</span>';
    }).join('') + '</div></div>'
    + '<div class="guia-fontes"><b>Fontes</b><div class="fontes">' + fontesHtml(g.fontes) + '</div></div>';
  if (g.exemplo && g.exemplo.tipo === 'ficticio') {
    html += '<details class="guia-detalhes"><summary>Entender com um exemplo fictício</summary>'
      + '<p>' + esc(g.exemplo.relato) + '</p><p><b>' + esc(g.exemplo.pergunta) + '</b></p>'
      + '<p>' + esc(g.exemplo.analise) + '</p><p>' + esc(g.exemplo.nao_concluir) + '</p></details>';
  }
  if (g.consulta && g.consulta.length) {
    html += '<details class="guia-detalhes"><summary>Preparar a consulta</summary><ul>'
      + g.consulta.map(function (texto) { return '<li>' + esc(texto) + '</li>'; }).join('')
      + '</ul><p>' + esc(g.compreensao) + '</p></details>';
  }
  var corpo = $('#paraCasoCorpo');
  var abertos = corpo.dataset.caso === c.id ? Array.prototype.map.call(corpo.querySelectorAll('.guia-detalhes'), function (n) { return n.open; }) : [];
  corpo.innerHTML = html;
  corpo.dataset.caso = c.id;
  Array.prototype.forEach.call(corpo.querySelectorAll('.guia-detalhes'), function (n, i) { n.open = !!abertos[i]; });
}

/** Começa a demonstração guiada da queixa do caso (pedida pelo atlas); espera o cartão existir. */
function pedirDemo(tentativa) {
  var b = document.querySelector('#paraCasoAcoes [data-demo^="queixa:"]');
  var guia = !!(window.BMXFase && window.BMXFase.tutorialAberto());   // com o tutorial aberto a demonstração espera ele fechar
  if (b && !guia) { b.click(); return; }
  if (guia || (tentativa || 0) < 16) setTimeout(function () { pedirDemo(guia ? tentativa : (tentativa || 0) + 1); }, 500);
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
  // possibilidades, "não deixar passar" e perguntas agora vivem no cartão "Para este caso" (renderParaCaso)
  $('#blocoDev').hidden = !c.causas.length;
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
$('#selPaciente').onchange = function () {
  enviar('/paciente ' + this.value, true);
};
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
  if (secao === 'remedios') {                         // o bloco dos remédios, dentro do cartão "Para este caso"
    var rem = document.querySelector('#paraCaso .pc-remedios');
    if (rem) {
      rem.classList.add('foco');
      rem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      clearTimeout(focoTimer);
      focoTimer = setTimeout(function () { rem.classList.remove('foco'); }, 4500);
    }
    return;
  }
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
  else if (e.data.t === 'demo') pedirDemo(0);
  else if (e.data.t === 'bf' && window.BMXFase) window.BMXFase.abrir(String(e.data.aba || ''));   // botões da barra do painel, na tela do Baymax
});
document.addEventListener('click', function (e) {
  if (e.target.closest && e.target.closest('[data-foco-remedios]')) focar('remedios');
});

/* ── ajuda por fase (fase.js): conversar sobre o painel, sugestão/erro e tutorial ─────────────── */
function contextoPainel() {
  var d = DADOS, c = d && d.caso;
  if (!c) return 'Tela: Painel do caso, ainda sem caso aberto.';
  var sinais = c.discriminadores || [];
  var por = function (estado) { return sinais.filter(function (x) { return x.estado === estado; }).map(function (x) { return x.sinal; }).join('; ') || 'nenhum'; };
  var g = (d.catalogo || []).find(function (x) { return x.id === c.queixa_id; });
  var alerta = c.nivel === 'emergencia' || sinais.some(function (x) { return x.estado === 'sim'; });
  var meds = g && !alerta ? g.medicamentos.map(function (m) { return m.titulo + ': ' + m.texto + ' Cautela: ' + m.cautelas; }) : [];
  return [
    'Tela: Painel do caso. Caso ' + c.id + ': ' + c.titulo + (c.regiao_nome ? ', região ' + c.regiao_nome : '') + (c.lado ? ', lado ' + c.lado : '') + '.',
    'Nível de atendimento: ' + (c.nivel_nome || 'a definir') + '. Dor: ' + (c.dor_ultima || c.dor_max || 'sem registro') + '/10.',
    'Sinais de alerta confirmados: ' + por('sim') + '. Descartados: ' + por('nao') + '. Ainda não perguntados: ' + por('') + '.',
    'Estruturas destacadas no corpo: ' + (c.estruturas || []).map(function (e) { return e.nome; }).join(', ') + '.',
    'Ficha fixa: ' + ((d.fixa || []).map(function (f) { return f.tipo + ' ' + f.titulo; }).join('; ') || 'nada registrado') + '.',
    'Remédios mostrados na tela: ' + (meds.length ? meds.join(' | ') : alerta ? 'nenhum, porque há sinal de alerta e a tela pede atendimento antes' : 'nenhum para esta queixa') + '.',
    'Possibilidades para discutir com um profissional: ' + ((g && g.possibilidades) ? g.possibilidades.map(function (p) { return p.nome; }).join(', ') : 'nenhuma') + '.',
    'Plano: ' + ((c.plano || []).join(' ') || 'ainda sem plano') + '.'
  ].join('\n').slice(0, 3000);
}
if (window.BMXFase) {
  window.BMXFase.montar({ fase: 'painel', ancora: '.acoes-topo', antes: '#btnFicha', botoes: !INCORPORADO, chat: true, contexto: contextoPainel,
    sugestoes: ['O que significa o meu nível de atendimento?', 'Para que serve cada remédio listado?', 'O que devo observar nos próximos dias?'],
    vazio: 'Pergunte sobre o que está neste painel: o nível, os sinais, o corpo 3D ou os remédios. Para contar algo novo sobre o que você sente, use a conversa do Atendimento.' });
}

carregar('');
