"""
Investigação anatômica do BMX: relato -> regiões -> estruturas -> malhas 3D.

O catálogo (40-Conhecimento/Anatomia/catalogo-anatomico.json no cofre) diz
quais estruturas existem, em que região e camada ficam, e quais sintomas
apontam para elas. A cada pergunta, relacionar() acha as estruturas ligadas
ao relato; o servidor manda isso para a interface (evento `anatomia`, para
destacar a região) e para o modelo (bloco de contexto), que fala em
possibilidades, nunca em diagnóstico.

A malha de cada estrutura vem de uma biblioteca 3D (BodyParts3D, Human Atlas,
Z-Anatomy...). A ponte é o FMA ID: `python anatomia.py indexar <pasta>` lê a
biblioteca baixada e grava malhas.json ao lado do catálogo.

    python anatomia.py validar             confere ids cruzados do catálogo
    python anatomia.py notas               gera as notas de Bibliotecas/Sistemas/Regiões
    python anatomia.py indexar <pasta> [--biblioteca bodyparts3d]
    python anatomia.py exportar <pasta-human-atlas/models>   gera GLBs por camada e região em ui/models/anatomia
    python anatomia.py testar <relato>     mostra o bloco que iria para o modelo
"""
import datetime
import json
import pathlib
import re
import sys
import threading

import memory
import safety

PASTA = memory.VAULT / memory.ZONAS["conhecimento"] / "Anatomia"
CATALOGO = PASTA / "catalogo-anatomico.json"
MALHAS = PASTA / "malhas.json"
AMPLIACAO = PASTA / "ampliacao.json"   # estruturas extras geradas por tools/ampliar_biblioteca.py
MALHA_EXT = {".obj", ".glb", ".gltf", ".stl", ".fbx"}

_CACHE = {"sig": None, "cat": None, "malhas": {}}
_LOCK = threading.Lock()


def _mtime(p):
    try:
        return p.stat().st_mtime
    except OSError:
        return 0


