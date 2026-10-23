---
type: sistema
status: implementado (F1–F3); F4 aguardando livros
versao: 0.2
updated: 2026-10-22
---

# PRD — Organização de caso no BMX

> **Implementado em 2026-10-22** — F1 (caso), F2 (Painel do caso em `ui/caso.html`), F3 (seguimento e ficha). F4: fontes só entram aprovadas; aguarda os livros. Testes: `python testes/teste_bmx.py`. Questões em aberto resolvidas pelo padrão: retomar automático (com aviso do BMX), ficha sem hipóteses (opção `/ficha hipoteses`), regras pediátricas e corpo feminino ficam para depois. Base de pesquisa: [[Pesquisa — Operação do caso clínico]]. Arquitetura atual: [[Mapa do cofre]].

## 1. Problema
Hoje o BMX grava **conversas** (atendimentos) e **hipóteses por região** (análises), mas não tem a unidade que organiza o cuidado de verdade: o **caso**, o episódio que começa com uma queixa ("dor no joelho há 3 semanas"), passa por várias conversas, ganha registros (exame, consulta), tem um nível de atendimento e termina num desfecho. Sem o caso:
- duas conversas sobre o mesmo joelho ficam soltas, e o BMX repete perguntas;
- não há linha do tempo de um problema, nem um resumo para levar ao médico;
- a interface não tem o que "apontar": ela mostra o grafo da memória, não o problema.

## 2. Objetivo
Transformar o BMX num **organizador de caso com investigação anatômica visual**: a pessoa descreve o problema, o BMX abre (ou retoma) um caso, conduz a anamnese guiada pela queixa de entrada, checa sinais de alerta, mostra no corpo 3D as estruturas da região e o que ajudaria a diferenciar, registra tudo com a origem certa e acompanha até o desfecho.

### Não-objetivos
- Diagnosticar, prescrever ou substituir triagem profissional.
- Reproduzir o Protocolo de Manchester (é licenciado e feito para enfermeiros em serviço; o BMX usa a mesma *forma* — queixa → perguntas → discriminador → nível — com conteúdo próprio).
- Prontuário para clínica ou hospital (multiusuário, assinatura profissional). Fica para depois, e mudaria a regulação (seção 11).

## 3. Usuários e cenários
| Quem | Cenário |
|---|---|
| Titular (leigo) | "Estou com dor no joelho" → triagem, região destacada, orientação, caso aberto. Três dias depois: "melhorou um pouco" → o BMX retoma o caso. |
| Cuidador de família | Vários pacientes (mãe, filho). Troca de paciente sem vazar dado entre eles. |
| Pessoa indo à consulta | "Monta o resumo para o ortopedista" → ficha do caso com linha do tempo, dor, registros e perguntas para fazer. |

## 4. Conceitos
| Conceito | O que é | Onde mora | Equivalente FHIR |
|---|---|---|---|
| Paciente | a pessoa cuidada | `10-Pacientes/<ID>/Perfil de saúde` | Patient |
| **Caso** | episódio de cuidado de um problema, do início ao desfecho | `10-Pacientes/<ID>/Casos/` (novo) | EpisodeOfCare |
| Atendimento | uma conversa | `20-Operacoes/Atendimentos/` | Encounter |
| Queixa de entrada | o motivo como a pessoa disse, com CIAP-2 | dentro do caso | Condition (motivo) |
| Registro (recebido) | alergia, remédio, exame, consulta | `Registros/` | AllergyIntolerance, MedicationStatement, Observation |
| Análise (hipótese) | estruturas e possibilidades levantadas pelo BMX | `Analises/` → passa a pertencer ao caso | ClinicalImpression |
| Achado anatômico | estrutura destacada no 3D | evento `anatomia` + caso | BodyStructure |
| Nível de atendimento | emergência, urgente, consulta, autocuidado | caso + atendimento | Encounter.priority |
| Desfecho | resolvido, encaminhado, em acompanhamento | caso | EpisodeOfCare.status |
| Acesso | quem fez o quê e quando | `30-Acessos/` | AuditEvent |

## 5. Procedimento do caso (fluxo operacional)
Cada etapa tem entrada, saída e regra. O fluxo é o da porta de urgência adaptado a um agente pessoal (ver pesquisa, seções 1 a 3).

