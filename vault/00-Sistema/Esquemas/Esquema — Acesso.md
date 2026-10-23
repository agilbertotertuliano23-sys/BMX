---
type: esquema
updated: 2026-10-21
---

# Esquema — Acesso (interação)

Dois formatos do mesmo evento, em `30-Acessos/`:
- `acessos.jsonl` — uma linha JSON por evento, para análise por máquina.
- `AAAA-MM/AAAA-MM-DD.md` — tabela do dia, para ler no Obsidian.

```json
{"em": "AAAA-MM-DDTHH:MM:SS", "evento": "pergunta", "paciente": "P0001",
 "comando": "sintoma", "status": "ok", "alerta": "emergencia", "notas": 3, "estruturas": 6}
```

| evento | quando |
|---|---|
| servidor_inicio | o servidor subiu |
| pergunta | uma mensagem foi ao modelo |
| comando | um comando (local ou com modelo) |
| leitura_nota | a interface abriu uma nota |
| nova_conversa / cancelar | sessão reiniciada |

Campos vazios são omitidos. **Nunca** há texto do relato ou da resposta aqui.
