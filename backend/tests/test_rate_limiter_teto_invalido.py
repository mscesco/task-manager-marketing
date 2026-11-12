"""O limitador recusa teto que nao deixaria passar ninguem."""

from __future__ import annotations

import pytest

from app.core.rate_limit import RateLimiter


def test_max_hits_invalido() -> None:
    with pytest.raises(ValueError):
        RateLimiter(bucket="x", max_hits=0, window_seconds=60)
