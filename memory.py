"""
Cofre do BMX -> grafo de memória (base: memory.py do jarvis-claude-code).

O cofre (BMX_VAULT, um vault do Obsidian) é dividido em zonas, e cada zona
tem um dono e uma regra de leitura:

    00-Sistema       mapa, esquemas, regras          documentação; fora do grafo
    10-Pacientes/ID  Registros/ (o que o paciente    só o paciente ativo entra
                     trouxe) e Analises/ (o que o    no grafo e no contexto
                     BMX concluiu), mais o perfil
    20-Operacoes     um atendimento por conversa     só os do paciente ativo
    30-Acessos       quem fez o quê e quando         nunca entra no grafo nem
                                                     no contexto do modelo
    40-Conhecimento  guias e anatomia                igual para todo paciente

Cada .md é um nó; o frontmatter dá o tipo; [[links]] viram arestas. Um cofre
antigo sem zonas (a pasta prontuario/ plana) continua valendo como paciente
único.

Obsidian-style memory vault -> knowledge graph. Nothing here is a database:
the memory IS a folder of markdown you can open in Obsidian, edit by hand, or
let Claude write to.
"""
import os
import pathlib
import re
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent
VAULT = pathlib.Path(os.path.expanduser(
    os.environ.get("BMX_VAULT") or os.environ.get("BMX_PRONTUARIO") or ROOT / "prontuario"))

ZONAS = {
    "sistema": "00-Sistema",
    "pacientes": "10-Pacientes",
    "operacoes": "20-Operacoes",
    "acessos": "30-Acessos",
    "conhecimento": "40-Conhecimento",
}

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]")
FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.S)

# Uma cor por tipo de nota (fundo branco: tons saturados, nada de pastel).
TYPE_COLOURS = {
    "perfil":      "#1e8fc8",
    "alergia":     "#e0453a",
    "medicamento": "#7a5af5",
    "condicao":    "#d9822b",
    "sintoma":     "#e8a317",
    "consulta":    "#159f8c",
    "exame":       "#2f6fdf",
    "habito":      "#3fa34d",
    "contato":     "#c2417e",
    "analise":     "#b5179e",
    "atendimento": "#0f766e",
    "guia":        "#5b7083",
    "anatomia":    "#a14a3b",
    "regiao":      "#c8504a",
    "sistema":     "#8c5a3c",
    "biblioteca":  "#6b4f9e",
    "nota":        "#8a9bb0",
}
DEFAULT_COLOUR = "#8a9bb0"
# Tipos da anatomia: entram no grafo, mas o contexto do modelo recebe a
# anatomia pelo anatomia.py (estruturas da pergunta), não por busca de texto.
ANATOMY_TYPES = {"anatomia", "regiao", "sistema", "biblioteca"}

_LOCK = threading.Lock()
CACHE_TTL = 2.0
_PACIENTE = {"id": os.environ.get("BMX_PACIENTE", "P0001").strip() or "P0001"}
_TL = threading.local()   # paciente da requisição em curso (nuvem: cada pessoa tem o seu)


class _CachePorPaciente:
    """O grafo é de um paciente: com vários usuários ao mesmo tempo, cada um tem o seu cache."""
    def __init__(self):
        self._d = {}

    def _c(self):
        return self._d.setdefault(paciente(), {"at": 0.0, "data": None, "sig": None})

    def __getitem__(self, k):
        return self._c()[k]

    def __setitem__(self, k, v):
        self._c()[k] = v

    def update(self, **kw):
        self._c().update(kw)


_CACHE = _CachePorPaciente()


def legado():
    """Cofre sem zonas: tudo é do paciente único, como no prontuario/ original."""
    return not (VAULT / ZONAS["pacientes"]).exists()


def paciente():
    return getattr(_TL, "id", None) or _PACIENTE["id"]


def usar_paciente(pid):
    """Fixa o paciente só nesta requisição (thread). None volta ao paciente global."""
    _TL.id = pid or None


def set_paciente(pid):
    _PACIENTE["id"] = pid
    with _LOCK:
        _CACHE["data"] = None


def paciente_dir(pid=None):
    return VAULT if legado() else VAULT / ZONAS["pacientes"] / (pid or paciente())


