"use client";
// lib/useTema.tsx
// A preferencia de tema, publicada pela barra (AppShell) para as telas.
// Nasceu na fatia 4 do redesign: o Perfil ganhou um seletor segmentado, e
// dois estados (barra e tela) discordariam -- o botao da barra diria "escuro"
// com a tela em "claro". Quem grava e aplica continua sendo o AppShell.
//
// ⚠️ O padrao sem provedor e inerte: a tela desenha "sistema" e o clique nao
// faz nada. E o que acontece nos testes que mockam o AppShell.

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
