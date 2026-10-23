"""
Casos do BMX: o episódio de cuidado que junta as conversas de um mesmo problema.

Um caso (FHIR EpisodeOfCare) nasce de uma queixa de entrada ou de uma região
do corpo, ganha uma linha do tempo a cada conversa, tem sinais de risco
checados (sim / não / não perguntado), um nível de atendimento que só sobe
sozinho e termina num desfecho. Mora em 10-Pacientes/<ID>/Casos/, um .md por
caso, legível no Obsidian:

    ## Sinais de risco      - [ ] não perguntado · - [x] sim · - [-] não
    ## Linha do tempo       uma linha por turno, com link para o atendimento
    ## Hipóteses            link para a análise da região (origem: bmx)
    ## Plano                orientações dadas quando o BMX classificou o nível
    ## Desfecho             /caso encerrar <texto>

Só o servidor escreve aqui, como no resto do prontuário.
"""
import datetime
import math
import re
import threading

import memory
import safety

NIVEIS = ["", "autocuidado", "consulta", "urgente", "emergencia"]
NOME_NIVEL = {"": "a definir", "autocuidado": "Autocuidado", "consulta": "Consulta",
              "urgente": "Urgente", "emergencia": "Emergência"}
ABERTOS = ("aberto", "acompanhamento", "encaminhado")
RETOMAR_DIAS = 30
SEGUIMENTO_HORAS = 48

_LOCK = threading.Lock()
_ATIVO = {}          # paciente -> id do caso em foco nesta sessão
_SEGUIDOS = set()    # (paciente, caso) já perguntados nesta sessão
_MARCA_NIVEL = re.compile(r"\[\s*n[ií]vel\s*:?\s*(emerg[eê]ncia|urgente|consulta|autocuidado)\s*\]", re.I)
_DISC = re.compile(r"^- \[( |x|-)\] (.+?)(?: — (sim|não) \((\d\d/\d\d)\))?\s*$")
_NEG = re.compile(r"\b(nao|sem|nenhum|nenhuma|nunca|nada|negativo)\b")
_SIM = re.compile(r"^(sim|tenho|tem|estou|esta|ta|isso|teve|tive|aham|uhum|positivo|ficou|fica)\b")
_STOP = {"com", "sem", "que", "para", "por", "uma", "dos", "das", "nos", "nas", "mais", "como", "depois",
         "pode", "esta", "estar", "muito", "pouca", "pouco", "lado", "agora", "consegue", "vai"}
_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f\[\]#^]+')


def pasta(pid=None):
    return memory.paciente_dir(pid) / "Casos"


def _agora():
    return datetime.datetime.now()


# ── leitura ──────────────────────────────────────────────────────
def _secoes(corpo):
    out, atual = {}, None
    for ln in corpo.splitlines():
        m = re.match(r"^## (.+?)\s*$", ln)
        if m:
            atual = m.group(1)
            out[atual] = []
        elif atual and ln.strip():
            out[atual].append(ln.rstrip())
    return out


def _ler(f):
    texto = f.read_text(encoding="utf-8", errors="replace")
    meta, corpo = memory._parse_frontmatter(texto)
    sec = _secoes(corpo)
    disc = []
    for ln in sec.get("Sinais de risco", []):
        m = _DISC.match(ln)
        if m:
            disc.append(dict(sinal=m.group(2), estado={"x": "sim", "-": "nao", " ": ""}[m.group(1)],
                             data=m.group(4) or ""))
    return dict(meta, arquivo=f, titulo=f.stem, discriminadores=disc,
                linha=sec.get("Linha do tempo", []), plano=sec.get("Plano", []),
                hipoteses=sec.get("Hipóteses", []), desfecho=sec.get("Desfecho", []),
                resumo=sec.get("Resumo", []),
                estruturas=[e for e in meta.get("estruturas", "").split(",") if e])


def listar(todos=False, pid=None):
    d = pasta(pid)
    if not d.exists():
        return []
    casos = [_ler(f) for f in sorted(d.glob("C-*.md"))]
    if not todos:
        casos = [c for c in casos if c.get("status") in ABERTOS]
    return sorted(casos, key=lambda c: c.get("updated_em") or c.get("updated", ""), reverse=True)


