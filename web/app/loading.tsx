// O que o Next mostra enquanto qualquer rota carrega. Tela inteira, sem a barra
// lateral: a barra mora dentro de cada página (`AppShell`), não num layout comum.

import { LoadingScreen } from "@/components/Loading";

export default function Carregando() {
  return <LoadingScreen rotulo="Carregando a página" />;
}