def listar_pacientes():
    if legado():
        return [(paciente(), "")]
    out = []
    for d in sorted((VAULT / ZONAS["pacientes"]).iterdir()):
        if d.is_dir():
            meta = {}
            perfil = d / "Perfil de saúde.md"
            if perfil.exists():
                meta, _ = _parse_frontmatter(perfil.read_text(encoding="utf-8", errors="replace"))
            out.append((d.name, meta.get("nome", "")))
    return out


def _arquivos():
    """(arquivo, zona) visíveis para o paciente ativo. Acessos e Sistema nunca."""
    if legado():
        for p in sorted(VAULT.rglob("*.md")):
            yield p, "pacientes"
        return
    for p in sorted(paciente_dir().rglob("*.md")):
        yield p, "pacientes"
    for p in sorted((VAULT / ZONAS["operacoes"]).rglob(f"*— {paciente()}.md")):
        yield p, "operacoes"
    for p in sorted((VAULT / ZONAS["conhecimento"]).rglob("*.md")):
        yield p, "conhecimento"


def _parse_frontmatter(text):
    meta, body = {}, text
    m = FRONTMATTER.match(text)
    if m:
        body = text[m.end():]
        for line in m.group(1).splitlines():
            if ":" in line and not line.strip().startswith("#"):
                k, _, v = line.partition(":")
                meta[k.strip().lower()] = v.strip().strip('"').strip("'")
    return meta, body


def _signature():
    """Cheap change detector so the graph reloads when you edit the vault."""
    if not VAULT.exists():
        return ()
    return (paciente(),) + tuple(
        (str(p), int(p.stat().st_mtime)) for p, _ in _arquivos())


def build_graph(force=False):
    with _LOCK:
        now = time.time()
        if not force and _CACHE["data"] and now - _CACHE["at"] < CACHE_TTL:
            return _CACHE["data"]
        sig = _signature()
        if not force and _CACHE["data"] and sig == _CACHE["sig"]:
            _CACHE["at"] = now
            return _CACHE["data"]

        nodes, by_title, edges = {}, {}, []
        if VAULT.exists():
            for path, zona in _arquivos():
                try:
                    text = path.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                meta, body = _parse_frontmatter(text)
                title = meta.get("title") or path.stem
                ntype = (meta.get("type") or "nota").strip().lower()
                key = title.lower()
                snippet = " ".join(
                    ln.strip() for ln in body.splitlines()
                    if ln.strip() and not ln.strip().startswith(("#", ">"))
                )[:PERFIL_MAX if ntype == "perfil" else 340]
                nodes[key] = dict(
                    id=key, title=title, type=ntype, zona=zona,
                    origem=meta.get("origem", ""), status=meta.get("status", ""),
                    colour=TYPE_COLOURS.get(ntype, DEFAULT_COLOUR),
                    file=str(path.relative_to(VAULT)),
                    tags=[t.strip() for t in (meta.get("tags") or "").split(",") if t.strip()],
                    updated=meta.get("updated", ""),
                    snippet=snippet, degree=0,
                )
                by_title[key] = key
                for target in WIKILINK.findall(body):
                    # [[10-Pacientes/P0001/Perfil de saúde]] resolve pelo nome do arquivo
                    edges.append((key, target.strip().split("/")[-1].lower()))

        # Keep only edges whose target actually exists; count degree both ways.
        clean, seen = [], set()
        for src, dst in edges:
            if dst not in by_title or src == dst:
                continue
            pair = tuple(sorted((src, dst)))
            if pair in seen:
                continue
            seen.add(pair)
            clean.append(dict(source=src, target=dst))
            nodes[src]["degree"] += 1
            nodes[dst]["degree"] += 1

        counts = {}
        for n in nodes.values():
            counts[n["type"]] = counts.get(n["type"], 0) + 1

        hubs = sorted(nodes.values(), key=lambda n: (-n["degree"], n["title"]))[:8]
        data = dict(
            nodes=list(nodes.values()),
            links=clean,
            counts=sorted(counts.items(), key=lambda kv: -kv[1]),
            hubs=[dict(id=h["id"], title=h["title"], degree=h["degree"],
                       colour=h["colour"], type=h["type"]) for h in hubs],
            vault=str(VAULT),
            paciente=paciente(),
            total=len(nodes),
        )
        _CACHE.update(at=now, data=data, sig=sig)
        return data


# O grafo da tela mostra só o caso: o paciente e as operações dele. Guias e
# anatomia continuam na memória (contexto do modelo, busca), mas fora da tela.
GRAPH_ZONES = ("pacientes", "operacoes")


