# Agenda CNH

PWA independente para instrutores autônomos de direção. Interface em português, inspirada nas referências visuais fornecidas para o projeto, com código próprio e marca CNH do Brasil fornecida pelo solicitante. Não reutiliza o código nem dependências do Lovable presentes no projeto de referência [help-cnh-br](https://github.com/polvologico945/help-cnh-br).

> **Estado:** implementação-base funcional em código-fonte, ainda não publicada nem testada end-to-end num ambiente Cloudflare real. O cadastro e o e-mail NÃO funcionarão até que o operador configure Cloudflare D1/R2, Resend, Turnstile, segredos e domínio. Uma auditoria independente e revisão jurídica são necessárias antes de aceitar dados reais.

## Funcionalidades implementadas

- Cadastro de instrutor com nome/sobrenome, CPF brasileiro válido e único, e-mail verificado por **link enviado por Resend** e PIN numérico de 6 dígitos; as regras proíbem sequências, repetições, e seis dígitos consecutivos do CPF.
- Verificação anti-bot Turnstile no cadastro, reenvio do link pendente via API, e recuperação da senha com link de 30 minutos, CPF de confirmação, nova senha duas vezes e invalidação de sessões anteriores.
- Sessão em cookie HttpOnly + SameSite, 12 horas sem “manter conectado”, 30 dias se marcado; armazenamento de hash SHA-256 do token no banco, limitação de tentativas e bloqueio temporário de conta.
- Dashboard isolado por instrutor, modo claro/escuro com preferência local, duas áreas principais (Lista e Agenda) e perfil com telefone, nome, categorias A–E e foto JPG/PNG/HEIC (HEIC convertido no navegador).
- Tabela de alunos por ordem alfabética, filtro por status/categoria, busca acento-insensível, 12 registros por página, seleção individual/em lote, edição, arquivamento e exclusão reversível.
- Cadastro de aluno: nome, celular, CPF opcional criptografado, categoria, aulas contratadas/concluídas, valores total/pago e status.
- Calendário mensal com navegação, seleção de dia, agendamento opcional já no cadastro do aluno (transação atômica), edição/exclusão, 1 a 8 aulas consecutivas (60 min cada) e prevenção de intervalos sobrepostos dentro de uma agenda.
- Alunos finalizados, arquivados e excluídos não aparecem na agenda. Lixeira retém excluídos 70 dias, com rotina automática de purga.
- PWA instalável, cache **somente de conteúdo estático**. API, dados pessoais e respostas autenticadas jamais são armazenados no cache do service worker.
- Documentos informativos (Termos, Privacidade, Cookies e Desenvolvedores). **Minutas** a completar pelo operador antes da publicação.

## Arquitetura

| Camada | Tecnologias | Por quê |
|---|---|---|
| UI | React 19, TypeScript 5, Vite 6, Lucide, date-fns | Código tipado, interface responsiva, ferramentas maduras |
| API | Cloudflare Workers + WebCrypto | Backend serverless sem servidor sempre ligado |
| Persistência | Cloudflare D1 (SQLite SQL) | Integridade relacional, migração versionada, isolamento por proprietário |
| Fotos | Cloudflare R2 privado | Evita guardar arquivos no D1, acesso apenas via API autenticada |
| E-mails | Resend API | Link temporário de confirmação e recuperação |
| Anti-bot | Cloudflare Turnstile | Desafio validado obrigatoriamente no backend |
| PWA | Manifest, service worker | Instalação e shell estático resiliente |

**Dados privados:** o CPF do instrutor não é salvo em texto; índice único via HMAC-SHA256 com segredo do servidor. CPF opcional do aluno é criptografado em repouso por AES-GCM e indexado via HMAC. O PIN é derivado via PBKDF2-SHA256, salt exclusivo e 600 mil iterações. O PIN de 6 números possui baixa entropia: há lockout e limite de frequência, mas a autenticação forte por passkeys seria melhoria preferencial.

**Horários:** armazenados como horários civis `YYYY-MM-DDTHH:mm` em `America/Fortaleza` (UTC-3). O agendamento não é convertido para o fuso do navegador. Para ampliar o sistema a outros fusos, é necessária migração com timezone por instrutor e datas em UTC.

## Executar e publicar

Pré-requisitos: Node.js 22+, npm, conta Cloudflare, domínio para o envio de e-mails e conta Resend. Custos são dependentes de planos, cotas e uso dos fornecedores; **custo zero não é garantido**.

```bash
npm install
npm test
npm run check
npm run build
npx wrangler login
npx wrangler d1 create agenda-cnh-db
npx wrangler r2 bucket create agenda-cnh-photos
```

Substitua `SUBSTITUA_PELO_ID_DO_D1` em `wrangler.jsonc` pelo UUID retornado pelo comando de criação do D1. O bucket R2 precisa existir. Para desenvolvimento, copie os exemplos:

```bash
cp .dev.vars.example .dev.vars
cp .env.example .env.local
```

Configure **segredos independentes** e fortes, por exemplo gerados com `openssl rand -hex 32`, em `.dev.vars` e via `npx wrangler secret put NOME_DA_VARIAVEL` no ambiente publicado. NÃO envie segredos ao Git. Em `.env.local`, coloque a chave **pública** Turnstile (`VITE_TURNSTILE_SITE_KEY`). Configure `APP_URL` com a origem HTTPS do app publicado, Resend (`RESEND_API_KEY` e `EMAIL_FROM`) e a chave **privada** Turnstile (`TURNSTILE_SECRET`). No painel Turnstile, habilite o domínio real.

```bash
npm run db:local
npm run build
npm run worker:dev
```

Desenvolvimento full-stack com Workers em `http://localhost:8787`. `npm run dev` inicia Vite na porta padrão (proxy de `/api` para Workers em 8787). Em duas abas de terminal, execute `npm run worker:dev` e `npm run dev` para HMR.

Para produção:

```bash
npm run db:remote
npm run deploy
```

Atualize `APP_URL` no `wrangler.jsonc` antes do deploy (ou configure a variável de ambiente no projeto) com o domínio publicado, por exemplo `https://agenda-cnh.seudominio.com.br`. Não use `localhost` em produção. Configure DNS/HTTPS conforme Cloudflare. Faça os testes de aceitação descritos em `docs/architecture.md` antes de disponibilizar o sistema.

## Repositório independente no GitHub

O nome solicitado **`agenda cnh`** é representado como `agenda-cnh` no GitHub, pois nomes de repositório não usam espaços. O GitHub precisa ser criado/autorizado explicitamente pela conta que irá hospedar o projeto; nada foi alterado no repositório original.

Depois de extrair este ZIP na pasta do projeto, uma pessoa autenticada no GitHub pode executar:

```bash
git init -b main
git add .
git commit -m "feat: primeira versão Agenda CNH PWA"
gh auth login
gh repo create polvologico945/agenda-cnh --private --source=. --remote=origin --push
```

Se o repositório já existir, configure `git remote add origin https://github.com/polvologico945/agenda-cnh.git` e `git push -u origin main`. **Iniciar privado** é recomendável enquanto dados pessoais e controles estão sendo auditados.

## Estrutura de arquivos

```
src/App.tsx              interface e fluxos principais
src/api.ts               contratos tipados, cliente HTTP e utilitários
src/styles.css           sistema visual responsivo, claro/escuro
worker/index.ts          API, autenticação, autorização, limpeza agendada
worker/crypto.ts         tokens, hashes, HMAC, PBKDF2, AES-GCM
worker/rules.ts          validação de CPF, PIN, aluno, horário
migrations/0001_init.sql esquema D1, índices, chaves e triggers
public/                  assets, logo fornecida, ícones, PWA, cabeçalhos
src/main.tsx             bootstrap do React e service worker
docs/                    análise de riscos e decisões técnicas
tests/                   testes automatizados de regras
```

## Pendências para produção

1. **Validação end-to-end** em Cloudflare real: não realizada neste ambiente porque o registro de dependências npm não estava acessível; verificações locais de regras e integridade SQL foram executadas.
2. Configurar recursos externos e segredos; verificar envio de e-mails com domínio confirmado e testes de abuso.
3. Preencher informação real do controlador e política de dados com revisão jurídica LGPD; fazer avaliação de segurança, backup/restauração, logs sem PII e monitoramento.
4. Fluxo de exportação/portabilidade e canal de atendimento a solicitações de titulares; avaliação operacional de exclusão e retenção legal.
5. Revisão de experiência com usuários reais e testes de acessibilidade, navegadores e iPhone.

**Direção e concepção do projeto:** Carla Evelyn. O sistema não se apresenta como aplicativo governamental do DETRAN ou da Senatran.
