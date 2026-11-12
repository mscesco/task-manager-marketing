import localFont from "next/font/local";

import ClientErrorSensor from "@/components/ClientErrorSensor";
import "./globals.css";
import type { Metadata } from "next";

import { APP_NAME } from "@/lib/documentTitle";

/**
 * Raleway, variable font (um arquivo para os 9 pesos), sem itálico.
 * `local` e não `next/font/google`: a do Google baixa durante o `next build`,
 * que roda na VPS, e poria uma dependência de rede externa no deploy.
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
  // Cada rota declara só o próprio nome no `layout.tsx` dela; o modelo acrescenta
  // o produto. O mesmo modelo está em `lib/documentTitle.ts`: têm de coincidir.
  title: {
    template: `%s · ${APP_NAME}`,
    default: APP_NAME,
  },
  description: "Tarefas, projetos e solicitações dos times",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning`: o script abaixo põe `data-theme` no <html> antes
    // de o React hidratar. Vale só para os atributos desta tag.
    <html lang="pt-BR" className={raleway.variable} suppressHydrationWarning>
      <head>
        {/*
          Aplica o tema antes da primeira pintura; sem isto cada navegação (recarga
          total) piscaria em claro. Precisa ser inline e síncrono. A chave e os
          valores têm de bater com lib/tema.ts; try/catch porque localStorage lança
          em modo privado.
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
