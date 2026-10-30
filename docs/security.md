# Modelo de ameaças e privacidade

- **CPF:** hash simples não impede consulta por dicionário de apenas 11 dígitos. Usar HMAC-SHA256 com segredo separado do banco para índice determinístico. CPF do aluno também usa AES-GCM para recuperação autorizada (não expor em logs).
- **Senha de seis dígitos:** apenas 1 milhão de combinações antes de retirar padrões. Usar PBKDF2-SHA256 com salt por conta, 600 mil iterações, bloqueio depois de cinco falhas, limitação por IP/rota e hash de token da sessão. Para produção, considere segundo fator ou passkeys e testes controlados de latência/abuso. Não guardar senha no navegador.
- **Link de confirmação e redefinição:** 256 bits aleatórios, armazenados somente pelo digest, única utilização, validade de 24 h e 30 min respectivamente. Redefinição revoga sessões anteriores.
- **CSRF:** mutações verificam origem; cookie usa SameSite=Lax, HttpOnly e Secure em HTTPS. Não habilitar CORS amplo. Revisar políticas CSP antes do lançamento; qualquer script de terceiro, como Turnstile, deve ser explicitamente aprovado.
- **Múltiplos instrutores:** isolamento de consultas no Worker, chaves estrangeiras e triggers; testes de acesso horizontal obrigatórios. Não confiar em ID enviado pelo cliente como comprovação de permissão.
- **Concorrência:** triggers na base asseguram não sobreposição mesmo que dois requests façam leitura de disponibilidade simultânea.
- **R2:** bucket privado, nomes não previsíveis, rota de foto exige sessão. Inspecionar assinatura real JPEG/PNG e converter HEIC localmente, estabelecer limite de 3 MB. Para produção, incluir recompressão/remoção de metadados EXIF pelo backend.
- **LGPD:** coletar dados mínimos, limitar propósito e retenção, permitir correção, indicar controlador e canal de privacidade, avaliar bases legais e fornecedor no exterior, implementar processo de exportação/eliminação de dados e backups com retenção definida.
- **Auditoria:** ainda é preciso observabilidade sem PII, notificações de falhas, monitoramento de contas, procedimento de incidentes e testes de segurança independentes.
