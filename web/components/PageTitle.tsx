import type { ReactNode } from "react";

/**
 * O `<h1>` das telas internas. Tudo dentro dele vira o nome do título para o
 * leitor de tela: ações ficam ao lado, não dentro.
 */
export default function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-0 text-[30px] font-extrabold leading-[1.1] tracking-[-0.02em]">
      {children}
    </h1>
  );
}
