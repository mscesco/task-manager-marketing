"use client";
// A preferência de tema, publicada pelo AppShell (que grava e aplica) para
// as telas. Sem provedor é inerte: desenha "sistema" e o clique não faz nada.

import { createContext, useContext } from "react";
import type { Tema } from "./tema";

export type TemaContexto = {
  readonly tema: Tema;
  readonly mudarTema: (t: Tema) => void;
};

const Ctx = createContext<TemaContexto>({ tema: "sistema", mudarTema: () => {} });

export const TemaProvider = Ctx.Provider;

export function useTema(): TemaContexto {
  return useContext(Ctx);
}
