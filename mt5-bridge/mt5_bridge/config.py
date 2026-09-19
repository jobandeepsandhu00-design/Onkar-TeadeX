from pathlib import Path
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mt5_login: int | None = None
    mt5_password: SecretStr | None = None
    mt5_server: str | None = None
    mt5_path: Path | None = None
    bridge_api_key: SecretStr = Field(min_length=32)
    enable_mt5_trading: bool = False
    allow_live_trading: bool = False
    mt5_state_db: Path = Path("./mt5_bridge.db")
    mt5_poll_seconds: float = Field(default=1.0, ge=0.25, le=30)
    mt5_stale_after_seconds: int = Field(default=30, ge=5, le=600)
    mt5_log_level: str = "INFO"