def obter(cid):
    for c in listar(todos=True):
        if c.get("caso", "").lower() == (cid or "").lower():
            return c
    return None


def ativo():
    cid = _ATIVO.get(memory.paciente())
    c = obter(cid) if cid else None
    return c if c and c.get("status") in ABERTOS else None


def selecionar(cid):
    _ATIVO[memory.paciente()] = cid


def soltar():
    """Nova conversa ou troca de paciente: o próximo relato escolhe (ou abre) o caso de novo."""
    _ATIVO.pop(memory.paciente(), None)


# ── escrita ──────────────────────────────────────────────────────
def _set(texto, chave, valor):
    rx = re.compile(rf"(?m)^{re.escape(chave)}:.*$")
    if rx.search(texto):
        return rx.sub(lambda _m: f"{chave}: {valor}", texto, count=1)
    return texto.replace("\n---\n", f"\n{chave}: {valor}\n---\n", 1)


def _acrescentar(texto, secao, linha):
    m = re.search(rf"(?m)^## {re.escape(secao)}\s*$", texto)
    if not m:
        return texto.rstrip() + f"\n\n## {secao}\n{linha}\n"
    prox = re.search(r"(?m)^## ", texto[m.end():])
    fim = m.end() + prox.start() if prox else len(texto)
    bloco = texto[m.end():fim].rstrip()
    resto = texto[fim:].lstrip("\n")
    return texto[:m.end()] + bloco + "\n" + linha + "\n" + ("\n" + resto if resto else "")


def _curto(t, n):
    t = " ".join(re.sub(r"\[[^\]]{1,40}\]\s*", "", t or "").split())
    return t[:n].rstrip() + ("…" if len(t) > n else "")


def abrir(queixa=None, rel=None, relato="", titulo=None):
    """Cria o caso. `queixa` é um item de clinica (dict), `rel` vem de anatomia.relacionar."""
    agora = _agora()
    d = pasta()
    d.mkdir(parents=True, exist_ok=True)
    prefixo = f"C-{agora:%Y%m%d}-"
    n = 1 + sum(1 for _ in d.glob(prefixo + "*.md"))
    cid = f"{prefixo}{n}"
    regiao = rel["regioes"][0] if rel and rel.get("regioes") else ""
    if not titulo:
        # "Dor — Coxa e joelho, direito" diz mais que a queixa genérica "Dor no braço, perna…"
        lugar = ""
        if regiao:
            import anatomia
            lugar = anatomia.carregar()[0]["regioes"][regiao]["nome"]
            if rel.get("lado") and rel["lado"][:5] not in lugar.lower():   # "Abdome inferior direito" já diz o lado
                lugar += f", {rel['lado']}"
        if queixa and lugar:
            base = "Dor" if queixa["id"].startswith("dor") else queixa["queixa"]
            titulo = f"{base} — {lugar}"
        elif queixa:
            titulo = queixa["queixa"]
        elif lugar:
            titulo = f"Queixa — {lugar}"
        else:
            titulo = _curto(relato, 40) or "Queixa"
    titulo = " ".join(_UNSAFE.sub(" ", titulo).split())[:60]
    sinais = (queixa or {}).get("sinais_de_alerta", [])
    estruturas = ",".join(e["id"] for e in (rel or {}).get("estruturas", []))
    texto = (
        f"---\ntype: caso\npaciente: {memory.paciente()}\ncaso: {cid}\nqueixa: {titulo}\n"
        f"queixa_id: {(queixa or {}).get('id', '')}\nciap2: {(queixa or {}).get('ciap2', '')}\n"
        f"regiao: {regiao}\nlado: {(rel or {}).get('lado', '')}\nestruturas: {estruturas}\n"
        f"inicio: {agora.date().isoformat()}\nstatus: aberto\nnivel: \ndor_max: \ndor_ultima: \n"
        f"origem: paciente\nupdated: {agora.date().isoformat()}\nupdated_em: {agora.isoformat(timespec='minutes')}\n---\n\n"
        f"# Caso {cid} — {titulo}\n\n"
        f"Parte do [[Perfil de saúde]]. Episódio de cuidado aberto pelo BMX em {agora:%d/%m/%Y %H:%M}.\n\n"
        f"## Resumo\n- relato inicial: {_curto(relato, 300)}\n"
        + (f"- queixa de entrada: {queixa['queixa']} (CIAP-2 {queixa['ciap2']})\n" if queixa else "")
        + "\n## Sinais de risco\n" + "".join(f"- [ ] {s}\n" for s in sinais)
        + "\n## Linha do tempo\n\n## Hipóteses\n\n## Plano\n\n## Desfecho\n")
    f = d / f"{cid} — {titulo}.md"
    f.write_text(texto, encoding="utf-8")
    return _ler(f)


