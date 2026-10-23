"""
Testes de aceite do BMX (PRD, seção 13). Rodam numa cópia temporária do cofre:
o conhecimento é copiado do cofre real, pacientes e operações começam vazios.

    python testes/teste_bmx.py

1. Vinhetas: 20 relatos (10 com sinal de alerta) — o alerta tem que aparecer
   em todos os que devem, e em nenhum dos tranquilos; a queixa de entrada e a
   região do corpo têm que ser as esperadas.
2. Caso: abrir, retomar, marcar sinais (no relato e por sim/não curto),
   nível só sobe, encerrar, ficha.
3. Isolamento: nada de um paciente aparece no contexto do outro.
"""
import os
import json
import pathlib
import shutil
import sys
import tempfile

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def _cofre_real():
    env = RAIZ / ".env"
    for ln in (env.read_text(encoding="utf-8").splitlines() if env.exists() else []):
        if ln.startswith("BMX_VAULT="):
            return pathlib.Path(ln.split("=", 1)[1].strip())
    return pathlib.Path(os.environ.get("BMX_VAULT", ""))


TMP = pathlib.Path(tempfile.mkdtemp(prefix="bmx-teste-"))
shutil.copytree(_cofre_real() / "40-Conhecimento", TMP / "40-Conhecimento",
                ignore=shutil.ignore_patterns("*.glb"))
(TMP / "10-Pacientes" / "P0001").mkdir(parents=True)
os.environ.update(BMX_VAULT=str(TMP), BMX_STATE=str(TMP / "state.json"), BMX_PACIENTE="P0001")

import anatomia  # noqa: E402
import casos     # noqa: E402
import clinica   # noqa: E402
import commands  # noqa: E402
import memory    # noqa: E402
import safety    # noqa: E402

FALHAS = []


def confere(cond, msg):
    print(("  ok    " if cond else "  FALHA ") + msg)
    if not cond:
        FALHAS.append(msg)


# ── 1. vinhetas ─────────────────────────────────────────────────
# (relato, alerta esperado?, queixa esperada ou None, região esperada ou None)
VINHETAS = [
    ("estou com um aperto no peito que vai pro braço esquerdo", True, "dor-toracica", "torax"),
    ("minha boca ficou torta e a fala enrolada", True, None, None),
    ("não consigo respirar direito, lábios roxos", True, None, None),
    ("minha garganta está fechando depois que comi camarão", True, None, "pescoco"),
    ("ele teve uma convulsão agora", True, None, None),
    ("estou vomitando sangue", True, "vomito-diarreia", None),
    ("tomei uma cartela inteira de remédio", True, None, None),
    ("não quero mais viver", True, None, None),
    ("é a pior dor de cabeça da minha vida", True, "cefaleia", "cabeca"),
    ("meu pai desmaiou e não acorda", True, None, None),
    ("estou com dor no joelho direito quando subo escada", False, "dor-membros", "coxa-joelho"),
    ("tenho dor nas costas desde que carreguei peso", False, "dor-lombar", "lombar"),
    ("febre de 38 há dois dias e dor no corpo", False, "febre", None),
    ("ardência ao urinar desde ontem", False, "urinario", "suprapubica"),
    ("dor de garganta e nariz escorrendo", False, "garganta-gripe", "pescoco"),
    ("torci o pé jogando bola", False, "trauma-entorse", "perna-pe"),
    ("tontura quando levanto da cama", False, "tontura", "cabeca"),
    ("azia depois do almoço", False, None, "epigastrio"),
    ("dor de barriga e diarreia", False, "dor-abdominal", None),
    ("formigamento na mão direita à noite", False, None, "punho-mao"),
]
# a região principal (a primeira) é a que abre o caso
PRINCIPAL = [
    ("estou com dor na barriga do lado direito embaixo desde ontem, com enjoo", "fossa-iliaca-direita"),
    ("dor de cabeça e enjoo", "cabeca"),
]