def carregar():
    """Catálogo + índice de malhas, recarregados quando o arquivo muda."""
    with _LOCK:
        sig = (_mtime(CATALOGO), _mtime(MALHAS), _mtime(AMPLIACAO))
        if _CACHE["cat"] is not None and sig == _CACHE["sig"]:
            return _CACHE["cat"], _CACHE["malhas"]
        try:
            cat = json.loads(CATALOGO.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            cat = {"estruturas": {}, "regioes": {}, "sintomas": [], "camadas": {}, "sistemas": {}, "bibliotecas": {}}
        malhas = {}
        try:
            for bib, dados in json.loads(MALHAS.read_text(encoding="utf-8")).get("bibliotecas", {}).items():
                for slug, m in dados.get("estruturas", {}).items():
                    malhas.setdefault(slug, {})[bib] = m
        except (OSError, json.JSONDecodeError):
            pass
        try:   # o catálogo escrito à mão vence: a ampliação só acrescenta o que ele não tem
            amp = json.loads(AMPLIACAO.read_text(encoding="utf-8"))
            for slug, e in amp.get("estruturas", {}).items():
                cat["estruturas"].setdefault(slug, e)
                if slug in amp.get("malhas", {}):
                    malhas.setdefault(slug, {}).setdefault("human-atlas", amp["malhas"][slug])
        except (OSError, json.JSONDecodeError):
            pass
        _CACHE.update(sig=sig, cat=cat, malhas=malhas)
        return cat, malhas


_NEGA = re.compile(r"\b(nao|nem|sem|nunca|nenhum|nenhuma)\b")
# "não consigo respirar" e "não estou conseguindo segurar o xixi" são queixas, não negação do sintoma
_CAPAZ = re.compile(r"\b(consig\w*|consegu\w*|posso|pode|aguento|paro|urino|evacuo|enxergo|ouco|mexo|falo|ando|sinto)\b")


def _negado(norm, inicio):
    """O termo que começa em `inicio` está negado ("não tenho febre", "nem febre", "sem tosse")?
    Olha só as 3 palavras antes dele, para uma negação de outra frase não contaminar."""
    janela = " ".join(norm[:inicio].split()[-3:])
    return bool(_NEGA.search(janela)) and not _CAPAZ.search(janela)


def _tem(norm, termo):
    for m in re.finditer(r"\b" + re.escape(safety._norm(termo)) + r"\b", norm):
        if not _negado(norm, m.start()):
            return True
    return False


def relacionar(message, limite=8):
    """Estruturas ligadas ao relato, em ordem de relevância. None se nada bater."""
    cat, malhas = carregar()
    norm = safety._norm(message)
    if not norm or norm.startswith("/") and not norm.startswith(("/sintoma", "/dor", "/triagem")):
        return None
    # o termo mais específico (mais longo) manda: "dor na barriga do lado direito" vence "enjoo"
    achados = []
    for s in cat.get("sintomas", []):
        termos = [t for t in s["termos"] if _tem(norm, t)]
        if termos:
            achados.append((max(len(t) for t in termos), s))
    # a localização dita em palavras soltas ("dor na barriga, na parte de baixo do lado direito") não cai nos termos
    # fixos do catálogo ("dor na barriga do lado direito"): junta barriga + baixo/cima + lado e vence sintomas genéricos
    if re.search(r"\b(barriga|abdome|abdomen|ventre)\b", norm):
        lado_ = "direito" if re.search(r"\bdireit", norm) else "esquerdo" if re.search(r"\besquerd", norm) else ""
        pos = "inferior" if re.search(r"\b(baixo|embaixo|inferior)\b", norm) else "superior" if re.search(r"\b(cima|superior|costela)", norm) else ""
        alvo = next((x for x in cat.get("sintomas", []) if x["id"] == f"abdome-{pos}-{lado_}"), None) if pos and lado_ else None
        if alvo and all(alvo is not x for _, x in achados):
            achados.append((99, alvo))
    sintomas = [s for _, s in sorted(achados, key=lambda par: -par[0])]
    citadas = [k for k, e in cat.get("estruturas", {}).items()
               if len(e["nome"]) > 4 and _tem(norm, e["nome"].split(" (")[0])]
    if not sintomas and not citadas:
        return None

    ordem, regioes = [], []
    for k in citadas + [e for s in sintomas for e in s["estruturas"]]:
        if k in cat["estruturas"] and k not in ordem:
            ordem.append(k)
    for k in [r for s in sintomas for r in s["regioes"]] + [r for k in ordem for r in cat["estruturas"][k]["regioes"]]:
        if k in cat.get("regioes", {}) and k not in regioes:
            regioes.append(k)

    lado = "direito" if re.search(r"\bdireit", norm) else "esquerdo" if re.search(r"\besquerd", norm) else ""
    return dict(sintomas=[s["id"] for s in sintomas], regioes=regioes[:4], lado=lado,
                estruturas=detalhar(ordem[:limite]),
                notas=[s["nota"] for s in sintomas][:3], atencao=[s["atencao"] for s in sintomas][:3])


def detalhar(ids):
    """Estruturas do catálogo prontas para a interface: camada, cor, FMA, malhas, centro e lados em 3D."""
    cat, malhas = carregar()
    camadas, out = cat.get("camadas", {}), []
    for k in ids:
        e = cat["estruturas"].get(k)
        if not e:
            continue
        m = malhas.get(k, {})
        out.append(dict(
            id=k, nome=e["nome"], nome_en=e["nome_en"], sistema=e["sistema"], camada=e["camada"],
            regioes=e["regioes"], cor=camadas.get(e["camada"], {}).get("cor", "#8a9bb0"),
            fma=next((v.get("fma") for v in m.values() if v.get("fma")), ""),
            malhas={bib: v.get("arquivos", [])[:4] for bib, v in m.items()},
            raio=next((v["raio"] for v in m.values() if v.get("raio")), 0),
            descricao=e.get("descricao", ""),
            centro=next((v["centro"] for v in m.values() if v.get("centro")), None),
            lados=next((v["lados"] for v in m.values() if v.get("lados")), {})))
    return out


def regiao_3d(regiao):
    """Centro, raio e arquivo da região no corpo 3D (para enquadrar a câmera)."""
    _, _ = carregar()
    try:
        bibs = json.loads(MALHAS.read_text(encoding="utf-8")).get("bibliotecas", {})
    except (OSError, json.JSONDecodeError):
        return None
    return (bibs.get("human-atlas", {}).get("regioes", {}) or {}).get(regiao)


def contexto(rel):
    """Bloco do prompt: o que a investigação visual vai destacar e por quê."""
    if not rel:
        return ""
    cat, _ = carregar()
    nomes_r = [cat["regioes"][r]["nome"] for r in rel["regioes"]]
    out = ["## Investigação anatômica (catálogo local)",
           "A interface vai destacar estas estruturas no corpo 3D. São as estruturas da região do relato, "
           "não um diagnóstico: use-as para explicar onde fica cada coisa e o que ajudaria a diferenciar.",
           "Regiões: " + ", ".join(nomes_r),
           "Estruturas: " + "; ".join(f"{e['nome']} ({cat['sistemas'].get(e['sistema'], {}).get('nome', e['sistema'])})"
                                      for e in rel["estruturas"])]
    if rel["notas"]:
        out.append("Anatomia: " + " ".join(rel["notas"]))
    if rel["atencao"]:
        out.append("Sinais que mudam o nível de atendimento: " + " ".join(rel["atencao"]))
    return "\n".join(out)


# ── manutenção (linha de comando) ────────────────────────────────
def validar():
    cat, _ = carregar()
    erros = []
    est, reg = cat["estruturas"], cat["regioes"]
    for k, e in est.items():
        if e["sistema"] not in cat["sistemas"]:
            erros.append(f"estrutura {k}: sistema {e['sistema']} não existe")
        if e["camada"] not in cat["camadas"]:
            erros.append(f"estrutura {k}: camada {e['camada']} não existe")
        erros += [f"estrutura {k}: região {r} não existe" for r in e["regioes"] if r not in reg]
    for k, r in reg.items():
        erros += [f"região {k}: vizinha {v} não existe" for v in r["vizinhas"] if v not in reg]
    for s in cat["sintomas"]:
        erros += [f"sintoma {s['id']}: estrutura {e} não existe" for e in s["estruturas"] if e not in est]
        erros += [f"sintoma {s['id']}: região {r} não existe" for r in s["regioes"] if r not in reg]
    return erros


def _fm(tipo, extra=""):
    return f"---\ntype: {tipo}\ngerado: catalogo-anatomico.json\nupdated: {datetime.date.today().isoformat()}\n{extra}---\n\n"


AVISO = "> Nota gerada a partir de `catalogo-anatomico.json` (`python anatomia.py notas`). Edite o catálogo, não esta nota.\n\n"


def gerar_notas():
    cat, malhas = carregar()
    est, reg, sis = cat["estruturas"], cat["regioes"], cat["sistemas"]
    t_reg = {k: f"Região — {r['nome']}" for k, r in reg.items()}
    t_sis = {k: s["nome"] for k, s in sis.items()}
    escritos = []

    def grava(rel, texto):
        f = PASTA / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(texto, encoding="utf-8")
        escritos.append(rel)

    def fma(k):
        v = next((m.get("fma") for m in malhas.get(k, {}).values() if m.get("fma")), "")
        return f" · `{v}`" if v else ""

    for k, r in reg.items():
        linhas = [f"- {e['nome']} · {e['nome_en']} · [[{t_sis[e['sistema']]}]]{fma(sk)}"
                  for sk, e in est.items() if k in e["regioes"]]
        sint = [s for s in cat["sintomas"] if k in s["regioes"]]
        grava(f"Regiões/{t_reg[k]}.md", _fm("regiao", f"regiao: {k}\n") + f"# {t_reg[k]}\n\n" + AVISO
              + "Parte da [[Anatomia — Índice]].\n\n## Estruturas\n" + "\n".join(linhas)
              + "\n\n## Vizinhas\n" + ", ".join(f"[[{t_reg[v]}]]" for v in r["vizinhas"])
              + ("\n\n## Relatos que apontam aqui\n" + "\n".join(f"- **{s['id']}**: {s['nota']}" for s in sint) if sint else "")
              + "\n")

    for k, s in sis.items():
        linhas = [f"- {e['nome']} · {e['nome_en']} · " + ", ".join(f"[[{t_reg[r]}]]" for r in e["regioes"]) + fma(sk)
                  for sk, e in est.items() if e["sistema"] == k]
        grava(f"Sistemas/{t_sis[k]}.md", _fm("sistema", f"sistema: {k}\ncamada: {s['camada']}\n")
              + f"# {t_sis[k]}\n\n" + AVISO + f"Parte da [[Anatomia — Índice]]. Camada 3D: **{cat['camadas'][s['camada']]['nome']}**.\n\n"
              + "## Estruturas\n" + "\n".join(linhas) + "\n")

    for k, b in sorted(cat["bibliotecas"].items(), key=lambda kv: kv[1]["prioridade"]):
        grava(f"Bibliotecas/{b['nome'].split(' (')[0]}.md", _fm("biblioteca", f"biblioteca: {k}\nprioridade: {b['prioridade']}\n")
              + f"# {b['nome']}\n\n" + AVISO + "Parte da [[Anatomia — Índice]] · ver [[Pipeline 3D]].\n\n"
              + f"- **Endereço:** {b['url'] or '— (não localizado)'}\n- **Licença:** {b['licenca']}\n"
              + f"- **Formato:** {b['formato']}\n- **Conteúdo:** {b['estruturas']}\n"
              + f"- **Verificado:** {b['verificado']}\n- **Papel no BMX:** {b['papel']}\n")

    linhas = []
    for s in cat["sintomas"]:
        linhas.append(f"### {s['id']}\n- termos: {', '.join(s['termos'])}\n- regiões: "
                      + ", ".join(f"[[{t_reg[r]}]]" for r in s["regioes"])
                      + "\n- estruturas: " + ", ".join(est[e]["nome"] for e in s["estruturas"])
                      + f"\n- anatomia: {s['nota']}\n- atenção: {s['atencao']}\n")
    grava("Mapa sintoma → região.md", _fm("anatomia") + "# Mapa sintoma → região\n\n" + AVISO
          + "Como o BMX liga um relato às estruturas que a interface destaca. Os termos são procurados no texto "
            "sem acento; todos os sintomas que batem somam regiões e estruturas. Parte da [[Anatomia — Índice]].\n\n"
          + "\n".join(linhas))
    return escritos


def _norm_nome(s):
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s.lower()).split())


