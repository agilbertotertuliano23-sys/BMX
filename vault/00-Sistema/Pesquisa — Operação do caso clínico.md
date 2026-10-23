---
type: sistema
updated: 2026-10-22
---

# Pesquisa — Operação do caso clínico

Base do [[PRD — Organização de caso]]. Como um caso é recebido, investigado e registrado no mundo real, e o que isso vira de requisito no BMX.

## 1. Porta de entrada: acolhimento com classificação de risco
- No Brasil, a classificação de risco nas portas de urgência segue a Portaria GM/MS 2048/2002 e a Política Nacional de Humanização; muitos serviços usam o **Protocolo de Manchester** (no Brasil desde 2008).
- Estrutura do Manchester: parte da **queixa principal**, escolhe um **fluxograma** (cerca de 50, por queixa ou apresentação), percorre **discriminadores** (risco de vida, dor, hemorragia, consciência, temperatura, agudeza) e chega a uma de **cinco prioridades** com tempo-alvo: vermelho 0 min, laranja 10, amarelo 60, verde 120, azul 240.
- A ficha registra: data e hora, queixa, fluxograma, discriminador escolhido e prioridade.
- A maior parte da demanda é de baixo risco: numa UPA brasileira (2018–2022), 90% dos atendimentos foram de baixo risco; em outro estudo, verde+azul foram 85%.
- **Vira requisito:** etapas 0, 1, 4 e 5 do PRD; RF-06 a RF-08; registrar discriminador e nível no caso. O BMX tem 4 níveis próprios (emergência, urgente, consulta, autocuidado), não as cores oficiais.

## 2. O que chega: queixas de entrada
- **EUA, emergências (NHAMCS 2022), 10 motivos de visita:** dor abdominal; dor no peito; tosse; falta de ar; febre; dor de cabeça; dor em local não específico; sintomas nas costas; vômito; sintomas psicológicos.
- **EUA, 10 grupos de diagnóstico:** sinais e sintomas sem diagnóstico fechado (1º!), lesões e envenenamentos, respiratório, osteomuscular, digestivo, geniturinário, mental, circulatório, infeccioso, pele.
- **Brasil (UPA, 2018–2022):** osteomusculares 24%, respiratórias 15%, infecciosas e parasitárias 11%; sintomas gripais 24% e osteomusculares 22%. Em UPA pediátrica, febre é a principal queixa; em estudo com Manchester, mal-estar no adulto, problemas em extremidades, dor abdominal e cefaleia lideram.
- **Brasil, internação (SIH/SUS):** gravidez e parto, lesões e envenenamentos, respiratórias e digestivas lideram por região; arboviroses (dengue) pesam na febre.
- **Leitura importante:** o diagnóstico mais comum na emergência é "sintoma sem diagnóstico fechado". Organizar o caso pela **queixa**, e não pela doença, é o que a operação real faz.
- **Vira requisito:** [[Queixas de entrada]] (18 queixas, CIAP-2, causas frequentes, não deixar passar, sinais de alerta, perguntas-chave), ligadas ao catálogo anatômico.

## 3. Como o caso é escrito: registro orientado por problemas
- **Lawrence Weed (anos 1960):** base de dados da pessoa + **lista de problemas** + notas de evolução **SOAP** (Subjetivo, Objetivo, Avaliação, Plano). É a origem do "caso" como unidade.
- **CIAP-2** (obrigatória no e-SUS APS) codifica o **motivo da consulta como a pessoa diz**, o problema avaliado e o procedimento; **CID-10** codifica diagnóstico fechado (hospital, convênio). Um CIAP-2 pode corresponder a vários CID-10.
- **Vira requisito:** queixa com CIAP-2 (recebido) separada de hipótese com CID-10 (analisado); o caso tem S (relato), O (dor, medidas, registros), A (hipóteses do BMX, marcadas) e P (plano/orientação).

## 4. Como os sistemas modelam: HL7 FHIR
- **Patient** (pessoa), **Encounter** (encontro), **EpisodeOfCare** (episódio — o nosso caso), **Condition** (problema ou diagnóstico, também lista de problemas), **Observation** (medida: dor, temperatura), **ClinicalImpression** (avaliação para determinar o problema — a nossa análise), **AllergyIntolerance**, **MedicationStatement**, **AuditEvent** (acesso), **Provenance** (origem).
- ClinicalImpression costuma ser 1:1 com o encontro, mas varia com o fluxo.
- **Vira requisito:** a tabela de conceitos do PRD (seção 4) já usa esse mapa; facilita exportar para um sistema de saúde no futuro.

## 5. Regulação e responsabilidade
- **Anvisa:** RDC 657/2022 (software como dispositivo médico) + RDC 751/2022 (classes de risco). Software que apoia decisão diagnóstica ou terapêutica tende à Classe II; se a decisão puder causar deterioração grave, Classe III. Classes I/II: notificação; III/IV: registro.
- **LGPD:** dado de saúde é sensível.
- **Manchester:** conteúdo licenciado; usar só a estrutura.
- **Vira requisito:** seção 11 do PRD; BMX segue como uso pessoal/educativo até enquadramento.

## 6. Lacunas desta pesquisa
- Não abri o TabNet (ranking nacional por CID de 2023–2024) nem o manual oficial do e-SUS APS; os números brasileiros são de estudos locais.
- Os códigos CIAP-2 da tabela de queixas são de referência e precisam de conferência na tabela da SBMFC.
- Os livros e materiais que você vai indicar devem preencher a parte clínica (semiologia, urgência) — ver [[Fontes — Como adicionar]].

## Fontes
- CDC/NCHS — Estimates of Emergency Department Visits, 2016–2022: https://www.cdc.gov/nchs/dhcs/ed-visits/
- Saúde em Debate — UPA e Atenção Primária: https://www.scielo.br/j/sdeb/a/gP9kFPPtfzHBjgRJJsW7GXM/
- Protocolo de Manchester (Afya Educação Médica): https://educacaomedica.afya.com.br/blog/protocolo-de-manchester
- CFM Parecer 1969/2010 (classificação de risco): https://sistemas.cfm.org.br/normas/arquivos/pareceres/SC/2010/1969_2010.pdf
- CIAP-2 × CID-10: https://www.usebip.com/blogs/bip-insights/cid-10-e-ciap-2-diferenca-e-como-converter-os-codigos
- HL7 FHIR clinical resources: https://www.hl7.org/fhir/DSTU2/clinical.html
- Anvisa RDC 657/2022: https://antigo.anvisa.gov.br/documents/10181/5141677/RDC_657_2022_COMP.pdf/d2da154d-bd76-40ba-87ee-3d9baadb5dd3
- Classes de SaMD (Mattos Filho): https://www.mattosfilho.com.br/en/unico/anvisa-softwares-dispositivos/
- Revista de Enfermagem UFG (Manchester em UPA): https://revistas.ufg.br/fen/article/download/21700/16967/133724
- Revista Baiana de Enfermagem 2020: https://doaj.org/article/906a0cb84fff4cd18500191c30a55d9a
