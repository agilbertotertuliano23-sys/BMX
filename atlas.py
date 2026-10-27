"""
Atlas 3D de materialização: os roteiros (ui/atlas/estudos.json) completados com o que só o catálogo sabe.

O JSON editorial diz QUE estruturas entram em cada aula (papel, pontos de atenção, ordem de montagem, cadeia de
impacto). Aqui cada id vira uma peça 3D: nome, camada e cor, arquivo da malha, centro, raio e lados, vindos de
anatomia.detalhar(). Componente sem malha sai da aula (e fica em `ausentes`), e tudo que dependia dele (ponto de
atenção, passo de montagem, origem de problema) sai junto: o front nunca recebe uma referência quebrada.

Nada aqui usa dados da pessoa: o atlas é o mesmo para qualquer um.
"""
import copy
import hashlib
import json
import pathlib
import re
import threading
import unicodedata

import anatomia

ARQUIVO = pathlib.Path(__file__).resolve().parent / "ui" / "atlas" / "estudos.json"
_CACHE, _LOCK = {"sig": None, "dados": None}, threading.Lock()


def _arquivo_da_malha(det):
    """Primeira malha .glb da biblioteca principal; senão, de qualquer biblioteca."""
    malhas = det.get("malhas", {})
    for bib in ["human-atlas"] + [b for b in malhas if b != "human-atlas"]:
        for a in malhas.get(bib, []):
            if a.lower().endswith(".glb"):
                return a
    return ""


def _peca(comp, descricoes):
    det = (anatomia.detalhar([comp["id"]]) or [None])[0]
    if not det or not det.get("centro"):
        return None
    arquivo = _arquivo_da_malha(det)
    if not arquivo:
        return None
    return dict(id=comp["id"], papel=comp.get("papel", "parte"), nome=det["nome"], nome_en=det["nome_en"],
                sistema=det["sistema"], camada=det["camada"], cor=det["cor"], arquivo=arquivo, fma=det.get("fma", ""),
                centro=det["centro"], raio=det.get("raio") or 0.05, lados=det.get("lados", {}),
                desc=descricoes.get(comp["id"]) or det.get("descricao", ""))


def _montar(estudo, descricoes):
    pecas, ausentes = [], []
    for c in estudo["componentes"]:
        p = _peca(c, descricoes)
        if p:
            pecas.append(p)
        else:
            ausentes.append(c["id"])
    ids = {p["id"] for p in pecas}
    if not any(p["papel"] == "principal" for p in pecas):
        return None                 # sem o órgão principal não há o que materializar
    e = {k: v for k, v in estudo.items() if k not in ("componentes", "pontos", "montagem", "problemas")}
    e["pecas"], e["ausentes"] = pecas, ausentes
    if e.get("foco") and e["foco"]["comp"] not in ids:
        e.pop("foco")
    e["pontos"] = [p for p in estudo["pontos"] if p["comp"] in ids]
    e["montagem"] = dict(estudo["montagem"], ordem=[i for i in estudo["montagem"]["ordem"] if i in ids])
    e["problemas"] = [dict(p, afeta=[i for i in p["afeta"] if i in ids]) for p in estudo["problemas"] if p["origem"] in ids]
    return e


