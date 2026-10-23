"""
Modo Demonstração: um roteiro de passos que o painel do caso toca com fala, câmera e destaques no corpo 3D.

O ROTEIRO é montado aqui, só com o que existe no catálogo (queixa, guia pesquisado, estruturas com malha,
regiões, camadas, tema de remédio): a LLM nunca escolhe estrutura, camada nem imagem. Ela só redige a
FALA de cada passo, em linguagem simples, e o texto dela é conferido antes de seguir (sem dose, sem
prescrição, sem diagnóstico). Se a LLM falhar ou escrever algo fora da regra, entra a fala-padrão do passo.

Nada aqui usa dados da pessoa: o mesmo roteiro serve a qualquer um e fica em cache.

Passo: {id, titulo, acao: {tipo, ...}, fala}. Tipos de `acao`:
  corpo | alerta | regiao | estrutura | camadas | observar | remedio | afeta | fim
"""
import json
import pathlib
import re
import threading

import anatomia
import clinica

ROOT = pathlib.Path(__file__).resolve().parent
CATALOGO_FOTOS = ROOT / "ui" / "remedios" / "catalogo.json"
MAX_ESTRUTURAS = 3          # por região: o roteiro inteiro fica em torno de 10 passos (~2 min de fala)
ORDEM_CAMADAS = ["pele", "musculos", "ossos", "orgaos"]
_CAMADA = {"pele": "pele", "musculos": "músculos", "ossos": "ossos", "orgaos": "órgãos", "nervos": "nervos",
           "arterias": "artérias", "veias": "veias"}
_SISTEMA = {"esqueletico": "esquelético", "digestorio": "digestório", "urinario": "urinário", "nervoso": "nervoso",
            "muscular": "muscular", "respiratorio": "respiratório", "cardiovascular": "cardiovascular",
            "reprodutor": "reprodutor", "sensorial": "sensorial", "endocrino": "endócrino", "linfatico": "linfático",
            "articular": "articular", "tegumentar": "da pele"}
TEMAS_REMEDIO = ("dor_febre", "antiinflamatorio", "reidratacao", "urticaria", "alivio_tosse")
_CACHE, _LOCK = {}, threading.Lock()

AVISO = ("Atlas de referência: mostra onde fica e como é a região da queixa. Não é o seu exame "
         "e não indica o que você tem.")

# O que uma fala NUNCA pode conter (a LLM é instruída, mas o servidor confere).
_PROIBIDO = re.compile(
    r"\b\d+[.,]?\d*\s*(mg|mcg|µg|g|ml|gotas?|comprimidos?|cápsulas?|capsulas?|ampolas?|doses?)\b"
    r"|\b(tome|tomar|use|usar|injete|aplique)\b.{0,30}\b(remédio|remedio|medicamento|comprimido|dose)\b"
    r"|(?<!o que )(?<!que )\b(você|voce) tem\b|\bo diagnóstico é\b|(?<!o que )(?<!que )\bvocê está com\b", re.I)