| # | Etapa | Entrada | Saída | Regra |
|---|---|---|---|---|
| 0 | Sinal de alerta (sempre primeiro) | texto cru | alerta na tela + instrução | regras fixas, antes do modelo; falso alarme é aceitável, alarme perdido não |
| 1 | Acolhimento e queixa de entrada | relato | queixa (CIAP-2), região | classificar como a pessoa disse, não como diagnóstico |
| 2 | Abrir ou retomar caso | queixa + casos abertos | caso ativo | mesma queixa/região em caso aberto há menos de 30 dias → retoma; senão abre |
| 3 | Anamnese guiada | perguntas-chave da queixa | respostas no caso | uma pergunta por vez; início, local, intensidade (0–10), característica, irradiação, piora/melhora, sintomas associados, antecedentes, remédios |
| 4 | Discriminadores | respostas + sinais de alerta da queixa | lista checada (sim/não/não perguntado) | qualquer "sim" sobe o nível; não perguntado ≠ não |
| 5 | Nível de atendimento | discriminadores | emergência / urgente / consulta / autocuidado | o maior nível visto no caso fica gravado |
| 6 | Investigação anatômica visual | região + estruturas | destaque 3D + cartão do achado | fala em possibilidades; mostra o que ajudaria a diferenciar |
| 7 | Orientação e plano | nível + ficha fixa | orientação, sinais de retorno, o que levar à consulta | cruza com alergias e remédios; nunca prescreve |
| 8 | Seguimento | caso aberto | "melhorou, igual, piorou?" | ao abrir conversa com caso aberto, o BMX pergunta pelo caso |
| 9 | Desfecho | resposta da pessoa ou registro profissional | caso resolvido/encaminhado | hipótese só vira fato com `origem: profissional` |

## 6. Requisitos funcionais
**Caso**
- RF-01 Criar caso automaticamente na etapa 2, com ID `C-AAAAMMDD-n`, queixa de entrada, CIAP-2, região, data de início, status `aberto`.
- RF-02 Retomar caso aberto quando a queixa ou a região bater (regra da etapa 2), e permitir escolher ("é sobre o joelho de terça?").
- RF-03 Ligar cada atendimento ao caso (`caso:` no frontmatter) e cada análise ao caso.
- RF-04 Linha do tempo do caso: atendimentos, escala de dor, registros, nível, mudanças de status.
- RF-05 Comandos: `/caso` (ver ativo), `/caso novo <queixa>`, `/caso encerrar <desfecho>`, `/casos` (listar).

**Anamnese e discriminadores**
- RF-06 Para a queixa identificada, injetar no contexto as perguntas-chave e os sinais de alerta (já feito: `clinica.py`).
- RF-07 Registrar no caso cada discriminador perguntado e a resposta (sim/não/não sabe), extraídos da resposta do usuário pelo servidor.
- RF-08 Calcular o nível pelo maior discriminador positivo; o alerta de `safety.py` prevalece.

**Investigação visual**
- RF-09 Emitir evento `anatomia` com estruturas, região, camada e malha (já feito).
- RF-10 Interface: corpo 3D com pontos nas regiões, linha-guia até o cartão do achado, camadas ligáveis, isolar estrutura.
- RF-11 Cartão do achado: queixa + CIAP-2, estruturas da região, a pergunta que diferencia, sinais de atenção.
- RF-12 Cartões de sistema (coração, pulmões, rins…) com estado: sem queixa, em investigação, alerta.

**Registro e saída**
- RF-13 Tudo que vem da pessoa: `origem: paciente`; do BMX: `origem: bmx` + `confianca: hipotese`; de laudo ou médico: `origem: profissional`.
- RF-14 "Ficha para consulta" do caso (markdown e PDF): queixa, linha do tempo, dor, registros, remédios, alergias, perguntas para o médico. Sem as hipóteses do BMX, a não ser que a pessoa peça.
- RF-15 Seguimento: ao iniciar conversa com caso aberto há mais de 48 h, o BMX pergunta pela evolução.

