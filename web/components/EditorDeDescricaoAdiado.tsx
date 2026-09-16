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

import { lazy, Suspense, type ComponentProps } from "react";

const EditorDeDescricao = lazy(() => import("@/components/EditorDeDescricao"));

export default function EditorDeDescricaoAdiado(props: ComponentProps<typeof EditorDeDescricao>) {
  return (
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
      <EditorDeDescricao {...props} />
    </Suspense>
  );
}