def vinhetas():
    print("\n1. Vinhetas (alerta, queixa, região)")
    com_alerta = sum(1 for v in VINHETAS if v[1])
    confere(com_alerta == 10 and len(VINHETAS) == 20, f"20 vinhetas, 10 com alerta ({len(VINHETAS)}, {com_alerta})")
    for relato, alerta, queixa, regiao in VINHETAS:
        a = safety.check(relato)
        qs = [q["id"] for q in clinica.identificar(relato)]
        rel = anatomia.relacionar(relato)
        ok = bool(a) == alerta
        ok_q = queixa is None or queixa in qs
        ok_r = regiao is None or bool(rel and regiao in rel["regioes"])
        confere(ok and ok_q and ok_r,
                f"{relato[:48]:48} alerta={'sim' if a else 'não'} queixa={qs[:1]} região={(rel or {}).get('regioes', [])[:1]}")
    for relato, regiao in PRINCIPAL:
        rel = anatomia.relacionar(relato)
        confere(bool(rel) and rel["regioes"][0] == regiao, f"região principal de '{relato[:40]}' = {regiao} ({(rel or {}).get('regioes', [''])[0]})")
    # regressões achadas testando com pacientes simulados (negação, jeito de falar, alerta de coluna)
    neg = [q["id"] for q in clinica.identificar("não tenho formigamento nem febre, e dói mais quando me abaixo")]
    confere("febre" not in neg, f"'nem febre' não abre queixa de febre ({neg})")
    confere("febre" in [q["id"] for q in clinica.identificar("estou com febre desde ontem")], "'estou com febre' continua casando")
    lomb = anatomia.relacionar("estou com dor na parte de baixo das costas desde ontem")
    confere(bool(lomb) and "lombar" in lomb["regioes"], "'parte de baixo das costas' leva à região lombar")
    confere(bool(safety.check("sinto a perna dormente e não estou conseguindo segurar o xixi")),
            "perda de controle do xixi dispara alerta")
    confere(bool(safety.check("não consigo respirar")), "'não consigo respirar' continua em alerta (não é negação)")


# ── 2. ciclo do caso ────────────────────────────────────────────
def ciclo_caso():
    print("\n2. Caso: abrir, retomar, sinais, nível, encerrar, ficha")
    relato = "estou com dor no joelho direito há uma semana"
    qs, rel = clinica.identificar(relato), anatomia.relacionar(relato)
    c, como = casos.resolver(relato, qs, rel)
    confere(c is not None and como == "aberto", f"abre caso novo ({como})")
    confere(c.get("lado") == "direito" and c.get("regiao") == "coxa-joelho", "guarda região e lado")
    confere(len(c["discriminadores"]) >= 3,
            f"sinais de risco da queixa entram como não perguntados ({len(c['discriminadores'])})")

    at = "2026-10-22 10h00 — P0001"
    c = casos.turno(c, relato, "Entendi. Está inchado, quente ou vermelho? [nível: consulta]",
                    at, queixas=qs, rel=rel, analise="Análise — Coxa e joelho")
    confere(c["nivel"] == "consulta", f"nível vem da marcação do BMX ({c['nivel']})")
    confere(len(c["linha"]) == 1 and bool(c["plano"]), "linha do tempo e plano registrados")

    r = "a junta está quente e estou com febre"
    mesmo, como = casos.resolver(r, clinica.identificar(r), anatomia.relacionar(r))
    confere(mesmo["caso"] == c["caso"] and como == "ativo", f"sintoma sem região fica no caso em foco ({como})")

    c = casos.turno(c, "não", "Certo. Consegue apoiar o peso?", at, queixas=qs,
                    pergunta_anterior="Está inchado, quente ou vermelho?")
    neg = [d["sinal"] for d in c["discriminadores"] if d["estado"] == "nao"]
    confere(any("inchada" in s or "quente" in s for s in neg), f"'não' curto marca o sinal perguntado ({neg})")

    c = casos.turno(c, "a junta está quente e estou com febre", "Isso pede avaliação hoje. [nível: urgente]",
                    at, queixas=qs, dor=7)
    sim = [d["sinal"] for d in c["discriminadores"] if d["estado"] == "sim"]
    confere(bool(sim), f"sinal citado no relato vira 'sim' ({sim})")
    # regressão: "dor de cabeça" marcava "batida na cabeça" como sim (round(2 × 0,6) = 1: bastava uma palavra)
    sinal = [dict(sinal="depois de batida na cabeça")]
    falso = casos._marcar(sinal, "estou com uma dor de cabeça forte desde hoje cedo", "")
    confere(falso == {}, f"'dor de cabeça' não marca 'batida na cabeça' ({falso})")
    certo = casos._marcar(sinal, "foi depois que bati a cabeça na porta", "")
    confere(certo.get("depois de batida na cabeça") == "sim", f"'bati a cabeça' marca o sinal ({certo})")
    confere(c["nivel"] == "urgente" and c["dor_max"] == "7",
            f"nível sobe e dor máxima registrada ({c['nivel']}, {c['dor_max']})")

    c = casos.turno(c, "melhorou", "Que bom. [nível: autocuidado]", at)
    confere(c["nivel"] == "urgente", "nível não desce sozinho (RN-04)")

    casos.soltar()
    r = "o joelho continua doendo"
    c2, como = casos.resolver(r, clinica.identificar(r), anatomia.relacionar(r))
    confere(bool(c2) and c2["caso"] == c["caso"] and como == "retomado", f"mesma região retoma o caso ({como})")

    r = "estou com dor de cabeça"
    c3, como = casos.resolver(r, clinica.identificar(r), anatomia.relacionar(r))
    confere(bool(c3) and c3["caso"] != c["caso"] and como == "aberto", "queixa diferente abre outro caso")

    ctx = casos.contexto(c2, "retomado")
    confere("Caso em foco" in ctx and "melhorou" in ctx and "[nível:" in ctx, "contexto do caso orienta o modelo")

    f = casos.ficha(c)
    confere(f["caso"]["caso"] == c["caso"] and not f["hipoteses"], "ficha sai sem hipóteses por padrão")
    import painel
    html = painel.ficha_html(c["caso"])
    confere("Ficha para consulta" in html and "Sinais de alerta checados" in html, "ficha em HTML")
    d = painel.dados(c["caso"])
    confere(bool(d["caso"]["estruturas"]) and any(s["estado"] == "alerta" for s in d["sistemas"]),
            "painel traz estruturas e marca o sistema em alerta")

    c = casos.encerrar(c, "melhorou com repouso")
    confere(c["status"] == "resolvido" and bool(c["desfecho"]), "encerrar grava desfecho")
    confere(all(x["caso"] != c["caso"] for x in casos.listar()), "caso resolvido sai da lista de abertos")