def graph_view(force=False):
    g = build_graph(force)
    nodes = {n["id"]: dict(n, degree=0) for n in g["nodes"] if n["zona"] in GRAPH_ZONES}
    links = [l for l in g["links"] if l["source"] in nodes and l["target"] in nodes]
    for l in links:
        nodes[l["source"]]["degree"] += 1
        nodes[l["target"]]["degree"] += 1
    counts = {}
    for n in nodes.values():
        counts[n["type"]] = counts.get(n["type"], 0) + 1
    hubs = sorted(nodes.values(), key=lambda n: (-n["degree"], n["title"]))[:8]
    return dict(g, nodes=list(nodes.values()), links=links, total=len(nodes),
                counts=sorted(counts.items(), key=lambda kv: -kv[1]),
                hubs=[dict(id=h["id"], title=h["title"], degree=h["degree"],
                           colour=h["colour"], type=h["type"]) for h in hubs],
                memoria=g["total"])


def search(query, limit=6):
    """Plain substring recall over the vault, for the /recall command."""
    q = (query or "").strip().lower()
    if not q:
        return []
    hits = []
    for node in build_graph()["nodes"]:
        haystack = (node["title"] + " " + node["snippet"]).lower()
        if q in haystack:
            hits.append(node)
    hits.sort(key=lambda n: (-n["degree"], n["title"]))
    return hits[:limit]


def _scored(message):
    words = [w for w in re.split(r"[\W_]+", (message or "").lower()) if len(w) > 3]
    if not words:
        return []
    out = []
    for node in build_graph()["nodes"]:
        haystack = (node["title"] + " " + node["snippet"]).lower()
        score = sum(2 if w in node["title"].lower() else 1 for w in words if w in haystack)
        if score:
            out.append((score + node["degree"] * 0.1, node))
    out.sort(key=lambda pair: -pair[0])
    return out


def top_match(message):
    """The vault note a question most likely refers to, for graph focus (só o que está na tela)."""
    hits = [n for _, n in _scored(message) if n["zona"] in GRAPH_ZONES]
    return hits[0]["id"] if hits else None


def relevant(message, limit=4):
    """Notas do paciente, dos atendimentos e dos guias ligadas à pergunta."""
    # Fontes (livros, materiais) só entram depois de aprovadas: RN-06 do PRD.
    return [n for _, n in _scored(message) if n["type"] not in ANATOMY_TYPES
            and not (n["type"] == "fonte" and n["status"] != "aprovada")][:limit]


_ORIGEM = {"pacientes": "prontuário", "operacoes": "atendimento anterior", "conhecimento": "guia"}


def context_for(message, limit=4):
    """Pull the most relevant vault notes so Claude answers from real memory."""
    nodes = relevant(message, limit)
    if not nodes:
        return ""
    out = ["## Memória do BMX (notas relevantes)",
           "Notas do prontuário do paciente ativo, de atendimentos anteriores e dos guias. "
           "Registros com origem 'paciente' são o que ele contou; análises com origem 'bmx' são "
           "hipóteses suas de antes, não fatos confirmados."]
    for node in nodes:
        fonte = _ORIGEM.get(node["zona"], node["zona"])
        origem = f", origem {node['origem']}" if node["origem"] else ""
        out.append(f"### {node['title']} ({node['type']} · {fonte}{origem})\n{node['snippet']}")
    return "\n\n".join(out)


# Tipos que entram em TODA pergunta, citados ou não: uma alergia ou um remédio
# em uso muda a orientação mesmo quando a pessoa não lembra de mencionar.
CORE_TYPES = ("perfil", "alergia", "medicamento", "condicao")
# O perfil é a ficha central e o texto é livre (alergias, condições, remédios): cortá-lo em 220 caracteres
# deixava de fora justamente o que muda a orientação. As demais notas continuam curtas.
PERFIL_MAX = 1200


def core_context():
    nodes = [n for n in build_graph()["nodes"] if n["type"] in CORE_TYPES and n["zona"] == "pacientes"]
    if not nodes:
        return ""
    nodes.sort(key=lambda n: (CORE_TYPES.index(n["type"]), n["title"]))
    out = [f"## Ficha fixa do paciente {paciente()} (sempre considerar)"]
    for n in nodes[:24]:
        out.append(f"- [{n['type']}] {n['title']}: {n['snippet'][:PERFIL_MAX if n['type'] == 'perfil' else 220]}")
    return "\n".join(out)
