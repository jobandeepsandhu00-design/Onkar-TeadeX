import uvicorn
from .config import Settings

if __name__ == "__main__":
    settings = Settings()
    uvicorn.run(
        "mt5_bridge.app:app",
        host=settings.bridge_host,
        port=settings.bridge_port,
        reload=False,
    )

