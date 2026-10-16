# Spec 057 — Planilha na Base: exportar, importar, copiar e colar

**Status:** decidida e entregue em 15/10/2026, para o lançamento da Base (16/10).
Decisões dela no mesmo dia: importar numa base **nova e numa existente**; o
copiar e colar **entra junto**; tudo no lançamento.

## O que entrega

1. **Exportar** (`POST /bases/{id}/export`): Excel (.xlsx) ou CSV, com **as
   linhas e colunas da visão**, na ordem da tela — a tela manda os ids; filtro e
   ordenação não são reescritos no servidor. O texto é o que a tela mostra
   (rótulo da opção, nome da pessoa, data 14/10/2026; no Excel, data de verdade),
   e os separadores (`; `) são os que a importação entende: exportar e importar
   de volta dá o mesmo.
2. **Importar** — um assistente em três passos, que serve a base nova (na lista
   de Bases) e a existente (no menu Planilha da base):
   1. **Arquivo** (.xlsx ou .csv, até 5 MB): a aba e a linha do cabeçalho.
   2. **Colunas, uma por uma:** coluna nova (com o tipo, sugerido pelo servidor
      olhando os valores), juntar com uma existente, título, ou ignorar. A
      sugestão inicial: a 1ª coluna vai para o título, a de mesmo nome junta.
   3. **Conferir:** valida sem gravar e lista os problemas pela linha do
      arquivo; importa tudo, ou só as válidas.
   - Conversões: número e data no formato brasileiro (`1.200`, `1.234,5`,
     `14/10/2026`); sim/não; vários valores separados por `;`; pessoa pelo nome
     ou e-mail de alguém ativo do time; opção que não existe vira opção nova.
   - **Uma ação do diário (`rows.import`):** um Ctrl+Z desfaz a importação
     inteira — linhas e colunas criadas.
   - Respeita o teto de 5.000 linhas.
   - O arquivo viaja em base64 no JSON (sem `python-multipart`), nos dois
     passos: o servidor não guarda nada entre a prévia e a importação.
3. **Copiar e colar várias células** na tabela:
   - Shift+setas ou Shift+clique seleciona uma faixa; Esc desfaz.
   - Ctrl+C copia no formato do Excel (TAB e quebra de linha).
   - Ctrl+V cola a partir da célula ativa (ou do canto da faixa), convertendo
     pelo tipo da coluna; o que não serve e o que cai fora da tabela é contado
     e avisado. **Uma ação do diário.**
   - Delete com faixa limpa a faixa inteira.

## Fora (por enquanto)

- Colar criando linhas novas além da última (cada linha criada seria uma ação
  do diário, e um Ctrl+Z não desfaria a colagem inteira).
- Seletores no padrão do produto no assistente (usa o `<select>` nativo; ela
  pediu para pontuar esses depois).

## Permissões

- Exportar: quem lê a base.
- Importar numa existente: `base_row.create`; criar opção numa coluna que já
  existe pede `base_column.update` (sem ele, opção desconhecida é erro da linha).
- Importar numa nova: `base.create` no time raiz.
