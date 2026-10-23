---
type: esquema
updated: 2026-10-21
---

# Esquema — Análise (analisado pelo BMX)

`10-Pacientes/<ID>/Analises/Análise — <Região>.md`. Criada e acrescida pelo servidor quando um relato aciona estruturas do catálogo. Uma nota por região, para ver a evolução no tempo.

```yaml
type: analise
paciente: P0001
origem: bmx
confianca: hipotese
regiao: coxa-joelho      # id da região no catálogo
updated: AAAA-MM-DD
```
Cada linha: `- DD/MM/AAAA HH:MM · [[atendimento]] · relato: … · estruturas: …`.
Liga ao `Perfil de saúde` e à nota `Região — …` em `40-Conhecimento/Anatomia/Regiões`.
