"use client";
// components/TituloEditavel.tsx
// O título da tarefa, editável no lugar (Spec 052, fatia D).
//
// O gesto é o do Trello, pedido por ela em 16/09: clica no título, ele vira
// campo; **Enter salva, clicar fora salva, Esc desiste**.
//
// ⚠️ `textarea`, E NÃO `input`: título longo quebra em várias linhas no
// painel, e um `input` o mostraria cortado justo na hora de editar. O Enter não
// quebra linha -- ele confirma (`lib/edicaoNoLugar.ts` troca `\n` colado por
// espaço).
//
// ⚠️ A REGRA (o que salvar, vazio volta ao original) mora em
// `lib/edicaoNoLugar.ts`. Aqui só desenha e chama `onSalvar`.
//
// ⚠️ O NÍVEL DO TÍTULO VEM DE FORA (revisão de títulos, 21/09). No painel e no
// modal a tarefa mora embaixo do `<h1>` da tela, e o certo é `h2`. Na rota
// `/tarefa/[id]` -- o link compartilhado -- ela É a página, e sem `h1` a página
// ficava sem título principal nenhum.
//
// ⚠️ E O NOME DO TÍTULO É O TEXTO DA TAREFA. O botão tinha
// `aria-label="Editar o título: X"`, e como ele mora dentro do `<h2>`, o leitor
// de tela anunciava a INSTRUÇÃO como se fosse o título -- quem navega pelos
// títulos ouvia "Editar o título: Banner" em vez de "Banner". A instrução virou
// descrição (`title`), que é anunciada depois do nome, e não no lugar dele.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { decidirTitulo, TITULO_MAXIMO_TAREFA } from "@/lib/edicaoNoLugar";

const ESTILO_DO_TITULO = {
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  lineHeight: 1.27,
} as const;

export default function TituloEditavel({
  valor,
  onSalvar,
  level = "h2",
}: {
  valor: string;
  /** `h1` quando a tarefa é a página inteira; `h2` no painel e no modal. */
  level?: "h1" | "h2";
  /**
   * Grava o título novo. ⚠️ Em erro, LANÇA com a mensagem já pronta para a
   * tela: o campo reabre com o que a pessoa digitou e a mensagem embaixo.
   */
  onSalvar: (novo: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor);
  // O texto que está indo ao servidor. Mostrado no lugar do título enquanto
  // isso, para o Enter não "piscar" o título velho de volta.
  const [emVoo, setEmVoo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  // ⚠️ "Já confirmei ou desisti desta edição." Enter confirma e fecha o campo,
  // e o campo saindo da tela pode ainda disparar o blur -- que confirmaria de
  // novo. A ref, e não o estado, porque o blur chega antes do novo render.
  const abertoRef = useRef(false);

  // ⚠️ `focus()` E DEPOIS `select()` -- a lição de `CabecalhoDeColunaEditavel`:
  // `select()` sozinho não move o foco no jsdom.
  useEffect(() => {
    if (!editando) return;
    campoRef.current?.focus();
    campoRef.current?.select();
  }, [editando]);

  // A altura acompanha o texto: o campo tem a altura do título, não uma caixa
  // de rolagem de uma linha.
  useLayoutEffect(() => {
    const el = campoRef.current;
    if (!editando || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editando, rascunho]);

  function abrir() {
    if (emVoo !== null) return;
    setRascunho(valor);
    setErro(null);
    abertoRef.current = true;
    setEditando(true);
  }

  function desistir() {
    if (!abertoRef.current) return;
    abertoRef.current = false;
    setEditando(false);
    setErro(null);
  }

  async function confirmar() {
    if (!abertoRef.current) return;
    abertoRef.current = false;
    const decisao = decidirTitulo(rascunho, valor);
    setEditando(false);
    if (decisao.tipo === "nada") {
      setErro(null);
      return;
    }
    setEmVoo(decisao.valor);
    try {
      await onSalvar(decisao.valor);
      setErro(null);
    } catch (e) {
      // ⚠️ REABRE COM O QUE A PESSOA ESCREVEU. Voltar ao título velho em
      // silêncio perderia a edição e esconderia que não salvou.
      setErro(e instanceof Error ? e.message : "Não consegui salvar o título.");
      setRascunho(decisao.valor);
      abertoRef.current = true;
      setEditando(true);
    } finally {
      setEmVoo(null);
    }
  }

  const Heading = level;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {editando ? (
        // ⚠️ O TÍTULO NÃO SOME ENQUANTO SE EDITA: o campo fica DENTRO dele.
        // Antes o `<h2>` era trocado pelo campo, e a página perdia o título
        // durante a edição -- no `/tarefa/[id]`, o único que ela tinha.
        // `textarea` é conteúdo de frase, então é HTML válido dentro de `h1`/`h2`.
        <Heading style={{ margin: 0 }}>
          <textarea
            ref={campoRef}
            className="input"
            aria-label="Título da tarefa"
            value={rascunho}
            maxLength={TITULO_MAXIMO_TAREFA}
            rows={1}
            aria-invalid={erro ? true : undefined}
            onChange={(e) => setRascunho(e.target.value)}
            onBlur={() => void confirmar()}
            onKeyDown={(e) => {
              // ⚠️ `stopPropagation` NOS DOIS: o Esc do detalhe fecha o modal
              // inteiro, e aqui ele só desiste do título.
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                desistir();
                return;
              }
              // Enter de composição (acento, IME) ainda não é o Enter da pessoa.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                void confirmar();
              }
            }}
            style={{
              ...ESTILO_DO_TITULO,
              width: "100%",
              padding: "2px 6px",
              margin: "-3px -7px",
              resize: "none",
              overflow: "hidden",
              fontFamily: "inherit",
            }}
          />
        </Heading>
      ) : (
        <Heading style={{ ...ESTILO_DO_TITULO, margin: 0, overflowWrap: "anywhere" }}>
          {/* ⚠️ BOTÃO DENTRO DO TÍTULO, e não `<h2 onClick>`: o título continua
              sendo o cabeçalho para o leitor de tela, e o botão é alcançável
              por Tab e anuncia que edita (web/AGENTS.md §3, "se parece
              clicável, tem de ser clicável"). */}
          <button
            type="button"
            onClick={abrir}
            // ⚠️ SEM `aria-label`: o nome do botão é o texto dele, que é o
            // título. A instrução vai no `title`, que vira a DESCRIÇÃO (ver o
            // topo do arquivo).
            title="Editar o título"
            className="w-full rounded-md text-left hover:bg-[var(--surface-2)]"
            style={{
              font: "inherit",
              letterSpacing: "inherit",
              color: "inherit",
              border: "none",
              padding: "2px 6px",
              margin: "-2px -6px",
              cursor: emVoo !== null ? "progress" : "pointer",
              opacity: emVoo !== null ? 0.6 : 1,
              overflowWrap: "anywhere",
            }}
          >
            {emVoo ?? valor}
          </button>
        </Heading>
      )}
      {erro && (
        <div className="mt-1 text-xs text-danger" role="alert">
          {erro}
        </div>
      )}
    </div>
  );
}
