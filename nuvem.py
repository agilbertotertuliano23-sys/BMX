"""
Modo nuvem do BMX (BMX_CLOUD=1). Sem essa variável nada aqui muda o comportamento local.

Na nuvem o servidor fica atrás de um domínio público, então o que no PC era garantido pelo
"escuta só em 127.0.0.1" passa a ser feito aqui:

  - login por senha (BMX_PASSWORD) e cookie assinado: HttpOnly, Secure, SameSite=Strict;
  - nada é servido sem login — nem a interface, que carrega o token da API;
  - limite de tentativas de login e de uso por janela (custo da API e força bruta);
  - cabeçalhos de segurança (CSP, HSTS, anti-iframe, nosniff);
  - Host e Origin só do domínio configurado (BMX_ALLOWED_HOSTS ou o do Render).
"""
import base64
import hashlib
import hmac
import os
import secrets
import threading
import time

CLOUD = os.environ.get("BMX_CLOUD", "").strip() == "1"

COOKIE = "bmx_sessao"
SESSAO_SEG = 12 * 3600
MIN_SENHA = 12

_SENHA = os.environ.get("BMX_PASSWORD", "")
_SEGREDO = (os.environ.get("BMX_SECRET") or secrets.token_urlsafe(48)).encode()
_HOSTS = {h.strip().lower() for h in (os.environ.get("BMX_ALLOWED_HOSTS", "") + "," +
                                      os.environ.get("RENDER_EXTERNAL_HOSTNAME", "")).split(",") if h.strip()}

# Tentativas de login: por IP e no total (um app de uma pessoa só: o total também vale).
LOGIN_POR_IP = (5, 15 * 60)
LOGIN_TOTAL = (40, 15 * 60)
# Limite de uso por rota (n, janela em segundos). Protege a chave da API contra laço ou abuso.
USO = {"/api/run": (40, 600), "/api/speak": (60, 600), "/api/listen": (30, 600)}
MAX_MENSAGEM = 4000

_lock = threading.Lock()
_falhas = {}   # chave -> [instantes]
_uso = {}      # rota -> [instantes]


def validar_config():
    """Na nuvem, sem senha forte o servidor não sobe: melhor falhar do que ficar aberto."""
    if not CLOUD:
        return
    if len(_SENHA) < MIN_SENHA:
        raise SystemExit(f"BMX_CLOUD=1 exige BMX_PASSWORD com pelo menos {MIN_SENHA} caracteres.")
    if not _HOSTS:
        raise SystemExit("BMX_CLOUD=1 exige BMX_ALLOWED_HOSTS (ex.: bmx.onrender.com).")


# ── Host / Origin ──────────────────────────────────────────────────────────

def host_ok(host, porta):
    host = (host or "").lower()
    if not CLOUD:
        return host in {f"127.0.0.1:{porta}", f"localhost:{porta}"}
    return host in _HOSTS


def origin_ok(origin, porta):
    origin = (origin or "").lower()
    if not CLOUD:
        return origin in {f"http://127.0.0.1:{porta}", f"http://localhost:{porta}"}
    return origin in {f"https://{h}" for h in _HOSTS}


# ── Cookie de sessão ───────────────────────────────────────────────────────

def _assina(carga):
    return hmac.new(_SEGREDO, carga.encode(), hashlib.sha256).hexdigest()


def novo_cookie():
    validade = str(int(time.time()) + SESSAO_SEG)
    carga = base64.urlsafe_b64encode(validade.encode()).decode()
    return f"{COOKIE}={carga}.{_assina(carga)}; Max-Age={SESSAO_SEG}; Path=/; HttpOnly; Secure; SameSite=Strict"


def cookie_apagar():
    return f"{COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict"


def logado(cabecalho_cookie):
    if not CLOUD:
        return True
    for par in (cabecalho_cookie or "").split(";"):
        nome, _, valor = par.strip().partition("=")
        if nome != COOKIE or "." not in valor:
            continue
        carga, _, assinatura = valor.partition(".")
        if not hmac.compare_digest(assinatura, _assina(carga)):
            continue
        try:
            return int(base64.urlsafe_b64decode(carga.encode()).decode()) > time.time()
        except (ValueError, UnicodeDecodeError):
            continue
    return False


