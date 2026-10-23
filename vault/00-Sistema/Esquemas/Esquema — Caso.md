---
type: esquema
updated: 2026-10-22
---

# Esquema — Caso (episódio de cuidado)

`10-Pacientes/<ID>/Casos/C-AAAAMMDD-n — <título>.md`. Criado e atualizado só pelo servidor (`casos.py`).

```yaml
type: caso
paciente: P0001
caso: C-20261022-1
queixa: Dor — Coxa e joelho, direito
queixa_id: dor-membros        # id em Clinica/queixas-de-entrada.json
ciap2: L08/L15/L17
regiao: coxa-joelho           # id no catálogo anatômico
lado: direito
estruturas: femur,tibia,patela,menisco-medial,lca,quadriceps
inicio: 2026-10-22
status: aberto                # aberto | acompanhamento | encaminhado | resolvido
nivel: urgente                # maior nível visto; só sobe sozinho
dor_max: 7
dor_ultima: 7
origem: paciente
updated: 2026-10-22
updated_em: 2026-10-22T10:30
```

Seções: `## Resumo` · `## Sinais de risco` (`- [ ]` não perguntado, `- [x]` sim, `- [-]` não) · `## Linha do tempo` (uma linha por turno, com link para o atendimento) · `## Hipóteses` (link para a análise da região) · `## Plano` (orientação dada quando o BMX marcou `[nível: …]`) · `## Desfecho`.

## Regras
- **Abrir/retomar:** com caso em foco, o relato fica nele, a não ser que aponte outra região do corpo. Sem caso em foco: retoma um aberto (até 30 dias) da mesma queixa, ou da mesma região se as queixas não se contradizem; senão abre um novo.
- **Sinais:** marcados quando citados no relato (negação 'não/sem' antes vira "não") ou por um sim/não curto à pergunta anterior do BMX.
- **Nível:** alerta fixo → emergência; sinal positivo → urgente; marcação `[nível: …]` da resposta do BMX. Nunca desce sozinho.
- **Seguimento:** caso aberto sem notícia há mais de 48 h → o BMX pergunta pela evolução na próxima conversa.
- **Comandos:** `/caso`, `/caso novo <queixa>`, `/caso <ID>`, `/caso encerrar <desfecho>` (com "encaminh…" vira encaminhado), `/casos`, `/ficha [hipoteses]`.

Ver [[PRD — Organização de caso]] e [[Mapa do cofre]].
