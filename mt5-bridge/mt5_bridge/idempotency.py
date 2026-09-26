import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path


class IdempotencyStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.execute("pragma journal_mode=WAL")
        self.connection.execute("pragma synchronous=FULL")
        self.connection.execute("pragma busy_timeout=5000")
        self.connection.execute(
            "create table if not exists execution_requests (request_id text primary key, response text not null, created_at text default current_timestamp)"
        )
        self.connection.execute(
            "create table if not exists symbol_mappings (internal_symbol text primary key, broker_symbol text not null, updated_at text default current_timestamp)"
        )
        # V2 mappings are deliberately scoped to one opaque MT5 account
        # identity. The legacy unscoped table remains unread so an alias from a
        # previous broker/login can never be replayed after an upgrade.
        self.connection.execute(
            "create table if not exists symbol_mappings_v2 (account_scope text not null, internal_symbol text not null, broker_symbol text not null, updated_at text default current_timestamp, primary key(account_scope,internal_symbol))"
        )
        columns = {
            row[1]
            for row in self.connection.execute(
                "pragma table_info(execution_requests)"
            ).fetchall()
        }
        for name, declaration in (
            ("request_json", "text"),
            ("status", "text not null default 'COMPLETED'"),
            ("token", "text"),
            ("intent_digest", "text"),
            ("account_scope", "text"),
            ("broker_symbol", "text"),
            ("updated_at", "text default current_timestamp"),
        ):
            if name not in columns:
                self.connection.execute(
                    f"alter table execution_requests add column {name} {declaration}"
                )
        self.connection.execute(
            "create index if not exists execution_requests_status_idx on execution_requests(status,created_at)"
        )
        self.connection.commit()

    def get(
        self,
        request_id: str,
        intent_digest: str | None = None,
        account_scope: str | None = None,
        broker_symbol: str | None = None,
    ):
        with self._lock:
            row = self.connection.execute(
                "select response,intent_digest,account_scope,broker_symbol,status from execution_requests where request_id=?",
                (request_id,),
            ).fetchone()
            if not row:
                return None
            if intent_digest is not None:
                if not row[1] or row[1] != intent_digest:
                    raise ValueError(
                        "Request id was already used with different order content"
                    )
                if not row[2] or row[2] != account_scope:
                    raise ValueError(
                        "Request id was already used for a different MT5 account"
                    )
                if not row[3] or row[3] != broker_symbol:
                    raise ValueError(
                        "Request id was already used for a different broker symbol"
                    )
            # A successful broker check arms this exact intent but does not
            # mean an order was attempted. The matching claim and execute
            # calls are the only path from ARMED -> CLAIMED -> RESERVED.
            if row[4] in {"ARMED", "CLAIMED"}:
                return None
            return json.loads(row[0])

    def claim(
        self,
        request_id: str,
        intent_digest: str,
        account_scope: str,
        broker_symbol: str,
    ):
        with self._lock, self.connection:
            cursor = self.connection.execute(
                "update execution_requests set status='CLAIMED',updated_at=current_timestamp "
                "where request_id=? and status in ('ARMED','CLAIMED') and intent_digest=? and account_scope=? and broker_symbol=?",
                (request_id, intent_digest, account_scope, broker_symbol),
            )
            if cursor.rowcount != 1:
                raise ValueError(
                    "MT5 request is not armed for this exact account and broker symbol"
                )

    def cancel_unsent(self, request_id: str, expected_state: str):
        """Atomically terminalize an ARMED/CLAIMED request before order_send."""
        if expected_state not in {"ARMED", "CLAIMED"}:
            raise ValueError("Only an unsent MT5 request can be cancelled")
        claimed = expected_state == "CLAIMED"
        response = {
            "ok": False,
            "stage": "claim_cancelled" if claimed else "preflight_cancelled",
            "requestId": request_id,
            "notSent": True,
            "comment": (
                "Execution claim was reconciled before MT5 order_send; delayed execution is blocked."
                if claimed
                else "Broker preflight was reconciled before an execution claim; delayed execution is blocked."
            ),
        }
        with self._lock, self.connection:
            cursor = self.connection.execute(
                "update execution_requests set response=?,status='CANCELLED',updated_at=current_timestamp "
                "where request_id=? and status=?",
                (json.dumps(response), request_id, expected_state),
            )
        return response if cursor.rowcount == 1 else None

    def arm(
        self,
        request_id: str,
        response: dict,
        request: dict,
        token: str,
        intent_digest: str,
        account_scope: str,
        broker_symbol: str,
    ):
        with self._lock, self.connection:
            cursor = self.connection.execute(
                "update execution_requests set response=?,request_json=?,token=?,updated_at=current_timestamp "
                "where request_id=? and status in ('ARMED','CLAIMED') and intent_digest=? and account_scope=? and broker_symbol=?",
                (
                    json.dumps(response),
                    json.dumps(request),
                    token,
                    request_id,
                    intent_digest,
                    account_scope,
                    broker_symbol,
                ),
            )
            if cursor.rowcount == 0:
                self.connection.execute(
                    "insert into execution_requests(request_id,response,request_json,status,token,intent_digest,account_scope,broker_symbol,updated_at) values(?,?,?,?,?,?,?,?,current_timestamp)",
                    (
                        request_id,
                        json.dumps(response),
                        json.dumps(request),
                        "ARMED",
                        token,
                        intent_digest,
                        account_scope,
                        broker_symbol,
                    ),
                )

    def lookup(self, request_id: str):
        """Return durable execution state without exposing the order payload."""
        with self._lock:
            row = self.connection.execute(
                "select status,response,created_at,updated_at from execution_requests where request_id=?",
                (request_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "requestId": request_id,
            "state": row[0],
            "result": json.loads(row[1]),
            "createdAt": row[2],
            "updatedAt": row[3],
        }

    def put(self, request_id: str, response: dict):
        with self._lock, self.connection:
            self.connection.execute(
                "insert into execution_requests(request_id,response,status,updated_at) values(?,?,'COMPLETED',current_timestamp) "
                "on conflict(request_id) do update set response=excluded.response,status='COMPLETED',updated_at=current_timestamp",
                (request_id, json.dumps(response)),
            )

    def reserve(
        self,
        request_id: str,
        request: dict,
        token: str,
        intent_digest: str,
        account_scope: str,
        broker_symbol: str,
    ):
        with self._lock, self.connection:
            cursor = self.connection.execute(
                "update execution_requests set response=?,request_json=?,status='RESERVED',token=?,updated_at=current_timestamp "
                "where request_id=? and status='CLAIMED' and intent_digest=? and account_scope=? and broker_symbol=?",
                (
                    json.dumps({"ok": False, "stage": "reserved", "uncertain": True, "comment": "Execution outcome is being reconciled; duplicate send blocked."}),
                    json.dumps(request),
                    token,
                    request_id,
                    intent_digest,
                    account_scope,
                    broker_symbol,
                ),
            )
            if cursor.rowcount == 0:
                raise ValueError(
                    "MT5 request must be durably claimed before execution"
                )

    def pending(self):
        with self._lock:
            rows = self.connection.execute(
                "select request_id,request_json,token,created_at,account_scope,broker_symbol "
                "from execution_requests where status='RESERVED' order by created_at"
            ).fetchall()
        return [
            {
                "requestId": row[0],
                "request": json.loads(row[1] or "{}"),
                "token": row[2],
                "createdAt": row[3],
                # These opaque fields never leave the bridge. They prevent a
                # management request reserved under account A from being
                # reconciled against account B after a terminal login switch.
                "accountScope": row[4],
                "brokerSymbol": row[5],
            }
            for row in rows
        ]

    def unresolved(self):
        """Return every non-terminal execution handoff, without order payloads."""
        with self._lock:
            rows = self.connection.execute(
                "select request_id,status,created_at,updated_at "
                "from execution_requests "
                "where status in ('ARMED','CLAIMED','RESERVED') "
                "order by created_at"
            ).fetchall()
        return [
            {
                "requestId": row[0],
                "state": row[1],
                "createdAt": row[2],
                "updatedAt": row[3],
            }
            for row in rows
        ]

    def complete_reconciliation(self, request_id: str, response: dict):
        self.put(request_id, {**response, "reconciled": True})

    def age_seconds(self, created_at: str) -> float:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - created).total_seconds())

    def mappings(self, account_scope: str):
        with self._lock:
            return dict(self.connection.execute(
                "select internal_symbol,broker_symbol from symbol_mappings_v2 where account_scope=?",
                (account_scope,),
            ).fetchall())

    def put_mapping(self, account_scope: str, internal: str, broker: str):
        with self._lock, self.connection:
            self.connection.execute(
                "insert into symbol_mappings_v2(account_scope,internal_symbol,broker_symbol) values(?,?,?) on conflict(account_scope,internal_symbol) do update set broker_symbol=excluded.broker_symbol,updated_at=current_timestamp",
                (account_scope, internal, broker),
            )
