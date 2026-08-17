"use client";
import { useEffect, useState } from "react";

import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import { currentUser } from "@/lib/api";
import { alcanceDeQuadro, podeGerirQuadroDaRaiz } from "@/lib/seletorDeQuadro";

// Quadro GERAL: panorama de tudo (sem projectId). A logica do board mora em
// components/Board.tsx, compartilhada com a pagina de projeto (Entrega 11).
export default function QuadroPage() {
  // ⚠️ ESTA TELA PASSOU A BUSCAR O `/auth/me` EM 17/08, e o motivo e a 6a-bis:
  // o Quadro geral virou editavel em 13/08 no backend e o lapis nunca apareceu
  // aqui, porque `podeEditarColunas` nao era passado por ninguem.
  //
  // ⚠️ A PERMISSAO VEM DECIDIDA DE FORA, e nao de dentro do `Board` -- mesma
  // regra do `/quadro/[teamId]`. Recalcular no componente seria a segunda
  // definicao da mesma coisa, e as duas divergiriam sem nada ficar vermelho.
  //
  // ⚠️ FALHA = SEM LAPIS, e nao tela de erro. Perder o `/auth/me` nao pode
  // impedir 26 pessoas de ver o quadro por causa de um botao que so ADMIN e
  // MANAGER usam. E o backend recusa com 403 de qualquer forma: isto so evita
  // oferecer.
  const [podeEditar, setPodeEditar] = useState(false);
  useEffect(() => {
    currentUser()
      .then((eu) => setPodeEditar(podeGerirQuadroDaRaiz(alcanceDeQuadro(eu))))
      .catch(() => setPodeEditar(false));
  }, []);

  return (
    <AppShell>
      <Board title="Quadro geral" podeEditarColunas={podeEditar} />
    </AppShell>
  );
}
