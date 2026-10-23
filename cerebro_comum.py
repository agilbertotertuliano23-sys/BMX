"""
Estado comum aos cérebros por API (Anthropic e Gemini). O `claude` local guarda a sessão sozinho; as
APIs não guardam nada, então o servidor mantém o histórico da conversa, o pedido de parar e as mensagens
de erro em português. Só biblioteca padrão.
"""
import threading
import uuid

MAX_MENSAGENS = 24      # as últimas 12 trocas bastam para o fio da conversa e seguram o custo
MAX_SESSOES = 20
_SESSOES = {}
_TRAVA = threading.Lock()

cancelar = threading.Event()   # a tela pediu para parar (Esc)
em_curso = threading.Event()   # há uma resposta sendo gerada por API

# Quando o modelo recusa ou bloqueia, a tela nunca fica sem palavra: o alerta vermelho em código já apareceu.
SEM_RESPOSTA = ("Não consegui responder a isso agora. Se for urgente, ligue 192 (SAMU); "
                "se estiver em sofrimento, o CVV atende no 188.")


def abrir(session_id):
    """(id da sessão, lista de mensagens). Sessão desconhecida vira uma nova."""
    with _TRAVA:
        if session_id not in _SESSOES:
            session_id = str(uuid.uuid4())
            _SESSOES[session_id] = []
            while len(_SESSOES) > MAX_SESSOES:
                _SESSOES.pop(next(iter(_SESSOES)))
        return session_id, _SESSOES[session_id]


def janela(mensagens):
    """Últimas mensagens, começando por uma fala do usuário (as duas APIs exigem)."""
    ultimas = mensagens[-MAX_MENSAGENS:]
    while ultimas and ultimas[0]["role"] != "user":
        ultimas = ultimas[1:]
    return ultimas


def fechar_turno(mensagens, texto):
    """Grava a resposta; sem resposta, tira a pergunta pendurada para não ficar com duas falas do usuário seguidas."""
    if texto.strip():
        mensagens.append({"role": "assistant", "content": texto})
    elif mensagens and mensagens[-1]["role"] == "user":
        mensagens.pop()
