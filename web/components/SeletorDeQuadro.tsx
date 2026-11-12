"use client";
import { useFecharAoClicarForaDe } from "@/lib/useCliqueFora";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import PageTitle from "@/components/PageTitle";
import { ApiError, createBoard, type Quadro } from "@/lib/api";
import {
  nomeDeQuadroValido,
  opcaoSelecionada,
  opcoesDoSeletor,
  opcoesDoSeletorDaRaiz,
} from "@/lib/seletorDeQuadro";

/**
 * Seletor de quadro da tela do time: dropdown no título que escolhe entre a lente
 * (ou o Quadro geral, na raiz) e os quadros avulsos, e cria quadro novo. A regra
 * de listagem mora em `lib/seletorDeQuadro.ts`. A lente não é um quadro: não tem
 * registro no banco nem o que renomear.
 */
export default function SeletorDeQuadro({
  teamId,
  quadros,
  selecionado,
  podeGerir,
  podeApagar,
  onSelecionar,
  onMudou,
  daRaiz,
}: {
  teamId: string;
  quadros: readonly Quadro[];
  /** `null` = a lente. Ver `OpcaoDeQuadro.id`. */
  selecionado: string | null;
  podeGerir: boolean;
  /** Separada de `podeGerir`: o gestor renomeia e não apaga. */
  podeApagar: boolean;
  onSelecionar: (id: string | null) => void;
  /** Chamado depois de criar; quem guarda e recarrega a lista é o pai. */
  onMudou: (quadroNovo?: Quadro) => void;
  /** Tela da raiz: o Quadro geral entra pelo nome, sem lente. Obrigatória para o `tsc` apontar todo chamador. */
  daRaiz: boolean;
}) {
  const opcoes = daRaiz
    ? opcoesDoSeletorDaRaiz(quadros, teamId, podeGerir, podeApagar)
    : opcoesDoSeletor(quadros, teamId, podeGerir, podeApagar);
  const atual = opcaoSelecionada(opcoes, selecionado);

  const [aberto, setAberto] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);

  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);

  // Sem o pareamento mousedown/mouseup do `useFecharAoClicarFora`: dropdown não tem texto para selecionar.
  useFecharAoClicarForaDe(painelRef, aberto, () => setAberto(false));

  useEffect(() => {
    if (criando) campoRef.current?.focus();
  }, [criando]);

  function escolher(id: string | null) {
    setAberto(false);
    onSelecionar(id);
  }

  function abrirNovo() {
    // Fecha o dropdown: o campo nasce no lugar do painel.
    setAberto(false);
    setCriando(true);
    setNome("");
    setErro(null);
  }

  function fecharNovo() {
    setCriando(false);
    setNome("");
    setErro(null);
  }

  async function salvar() {
    // Mesma regra do backend (`BoardService._nome_valido`).
    const limpo = nomeDeQuadroValido(nome);
    if (limpo === null) {
      setErro("O nome não pode ficar vazio e tem no máximo 255 caracteres.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const quadro = await createBoard({ name: limpo, team_id: teamId });
      fecharNovo();
      onSelecionar(quadro.id);
      onMudou(quadro);
    } catch (e) {
      // A mensagem do backend distingue "sem permissão" de "nome duplicado".
      setErro((e as ApiError).message || "Não consegui salvar. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    // `div` por fora: só o gatilho fica dentro do `<h1>` (lista e formulário dentro dele seria HTML inválido).
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <div ref={painelRef} style={{ position: "relative", display: "inline-flex" }}>
        <PageTitle>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={aberto}
            // Sem `aria-label`: o nome do botão vira o nome do título; a instrução vai no `title`.
            title="Trocar de quadro"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "none", border: "none", padding: 0, cursor: "pointer",
              // Sem o atalho `font`: ele redefiniria o tamanho herdado do `<h1>`.
              fontSize: "inherit", fontWeight: "inherit", lineHeight: "inherit",
              letterSpacing: "-0.02em",
              color: "var(--text)",
            }}
          >
            {atual.nome}
            <ChevronDown size={20} aria-hidden style={{ opacity: 0.6, flexShrink: 0 }} />
          </button>
        </PageTitle>

        {aberto && (
          <div
            role="listbox"
            aria-label="Quadros deste time"
            style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
              minWidth: 240, background: "var(--surface)",
              border: "1px solid var(--border)", borderRadius: 12,
              boxShadow: "var(--shadow)", padding: 6,
              display: "flex", flexDirection: "column", gap: 2,
            }}
          >
            {opcoes.map((o) => {
              const ativa = o.id === atual.id;
              return (
                <button
                  key={o.id ?? "lente"}
                  type="button"
                  role="option"
                  aria-selected={ativa}
                  onClick={() => escolher(o.id)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start",
                    gap: 2, width: "100%", textAlign: "left",
                    background: ativa ? "var(--accent-soft)" : "none",
                    border: "none", borderRadius: 8, padding: "7px 10px",
                    cursor: "pointer", font: "inherit", fontSize: 13,
                    color: ativa ? "var(--accent)" : "var(--text)",
                    fontWeight: ativa ? 600 : 400,
                  }}
                >
                  {o.nome}
                  {/* Sem `--text-faint` na opção escolhida: some sobre o fundo; herda a cor com opacidade. */}
                  {o.descricao && (
                    <span
                      className={ativa ? undefined : "muted"}
                      style={{ fontSize: 11, opacity: ativa ? 0.85 : undefined }}
                    >
                      {o.descricao}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Fora da lista de opções: não é escolha, e `role="option"` anunciaria que é. */}
            {podeGerir && (
              <>
                <span
                  aria-hidden="true"
                  style={{ height: 1, background: "var(--border)", margin: "4px 6px" }}
                />
                <button
                  type="button"
                  onClick={abrirNovo}
                  style={{
                    width: "100%", textAlign: "left", background: "none",
                    border: "none", borderRadius: 8, padding: "7px 10px",
                    cursor: "pointer", font: "inherit", fontSize: 13,
                    color: "var(--accent)",
                  }}
                >
                  + Novo quadro
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {criando && (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={campoRef}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvar();
              if (e.key === "Escape") fecharNovo();
            }}
            placeholder="Nome do quadro"
            aria-label="Nome do novo quadro"
            style={{ minWidth: 220, fontSize: 13 }}
          />
          <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Criar"}
          </button>
          <button className="btn btn-ghost" onClick={fecharNovo} disabled={salvando}>
            Cancelar
          </button>
          {erro && (
            <span role="alert" className="error-text" style={{ fontSize: 12 }}>
              {erro}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
