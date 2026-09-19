import json
import sqlite3
from pathlib import Path


class IdempotencyStore:
    def __init__(self, path: Path):
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.execute(
            "create table if not exists execution_requests (request_id text primary key, response text not null, created_at text default current_timestamp)"
        )
        self.connection.execute(
            "create table if not exists symbol_mappings (internal_symbol text primary key, broker_symbol text not null, updated_at text default current_timestamp)"
        )
        self.connection.commit()

    def get(self, request_id: str):
        row = self.connection.execute(
            "select response from execution_requests where request_id=?", (request_id,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, request_id: str, response: dict):
        self.connection.execute(
            "insert into execution_requests(request_id,response) values(?,?) on conflict(request_id) do update set response=excluded.response",
            (request_id, json.dumps(response)),
        )
        self.connection.commit()

    def reserve(self, request_id: str):
        self.connection.execute(
            "insert into execution_requests(request_id,response) values(?,?)",
            (request_id, json.dumps({"ok": False, "stage": "reserved", "uncertain": True, "comment": "Execution outcome is being reconciled; duplicate send blocked."})),
        )
        self.connection.commit()

    def mappings(self):
        return dict(self.connection.execute(
            "select internal_symbol,broker_symbol from symbol_mappings"
        ).fetchall())

    def put_mapping(self, internal: str, broker: str):
        self.connection.execute(
            "insert into symbol_mappings(internal_symbol,broker_symbol) values(?,?) on conflict(internal_symbol) do update set broker_symbol=excluded.broker_symbol,updated_at=current_timestamp",
            (internal, broker),
        )
        self.connection.commit()