# ── Login e limites ────────────────────────────────────────────────────────

def _janela(lista, agora, seg):
    lista[:] = [t for t in lista if agora - t < seg]
    return lista


def login_bloqueado(ip):
    agora = time.time()
    with _lock:
        por_ip = _janela(_falhas.setdefault(ip, []), agora, LOGIN_POR_IP[1])
        total = _janela(_falhas.setdefault("*", []), agora, LOGIN_TOTAL[1])
        return len(por_ip) >= LOGIN_POR_IP[0] or len(total) >= LOGIN_TOTAL[0]


def senha_ok(tentativa, ip):
    """Compara em tempo constante e registra a falha. Devolve True se a senha confere."""
    a = hashlib.sha256((tentativa or "").encode()).digest()
    b = hashlib.sha256(_SENHA.encode()).digest()
    ok = hmac.compare_digest(a, b)
    if not ok:
        agora = time.time()
        with _lock:
            _falhas.setdefault(ip, []).append(agora)
            _falhas.setdefault("*", []).append(agora)
        time.sleep(1)   # custo fixo por erro: segura quem tenta em série
    return ok


def uso_excedido(rota):
    if not CLOUD or rota not in USO:
        return False
    n, seg = USO[rota]
    agora = time.time()
    with _lock:
        usos = _janela(_uso.setdefault(rota, []), agora, seg)
        if len(usos) >= n:
            return True
        usos.append(agora)
    return False


def ip_cliente(cabecalhos, endereco):
    """Atrás do proxy do Render o IP real é o último item de X-Forwarded-For (o que o proxy acrescenta)."""
    if CLOUD:
        xff = cabecalhos.get("X-Forwarded-For", "")
        if xff:
            return xff.split(",")[-1].strip()
    return endereco


# ── Cabeçalhos de segurança ────────────────────────────────────────────────

# A interface usa <script> inline pequeno (intro, importmap) e Google Fonts; o resto é do próprio domínio.
CSP = ("default-src 'self'; "
       "script-src 'self' 'unsafe-inline'; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; "
       "img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; "
       "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; "
       "frame-ancestors 'self'")

_CABECALHOS = (
    ("Content-Security-Policy", CSP),
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "SAMEORIGIN"),
    ("Referrer-Policy", "no-referrer"),
    ("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=()"),
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("X-Robots-Tag", "noindex, nofollow"),
    ("Strict-Transport-Security", "max-age=31536000; includeSubDomains"),
)


def cabecalhos_seguranca():
    return _CABECALHOS if CLOUD else ()


# ── Página de login ────────────────────────────────────────────────────────

LOGIN_HTML = """<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>BMX · entrar</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef3f7;font:16px system-ui,sans-serif;color:#14212e}
 form{background:#fff;padding:32px;border-radius:16px;box-shadow:0 8px 30px rgba(20,33,46,.12);width:min(340px,86vw)}
 h1{margin:0 0 4px;font-size:22px} p{margin:0 0 18px;color:#5a6b7a;font-size:14px}
 input,button{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;font:inherit}
 input{border:1px solid #c5d0da;margin-bottom:12px} button{border:0;background:#14212e;color:#fff;cursor:pointer}
 .erro{color:#b3261e;font-size:14px;min-height:18px;margin-top:10px}
</style></head><body>
<form id="f" autocomplete="off">
 <h1>BMX</h1><p>Acesso restrito. Digite a senha.</p>
 <input id="s" type="password" placeholder="Senha" autofocus required autocomplete="current-password">
 <button>Entrar</button><div class="erro" id="e"></div>
</form>
<script>
document.getElementById('f').addEventListener('submit', async function (ev) {
  ev.preventDefault();
  var e = document.getElementById('e'); e.textContent = '';
  try {
    var r = await fetch('/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senha: document.getElementById('s').value }) });
    if (r.ok) { location.href = '/'; return; }
    e.textContent = r.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Senha incorreta.';
  } catch (x) { e.textContent = 'Sem conexão com o servidor.'; }
});
</script></body></html>
"""