# ── 3. isolamento entre pacientes ───────────────────────────────
def isolamento():
    print("\n3. Isolamento entre pacientes")
    commands.write_note("alergia", "dipirona", "dipirona, urticária")
    confere("dipirona" in commands.context_block("posso tomar dipirona?"), "P0001 vê a própria alergia")
    commands.handle("/paciente P0002 Teste")
    ctx = commands.context_block("posso tomar dipirona?")
    confere("Alergia — dipirona" not in ctx, "P0002 não vê a alergia de P0001")
    confere(not casos.listar(), "P0002 não vê os casos de P0001")
    g = memory.graph_view(force=True)
    confere(all(n["zona"] in ("pacientes", "operacoes") for n in g["nodes"]), "grafo só com paciente e operações")


def investigacao_pesquisada():
    print("\n4. Investigação pesquisada")
    pacote_ids = {q["id"] for q in clinica.carregar()["queixas"]}
    pesquisa = clinica.carregar_investigacao()
    confere(len(pacote_ids) >= 22 and pacote_ids <= set(pesquisa["queixas"]) and not clinica.validar(),
            "catálogo ampliado, guias completos e ligações anatômicas/fontes válidas")
    for relato, qid in [
        ("meu coração está disparado", "palpitacoes"),
        ("minha perna está inchada", "perna-inchada"),
        ("tenho dor pélvica", "dor-pelvica"),
        ("tive reação ao remédio", "reacao-medicamento"),
    ]:
        confere(qid in [q["id"] for q in clinica.identificar(relato)], f"reconhece {qid}")
    for relato in ["perna inchada e falta de ar", "palpitações e desmaiei",
                   "dor de cabeça súbita de repente", "atraso menstrual com dor forte e sangramento"]:
        confere(bool(safety.check(relato)), f"alerta fixo: {relato}")
    guia = clinica.guia("febre")
    confere(bool(guia and guia["pistas"] and guia["medicamentos"]
                 and all(x["url"].startswith("https://") for x in guia["fontes"])),
            "pistas, cuidados de medicamento e links verificados chegam juntos")
    ctx = clinica.contexto(clinica.identificar("estou com febre"))
    confere("Pistas pesquisadas" in ctx and "não dê dose" in ctx,
            "contexto do modelo recebe pistas e limite explícito de medicamento")
    import painel
    d = painel.dados()
    confere(len(d["catalogo"]) >= 22 and any(x["id"] == "dor-pelvica" for x in d["catalogo"]),
            "painel recebe catálogo pesquisável mesmo sem caso ativo")
    relato = "minha perna está inchada"
    novo, como = casos.resolver(relato, clinica.identificar(relato), anatomia.relacionar(relato))
    confere(como == "aberto" and novo["queixa_id"] == "perna-inchada"
            and painel.dados(novo["caso"])["caso"]["guia"]["id"] == "perna-inchada",
            "nova queixa abre caso e liga guia ao painel")


