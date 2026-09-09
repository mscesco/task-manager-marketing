"use client";
// app/membros/page.tsx
// As pessoas da ORGANIZAÇÃO — Spec 047, fatia E; unificada em 09/09.
//
// ⚠️⚠️ É LITERALMENTE A MESMA TELA DE `/times/[id]`, e a decisão é da Camila,
// olhando as duas lado a lado: *"elas não são a mesma tela. eu quero que seja
// literalmente a mesma tela, com o toggle de subtimes e tudo"*.
//
// A única diferença é o RECORTE: `teamId = null` significa a organização
// inteira, e aí o nível de baixo são as ÁREAS em vez dos subtimes. O resto --
// alternador, abas de estado, busca, tabela, gavetas -- é o mesmo componente.
//
// ⚠️ AQUI MORAVAM ~250 LINHAS de estrutura própria (cabeçalho, busca, abas,
// formulário de cadastro), e era exatamente o que a §5 previu: *"duas telas
// listando pessoas, com regras diferentes, é o começo do próximo defeito de
// contador"*. Elas já dividiam a TABELA; o que divergia era tudo em volta.
//
// ⚠️ A rota continua `/membros` porque é a entrada de menu que as pessoas já
// conhecem. O que ela renderiza é que deixou de ser uma segunda tela.

import AppShell from "@/components/AppShell";
import TeamScreen from "@/components/TeamScreen";

export default function MembrosPage() {
  return (
    <AppShell>
      {/* `null` = a organização inteira. Ver o bloco no topo. */}
      <TeamScreen teamId={null} />
    </AppShell>
  );
}