def _fotos(tema):
    try:
        todas = json.loads(CATALOGO_FOTOS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return [dict(arquivo=f["arquivo"], nome=f["nome"], autor=f["autor"], licenca=f["licenca"], fonte=f["fonte"])
            for f in todas if f["tema"] == tema][:3]


def _sintomas(q):
    cat, _ = anatomia.carregar()
    ids = set(q.get("sintoma_anatomico", []))
    return [s for s in cat.get("sintomas", []) if s["id"] in ids]


def _estruturas(ids):
    return [e for e in anatomia.detalhar(list(ids)) if e.get("centro")]


def _montar_queixa(qid):
    """Roteiro-base (sem LLM): todos os ids vêm do catálogo. None se a queixa não existe."""
    g = clinica.guia(qid)
    q = next((x for x in clinica.carregar()["queixas"] if x["id"] == qid), None)
    if not (g and q):
        return None
    nome = g["queixa"]
    passos = [dict(id="abertura", titulo="Por onde vamos", acao={"tipo": "corpo"},
                   padrao=f"Vou mostrar, no corpo, as regiões que costumam estar ligadas a uma queixa de {nome.lower()}. "
                          "Isto é um atlas de referência: não é o seu exame e não diz o que você tem.")]
    passos.append(dict(id="alerta", titulo="Quando procurar ajuda", acao={
        "tipo": "alerta", "texto": g["cuidado"],
        "nao_perder": [p["nome"] for p in g["possibilidades"] if p["tipo"] == "atenção"][:4]},
        padrao="Antes de tudo, os sinais que pedem ajuda agora. " + g["cuidado"]))
    vistas = set()
    for s in _sintomas(q):
        regioes = s.get("regioes", [])[:2]
        por_regiao = {}
        for e in _estruturas(s.get("estruturas", [])):
            por_regiao.setdefault((e["regioes"] or [regioes[0] if regioes else ""])[0], []).append(e)
        for r in regioes:
            r3 = anatomia.regiao_3d(r)
            if not r3 or r in vistas:
                continue
            if len(vistas) >= 3:      # no máximo 3 regiões por roteiro: a demonstração fica em ~2 min
                break
            vistas.add(r)
            do_sintoma = por_regiao.get(r, [])
            ja = {x["id"] for x in do_sintoma}
            da_regiao = [e for e in _estruturas(r3.get("estruturas", [])) if e["id"] not in ja]
            # as estruturas do sintoma vêm primeiro; as da região só completam quando o sintoma tem poucas com malha
            todas = (do_sintoma + (da_regiao if len(do_sintoma) < 2 else []))[:MAX_ESTRUTURAS]
            if not todas:
                continue
            nome_r = r.replace("-", " ")
            primeira = not any(p["acao"]["tipo"] == "regiao" for p in passos)
            passos.append(dict(id=f"regiao-{r}", titulo=f"Região: {nome_r}",
                               acao={"tipo": "regiao", "regiao": r, "regiao3d": r3, "estruturas": todas},
                               padrao=(s.get("nota") if primeira and s.get("nota") else
                                       f"Agora, a região do {nome_r}: veja o que fica nela e por que entra nesta conversa.")))
            for e in todas:
                passos.append(dict(id=f"est-{e['id']}", titulo=e["nome"],
                                   acao={"tipo": "estrutura", "id": e["id"], "regiao": r},
                                   padrao=f"{e['nome']}. Faz parte do sistema {_SISTEMA.get(e['sistema'], e['sistema'])}, "
                                          f"na camada de {_CAMADA.get(e['camada'], e['camada'])}."))
    passos.append(dict(id="camadas", titulo="Camadas do corpo", acao={"tipo": "camadas", "ids": ORDEM_CAMADAS},
                       padrao="Agora, as camadas: a pele, os músculos, os ossos e os órgãos, uma de cada vez, "
                              "para você ver o que fica em cima do quê."))
    pistas = g["pistas"][:2]
    passos.append(dict(id="observar", titulo="O que observar", acao={"tipo": "observar", "pistas": [
        {"rotulo": p["rotulo"], "pergunta": p["pergunta"], "por_que": p["por_que"]} for p in pistas]},
        padrao="Duas perguntas ajudam a descrever o que você sente. " + " ".join(p["pergunta"] for p in pistas)))
    if g["medicamentos"]:
        m = g["medicamentos"][0]
        meds = clinica.carregar_investigacao()["medicamentos"]
        tema = next((k for k in TEMAS_REMEDIO if meds.get(k, {}).get("titulo") == m["titulo"]), "")
        passos.append(dict(id="remedio", titulo="Alívio: o que conferir", acao={
            "tipo": "remedio", "titulo": m["titulo"], "texto": m["texto"], "cautelas": m["cautelas"],
            "fotos": _fotos(tema)}, padrao="Sobre alívio, a conversa é com um farmacêutico ou com o seu médico. "
                                           "As fotos são só ilustrações: não indicam o que usar."))
    sistemas = sorted({_SISTEMA.get(e["sistema"], e["sistema"]) for p in passos if p["acao"]["tipo"] == "regiao"
                       for e in p["acao"]["estruturas"]})
    if sistemas:
        passos.append(dict(id="afeta", titulo="O que isto envolve", acao={"tipo": "afeta", "sistemas": sistemas},
                           padrao="Em conjunto, esta queixa envolve os sistemas: " + ", ".join(sistemas) + "."))
    passos.append(dict(id="fim", titulo="Levar para a conversa", acao={"tipo": "fim"},
                       padrao="Para fechar: anote o que você observou e leve para a conversa com o BMX e com um profissional."))
    return dict(queixa=qid, titulo=nome, aviso=AVISO, passos=passos)


def _abertura(assunto):
    return dict(id="abertura", titulo="Por onde vamos", acao={"tipo": "corpo"},
                padrao=f"Vamos conhecer {assunto}. Isto é um atlas de referência: mostra onde fica e como é, "
                       "não é o seu exame e não diz o que você tem.")


def _passo_regiao(r, estruturas, texto):
    r3 = anatomia.regiao_3d(r)
    return dict(id=f"regiao-{r}", titulo=f"Região: {r.replace('-', ' ')}",
                acao={"tipo": "regiao", "regiao": r, "regiao3d": r3, "estruturas": estruturas}, padrao=texto)


def _passos_estruturas(estruturas, r):
    return [dict(id=f"est-{e['id']}", titulo=e["nome"], acao={"tipo": "estrutura", "id": e["id"], "regiao": r},
                 padrao=f"{e['nome']}. Faz parte do sistema {_SISTEMA.get(e['sistema'], e['sistema'])}, "
                        f"na camada de {_CAMADA.get(e['camada'], e['camada'])}.") for e in estruturas]


_FIM = dict(id="fim", titulo="Levar para a conversa", acao={"tipo": "fim"},
            padrao="Para fechar: anote o que chamou a sua atenção e leve para a conversa com o BMX e com um profissional.")


def _queixas_da_regiao(r):
    cat, _ = anatomia.carregar()
    sint = {s["id"] for s in cat.get("sintomas", []) if r in s.get("regioes", [])}
    return [dict(id=q["id"], queixa=q["queixa"]) for q in clinica.carregar()["queixas"]
            if sint & set(q.get("sintoma_anatomico", []))]


def _montar_regiao(r):
    cat, _ = anatomia.carregar()
    info, r3 = cat["regioes"].get(r), anatomia.regiao_3d(r)
    todas = _estruturas(r3.get("estruturas", []))[:4] if r3 else []
    if not (info and todas):
        return None
    nome = info["nome"]
    viz = [cat["regioes"][v]["nome"] for v in info.get("vizinhas", []) if v in cat["regioes"]][:3]
    passos = [_abertura(f"a região: {nome.lower()}"),
              _passo_regiao(r, todas, f"Esta é a região {nome.lower()}" + (f", vizinha de {', '.join(viz).lower()}" if viz else "")
                            + ". Veja as principais estruturas que ficam nela.")]
    passos += _passos_estruturas(todas, r)
    camadas = [c for c in ORDEM_CAMADAS if c == "pele" or any(e["camada"] == c for e in todas)]
    passos.append(dict(id="camadas", titulo="Camadas", acao={"tipo": "camadas", "ids": camadas},
                       padrao="Agora, as camadas desta região, uma de cada vez, para ver o que fica em cima do quê."))
    qs = _queixas_da_regiao(r)
    if qs:
        passos.append(dict(id="queixas", titulo="Queixas ligadas", acao={"tipo": "queixas", "lista": qs[:6]},
                           padrao="Queixas que costumam levar a esta região: " + ", ".join(q["queixa"].lower() for q in qs[:6]) + "."))
    return dict(roteiro=f"regiao:{r}", titulo=nome, aviso=AVISO, passos=passos + [dict(_FIM)])


def _montar_remedio(tema):
    inv = clinica.carregar_investigacao()
    m = inv["medicamentos"].get(tema)
    if not m:
        return None
    ligadas = [q for q, d in inv["queixas"].items() if tema in d.get("medicamentos", [])]
    nomes = {q["id"]: q["queixa"] for q in clinica.carregar()["queixas"]}
    guia = clinica.guia(ligadas[0]) if ligadas else None
    passos = [_abertura(f"o tema: {m['titulo'].lower()}"),
              dict(id="remedio", titulo=m["titulo"], acao={"tipo": "remedio", "titulo": m["titulo"], "texto": m["texto"],
                                                           "cautelas": m["cautelas"], "fotos": _fotos(tema)},
                   padrao="Este é um tema para conversar com um farmacêutico ou com o seu médico, nunca uma indicação. "
                          "As fotos são só ilustrações: não dizem o que usar.")]
    if guia:
        passos.append(dict(id="alerta", titulo="Quando procurar ajuda", acao={"tipo": "alerta", "texto": guia["cuidado"],
                           "nao_perder": []}, padrao="Antes de pensar em qualquer remédio, os sinais que pedem ajuda. " + guia["cuidado"]))
    passos.append(dict(id="queixas", titulo="Queixas ligadas", acao={"tipo": "queixas", "lista": [
        dict(id=q, queixa=nomes[q]) for q in ligadas if q in nomes]},
        padrao="Este tema aparece em queixas como: " + ", ".join(nomes[q].lower() for q in ligadas if q in nomes) + "."))
    return dict(roteiro=f"remedio:{tema}", titulo=m["titulo"], aviso=AVISO, passos=passos + [dict(_FIM)])


def _montar_camada(c):
    cat, _ = anatomia.carregar()
    ids = [i for i, e in cat["estruturas"].items() if e["camada"] == c]
    por_regiao = {}
    for e in _estruturas(ids):
        por_regiao.setdefault(e["regioes"][0], []).append(e)
    regioes = [r for r in por_regiao if anatomia.regiao_3d(r)][:3]
    if not regioes:
        return None
    nome = _CAMADA.get(c, c)
    passos = [_abertura(f"a camada de {nome}"),
              dict(id="camadas", titulo=f"Camada: {nome}", acao={"tipo": "camadas", "ids": [c]},
                   padrao=f"Esta é a camada de {nome}, vista no corpo inteiro. Depois, três regiões onde ela aparece.")]
    for r in regioes:
        es = por_regiao[r][:2]
        passos.append(_passo_regiao(r, es, f"Na região do {r.replace('-', ' ')}, a camada de {nome} aparece assim."))
        passos += _passos_estruturas(es, r)
    return dict(roteiro=f"camada:{c}", titulo=nome.capitalize(), aviso=AVISO, passos=passos + [dict(_FIM)])


def montar(rid):
    """Despacha pelo tipo do id: 'queixa:cefaleia', 'regiao:cabeca', 'remedio:dor_febre', 'camada:ossos'."""
    tipo, _, chave = rid.partition(":")
    if not chave:                       # id simples = queixa
        tipo, chave = "queixa", rid
    r = {"queixa": _montar_queixa, "regiao": _montar_regiao, "remedio": _montar_remedio,
         "camada": _montar_camada}.get(tipo, lambda _: None)(chave)
    if r and "roteiro" not in r:
        r["roteiro"] = f"queixa:{chave}"
        r.pop("queixa", None)
    return r


CAMADAS_ROTEIRO = ("musculos", "ossos", "orgaos", "nervos", "arterias", "veias")
_TIPO_ROTULO = {"queixa": "Queixa", "regiao": "Região do corpo", "remedio": "Remédio (conversa)", "camada": "Camada"}
_CATALOGO = []


def ids_roteiros():
    cat, _ = anatomia.carregar()
    inv = clinica.carregar_investigacao()
    return ([f"queixa:{q['id']}" for q in clinica.carregar()["queixas"]]
            + [f"regiao:{r}" for r in cat["regioes"]]
            + [f"remedio:{t}" for t in inv["medicamentos"]]
            + [f"camada:{c}" for c in CAMADAS_ROTEIRO])


def catalogo():
    """Os roteiros disponíveis (50): id, tipo, título, nº de passos e duração estimada. Fica em cache."""
    with _LOCK:
        if _CATALOGO:
            return _CATALOGO
    itens = []
    for rid in ids_roteiros():
        r = montar(rid)
        if not r:
            continue
        palavras = sum(len(p["padrao"].split()) for p in r["passos"])
        itens.append(dict(id=rid, tipo=rid.split(":")[0], rotulo=_TIPO_ROTULO[rid.split(":")[0]], titulo=r["titulo"],
                          passos=len(r["passos"]), segundos=round(palavras / 2.4)))
    with _LOCK:
        _CATALOGO[:] = itens
    return _CATALOGO


NIVEIS = ("simples", "intermediario", "aprofundado")


def _primeira_frase(texto):
    m = re.match(r"(.+?[.!?])(\s|$)", texto.strip())
    return (m.group(1) if m else texto.strip())[:200]


LOTE = 6   # passos por chamada à LLM: um array único de ~18 objetos estouraria o limite de saída
_SISTEMA_LLM = (
    "Você é o BMX, um agente de saúde que ENSINA com calma e rigor, em português do Brasil, falando com uma pessoa "
    "leiga. Para cada passo de uma demonstração anatômica, escreva em camadas de profundidade didática: "
    "\"resumo\" = uma frase simples e direta (até 20 palavras); "
    "\"explicacao\" = explicação intermediária simplificada, 2 a 3 frases curtas, que diga o que é, onde fica e por que "
    "aparece nesta conversa, sem jargão; "
    "\"termos\" = lista de até 3 objetos {\"tecnico\": termo técnico usado, \"simples\": o mesmo em palavras do dia a dia}; "
    "\"aprofundar\" = 1 a 2 frases a mais para quem quer entender melhor (mecanismo ou relação com outras partes). "
    "Regras: use 'costuma', 'pode estar relacionado'; NUNCA diga o que a pessoa tem; nunca dê dose, nome de remédio para "
    "tomar nem prescrição (remédio só como tema para conversar com farmacêutico ou médico); mantenha todo sinal de alerta "
    "do texto base; só anatomia básica correta, sem inventar fatos. "
    "Responda SOMENTE com um array JSON, um objeto por passo, na mesma ordem e quantidade.")


def _array_json(texto):
    ini, fim = texto.find("["), texto.rfind("]")
    if ini < 0 or fim < ini:
        return None
    try:
        itens = json.loads(texto[ini:fim + 1])
    except json.JSONDecodeError:
        return None
    return itens if isinstance(itens, list) else None


def _redigir(roteiro, llm):
    """Pede à LLM, por lotes, um texto em camadas didáticas por passo. Lista do tamanho dos passos (None = sem texto)."""
    fatos = [{"n": i, "tema": p["titulo"], "tipo": p["acao"]["tipo"], "base": p["padrao"]}
             for i, p in enumerate(roteiro["passos"])]
    saida = [None] * len(fatos)
    for ini in range(0, len(fatos), LOTE):
        lote = fatos[ini:ini + LOTE]
        try:
            itens = _array_json(llm(_SISTEMA_LLM, json.dumps(lote, ensure_ascii=False)))
        except Exception:  # noqa: BLE001  (um lote que falha usa o texto-padrão, os outros seguem)
            itens = None
        if itens and len(itens) == len(lote):
            saida[ini:ini + len(lote)] = itens
    return saida if any(saida) else None


def _valida(fala):
    return isinstance(fala, str) and 12 <= len(fala) <= 420 and not _PROIBIDO.search(fala)


def _termos_validos(termos):
    if not isinstance(termos, list):
        return []
    return [dict(tecnico=t["tecnico"].strip()[:40], simples=t["simples"].strip()[:90]) for t in termos[:3]
            if isinstance(t, dict) and _valida(t.get("simples", "")) and isinstance(t.get("tecnico"), str)
            and 2 <= len(t["tecnico"]) <= 40][:3]


def compor(p, nivel):
    """O que se FALA em cada nível: simples = resumo; intermediário = + explicação; aprofundado = + aprofundar."""
    partes = [p["resumo"]]
    if nivel in ("intermediario", "aprofundado") and p.get("explicacao"):
        partes.append(p["explicacao"])
    if nivel == "aprofundado" and p.get("aprofundar"):
        partes.append(p["aprofundar"])
    return " ".join(x.strip() for x in partes if x)


def roteiro(rid, llm=None):
    """Roteiro pronto para tocar. `llm(sistema, mensagem) -> str` é opcional: sem ela, valem os textos-padrão."""
    with _LOCK:
        if rid in _CACHE:
            return _CACHE[rid]
    r = montar(rid)
    if not r:
        return None
    itens = None
    if llm:
        try:
            itens = _redigir(r, llm)
        except Exception:  # noqa: BLE001  (a LLM fora do ar não pode impedir a demonstração)
            itens = None
    for i, p in enumerate(r["passos"]):
        d = itens[i] if itens and isinstance(itens[i], dict) else {}
        resumo, expl, apro = d.get("resumo"), d.get("explicacao"), d.get("aprofundar")
        usar = _valida(resumo) and _valida(expl)
        if usar:
            p["resumo"], p["explicacao"] = resumo.strip(), expl.strip()
            p["aprofundar"] = apro.strip() if _valida(apro) else ""
            p["termos"] = _termos_validos(d.get("termos"))
        else:   # texto-padrão do passo: a primeira frase vira o resumo e o resto a explicação
            base = p["padrao"]
            p["resumo"] = _primeira_frase(base)
            p["explicacao"] = base[len(p["resumo"]):].strip() or base
            p["aprofundar"], p["termos"] = "", []
        p["origem_texto"] = "llm" if usar else "padrao"
        del p["padrao"]
    # o alerta nunca perde o cuidado pesquisado: se a LLM o encurtou, a explicação leva o texto original
    for p in r["passos"]:
        if p["acao"]["tipo"] == "alerta" and p["acao"]["texto"][:25].lower() not in (p["resumo"] + p["explicacao"]).lower():
            p["explicacao"] = (p["explicacao"].rstrip(". ") + ". " + p["acao"]["texto"]).strip(". ") + "."
    for p in r["passos"]:
        p["fala"] = compor(p, "intermediario")
    # só guarda em cache o roteiro redigido pela LLM: a versão rápida (texto-padrão) não toma o lugar da boa
    if any(p["origem_texto"] == "llm" for p in r["passos"]):
        with _LOCK:
            _CACHE[rid] = r
    return r
