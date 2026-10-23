"""
Preparação do texto para a voz (Fish Audio S2.1-Pro, pt-BR). O texto que o Claude escreve é para ler com
os olhos; aqui ele vira texto para ser FALADO:

  - fonologia: números, unidades e siglas escritos como se leem; o nome do agente como o Baymax;
  - pontuação: o que a voz leria errado ou com entonação trocada (parênteses, travessão, ponto e vírgula,
    dois-pontos, barras, "!" que deixa a voz agitada) vira vírgula ou ponto;
  - ênfase e tom: *palavra* vira [emphasis] antes da palavra; as marcações de tom vão para o começo da
    frase, com nomes que o modelo conhece, no máximo duas por frase.

Só biblioteca padrão. O texto na tela não muda: isto roda no servidor, só para o áudio.
"""
import re

_UNID = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
         "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
_DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
_CEN = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos",
        "oitocentos", "novecentos"]

# marcações do persona -> nomes que o S2.1-Pro conhece; None descarta (a velocidade já é calma)
TONS = {"gentle": "soft tone", "reassuring": "calm", "concerned": "worried", "warm": "empathetic", "slowly": None}
POSICIONAIS = {"emphasis", "break", "long-break"}   # ficam onde foram escritas

UNIDADES = {  # (singular, plural)
    "mg": ("miligrama", "miligramas"), "mcg": ("micrograma", "microgramas"), "g": ("grama", "gramas"),
    "kg": ("quilo", "quilos"), "ml": ("mililitro", "mililitros"), "cm": ("centímetro", "centímetros"),
    "mm": ("milímetro", "milímetros"), "bpm": ("batimento por minuto", "batimentos por minuto"),
    "mmhg": ("milímetro de mercúrio", "milímetros de mercúrio"), "min": ("minuto", "minutos"),
    "h": ("hora", "horas"),
}
SIGLAS = {  # maiúsculas, como aparecem no texto
    "BMX": "Baymax", "SAMU": "Samu", "UPA": "Upa", "SUS": "Sus", "UBS": "u bê ésse", "CVV": "cê vê vê",
    "AVC": "á vê cê", "IMC": "i eme cê",
}
EMERGENCIA = ("188", "190", "191", "192", "193")   # número de telefone: lido dígito a dígito
_CTX_FONE = re.compile(r"samu|cvv|bombeir|pol[ií]cia|ligu|ligar|disqu|chame|telefone|n[uú]mero|emerg", re.I)


def _ate_999(n):
    if n == 100:
        return "cem"
    c, r = divmod(n, 100)
    partes = [_CEN[c]] if c else []
    if r:
        if r < 20:
            partes.append(_UNID[r])
        else:
            d, u = divmod(r, 10)
            partes.append(_DEZ[d] + (" e " + _UNID[u] if u else ""))
    return " e ".join(partes)


def por_extenso(n):
    """Inteiro -> palavras em português do Brasil (até 999 999 999; acima disso devolve os dígitos)."""
    if n < 0:
        return "menos " + por_extenso(-n)
    if n < 20:
        return _UNID[n]
    if n < 1000:
        return _ate_999(n)
    if n < 10 ** 6:
        mil, r = divmod(n, 1000)
        cab = "mil" if mil == 1 else _ate_999(mil) + " mil"
        return cab if not r else cab + (" e " if (r < 100 or r % 100 == 0) else " ") + _ate_999(r)
    if n < 10 ** 9:
        mi, r = divmod(n, 10 ** 6)
        cab = "um milhão" if mi == 1 else _ate_999(mi) + " milhões"
        return cab if not r else cab + (" e " if (r < 100 or r % 100 == 0) else " ") + por_extenso(r)
    return " ".join(_UNID[int(d)] for d in str(n))


def _digitos(s):
    return " ".join(_UNID[int(d)] for d in s if d.isdigit())


def _decimal(m):
    inteiro, frac = m.group(1), m.group(2)
    f = _digitos(frac) if (frac.startswith("0") or len(frac) > 2) else por_extenso(int(frac))
    return f"{por_extenso(int(inteiro))} vírgula {f}"


def _unidade(m):
    num, sigla = m.group(1), m.group(2).lower().replace(" ", "")
    if sigla in ("°c", "ºc", "°", "º"):
        return f"{num} grau" + ("" if num in ("1", "1,0") else "s")
    if sigla == "%":
        return f"{num} por cento"
    sing, plur = UNIDADES[sigla]
    return f"{num} {sing if num == '1' else plur}"


_UN_RE = re.compile(r"(\d+(?:,\d+)?)\s*(°\s*C|º\s*C|°|%|mmHg|mcg|bpm|mg|kg|ml|cm|mm|min|g|h)(?![\wÀ-ÿ])", re.I)


