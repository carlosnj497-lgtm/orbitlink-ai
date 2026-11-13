# Seeds

Nenhum seed é necessário em produção: o gatilho `handle_new_user` cria o workspace no cadastro.

Para desenvolvimento, os testes em `supabase/tests/rls.test.ts` geram dados **artificiais** (usuários `a@exemplo.test` e `b@exemplo.test`, terminal `ut-abc123`) apenas dentro do PGlite em memória. Nunca carregue dados artificiais no projeto real.
