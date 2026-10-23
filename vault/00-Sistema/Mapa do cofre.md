---
type: sistema
updated: 2026-10-21
---

# Mapa do cofre — BMX

> Próximo passo em discussão: [[PRD — Organização de caso]] · base: [[Pesquisa — Operação do caso clínico]].

Este cofre é a memória do BMX (agente em `Downloads/web/AGENTS/BMX`, apontado por `BMX_VAULT` no `.env`).
Cada zona tem **um dono** (quem escreve) e **uma regra de leitura** (o que chega ao modelo).

| Zona | O que guarda | Quem escreve | Chega ao modelo? |
|---|---|---|---|
| `00-Sistema` | este mapa, [[Regras de acesso e privacidade]], esquemas | você, à mão | não |
| `10-Pacientes/<ID>/` | `Perfil de saúde`, `Casos/` (episódios), `Registros/` (**recebido**) e `Analises/` (**analisado**) | comandos do BMX e o servidor | só o paciente ativo |
| `20-Operacoes/Atendimentos/` | um arquivo por conversa: relato, alerta, memória consultada, estruturas destacadas, resposta | servidor (`registro.py`) | só os do paciente ativo, por relevância |
| `30-Acessos/` | quem fez o quê e quando, **sem conteúdo clínico** (`acessos.jsonl` + um `.md` por dia) | servidor (`registro.py`) | nunca |
| `40-Conhecimento/` | `Guias/`, `Anatomia/`, `Clinica/` (queixas de entrada) e `Fontes/` (livros, só aprovados entram) (catálogo, bibliotecas 3D, regiões, sistemas) | você + `python anatomia.py notas` | sim, igual para todos; é a pasta de trabalho do modelo (só leitura) |

## Recebido × analisado
A separação que importa num prontuário:
- **Recebido** (`Registros/`, `origem: paciente`): o que a pessoa contou ou trouxe — alergia, remédio, exame, consulta, sintoma. Vale como fato sobre ela.
- **Analisado** (`Analises/`, `origem: bmx`, `confianca: hipotese`): o que o BMX levantou a partir dos relatos — uma nota por região investigada, com data, estruturas e link para o atendimento. É pista, não diagnóstico.
- **Profissional** (`origem: profissional`): o que veio de médico ou laudo. Escreva à mão em `Registros/`.

## Operações × acessos
- **Operação** = o conteúdo do que aconteceu (`20-Operacoes`, ligado ao paciente).
- **Acesso** = o rastro de quem mexeu (`30-Acessos`, sem conteúdo). Serve para auditoria e uso, e por isso nunca volta ao modelo.

## Fluxo de uma pergunta
1. `safety.py` procura sinais de alerta no texto, antes do modelo.
2. `anatomia.py` liga o relato a regiões e estruturas do [[Anatomia — Índice|catálogo]] → evento `anatomia` para a interface + bloco de contexto.
3. `memory.py` monta a ficha fixa do paciente ativo e as notas relevantes (prontuário, atendimentos, guias).
4. O Claude responde (só leitura, pasta `40-Conhecimento`).
5. `registro.py` grava o turno no atendimento, atualiza a análise da região e escreve a linha de acesso.

## Esquemas
[[Esquema — Paciente]] · [[Esquema — Caso]] · [[Esquema — Registro]] · [[Esquema — Análise]] · [[Esquema — Atendimento]] · [[Esquema — Acesso]] · [[Esquema — Estrutura anatômica]]
