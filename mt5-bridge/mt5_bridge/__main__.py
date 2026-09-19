import uvicorn

if __name__ == "__main__":
    uvicorn.run("mt5_bridge.app:app", host="0.0.0.0", port=8765, reload=False)

