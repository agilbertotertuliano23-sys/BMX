---
type: esquema
updated: 2026-10-21
---

# Esquema — Atendimento (operação)

`20-Operacoes/Atendimentos/AAAA-MM/AAAA-MM-DD HHhMM — <ID>.md`. Um arquivo por conversa: abre outro em `/novo`, nova conversa, cancelar ou troca de paciente. O sufixo `— <ID>` liga o atendimento ao paciente.

```yaml
type: atendimento
paciente: P0001
inicio: AAAA-MM-DDTHH:MM
nivel: ""                # "" | emergencia | crise (o maior alerta da conversa)
updated: AAAA-MM-DD
```
Cada turno:
```
## HH:MM · /comando
- relato: …
- alerta: título (nível)
- memória consultada: [[nota]], [[nota]]
- estruturas destacadas: … → [[Análise — Região]]
- resposta do BMX: …
```
