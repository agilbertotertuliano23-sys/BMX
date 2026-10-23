---
type: esquema
updated: 2026-10-21
---

# Esquema — Registro (recebido)

`10-Pacientes/<ID>/Registros/<Tipo> — <rótulo>.md`. Uma nota por coisa; cada novo relato vira uma linha datada.

| type | Comando | Entra na ficha fixa? |
|---|---|---|
| alergia | `/alergia dipirona, urticária` | sim, sempre |
| medicamento | `/medicamento losartana 50 mg 1x/dia` | sim, sempre |
| condicao | `/condicao hipertensão` | sim, sempre |
| sintoma | `/sintoma dor no joelho direito ao subir escada` | por relevância |
| consulta | `/consulta ortopedista pediu raio-x` | por relevância |
| exame | `/exame hemograma, normal` | por relevância |

```yaml
type: alergia            # um dos tipos acima
paciente: P0001
origem: paciente         # paciente | profissional | documento
registrado_por: comando  # comando | manual
updated: AAAA-MM-DD
```
Corpo: `Parte do [[Perfil de saúde]].` e linhas `- DD/MM/AAAA: texto`.
