"""Iter 53 — Account security: TOTP 2FA (authenticator app, backup codes, enforced at login) and the admin-only
Credentials Management view (password age, forced reset, 2FA status). Built per the integration playbook:
pending secret until confirmed, bcrypt-hashed single-use backup codes, replay guard on the last TOTP step."""
from __future__ import annotations

import base64
import io
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import bcrypt
import pyotp
import qrcode
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

TOTP_ISSUER = "Sensoper ERP"
DEFAULT_ROTATION_DAYS = 90


class CodeIn(BaseModel):
    code: str


class DisableIn(BaseModel):
    password: str
    code: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class SecurityConfigIn(BaseModel):
    password_rotation_days: int


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(code: str) -> str:
    return bcrypt.hashpw(code.encode(), bcrypt.gensalt()).decode()


def _check(code: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(code.encode(), hashed.encode())
    except ValueError:
        return False


def password_age_days(user: Dict[str, Any]) -> Optional[int]:
    ref = user.get("password_changed_at") or user.get("created_at")
    if not ref:
        return None
    try:
        dt = datetime.fromisoformat(str(ref).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max((_now() - dt).days, 0)
    except ValueError:
        return None


def create_router(db, get_current_user, require_role, create_audit_log, verify_password, hash_password, issue_session):
    """issue_session(response, user) sets the normal access/refresh cookies and returns the login payload."""
    router = APIRouter()

    async def _cfg() -> Dict[str, Any]:
        doc = await db.security_config.find_one({"key": "defaults"}) or {}
        return {"password_rotation_days": int(doc.get("password_rotation_days", DEFAULT_ROTATION_DAYS))}

    def _verify_totp(user: Dict[str, Any], code: str) -> int:
        totp = pyotp.TOTP(user["totp_secret"], interval=30)
        step = totp.timecode(_now())
        if user.get("totp_last_timecode") is not None and step <= int(user["totp_last_timecode"]):
            raise HTTPException(status_code=401, detail="That code was already used — wait for the next one")
        if not totp.verify(code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid authenticator code")
        return step

    async def _consume_second_factor(user: Dict[str, Any], code: str) -> str:
        code = code.strip().replace(" ", "")
        if code.isdigit() and len(code) == 6:
            step = _verify_totp(user, code)
            await db.users.update_one({"_id": user["_id"]}, {"$set": {"totp_last_timecode": step}})
            return "totp"
        matched = next((h for h in user.get("backup_code_hashes", []) if _check(code, h)), None)
        if not matched:
            raise HTTPException(status_code=401, detail="Invalid authenticator or backup code")
        await db.users.update_one({"_id": user["_id"]}, {"$pull": {"backup_code_hashes": matched}})
        return "backup_code"

    # ── login second step ──
    @router.post("/auth/login/2fa")
    async def finish_login(body: CodeIn, request: Request, response: Response):
        token = request.cookies.get("preauth_token")
        if not token:
            raise HTTPException(status_code=401, detail="Second-step session expired — sign in again")
        pre = await db.preauth_tokens.find_one({"token": token})
        if not pre or pre["expires_at"] < _now().isoformat():
            raise HTTPException(status_code=401, detail="Second-step session expired — sign in again")
        user = await db.users.find_one({"_id": ObjectId(pre["user_id"])})
        if not user or not user.get("totp_enabled"):
            raise HTTPException(status_code=401, detail="Invalid authentication state")
        attempts = int(pre.get("attempts", 0))
        if attempts >= 5:
            raise HTTPException(status_code=429, detail="Too many attempts — sign in again")
        try:
            method = await _consume_second_factor(user, body.code)
        except HTTPException:
            await db.preauth_tokens.update_one({"token": token}, {"$inc": {"attempts": 1}})
            raise
        await db.preauth_tokens.delete_one({"token": token})
        response.delete_cookie("preauth_token", path="/")
        await create_audit_log(str(user["_id"]), user["name"], "login_2fa", "user", str(user["_id"]), None, {"method": method})
        return issue_session(response, user)

    # ── enrolment ──
    @router.post("/auth/2fa/setup")
    async def setup_2fa(request: Request):
        me = await get_current_user(request)
        user = await db.users.find_one({"_id": ObjectId(me["id"])})
        if user.get("totp_enabled"):
            raise HTTPException(status_code=409, detail="2FA is already enabled")
        secret = pyotp.random_base32()
        uri = pyotp.TOTP(secret).provisioning_uri(name=user["email"], issuer_name=TOTP_ISSUER)
        buf = io.BytesIO()
        qrcode.make(uri).save(buf, format="PNG")
        codes = [secrets.token_hex(4) for _ in range(8)]
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"totp_pending_secret": secret, "totp_pending_backup_hashes": [_hash(c) for c in codes]}})
        return {"qr_code": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(), "manual_key": secret, "backup_codes": codes, "issuer": TOTP_ISSUER}

    @router.post("/auth/2fa/enable")
    async def enable_2fa(body: CodeIn, request: Request):
        me = await get_current_user(request)
        user = await db.users.find_one({"_id": ObjectId(me["id"])})
        pending = user.get("totp_pending_secret")
        if not pending:
            raise HTTPException(status_code=400, detail="Start the 2FA setup first")
        if not pyotp.TOTP(pending).verify(body.code.strip().replace(" ", ""), valid_window=1):
            raise HTTPException(status_code=400, detail="Invalid authenticator code — scan the QR again and retry")
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"totp_enabled": True, "totp_secret": pending, "backup_code_hashes": user.get("totp_pending_backup_hashes", []),
                                                                  "totp_last_timecode": None, "totp_enabled_at": _now().isoformat()},
                                                         "$unset": {"totp_pending_secret": "", "totp_pending_backup_hashes": ""}})
        await create_audit_log(me["id"], me["name"], "2fa_enabled", "user", me["id"])
        return {"enabled": True}

    @router.post("/auth/2fa/disable")
    async def disable_2fa(body: DisableIn, request: Request):
        me = await get_current_user(request)
        user = await db.users.find_one({"_id": ObjectId(me["id"])})
        if not user.get("totp_enabled"):
            raise HTTPException(status_code=400, detail="2FA is not enabled")
        if not verify_password(body.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid password")
        await _consume_second_factor(user, body.code)
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"totp_enabled": False}, "$unset": {"totp_secret": "", "totp_last_timecode": "", "backup_code_hashes": ""}})
        await create_audit_log(me["id"], me["name"], "2fa_disabled", "user", me["id"])
        return {"enabled": False}

    @router.get("/auth/2fa/status")
    async def my_2fa_status(request: Request):
        me = await get_current_user(request)
        user = await db.users.find_one({"_id": ObjectId(me["id"])}, {"totp_enabled": 1, "backup_code_hashes": 1, "password_changed_at": 1, "created_at": 1, "must_reset_password": 1})
        cfg = await _cfg()
        return {"enabled": bool(user.get("totp_enabled")), "backup_codes_left": len(user.get("backup_code_hashes") or []),
                "password_age_days": password_age_days(user), "rotation_days": cfg["password_rotation_days"], "must_reset_password": bool(user.get("must_reset_password"))}

    # ── password change (self) ──
    @router.post("/auth/change-password")
    async def change_password(body: ChangePasswordIn, request: Request):
        me = await get_current_user(request)
        user = await db.users.find_one({"_id": ObjectId(me["id"])})
        if not verify_password(body.current_password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        if len(body.new_password) < 8:
            raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
        if verify_password(body.new_password, user["password_hash"]):
            raise HTTPException(status_code=400, detail="New password must differ from the current one")
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"password_hash": hash_password(body.new_password), "password_changed_at": _now().isoformat(), "must_reset_password": False}})
        await create_audit_log(me["id"], me["name"], "password_changed", "user", me["id"])
        return {"message": "Password changed"}

    # ── admin credentials management ──
    @router.get("/security/credentials")
    async def credentials_overview(request: Request):
        await require_role("admin")(request)
        cfg = await _cfg()
        rows: List[Dict[str, Any]] = []
        async for u in db.users.find({}, {"password_hash": 0, "totp_secret": 0, "totp_pending_secret": 0, "totp_pending_backup_hashes": 0}):
            age = password_age_days(u)
            rows.append({"id": str(u["_id"]), "name": u.get("name"), "email": u.get("email"), "role": u.get("role"), "active": u.get("active", True),
                         "password_changed_at": u.get("password_changed_at"), "password_age_days": age,
                         "password_stale": age is not None and age > cfg["password_rotation_days"],
                         "password_never_changed": not u.get("password_changed_at"),
                         "totp_enabled": bool(u.get("totp_enabled")), "totp_enabled_at": u.get("totp_enabled_at"),
                         "backup_codes_left": len(u.get("backup_code_hashes") or []), "must_reset_password": bool(u.get("must_reset_password")),
                         "last_login_at": u.get("last_login_at")})
        rows.sort(key=lambda r: (not r["password_stale"], -(r["password_age_days"] or 0)))
        return {"rows": rows, "config": cfg, "summary": {"users": len(rows), "with_2fa": sum(1 for r in rows if r["totp_enabled"]),
                                                          "stale_passwords": sum(1 for r in rows if r["password_stale"]), "reset_pending": sum(1 for r in rows if r["must_reset_password"])}}

    @router.put("/security/config")
    async def update_security_config(body: SecurityConfigIn, request: Request):
        me = await require_role("admin")(request)
        if not 7 <= body.password_rotation_days <= 3650:
            raise HTTPException(status_code=400, detail="Rotation threshold must be between 7 and 3650 days")
        await db.security_config.update_one({"key": "defaults"}, {"$set": {"password_rotation_days": body.password_rotation_days}}, upsert=True)
        await create_audit_log(me["id"], me["name"], "security_config_updated", "security_config", "defaults", None, {"password_rotation_days": body.password_rotation_days})
        return await _cfg()

    @router.post("/security/credentials/{user_id}/require-reset")
    async def require_reset(user_id: str, request: Request):
        me = await require_role("admin")(request)
        if not ObjectId.is_valid(user_id) or not await db.users.find_one({"_id": ObjectId(user_id)}):
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"must_reset_password": True}})
        await create_audit_log(me["id"], me["name"], "password_reset_required", "user", user_id)
        return {"must_reset_password": True}

    @router.post("/security/credentials/{user_id}/disable-2fa")
    async def admin_disable_2fa(user_id: str, request: Request):
        """Admin recovery when a user loses their phone AND backup codes — audit logged."""
        me = await require_role("admin")(request)
        if not ObjectId.is_valid(user_id):
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"totp_enabled": False}, "$unset": {"totp_secret": "", "totp_last_timecode": "", "backup_code_hashes": ""}})
        await create_audit_log(me["id"], me["name"], "2fa_disabled_by_admin", "user", user_id)
        return {"enabled": False}

    return router


async def start_preauth(db, response: Response, user: Dict[str, Any]) -> Dict[str, Any]:
    """Called by /auth/login when the account has 2FA: short-lived preauth cookie instead of a session."""
    token = secrets.token_urlsafe(32)
    await db.preauth_tokens.insert_one({"token": token, "user_id": str(user["_id"]), "attempts": 0, "expires_at": (_now() + timedelta(minutes=5)).isoformat()})
    response.set_cookie(key="preauth_token", value=token, httponly=True, secure=False, samesite="lax", max_age=300, path="/")
    return {"requires_2fa": True, "email": user["email"]}
