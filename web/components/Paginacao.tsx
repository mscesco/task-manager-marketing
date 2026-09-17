"use client";
// components/Paginacao.tsx
// O rodape "Envios 1–10 de 42 · ← Anterior · 1 / 5 · Próxima →".
//
// ⚠️ NASCEU DE TRES COPIAS (Spec 053, fatia F): `solicitacoes/page.tsx` tinha
// uma funcao local, `arquivadas/page.tsx` tinha outra com texto diferente
// ("Pagina X de Y"), e a tela de notificacoes seria a terceira. Um primitivo so,
// e as telas dizem o que estao contando (`rotulo`).
//
// ⚠️ PRIMITIVO E CASCA (web/AGENTS.md §11): ele nao busca nada -- quem muda de
// pagina e o `onIr` de quem chama.

export default function Paginacao({
  pagina,
  total,
  porPagina,
  rotulo,
  onIr,
}: {
  pagina: number;
  total: number;
  porPagina: number;
  /** O que se conta, com maiuscula: "Envios", "Tarefas", "Notificações". */
  rotulo: string;
  onIr: (pagina: number) => void;
}) {
  if (total === 0) return null;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const primeiro = (pagina - 1) * porPagina + 1;
  const ultimo = Math.min(pagina * porPagina, total);

  return (
    <nav
      aria-label="Paginação"
      className="mt-5 flex flex-wrap items-center justify-between gap-3"
    >
      <span className="text-sm text-ink-faint">
        {rotulo} {primeiro}–{ultimo} de {total}
      </span>
      {paginas > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => onIr(pagina - 1)}
            disabled={pagina <= 1}
          >
            ← Anterior
          </button>
          <span className="text-sm text-ink-faint">
            {pagina} / {paginas}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => onIr(pagina + 1)}
            disabled={pagina >= paginas}
          >
            Próxima →
          </button>
        </div>
      )}
    </nav>
  );
}
