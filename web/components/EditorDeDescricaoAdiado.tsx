"use client";
// components/EditorDeDescricaoAdiado.tsx
// O editor de descrição, baixado só quando alguém vai EDITAR (Spec 052, fatia E).
//
// ⚠️ MEDIDO NO `next build` DE 16/09: com o editor (Tiptap) importado direto, a
// primeira carga de `/minhas-tarefas`, `/tarefa/[id]` e `/projetos/[id]` subiu
// de ~290 kB para ~435 kB -- para TODO MUNDO que abre essas telas, inclusive
// quem só lê. O editor só aparece ao clicar em "Editar", no modal de criar e no
// painel do projeto; até lá ele não precisa existir no navegador.
//
// ⚠️ `React.lazy` E NÃO `next/dynamic`: os dois adiam o download, e o `lazy`
// também funciona nos testes (vitest), sem simular o carregador do Next.
//
// ⚠️⚠️ E O DOWNLOAD PODE FALHAR (revisão de 16/09). Uma aba aberta desde antes
// de um deploy pede o pedaço de código com o nome antigo, que não existe mais;
// rede instável faz o mesmo. Sem uma fronteira de erro, a rejeição do `import()`
// subia até a raiz -- o app não tem outra -- e a PÁGINA INTEIRA virava
// "Application error". Aqui a falha fica no campo, com "Tentar de novo" e
// "Recarregar a página". O rascunho mora em quem usa, e não se perde.

import { Component, lazy, Suspense, useState, type ComponentProps, type ReactNode } from "react";

type Props = ComponentProps<typeof import("@/components/EditorDeDescricao").default>;

function carregarEditor() {
  return lazy(() => import("@/components/EditorDeDescricao"));
}

class FronteiraDoEditor extends Component<
  { children: ReactNode; onTentarDeNovo: () => void },
  { falhou: boolean }
> {
  state = { falhou: false };

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  render() {
    if (!this.state.falhou) return this.props.children;
    return (
      <div className="error-box" role="alert">
        Não consegui carregar o editor.{" "}
        <button
          type="button"
          className="font-semibold underline"
          onClick={() => {
            this.setState({ falhou: false });
            this.props.onTentarDeNovo();
          }}
        >
          Tentar de novo
        </button>{" "}
        ·{" "}
        <button type="button" className="font-semibold underline" onClick={() => window.location.reload()}>
          Recarregar a página
        </button>
      </div>
    );
  }
}

export default function EditorDeDescricaoAdiado(props: Props) {
  // ⚠️ UM `lazy` NOVO A CADA TENTATIVA: o `lazy` guarda a promessa rejeitada, e
  // tentar de novo com o mesmo repetiria a falha sem pedir o arquivo outra vez.
  const [Editor, setEditor] = useState(carregarEditor);

  return (
    <FronteiraDoEditor onTentarDeNovo={() => setEditor(carregarEditor)}>
      <Suspense
        fallback={
          // Mesma altura do editor, para o formulário não pular quando ele chega.
          <div
            className="input muted"
            aria-busy="true"
            style={{ minHeight: (props.rows ?? 6) * 21 + 22 + 34, fontSize: 13 }}
          >
            Carregando editor…
          </div>
        }
      >
        <Editor {...props} />
      </Suspense>
    </FronteiraDoEditor>
  );
}
