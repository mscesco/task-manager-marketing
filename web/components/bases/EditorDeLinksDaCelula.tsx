"use client";
// Painel de editar os links de uma célula da Base (usa `EditorDeLinks`; o nome é opcional).
// Grava ao fechar (clicar fora salva a lista numa gravação só); Esc desiste.
// Com erro, clicar fora não fecha, para não perder o que foi digitado.

import { useState, type MutableRefObject } from "react";
import AnchoredPanel, { type PanelBox } from "@/components/AnchoredPanel";
import EditorDeLinks from "@/components/EditorDeLinks";
import type { BaseLinkValue } from "@/lib/api";
import {
  errosDosLinks,
  linhaVazia,
  linksMudaram,
  paraEnvio,
  passaDoTeto,
  rascunhoDe,
  temErro,
  MAX_LINKS,
  type RascunhoLink,
} from "@/lib/links";

export default function EditorDeLinksDaCelula({
  box,
  panelRef,
  fecharRef,
  titulo,
  links,
  onGravar,
  onFechar,
}: {
  box: PanelBox;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  /** Ver `EditorDeEscolha`: o fechamento automático do painel passa por aqui. */
  fecharRef: MutableRefObject<(() => void) | null>;
  titulo: string;
  links: readonly BaseLinkValue[];
  onGravar: (links: BaseLinkValue[] | null) => void;
  onFechar: () => void;
}) {
  const salvos = links.map((l, i) => ({ id: String(i), ...l }));
  const [rascunho, setRascunho] = useState<RascunhoLink[]>(() =>
    // Célula vazia já abre com uma linha para digitar.
    salvos.length ? rascunhoDe(salvos) : [linhaVazia()]
  );
  const [tentou, setTentou] = useState(false);
  const comErro = temErro(errosDosLinks(rascunho, { nomeOpcional: true })) || passaDoTeto(rascunho);

  function concluir() {
    if (comErro) {
      setTentou(true);
      return;
    }
    if (linksMudaram(salvos, rascunho)) {
      const envio = paraEnvio(rascunho);
      onGravar(envio.length ? envio : null);
    }
    onFechar();
  }
  fecharRef.current = concluir;

  return (
    <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label={`Links de ${titulo}`} minWidth={420}>
      <div
        className="flex flex-col gap-2 p-1"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onFechar();
          }
        }}
      >
        <EditorDeLinks
          valor={rascunho}
          onChange={setRascunho}
          mostrarErros={tentou}
          nomeOpcional
        />
        {tentou && passaDoTeto(rascunho) && (
          <p className="m-0 text-xs text-danger">No máximo {MAX_LINKS} links.</p>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost text-sm" onClick={onFechar}>
            Cancelar
          </button>
          <button className="btn btn-primary text-sm" onClick={concluir}>
            Salvar
          </button>
        </div>
      </div>
    </AnchoredPanel>
  );
}
