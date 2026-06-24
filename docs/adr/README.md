# Architecture Decision Records (ADRs) — raiz / infra

Decisões que **cruzam backend e front** (infra, deploy, topologia) moram
aqui, na raiz do monorepo. Decisões internas de cada lado ficam no
`docs/adr/` do respectivo projeto:

- `backend/docs/adr/` — decisões do backend (0001–0022).
- `web/docs/adr/` — decisões só do front (pin do time raiz, edição sem GET…).
- `docs/adr/` (aqui) — infra/deploy/topologia que afeta os dois.

Mesma convenção dos outros: `NNNN-titulo-curto.md`, status
`Proposed | Accepted | Superseded by NNNN`, sem edição retroativa
(revisar = criar um novo ADR que supersede).

## Índice

- `0001-topologia-mesmo-host.md` — front e backend no mesmo host, roteados
  por path (`…/api` → backend). Mata CORS. **Accepted.**
