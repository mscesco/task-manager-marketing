// app/loading.tsx
// O que o Next mostra enquanto uma rota carrega -- vale para TODAS, por estar
// na raiz do `app/`.
//
// ⚠️ ATE 08/10 NAO EXISTIA, e ela viu o efeito: o "N" do Next girando no
// canto e a tela parada, sem dizer que algo vinha. Em desenvolvimento a
// espera e a COMPILACAO da pagina (segundos na primeira visita); em producao
// e o carregamento do codigo da rota. Nos dois casos, a resposta e a mesma
// tela de carregamento do resto do produto.
//
// ⚠️ TELA INTEIRA, sem a barra lateral: a barra mora dentro de cada pagina
// (`AppShell`), e nao num layout comum -- enquanto a pagina nao chega, nao ha
// barra para manter.

import { LoadingScreen } from "@/components/Loading";

export default function Carregando() {
  return <LoadingScreen rotulo="Carregando a página" />;
}
