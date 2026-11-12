"use client";
// O editor de descrição, baixado só quando alguém vai editar (o Tiptap pesa
// ~145 kB na primeira carga). `React.lazy` em vez de `next/dynamic` porque
// funciona no vitest. A fronteira de erro segura a falha do download (aba
// aberta antes de um deploy, rede instável) no campo, em vez de derrubar a página.

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
  // Um `lazy` novo a cada tentativa: o `lazy` guarda a promessa rejeitada.
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
