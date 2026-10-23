/* Entrada do BMX (nuvem): pergunta o nome, abre a ficha ou leva ao cadastro rápido.
   Respostas de /api/identidade: entrou | pin | parecido | novo. */
(function () {
  var token = (document.querySelector('meta[name="bmx-token"]') || {}).content || '';
  var $ = function (id) { return document.getElementById(id); };
  var passos = ['passo-nome', 'passo-pin', 'passo-parecido', 'passo-cadastro'];
  var nomeAtual = '';

  function mostrar(id) {
    passos.forEach(function (p) { $(p).hidden = (p !== id); });
    $('erro').textContent = '';
  }
  function erro(msg) { $('erro').textContent = msg || 'Algo deu errado. Tente de novo.'; }

  async function enviar(rota, corpo) {
    try {
      var r = await fetch(rota, { method: 'POST', body: JSON.stringify(corpo),
        headers: { 'content-type': 'application/json', 'x-bmx-token': token } });
      var j = await r.json().catch(function () { return {}; });
      return { ok: r.ok, status: r.status, dados: j };
    } catch (e) { return { ok: false, status: 0, dados: { error: 'Sem conexão com o servidor.' } }; }
  }

  function aplicar(res) {
    var d = res.dados || {};
    if (!res.ok && !d.estado) return erro(res.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : d.error);
    if (d.estado === 'entrou') { location.href = '/'; return; }
    if (d.estado === 'pin') {
      mostrar('passo-pin'); $('pin-entrada').value = ''; $('pin-entrada').focus();
      if (d.error) erro(d.error);
      return;
    }
    if (d.estado === 'novo') { abrirCadastro(nomeAtual); return; }
    if (d.estado === 'parecido') {
      var caixa = $('candidatos'); caixa.textContent = '';
      (d.candidatos || []).forEach(function (c) {
        var b = document.createElement('button');
        b.className = 'sec'; b.textContent = 'Sou ' + c;   // textContent: nome digitado nunca vira HTML
        b.addEventListener('click', function () { nomeAtual = c; identificar(c); });
        caixa.appendChild(b);
      });
      mostrar('passo-parecido');
      return;
    }
    erro(d.error);
  }

  async function identificar(nome, pin, novo) {
    nomeAtual = nome;
    aplicar(await enviar('/api/identidade', { nome: nome, pin: pin || '', novo: !!novo }));
  }

  function abrirCadastro(nome) {
    mostrar('passo-cadastro');
    $('c-nome').value = nome || '';
    $('c-idade').focus();
  }

  $('continuar').addEventListener('click', function () {
    var n = $('nome').value.trim();
    if (n.length < 2) return erro('Digite o seu nome.');
    identificar(n);
  });
  $('nome').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('continuar').click(); });
  $('entrar-pin').addEventListener('click', function () { identificar(nomeAtual, $('pin-entrada').value); });
  $('pin-entrada').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('entrar-pin').click(); });
  $('outra-pessoa').addEventListener('click', function () { abrirCadastro($('nome').value.trim()); });
  document.querySelectorAll('[data-voltar]').forEach(function (b) {
    b.addEventListener('click', function () { mostrar('passo-nome'); $('nome').focus(); });
  });

  $('salvar').addEventListener('click', async function () {
    var corpo = {};
    ['nome', 'idade', 'sexo', 'peso', 'altura', 'alergias', 'remedios', 'condicoes', 'contato', 'pin']
      .forEach(function (k) { corpo[k] = $('c-' + k).value; });
    $('salvar').disabled = true;
    var res = await enviar('/api/cadastro', corpo);
    $('salvar').disabled = false;
    if (res.ok && res.dados.estado === 'entrou') { location.href = '/'; return; }
    erro(res.dados.error || (res.status === 409 ? 'Já existe uma ficha com esse nome.' : ''));
  });
})();