**Pacientes, acessos e conhecimento**
- RF-16 Trocar de paciente encerra a sessão e isola grafo, contexto, casos e estado (já feito para grafo/contexto/estado).
- RF-17 Trilha de acessos sem conteúdo clínico, nunca no contexto (já feito).
- RF-18 Grafo da tela só com paciente, casos e operações (já feito); conhecimento fica fora da tela.
- RF-19 Fontes (livros, diretrizes): entrada em `40-Conhecimento/Fontes/`, cada uma com ficha (autor, edição, licença, confiabilidade); só entram no contexto depois de aprovadas.

## 7. Regras de negócio
- RN-01 Alerta de `safety.py` sempre antes do modelo, sempre visível, mesmo se o modelo falhar.
- RN-02 O BMX nunca grava diagnóstico; grava hipóteses com origem e confiança.
- RN-03 Um caso nunca mistura pacientes; atendimento sem caso só é permitido para conversa geral (sem queixa).
- RN-04 Nível do caso só sobe automaticamente; descer exige desfecho ou registro profissional.
- RN-05 Nada é apagado pelo sistema; apagar é ação manual documentada.
- RN-06 Fonte nova não entra no contexto sem ficha e aprovação.

## 8. Requisitos não funcionais
- RNF-01 Local-first: tudo em arquivo no cofre; servidor só em 127.0.0.1.
- RNF-02 Privacidade: dado de saúde é dado pessoal sensível (LGPD art. 5º, II e art. 11). Sem envio a terceiros além do modelo; sincronização em nuvem é escolha consciente do usuário.
- RNF-03 Auditoria: todo acesso de leitura/escrita fica em `30-Acessos`.
- RNF-04 Memória da máquina (7 GB): carregar malhas 3D só da região investigada; nada de carregar o corpo inteiro em alta resolução.
- RNF-05 Latência: alerta e destaque anatômico em menos de 300 ms (antes do modelo); resposta falada começa em até 5 s.
- RNF-06 Voz: toda saída do modelo continua curta e falável; a interface carrega o detalhe visual.
- RNF-07 Acessibilidade: contraste AA, alvo de toque ≥ 44 px, tudo navegável por teclado, cor nunca é o único sinal de nível.

## 9. Dados (o que muda no cofre)
```
10-Pacientes/<ID>/
  Perfil de saúde.md
  Casos/C-20261022-1 — Dor no joelho.md   ← novo
  Registros/   Analises/
20-Operacoes/Atendimentos/…  (frontmatter ganha `caso:`)
```
Frontmatter do caso:
```yaml
type: caso
paciente: P0001
caso: C-20261022-1
queixa: Dor no joelho
ciap2: L15
regiao: coxa-joelho
inicio: 2026-10-22
status: aberto            # aberto | acompanhamento | encaminhado | resolvido
nivel: consulta           # maior nível visto
dor_max: 6
updated: 2026-10-22
```
Corpo: resumo, discriminadores (tabela sim/não/não perguntado), linha do tempo, hipóteses (link para a análise), plano, desfecho.

## 10. Interface — "Painel do caso"
Referências: Health Report (FocoTik, Dribbble), Ehr. eye-lens diagnosis e o painel de órgãos 3D enviado. Linguagem comum: fundo claro com gradiente suave, cartões brancos de vidro com cantos grandes, um objeto anatômico 3D no centro como protagonista, pontos e linhas-guia apontando o problema, estados com bolinha colorida.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ BMX · Paciente P0001 ▾      [Caso atual] [Linha do tempo] [Prontuário]  ◉ │
├──────────────┬──────────────────────────────────────┬─────────────────────┤
│ DOR  ◠ 6/10  │                                      │ L15 · Dor no joelho │
│ gauge        │           corpo 3D (músculos)        │ Coxa e joelho       │
├──────────────┤                ●──────────────────── │ ▢ fêmur ▢ menisco   │
│ NÍVEL        │                                      │ ▢ LCA   ▢ patela    │
│ (CONSULTA)   │      pontos vermelhos = regiões      │ Próxima pergunta:   │
├──────────────┤      do relato; linha-guia até o     │ "dói mais subindo   │
│ ALERTAS      │      cartão do achado à direita      │  ou descendo?"      │
│ ✓ incha?  não│                                      │ Atenção: inchado +  │
│ ? febre      │   [pele][músculo][órgão][osso][vaso] │ febre → urgente     │
├──────────────┼──────────────────────────────────────┴─────────────────────┤
│ FICHA FIXA   │ [Coração • sem queixa] [Pulmões • sem queixa] [Joelho • em  │
│ alergia:     │  investigação]                                              │
│ dipirona     ├────────────────────────────┬────────────────────────────────┤
│              │ LINHA DO TEMPO (visitas)   │ PLANO (care plan)              │
│              │ 22/10 · 25/10 · 29/10      │ gelo 20 min · retorno se…      │
└──────────────┴────────────────────────────┴────────────────────────────────┘
          Baymax + microfone (canto)      [Ficha para consulta ⇩]
