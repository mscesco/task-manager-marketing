# Spec 063 — Oniros no celular e no tablet

**Status:** aprovada por ela em 09/11/2026, com as três decisões abaixo.

Pedido dela (09/11): arrumar o funcionamento do Oniros quando aberto no celular
ou no tablet, independente da marca. A adaptação é por **tamanho de tela** e
por **tipo de ponteiro** (dedo ou mouse), nunca por modelo de aparelho.

Esta spec revoga a linha "Zero responsivo. O produto é ferramenta interna de
desktop" do `web/AGENTS.md` §1. Só mexe no front: sem migration e sem rota nova.

## O que foi medido (09/11)

Telas abertas no navegador daqui, em 375×812 (celular), 768×1024 (tablet em pé)
e 1024×768 (tablet deitado), com dados do banco de dev.

**Não foi medido:** toque de verdade, aparelho físico e Safari. A emulação é do
Chromium. O modal de nova tarefa, o painel de membro e o detalhe de uma
solicitação no celular também não foram abertos.

### O problema principal: o menu lateral

O menu ocupa 224 px em qualquer largura. O que sobra para o conteúdo:

| Largura | Conteúdo |
|---|---|
| Celular (375) | **151 px**, inutilizável em toda tela interna |
| Tablet em pé (768) | 534 px, apertado mas usável |
| Tablet deitado (1024) | 790 px, bom |

Ele tem o botão "Retrair", mas abre aberto por padrão, e o sino de notificações
flutua por cima do conteúdo.

### Tela a tela, com o menu fora da frente (celular)

| Tela | Resultado |
|---|---|
| Início, Projetos, Projeto, Times, Time, Organização | cabem |
| Formulário público (`/solicitar`) | cabe; é o que quem pede pelo celular já usa hoje |
| Minhas tarefas | filtros cabem; sem linhas de tarefa no dev para conferir a lista |
| Quadro | colunas de 292 px com rolagem lateral, ok; o problema é o toque (abaixo) |
| Detalhe da tarefa | empilha certo, mas o título vira "[teste]…": Seguir, compartilhar, ⋯ e fechar comem a linha |
| Solicitações | **estoura** (533 px): as abas não encolhem. Estoura também no tablet em pé (557 em 534) |
| Perfil | **estoura** (478 px): o cartão com o formulário |
| Notificações | **estoura** (468 px): "Marcar todas como lidas" |
| Arquivadas | a tabela rola por dentro, certo, mas a página mede 705 px; causa ainda a confirmar |
| Base | tabela rola, mas tem **113 alvos de toque menores que 24 px**; o título vira "Catál…" |
| Editar formulário | **quebrada**: textos sobrepostos e 47 botões fora da tela |

### O que a medição de largura não mostra (lido no código)

1. **O quadro prende o dedo.** Os cards têm `touch-action: none` para o arraste
   funcionar (`Board.tsx`, `CabecalhoDeColunaEditavel.tsx` e o quadro de
   `minhas-tarefas`). No celular o card ocupa quase toda a coluna: encostar
   nele deve impedir a rolagem. A confirmar em aparelho.
2. **Botões que só aparecem com o mouse em cima.** A cápsula de ações do
   comentário (reagir, editar, apagar) e um botão de linha da Base.
3. **Campos com fonte de 14 px.** O iPhone dá zoom na página ao focar qualquer
   campo menor que 16 px.
4. **`100vh` em 9 lugares.** No celular a barra do navegador cobre o fim da
   tela, inclusive o rodapé do menu.

## O que entrega

**Até 767 px (celular)**
- O menu vira gaveta: fechado por padrão, abre por um botão numa barra
  superior com o logo e o sino, e fecha ao escolher um item ou tocar fora.
- A preferência "Retrair" do computador não é alterada.

**De 768 a 1023 px (tablet em pé)**
- O menu começa retraído em ícones, e abre por cima do conteúdo.

**1024 px ou mais**
- Como hoje.

**Em qualquer aparelho com toque**
- Nenhuma ação depende de mouse em cima.
- Alvos de toque de pelo menos 24 px.
- Campos com 16 px, para o iPhone não dar zoom.
- Altura pela área visível de verdade (`dvh`), e não `100vh`.

**O quadro no toque:** arrastar passa a exigir **toque longo** no card; o toque
curto abre a tarefa e deslizar rola. `PointerSensor` dá lugar a `MouseSensor` +
`TouchSensor`, e o computador continua igual.

## Fatias (um commit cada, um PR só saindo de `main`)

- **A — estrutura:** gaveta, barra superior, menu retraído no tablet, `dvh` e a
  fonte dos campos. Sozinha, destrava quase todas as telas.
- **B — estouros:** Solicitações, Perfil, Notificações, Arquivadas e o título
  no detalhe da tarefa.
- **C — quadro no toque:** toque longo no Quadro, em Minhas tarefas e na coluna.
- **D — sem mouse:** cápsula do comentário, ações da Base e o detalhe de
  solicitação no celular.
- **E — telas de configuração:** depende da decisão 1.

Cada fatia é conferida no navegador nas três larguras e nos dois temas. Os
portões de código não medem largura nem toque. Ao fim, ela testa num aparelho
de verdade, porque o toque real e o Safari não dão para emular daqui.

## Decisões (09/11)

1. **Telas de configuração só em tela grande.** Editar formulário, editar
   colunas e importar planilha mostram, no celular, um aviso "abra no
   computador". (Recusada: adaptar todas.)
2. **Mudar de coluna no celular:** toque longo no card, mais o campo "Coluna"
   que já existe no detalhe. (Recusada: só o campo.)
3. **Instalar como app fica para uma spec depois.**

## Fora

- App nativo e notificação no celular.
- Trabalhar sem internet.
- Redesenhar a tabela da Base para o celular: ela continua com rolagem lateral.
