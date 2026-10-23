"""
Operações e acessos do BMX: o que só o servidor escreve no cofre.

    20-Operacoes/Atendimentos   um arquivo por conversa: relato, alerta, notas
                                do cofre consultadas, estruturas destacadas e a
                                resposta. É o "o que aconteceu".
    10-Pacientes/ID/Analises    o que o BMX concluiu, por região investigada
                                (origem: bmx, confiança: hipótese). Fica
                                separado de Registros/, que é o que o paciente
                                trouxe.
    30-Acessos                  quem fez o quê e quando, SEM conteúdo clínico:
                                acessos.jsonl (para máquina) + um .md por dia
                                (para ler no Obsidian). Nunca entra no grafo
                                nem no contexto do modelo.

O modelo continua sem escrita: tudo aqui roda no servidor, depois da resposta.
"""
import datetime
import json
import re
import threading

import memory

_LOCK = threading.Lock()
_ATUAL = {"arquivo": None, "paciente": None}
_NIVEL = {"": 0, "emergencia": 1, "crise": 2}
_TAGS = re.compile(r"\[[a-z ]{3,20}\]\s*")


def _curto(texto, limite):
    t = " ".join(_TAGS.sub("", texto or "").split())
    return t[:limite].rstrip() + ("…" if len(t) > limite else "")


def _zona(nome):
    return memory.VAULT / memory.ZONAS[nome]


