"""
Dados do Painel do caso (ui/caso.html) e a Ficha para consulta (HTML para imprimir).

O painel mostra um caso por vez: dor, nível, sinais de risco, ficha fixa, o
corpo 3D com as estruturas da região, o cartão do achado, os sistemas do
corpo com estado, a linha do tempo e o plano. Tudo sai do cofre; nada aqui
escreve.
"""
import html
import json
import re

import anatomia
import casos
import clinica
import commands
import memory

SISTEMAS = [
    ("coracao", "Coração", ("cardiovascular",)),
    ("pulmoes", "Pulmões", ("respiratorio",)),
    ("digestorio", "Digestório", ("digestorio", "endocrino")),
    ("rins", "Rins e bexiga", ("urinario", "reprodutor")),
    ("nervoso", "Cérebro e nervos", ("nervoso", "sensorial")),
    ("locomotor", "Ossos e músculos", ("esqueletico", "muscular", "articular")),
]
_LINK = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")


def _sem_links(t):
    return _LINK.sub(lambda m: m.group(1), t).lstrip("- ").strip()


def _queixa(qid):
    return next((q for q in clinica.carregar()["queixas"] if q["id"] == qid), None) if qid else None


def _caso_json(c):
    if not c:
        return None
    cat, _ = anatomia.carregar()
    q = _queixa(c.get("queixa_id"))
    reg = c.get("regiao", "")
    notas = [s["nota"] for s in cat.get("sintomas", [])
             if q and s["id"] in q.get("sintoma_anatomico", []) and reg in s["regioes"]]
    linha = []
    for ln in c["linha"]:
        m = re.match(r"^- (\d\d/\d\d \d\d:\d\d) · (.*)$", ln)
        at = _LINK.search(ln)
        linha.append(dict(quando=m.group(1) if m else "", texto=_sem_links(m.group(2) if m else ln),
                          atendimento=at.group(1) if at else ""))
    pend = [d["sinal"] for d in c["discriminadores"] if not d["estado"]]
    return dict(
        id=c["caso"], titulo=c.get("queixa", ""), arquivo=c["titulo"], queixa_id=c.get("queixa_id", ""),
        ciap2=c.get("ciap2", ""), regiao=reg, regiao_nome=cat["regioes"].get(reg, {}).get("nome", ""),
        lado=c.get("lado", ""), status=c.get("status", ""), nivel=c.get("nivel", ""),
        nivel_nome=casos.NOME_NIVEL.get(c.get("nivel", ""), "a definir"),
        dor_max=c.get("dor_max", ""), dor_ultima=c.get("dor_ultima", ""), inicio=c.get("inicio", ""),
        updated=c.get("updated_em") or c.get("updated", ""),
        discriminadores=c["discriminadores"], linha=linha,
        plano=[_sem_links(p) for p in c["plano"]], desfecho=[_sem_links(p) for p in c["desfecho"]],
        hipoteses=[_sem_links(h) for h in c["hipoteses"]], resumo=[_sem_links(r) for r in c["resumo"]],
        estruturas=anatomia.detalhar(c["estruturas"]), regiao3d=anatomia.regiao_3d(reg),
        perguntas=(q or {}).get("perguntas_chave", []),
        nao_perder=[x["nome"] for x in (q or {}).get("nao_perder", [])],
        causas=[x["nome"] for x in (q or {}).get("causas_frequentes", [])],
        anatomia=notas, proximo_sinal=pend[0] if pend else "")


def _sistemas(caso, abertos):
    def sis_de(c):
        return {e["sistema"] for e in anatomia.detalhar(c["estruturas"])} if c else set()
    ativos, outros = sis_de(caso), set()
    for c in abertos:
        if not caso or c["caso"] != caso.get("caso"):
            outros |= sis_de(c)
    grave = bool(caso) and caso.get("nivel") in ("urgente", "emergencia")
    out = []
    for sid, nome, chaves in SISTEMAS:
        if ativos & set(chaves):
            estado = "alerta" if grave else "investigacao"
        elif outros & set(chaves):
            estado = "acompanhamento"
        else:
            estado = "ok"
        out.append(dict(id=sid, nome=nome, estado=estado))
    return out


def _camadas_3d():
    try:
        return json.loads(anatomia.MALHAS.read_text(encoding="utf-8"))["bibliotecas"]["human-atlas"]["camadas"]
    except (OSError, ValueError, KeyError):
        return {}


def dados(cid=""):
    c = casos.obter(cid) if cid else None
    abertos = casos.listar()
    if not c:
        c = casos.ativo() or (abertos[0] if abertos else None)
    nodes = memory.build_graph()["nodes"]
    fixa = [dict(tipo=n["type"], titulo=n["title"].split(" — ", 1)[-1])
            for n in nodes if n["zona"] == "pacientes" and n["type"] in ("alergia", "medicamento", "condicao")]
    estado = commands._p(commands.load())
    cat, _ = anatomia.carregar()
    arquivos = _camadas_3d()
    return dict(
        paciente=dict(id=memory.paciente(), nome=dict(memory.listar_pacientes()).get(memory.paciente(), "")),
        pacientes=[dict(id=i, nome=n) for i, n in memory.listar_pacientes()],
        fixa=fixa, dor=estado.get("dor", [])[-12:], meta=estado.get("meta", ""),
        caso=_caso_json(c),
        casos=[dict(id=x["caso"], titulo=x.get("queixa", ""), status=x.get("status", ""),
                    nivel=x.get("nivel", ""), updated=x.get("updated", ""))
               for x in casos.listar(todos=True)[:12]],
        sistemas=_sistemas(c, abertos),
        camadas=[dict(id=k, nome=v["nome"], cor=v["cor"], arquivo=arquivos.get(k, ""))
                 for k, v in sorted(cat["camadas"].items(), key=lambda kv: -kv[1]["ordem"])])