def resolver(relato, queixas=(), rel=None):
    """Caso deste relato: o ativo, um aberto da mesma queixa/região (retoma) ou um novo.

    Devolve (caso, como) com como ∈ {ativo, retomado, aberto} ou (None, None) se o
    relato não tem queixa nem região (conversa geral).
    """
    with _LOCK:
        qid = queixas[0]["id"] if queixas else ""
        reg = rel["regioes"][0] if rel and rel.get("regioes") else ""
        atual = ativo()
        # Com um caso em foco, só troca quando o relato aponta para OUTRA região do corpo.
        # Sintoma sem região ("estou com febre") no meio de um caso é resposta a sinal de risco.
        regioes = rel.get("regioes", []) if rel else []
        if atual and not (regioes and atual.get("regiao") and atual.get("regiao") not in regioes):
            return atual, "ativo"
        if not qid and not reg:
            return None, None
        limite = (_agora() - datetime.timedelta(days=RETOMAR_DIAS)).date().isoformat()
        for c in listar():
            mesma_queixa = qid and c.get("queixa_id") == qid
            # mesma região só retoma se as queixas não se contradizem (tontura ≠ dor de cabeça)
            mesma_regiao = reg and c.get("regiao") == reg and not (qid and c.get("queixa_id") and c.get("queixa_id") != qid)
            if c.get("updated", "") >= limite and (mesma_queixa or mesma_regiao):
                selecionar(c["caso"])
                return c, "retomado"
        c = abrir(queixas[0] if queixas else None, rel, relato)
        selecionar(c["caso"])
        return c, "aberto"


def _palavras(frase):
    return [w for w in safety._norm(frase).split() if len(w) > 3 and w not in _STOP]


def _raiz(w):
    return re.compile(r"\b" + re.escape(w[:max(4, len(w) - 2)]))


def _marcar(discs, relato, pergunta):
    """Sinais de risco respondidos neste turno: citados no relato, ou sim/não curto a uma pergunta do BMX."""
    norm = safety._norm(relato)
    curto = len(norm.split()) <= 5
    perg = safety._norm(pergunta or "")
    novos = {}
    for d in discs:
        kw = _palavras(d["sinal"])
        if not kw:
            continue
        pos = [m.start() for m in (_raiz(w).search(norm) for w in kw) if m]
        # para cima: com 2 palavras-chave, round(1,2) dava 1 e "dor de cabeça" marcava "batida na cabeça" como sim
        if len(pos) >= max(1, math.ceil(len(kw) * 0.6)):
            janela = norm[max(0, min(pos) - 28):min(pos)]
            novos[d["sinal"]] = "nao" if _NEG.search(janela) else "sim"
        elif curto and perg:
            na_pergunta = [w for w in kw if _raiz(w).search(perg)]
            if len(na_pergunta) >= max(1, math.ceil(len(kw) * 0.6)):
                if _NEG.search(norm):
                    novos[d["sinal"]] = "nao"
                elif _SIM.search(norm):
                    novos[d["sinal"]] = "sim"
    return novos


def nivel_da_resposta(resposta):
    m = _MARCA_NIVEL.search(resposta or "")
    return safety._norm(m.group(1)) if m else ""


def _maior(*niveis):
    return max(niveis, key=lambda n: NIVEIS.index(n) if n in NIVEIS else 0)


