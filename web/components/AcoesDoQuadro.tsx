"use client";
import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  deleteBoard,
  getBoard,
  renameBoard,
  type Quadro,
} from "@/lib/api";
import ConfirmarExclusaoDeQuadro from "@/components/ConfirmarExclusaoDeQuadro";
import {
  nomeDeQuadroValido,
  opcaoSelecionada,
  opcoesDoSeletor,
  opcoesDoSeletorDaRaiz,
} from "@/lib/seletorDeQuadro";

/**
 * Renomear e apagar o quadro, na barra do modo de edição. Quem pode o quê vem
 * de `lib/seletorDeQuadro.ts`; o backend é quem garante.
 */
export default function AcoesDoQuadro({
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
  onMudou: () => void;
  /**
   * Tela do time raiz: não há lente, o Quadro geral entra pelo nome. Ver
   * `opcoesDoSeletorDaRaiz`.
   */
  daRaiz: boolean;
}) {
  const opcoes = daRaiz
    ? opcoesDoSeletorDaRaiz(quadros, teamId, podeGerir, podeApagar)
    : opcoesDoSeletor(quadros, teamId, podeGerir, podeApagar);
  const atual = opcaoSelecionada(opcoes, selecionado);

  // ---- renomear ----
  const [renomeando, setRenomeando] = useState(false);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);

  // ---- apagar ----
  // Estado separado do de renomear: renomear salva no Enter, apagar exige
  // digitar o nome e não aceita Enter.
  const [apagando, setApagando] = useState(false);
  const [contagem, setContagem] = useState<number | null>(null);
  const [erroApagar, setErroApagar] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  // Não usa `erro`: ele só aparece dentro do campo de renomear, fechado aqui.
  const [divergencia, setDivergencia] = useState<string | null>(null);

  useEffect(() => {
    if (renomeando) campoRef.current?.focus();
  }, [renomeando]);

  function abrirRenomear() {
    if (atual.id === null) return; // a lente nao se renomeia
    setRenomeando(true);
    setNome(atual.nome);
    setErro(null);
  }

  function fecharRenomear() {
    setRenomeando(false);
    setNome("");
    setErro(null);
  }

  async function salvar() {
    if (atual.id === null) return;
    // Mesma regra do backend (`BoardService._nome_valido`), para não gastar um 422.
    const limpo = nomeDeQuadroValido(nome);
    if (limpo === null) {
      setErro("O nome não pode ficar vazio e tem no máximo 255 caracteres.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await renameBoard(atual.id, limpo);
      fecharRenomear();
      onMudou();
    } catch (e) {
      // A mensagem do backend distingue "sem permissão" de "nome duplicado".
      setErro((e as ApiError).message || "Não consegui salvar. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  async function abrirApagar() {
    if (atual.id === null) return;
    setApagando(true);
    setContagem(null);
    setErroApagar(null);
    setDivergencia(null);
    try {
      // `GET /boards` não traz a contagem; até ela chegar, confirmar fica travado.
      const detalhe = await getBoard(atual.id);
      setContagem(detalhe.task_count);
    } catch (e) {
      setErroApagar(
        (e as ApiError).message ||
          "Não consegui contar as tarefas deste quadro."
      );
    }
  }

  async function confirmarExclusao() {
    if (atual.id === null) return;
    setExcluindo(true);
    setErroApagar(null);
    try {
      const { tarefas_apagadas } = await deleteBoard(atual.id);
      const anterior = contagem;
      setApagando(false);
      setContagem(null);
      // Sai do quadro apagado antes de recarregar, senão a tela pede um
      // `boardId` que não existe mais. Isso costuma desmontar este componente.
      onSelecionar(null);
      onMudou();
      // Alguém pode ter criado tarefa entre abrir e confirmar.
      if (anterior !== null && anterior !== tarefas_apagadas) {
        setDivergencia(
          `O aviso falava em ${anterior}, mas ${tarefas_apagadas} ` +
            `${tarefas_apagadas === 1 ? "tarefa foi apagada" : "tarefas foram apagadas"}. ` +
            `Alguém mexeu no quadro enquanto você confirmava.`
        );
      }
    } catch (e) {
      setErroApagar(
        (e as ApiError).message || "Não consegui apagar. Tente de novo."
      );
    } finally {
      setExcluindo(false);
    }
  }

  // A lente não tem registro no banco: nada a renomear nem apagar.
  if (!atual.podeRenomear && !atual.podeApagar) return null;

  if (renomeando) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input
          ref={campoRef}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") fecharRenomear();
          }}
          placeholder="Nome do quadro"
          aria-label="Novo nome do quadro"
          style={{ minWidth: 200, fontSize: 13 }}
        />
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        <button className="btn btn-ghost" onClick={fecharRenomear} disabled={salvando}>
          Cancelar
        </button>
        {erro && (
          <span role="alert" className="error-text" style={{ fontSize: 12 }}>
            {erro}
          </span>
        )}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {/* Os gatilhos somem com o diálogo aberto: o botão de confirmar também se
          chama "Apagar quadro", e o leitor de tela ouviria dois iguais. */}
      {!apagando && atual.podeRenomear && (
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
          onClick={abrirRenomear}
          aria-label={`Renomear ${atual.nome}`}
        >
          Renomear quadro
        </button>
      )}
      {!apagando && atual.podeApagar && (
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, color: "var(--danger)" }}
          onClick={abrirApagar}
          aria-label={`Apagar ${atual.nome}`}
        >
          Apagar quadro
        </button>
      )}

      {divergencia && (
        <span role="alert" className="error-text" style={{ fontSize: 12 }}>
          {divergencia}
        </span>
      )}

      {apagando && (
        <ConfirmarExclusaoDeQuadro
          nome={atual.nome}
          contagem={contagem}
          erro={erroApagar}
          ocupado={excluindo}
          onConfirmar={confirmarExclusao}
          onCancelar={() => {
            setApagando(false);
            setContagem(null);
            setErroApagar(null);
          }}
        />
      )}
    </span>
  );
}
