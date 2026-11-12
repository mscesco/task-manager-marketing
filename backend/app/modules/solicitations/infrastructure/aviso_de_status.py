"""Aviso de mudanca de status ao solicitante, via webhook do n8n.

Chame so depois do `uow.commit()`: fora da transacao, com timeout curto. Nunca
levanta (best-effort, sem reenvio). Sem `N8N_WEBHOOK_URL` o recurso fica desligado.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

#: Rotulo de cada status mostrado no e-mail; vai pronto para o n8n nao divergir da tela.
ROTULO_DO_STATUS: dict[str, str] = {
    "PENDING": "Pendente",
    "APPROVED": "Aprovada",
    "IN_PROGRESS": "Em andamento",
    "DONE": "Concluída",
    "REJECTED": "Recusada",
}


@dataclass(frozen=True, slots=True)
class AvisoDeStatus:
    """Tudo o que o n8n precisa para escrever o e-mail, ja resolvido.

    Montado antes do commit e enviado depois: carrega valores, nao ids nem objetos ORM.
    """

    solicitation_id: uuid.UUID
    protocolo: str
    status_anterior: str
    status_novo: str
    resumo: str
    categoria: str
    categoria_titulo: str
    categoria_prazo: str | None
    motivo_recusa: str | None
    criada_em: datetime
    requester_name: str
    requester_email: str
    requester_phone: str | None
    requester_department: str | None
    requester_polo: str | None
    form_slug: str
    form_titulo: str
    form_time: str

    def corpo(self, agora: datetime) -> dict:
        """O JSON do contrato com o workflow do n8n."""
        return {
            "evento": "solicitacao.status_mudou",
            "enviado_em": agora.isoformat(),
            "solicitacao": {
                "id": str(self.solicitation_id),
                "protocolo": self.protocolo,
                "status_anterior": self.status_anterior,
                "status_novo": self.status_novo,
                "status_novo_label": ROTULO_DO_STATUS.get(
                    self.status_novo, self.status_novo
                ),
                "resumo": self.resumo,
                "categoria": self.categoria,
                # Nunca nulo: cai no slug se a secao sumir.
                "categoria_titulo": self.categoria_titulo or self.categoria,
                "categoria_prazo": self.categoria_prazo,
                # So na recusa; e o unico retorno que o solicitante recebe.
                "motivo_recusa": (
                    self.motivo_recusa
                    if self.status_novo == "REJECTED"
                    else None
                ),
                "criada_em": self.criada_em.isoformat(),
            },
            "solicitante": {
                "nome": self.requester_name,
                "email": self.requester_email,
                # Opcionais: o formulario decide se pergunta.
                "telefone": self.requester_phone,
                "area": self.requester_department,
                "polo": self.requester_polo,
            },
            "formulario": {
                "slug": self.form_slug,
                "titulo": self.form_titulo,
                "time": self.form_time,
            },
        }


def esta_ligado() -> bool:
    """Ha n8n configurado? Sem URL, o recurso simplesmente nao existe."""
    return bool(settings.n8n_webhook_url.strip())


async def avisar(aviso: AvisoDeStatus) -> bool:
    """Avisa o n8n. Nunca levanta. Devolve se o aviso saiu (so para teste e log)."""
    if not esta_ligado():
        return False

    corpo = aviso.corpo(datetime.now(UTC))
    cabecalhos = {"Content-Type": "application/json"}
    if settings.n8n_webhook_token:
        cabecalhos["X-Webhook-Token"] = settings.n8n_webhook_token

    try:
        async with httpx.AsyncClient(
            timeout=settings.n8n_webhook_timeout_seconds
        ) as cliente:
            resposta = await cliente.post(
                settings.n8n_webhook_url, json=corpo, headers=cabecalhos
            )
        # 4xx/5xx tambem e best-effort, mas fica no log.
        if resposta.status_code >= 400:
            logger.warning(
                "solicitacao.aviso_recusado",
                solicitation_id=str(aviso.solicitation_id),
                status_novo=aviso.status_novo,
                http_status=resposta.status_code,
            )
            return False
    except Exception:
        # `Exception` e nao `httpx.HTTPError`: DNS, TLS e URL ruim levantam outras.
        logger.exception(
            "solicitacao.aviso_falhou",
            solicitation_id=str(aviso.solicitation_id),
            status_novo=aviso.status_novo,
        )
        return False

    logger.info(
        "solicitacao.aviso_enviado",
        solicitation_id=str(aviso.solicitation_id),
        status_anterior=aviso.status_anterior,
        status_novo=aviso.status_novo,
    )
    return True
