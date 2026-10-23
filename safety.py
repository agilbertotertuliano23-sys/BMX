"""
Sinais de alerta do BMX.

Roda ANTES do modelo, sobre o texto do usuário, com regras fixas. Se bater, o
servidor manda um evento `alert` para a interface (faixa vermelha com o número
certo, que aparece mesmo se o Claude falhar) e injeta uma instrução no prompt
para a resposta começar pela orientação de emergência.

As regras pecam pelo excesso de propósito: um falso alarme custa uma faixa na
tela; um alarme perdido pode custar muito mais.
"""
import re
import unicodedata

SAMU = ("SAMU", "192")
BOMBEIROS = ("Bombeiros", "193")
CVV = ("CVV — apoio emocional 24 h", "188")
INTOX = ("Disque-Intoxicação (Anvisa)", "0800 722 6001")


def _norm(text):
    text = unicodedata.normalize("NFKD", (text or "").lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9/ ]+", " ", text).split())


# (categoria, título, telefones, padrões sobre o texto normalizado)
_RULES = [
    ("crise", "Risco à própria vida", [CVV, SAMU], [
        r"\bsuicid", r"\bme matar\b", r"\bquero morrer\b", r"\btirar (a )?minha (propria )?vida\b",
        r"\bacabar com (tudo|a minha vida|minha vida)\b", r"\bnao (quero|aguento) mais viver\b",
        r"\bme (machucar|cortar|ferir)\b", r"\bautomutila", r"\bsem motivo pra viver\b",
    ]),
    ("emergencia", "Possível emergência cardíaca", [SAMU], [
        r"\b(dor|aperto|pressao|queimacao) (forte |no |na )*peito\b", r"\binfarto\b",
        r"\bdor no braco esquerdo\b",
    ]),
    ("emergencia", "Possível AVC", [SAMU], [
        r"\b(boca|rosto|cara) (ficou )?tort", r"\bfala (enrolada|arrastada)\b", r"\bnao consigo falar\b",
        r"\bfraqueza (de|em|no|na) um lado\b", r"\b(lado|metade) do corpo (dormente|fraco|paralisad)",
        r"\bavc\b", r"\bderrame\b",
    ]),
    ("emergencia", "Dificuldade para respirar", [SAMU], [
        r"\bnao consigo respirar\b", r"\bsufoc", r"\blabios? (roxo|azul)",
        r"\bfalta de ar (forte|intensa|grave)\b", r"\bmuita falta de ar\b", r"\bengasg",
    ]),
    ("emergencia", "Reação alérgica grave", [SAMU], [
        r"\bgarganta (esta |ta |ficou |fica )?(fechando|fechada|inchada|inchando)\b",
        r"\binchaco (na|no|nos|nas) (garganta|lingua|labios?|rosto)\b",
        r"\banafila", r"\b(lingua|labios?) inchad",
    ]),
    ("emergencia", "Convulsão ou perda de consciência", [SAMU], [
        r"\bconvuls", r"\bdesmai", r"\bperd(eu|i) (a )?(consciencia|os sentidos)\b",
        r"\bnao (acorda|responde)\b", r"\bpior dor de cabeca da (minha )?vida\b", r"\brigidez (na|de) nuca\b",
    ]),
    ("emergencia", "Sangramento importante", [SAMU], [
        r"\bsangramento (forte|intenso|grande|que nao para)\b", r"\bnao para de sangrar\b",
        r"\bvomit(ando|ei|ou) sangue\b", r"\btossindo sangue\b",
        r"\bgravida\b.*\bsangr", r"\bsangr.*\bgravida\b",
    ]),
    ("emergencia", "Possível compressão dos nervos da coluna", [SAMU], [
        r"\bnao (consigo|estou conseguindo|to conseguindo|consegui) (segurar|controlar) (o |a )?(xixi|urina|coco|fezes|intestino|bexiga)\b",
        r"\bperd(i|eu|endo) o controle (do|da|de) (xixi|urina|bexiga|coco|fezes|intestino)\b",
        r"\bnao consigo (fazer xixi|urinar|mijar)\b", r"\b(fiz|faco) xixi na (roupa|calca)\b",
        r"\b(dormencia|formigamento) (na|nas|em|entre as) (virilha|genitais|regiao intima|coxas)\b",
    ]),
    ("emergencia", "Intoxicação ou overdose", [INTOX, SAMU], [
        r"\boverdose\b", r"\btom(ei|ou) (muitos|varios|uma cartela|a cartela)", r"\benvenen", r"\bintoxica",
        r"\b(bebeu|engoliu|ingeriu) (agua sanitaria|produto de limpeza|veneno|soda)",
    ]),
    ("emergencia", "Trauma grave", [SAMU, BOMBEIROS], [
        r"\batropel", r"\bacidente (de carro|de moto|grave)\b",
        r"\bbat(i|eu) (forte )?a cabeca\b.*\b(vomit|desmai|confus)",
        r"\bqueimadura (grave|grande|extensa)\b", r"\bchoque eletrico\b",
    ]),
]
_COMPILED = [(cat, title, phones, [re.compile(p) for p in pats]) for cat, title, phones, pats in _RULES]


def check(message):
    """Devolve o primeiro alerta que bater (crise vem antes), ou None.
    Comandos (/alergia, /medicamento...) não disparam: são cadastro, não relato."""
    norm = _norm(message)
    if not norm or norm.startswith("/") and not norm.startswith(("/sintoma", "/dor")):
        return None
    for cat, title, phones, pats in _COMPILED:
        if any(p.search(norm) for p in pats):
            return dict(level=cat, title=title,
                        phones=[dict(name=n, number=num) for n, num in phones])
    return None


def instruction(alert):
    phones = "; ".join(f"{p['name']} {p['number']}" for p in alert["phones"])
    if alert["level"] == "crise":
        return ("## ALERTA — risco à própria vida\n"
                "A mensagem sugere sofrimento intenso ou risco de autolesão. Comece acolhendo, com calma e "
                "sem julgamento, em poucas frases. Diga com clareza que a pessoa não está sozinha e que pode "
                f"falar agora com: {phones}. Se houver risco imediato, oriente ligar 192 ou ir ao pronto-socorro. "
                "Pergunte se ela está em segurança agora. Não faça triagem clínica nesta resposta.")
    return ("## ALERTA — possível emergência: " + alert["title"] + "\n"
            f"A mensagem tem sinal de alerta. A primeira frase da resposta deve orientar ligar para {phones} "
            "ou ir ao pronto-socorro mais próximo AGORA. Depois, no máximo duas orientações do que fazer "
            "enquanto a ajuda chega. Não sugira esperar, nem automedicação.")
