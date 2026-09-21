"""Iter 54 — Credential Vault: the company's OWN logins to external services (Google Workspace, hosting, domains…).

Entirely separate from this app's user accounts. Highest-sensitivity data in the application:
  * password encrypted at rest with Fernet (AES-128-CBC + HMAC-SHA256) under VAULT_MASTER_KEY from the environment —
    the key is never stored in MongoDB. Limitation vs a dedicated vault product: no envelope encryption / key rotation / HSM.
  * admin-only at the API layer; every reveal (view) is appended to the record's access_log AND the global audit log.
  * list/detail responses never include the password; it is only returned by the explicit /reveal action.
"""
from __future__ import annotations
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from bson import ObjectId
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

CATEGORIES = ["email", "hosting", "domain", "financial", "software", "other"]
TWO_FA_METHODS = ["authenticator_app", "sms", "backup_codes", "none"]
DEFAULT_ROTATION_DAYS = 180


def _fernet() -> Fernet:
    key = os.environ.get("VAULT_MASTER_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Credential Vault is not configured: add VAULT_MASTER_KEY to the backend environment (.env) and restart. "
                                                    "Generate one with: python3 -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError):
        raise HTTPException(status_code=503, detail="VAULT_MASTER_KEY is not a valid Fernet key")


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        raise HTTPException(status_code=500, detail="Stored secret cannot be decrypted with the current VAULT_MASTER_KEY")


class VaultCreate(BaseModel):
    service_name: str
    account_identifier: str
    password: str
    associated_phone: Optional[str] = ""
    two_fa_enabled: bool = False
    two_fa_method: str = "none"
    notes: Optional[str] = ""
    category: str = "other"
    owner: Optional[str] = ""
    url: Optional[str] = ""


class VaultUpdate(BaseModel):
    service_name: Optional[str] = None
    account_identifier: Optional[str] = None
    password: Optional[str] = None
    associated_phone: Optional[str] = None
    two_fa_enabled: Optional[bool] = None
    two_fa_method: Optional[str] = None
    notes: Optional[str] = None
    category: Optional[str] = None
    owner: Optional[str] = None
    url: Optional[str] = None


class VaultConfigIn(BaseModel):
    rotation_days: int


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(doc: Dict[str, Any], rotation_days: int) -> Dict[str, Any]:
    last_rot = doc.get("last_rotated")
    stale = True
    if last_rot:
        try:
            stale = datetime.fromisoformat(last_rot) < datetime.now(timezone.utc) - timedelta(days=rotation_days)
        except ValueError:
            stale = True
    return {
        "id": str(doc["_id"]),
        "service_name": doc.get("service_name"),
        "account_identifier": doc.get("account_identifier"),
        "associated_phone": doc.get("associated_phone", ""),
        "two_fa_enabled": bool(doc.get("two_fa_enabled")),
        "two_fa_method": doc.get("two_fa_method", "none"),
        "notes": doc.get("notes", ""),
        "category": doc.get("category", "other"),
        "owner": doc.get("owner", ""),
        "url": doc.get("url", ""),
        "last_updated": doc.get("last_updated"),
        "last_rotated": last_rot,
        "rotation_stale": stale,
        "view_count": sum(1 for a in doc.get("access_log", []) if a.get("action") == "reveal"),
        "last_viewed": next((a.get("timestamp") for a in reversed(doc.get("access_log", [])) if a.get("action") == "reveal"), None),
    }


def create_router(db, require_role, create_audit_log):
    router = APIRouter()

    async def _rotation_days() -> int:
        doc = await db.vault_config.find_one({"key": "defaults"}) or {}
        return int(doc.get("rotation_days", DEFAULT_ROTATION_DAYS))

    async def _get(vault_id: str) -> Dict[str, Any]:
        if not ObjectId.is_valid(vault_id):
            raise HTTPException(status_code=400, detail="Invalid credential id")
        doc = await db.credential_vault.find_one({"_id": ObjectId(vault_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Credential not found")
        return doc

    async def _audit(user: Dict[str, Any], action: str, entity_id: str, details: Dict[str, Any] | None):
        await create_audit_log(user["id"], user.get("name", ""), f"vault_{action}", "credential_vault", entity_id, None, details or {}, f"Credential vault {action}")

    async def _log(doc_id: ObjectId, user: Dict[str, Any], action: str, request: Request, details: Dict[str, Any] | None = None):
        entry = {"user_id": user["id"], "user_name": user.get("name"), "action": action, "timestamp": _now(),
                 "ip": request.client.host if request.client else None}
        await db.credential_vault.update_one({"_id": doc_id}, {"$push": {"access_log": entry}})
        await _audit(user, action, str(doc_id), details)

    @router.get("/vault")
    async def list_vault(request: Request, category: Optional[str] = None, search: Optional[str] = None):
        await require_role("admin")(request)
        q: Dict[str, Any] = {}
        if category and category != "all":
            q["category"] = category
        if search:
            q["$or"] = [{"service_name": {"$regex": search, "$options": "i"}}, {"account_identifier": {"$regex": search, "$options": "i"}}]
        days = await _rotation_days()
        return [_public(d, days) async for d in db.credential_vault.find(q).sort("service_name", 1)]

    @router.get("/vault/dashboard")
    async def vault_dashboard(request: Request):
        await require_role("admin")(request)
        days = await _rotation_days()
        items = [_public(d, days) async for d in db.credential_vault.find({})]
        return {
            "total": len(items),
            "rotation_days": days,
            "two_fa_disabled": [i for i in items if not i["two_fa_enabled"]],
            "rotation_overdue": [i for i in items if i["rotation_stale"]],
            "by_category": {c: sum(1 for i in items if i["category"] == c) for c in CATEGORIES},
            "encryption": {"scheme": "Fernet (AES-128-CBC + HMAC-SHA256)", "key_source": "VAULT_MASTER_KEY env",
                           "configured": bool(os.environ.get("VAULT_MASTER_KEY")),
                           "limitations": "No envelope encryption, no automatic key rotation, no HSM — rotate VAULT_MASTER_KEY manually by re-encrypting all records."},
        }

    @router.put("/vault/config")
    async def update_config(payload: VaultConfigIn, request: Request):
        user = await require_role("admin")(request)
        if payload.rotation_days < 1:
            raise HTTPException(status_code=400, detail="rotation_days must be at least 1")
        await db.vault_config.update_one({"key": "defaults"}, {"$set": {"rotation_days": payload.rotation_days, "updated_by": user["id"], "updated_at": _now()}}, upsert=True)
        return {"rotation_days": payload.rotation_days}

    @router.post("/vault")
    async def create_credential(payload: VaultCreate, request: Request):
        user = await require_role("admin")(request)
        if payload.category not in CATEGORIES:
            raise HTTPException(status_code=400, detail=f"category must be one of {CATEGORIES}")
        if payload.two_fa_method not in TWO_FA_METHODS:
            raise HTTPException(status_code=400, detail=f"two_fa_method must be one of {TWO_FA_METHODS}")
        if not payload.service_name.strip() or not payload.account_identifier.strip() or not payload.password:
            raise HTTPException(status_code=400, detail="service_name, account_identifier and password are required")
        doc = payload.dict()
        doc["password_encrypted"] = encrypt_secret(doc.pop("password"))
        doc.update({"created_by": user["id"], "created_at": _now(), "last_updated": _now(), "last_rotated": _now(), "access_log": []})
        res = await db.credential_vault.insert_one(doc)
        await _log(res.inserted_id, user, "create", request, {"service_name": payload.service_name})
        return _public(await _get(str(res.inserted_id)), await _rotation_days())

    @router.put("/vault/{vault_id}")
    async def update_credential(vault_id: str, payload: VaultUpdate, request: Request):
        user = await require_role("admin")(request)
        doc = await _get(vault_id)
        changes = {k: v for k, v in payload.dict().items() if v is not None}
        if "category" in changes and changes["category"] not in CATEGORIES:
            raise HTTPException(status_code=400, detail=f"category must be one of {CATEGORIES}")
        if "two_fa_method" in changes and changes["two_fa_method"] not in TWO_FA_METHODS:
            raise HTTPException(status_code=400, detail=f"two_fa_method must be one of {TWO_FA_METHODS}")
        rotated = False
        if "password" in changes:
            pw = changes.pop("password")
            if pw:
                changes["password_encrypted"] = encrypt_secret(pw)
                changes["last_rotated"] = _now()
                rotated = True
        changes["last_updated"] = _now()
        await db.credential_vault.update_one({"_id": doc["_id"]}, {"$set": changes})
        await _log(doc["_id"], user, "rotate" if rotated else "update", request, {"fields": [k for k in changes if k != "password_encrypted"]})
        return _public(await _get(vault_id), await _rotation_days())

    @router.delete("/vault/{vault_id}")
    async def delete_credential(vault_id: str, request: Request):
        user = await require_role("admin")(request)
        doc = await _get(vault_id)
        await _audit(user, "delete", vault_id, {"service_name": doc.get("service_name"), "account_identifier": doc.get("account_identifier")})
        await db.credential_vault.delete_one({"_id": doc["_id"]})
        return {"message": "Credential deleted"}

    @router.post("/vault/{vault_id}/reveal")
    async def reveal_credential(vault_id: str, request: Request):
        user = await require_role("admin")(request)
        doc = await _get(vault_id)
        plain = decrypt_secret(doc["password_encrypted"])
        await _log(doc["_id"], user, "reveal", request, {"service_name": doc.get("service_name")})
        return {"id": vault_id, "password": plain, "revealed_at": _now()}

    @router.get("/vault/{vault_id}/access-log")
    async def access_log(vault_id: str, request: Request):
        await require_role("admin")(request)
        doc = await _get(vault_id)
        return list(reversed(doc.get("access_log", [])))[:200]

    return router