# ── 30-Acessos ───────────────────────────────────────────────────
def acesso(evento, **campos):
    """Trilha de auditoria. Só metadados: evento, paciente, comando, nível, contagens."""
    agora = datetime.datetime.now()
    campos = {k: v for k, v in campos.items() if v not in (None, "", [], 0)}
    linha = {"em": agora.isoformat(timespec="seconds"), "evento": evento,
             "paciente": memory.paciente(), **campos}
    pasta = _zona("acessos")
    dia = pasta / agora.strftime("%Y-%m") / f"{agora:%Y-%m-%d}.md"
    detalhe = "; ".join(f"{k}={v}" for k, v in campos.items()).replace("|", "/")
    with _LOCK:
        dia.parent.mkdir(parents=True, exist_ok=True)
        with open(pasta / "acessos.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(linha, ensure_ascii=False) + "\n")
        novo = not dia.exists()
        with open(dia, "a", encoding="utf-8") as f:
            if novo:
                f.write(f"---\ntype: acesso\ndata: {agora:%Y-%m-%d}\n---\n\n# Acessos — {agora:%d/%m/%Y}\n\n"
                        "Gerado pelo servidor do BMX. Só metadados, sem conteúdo clínico.\n\n"
                        "| hora | evento | paciente | detalhe |\n|---|---|---|---|\n")
            f.write(f"| {agora:%H:%M:%S} | {evento} | {memory.paciente()} | {detalhe} |\n")


# ── 20-Operacoes ─────────────────────────────────────────────────
def novo_atendimento():
    """A próxima pergunta abre outro arquivo (nova conversa, troca de paciente)."""
    with _LOCK:
        _ATUAL.update(arquivo=None, paciente=None)


def _arquivo_atendimento(agora):
    pid = memory.paciente()
    if _ATUAL["arquivo"] and _ATUAL["paciente"] == pid and _ATUAL["arquivo"].exists():
        return _ATUAL["arquivo"], False
    pasta = _zona("operacoes") / "Atendimentos" / agora.strftime("%Y-%m")
    pasta.mkdir(parents=True, exist_ok=True)
    base, n = f"{agora:%Y-%m-%d %Hh%M}", 1
    f = pasta / f"{base} — {pid}.md"
    while f.exists():
        n += 1
        f = pasta / f"{base} ({n}) — {pid}.md"
    _ATUAL.update(arquivo=f, paciente=pid)
    return f, True


def _analise(rel, atendimento, relato, agora, caso=None):
    """Uma nota por região investigada, no prontuário, marcada como hipótese do BMX."""
    import anatomia
    cat, _ = anatomia.carregar()
    regiao = rel["regioes"][0]
    nome = cat["regioes"][regiao]["nome"]
    f = memory.paciente_dir() / "Analises" / f"Análise — {nome}.md"
    f.parent.mkdir(parents=True, exist_ok=True)
    linha = (f"- {agora:%d/%m/%Y %H:%M} · [[{atendimento}]]" + (f" · caso [[{caso}]]" if caso else "")
             + f" · relato: {_curto(relato, 140)} · "
             f"estruturas: {', '.join(e['nome'] for e in rel['estruturas'][:6])}\n")
    if f.exists():
        texto = re.sub(r"(?m)^updated: .*$", f"updated: {agora.date().isoformat()}", f.read_text(encoding="utf-8"), count=1)
        f.write_text(texto.rstrip() + "\n" + linha, encoding="utf-8")
    else:
        f.write_text(
            f"---\ntype: analise\npaciente: {memory.paciente()}\norigem: bmx\nconfianca: hipotese\n"
            f"regiao: {regiao}\nupdated: {agora.date().isoformat()}\n---\n\n# Análise — {nome}\n\n"
            "Hipóteses de estruturas envolvidas, levantadas pelo BMX a partir dos relatos. "
            "Não é diagnóstico: serve para ver a evolução e levar à consulta.\n"
            f"Parte do [[Perfil de saúde]] · anatomia em [[Região — {nome}]].\n\n" + linha, encoding="utf-8")
    return f.stem


def turno(relato, resposta, alerta=None, notas=(), rel=None, comando=None, queixas=(), caso=None):
    agora = datetime.datetime.now()
    with _LOCK:
        f, novo = _arquivo_atendimento(agora)
        nivel = (alerta or {}).get("level", "")
        if novo:
            f.write_text(
                f"---\ntype: atendimento\npaciente: {memory.paciente()}\ninicio: {agora.isoformat(timespec='minutes')}\n"
                f"nivel: {nivel}\ncaso: {(caso or '').split(' — ')[0]}\nupdated: {agora.date().isoformat()}\n---\n\n"
                f"# Atendimento — {agora:%d/%m/%Y %H:%M}\n\nPaciente: [[Perfil de saúde]] ({memory.paciente()}).\n",
                encoding="utf-8")
        texto = f.read_text(encoding="utf-8")
        texto = re.sub(r"(?m)^updated: .*$", f"updated: {agora.date().isoformat()}", texto, count=1)
        atual = re.search(r"(?m)^nivel: *(\S*)$", texto)
        if atual and _NIVEL.get(nivel, 0) > _NIVEL.get(atual.group(1), 0):
            texto = texto[:atual.start()] + f"nivel: {nivel}" + texto[atual.end():]
        bloco = [f"\n## {agora:%H:%M}" + (f" · /{comando}" if comando else ""),
                 f"- **relato:** {_curto(relato, 400)}"]
        if caso:
            bloco.append(f"- **caso:** [[{caso}]]")
            if re.search(r"(?m)^caso: *$", texto):
                texto = re.sub(r"(?m)^caso: *$", f"caso: {caso.split(' — ')[0]}", texto, count=1)
        if queixas:
            bloco.append("- **queixa de entrada:** " + "; ".join(f"{q['queixa']} (CIAP-2 {q['ciap2']})" for q in queixas))
        if alerta:
            bloco.append(f"- **alerta:** {alerta.get('title', '')} ({nivel})")
        if notas:
            bloco.append("- **memória consultada:** " + ", ".join(f"[[{t}]]" for t in notas))
        analise = None
        if rel and rel.get("estruturas"):
            analise = _analise(rel, f.stem, relato, agora, caso)
            bloco.append("- **estruturas destacadas:** " + ", ".join(e["nome"] for e in rel["estruturas"])
                         + f" → [[{analise}]]")
        bloco.append(f"- **resposta do BMX:** {_curto(resposta, 700)}")
        f.write_text(texto.rstrip() + "\n" + "\n".join(bloco) + "\n", encoding="utf-8")
    memory.build_graph(force=True)
    return f.stem, analise
