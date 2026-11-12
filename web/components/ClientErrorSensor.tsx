"use client";
import { useEffect } from "react";

// Sensor global de erros de front, montado no layout raiz (cobre também
// /login). Reporta window.onerror e unhandledrejection ao backend, que loga
// com o token `app_error`.
//
// Regras:
//   - fetch cru, sem o wrapper do api.ts: o retry de 401 dele poderia entrar
//     em loop se o erro for de auth.
//   - URL relativa: mesma origem em dev e prod; absoluta traria CORS.
//   - engole tudo: o report falhar não pode derrubar a página.
//   - teto: dedupe por assinatura + limite por carregamento de página.

const MAX_REPORTS = 20; // por carregamento de pagina
const DEDUPE_MS = 5000;

export default function ClientErrorSensor() {
  useEffect(() => {
    let sent = 0;
    const seen = new Map<string, number>();

    function report(data: {
      kind: string;
      message: string;
      source?: string;
      line?: number;
      col?: number;
      stack?: string;
    }) {
      if (sent >= MAX_REPORTS) return;

      const key = `${data.kind}|${data.message}|${data.line ?? ""}`;
      const now = Date.now();
      const last = seen.get(key);
      if (last && now - last < DEDUPE_MS) return;
      seen.set(key, now);
      sent += 1;

      const body = JSON.stringify({
        kind: data.kind,
        message: (data.message || "").slice(0, 500),
        source: data.source?.slice(0, 300),
        line: data.line,
        col: data.col,
        stack: data.stack?.slice(0, 2000),
        path:
          typeof window !== "undefined" ? window.location.pathname : undefined,
      });

      try {
        fetch("/api/v1/client-errors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* sensor nunca derruba a pagina */
      }
    }

    function onError(e: ErrorEvent) {
      // Erros de recurso (img/script 404) chegam aqui sem `error` e com
      // target sendo um elemento -- nao interessam, ignora.
      if (!e.error && !e.message) return;
      report({
        kind: "error",
        message: e.message || String(e.error),
        source: e.filename,
        line: e.lineno,
        col: e.colno,
        stack: e.error?.stack,
      });
    }

    function onRejection(e: PromiseRejectionEvent) {
      const reason = e.reason;
      report({
        kind: "unhandledrejection",
        message:
          reason instanceof Error
            ? reason.message
            : typeof reason === "string"
            ? reason
            : JSON.stringify(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
