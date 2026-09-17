import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Página não encontrada — Gestor de Tarefas",
};

/**
 * O 404 do app. Sem este arquivo o Next desenhava o dele, em inglês e fora do
 * tema -- e é onde cai quem guardou um endereço que saiu, como `/membros`
 * (Spec 047).
 *
 * ⚠️ FICA FORA DO `AppShell` de propósito: o shell exige sessão, e o 404 tem
 * de responder também a quem não entrou. Por isso o link vai para `/`, que já
 * decide entre o quadro e o login.
 */
export default function NotFound() {
  return (
    <main className="center-screen">
      <div className="max-w-[420px] text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Erro 404
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.02em]">
          Página não encontrada
        </h1>
        <p className="mt-2 text-md text-ink-faint">
          O endereço pode ter mudado ou saído do sistema.
        </p>
        <Link href="/" className="btn btn-primary mt-6">
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
