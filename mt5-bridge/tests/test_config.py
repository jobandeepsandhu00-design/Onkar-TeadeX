import pytest
from pydantic import SecretStr, ValidationError

from mt5_bridge.config import Settings


STRONG_KEY = "OtxBridge_9vN2!qR7#kL4$wP8@mC5-zX3_D6hJ1fB8"


def test_bridge_binds_to_loopback_by_default():
    settings = Settings(bridge_api_key=SecretStr(STRONG_KEY))

    assert settings.bridge_host == "127.0.0.1"
    assert settings.bridge_port == 8765


def test_bridge_allows_explicit_network_bind_override():
    settings = Settings(
        bridge_api_key=SecretStr(STRONG_KEY),
        bridge_host="10.20.30.40",
        bridge_port=9443,
    )

    assert settings.bridge_host == "10.20.30.40"
    assert settings.bridge_port == 9443


@pytest.mark.parametrize(
    "key",
    [
        "replace-with-at-least-32-random-characters",
        "change-me-change-me-change-me-change-me",
        "x" * 32,
        "abcd1234" * 4,
    ],
)
def test_bridge_rejects_placeholder_or_low_entropy_keys(key):
    with pytest.raises(ValidationError):
        Settings(bridge_api_key=SecretStr(key))
