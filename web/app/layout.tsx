import ClientErrorSensor from "@/components/ClientErrorSensor";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gestor de Tarefas — UniFECAF",
  description: "Gestor de demandas do time de marketing",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
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