def turno(caso, relato, resposta, atendimento, alerta=None, queixas=(), rel=None,
          analise=None, pergunta_anterior="", dor=None):
    """Acrescenta o turno ao caso e recalcula sinais, nível, dor e estruturas."""
    agora = _agora()
    with _LOCK:
        c = _ler(caso["arquivo"])
        texto = caso["arquivo"].read_text(encoding="utf-8")
        # sinais de risco: a lista da queixa entra também quando a queixa aparece depois da abertura
        sinais = {d["sinal"] for d in c["discriminadores"]}
        for q in queixas:
            for s in q.get("sinais_de_alerta", []):
                if s not in sinais:
                    texto = _acrescentar(texto, "Sinais de risco", f"- [ ] {s}")
                    c["discriminadores"].append(dict(sinal=s, estado="", data=""))
                    sinais.add(s)
            if not c.get("queixa_id"):
                texto = _set(texto, "queixa_id", q["id"])
                texto = _set(texto, "ciap2", q["ciap2"])
                c["queixa_id"] = q["id"]
        marcados = _marcar(c["discriminadores"], relato, pergunta_anterior)
        for sinal, estado in marcados.items():
            nova = f"- [{'x' if estado == 'sim' else '-'}] {sinal} — {'sim' if estado == 'sim' else 'não'} ({agora:%d/%m})"
            texto = re.sub(rf"(?m)^- \[[ x-]\] {re.escape(sinal)}( — .*)?$", lambda _m: nova, texto, count=1)

        # nível: alerta fixo > sinal positivo > marcação [nível: …] do BMX; só sobe sozinho (RN-04)
        positivo = any(e == "sim" for e in marcados.values()) or any(d["estado"] == "sim" for d in c["discriminadores"])
        dado = nivel_da_resposta(resposta)
        nivel = _maior(c.get("nivel", ""), "emergencia" if alerta else "", "urgente" if positivo else "", dado)
        texto = _set(texto, "nivel", nivel)

        if dor is not None:
            texto = _set(texto, "dor_ultima", str(dor))
            if not c.get("dor_max") or int(dor) > int(c.get("dor_max") or 0):
                texto = _set(texto, "dor_max", str(dor))
        if rel and rel.get("estruturas"):
            atuais = list(c["estruturas"])
            atuais += [e["id"] for e in rel["estruturas"] if e["id"] not in atuais]
            texto = _set(texto, "estruturas", ",".join(atuais[:12]))
            if not c.get("regiao"):
                texto = _set(texto, "regiao", rel["regioes"][0])
            if rel.get("lado") and not c.get("lado"):
                texto = _set(texto, "lado", rel["lado"])

        partes = [f"- {agora:%d/%m %H:%M} · [[{atendimento}]] · relato: {_curto(relato, 160)}"]
        if dor is not None:
            partes.append(f"dor {dor}/10")
        if alerta:
            partes.append(f"alerta: {alerta.get('title', '')}")
        if marcados:
            partes.append("sinais: " + "; ".join(f"{s} = {'sim' if e == 'sim' else 'não'}" for s, e in marcados.items()))
        if dado:
            partes.append(f"nível dado pelo BMX: {NOME_NIVEL[dado]}")
        texto = _acrescentar(texto, "Linha do tempo", " · ".join(partes))
        if analise and f"[[{analise}]]" not in texto:
            texto = _acrescentar(texto, "Hipóteses", f"- [[{analise}]] (origem: bmx, hipótese)")
        if dado:
            texto = _acrescentar(texto, "Plano", f"- {agora:%d/%m}: {_curto(resposta, 320)}")
        texto = _set(texto, "updated", agora.date().isoformat())
        texto = _set(texto, "updated_em", agora.isoformat(timespec="minutes"))
        if c.get("status") == "aberto" and c["linha"]:
            texto = _set(texto, "status", "acompanhamento")
        caso["arquivo"].write_text(texto, encoding="utf-8")
    return _ler(caso["arquivo"])


def encerrar(caso, desfecho, status="resolvido"):
    agora = _agora()
    with _LOCK:
        texto = caso["arquivo"].read_text(encoding="utf-8")
        texto = _acrescentar(texto, "Desfecho", f"- {agora:%d/%m/%Y}: {desfecho.strip()} ({status})")
        texto = _set(texto, "status", status)
        texto = _set(texto, "updated", agora.date().isoformat())
        texto = _set(texto, "updated_em", agora.isoformat(timespec="minutes"))
        caso["arquivo"].write_text(texto, encoding="utf-8")
    if _ATIVO.get(memory.paciente()) == caso.get("caso"):
        soltar()
    return _ler(caso["arquivo"])


