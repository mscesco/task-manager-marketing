import Link from "next/link";
import type { Metadata } from "next";

// Só o nome da tela: o modelo do `app/layout.tsx` acrescenta o produto.
export const metadata: Metadata = { title: "Página não encontrada" };

/**
 * O 404 do app. Fora do `AppShell` de propósito: o shell exige sessão, e o 404
 * responde também a quem não entrou; por isso o link vai para `/`.
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
