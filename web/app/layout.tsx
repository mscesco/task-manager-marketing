import localFont from "next/font/local";

import ClientErrorSensor from "@/components/ClientErrorSensor";
import "./globals.css";
import type { Metadata } from "next";

/**
 * Raleway, familia unica (Spec 039, F0). Escolhida pela Camila em 19/08/2026
 * comparando as pecas reais do produto nos tamanhos desta spec.
 *
 * ⚠️ `local` E NAO `next/font/google`, e o motivo e o DEPLOY. As duas portas
 * hospedam a fonte no proprio dominio, mas a do Google BAIXA durante o
 * `next build` -- e o build roda na VPS, dentro do roteiro de deploy. Isso
 * poria uma dependencia de rede externa dentro do deploy, um modo de falha
 * novo num roteiro que hoje nao tem nenhum.
 *
 * ⚠️ VARIABLE FONT, um arquivo para os 9 pesos (`weight: "100 900"`). A
 * hierarquia desta spec e feita por PESO, porque nao ha segunda familia -- ver
 * a tabela em `web/specs/039-redesenho-de-layout/spec.md` §5.2.
 *
 * ⚠️ SEM ITALICO de proposito: existe (`Raleway-Italic-VariableFont`), mas
 * dobraria o carregamento e o produto quase nao usa. Entra se faltar.
 *
 * ⚠️ `display: "swap"` + as metricas de fallback que o `next/font` gera
 * sozinho sao o que evita CLS: o texto aparece na hora com a fonte de sistema
 * e troca sem empurrar o layout.
 */
const raleway = localFont({
  src: "./fonts/Raleway-Variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--fonte-raleway",
  // A pilha que segura o texto ate a fonte chegar, e para sempre se ela falhar.
  fallback: [
    "ui-sans-serif",
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "sans-serif",
  ],
});

export const metadata: Metadata = {
  title: "Gestor de Tarefas — UniFECAF",
  description: "Gestor de demandas do time de marketing",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning`: o script abaixo poe `data-theme` no <html>
    // antes de o React hidratar, e o React avisava da diferenca a cada pagina.
    // Vale so para os atributos DESTA tag, nao para os filhos.
    <html lang="pt-BR" className={raleway.variable} suppressHydrationWarning>
      <head>
        {/*
          Aplica o tema ANTES da primeira pintura. Sem isto a pagina nasce
          clara e vira escura quando o React monta -- e como a navegacao do
          app e por <a href> (recarga total), esse flash branco apareceria a
          CADA troca de pagina, nao so uma vez.

          E o unico dangerouslySetInnerHTML do projeto. O conteudo e string
          literal fixa, escrita aqui: nao entra dado de usuario, de API nem
          de URL, entao nao ha superficie de injecao. Precisa ser inline e
          sincrono -- um <script src> ou um useEffect rodariam tarde demais.

          A chave e os valores tem que bater com lib/tema.ts ("tm_theme",
          "claro"/"escuro"/"sistema"). try/catch porque localStorage lanca em
          modo privado com cookies bloqueados, e tema nao vale quebrar a pagina.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var p=localStorage.getItem("tm_theme")||"sistema";' +
              'var e=p==="escuro"||(p==="sistema"&&window.matchMedia&&' +
              'window.matchMedia("(prefers-color-scheme: dark)").matches);' +
              'document.documentElement.setAttribute("data-theme",e?"escuro":"claro");' +
              "}catch(_){}})();",
          }}
        />
      </head>
      <body>
        <ClientErrorSensor />
        {children}
      </body>
    </html>
  );
}