def indexar(pasta, biblioteca="bodyparts3d"):
    """Liga estruturas do catálogo às malhas de uma biblioteca baixada.

    BodyParts3D: as listas *parts*.txt trazem FMA ID, ID da malha (FJ...) e o
    nome em inglês; os arquivos são FJxxxx.obj. Bibliotecas que nomeiam o
    arquivo pela estrutura (heart.glb) caem no segundo caso: nome do arquivo.
    """
    raiz = pathlib.Path(pasta).expanduser().resolve()
    arquivos = {}
    for p in raiz.rglob("*"):
        if p.suffix.lower() in MALHA_EXT:
            arquivos.setdefault(p.stem.lower(), []).append(str(p.relative_to(raiz)).replace("\\", "/"))
    conceitos = {}   # nome normalizado -> {fma, nome, arquivos}
    for lista in list(raiz.rglob("*.txt")) + list(raiz.rglob("*.tsv")):
        try:
            texto = lista.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for ln in texto.splitlines():
            cols = [c.strip() for c in ln.split("\t") if c.strip()]
            fma = next((c for c in cols if re.fullmatch(r"FMA\d+", c)), None)
            if not fma:
                continue
            ids = [c for c in cols if re.fullmatch(r"FJ\d+", c)]
            nome = next((c for c in reversed(cols) if not re.fullmatch(r"(FMA|FJ)\d+", c)), "")
            c = conceitos.setdefault(_norm_nome(nome), {"fma": fma, "nome": nome, "arquivos": []})
            c["arquivos"] += [a for i in ids for a in arquivos.get(i.lower(), []) if a not in c["arquivos"]]
    for stem, lista in arquivos.items():
        c = conceitos.setdefault(_norm_nome(stem), {"fma": "", "nome": stem, "arquivos": []})
        c["arquivos"] += [a for a in lista if a not in c["arquivos"]]

    cat, _ = carregar()
    achadas, faltando, aproximadas = {}, [], {}
    for slug, e in cat["estruturas"].items():
        alvo = _norm_nome(e["nome_en"])
        c = conceitos.get(alvo)
        if c and (c["arquivos"] or c["fma"]):
            achadas[slug] = c
            continue
        faltando.append(slug)
        perto = [v["nome"] for k, v in conceitos.items() if re.search(r"\b" + re.escape(alvo) + r"\b", k)][:6]
        if perto:
            aproximadas[slug] = perto

    try:
        atual = json.loads(MALHAS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        atual = {"bibliotecas": {}}
    atual["gerado"] = datetime.datetime.now().isoformat(timespec="seconds")
    atual["bibliotecas"][biblioteca] = dict(pasta=str(raiz), estruturas=achadas, faltando=faltando,
                                            aproximadas=aproximadas, malhas_na_pasta=sum(map(len, arquivos.values())))
    MALHAS.write_text(json.dumps(atual, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return len(achadas), faltando, aproximadas


# ── exportação do Human Atlas (BodyParts3D 4.0 já simplificado) ──
# atlas.json lista as partes (FJ…, nome, FMA, sistema, offsets) e os blocos
# body-N.bin trazem posições Float32 (metros, Y para cima), normais Int16 e
# índices Uint32. Daqui saem GLBs que a interface carrega por camada (corpo)
# e por região (estruturas do catálogo, prontas para destacar).
SAIDA_3D = memory.ROOT / "ui" / "models" / "anatomia"
SISTEMA_CAMADA = {
    "skeletal": "ossos", "connective": "ossos", "muscular": "musculos", "arterial": "arterias",
    "venous": "veias", "nervous": "nervos", "integumentary": "pele", "cardiac": "orgaos",
    "respiratory": "orgaos", "digestive": "orgaos", "urinary": "orgaos", "reproductive": "orgaos",
    "endocrine": "orgaos", "lymphatic": "orgaos", "sensory": "orgaos",
}
_LADO = re.compile(r"\b(right|left)\b")


def _glb(nos, materiais, caminho):
    """Escreve um GLB mínimo: um nó e uma malha por item de `nos`."""
    import struct
    blobs, views, accessors, meshes, nodes, off = [], [], [], [], [], 0

    def view(arr, target):
        nonlocal off
        b = arr.tobytes()
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b), "target": target})
        blobs.append(b + b"\0" * (-len(b) % 4))
        off += len(b) + (-len(b) % 4)
        return len(views) - 1

    for nome, extras, mat, pos, nor, idx in nos:
        vp, vn, vi = view(pos, 34962), view(nor, 34962), view(idx, 34963)
        a = len(accessors)
        accessors += [
            {"bufferView": vp, "componentType": 5126, "count": len(pos), "type": "VEC3",
             "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
            {"bufferView": vn, "componentType": 5126, "count": len(nor), "type": "VEC3"},
            {"bufferView": vi, "componentType": 5125, "count": len(idx), "type": "SCALAR"}]
        meshes.append({"name": nome, "primitives": [
            {"attributes": {"POSITION": a, "NORMAL": a + 1}, "indices": a + 2, "material": mat}]})
        nodes.append({"name": nome, "mesh": len(meshes) - 1, "extras": extras})
    gltf = {"asset": {"version": "2.0", "generator": "BMX anatomia.py",
                      "copyright": "BodyParts3D, © DBCLS, CC BY 4.0 (via Human Atlas)"},
            "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes,
            "materials": materiais, "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": off}]}
    js = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    js += b" " * (-len(js) % 4)
    corpo = b"".join(blobs)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(corpo)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(corpo), 0x004E4942) + corpo)
    return caminho.stat().st_size