def imagens_remedios():
    print("\n5. Imagens dos remédios")
    raiz = RAIZ / "ui"
    catalogo = json.loads((raiz / "remedios" / "catalogo.json").read_text(encoding="utf-8"))
    temas = {"dor_febre", "antiinflamatorio", "reidratacao", "urticaria", "alivio_tosse"}
    confere(len(catalogo) == 25 and len({x["id"] for x in catalogo}) == 25,
            "25 imagens distintas catalogadas")
    confere(all(sum(x["tema"] == tema for x in catalogo) == 5 for tema in temas),
            "cinco opções por tema clínico")
    confere(all((raiz / x["arquivo"]).is_file()
                and (raiz / x["arquivo"]).read_bytes().startswith(b"\xff\xd8\xff")
                and x["fonte"].startswith("https://commons.wikimedia.org/wiki/File:")
                and x["licenca"] and x["autor"] for x in catalogo),
            "arquivos JPEG locais com origem, licença e autoria")


def estruturas_hubmap():
    print("\n6. Estruturas 3D do HuBMAP (tools/anexar_hubmap.py)")
    import struct
    pasta = RAIZ / "vault" / "40-Conhecimento" / "Anatomia"
    bib = json.loads((pasta / "malhas.json").read_text(encoding="utf-8"))["bibliotecas"]["human-atlas"]
    novas = {"utero": "suprapubica", "ovario-direito": "fossa-iliaca-direita", "ovario-esquerdo": "fossa-iliaca-esquerda",
             "colon-sigmoide": "suprapubica", "lca": "coxa-joelho"}

    def nos_do_glb(regiao):
        with open(RAIZ / "ui" / "models" / "anatomia" / "regioes" / f"{regiao}.glb", "rb") as f:
            f.read(12)
            n, _ = struct.unpack("<I4s", f.read(8))
            return {nd["name"] for nd in json.loads(f.read(n))["nodes"]}

    confere(all(s in bib["estruturas"] and s not in bib["faltando"] and len(bib["estruturas"][s]["centro"]) == 3
                for s in novas), "cinco estruturas com malha, centro e fora da lista de faltando")
    confere(all(s in nos_do_glb(r) for s, r in novas.items()), "cada estrutura é um nó do GLB da sua região")
    confere(all(s in bib["regioes"][r]["estruturas"] for s, r in novas.items()), "regiões listam as estruturas novas")
    u, b = bib["estruturas"]["utero"]["centro"], bib["estruturas"]["bexiga"]
    confere(u[1] > b["centro"][1] and u[2] < b["centro"][2], "útero fica acima e atrás da bexiga")
    confere(set(bib["estruturas"]["lca"]["lados"]) == {"direito", "esquerdo"}, "LCA nos dois joelhos")
    confere("HuBMAP" in (RAIZ / "ui" / "models" / "anatomia" / "ATTRIBUTION.md").read_text(encoding="utf-8"),
            "autoria do HuBMAP (CC BY 4.0) registrada")


if __name__ == "__main__":
    try:
        vinhetas()
        ciclo_caso()
        isolamento()
        investigacao_pesquisada()
        imagens_remedios()
        estruturas_hubmap()
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
    print(f"\n{'TUDO OK' if not FALHAS else str(len(FALHAS)) + ' FALHA(S)'}")
    sys.exit(1 if FALHAS else 0)
