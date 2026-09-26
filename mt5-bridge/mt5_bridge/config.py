from collections import Counter
from math import log2
from pathlib import Path
from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_PLACEHOLDER_KEY_MARKERS = (
    "replacewith",
    "changeme",
    "placeholder",
    "example",
    "sample",
    "dummy",
    "samebridgekey",
    "randomsecretofatleast",
)


def _looks_like_repeated_pattern(value: str) -> bool:
    for width in range(1, (len(value) // 2) + 1):
        if len(value) % width == 0 and value == value[:width] * (len(value) // width):
            return True
    return False


def _shannon_entropy(value: str) -> float:
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * log2(count / length) for count in counts.values())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mt5_login: int | None = None
    mt5_password: SecretStr | None = None
    mt5_server: str | None = None
    mt5_path: Path | None = None
    bridge_api_key: SecretStr = Field(min_length=32)
    bridge_host: str = Field(default="127.0.0.1", min_length=1)
    bridge_port: int = Field(default=8765, ge=1, le=65535)
    enable_mt5_trading: bool = False
    allow_live_trading: bool = False
    mt5_state_db: Path = Path("./mt5_bridge.db")
    mt5_poll_seconds: float = Field(default=1.0, ge=0.25, le=30)
    mt5_healthcheck_seconds: float = Field(default=5.0, ge=1.0, le=60)
    mt5_stale_after_seconds: int = Field(default=30, ge=5, le=600)
    mt5_reconcile_lookback_hours: int = Field(default=72, ge=1, le=720)
    mt5_reconcile_grace_seconds: int = Field(default=30, ge=5, le=600)
    mt5_preflight_grace_seconds: int = Field(default=90, ge=5, le=600)
    mt5_magic: int = Field(default=260919, ge=1, le=2147483647)
    mt5_log_level: str = "INFO"

    @field_validator("bridge_host")
    @classmethod
    def validate_bridge_host(cls, value: str) -> str:
        host = value.strip()
        if not host or "://" in host or "/" in host:
            raise ValueError("BRIDGE_HOST must be a bind hostname or IP address, not a URL")
        return host

    @field_validator("bridge_api_key")
    @classmethod
    def validate_bridge_api_key(cls, value: SecretStr) -> SecretStr:
        secret = value.get_secret_value()
        normalized = "".join(character for character in secret.lower() if character.isalnum())
        if len(secret.encode("utf-8")) < 32:
            raise ValueError("BRIDGE_API_KEY must contain at least 32 bytes")
        if any(marker in normalized for marker in _PLACEHOLDER_KEY_MARKERS):
            raise ValueError("BRIDGE_API_KEY must not be a placeholder or example value")
        if (
            len(set(secret)) < 10
            or _shannon_entropy(secret) < 3.0
            or _looks_like_repeated_pattern(secret)
        ):
            raise ValueError("BRIDGE_API_KEY must be a high-entropy random secret")
        return value