def exportar(pasta, saida=SAIDA_3D):
    import numpy as np
    raiz = pathlib.Path(pasta).expanduser().resolve()
    atlas = json.loads((raiz / "atlas.json").read_text(encoding="utf-8"))
    bins = [np.fromfile(raiz / c["url"].split("/")[-1], dtype=np.uint8) for c in atlas["chunks"]]
    partes = {p["id"]: p for p in atlas["parts"]}

    def geo(p):
        b = bins[p["chunk"]]
        pos = np.frombuffer(b, np.float32, p["vertexCount"] * 3, p["positions"]).reshape(-1, 3)
        nor = np.frombuffer(b, np.int16, p["vertexCount"] * 3, p["normals"]).reshape(-1, 3).astype(np.float32)
        nor /= np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-6)
        return pos, nor, np.frombuffer(b, np.uint32, p["indexCount"], p["indices"])

    cat, _ = carregar()
    cores = {k: c["cor"] for k, c in cat["camadas"].items()}
    ordem_cam = list(cores)

    def material(camada):
        h = cores[camada].lstrip("#")
        rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        m = {"name": camada, "pbrMetallicRoughness": {"baseColorFactor": rgb + [0.25 if camada == "pele" else 1.0],
                                                      "metallicFactor": 0.0, "roughnessFactor": 0.65}}
        if camada == "pele":
            m["alphaMode"] = "BLEND"
        return m
    materiais = [material(c) for c in ordem_cam]

    # nome (parte ou conceito) -> ids de malha
    por_nome = {}
    for p in atlas["parts"]:
        por_nome.setdefault(p["name"].lower(), set()).add(p["id"])
    for c in atlas["concepts"]:
        por_nome.setdefault(c["name"].lower(), set()).update(e for e in c["elements"] if e in partes)

    def resolver(e):
        alvos = [e["nome_en"].lower()] + [a.lower() for a in e.get("atlas_en", [])]
        ids, achados = set(), []
        for alvo in alvos:
            if alvo.startswith("re:"):
                rx = re.compile(alvo[3:])
            else:
                if alvo in por_nome:
                    ids |= por_nome[alvo]
                    achados.append(alvo)
                    continue
                # partes nomeadas em pedaços: "clavicular part of right deltoid"
                rx = re.compile(r"(^|\b(right|left) |\bof (the )?(right |left )?)" + re.escape(alvo) + "$")
            for nome, s in por_nome.items():
                if rx.search(nome):
                    ids |= s
                    achados.append(nome)
        return sorted(ids), achados

    def caixa(ids):
        lo = np.min([partes[i]["bounds"][0] for i in ids], axis=0)
        hi = np.max([partes[i]["bounds"][1] for i in ids], axis=0)
        return ((lo + hi) / 2).round(4).tolist(), float(np.linalg.norm(hi - lo) / 2)

    # 1) camadas: o corpo inteiro, um nó por malha (nome = FJ…, para escolher e destacar)
    camadas, tamanhos = {}, {}
    for p in atlas["parts"]:
        camadas.setdefault(SISTEMA_CAMADA.get(p["system"], "orgaos"), []).append(p)
    for cam, lista in camadas.items():
        nos = [(p["id"], {"nome": p["name"], "fma": p["conceptId"], "sistema": p["system"]},
                ordem_cam.index(cam), *geo(p)) for p in lista]
        tamanhos[f"camadas/{cam}.glb"] = _glb(nos, materiais, saida / "camadas" / f"{cam}.glb")

    # 2) estruturas do catálogo e regiões
    estruturas, faltando, por_regiao = {}, [], {}
    for slug, e in cat["estruturas"].items():
        ids, achados = resolver(e)
        if not ids:
            faltando.append(slug)
            continue
        lados = {"direito": [], "esquerdo": [], "centro": []}
        for i in ids:
            m = _LADO.search(partes[i]["name"].lower())
            lados[{"right": "direito", "left": "esquerdo"}.get(m.group(1) if m else "", "centro")].append(i)
        centro, raio = caixa(ids)
        fma = next((c["id"] for c in atlas["concepts"] if c["name"].lower() == e["nome_en"].lower()), "") \
            or partes[ids[0]]["conceptId"]
        estruturas[slug] = dict(fma=fma, nome=achados[0] if achados else e["nome_en"], camada=e["camada"],
                                arquivos=[f"regioes/{r}.glb" for r in e["regioes"]],
                                partes={k: v for k, v in lados.items() if v}, centro=centro, raio=round(raio, 4),
                                lados={k: caixa(v)[0] for k, v in lados.items() if v and k != "centro"})
        for r in e["regioes"]:
            por_regiao.setdefault(r, []).append(slug)

    regioes = {}
    for r, slugs in por_regiao.items():
        nos = []
        for slug in slugs:
            pos_l, nor_l, idx_l, base = [], [], [], 0
            for i in [i for v in estruturas[slug]["partes"].values() for i in v]:
                pos, nor, idx = geo(partes[i])
                pos_l.append(pos); nor_l.append(nor); idx_l.append(idx + base); base += len(pos)
            e = cat["estruturas"][slug]
            nos.append((slug, {"nome": e["nome"], "camada": e["camada"], "fma": estruturas[slug]["fma"]},
                        ordem_cam.index(e["camada"]), np.concatenate(pos_l), np.concatenate(nor_l),
                        np.concatenate(idx_l).astype(np.uint32)))
        tamanhos[f"regioes/{r}.glb"] = _glb(nos, materiais, saida / "regioes" / f"{r}.glb")
        centro, raio = caixa([i for s in slugs for v in estruturas[s]["partes"].values() for i in v])
        regioes[r] = dict(arquivo=f"regioes/{r}.glb", centro=centro, raio=round(raio, 4), estruturas=slugs)

    (saida / "ATTRIBUTION.md").write_text(
        "# Anatomia 3D\n\nBodyParts3D 4.0, © The Database Center for Life Science, CC BY 4.0 "
        "(https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html), simplificado pelo Human Atlas "
        "(https://github.com/ashemag/human-atlas, código MIT) e reagrupado em camadas e regiões pelo BMX "
        f"(`python anatomia.py exportar`, {datetime.date.today().isoformat()}). Referência anatômica adulta "
        "masculina; uso educativo, não clínico.\n", encoding="utf-8")

    try:
        atual = json.loads(MALHAS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        atual = {"bibliotecas": {}}
    atual["gerado"] = datetime.datetime.now().isoformat(timespec="seconds")
    atual["bibliotecas"]["human-atlas"] = dict(
        pasta=str(raiz), saida=str(saida), versao=atlas.get("version"), licenca="CC BY 4.0",
        estruturas=estruturas, faltando=faltando, regioes=regioes,
        camadas={c: f"camadas/{c}.glb" for c in camadas}, malhas_na_pasta=len(partes),
        megabytes={k: round(v / 1e6, 1) for k, v in tamanhos.items()})
    MALHAS.write_text(json.dumps(atual, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return estruturas, faltando, tamanhos


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = sys.argv[1:]
    if not args or args[0] == "validar":
        erros = validar()
        print("\n".join(erros) or f"catálogo ok: {CATALOGO}")
        sys.exit(1 if erros else 0)
    if args[0] == "notas":
        print("\n".join(gerar_notas()))
    elif args[0] == "indexar" and len(args) >= 2:
        bib = args[args.index("--biblioteca") + 1] if "--biblioteca" in args else "bodyparts3d"
        n, falta, perto = indexar(args[1], bib)
        print(f"{n} estruturas ligadas a malhas; {len(falta)} sem malha exata (ver 'aproximadas' em {MALHAS.name}).")
    elif args[0] == "exportar" and len(args) >= 2:
        est, falta, tam = exportar(args[1])
        print(f"{len(est)} estruturas exportadas; sem malha nesta biblioteca: {', '.join(falta) or 'nenhuma'}")
        print(f"{len(tam)} arquivos GLB em {SAIDA_3D} · {sum(tam.values()) / 1e6:.1f} MB")
    elif args[0] == "testar" and len(args) >= 2:
        rel = relacionar(" ".join(args[1:]))
        print(contexto(rel) or "nada no catálogo para esse relato")
    else:
        print(__doc__)