def dados():
    """Estudos prontos para o front. Recarrega quando o JSON ou o catálogo mudam."""
    cat, malhas = anatomia.carregar()
    sig = (ARQUIVO.stat().st_mtime if ARQUIVO.exists() else 0, len(cat.get("estruturas", {})), len(malhas))
    with _LOCK:
        if _CACHE["dados"] is not None and _CACHE["sig"] == sig:
            return _CACHE["dados"]
    try:
        base = json.loads(ARQUIVO.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(aviso="", estudos=[], biblioteca={})
    estudos = [e for e in (_montar(x, base.get("descricoes", {})) for x in base["estudos"]) if e]
    out = dict(aviso=base.get("aviso", ""), estudos=estudos,
               biblioteca=dict(estruturas=len(cat.get("estruturas", {})), com_malha=len(malhas),
                               sistemas=len(cat.get("sistemas", {})), regioes=len(cat.get("regioes", {}))))
    with _LOCK:
        _CACHE.update(sig=sig, dados=out)
    return out


# ── aula montada a partir do caso ────────────────────────────────
# A conversa já disse o que importa: relato, região, lado e sinais de risco confirmados ou descartados. Esta parte
# escolhe a aula que melhor cobre o caso, acrescenta as estruturas dele, põe os pontos relevantes na frente (cada um
# com a ligação ao que a pessoa contou), mantém só os cenários de impacto ligados à queixa e entrega o texto de
# abertura e de fecho. Usa os dados do caso: só o servidor local chama isto, a pedido da própria tela do paciente.
_SEXO = re.compile(r"utero|ovari|prostata|testicul|vagina|penis|vulva|mama")
_SAUDACAO = re.compile(r"^(oi|olá|ola|bom dia|boa tarde|boa noite)[,.!\s]+", re.I)
_MAX_EXTRAS, _MAX_PONTOS, _MAX_PROBLEMAS = 4, 7, 2
_GENERICAS = {"infec", "sindr", "doenc", "aguda", "cronic"}          # raízes que não distinguem uma possibilidade da outra
_SO_CRIANCA = re.compile(r"beb[eê]|crian[cç]a|rec[eé]m.nascid|gestan|gr[aá]vid", re.I)   # sinais que não valem para um adulto sem essa condição


def _norm(t):
    t = unicodedata.normalize("NFD", str(t or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def _raizes(t, minimo=5):
    """Raízes de 5 letras das palavras de um texto ('lombares' e 'lombar' dão a mesma)."""
    return {w[:5] for w in re.findall(r"[a-z]+", _norm(t)) if len(w) >= minimo}


def _do_outro_lado(estrutura, lado):
    lados = estrutura.get("lados") or {}
    return lado in ("direito", "esquerdo") and bool(lados) and lado not in lados


def _lista(itens):
    itens = [i for i in itens if i]
    return itens[0] if len(itens) == 1 else ", ".join(itens[:-1]) + " e " + itens[-1] if itens else ""


def _relato(c):
    """O que a pessoa acabou de contar: o último relato da linha do tempo (a aula abre logo depois dele); sem ele, o inicial."""
    t = ""
    for ln in reversed(c.get("linha", [])):
        m = re.search(r"relato:\s*(.*?)(?:\s·\s(?:sinais|nível|nivel|dor)\b.*)?$", ln.get("texto", ""))
        if m and len(m.group(1).split()) >= 4:
            t = m.group(1).strip()
            break
    if not t:
        t = next((r.split(":", 1)[1].strip() for r in c.get("resumo", []) if r.startswith("relato inicial:")), "")
    t = _SAUDACAO.sub("", t).strip()
    if len(t) > 220:
        corte = t[:220].rsplit(". ", 1)[0]
        t = corte if len(corte) > 60 else t[:220].rsplit(" ", 1)[0]
    return t.rstrip(" ,;…") if t.endswith(("?", "!")) else t.rstrip(" .,;…")


def _chave(p):
    """Nome sem as palavras de lado: 'Rim direito' e 'Ureter direito' não são a mesma coisa."""
    return _raizes(p["nome"]) - {"direi", "esque"}


def _nota_estudo(e, c, ids, texto):
    """Quanto a aula cobre o caso. As primeiras estruturas do caso são as da queixa: pesam mais que as vizinhas."""
    estr = c.get("estruturas", [])
    peso = {x["id"]: (4, 3, 2)[i] if i < 3 else 1 for i, x in enumerate(estr)}
    s = sum(peso.get(p["id"], 0) * (2 if p["papel"] == "principal" else 1) for p in e["pecas"])
    if c.get("regiao") and e.get("regiao") == c["regiao"]:
        s += 4
    if c.get("queixa_id") and c["queixa_id"] in e.get("queixas", []):
        s += 10                                          # a aula é, por roteiro, a dessa queixa (dor de cabeça → encéfalo)
    titulo = _norm(e["titulo"])
    if any(titulo in _norm(x["nome"]) or _norm(x["nome"]) in titulo for x in estr[:3]):
        s += 8                                           # a aula tem o nome de uma das estruturas da queixa
    s += 2 * sum(1 for w in _raizes(e["titulo"], 4) if w in texto)
    return s


def _sem_outro_lado(e, lado):
    """Tira da aula as peças do lado que não é o da queixa (e tudo que dependia delas)."""
    fora = {p["id"] for p in e["pecas"] if _do_outro_lado(p, lado)}
    if not fora:
        return e
    e["pecas"] = [p for p in e["pecas"] if p["id"] not in fora]
    e["pontos"] = [p for p in e["pontos"] if p["comp"] not in fora]
    e["montagem"]["ordem"] = [i for i in e["montagem"]["ordem"] if i not in fora]
    e["problemas"] = [dict(p, afeta=[a for a in p["afeta"] if a not in fora]) for p in e["problemas"] if p["origem"] not in fora]
    if not any(p["papel"] == "principal" for p in e["pecas"]) and e["pecas"]:
        e["pecas"][0]["papel"] = "principal"
    return e


def _estudo_do_caso(c, d, desc):
    ids = [x["id"] for x in c.get("estruturas", [])]
    texto = _raizes(" ".join([c.get("titulo", "")] + c.get("causas", []) + c.get("nao_perder", []) + c.get("hipoteses", [])), 4)
    melhor = max(d["estudos"], key=lambda e: _nota_estudo(e, c, ids, texto), default=None)
    if melhor and _nota_estudo(melhor, c, ids, texto) >= 4:
        return _sem_outro_lado(copy.deepcopy(melhor), c.get("lado"))
    # nenhuma aula cobre este caso: monta uma só com as estruturas dele
    pecas = []
    for x in c.get("estruturas", []):
        if _SEXO.search(x["id"]) or _do_outro_lado(x, c.get("lado")):
            continue
        p = _peca({"id": x["id"], "papel": "parte" if pecas else "principal"}, desc)
        if p:
            pecas.append(p)
    if not pecas:
        return None
    lugar = c.get("regiao_nome") or c.get("titulo", "")
    return dict(id="caso", titulo=lugar, subtitulo="", sistema=pecas[0]["sistema"], regiao=c.get("regiao", ""),
                cor=pecas[0]["cor"], resumo="", intro="", pecas=pecas[:_MAX_EXTRAS + 2], ausentes=[], pontos=[], problemas=[],
                montagem=dict(ordem=[p["id"] for p in pecas], texto="As estruturas desta região se juntam, uma a uma, no lugar delas."),
                corpo=dict(texto=f"Esta é a região que você descreveu: {lugar}.", sistemas=sorted({p["sistema"] for p in pecas}), ajuda=""))


def para_caso(cid=""):
    """Aula do atlas para um caso (o ativo, se `cid` vier vazio). None quando não há caso ou nada a mostrar."""
    import casos
    import painel
    c = painel._caso_json(casos.obter(cid) if cid else casos.ativo())
    if not c:
        return None
    d = dados()
    base = json.loads(ARQUIVO.read_text(encoding="utf-8"))
    desc = base.get("descricoes", {})
    e = _estudo_do_caso(c, d, desc)
    if not e:
        return None
    lado = c.get("lado") if c.get("lado") in ("direito", "esquerdo") else ""
    lugar = c.get("regiao_nome") or ""
    onde = lugar + (f", lado {lado}" if lado and lado not in _norm(lugar) else "")
    ids = {x["id"] for x in c.get("estruturas", [])}
    # estruturas do caso que a aula ainda não tem (do lado certo, sem anatomia sexo-específica)
    tem = {p["id"] for p in e["pecas"]}
    extras = 0
    for x in c.get("estruturas", [])[:5]:                 # só as primeiras do caso (as da queixa); as vizinhas distantes poluem a aula
        if x["id"] in tem or extras >= _MAX_EXTRAS or _SEXO.search(x["id"]) or _do_outro_lado(x, lado):
            continue
        p = _peca({"id": x["id"], "papel": "parte"}, desc)
        if not p or any(q["sistema"] == p["sistema"] and _chave(q) & _chave(p) for q in e["pecas"]):
            continue                                   # a aula já tem essa estrutura sob outro nome (coluna lombar ≈ vértebras lombares)
        e["pecas"].append(p)
        e["montagem"]["ordem"].insert(max(len(e["montagem"]["ordem"]) - 1, 0), p["id"])
        extras += 1
    # o que é do caso: está na lista dele ou tem nome parecido com uma estrutura ou nota anatômica dele
    familia = _raizes(" ".join([x["nome"] for x in c.get("estruturas", [])] + c.get("anatomia", [])))
    for p in e["pecas"]:
        p["rel"] = p["id"] in ids or bool(_raizes(p["nome"]) & familia)
    por_id = {p["id"]: p for p in e["pecas"]}
    # pontos: o que importa para a pessoa vem primeiro; cada estrutura do caso ganha o seu, com aproximação
    pontos = [dict(pt, rel=por_id[pt["comp"]]["rel"]) for pt in e["pontos"] if pt["comp"] in por_id]
    cobertos = {pt["comp"] for pt in pontos}
    for p in e["pecas"]:
        if p["rel"] and p["id"] not in cobertos and p["papel"] != "contexto":
            pontos.append(dict(comp=p["id"], a=[0, 0, 0], titulo=p["nome"], texto=p["desc"], atencao="", rel=True))
    dita, usadas = False, set()                        # "região que você descreveu" abre só o primeiro ponto; cada nota anatômica, uma vez
    for pt in pontos:
        p = por_id[pt["comp"]]
        if not pt["rel"]:
            pt["caso"] = ""
            continue
        alvo = _raizes(p["nome"] + " " + pt["titulo"])
        nota = max((n for n in c.get("anatomia", []) if n not in usadas), key=lambda n: len(_raizes(n) & alvo), default="")
        if nota and _raizes(nota) & alvo:
            pt["caso"] = nota
            usadas.add(nota)
        elif onde and not dita:
            pt["caso"], dita = f"Fica na região que você descreveu: {onde}.", True
        else:
            pt["caso"] = "Também entra no que você descreveu." if p["id"] in ids else ""
    pontos.sort(key=lambda pt: not pt["rel"])          # estável: a ordem do roteiro se mantém dentro de cada grupo
    e["pontos"] = pontos[:_MAX_PONTOS]
    # impactos ligados à queixa: origem ou afetadas do caso, ou palavras das possibilidades que o BMX levantou
    possib = c.get("causas", []) + c.get("nao_perder", [])
    chaves = _raizes(" ".join(possib + [c.get("titulo", ""), _relato(c)]), 5) - _GENERICAS

    sim = [x["sinal"] for x in c["discriminadores"] if x["estado"] == "sim"]
    nao = [x["sinal"] for x in c["discriminadores"] if x["estado"] == "nao"]
    falta = [x["sinal"] for x in c["discriminadores"] if not x["estado"] and not _SO_CRIANCA.search(x["sinal"])]

    def _pontua(pr):
        s = (2 if pr["origem"] in ids else 0) + sum(1 for a in pr["afeta"] if a in ids)
        s += 2 * len((_raizes(pr["titulo"] + " " + pr["mecanismo"]) - _GENERICAS) & chaves)
        sinais = _raizes(" ".join(pr.get("sinais", [])))
        return s + 2 * len(sinais & _raizes(" ".join(sim))) - 2 * len(sinais & _raizes(" ".join(nao)))   # confirmado sobe, descartado desce
    ordem = sorted(e["problemas"], key=_pontua, reverse=True)
    e["problemas"] = [pr for pr in ordem if _pontua(pr) > 0][:_MAX_PROBLEMAS] or ordem[:1]
    citadas = set()
    for pr in e["problemas"]:
        x = next((x for x in possib if x not in citadas
                  and (_raizes(x) - _GENERICAS) & (_raizes(pr["titulo"] + " " + pr["mecanismo"]) - _GENERICAS)), "")
        pr["motivo"] = f"Uma das possibilidades que o BMX considera: {x}." if x else ""
        citadas.add(x)
    relato = _relato(c)
    e["intro_caso"] = ((f"Você me contou: {relato}{'' if relato.endswith(('?', '!')) else '.'} " if relato else "") +
                       (f"Vou mostrar no corpo onde isso acontece: {onde}." if onde else "Vou mostrar no corpo onde isso acontece."))
    nivel = c.get("nivel", "")
    # a aula abre pelo contexto: o que a pessoa contou, o que confirmou e o que descartou, e onde isso fica no corpo
    ctx = [f"Você me contou: {relato}{'' if relato.endswith(('?', '!')) else '.'}"] if relato else []
    if c.get("dor_ultima") or c.get("dor_max"):
        ctx.append(f"A sua dor está em {c.get('dor_ultima') or c.get('dor_max')} de 10.")
    if sim:
        ctx.append(f"Você confirmou: {_lista(sim)}.")
    if nao:
        ctx.append(f"Você descartou: {_lista(nao)}.")
    ctx.append(f"Vou mostrar no corpo onde isso acontece: {onde}." if onde else "Vou mostrar no corpo onde isso acontece.")
    e["contexto_caso"] = " ".join(ctx)
    fecho = []
    proximo = falta[0] if falta else ""
    if proximo:
        fecho.append(f"Ainda falta checar: {proximo}.")
    if nivel:
        fecho.append(f"O BMX classificou o seu caso como {c.get('nivel_nome', nivel).lower()}."
                     + (" Siga a orientação que ele deu na conversa." if nivel in ("urgente", "emergencia") else ""))
    fecho.append("Isto é informação para conversar com um profissional, não um diagnóstico. Vou abrir o painel do caso.")
    e["fecho_caso"] = " ".join(fecho)
    e["conversa"] = dict(titulo=c.get("titulo", ""), onde=onde, lado=lado, relato=relato, nivel=nivel,
                         nivel_nome=c.get("nivel_nome", ""), dor=c.get("dor_ultima") or c.get("dor_max") or "",
                         confirmou=sim, descartou=nao, falta=falta[:3], proximo=proximo)
    assin = hashlib.sha1(json.dumps([sorted(ids), sim, nao, nivel, c.get("lado", "")], ensure_ascii=False).encode()).hexdigest()[:12]
    return dict(aviso=d.get("aviso", ""), estudos=[e], caso=c["id"], assinatura=assin, modo="caso")


if __name__ == "__main__":     # python atlas.py: confere os estudos sem subir o servidor
    d = dados()
    print(d["biblioteca"])
    for e in d["estudos"]:
        print(f"{e['id']:14} peças={len(e['pecas']):2} pontos={len(e['pontos'])} problemas={len(e['problemas'])} ausentes={e['ausentes']}")
