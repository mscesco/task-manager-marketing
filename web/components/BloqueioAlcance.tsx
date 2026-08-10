"use client";
import type { BloqueioDeAlcance } from "@/lib/erroAlcance";
import { tituloDoBloqueio } from "@/lib/erroAlcance";

/**
 * O aviso do 422 da E8 (Spec 037): titulo, contagem e a LISTA das tarefas que
 * barraram, cada uma como link para a rota canonica `/tarefa/<id>`.
 *
 * ⚠️ ABRE EM ABA NOVA, de proposito. Quem esta aqui esta no meio de mover /
 * remover / rebaixar alguem, com o painel de vinculos aberto. Navegar na
 * mesma aba desmonta a tela e perde o contexto -- a pessoa reatribui uma
 * tarefa e volta para o comeco, N vezes. Aba nova deixa esta tela viva para a
 * segunda tentativa.
 *
 * ⚠️ ESTE COMPONENTE NAO DECIDE NADA. Ele nao le status, nao le `details`,
 * nao sabe o que e um 422 -- recebe o bloqueio ja pronto de
 * `lib/erroAlcance.ts`. A fronteira e a do `vitest.config.ts`: lib decide,
 * componente desenha.
 *
 * ⚠️ ELE NAO REATRIBUI. Reatribuir continua sendo um por um, pela tela da
 * tarefa. Com 32 tarefas numa pessoa so (medido em 10/08/2026) isso e longo,
 * e a saida curta e a reatribuicao em LOTE, que esta fora do escopo da Spec
 * 037 por decisao. Este componente e o que impede o 422 de ser um beco sem
 * saida -- nao e o que torna a saida curta.
 */
export default function BloqueioAlcance({ bloqueio }: { bloqueio: BloqueioDeAlcance }) {
  const n = bloqueio.tarefas.length;

  return (
    <div className="error-box" role="alert" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 600 }}>{tituloDoBloqueio(bloqueio.acao)}</div>

      <div>{bloqueio.mensagem}</div>

      <div style={{ fontSize: 12.5 }}>
        {n === 1
          ? "1 tarefa precisa de outro responsável antes:"
          : `${n} tarefas precisam de outro responsável antes:`}
      </div>

      <ul style={{ display: "flex", flexDirection: "column", gap: 6, margin: 0, paddingLeft: 18 }}>
        {bloqueio.tarefas.map((t) => (
          <li key={t.id}>
            <a
              href={`/tarefa/${t.id}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit", textDecoration: "underline" }}
            >
              {t.titulo}
            </a>
            {/* subtime e coluna sao contexto: dizem ONDE a tarefa esta sem
                exigir abrir cada uma. Quando faltam (tarefa avulsa), a linha
                simplesmente nao mostra o rotulo -- em vez de um "—" que o
                olho le como dado. */}
            {(t.subtime || t.coluna) && (
              <span style={{ fontSize: 12, opacity: 0.85 }}>
                {" · "}
                {[t.subtime, t.coluna].filter(Boolean).join(" · ")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