# ── contexto para o modelo ───────────────────────────────────────
_COMO = {"ativo": "em andamento", "retomado": "retomado agora", "aberto": "aberto agora"}


def contexto(caso, como):
    """O caso em foco (para não repetir pergunta) e, se for o caso, o pedido de seguimento."""
    out = []
    if caso:
        pend = [d["sinal"] for d in caso["discriminadores"] if not d["estado"]]
        sim = [d["sinal"] for d in caso["discriminadores"] if d["estado"] == "sim"]
        nao = [d["sinal"] for d in caso["discriminadores"] if d["estado"] == "nao"]
        out.append(
            f"## Caso em foco ({_COMO.get(como, '')})\n"
            f"{caso['caso']} — {caso.get('queixa', '')} · desde {caso.get('inicio', '')} · nível até agora: "
            f"{NOME_NIVEL.get(caso.get('nivel', ''), 'a definir')} · dor máxima: {caso.get('dor_max') or '—'}\n"
            + (f"Sinais de risco presentes: {'; '.join(sim)}.\n" if sim else "")
            + (f"Já negados: {'; '.join(nao)}.\n" if nao else "")
            + (f"Ainda não perguntados: {'; '.join(pend)}. Pergunte o mais importante deles, um por vez.\n" if pend else "")
            + (f"Últimos turnos: {' | '.join(_curto(l, 140) for l in caso['linha'][-3:])}\n" if caso["linha"] else "")
            + ("Retomado: confirme em uma frase que é o mesmo problema e pergunte se melhorou, ficou igual ou piorou.\n"
               if como == "retomado" else "")
            + "Quando classificar o nível, inclua no fim uma única marcação [nível: emergência], [nível: urgente], "
              "[nível: consulta] ou [nível: autocuidado].")
    pendentes = seguimento()
    if pendentes and not caso:
        c = pendentes[0]
        _SEGUIDOS.add((memory.paciente(), c["caso"]))
        out.append(f"## Seguimento pendente\nO caso {c['caso']} ({c.get('queixa', '')}) está aberto e sem notícia desde "
                   f"{c.get('updated', '')}. Se a pessoa não trouxe algo urgente, pergunte em uma frase como está esse problema.")
    return "\n\n".join(out)


def seguimento():
    """Casos abertos sem notícia há mais de 48 h e ainda não perguntados nesta sessão."""
    limite = (_agora() - datetime.timedelta(hours=SEGUIMENTO_HORAS)).isoformat(timespec="minutes")
    return [c for c in listar() if (c.get("updated_em") or c.get("updated", "")) < limite
            and (memory.paciente(), c["caso"]) not in _SEGUIDOS]


# ── ficha para consulta ──────────────────────────────────────────
def ficha(caso, hipoteses=False):
    """Resumo do caso para levar ao médico. Sem hipóteses do BMX, a menos que pedidas (RF-14)."""
    nodes = memory.build_graph()["nodes"]
    fixa = {t: [n["title"].split(" — ", 1)[-1] for n in nodes if n["type"] == t and n["zona"] == "pacientes"]
            for t in ("alergia", "medicamento", "condicao")}
    registros = [(n["title"], _curto(n["snippet"].replace("Parte do [[Perfil de saúde]].", ""), 200))
                 for n in nodes if n["zona"] == "pacientes" and n["type"] in ("exame", "consulta")]
    perfil = next((n for n in nodes if n["type"] == "perfil"), None)
    return dict(caso=caso, paciente=memory.paciente(),
                perfil=_curto((perfil or {}).get("snippet", ""), 300), fixa=fixa, registros=registros[:8],
                sinais_pendentes=[d["sinal"] for d in caso["discriminadores"] if not d["estado"]],
                perguntas=["O que pode estar causando isso, e o que ainda precisa ser descartado?",
                           "Preciso de algum exame?", "Que sinais me fazem voltar antes do retorno?"],
                hipoteses=caso["hipoteses"] if hipoteses else [],
                gerada=_agora().strftime("%d/%m/%Y %H:%M"))