def pronunciar(frase):
    """Números, unidades e siglas escritos como se leem."""
    t = re.sub(r"R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?",
               lambda m: m.group(1).replace(".", "") + (" reais" if m.group(1) != "1" else " real")
               + (f" e {int(m.group(2))} centavos" if m.group(2) and int(m.group(2)) else ""), frase)
    t = re.sub(r"(\d{1,2})h(\d{2})\b", lambda m: f"{m.group(1)} horas e {m.group(2)}", t)
    t = re.sub(r"(\d{1,2}):(\d{2})\b", lambda m: f"{m.group(1)} horas e {m.group(2)}", t)
    t = _UN_RE.sub(_unidade, t)
    t = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", t)                              # 1.200 -> 1200
    if _CTX_FONE.search(t):
        t = re.sub(r"\b(" + "|".join(EMERGENCIA) + r")\b", lambda m: _digitos(m.group(1)), t)
    t = re.sub(r"\b(\d+),(\d+)\b", _decimal, t)
    t = re.sub(r"\b\d+\b", lambda m: por_extenso(int(m.group(0))) if len(m.group(0)) <= 9 else _digitos(m.group(0)), t)
    for sigla, fala in SIGLAS.items():
        t = re.sub(r"\b" + sigla + r"\b", fala, t)
    return t


def _limpar(t):
    """Tira o que a voz leria em voz alta ou com a entonação trocada."""
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub("[\U0001F300-\U0001FAFF☀-➿️]", "", t)
    linhas = []
    for l in t.split("\n"):
        l = re.sub(r"^\s*(?:[-*•]+|\d+[.)])\s+", "", l.strip())
        l = re.sub(r"^#+\s*", "", l)
        if l:
            linhas.append(l if l[-1] in ".?!…:;" else l + ".")
    t = " ".join(linhas)
    t = re.sub(r"[`_~>|]+", "", t)
    t = re.sub(r"(?<=\d):(?=\d)", ":", t)
    t = re.sub(r"\s*\(([^)]*)\)", r", \1,", t)                               # (aposto) -> , aposto,
    t = re.sub(r"\s+[—–-]+\s+|[—–]", ", ", t)
    t = re.sub(r"\s*;\s*", ", ", t)
    t = re.sub(r"(?<!\d)\s*:\s*(?=[^\s\d])", ", ", t)                        # dois-pontos -> vírgula
    t = re.sub(r"(?<=\d)\s*/\s*(?=\d)", " por ", t)                          # 12/8 -> 12 por 8
    t = re.sub(r"(?<=[A-Za-zÀ-ÿ])\s*/\s*(?=[A-Za-zÀ-ÿ])", " ou ", t)
    return t


def _tons(frase):
    """Separa as marcações de tom (vão para o começo da frase) das posicionais (ficam onde estão)."""
    tons = []

    def trata(m):
        nome = m.group(1).strip()
        baixo = nome.lower()
        if baixo.startswith(("nível", "nivel")):
            return ""
        if baixo in POSICIONAIS:
            return f"[{baixo}]"
        nome = TONS.get(baixo, nome) if baixo in TONS else nome
        if nome and nome not in tons:
            tons.append(nome)
        return ""

    resto = re.sub(r"\[([^\]]{1,40})\]", trata, frase)
    return "".join(f"[{t}] " for t in tons[:2]), re.sub(r"\s{2,}", " ", resto).strip()


def pontuar(t):
    t = re.sub(r"\s+([,.;!?…])", r"\1", t)
    t = re.sub(r"([,.!?])(?=[^\s\d,.!?)\]\"'”’])", r"\1 ", t)
    t = re.sub(r",{2,}", ",", t)
    t = re.sub(r"(?<!\.)\.\s*\.(?!\.)", ".", t)                             # ". ." / ".." -> "."
    t = re.sub(r"\.{4,}", "...", t)
    t = re.sub(r",\s*([.!?])", r"\1", t)                                    # ", ." -> "."
    t = re.sub(r"!+", ".", t)                                               # "!" deixa a voz agitada
    t = re.sub(r"\?{2,}", "?", t)
    t = re.sub(r"\s{2,}", " ", t).strip(" ,")
    if t and t[-1] not in ".?…":
        t += "."
    return t


def preparar(texto):
    """Texto escrito -> texto para ser falado."""
    t = (texto or "").replace("\r", "")
    t = re.sub(r"\[\s*n[ií]vel\b[^\]]*\]", "", t)                           # marcação do painel, não é fala
    t = re.sub(r"\*\*?([^*\n]{1,60})\*\*?", r"[emphasis] \1", t)             # *palavra* -> ênfase
    t = _limpar(t)
    saida = []
    for frase in re.split(r"(?<=[.!?…])\s+", t):
        if not frase.strip():
            continue
        tons, resto = _tons(frase)
        resto = pronunciar(resto)
        saida.append(tons + resto)
    return pontuar(" ".join(saida))