# ── ficha para consulta ──────────────────────────────────────────
def ficha_html(cid, hipoteses=False):
    c = casos.obter(cid) if cid else casos.ativo()
    if not c:
        return ""
    f = casos.ficha(c, hipoteses)
    e = html.escape
    cj = _caso_json(c)

    def li(xs):
        return "".join(f"<li>{e(x)}</li>" for x in xs) or "<li class='vazio'>—</li>"
    rotulo = {"sim": "sim", "nao": "não"}
    sinais = "".join(
        f"<tr><td>{e(d['sinal'])}</td><td class='s-{d['estado'] or 'pend'}'>"
        f"{rotulo.get(d['estado'], 'não perguntado')}</td><td>{e(d['data'])}</td></tr>"
        for d in c["discriminadores"])
    linha = "".join(f"<li><b>{e(x['quando'])}</b> {e(x['texto'])}</li>" for x in cj["linha"])
    lado = (" · " + e(c["lado"])) if c.get("lado") else ""
    dor = (e(c["dor_max"]) + "/10") if c.get("dor_max") else "—"
    hip = ("<h2>Hipóteses levantadas pelo BMX (não são diagnóstico)</h2><ul>" + li(cj["hipoteses"]) + "</ul>"
           if hipoteses else "")
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ficha para consulta · {e(c['caso'])}</title>
<style>
 :root {{ --tinta:#14212e; --t2:#4a5b6c; --linha:#dfe6ee; --azul:#1e8fc8; }}
 body {{ font-family: 'Segoe UI', system-ui, sans-serif; color: var(--tinta); max-width: 820px;
        margin: 32px auto; padding: 0 20px; line-height: 1.45; background: #fff; }}
 header {{ display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap;
          border-bottom:2px solid var(--tinta); padding-bottom:10px; margin-bottom:18px; }}
 h1 {{ font-size: 22px; margin: 0; }}
 h2 {{ font-size: 13px; text-transform: uppercase; letter-spacing:.06em; color: var(--t2); margin: 22px 0 6px; }}
 .meta {{ color: var(--t2); font-size: 13px; }}
 .grade {{ display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }}
 .grade div {{ border:1px solid var(--linha); border-radius:10px; padding:8px 10px; }}
 .grade small {{ display:block; color:var(--t2); font-size:11px; text-transform:uppercase; }}
 table {{ width:100%; border-collapse: collapse; font-size: 14px; }}
 td {{ border-bottom: 1px solid var(--linha); padding: 5px 4px; }}
 .s-sim {{ color:#b42318; font-weight:700; }} .s-pend {{ color: var(--t2); }}
 ul {{ margin: 4px 0; padding-left: 20px; }} .vazio {{ color: var(--t2); list-style: none; margin-left:-20px; }}
 .aviso {{ margin-top: 26px; font-size: 12px; color: var(--t2); border-top: 1px solid var(--linha); padding-top: 10px; }}
 button {{ position: fixed; right: 20px; top: 20px; padding: 8px 14px; border-radius: 999px; border: 0;
          background: var(--azul); color: #fff; font-weight: 700; cursor: pointer; }}
 @media print {{ button {{ display: none; }} body {{ margin: 0; }} }}
</style></head><body>
<button onclick="print()">Imprimir / salvar PDF</button>
<header><div><h1>{e(c.get('queixa', ''))}</h1>
<div class="meta">Caso {e(c['caso'])} · paciente {e(f['paciente'])} · desde {e(c.get('inicio', ''))}</div></div>
<div class="meta">gerada em {e(f['gerada'])}</div></header>
<div class="grade">
 <div><small>Queixa (CIAP-2)</small>{e(c.get('ciap2') or '—')}</div>
 <div><small>Região</small>{e(cj['regiao_nome'] or '—')}{lado}</div>
 <div><small>Dor máxima</small>{dor}</div>
 <div><small>Nível indicado</small>{e(cj['nivel_nome'])}</div>
</div>
<h2>Sobre a pessoa</h2><p>{e(f['perfil'] or '—')}</p>
<div class="grade">
 <div><small>Alergias</small><ul>{li(f['fixa']['alergia'])}</ul></div>
 <div><small>Remédios em uso</small><ul>{li(f['fixa']['medicamento'])}</ul></div>
 <div><small>Condições</small><ul>{li(f['fixa']['condicao'])}</ul></div>
</div>
<h2>Como começou</h2><ul>{li(cj['resumo'])}</ul>
<h2>Linha do tempo</h2><ul>{linha or "<li class='vazio'>—</li>"}</ul>
<h2>Sinais de alerta checados</h2><table>{sinais or '<tr><td>—</td></tr>'}</table>
<h2>Exames e consultas registrados</h2><ul>{li([t + ': ' + s for t, s in f['registros']])}</ul>
<h2>Orientações recebidas</h2><ul>{li(cj['plano'])}</ul>
{hip}
<h2>Perguntas para levar</h2><ul>{li(f['perguntas'])}</ul>
<p class="aviso">Resumo organizado pelo BMX a partir do que a pessoa relatou. Não é laudo nem diagnóstico.
Sinais marcados como "não perguntado" não foram avaliados.</p>
</body></html>"""