```
- Centro: corpo 3D (Human Atlas / BodyParts3D) em músculos por padrão; ponto vermelho pulsando na região; linha-guia curva até o cartão do achado, como no cartão "M75.3" da referência.
- Esquerda: medidas em cartões pequenos — dor como gauge semicircular, nível como pílula colorida (texto + cor), checklist de sinais de alerta, ficha fixa em chips.
- Base: cartões de sistema com estado (como "Heart • Normal"), linha do tempo como "Your Visits", plano como "Care Plan".
- Interações: clicar ponto ou estrutura → isola e mostra nome; chips de camada; "explodir" para ver as peças; botão "Ficha para consulta".
- O grafo da memória vira uma aba secundária (só caso, paciente e operações).

## 11. Riscos e conformidade
- **Regulação (Anvisa):** software que apoia decisão diagnóstica ou terapêutica pode ser dispositivo médico (SaMD — RDC 657/2022 e regras de classe da RDC 751/2022). Uso pessoal e educativo, sem distribuição, fica fora da operação comercial; **antes de oferecer a terceiros, fazer enquadramento sanitário**.
- **Manchester:** não copiar fluxogramas nem discriminadores oficiais (licenciados). Usar conteúdo próprio, com fontes públicas.
- **LGPD:** dado sensível; consentimento explícito se houver outro usuário; direito de exclusão = apagar pasta + atendimentos.
- **Clínico:** falso negativo em alerta é o risco principal → regras fixas conservadoras, revisão das tabelas, teste com casos-vinheta (seção 13).
- **Licenças 3D:** BodyParts3D / Human Atlas CC BY 4.0 (atribuição na tela de créditos); Z-Anatomy CC BY-SA (evitar no pacote).

## 12. Métricas
- 100% dos relatos com sinal de alerta mostram a faixa (testes de vinheta).
- ≥ 80% das conversas com queixa ficam ligadas a um caso.
- Ficha para consulta gerada em < 3 s.
- Nenhuma nota de outro paciente no contexto (teste automático).

## 13. Critérios de aceite (por fase)
- **F1 Caso:** abrir, retomar, listar e encerrar caso; atendimento e análise ligados; linha do tempo correta; 20 vinhetas (10 com alerta) passam.
- **F2 Painel:** corpo 3D carrega só a região; ponto + linha-guia + cartão do achado; camadas; cartões de sistema; funciona em 1366×768 sem travar.
- **F3 Seguimento e ficha:** pergunta de evolução após 48 h; ficha para consulta em markdown/PDF.
- **F4 Fontes:** ficha de fonte, aprovação, busca por trecho com citação.

## 14. Fases
| Fase | Entrega | Depende de |
|---|---|---|
| F0 (feito) | zonas do cofre, acessos, análises, catálogo anatômico, queixas de entrada, grafo do caso | — |
| F1 | entidade Caso + comandos + discriminadores | aprovação deste PRD |
| F2 | Painel do caso com corpo 3D (malhas extraídas do Human Atlas) | F1, extração das bibliotecas |
| F3 | seguimento + ficha para consulta | F1 |
| F4 | fontes (livros e materiais indicados) | lista de livros |

## 15. Questões em aberto
1. Retomar caso automaticamente ou sempre perguntar?
2. A ficha para consulta deve incluir as hipóteses do BMX?
3. Pacientes infantis: precisam de regras de alerta próprias (febre em bebê, desidratação) e de perguntas para o cuidador?
4. O corpo 3D padrão é masculino (BodyParts3D). Precisamos de referência feminina para regiões pélvicas?
