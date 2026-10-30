# Arquitetura, invariantes e testes de aceitação

## Entidades

`instructors (1) -> (N) students (1) -> (N) lessons`. `sessions` e `tokens` possuem FK para `instructors`. `rate_limits` armazena contadores efêmeros.

**Isolamento:** toda leitura/escrita de registros de alunos e aulas filtra `instructor_id` de sessão autenticada; o cliente não escolhe proprietário. Triggers verificam também vínculo da aula à matrícula do mesmo instrutor. CPF do instrutor possui unicidade global; CPF de aluno, opcional, unicidade apenas entre alunos ativos do mesmo instrutor.

**Agenda:** a criação de um aluno com aula inicial opcional executa ambos os INSERTs em um lote transacional D1, evitando cadastro parcial em caso de conflito. Cada aula tem `start_local` e `end_local` em meia-abertura [início,fim). A regra de sobreposição é `novo.inicio < antigo.fim AND novo.fim > antigo.inicio` e triggers SQLite impedem duas aulas simultâneas para o mesmo instrutor. Aulas não aparecem no calendário se o aluno está `finalizada`, `archived_at IS NOT NULL` ou `deleted_at IS NOT NULL`. A reativação de alunos com aulas antigas conflitantes também é bloqueada por trigger.

**Exclusão:** ação da interface altera `deleted_at`; a limpeza agendada remove definitivamente linhas da tabela `students` marcadas há mais de 70 dias, com `ON DELETE CASCADE` em `lessons`. Arquivamento não tem expiração. Ausências de obrigação legal precisam ser conferidas antes de purgar dados financeiros.

**Ordenação e paginação:** nomes são normalizados Unicode com NFD e remoção de marcas combinantes, minúsculas e espaços normalizados. Ordenação pelo `search_name`, com critérios `name`, `id` para desempate determinístico. Pesquisa e filtros são executados no servidor, paginação de 12 por resposta.

## Testes a executar em homologação

- Cadastro usando CPF válido e senha `123456`: recusado; CPF duplicado: recusado; CPF + e-mail novos: confirmação obrigatória.
- Link verificação usado duas vezes ou expirado: recusado. Recuperação exige CPF correto, duas senhas iguais e expiração do token.
- Entrar duas vezes com “manter conectado” ativado/desativado; verificar expiração no banco e flag cookie segura em HTTPS.
- Dois instrutores distintos: um não consegue ler, editar, recuperar ou apagar os alunos do outro, inclusive por ID manual.
- Criar aluno João/Joao, buscar sem acento; ordenar crescente/decrescente e trocar de página após filtro.
- Criar duas aulas 09:00–10:00 e 09:30–10:30 para alunos diferentes: segunda retorna 409. Aula às 10:00 é permitida. Editar primeira aula para se sobrepor deve falhar.
- Finalizar, excluir e arquivar alunos: suas aulas somem do calendário; reativação que gera conflito é recusada.
- Testar recuperação da lixeira, paginação com mais de 12 e limpeza 70 dias em ambiente de teste.
- Abrir PWA em Chrome, Safari iOS, Android e desktop; testar tema, teclado, foco e viewport reduzido.
- JPG, PNG e HEIC válidos; bloquear arquivo incorreto, foto maior que 3 MB, leitura de foto de outro instrutor.
- Validar que nenhum `/api/` é cacheado pelo service worker e nenhuma resposta autenticada é compartilhada.

## Decisões de UX

O botão de coluna `#` alterna simultaneamente o sentido da ordenação alfabética e exibe a posição relativa ao conjunto filtrado. O dashboard não registra tempo de trabalho genérico nem escala semanal de disponibilidade: o conceito de “horário de trabalho” aqui é uma aula agendada, sempre opcional ao cadastrar aluno. Para escalas de disponibilidade ou bloqueio de férias, adicionar módulo de indisponibilidades e novas regras SQL.
