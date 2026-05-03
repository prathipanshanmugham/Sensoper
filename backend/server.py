from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Form
from fastapi.responses import JSONResponse, HTMLResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal, Any
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
import secrets
import json
import base64
import requests as http_requests

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Configuration
JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"

# Object Storage Configuration
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "sensoper-solar"
storage_key = None

def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    resp = http_requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = http_requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120
    )
    resp.raise_for_status()
    return resp.json()

def get_object(path: str):
    key = init_storage()
    resp = http_requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

# Create the main app
app = FastAPI(title="Sensoper Solar Estimator API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# ================== MODELS ==================

class UserBase(BaseModel):
    email: EmailStr
    name: str
    role: Literal["admin", "manager", "staff"] = "staff"
    phone: Optional[str] = None

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Literal["admin", "manager", "staff"] = "staff"
    phone: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    phone: Optional[str] = None
    created_at: str

class CustomerDetails(BaseModel):
    name: str
    phone: str
    address: str
    email: Optional[str] = None

class LocationDetails(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None
    site_location_words: Optional[str] = None

class ElectricalDetails(BaseModel):
    sanction_load_kw: float
    connected_load_kw: float
    monthly_consumption_units: float
    eb_tariff: float
    service_type: Optional[str] = None

class SolarSystemInputs(BaseModel):
    system_type: str = "on-grid"
    inverter_model: Optional[str] = None
    panel_wattage: Optional[int] = 540
    battery_required: bool = False
    battery_capacity_ah: Optional[int] = None

class MountingStructure(BaseModel):
    roof_type: str  # Free text field (e.g., "RCC Flat Roof", "Metal Sheet", "Terrace with slope")
    tilt_angle: int
    structure_type: str

class AdditionalInputs(BaseModel):
    cable_length_meters: float
    inverter_to_panel_distance: float
    installation_complexity: str = "simple"
    shadow_analysis_notes: Optional[str] = None

class SelectedItem(BaseModel):
    inventory_item_id: Optional[str] = None
    name: str
    category: str
    unit_price: float
    gst_percentage: float = 18.0
    quantity: int = 1
    margin_percentage: float = 0

class ManualCost(BaseModel):
    description: str
    amount: float

class ProjectCreate(BaseModel):
    customer: CustomerDetails
    location: LocationDetails
    electrical: ElectricalDetails
    solar_system: SolarSystemInputs
    mounting: MountingStructure
    additional: AdditionalInputs
    selected_items: List[SelectedItem] = []
    manual_costs: List[ManualCost] = []
    site_images: List[str] = []
    drive_folder_name: Optional[str] = None
    drive_folder_link: Optional[str] = None
    drive_folder_id: Optional[str] = None
    site_measurements: Optional[dict] = None
    custom_fields: Optional[dict] = None

class ProjectUpdate(BaseModel):
    customer: Optional[CustomerDetails] = None
    location: Optional[LocationDetails] = None
    electrical: Optional[ElectricalDetails] = None
    solar_system: Optional[SolarSystemInputs] = None
    mounting: Optional[MountingStructure] = None
    additional: Optional[AdditionalInputs] = None
    selected_items: Optional[List[SelectedItem]] = None
    manual_costs: Optional[List[ManualCost]] = None
    site_images: Optional[List[str]] = None
    drive_folder_name: Optional[str] = None
    drive_folder_link: Optional[str] = None
    drive_folder_id: Optional[str] = None
    site_measurements: Optional[dict] = None
    custom_fields: Optional[dict] = None
    status: Optional[Literal["draft", "submitted", "approved", "rejected", "completed", "deletion_requested"]] = None

class AIRecommendationRequest(BaseModel):
    monthly_consumption_units: float
    sanction_load_kw: float
    roof_type: str
    budget_range: Optional[str] = None

# ================== NEW MODELS FOR ENTERPRISE FEATURES ==================

class TermsConditionsCreate(BaseModel):
    title: str
    content: str  # HTML content
    language: str = "en"

class TermsConditionsUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    is_active: Optional[bool] = None
    language: Optional[str] = None

class InventoryItemCreate(BaseModel):
    name: str
    sku_code: str
    category: str
    zone: Optional[str] = None
    aisle: Optional[str] = None
    shelf: Optional[str] = None
    rack: Optional[str] = None
    bin_location: Optional[str] = None
    quantity: int
    unit_price: float
    supplier: Optional[str] = None
    gst_percentage: float = 18.0
    reorder_level: int = 10
    image_url: Optional[str] = None

class InventoryItemUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    zone: Optional[str] = None
    aisle: Optional[str] = None
    shelf: Optional[str] = None
    rack: Optional[str] = None
    bin_location: Optional[str] = None
    quantity: Optional[int] = None
    unit_price: Optional[float] = None
    supplier: Optional[str] = None
    gst_percentage: Optional[float] = None
    reorder_level: Optional[int] = None
    image_url: Optional[str] = None

class InventoryCategoryCreate(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None

class DeletionRequestCreate(BaseModel):
    reason: str

# ================== COMPANY PROFILE MODELS ==================

class BankDetails(BaseModel):
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    ifsc_code: Optional[str] = None
    bank_name: Optional[str] = None
    branch: Optional[str] = None
    upi_id: Optional[str] = None

class CompanyProfileCreate(BaseModel):
    company_name: str
    tagline: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: str = "#4ADE40"
    secondary_color: str = "#2D9BF0"
    address: str
    phone: str
    email: EmailStr
    website: Optional[str] = None
    gst_number: Optional[str] = None
    pan_number: Optional[str] = None
    bank_details: Optional[BankDetails] = None
    authorized_signatory: Optional[str] = None
    designation: Optional[str] = None

class CompanyProfileUpdate(BaseModel):
    company_name: Optional[str] = None
    tagline: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    website: Optional[str] = None
    gst_number: Optional[str] = None
    pan_number: Optional[str] = None
    bank_details: Optional[BankDetails] = None
    authorized_signatory: Optional[str] = None
    designation: Optional[str] = None
    is_active: Optional[bool] = None

# ================== FORM TABS (Dynamic Form Engine) MODELS ==================

class FormFieldDefinition(BaseModel):
    name: str
    label: str
    type: str  # text, number, select, textarea, checkbox, date
    required: bool = False
    placeholder: str = ""
    options: List[str] = []

class FormTabCreate(BaseModel):
    name: str
    fields: List[FormFieldDefinition]
    roles_visible: List[str] = ["admin", "manager", "staff"]

class FormTabUpdate(BaseModel):
    name: Optional[str] = None
    fields: Optional[List[FormFieldDefinition]] = None
    roles_visible: Optional[List[str]] = None
    active: Optional[bool] = None

# ================== DAILY UPDATE & PAYMENT MODELS ==================

class DailyUpdateCreate(BaseModel):
    project_id: str
    update_type: str  # progress, material, payment, installation, om
    data: dict

class DailyUpdateUpdate(BaseModel):
    data: Optional[dict] = None
    update_type: Optional[str] = None

class PaymentCreate(BaseModel):
    project_id: str
    amount: float
    payment_method: str  # cash, cheque, upi, bank_transfer, emi
    notes: str = ""

class MaterialUsageCreate(BaseModel):
    project_id: str
    item_name: str
    estimated_qty: float
    actual_qty: float
    wastage: float = 0
    notes: str = ""

# ================== HELPER FUNCTIONS ==================

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=60),
        "type": "access"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "phone": user.get("phone"),
            "created_at": user["created_at"]
        }
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_role(*roles):
    async def role_checker(request: Request):
        user = await get_current_user(request)
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return role_checker

def serialize_for_json(obj):
    """Helper to serialize objects for JSON, handling ObjectId"""
    if obj is None:
        return None
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, dict):
        return {k: serialize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [serialize_for_json(item) for item in obj]
    return obj

async def create_audit_log(user_id: str, user_name: str, action_type: str, entity_type: str, entity_id: str, old_data: Any = None, new_data: Any = None, details: str = None):
    """Create an audit log entry"""
    log_entry = {
        "user_id": user_id,
        "user_name": user_name,
        "action_type": action_type,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "old_data": json.dumps(serialize_for_json(old_data)) if old_data else None,
        "new_data": json.dumps(serialize_for_json(new_data)) if new_data else None,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.audit_logs.insert_one(log_entry)

# ================== DYNAMIC PERMISSIONS ==================

DEFAULT_PERMISSIONS = {
    "admin": {
        "can_create_project": True, "can_edit_project": True, "can_delete_project": True,
        "can_request_delete": True, "can_approve_deletion": True,
        "can_approve_quotation": True, "can_set_margin": True, "can_approve_margin": True,
        "can_edit_inventory": True, "can_approve_inventory": True,
        "can_manage_users": True, "can_change_user_access": True,
        "can_view_reports": True, "can_view_audit_logs": True,
        "can_manage_company": True, "can_manage_terms": True
    },
    "manager": {
        "can_create_project": True, "can_edit_project": True, "can_delete_project": False,
        "can_request_delete": True, "can_approve_deletion": True,
        "can_approve_quotation": True, "can_set_margin": True, "can_approve_margin": True,
        "can_edit_inventory": True, "can_approve_inventory": True,
        "can_manage_users": False, "can_change_user_access": False,
        "can_view_reports": True, "can_view_audit_logs": True,
        "can_manage_company": False, "can_manage_terms": True
    },
    "staff": {
        "can_create_project": True, "can_edit_project": True, "can_delete_project": False,
        "can_request_delete": True, "can_approve_deletion": False,
        "can_approve_quotation": False, "can_set_margin": False, "can_approve_margin": False,
        "can_edit_inventory": False, "can_approve_inventory": False,
        "can_manage_users": False, "can_change_user_access": False,
        "can_view_reports": False, "can_view_audit_logs": False,
        "can_manage_company": False, "can_manage_terms": False
    }
}

async def get_permissions(role: str) -> dict:
    """Get permissions for a role from DB, falling back to defaults"""
    perm = await db.role_permissions.find_one({"role_name": role})
    if perm:
        return perm.get("permissions", DEFAULT_PERMISSIONS.get(role, {}))
    return DEFAULT_PERMISSIONS.get(role, {})

async def check_permission(user: dict, permission: str) -> bool:
    """Check if a user has a specific permission"""
    if user["role"] == "admin":
        admin_perms = await get_permissions("admin")
        return admin_perms.get(permission, True)
    perms = await get_permissions(user["role"])
    return perms.get(permission, False)

async def require_permission(request: Request, permission: str) -> dict:
    """Middleware-like function to check permission"""
    user = await get_current_user(request)
    has_perm = await check_permission(user, permission)
    if not has_perm:
        raise HTTPException(status_code=403, detail=f"Permission denied: {permission}")
    return user

def calculate_cost_estimation(selected_items: list, manual_costs: list) -> dict:
    """Calculate cost estimation from selected inventory items and manual costs with per-item margins"""
    items_breakdown = []
    total_items_cost = 0
    total_gst = 0
    total_margin = 0

    for item in selected_items:
        item_cost = item["unit_price"] * item["quantity"]
        item_margin_pct = item.get("margin_percentage", 0)
        item_margin = item_cost * (item_margin_pct / 100)
        item_gst = item_cost * (item["gst_percentage"] / 100)
        total_items_cost += item_cost
        total_gst += item_gst
        total_margin += item_margin
        items_breakdown.append({
            "name": item["name"],
            "category": item["category"],
            "unit_price": item["unit_price"],
            "quantity": item["quantity"],
            "gst_percentage": item["gst_percentage"],
            "margin_percentage": item_margin_pct,
            "amount": round(item_cost, 2),
            "gst_amount": round(item_gst, 2),
            "margin_amount": round(item_margin, 2)
        })

    manual_total = sum(c["amount"] for c in manual_costs)
    subtotal = total_items_cost + manual_total
    total_cost = subtotal + total_margin + total_gst

    return {
        "items_breakdown": items_breakdown,
        "manual_costs": [{"description": c["description"], "amount": round(c["amount"], 2)} for c in manual_costs],
        "items_subtotal": round(total_items_cost, 2),
        "manual_subtotal": round(manual_total, 2),
        "subtotal": round(subtotal, 2),
        "total_margin": round(total_margin, 2),
        "total_gst": round(total_gst, 2),
        "total_cost": round(total_cost, 2)
    }

# ================== AUTH ENDPOINTS ==================

@api_router.post("/auth/register")
async def register(user_data: UserCreate, response: Response):
    email = user_data.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed = hash_password(user_data.password)
    user_doc = {
        "email": email,
        "password_hash": hashed,
        "name": user_data.name,
        "role": user_data.role,
        "phone": user_data.phone,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    access_token = create_access_token(user_id, email, user_data.role)
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    
    return {
        "id": user_id,
        "email": email,
        "name": user_data.name,
        "role": user_data.role,
        "phone": user_data.phone,
        "created_at": user_doc["created_at"]
    }

@api_router.post("/auth/login")
async def login(credentials: UserLogin, response: Response, request: Request):
    email = credentials.email.lower()
    
    # Brute force protection
    identifier = f"{request.client.host}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= 5:
        lockout_time = attempt.get("locked_until")
        if lockout_time and datetime.fromisoformat(lockout_time) > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
        else:
            await db.login_attempts.delete_one({"identifier": identifier})
    
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(credentials.password, user["password_hash"]):
        # Increment failed attempts
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {
                "$inc": {"count": 1},
                "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}
            },
            upsert=True
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Clear failed attempts on success
    await db.login_attempts.delete_one({"identifier": identifier})
    
    user_id = str(user["_id"])
    access_token = create_access_token(user_id, email, user["role"])
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    
    return {
        "id": user_id,
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "phone": user.get("phone"),
        "created_at": user["created_at"]
    }

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out successfully"}

@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    return user

@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        
        user_id = str(user["_id"])
        access_token = create_access_token(user_id, user["email"], user["role"])
        
        response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
        
        return {"message": "Token refreshed"}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

# ================== USER MANAGEMENT (Admin Only) ==================

@api_router.get("/users")
async def get_users(request: Request):
    user = await require_role("admin")(request)
    users = await db.users.find({}, {"password_hash": 0}).to_list(1000)
    return [
        {
            "id": str(u["_id"]),
            "email": u["email"],
            "name": u["name"],
            "role": u["role"],
            "phone": u.get("phone"),
            "created_at": u["created_at"]
        }
        for u in users
    ]

@api_router.post("/users")
async def create_user(user_data: UserCreate, request: Request):
    current_user = await require_role("admin")(request)
    
    email = user_data.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed = hash_password(user_data.password)
    user_doc = {
        "email": email,
        "password_hash": hashed,
        "name": user_data.name,
        "role": user_data.role,
        "phone": user_data.phone,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = await db.users.insert_one(user_doc)
    
    await create_audit_log(
        current_user["id"], current_user["name"], "create", "user", 
        str(result.inserted_id), None, {"email": email, "role": user_data.role}
    )
    
    return {
        "id": str(result.inserted_id),
        "email": email,
        "name": user_data.name,
        "role": user_data.role,
        "phone": user_data.phone,
        "created_at": user_doc["created_at"]
    }

@api_router.put("/users/{user_id}")
async def update_user(user_id: str, request: Request):
    current_user = await require_role("admin")(request)
    
    body = await request.json()
    update_data = {}
    
    if "name" in body:
        update_data["name"] = body["name"]
    if "role" in body:
        update_data["role"] = body["role"]
    if "phone" in body:
        update_data["phone"] = body["phone"]
    if "password" in body and body["password"]:
        update_data["password_hash"] = hash_password(body["password"])
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    await create_audit_log(
        current_user["id"], current_user["name"], "update", "user", 
        user_id, None, update_data
    )
    
    return {"message": "User updated successfully"}

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    current_user = await require_role("admin")(request)
    
    if current_user["id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    result = await db.users.delete_one({"_id": ObjectId(user_id)})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    await create_audit_log(
        current_user["id"], current_user["name"], "delete", "user", user_id
    )
    
    return {"message": "User deleted successfully"}

# ================== COMPANY PROFILE ==================

@api_router.get("/company")
async def get_company_profiles(request: Request):
    """Get all company profiles"""
    await get_current_user(request)
    
    profiles = await db.company_profiles.find().to_list(100)
    return [
        {
            "id": str(p["_id"]),
            "company_name": p["company_name"],
            "tagline": p.get("tagline"),
            "logo_url": p.get("logo_url"),
            "primary_color": p.get("primary_color", "#4ADE40"),
            "secondary_color": p.get("secondary_color", "#2D9BF0"),
            "address": p["address"],
            "phone": p["phone"],
            "email": p["email"],
            "website": p.get("website"),
            "gst_number": p.get("gst_number"),
            "pan_number": p.get("pan_number"),
            "bank_details": p.get("bank_details"),
            "authorized_signatory": p.get("authorized_signatory"),
            "designation": p.get("designation"),
            "is_active": p.get("is_active", False),
            "created_at": p["created_at"]
        }
        for p in profiles
    ]

@api_router.get("/company/active")
async def get_active_company():
    """Get the active company profile (for PDF generation, public access)"""
    profile = await db.company_profiles.find_one({"is_active": True})
    
    if not profile:
        # Return default profile if none exists
        return {
            "id": None,
            "company_name": "Sensoper Controls & Renewables",
            "tagline": "Solar Solutions Provider",
            "logo_url": "https://customer-assets.emergentagent.com/job_8c20414a-b147-464e-9c68-aaa2fa40fdbf/artifacts/q52gayft_snspr.png",
            "primary_color": "#4ADE40",
            "secondary_color": "#2D9BF0",
            "address": "Tamil Nadu, India",
            "phone": "+91 XXXXX XXXXX",
            "email": "info@sensoper.com",
            "website": "www.sensoper.com",
            "gst_number": None,
            "pan_number": None,
            "bank_details": None,
            "authorized_signatory": None,
            "designation": None
        }
    
    return {
        "id": str(profile["_id"]),
        "company_name": profile["company_name"],
        "tagline": profile.get("tagline"),
        "logo_url": profile.get("logo_url"),
        "primary_color": profile.get("primary_color", "#4ADE40"),
        "secondary_color": profile.get("secondary_color", "#2D9BF0"),
        "address": profile["address"],
        "phone": profile["phone"],
        "email": profile["email"],
        "website": profile.get("website"),
        "gst_number": profile.get("gst_number"),
        "pan_number": profile.get("pan_number"),
        "bank_details": profile.get("bank_details"),
        "authorized_signatory": profile.get("authorized_signatory"),
        "designation": profile.get("designation")
    }

@api_router.post("/company")
async def create_company_profile(profile: CompanyProfileCreate, request: Request):
    """Create a new company profile"""
    current_user = await require_role("admin")(request)
    
    profile_doc = {
        "company_name": profile.company_name,
        "tagline": profile.tagline,
        "logo_url": profile.logo_url,
        "primary_color": profile.primary_color,
        "secondary_color": profile.secondary_color,
        "address": profile.address,
        "phone": profile.phone,
        "email": profile.email,
        "website": profile.website,
        "gst_number": profile.gst_number,
        "pan_number": profile.pan_number,
        "bank_details": profile.bank_details.model_dump() if profile.bank_details else None,
        "authorized_signatory": profile.authorized_signatory,
        "designation": profile.designation,
        "is_active": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = await db.company_profiles.insert_one(profile_doc)
    
    await create_audit_log(
        current_user["id"], current_user["name"], "create", "company_profile",
        str(result.inserted_id), None, {"company_name": profile.company_name}
    )
    
    return {"id": str(result.inserted_id), "message": "Company profile created successfully"}

@api_router.put("/company/{profile_id}")
async def update_company_profile(profile_id: str, updates: CompanyProfileUpdate, request: Request):
    """Update a company profile"""
    current_user = await require_role("admin")(request)
    
    profile = await db.company_profiles.find_one({"_id": ObjectId(profile_id)})
    if not profile:
        raise HTTPException(status_code=404, detail="Company profile not found")
    
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    
    if updates.company_name is not None:
        update_data["company_name"] = updates.company_name
    if updates.tagline is not None:
        update_data["tagline"] = updates.tagline
    if updates.logo_url is not None:
        update_data["logo_url"] = updates.logo_url
    if updates.primary_color is not None:
        update_data["primary_color"] = updates.primary_color
    if updates.secondary_color is not None:
        update_data["secondary_color"] = updates.secondary_color
    if updates.address is not None:
        update_data["address"] = updates.address
    if updates.phone is not None:
        update_data["phone"] = updates.phone
    if updates.email is not None:
        update_data["email"] = updates.email
    if updates.website is not None:
        update_data["website"] = updates.website
    if updates.gst_number is not None:
        update_data["gst_number"] = updates.gst_number
    if updates.pan_number is not None:
        update_data["pan_number"] = updates.pan_number
    if updates.bank_details is not None:
        update_data["bank_details"] = updates.bank_details.model_dump()
    if updates.authorized_signatory is not None:
        update_data["authorized_signatory"] = updates.authorized_signatory
    if updates.designation is not None:
        update_data["designation"] = updates.designation
    
    # Handle activation
    if updates.is_active is True:
        # Deactivate all other profiles
        await db.company_profiles.update_many(
            {"_id": {"$ne": ObjectId(profile_id)}},
            {"$set": {"is_active": False}}
        )
        update_data["is_active"] = True
    elif updates.is_active is False:
        update_data["is_active"] = False
    
    await db.company_profiles.update_one(
        {"_id": ObjectId(profile_id)},
        {"$set": update_data}
    )
    
    await create_audit_log(
        current_user["id"], current_user["name"], "update", "company_profile",
        profile_id, None, update_data
    )
    
    return {"message": "Company profile updated successfully"}

@api_router.delete("/company/{profile_id}")
async def delete_company_profile(profile_id: str, request: Request):
    """Delete a company profile"""
    current_user = await require_role("admin")(request)
    
    profile = await db.company_profiles.find_one({"_id": ObjectId(profile_id)})
    if not profile:
        raise HTTPException(status_code=404, detail="Company profile not found")
    
    if profile.get("is_active"):
        raise HTTPException(status_code=400, detail="Cannot delete active profile")
    
    await db.company_profiles.delete_one({"_id": ObjectId(profile_id)})
    
    await create_audit_log(
        current_user["id"], current_user["name"], "delete", "company_profile", profile_id
    )
    
    return {"message": "Company profile deleted successfully"}

@api_router.post("/company/upload-logo")
async def upload_company_logo(request: Request, file: UploadFile = File(...)):
    """Upload a logo image and return a base64 data URL"""
    current_user = await require_role("admin")(request)
    
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    
    contents = await file.read()
    if len(contents) > 2 * 1024 * 1024:  # 2MB limit
        raise HTTPException(status_code=400, detail="File size must be under 2MB")
    
    import base64
    b64 = base64.b64encode(contents).decode("utf-8")
    data_url = f"data:{file.content_type};base64,{b64}"
    
    return {"logo_url": data_url}

# ================== TERMS & CONDITIONS ==================

@api_router.get("/terms")
async def get_all_terms(request: Request):
    await get_current_user(request)
    
    terms = await db.terms_conditions.find().sort("version", -1).to_list(100)
    return [
        {
            "id": str(t["_id"]),
            "title": t["title"],
            "content": t["content"],
            "version": t["version"],
            "is_active": t.get("is_active", False),
            "language": t.get("language", "en"),
            "created_by": t.get("created_by"),
            "created_by_name": t.get("created_by_name"),
            "created_at": t["created_at"],
            "updated_at": t.get("updated_at")
        }
        for t in terms
    ]

@api_router.get("/terms/active")
async def get_active_terms(language: str = "en"):
    """Get the active terms & conditions for PDF generation"""
    terms = await db.terms_conditions.find_one({"is_active": True, "language": language})
    if not terms:
        # Return default terms if none set
        return {
            "id": None,
            "title": "Standard Terms & Conditions",
            "content": """<ol>
<li>This quotation is valid for 30 days from the date of issue.</li>
<li>50% advance payment required to confirm the order.</li>
<li>Balance payment due upon installation completion.</li>
<li>Installation timeline: 7-14 working days after material delivery.</li>
<li>5-year warranty on installation workmanship.</li>
<li>Panel warranty as per manufacturer terms (typically 25 years).</li>
<li>Inverter warranty as per manufacturer terms.</li>
<li>All prices are subject to change without prior notice.</li>
</ol>""",
            "version": 0
        }
    return {
        "id": str(terms["_id"]),
        "title": terms["title"],
        "content": terms["content"],
        "version": terms["version"]
    }

@api_router.post("/terms")
async def create_terms(terms_data: TermsConditionsCreate, request: Request):
    current_user = await require_role("admin", "manager")(request)
    
    # Get the next version number
    latest = await db.terms_conditions.find_one(
        {"language": terms_data.language}, 
        sort=[("version", -1)]
    )
    next_version = (latest["version"] + 1) if latest else 1
    
    terms_doc = {
        "title": terms_data.title,
        "content": terms_data.content,
        "version": next_version,
        "is_active": False,
        "language": terms_data.language,
        "created_by": current_user["id"],
        "created_by_name": current_user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = await db.terms_conditions.insert_one(terms_doc)
    
    await create_audit_log(
        current_user["id"], current_user["name"], "create", "terms_conditions",
        str(result.inserted_id), None, {"title": terms_data.title, "version": next_version}
    )
    
    return {
        "id": str(result.inserted_id),
        "version": next_version,
        "message": "Terms created successfully"
    }

@api_router.put("/terms/{terms_id}")
async def update_terms(terms_id: str, updates: TermsConditionsUpdate, request: Request):
    current_user = await require_role("admin", "manager")(request)
    
    terms = await db.terms_conditions.find_one({"_id": ObjectId(terms_id)})
    if not terms:
        raise HTTPException(status_code=404, detail="Terms not found")
    
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    
    if updates.title is not None:
        update_data["title"] = updates.title
    if updates.content is not None:
        update_data["content"] = updates.content
    if updates.language is not None:
        update_data["language"] = updates.language
    
    # Handle activation
    if updates.is_active is True:
        # Deactivate all other terms for this language
        lang = updates.language or terms.get("language", "en")
        await db.terms_conditions.update_many(
            {"language": lang, "_id": {"$ne": ObjectId(terms_id)}},
            {"$set": {"is_active": False}}
        )
        update_data["is_active"] = True
    elif updates.is_active is False:
        update_data["is_active"] = False
    
    await db.terms_conditions.update_one(
        {"_id": ObjectId(terms_id)},
        {"$set": update_data}
    )
    
    await create_audit_log(
        current_user["id"], current_user["name"], "update", "terms_conditions",
        terms_id, {"is_active": terms.get("is_active")}, update_data
    )
    
    return {"message": "Terms updated successfully"}

@api_router.delete("/terms/{terms_id}")
async def delete_terms(terms_id: str, request: Request):
    current_user = await require_role("admin")(request)
    
    terms = await db.terms_conditions.find_one({"_id": ObjectId(terms_id)})
    if not terms:
        raise HTTPException(status_code=404, detail="Terms not found")
    
    if terms.get("is_active"):
        raise HTTPException(status_code=400, detail="Cannot delete active terms")
    
    await db.terms_conditions.delete_one({"_id": ObjectId(terms_id)})
    
    await create_audit_log(
        current_user["id"], current_user["name"], "delete", "terms_conditions", terms_id
    )
    
    return {"message": "Terms deleted successfully"}

# ================== GOOGLE DRIVE SETTINGS ==================

@api_router.get("/drive/settings")
async def get_drive_settings(request: Request):
    await get_current_user(request)
    settings = await db.drive_settings.find_one({}, {"_id": 0})
    if not settings:
        return {"folder_name": "", "folder_link": ""}
    return {"folder_name": settings.get("folder_name", ""), "folder_link": settings.get("folder_link", "")}

@api_router.put("/drive/settings")
async def update_drive_settings(request: Request):
    await require_role("admin", "manager")(request)
    body = await request.json()
    folder_name = body.get("folder_name", "").strip()
    folder_link = body.get("folder_link", "").strip()
    await db.drive_settings.update_one(
        {},
        {"$set": {"folder_name": folder_name, "folder_link": folder_link, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"folder_name": folder_name, "folder_link": folder_link}

@api_router.post("/upload/site-image")
async def upload_site_image(request: Request, file: UploadFile = File(...)):
    await get_current_user(request)
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size must be under 10MB")
    ext = file.filename.split(".")[-1] if "." in file.filename else "png"
    path = f"{APP_NAME}/site-images/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, contents, file.content_type or "image/png")
        return {"storage_path": result["path"], "filename": file.filename, "size": result.get("size", len(contents))}
    except Exception as e:
        logger.error(f"Site image upload failed: {e}")
        raise HTTPException(status_code=500, detail="Image upload failed")

# ================== INVENTORY CATEGORIES ==================

@api_router.get("/inventory/categories")
async def get_inventory_categories(request: Request):
    await get_current_user(request)
    categories = await db.inventory_categories.find().to_list(100)
    return [
        {"id": str(c["_id"]), "name": c["name"], "slug": c["slug"], "description": c.get("description", "")}
        for c in categories
    ]

@api_router.post("/inventory/categories")
async def create_inventory_category(cat: InventoryCategoryCreate, request: Request):
    current_user = await require_role("admin", "manager")(request)
    existing = await db.inventory_categories.find_one({"slug": cat.slug})
    if existing:
        raise HTTPException(status_code=400, detail="Category slug already exists")
    result = await db.inventory_categories.insert_one({
        "name": cat.name, "slug": cat.slug, "description": cat.description or "",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    return {"id": str(result.inserted_id), "message": "Category created"}

@api_router.delete("/inventory/categories/{cat_id}")
async def delete_inventory_category(cat_id: str, request: Request):
    current_user = await require_role("admin")(request)
    cat = await db.inventory_categories.find_one({"_id": ObjectId(cat_id)})
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    items_count = await db.inventory_items.count_documents({"category": cat["slug"]})
    if items_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete category with {items_count} items")
    await db.inventory_categories.delete_one({"_id": ObjectId(cat_id)})
    return {"message": "Category deleted"}

# ================== FILE UPLOAD ==================

@api_router.post("/upload/image")
async def upload_image(request: Request, file: UploadFile = File(...)):
    current_user = await get_current_user(request)
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size must be under 5MB")
    ext = file.filename.split(".")[-1] if "." in file.filename else "png"
    path = f"{APP_NAME}/images/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, contents, file.content_type or "image/png")
        return {"storage_path": result["path"], "size": result.get("size", len(contents))}
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail="Image upload failed")

@api_router.post("/upload/media")
async def upload_media(request: Request, file: UploadFile = File(...)):
    """Upload photos or videos for project completion"""
    current_user = await get_current_user(request)
    allowed_prefixes = ["image/", "video/"]
    if not file.content_type or not any(file.content_type.startswith(t) for t in allowed_prefixes):
        raise HTTPException(status_code=400, detail="Only image and video files are allowed")
    contents = await file.read()
    if len(contents) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size must be under 50MB")
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    media_type = "images" if file.content_type.startswith("image/") else "videos"
    path = f"{APP_NAME}/completion/{media_type}/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, contents, file.content_type)
        return {
            "storage_path": result["path"],
            "media_type": media_type,
            "filename": file.filename,
            "content_type": file.content_type,
            "size": result.get("size", len(contents))
        }
    except Exception as e:
        logger.error(f"Media upload failed: {e}")
        raise HTTPException(status_code=500, detail="Media upload failed")

@api_router.get("/files/{path:path}")
async def serve_file(path: str, request: Request):
    try:
        data, content_type = get_object(path)
        return Response(content=data, media_type=content_type)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

# ================== MARGIN UPDATE ==================

@api_router.put("/projects/{project_id}/margin")
async def update_project_margin(project_id: str, request: Request):
    current_user = await require_role("admin", "manager")(request)
    body = await request.json()
    item_margins = body.get("item_margins", [])
    
    if not item_margins:
        raise HTTPException(status_code=400, detail="No margin updates provided")
    
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    selected_items = project.get("selected_items", [])
    
    for margin_update in item_margins:
        idx = margin_update.get("index")
        pct = margin_update.get("margin_percentage", 0)
        if idx is not None and 0 <= idx < len(selected_items):
            selected_items[idx]["margin_percentage"] = float(pct)
    
    manual_costs = project.get("manual_costs", [])
    new_estimation = calculate_cost_estimation(selected_items, manual_costs)
    
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {
            "selected_items": selected_items,
            "cost_estimation": new_estimation,
            "margin_added_by": current_user["name"],
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await create_audit_log(
        current_user["id"], current_user["name"], "update", "project_margin",
        project_id, None, {"item_margins": item_margins}
    )
    
    return {"message": "Margins updated", "cost_estimation": new_estimation, "selected_items": selected_items}

# ================== INVENTORY MANAGEMENT ==================

@api_router.get("/inventory/items")
async def get_inventory_items(
    request: Request, 
    category: Optional[str] = None,
    low_stock: bool = False
):
    await get_current_user(request)
    
    query = {}
    if category:
        query["category"] = category
    
    items = await db.inventory_items.find(query).to_list(500)
    
    result = []
    for item in items:
        item_data = {
            "id": str(item["_id"]),
            "name": item["name"],
            "sku_code": item["sku_code"],
            "category": item["category"],
            "zone": item.get("zone", ""),
            "aisle": item.get("aisle", ""),
            "shelf": item.get("shelf", ""),
            "rack": item.get("rack", ""),
            "bin_location": item.get("bin_location", ""),
            "quantity": item["quantity"],
            "unit_price": item["unit_price"],
            "supplier": item.get("supplier"),
            "gst_percentage": item.get("gst_percentage", 18.0),
            "reorder_level": item.get("reorder_level", 10),
            "image_url": item.get("image_url"),
            "created_at": item["created_at"],
            "updated_at": item.get("updated_at")
        }
        
        if item["quantity"] <= item.get("reorder_level", 10):
            item_data["low_stock_alert"] = True
        
        if low_stock and not item_data.get("low_stock_alert"):
            continue
            
        result.append(item_data)
    
    return result

@api_router.get("/inventory/items/{item_id}")
async def get_inventory_item(item_id: str, request: Request):
    await get_current_user(request)
    
    item = await db.inventory_items.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    # Get transaction history
    transactions = await db.inventory_transactions.find(
        {"item_id": item_id}
    ).sort("timestamp", -1).limit(50).to_list(50)
    
    return {
        "id": str(item["_id"]),
        "name": item["name"],
        "sku_code": item["sku_code"],
        "category": item["category"],
        "zone": item.get("zone", ""),
        "aisle": item.get("aisle", ""),
        "shelf": item.get("shelf", ""),
        "rack": item.get("rack", ""),
        "bin_location": item.get("bin_location", ""),
        "quantity": item["quantity"],
        "unit_price": item["unit_price"],
        "supplier": item.get("supplier"),
        "gst_percentage": item.get("gst_percentage", 18.0),
        "reorder_level": item.get("reorder_level", 10),
        "image_url": item.get("image_url"),
        "created_at": item["created_at"],
        "transactions": [
            {
                "id": str(t["_id"]),
                "type": t["type"],
                "quantity": t["quantity"],
                "project_id": t.get("project_id"),
                "notes": t.get("notes"),
                "user_name": t.get("user_name"),
                "timestamp": t["timestamp"]
            }
            for t in transactions
        ]
    }

@api_router.post("/inventory/items")
async def create_inventory_item(item: InventoryItemCreate, request: Request):
    current_user = await require_role("admin", "manager")(request)
    
    existing = await db.inventory_items.find_one({"sku_code": item.sku_code})
    if existing:
        raise HTTPException(status_code=400, detail="SKU code already exists")
    
    item_doc = {
        "name": item.name,
        "sku_code": item.sku_code,
        "category": item.category,
        "zone": item.zone or "",
        "aisle": item.aisle or "",
        "shelf": item.shelf or "",
        "rack": item.rack or "",
        "bin_location": item.bin_location or "",
        "quantity": item.quantity,
        "unit_price": item.unit_price,
        "supplier": item.supplier,
        "gst_percentage": item.gst_percentage,
        "reorder_level": item.reorder_level,
        "image_url": item.image_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = await db.inventory_items.insert_one(item_doc)
    
    # Create initial stock transaction
    await db.inventory_transactions.insert_one({
        "item_id": str(result.inserted_id),
        "type": "initial_stock",
        "quantity": item.quantity,
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "notes": "Initial stock entry",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    
    await create_audit_log(
        current_user["id"], current_user["name"], "create", "inventory_item",
        str(result.inserted_id), None, item_doc
    )
    
    return {"id": str(result.inserted_id), "message": "Item created successfully"}

@api_router.put("/inventory/items/{item_id}")
async def update_inventory_item(item_id: str, updates: InventoryItemUpdate, request: Request):
    current_user = await require_role("admin", "manager")(request)
    
    item = await db.inventory_items.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    old_data = {k: item.get(k) for k in ["quantity", "unit_price"]}
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    
    if updates.name is not None:
        update_data["name"] = updates.name
    if updates.zone is not None:
        update_data["zone"] = updates.zone
    if updates.aisle is not None:
        update_data["aisle"] = updates.aisle
    if updates.shelf is not None:
        update_data["shelf"] = updates.shelf
    if updates.rack is not None:
        update_data["rack"] = updates.rack
    if updates.bin_location is not None:
        update_data["bin_location"] = updates.bin_location
    if updates.image_url is not None:
        update_data["image_url"] = updates.image_url
    if updates.category is not None:
        update_data["category"] = updates.category
    if updates.unit_price is not None:
        update_data["unit_price"] = updates.unit_price
    if updates.supplier is not None:
        update_data["supplier"] = updates.supplier
    if updates.gst_percentage is not None:
        update_data["gst_percentage"] = updates.gst_percentage
    if updates.reorder_level is not None:
        update_data["reorder_level"] = updates.reorder_level
    
    # Handle quantity adjustment
    if updates.quantity is not None and updates.quantity != item["quantity"]:
        quantity_diff = updates.quantity - item["quantity"]
        update_data["quantity"] = updates.quantity
        
        # Record transaction
        await db.inventory_transactions.insert_one({
            "item_id": item_id,
            "type": "adjustment",
            "quantity": quantity_diff,
            "user_id": current_user["id"],
            "user_name": current_user["name"],
            "notes": "Manual stock adjustment",
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    await db.inventory_items.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": update_data}
    )
    
    await create_audit_log(
        current_user["id"], current_user["name"], "update", "inventory_item",
        item_id, old_data, update_data
    )
    
    return {"message": "Item updated successfully"}

@api_router.delete("/inventory/items/{item_id}")
async def delete_inventory_item(item_id: str, request: Request):
    current_user = await require_role("admin")(request)
    
    item = await db.inventory_items.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    await db.inventory_items.delete_one({"_id": ObjectId(item_id)})
    await db.inventory_transactions.delete_many({"item_id": item_id})
    
    await create_audit_log(
        current_user["id"], current_user["name"], "delete", "inventory_item", item_id
    )
    
    return {"message": "Item deleted successfully"}

@api_router.get("/inventory/alerts")
async def get_inventory_alerts(request: Request):
    """Get all low stock alerts"""
    await get_current_user(request)
    
    # Use aggregation to find items below reorder level
    pipeline = [
        {
            "$match": {
                "$expr": {"$lte": ["$quantity", "$reorder_level"]}
            }
        }
    ]
    
    items = await db.inventory_items.aggregate(pipeline).to_list(100)
    
    return [
        {
            "id": str(item["_id"]),
            "name": item["name"],
            "sku_code": item["sku_code"],
            "category": item["category"],
            "zone": item.get("zone", ""),
            "quantity": item["quantity"],
            "reorder_level": item.get("reorder_level", 10)
        }
        for item in items
    ]

# ================== PROJECTS ==================

@api_router.post("/projects")
async def create_project(project: ProjectCreate, request: Request):
    user = await get_current_user(request)
    
    # Build selected items list for cost calculation
    selected_items_data = [si.model_dump() for si in project.selected_items]
    manual_costs_data = [mc.model_dump() for mc in project.manual_costs]
    
    project_doc = {
        "customer": project.customer.model_dump(),
        "location": project.location.model_dump(),
        "electrical": project.electrical.model_dump(),
        "solar_system": project.solar_system.model_dump(),
        "mounting": project.mounting.model_dump(),
        "additional": project.additional.model_dump(),
        "selected_items": selected_items_data,
        "manual_costs": manual_costs_data,
        "site_images": project.site_images,
        "drive_folder_name": project.drive_folder_name or "",
        "drive_folder_link": project.drive_folder_link or "",
        "drive_folder_id": project.drive_folder_id or "",
        "site_measurements": project.site_measurements or {},
        "custom_fields": project.custom_fields or {},
        "status": "draft",
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Calculate cost estimation from selected items
    project_doc["cost_estimation"] = calculate_cost_estimation(selected_items_data, manual_costs_data)
    
    result = await db.projects.insert_one(project_doc)
    
    # Auto-generate reference number
    ref_number = f"SCR-{str(result.inserted_id)[-6:].upper()}"
    await db.projects.update_one(
        {"_id": result.inserted_id},
        {"$set": {"reference_number": ref_number}}
    )
    
    await create_audit_log(
        user["id"], user["name"], "create", "project",
        str(result.inserted_id), None, {"customer": project.customer.name, "status": "draft"}
    )
    
    return {
        "id": str(result.inserted_id),
        "message": "Project created successfully"
    }

@api_router.get("/projects")
async def get_projects(request: Request, status: Optional[str] = None):
    user = await get_current_user(request)
    
    query = {"deleted_at": {"$exists": False}}  # Exclude soft-deleted projects
    
    # Staff can only see their own projects
    if user["role"] == "staff":
        query["created_by"] = user["id"]
    
    if status:
        query["status"] = status
    
    projects = await db.projects.find(query).sort("created_at", -1).to_list(1000)
    
    return [
        {
            "id": str(p["_id"]),
            "reference_number": p.get("reference_number", f"SCR-{str(p['_id'])[-6:].upper()}"),
            "customer": p["customer"],
            "location": p["location"],
            "status": p["status"],
            "cost_estimation": p.get("cost_estimation", {}),
            "created_by_name": p.get("created_by_name", "Unknown"),
            "created_at": p["created_at"],
            "updated_at": p["updated_at"]
        }
        for p in projects
    ]

@api_router.get("/projects/{project_id}")
async def get_project(project_id: str, request: Request):
    user = await get_current_user(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Staff can only see their own projects
    if user["role"] == "staff" and project["created_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Get deletion request if exists
    deletion_request = None
    if project["status"] == "deletion_requested":
        dr = await db.deletion_requests.find_one({"project_id": project_id, "status": "pending"})
        if dr:
            deletion_request = {
                "id": str(dr["_id"]),
                "requested_by": dr["requested_by_name"],
                "reason": dr["reason"],
                "requested_at": dr["requested_at"]
            }
    
    return {
        "id": str(project["_id"]),
        "reference_number": project.get("reference_number", f"SCR-{str(project['_id'])[-6:].upper()}"),
        "customer": project["customer"],
        "location": project["location"],
        "electrical": project["electrical"],
        "solar_system": project["solar_system"],
        "mounting": project["mounting"],
        "additional": project["additional"],
        "selected_items": project.get("selected_items", []),
        "manual_costs": project.get("manual_costs", []),
        "site_images": project.get("site_images", []),
        "drive_folder_name": project.get("drive_folder_name", ""),
        "drive_folder_link": project.get("drive_folder_link", ""),
        "drive_folder_id": project.get("drive_folder_id", ""),
        "site_measurements": project.get("site_measurements", {}),
        "custom_fields": project.get("custom_fields", {}),
        "completion_media": project.get("completion_media", []),
        "customer_feedback": project.get("customer_feedback"),
        "status": project["status"],
        "cost_estimation": project.get("cost_estimation", {}),
        "created_by": project["created_by"],
        "created_by_name": project.get("created_by_name", "Unknown"),
        "created_at": project["created_at"],
        "updated_at": project["updated_at"],
        "approved_by": project.get("approved_by"),
        "approved_at": project.get("approved_at"),
        "rejection_reason": project.get("rejection_reason"),
        "margin_added_by": project.get("margin_added_by"),
        "deletion_request": deletion_request
    }

@api_router.put("/projects/{project_id}")
async def update_project(project_id: str, updates: ProjectUpdate, request: Request):
    user = await get_current_user(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    editable_statuses = ["draft", "approved"]
    
    # Staff can only edit their own draft projects
    if user["role"] == "staff":
        if project["created_by"] != user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
        if project["status"] != "draft":
            raise HTTPException(status_code=400, detail="Can only edit draft projects")
    elif user["role"] in ["admin", "manager"]:
        if project["status"] not in editable_statuses:
            raise HTTPException(status_code=400, detail=f"Can only edit projects in: {', '.join(editable_statuses)}")
    
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    
    if updates.customer:
        update_data["customer"] = updates.customer.model_dump()
    if updates.location:
        update_data["location"] = updates.location.model_dump()
    if updates.electrical:
        update_data["electrical"] = updates.electrical.model_dump()
    if updates.solar_system:
        update_data["solar_system"] = updates.solar_system.model_dump()
    if updates.mounting:
        update_data["mounting"] = updates.mounting.model_dump()
    if updates.additional:
        update_data["additional"] = updates.additional.model_dump()
    if updates.site_images is not None:
        update_data["site_images"] = updates.site_images
    if updates.drive_folder_name is not None:
        update_data["drive_folder_name"] = updates.drive_folder_name
    if updates.drive_folder_link is not None:
        update_data["drive_folder_link"] = updates.drive_folder_link
    if updates.drive_folder_id is not None:
        update_data["drive_folder_id"] = updates.drive_folder_id
    if updates.site_measurements is not None:
        update_data["site_measurements"] = updates.site_measurements
    if updates.custom_fields is not None:
        update_data["custom_fields"] = updates.custom_fields
    if updates.selected_items is not None:
        update_data["selected_items"] = [si.model_dump() for si in updates.selected_items]
    if updates.manual_costs is not None:
        update_data["manual_costs"] = [mc.model_dump() for mc in updates.manual_costs]
    if updates.status and user["role"] in ["admin", "manager"]:
        update_data["status"] = updates.status
    
    # If editing an approved project, revert to submitted for re-approval
    if project["status"] == "approved" and user["role"] in ["admin", "manager"]:
        has_content_changes = any(k in update_data for k in ["customer", "location", "electrical", "solar_system", "mounting", "additional", "site_images", "selected_items", "manual_costs"])
        if has_content_changes and "status" not in update_data:
            update_data["status"] = "submitted"
    
    # Recalculate cost if items changed
    if "selected_items" in update_data or "manual_costs" in update_data:
        sel_items = update_data.get("selected_items", project.get("selected_items", []))
        man_costs = update_data.get("manual_costs", project.get("manual_costs", []))
        update_data["cost_estimation"] = calculate_cost_estimation(sel_items, man_costs)
    
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": update_data}
    )
    
    await create_audit_log(
        user["id"], user["name"], "update", "project", project_id
    )
    
    return {"message": "Project updated successfully"}

@api_router.post("/projects/{project_id}/submit")
async def submit_project(project_id: str, request: Request):
    user = await get_current_user(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if user["role"] == "staff" and project["created_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    if project["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft projects can be submitted")
    
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {
            "status": "submitted",
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await create_audit_log(
        user["id"], user["name"], "submit", "project", project_id
    )
    
    return {"message": "Project submitted for review"}

@api_router.post("/projects/{project_id}/approve")
async def approve_project(project_id: str, request: Request):
    user = await require_role("admin", "manager")(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if project["status"] != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted projects can be approved")
    
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {
            "status": "approved",
            "approved_by": user["id"],
            "approved_by_name": user["name"],
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await create_audit_log(
        user["id"], user["name"], "approve", "project", project_id
    )
    
    return {"message": "Project approved"}

@api_router.post("/projects/{project_id}/reject")
async def reject_project(project_id: str, request: Request):
    user = await require_role("admin", "manager")(request)
    
    body = await request.json()
    reason = body.get("reason", "No reason provided")
    
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if project["status"] != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted projects can be rejected")
    
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {
            "status": "rejected",
            "rejected_by": user["id"],
            "rejection_reason": reason,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await create_audit_log(
        user["id"], user["name"], "reject", "project", project_id, None, {"reason": reason}
    )
    
    return {"message": "Project rejected"}

@api_router.post("/projects/{project_id}/complete")
async def complete_project(project_id: str, request: Request):
    user = await require_role("admin", "manager")(request)
    
    try:
        body = await request.json()
    except Exception:
        body = {}
    
    completion_media = body.get("completion_media", [])
    customer_feedback = body.get("customer_feedback", "")
    
    if not completion_media or len(completion_media) == 0:
        raise HTTPException(status_code=400, detail="At least one photo or video is required for project completion")
    
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if project["status"] != "approved":
        raise HTTPException(status_code=400, detail="Only approved projects can be completed")
    
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {
            "status": "completed",
            "completion_media": completion_media,
            "customer_feedback": customer_feedback,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await create_audit_log(
        user["id"], user["name"], "complete", "project", project_id
    )
    
    return {"message": "Project marked as completed"}

@api_router.put("/projects/{project_id}/reference")
async def update_reference_number(project_id: str, request: Request):
    """Update project reference number (Admin/Manager only)"""
    current_user = await require_role("admin", "manager")(request)
    body = await request.json()
    ref = body.get("reference_number", "").strip()
    if not ref:
        raise HTTPException(status_code=400, detail="Reference number is required")
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {"reference_number": ref, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await create_audit_log(current_user["id"], current_user["name"], "update", "project_reference", project_id, None, {"reference_number": ref})
    return {"message": "Reference number updated", "reference_number": ref}

@api_router.put("/projects/{project_id}/status")
async def update_project_status(project_id: str, request: Request):
    """Manually change project status (Admin/Manager only)"""
    current_user = await require_role("admin", "manager")(request)
    body = await request.json()
    new_status = body.get("status", "").strip()
    valid_statuses = ["draft", "submitted", "approved", "rejected", "completed"]
    if new_status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}")
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    old_status = project["status"]
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await create_audit_log(current_user["id"], current_user["name"], "update", "project_status", project_id, {"status": old_status}, {"status": new_status})
    return {"message": f"Status changed to {new_status}", "status": new_status}

@api_router.get("/projects/{project_id}/gallery")
async def project_gallery(project_id: str):
    """Public gallery page for site images - used for QR code in PDF"""
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    site_images = project.get("site_images", [])
    completion_media = project.get("completion_media", [])
    customer_name = project.get("customer", {}).get("name", "Project")
    ref = project.get("reference_number", f"SCR-{str(project['_id'])[-6:].upper()}")
    
    img_tags = ""
    for i, url in enumerate(site_images):
        img_tags += f'<div style="break-inside:avoid;margin-bottom:12px;"><img src="{url}" alt="Site Photo {i+1}" style="width:100%;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);" loading="lazy"/><p style="text-align:center;color:#666;font-size:13px;margin:6px 0;">Site Photo {i+1}</p></div>'
    
    media_tags = ""
    for m in completion_media:
        sp = m.get("storage_path", "") if isinstance(m, dict) else ""
        ct = m.get("content_type", "") if isinstance(m, dict) else ""
        fn = m.get("filename", "File") if isinstance(m, dict) else ""
        file_url = f"/api/files/{sp}"
        if ct.startswith("video/"):
            media_tags += f'<div style="break-inside:avoid;margin-bottom:12px;"><video controls style="width:100%;border-radius:8px;" preload="metadata"><source src="{file_url}" type="{ct}"/></video><p style="text-align:center;color:#666;font-size:13px;">{fn}</p></div>'
        elif ct.startswith("image/"):
            media_tags += f'<div style="break-inside:avoid;margin-bottom:12px;"><img src="{file_url}" alt="{fn}" style="width:100%;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);" loading="lazy"/><p style="text-align:center;color:#666;font-size:13px;">{fn}</p></div>'
    
    html = f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{customer_name} - Site Gallery</title>
    <style>*{{margin:0;padding:0;box-sizing:border-box}}body{{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:24px;max-width:900px;margin:0 auto}}
    h1{{font-size:1.5rem;margin-bottom:4px}}h2{{font-size:1.1rem;color:#475569;margin:24px 0 12px;border-bottom:2px solid #e2e8f0;padding-bottom:6px}}
    .ref{{color:#64748b;font-size:.9rem;margin-bottom:20px}}.grid{{columns:2;column-gap:16px}}@media(max-width:600px){{.grid{{columns:1}}}}</style></head>
    <body><h1>{customer_name}</h1><p class="ref">{ref} &bull; Sensoper Controls &amp; Renewables</p>"""
    
    if img_tags:
        html += f'<h2>Site Images ({len(site_images)})</h2><div class="grid">{img_tags}</div>'
    if media_tags:
        html += f'<h2>Completion Media</h2><div class="grid">{media_tags}</div>'
    if not img_tags and not media_tags:
        html += '<p style="text-align:center;padding:40px;color:#94a3b8;">No images available for this project.</p>'
    
    html += '</body></html>'
    return HTMLResponse(content=html)

# ================== PROJECT DELETION WORKFLOW ==================

@api_router.post("/projects/{project_id}/request-deletion")
async def request_project_deletion(project_id: str, deletion: DeletionRequestCreate, request: Request):
    """Staff requests deletion, requires manager approval"""
    user = await get_current_user(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Staff can only request deletion of their own projects
    if user["role"] == "staff" and project["created_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Check for existing pending request
    existing = await db.deletion_requests.find_one({
        "project_id": project_id,
        "status": "pending"
    })
    if existing:
        raise HTTPException(status_code=400, detail="Deletion request already pending")
    
    # Create deletion request
    request_doc = {
        "project_id": project_id,
        "project_name": project["customer"]["name"],
        "requested_by": user["id"],
        "requested_by_name": user["name"],
        "reason": deletion.reason,
        "status": "pending",
        "requested_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = await db.deletion_requests.insert_one(request_doc)
    
    # Update project status
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {
            "status": "deletion_requested",
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await create_audit_log(
        user["id"], user["name"], "deletion_request", "project", project_id,
        None, {"reason": deletion.reason}
    )
    
    return {"id": str(result.inserted_id), "message": "Deletion request submitted"}

@api_router.get("/deletion-requests")
async def get_deletion_requests(request: Request, status: Optional[str] = None):
    """Get all deletion requests (Manager/Admin only)"""
    user = await require_role("admin", "manager")(request)
    
    query = {}
    if status:
        query["status"] = status
    
    requests = await db.deletion_requests.find(query).sort("requested_at", -1).to_list(100)
    
    return [
        {
            "id": str(r["_id"]),
            "project_id": r["project_id"],
            "project_name": r["project_name"],
            "requested_by": r["requested_by_name"],
            "reason": r["reason"],
            "status": r["status"],
            "requested_at": r["requested_at"],
            "resolved_by": r.get("resolved_by_name"),
            "resolved_at": r.get("resolved_at")
        }
        for r in requests
    ]

@api_router.post("/deletion-requests/{request_id}/approve")
async def approve_deletion(request_id: str, request: Request):
    """Approve deletion request - soft delete the project"""
    user = await require_role("admin", "manager")(request)
    
    del_request = await db.deletion_requests.find_one({"_id": ObjectId(request_id)})
    
    if not del_request:
        raise HTTPException(status_code=404, detail="Deletion request not found")
    
    if del_request["status"] != "pending":
        raise HTTPException(status_code=400, detail="Request already processed")
    
    # Soft delete the project
    await db.projects.update_one(
        {"_id": ObjectId(del_request["project_id"])},
        {"$set": {
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "deleted_by": user["id"],
            "deleted_by_name": user["name"],
            "status": "deleted"
        }}
    )
    
    # Update deletion request
    await db.deletion_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {
            "status": "approved",
            "resolved_by": user["id"],
            "resolved_by_name": user["name"],
            "resolved_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await create_audit_log(
        user["id"], user["name"], "deletion_approved", "project", del_request["project_id"]
    )
    
    return {"message": "Deletion approved, project soft-deleted"}

@api_router.post("/deletion-requests/{request_id}/reject")
async def reject_deletion(request_id: str, request: Request):
    """Reject deletion request - restore project status"""
    user = await require_role("admin", "manager")(request)
    
    del_request = await db.deletion_requests.find_one({"_id": ObjectId(request_id)})
    
    if not del_request:
        raise HTTPException(status_code=404, detail="Deletion request not found")
    
    if del_request["status"] != "pending":
        raise HTTPException(status_code=400, detail="Request already processed")
    
    # Restore project status to draft
    await db.projects.update_one(
        {"_id": ObjectId(del_request["project_id"])},
        {"$set": {
            "status": "draft",
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Update deletion request
    await db.deletion_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {
            "status": "rejected",
            "resolved_by": user["id"],
            "resolved_by_name": user["name"],
            "resolved_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await create_audit_log(
        user["id"], user["name"], "deletion_rejected", "project", del_request["project_id"]
    )
    
    return {"message": "Deletion rejected, project restored"}

@api_router.delete("/projects/{project_id}/force")
async def force_delete_project(project_id: str, request: Request):
    """Admin force delete (hard delete)"""
    user = await require_role("admin")(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Hard delete
    await db.projects.delete_one({"_id": ObjectId(project_id)})
    await db.deletion_requests.delete_many({"project_id": project_id})
    
    await create_audit_log(
        user["id"], user["name"], "force_delete", "project", project_id,
        {"customer": project["customer"]["name"]}
    )
    
    return {"message": "Project permanently deleted"}

# ================== AUDIT LOGS ==================

@api_router.get("/audit-logs")
async def get_audit_logs(
    request: Request,
    entity_type: Optional[str] = None,
    action_type: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 100
):
    """Get audit logs (Admin only, Manager limited)"""
    user = await get_current_user(request)
    
    if user["role"] not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    query = {}
    
    # Manager can only see project-related logs
    if user["role"] == "manager":
        query["entity_type"] = "project"
    elif entity_type:
        query["entity_type"] = entity_type
    
    if action_type:
        query["action_type"] = action_type
    if user_id:
        query["user_id"] = user_id
    
    logs = await db.audit_logs.find(query).sort("timestamp", -1).limit(limit).to_list(limit)
    
    return [
        {
            "id": str(log["_id"]),
            "user_id": log["user_id"],
            "user_name": log["user_name"],
            "action_type": log["action_type"],
            "entity_type": log["entity_type"],
            "entity_id": log["entity_id"],
            "details": log.get("details"),
            "timestamp": log["timestamp"]
        }
        for log in logs
    ]

# ================== DASHBOARD STATS ==================

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(request: Request):
    user = await get_current_user(request)
    
    query = {"deleted_at": {"$exists": False}}
    if user["role"] == "staff":
        query["created_by"] = user["id"]
    
    # Get project counts by status
    pipeline = [
        {"$match": query},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}}
    ]
    
    status_counts = await db.projects.aggregate(pipeline).to_list(100)
    
    stats = {
        "draft": 0,
        "submitted": 0,
        "approved": 0,
        "rejected": 0,
        "completed": 0,
        "deletion_requested": 0,
        "total": 0
    }
    
    for item in status_counts:
        if item["_id"] in stats:
            stats[item["_id"]] = item["count"]
            stats["total"] += item["count"]
    
    # Calculate total revenue from completed projects
    revenue_pipeline = [
        {"$match": {**query, "status": "completed"}},
        {"$group": {"_id": None, "total": {"$sum": "$cost_estimation.total_cost"}}}
    ]
    
    revenue_result = await db.projects.aggregate(revenue_pipeline).to_list(1)
    stats["total_revenue"] = revenue_result[0]["total"] if revenue_result else 0
    
    # Conversion rate
    if stats["total"] > 0:
        stats["conversion_rate"] = round((stats["completed"] / stats["total"]) * 100, 1)
    else:
        stats["conversion_rate"] = 0
    
    # Pending deletion requests count (for managers/admins)
    if user["role"] in ["admin", "manager"]:
        pending_deletions = await db.deletion_requests.count_documents({"status": "pending"})
        stats["pending_deletions"] = pending_deletions
        
        # Pending approvals count
        pending_approvals = await db.approvals.count_documents({"status": "pending"})
        stats["pending_approvals"] = pending_approvals
        
        # Low stock alerts count
        low_stock_pipeline = [
            {"$match": {"$expr": {"$lte": ["$quantity", "$reorder_level"]}}}
        ]
        low_stock_items = await db.inventory_items.aggregate(low_stock_pipeline).to_list(100)
        stats["low_stock_alerts"] = len(low_stock_items)
    
    return stats

# ================== CEO DASHBOARD ==================

@api_router.get("/dashboard/ceo")
async def get_ceo_dashboard(request: Request):
    user = await get_current_user(request)
    if user["role"] not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="CEO dashboard is admin/manager only")
    
    query = {"deleted_at": {"$exists": False}}
    all_projects = await db.projects.find(query).to_list(5000)
    
    # Status counts
    status_counts = {}
    for p in all_projects:
        s = p.get("status", "draft")
        status_counts[s] = status_counts.get(s, 0) + 1
    
    total = len(all_projects)
    completed = status_counts.get("completed", 0)
    approved = status_counts.get("approved", 0)
    
    # Revenue & Profit
    total_revenue = sum(p.get("cost_estimation", {}).get("total_cost", 0) for p in all_projects if p.get("status") in ["completed", "approved"])
    total_margin = sum(p.get("cost_estimation", {}).get("margin_total", 0) for p in all_projects if p.get("status") in ["completed", "approved"])
    
    # Conversion rate
    submitted_plus = sum(1 for p in all_projects if p.get("status") in ["submitted", "approved", "completed", "rejected"])
    conversion_rate = round((completed / submitted_plus) * 100, 1) if submitted_plus > 0 else 0
    
    # Monthly revenue trend (last 12 months)
    from collections import defaultdict
    monthly_revenue = defaultdict(float)
    monthly_projects = defaultdict(int)
    for p in all_projects:
        created = p.get("created_at", "")
        if created:
            month_key = created[:7]  # YYYY-MM
            monthly_projects[month_key] += 1
            if p.get("status") in ["completed", "approved"]:
                monthly_revenue[month_key] += p.get("cost_estimation", {}).get("total_cost", 0)
    
    sorted_months = sorted(monthly_revenue.keys())[-12:]
    revenue_trend = [{"month": m, "revenue": round(monthly_revenue.get(m, 0)), "projects": monthly_projects.get(m, 0)} for m in sorted_months]
    
    # Sales funnel
    funnel = {
        "total_leads": total,
        "quotes_generated": sum(1 for p in all_projects if p.get("status") != "draft"),
        "approved": approved + completed,
        "completed": completed
    }
    
    # Top staff
    staff_perf = defaultdict(lambda: {"name": "", "count": 0, "revenue": 0})
    for p in all_projects:
        uid = p.get("created_by", "")
        staff_perf[uid]["name"] = p.get("created_by_name", "Unknown")
        staff_perf[uid]["count"] += 1
        if p.get("status") in ["completed", "approved"]:
            staff_perf[uid]["revenue"] += p.get("cost_estimation", {}).get("total_cost", 0)
    top_staff = sorted(staff_perf.values(), key=lambda x: x["revenue"], reverse=True)[:5]
    
    # Inventory value
    inv_items = await db.inventory_items.find().to_list(1000)
    inventory_value = sum(i.get("unit_price", 0) * i.get("quantity", 0) for i in inv_items)
    low_stock = sum(1 for i in inv_items if i.get("quantity", 0) <= i.get("reorder_level", 5))
    
    # Pending approvals
    pending_approvals = await db.approvals.count_documents({"status": "pending"})
    
    return {
        "kpis": {
            "total_revenue": round(total_revenue),
            "total_profit": round(total_margin),
            "conversion_rate": conversion_rate,
            "active_projects": status_counts.get("submitted", 0) + status_counts.get("approved", 0),
            "completed_projects": completed,
            "pending_approvals": pending_approvals,
            "inventory_value": round(inventory_value),
            "low_stock_alerts": low_stock,
            "total_projects": total
        },
        "status_distribution": [{"name": k, "value": v} for k, v in status_counts.items()],
        "revenue_trend": revenue_trend,
        "sales_funnel": funnel,
        "top_staff": top_staff
    }

# ================== REPORTS ENGINE ==================

@api_router.get("/reports/{report_type}")
async def get_report(report_type: str, request: Request, date_from: str = None, date_to: str = None, system_type: str = None, status: str = None, customer: str = None, staff: str = None, project_id: str = None):
    user = await get_current_user(request)
    if user["role"] not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Reports are admin/manager only")
    
    query = {"deleted_at": {"$exists": False}}
    if date_from:
        query["created_at"] = {"$gte": date_from}
    if date_to:
        query.setdefault("created_at", {})
        if isinstance(query["created_at"], dict):
            query["created_at"]["$lte"] = date_to + "T23:59:59"
        else:
            query["created_at"] = {"$gte": query["created_at"], "$lte": date_to + "T23:59:59"}
    if system_type and system_type != "all":
        query["solar_system.system_type"] = system_type
    if status and status != "all":
        query["status"] = status
    if customer and customer != "all":
        query["customer.name"] = {"$regex": customer, "$options": "i"}
    if staff and staff != "all":
        query["created_by_name"] = {"$regex": staff, "$options": "i"}
    if project_id:
        query["_id"] = ObjectId(project_id)
    
    projects = await db.projects.find(query).to_list(5000)
    inv_items = await db.inventory_items.find().to_list(1000)
    
    if report_type == "sales":
        total_quotes = len(projects)
        approved = sum(1 for p in projects if p.get("status") in ["approved", "completed"])
        rejected = sum(1 for p in projects if p.get("status") == "rejected")
        draft = sum(1 for p in projects if p.get("status") == "draft")
        revenue = sum(p.get("cost_estimation", {}).get("total_cost", 0) for p in projects if p.get("status") in ["approved", "completed"])
        chart_data = [{"name": "Approved/Won", "value": approved}, {"name": "Rejected", "value": rejected}, {"name": "Draft/Pending", "value": total_quotes - approved - rejected}]
        return {
            "title": "Sales Report",
            "summary": {"total_quotes": total_quotes, "approved_projects": approved, "conversion_rate": round((approved / total_quotes) * 100, 1) if total_quotes else 0, "revenue": round(revenue)},
            "rows": [{"customer": p.get("customer", {}).get("name", ""), "ref": p.get("reference_number", ""), "status": p.get("status", ""), "total": round(p.get("cost_estimation", {}).get("total_cost", 0)), "date": p.get("created_at", "")[:10]} for p in projects],
            "chart_data": [c for c in chart_data if c["value"] > 0]
        }
    
    elif report_type == "profit":
        rows = []
        total_cost = 0
        total_selling = 0
        total_margin = 0
        for p in projects:
            ce = p.get("cost_estimation", {})
            selling = ce.get("total_cost", 0)
            margin = ce.get("margin_total", 0)
            base = selling - margin - ce.get("gst_total", 0)
            rows.append({"customer": p.get("customer", {}).get("name", ""), "ref": p.get("reference_number", ""), "base_cost": round(base), "selling_price": round(selling), "margin": round(margin), "margin_pct": round((margin / selling) * 100, 1) if selling else 0})
            total_cost += base
            total_selling += selling
            total_margin += margin
        return {"title": "Profit Report", "summary": {"total_base_cost": round(total_cost), "total_selling": round(total_selling), "total_margin": round(total_margin), "avg_margin_pct": round((total_margin / total_selling) * 100, 1) if total_selling else 0}, "rows": rows, "chart_data": [{"name": "Base Cost", "value": round(total_cost)}, {"name": "Margin", "value": round(total_margin)}, {"name": "GST", "value": round(total_selling - total_cost - total_margin)}]}
    
    elif report_type == "execution":
        rows = []
        for p in projects:
            created = p.get("created_at", "")[:10]
            updated = p.get("updated_at", "")[:10]
            rows.append({"customer": p.get("customer", {}).get("name", ""), "ref": p.get("reference_number", ""), "status": p.get("status", ""), "created": created, "updated": updated, "staff": p.get("created_by_name", ""), "system_kw": p.get("electrical", {}).get("sanction_load_kw", 0)})
        from collections import Counter
        status_dist = Counter(r["status"] for r in rows)
        return {"title": "Project Execution Report", "summary": {"total": len(rows), "completed": sum(1 for r in rows if r["status"] == "completed"), "in_progress": sum(1 for r in rows if r["status"] in ["submitted", "approved"])}, "rows": rows, "chart_data": [{"name": k, "value": v} for k, v in status_dist.items()]}
    
    elif report_type == "inventory":
        rows = [{"name": i.get("name", ""), "sku": i.get("sku_code", ""), "category": i.get("category", ""), "quantity": i.get("quantity", 0), "unit_price": round(i.get("unit_price", 0)), "total_value": round(i.get("unit_price", 0) * i.get("quantity", 0)), "reorder_level": i.get("reorder_level", 5), "low_stock": i.get("quantity", 0) <= i.get("reorder_level", 5)} for i in inv_items]
        from collections import defaultdict as dd_inv
        cat_val = dd_inv(float)
        for r in rows:
            cat_val[r["category"]] += r["total_value"]
        return {"title": "Procurement & Inventory Report", "summary": {"total_items": len(rows), "total_value": sum(r["total_value"] for r in rows), "low_stock_count": sum(1 for r in rows if r["low_stock"])}, "rows": rows, "chart_data": [{"name": k, "value": round(v)} for k, v in cat_val.items() if v > 0]}
    
    elif report_type == "technical_om":
        rows = []
        for p in projects:
            el = p.get("electrical", {})
            ss = p.get("solar_system", {})
            is_complete = p.get("status") == "completed"
            rows.append({"customer": p.get("customer", {}).get("name", ""), "ref": p.get("reference_number", ""), "system_type": ss.get("system_type", ""), "sanction_kw": el.get("sanction_load_kw", 0), "monthly_units": el.get("monthly_consumption_units", 0), "panel_wattage": ss.get("panel_wattage", 0), "expected_gen_kwh": round(el.get("sanction_load_kw", 0) * 4 * 30, 1), "status": p.get("status", ""), "om_status": "Active" if is_complete else "N/A"})
        completed_count = sum(1 for r in rows if r["om_status"] == "Active")
        total_kw = round(sum(r["sanction_kw"] for r in rows), 1)
        return {"title": "Technical & O&M Report", "summary": {"total_capacity_kw": total_kw, "avg_monthly_consumption": round(sum(r["monthly_units"] for r in rows) / len(rows)) if rows else 0, "active_installations": completed_count, "total_projects": len(rows)}, "rows": rows, "chart_data": [{"name": "Active O&M", "value": completed_count}, {"name": "Not Installed", "value": len(rows) - completed_count}]}
    
    elif report_type == "expense":
        from collections import defaultdict
        rows = []
        cat_totals = defaultdict(float)
        for p in projects:
            ce = p.get("cost_estimation", {})
            items_total = ce.get("items_total", 0)
            manual_total = ce.get("manual_total", 0)
            gst = ce.get("gst_total", 0)
            total = items_total + manual_total + gst
            rows.append({"customer": p.get("customer", {}).get("name", ""), "ref": p.get("reference_number", ""), "materials": round(items_total), "labor_misc": round(manual_total), "gst": round(gst), "total_expense": round(total), "date": p.get("created_at", "")[:10]})
            cat_totals["Materials"] += items_total
            cat_totals["Labor & Misc"] += manual_total
            cat_totals["GST"] += gst
        chart_data = [{"name": k, "value": round(v)} for k, v in cat_totals.items() if v > 0]
        return {"title": "Expense Report", "summary": {"total_expenses": round(sum(r["total_expense"] for r in rows)), "total_materials": round(cat_totals["Materials"]), "total_labor": round(cat_totals["Labor & Misc"]), "total_gst": round(cat_totals["GST"])}, "rows": rows, "chart_data": chart_data}
    
    elif report_type == "inbound":
        rows = [{"name": i.get("name", ""), "sku": i.get("sku_code", ""), "category": i.get("category", ""), "current_stock": i.get("quantity", 0), "unit_price": round(i.get("unit_price", 0)), "total_value": round(i.get("unit_price", 0) * i.get("quantity", 0))} for i in inv_items if i.get("quantity", 0) > 0]
        from collections import defaultdict
        cat_stock = defaultdict(int)
        for i in inv_items:
            cat_stock[i.get("category", "other")] += i.get("quantity", 0)
        chart_data = [{"name": k, "value": v} for k, v in cat_stock.items() if v > 0]
        return {"title": "Inbound Report (Current Stock)", "summary": {"total_items_in_stock": sum(r["current_stock"] for r in rows), "total_stock_value": sum(r["total_value"] for r in rows), "categories": len(cat_stock)}, "rows": rows, "chart_data": chart_data}
    
    elif report_type == "outbound":
        from collections import defaultdict
        material_usage = defaultdict(lambda: {"name": "", "qty_used": 0, "revenue": 0})
        for p in projects:
            for si in p.get("selected_items", []):
                key = si.get("name", "Unknown")
                material_usage[key]["name"] = key
                material_usage[key]["qty_used"] += si.get("quantity", 0)
                material_usage[key]["revenue"] += si.get("unit_price", 0) * si.get("quantity", 0)
        rows = [{"item": v["name"], "qty_used": v["qty_used"], "revenue": round(v["revenue"])} for v in sorted(material_usage.values(), key=lambda x: x["qty_used"], reverse=True)]
        chart_data = [{"name": r["item"][:20], "value": r["qty_used"]} for r in rows[:8]]
        return {"title": "Outbound Report (Material Usage)", "summary": {"unique_items_used": len(rows), "total_units_dispatched": sum(r["qty_used"] for r in rows), "total_outbound_value": sum(r["revenue"] for r in rows)}, "rows": rows, "chart_data": chart_data}
    
    elif report_type == "excess":
        rows = [{"name": i.get("name", ""), "sku": i.get("sku_code", ""), "category": i.get("category", ""), "quantity": i.get("quantity", 0), "reorder_level": i.get("reorder_level", 5), "excess": max(0, i.get("quantity", 0) - i.get("reorder_level", 5) * 3), "unit_price": round(i.get("unit_price", 0)), "excess_value": round(max(0, i.get("quantity", 0) - i.get("reorder_level", 5) * 3) * i.get("unit_price", 0))} for i in inv_items if i.get("quantity", 0) > i.get("reorder_level", 5) * 3]
        chart_data = [{"name": r["name"][:20], "value": r["excess"]} for r in sorted(rows, key=lambda x: x["excess_value"], reverse=True)[:8]]
        return {"title": "Excess Materials Report", "summary": {"excess_items": len(rows), "total_excess_value": sum(r["excess_value"] for r in rows)}, "rows": rows, "chart_data": chart_data}
    
    elif report_type == "scrap":
        rows = [{"name": i.get("name", ""), "sku": i.get("sku_code", ""), "category": i.get("category", ""), "quantity": i.get("quantity", 0), "status": "Potential Scrap" if i.get("quantity", 0) == 0 else "Low Use", "unit_price": round(i.get("unit_price", 0))} for i in inv_items if i.get("quantity", 0) <= 1]
        chart_data = [{"name": "Zero Stock", "value": sum(1 for r in rows if r["quantity"] == 0)}, {"name": "Near Zero", "value": sum(1 for r in rows if r["quantity"] == 1)}]
        return {"title": "Scrap Report", "summary": {"potential_scrap_items": len(rows), "zero_stock_items": sum(1 for r in rows if r["quantity"] == 0)}, "rows": rows, "chart_data": chart_data}
    
    elif report_type == "price_fluctuation":
        from collections import defaultdict
        item_prices = defaultdict(list)
        for p in projects:
            for si in p.get("selected_items", []):
                item_prices[si.get("name", "Unknown")].append(si.get("unit_price", 0))
        rows = []
        for name, prices in item_prices.items():
            if len(prices) >= 1:
                rows.append({"item": name, "min_price": round(min(prices)), "max_price": round(max(prices)), "avg_price": round(sum(prices) / len(prices)), "fluctuation": round(max(prices) - min(prices)), "usage_count": len(prices)})
        rows.sort(key=lambda x: x["fluctuation"], reverse=True)
        chart_data = [{"name": r["item"][:20], "value": r["fluctuation"]} for r in rows[:8]]
        return {"title": "Price Fluctuation Report", "summary": {"items_tracked": len(rows), "max_fluctuation": max(r["fluctuation"] for r in rows) if rows else 0}, "rows": rows, "chart_data": chart_data}
    
    elif report_type == "low_stock":
        rows = [{"name": i.get("name", ""), "sku": i.get("sku_code", ""), "category": i.get("category", ""), "quantity": i.get("quantity", 0), "reorder_level": i.get("reorder_level", 5), "deficit": max(0, i.get("reorder_level", 5) - i.get("quantity", 0)), "unit_price": round(i.get("unit_price", 0)), "restock_cost": round(max(0, i.get("reorder_level", 5) - i.get("quantity", 0)) * i.get("unit_price", 0))} for i in inv_items if i.get("quantity", 0) <= i.get("reorder_level", 5)]
        from collections import defaultdict
        cat_counts = defaultdict(int)
        for r in rows:
            cat_counts[r["category"]] += 1
        chart_data = [{"name": k, "value": v} for k, v in cat_counts.items()]
        return {"title": "Low Stock Report", "summary": {"low_stock_items": len(rows), "total_restock_cost": sum(r["restock_cost"] for r in rows), "critical_zero": sum(1 for r in rows if r["quantity"] == 0)}, "rows": sorted(rows, key=lambda x: x["deficit"], reverse=True), "chart_data": chart_data}
    
    elif report_type == "compliance":
        rows = []
        total_gst = 0
        from collections import defaultdict
        monthly_gst = defaultdict(float)
        for p in projects:
            ce = p.get("cost_estimation", {})
            gst = ce.get("gst_total", 0)
            total_gst += gst
            month = p.get("created_at", "")[:7]
            monthly_gst[month] += gst
            rows.append({"customer": p.get("customer", {}).get("name", ""), "ref": p.get("reference_number", ""), "subtotal": round(ce.get("items_total", 0)), "gst": round(gst), "total": round(ce.get("total_cost", 0)), "date": p.get("created_at", "")[:10]})
        chart_data = [{"name": k, "value": round(v)} for k, v in sorted(monthly_gst.items())[-6:]]
        return {"title": "Compliance & Tax Report", "summary": {"total_gst_collected": round(total_gst), "total_invoices": len(rows)}, "rows": rows, "chart_data": chart_data}
    
    elif report_type == "hr":
        from collections import defaultdict
        staff_data = defaultdict(lambda: {"name": "", "projects": 0, "revenue": 0, "completed": 0})
        for p in projects:
            uid = p.get("created_by", "")
            staff_data[uid]["name"] = p.get("created_by_name", "Unknown")
            staff_data[uid]["projects"] += 1
            if p.get("status") == "completed":
                staff_data[uid]["completed"] += 1
            if p.get("status") in ["approved", "completed"]:
                staff_data[uid]["revenue"] += p.get("cost_estimation", {}).get("total_cost", 0)
        rows = [{"staff": v["name"], "total_projects": v["projects"], "completed": v["completed"], "revenue": round(v["revenue"]), "completion_rate": round((v["completed"] / v["projects"]) * 100, 1) if v["projects"] else 0} for v in staff_data.values()]
        chart_data = [{"name": r["staff"][:15], "value": r["total_projects"]} for r in sorted(rows, key=lambda x: x["revenue"], reverse=True)[:8]]
        return {"title": "HR & Productivity Report", "summary": {"total_staff": len(rows), "avg_projects_per_staff": round(sum(r["total_projects"] for r in rows) / len(rows), 1) if rows else 0}, "rows": sorted(rows, key=lambda x: x["revenue"], reverse=True), "chart_data": chart_data}
    
    elif report_type == "customer":
        rows = []
        for p in projects:
            fb = p.get("customer_feedback")
            rows.append({"customer": p.get("customer", {}).get("name", ""), "ref": p.get("reference_number", ""), "status": p.get("status", ""), "feedback": fb or "No feedback", "has_feedback": bool(fb)})
        with_fb = sum(1 for r in rows if r["has_feedback"])
        chart_data = [{"name": "With Feedback", "value": with_fb}, {"name": "No Feedback", "value": len(rows) - with_fb}]
        return {"title": "Customer Satisfaction Report", "summary": {"total_customers": len(rows), "feedback_received": with_fb, "feedback_rate": round((with_fb / len(rows)) * 100, 1) if rows else 0}, "rows": rows, "chart_data": chart_data}
    
    elif report_type == "marketing":
        from collections import defaultdict
        sources = defaultdict(lambda: {"count": 0, "converted": 0})
        for p in projects:
            src = p.get("custom_fields", {}).get("customer", {}).get("referral_source", "Direct")
            sources[src]["count"] += 1
            if p.get("status") in ["approved", "completed"]:
                sources[src]["converted"] += 1
        rows = [{"source": k, "leads": v["count"], "converted": v["converted"], "conversion_rate": round((v["converted"] / v["count"]) * 100, 1) if v["count"] else 0} for k, v in sources.items()]
        chart_data = [{"name": r["source"], "value": r["leads"]} for r in sorted(rows, key=lambda x: x["leads"], reverse=True)[:8]]
        return {"title": "Marketing Report", "summary": {"total_sources": len(rows), "total_leads": sum(r["leads"] for r in rows)}, "rows": sorted(rows, key=lambda x: x["leads"], reverse=True), "chart_data": chart_data}
    
    elif report_type == "customer_credit":
        all_payments = await db.payments.find().to_list(5000)
        from collections import defaultdict
        project_payments = defaultdict(float)
        for pay in all_payments:
            project_payments[pay["project_id"]] += pay.get("amount", 0)
        rows = []
        for p in projects:
            pid = str(p["_id"])
            total_cost = p.get("cost_estimation", {}).get("total_cost", 0)
            paid = project_payments.get(pid, 0)
            balance = max(0, total_cost - paid)
            pay_status = "Paid" if paid >= total_cost and total_cost > 0 else "Partial" if paid > 0 else "Pending"
            rows.append({"customer": p.get("customer", {}).get("name", ""), "ref": p.get("reference_number", ""), "total_value": round(total_cost), "amount_paid": round(paid), "balance": round(balance), "payment_status": pay_status})
        chart_data = [{"name": "Paid", "value": sum(1 for r in rows if r["payment_status"] == "Paid")}, {"name": "Partial", "value": sum(1 for r in rows if r["payment_status"] == "Partial")}, {"name": "Pending", "value": sum(1 for r in rows if r["payment_status"] == "Pending")}]
        return {"title": "Customer Credit Report", "summary": {"total_receivable": sum(r["total_value"] for r in rows), "total_collected": sum(r["amount_paid"] for r in rows), "outstanding": sum(r["balance"] for r in rows), "fully_paid": sum(1 for r in rows if r["payment_status"] == "Paid")}, "rows": rows, "chart_data": [c for c in chart_data if c["value"] > 0]}
    
    elif report_type == "referral":
        from collections import defaultdict
        sources = defaultdict(lambda: {"leads": 0, "converted": 0, "revenue": 0})
        for p in projects:
            src = p.get("custom_fields", {}).get("customer", {}).get("referral_source", "Direct")
            sources[src]["leads"] += 1
            if p.get("status") in ["approved", "completed"]:
                sources[src]["converted"] += 1
                sources[src]["revenue"] += p.get("cost_estimation", {}).get("total_cost", 0)
        rows = [{"source": k, "leads": v["leads"], "converted": v["converted"], "conversion_rate": round((v["converted"] / v["leads"]) * 100, 1) if v["leads"] else 0, "revenue": round(v["revenue"])} for k, v in sources.items()]
        chart_data = [{"name": r["source"], "value": r["revenue"]} for r in sorted(rows, key=lambda x: x["revenue"], reverse=True)[:8]]
        return {"title": "Referral Report", "summary": {"total_sources": len(rows), "total_leads": sum(r["leads"] for r in rows), "best_source": max(rows, key=lambda x: x["revenue"])["source"] if rows else "N/A"}, "rows": sorted(rows, key=lambda x: x["revenue"], reverse=True), "chart_data": chart_data}
    
    elif report_type == "team_load":
        from collections import defaultdict
        team_data = defaultdict(lambda: {"name": "", "assigned": 0, "completed": 0, "in_progress": 0})
        for p in projects:
            uid = p.get("created_by", "")
            team_data[uid]["name"] = p.get("created_by_name", "Unknown")
            team_data[uid]["assigned"] += 1
            if p.get("status") == "completed":
                team_data[uid]["completed"] += 1
            elif p.get("status") in ["submitted", "approved"]:
                team_data[uid]["in_progress"] += 1
        rows = []
        avg_load = sum(v["assigned"] for v in team_data.values()) / len(team_data) if team_data else 0
        for v in team_data.values():
            load_status = "Overloaded" if v["assigned"] > avg_load * 1.5 else "Underutilized" if v["assigned"] < avg_load * 0.5 else "Balanced"
            rows.append({"staff": v["name"], "assigned": v["assigned"], "in_progress": v["in_progress"], "completed": v["completed"], "load_status": load_status})
        chart_data = [{"name": r["staff"][:15], "value": r["assigned"]} for r in sorted(rows, key=lambda x: x["assigned"], reverse=True)[:8]]
        return {"title": "Installation Team Load Report", "summary": {"total_staff": len(rows), "avg_projects_per_staff": round(avg_load, 1), "overloaded": sum(1 for r in rows if r["load_status"] == "Overloaded")}, "rows": sorted(rows, key=lambda x: x["assigned"], reverse=True), "chart_data": chart_data}
    
    elif report_type == "excess_utilisation":
        usage_logs = await db.material_usage_logs.find().to_list(5000)
        from collections import defaultdict
        item_data = defaultdict(lambda: {"estimated": 0, "actual": 0, "wastage": 0})
        for log in usage_logs:
            name = log.get("item_name", "Unknown")
            item_data[name]["estimated"] += log.get("estimated_qty", 0)
            item_data[name]["actual"] += log.get("actual_qty", 0)
            item_data[name]["wastage"] += log.get("wastage", 0)
        rows = []
        for name, d in item_data.items():
            variance = d["actual"] - d["estimated"]
            rows.append({"item": name, "estimated": round(d["estimated"], 1), "actual": round(d["actual"], 1), "variance": round(variance, 1), "wastage": round(d["wastage"], 1), "status": "Excess" if variance > 0 else "Shortage" if variance < 0 else "On Target"})
        if not rows:
            rows = [{"item": "No usage logs recorded", "estimated": 0, "actual": 0, "variance": 0, "wastage": 0, "status": "N/A"}]
        chart_data = [{"name": "Excess", "value": sum(1 for r in rows if r["status"] == "Excess")}, {"name": "Shortage", "value": sum(1 for r in rows if r["status"] == "Shortage")}, {"name": "On Target", "value": sum(1 for r in rows if r["status"] == "On Target")}]
        return {"title": "Excess Material Utilisation Report", "summary": {"items_tracked": len(item_data), "excess_items": sum(1 for r in rows if r["status"] == "Excess"), "total_wastage": round(sum(r["wastage"] for r in rows), 1)}, "rows": rows, "chart_data": [c for c in chart_data if c["value"] > 0]}
    
    raise HTTPException(status_code=404, detail=f"Unknown report type: {report_type}")

# ================== AI RECOMMENDATIONS ==================

@api_router.post("/ai/recommendations")
async def get_ai_recommendations(data: AIRecommendationRequest, request: Request):
    await get_current_user(request)
    
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="AI service not configured")
        
        chat = LlmChat(
            api_key=api_key,
            session_id=f"solar-rec-{uuid.uuid4()}",
            system_message="""You are a solar energy consultant for Sensoper Controls and Renewables. 
            Provide concise, practical recommendations for solar system installations based on the user's energy consumption and site details.
            Focus on:
            1. Recommended system capacity (kW)
            2. Panel type and count
            3. Inverter recommendations
            4. Estimated savings
            5. ROI timeline
            Keep responses under 300 words and use bullet points."""
        )
        
        chat.with_model("openai", "gpt-5.2")
        
        prompt = f"""Based on the following details, provide solar system recommendations:
        
        - Monthly Electricity Consumption: {data.monthly_consumption_units} units
        - Sanctioned Load: {data.sanction_load_kw} kW
        - Roof Type: {data.roof_type}
        - Budget Range: {data.budget_range or 'Not specified'}
        
        Please recommend the optimal solar system configuration."""
        
        user_message = UserMessage(text=prompt)
        response = await chat.send_message(user_message)
        
        return {"recommendation": response}
    
    except ImportError:
        return {"recommendation": f"""Based on your monthly consumption of {data.monthly_consumption_units} units:

**Recommended System:**
- Capacity: {max(1, data.monthly_consumption_units / 120):.1f} kW
- Panels: {int(max(1, data.monthly_consumption_units / 120) * 1000 / 540) + 1} x 540W panels
- Inverter: {max(1, data.monthly_consumption_units / 120):.1f} kW grid-tied

**Estimated Benefits:**
- Monthly Savings: Rs. {data.monthly_consumption_units * data.sanction_load_kw:.0f} approx
- ROI: 4-5 years
- System Life: 25+ years

*For detailed AI-powered analysis, please configure the AI service.*"""}
    except Exception as e:
        logger.error(f"AI recommendation error: {e}")
        return {"recommendation": f"Could not generate AI recommendation. Basic estimate: {max(1, data.monthly_consumption_units / 120):.1f} kW system recommended."}

# ================== APPROVALS ==================

APPROVAL_TYPES = ["deletion", "margin_change", "quotation_approval", "inventory_edit", "user_access_change"]

@api_router.get("/approvals")
async def list_approvals(request: Request, status: str = None, type: str = None, requested_by: str = None):
    user = await get_current_user(request)
    query = {}
    if status:
        query["status"] = status
    if type:
        query["type"] = type
    if requested_by:
        query["requested_by"] = requested_by
    # Staff can only see their own requests
    if user["role"] == "staff":
        query["requested_by"] = user["id"]
    
    approvals = await db.approvals.find(query).sort("timestamp", -1).to_list(200)
    return [
        {
            "id": str(a["_id"]),
            "type": a["type"],
            "requested_by": a["requested_by"],
            "requested_by_name": a.get("requested_by_name", "Unknown"),
            "role": a.get("role", "staff"),
            "description": a.get("description", ""),
            "entity_type": a.get("entity_type", ""),
            "entity_id": a.get("entity_id", ""),
            "data_payload": a.get("data_payload", {}),
            "status": a["status"],
            "approved_by": a.get("approved_by"),
            "approved_by_name": a.get("approved_by_name"),
            "rejection_reason": a.get("rejection_reason"),
            "timestamp": a["timestamp"],
            "resolved_at": a.get("resolved_at")
        }
        for a in approvals
    ]

@api_router.get("/approvals/pending-count")
async def get_pending_approvals_count(request: Request):
    user = await get_current_user(request)
    if user["role"] == "staff":
        return {"count": 0}
    count = await db.approvals.count_documents({"status": "pending"})
    return {"count": count}

@api_router.post("/approvals")
async def create_approval(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    
    approval_type = body.get("type")
    if approval_type not in APPROVAL_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid type. Must be: {', '.join(APPROVAL_TYPES)}")
    
    doc = {
        "type": approval_type,
        "requested_by": user["id"],
        "requested_by_name": user["name"],
        "role": user["role"],
        "description": body.get("description", ""),
        "entity_type": body.get("entity_type", ""),
        "entity_id": body.get("entity_id", ""),
        "data_payload": body.get("data_payload", {}),
        "status": "pending",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    result = await db.approvals.insert_one(doc)
    await create_audit_log(user["id"], user["name"], "create", "approval", str(result.inserted_id), None, {"type": approval_type})
    return {"id": str(result.inserted_id), "message": "Approval request created"}

@api_router.put("/approvals/{approval_id}/approve")
async def approve_request(approval_id: str, request: Request):
    user = await get_current_user(request)
    
    approval = await db.approvals.find_one({"_id": ObjectId(approval_id)})
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    if approval["status"] != "pending":
        raise HTTPException(status_code=400, detail="Approval already resolved")
    
    # Check permission based on type
    perm_map = {
        "deletion": "can_approve_deletion",
        "margin_change": "can_approve_margin",
        "quotation_approval": "can_approve_quotation",
        "inventory_edit": "can_approve_inventory",
        "user_access_change": "can_change_user_access"
    }
    perm = perm_map.get(approval["type"])
    if perm:
        has_perm = await check_permission(user, perm)
        if not has_perm:
            raise HTTPException(status_code=403, detail="You don't have permission to approve this type")
    
    # Execute the approval action
    executed = await execute_approval_action(approval)
    
    await db.approvals.update_one(
        {"_id": ObjectId(approval_id)},
        {"$set": {
            "status": "approved",
            "approved_by": user["id"],
            "approved_by_name": user["name"],
            "resolved_at": datetime.now(timezone.utc).isoformat(),
            "execution_result": executed
        }}
    )
    await create_audit_log(user["id"], user["name"], "approve", "approval", approval_id)
    return {"message": "Request approved and executed", "execution_result": executed}

@api_router.put("/approvals/{approval_id}/reject")
async def reject_request(approval_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    reason = body.get("reason", "")
    
    approval = await db.approvals.find_one({"_id": ObjectId(approval_id)})
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    if approval["status"] != "pending":
        raise HTTPException(status_code=400, detail="Approval already resolved")
    
    perm_map = {
        "deletion": "can_approve_deletion",
        "margin_change": "can_approve_margin",
        "quotation_approval": "can_approve_quotation",
        "inventory_edit": "can_approve_inventory",
        "user_access_change": "can_change_user_access"
    }
    perm = perm_map.get(approval["type"])
    if perm:
        has_perm = await check_permission(user, perm)
        if not has_perm:
            raise HTTPException(status_code=403, detail="You don't have permission to reject this type")
    
    await db.approvals.update_one(
        {"_id": ObjectId(approval_id)},
        {"$set": {
            "status": "rejected",
            "approved_by": user["id"],
            "approved_by_name": user["name"],
            "rejection_reason": reason,
            "resolved_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    await create_audit_log(user["id"], user["name"], "reject", "approval", approval_id)
    return {"message": "Request rejected"}

async def execute_approval_action(approval: dict) -> str:
    """Execute the actual action when an approval is granted"""
    atype = approval["type"]
    payload = approval.get("data_payload", {})
    entity_id = approval.get("entity_id", "")
    
    try:
        if atype == "deletion":
            entity_type = approval.get("entity_type", "")
            if entity_type == "project" and entity_id:
                await db.projects.update_one(
                    {"_id": ObjectId(entity_id)},
                    {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat(), "status": "deleted"}}
                )
                return "Project deleted"
            elif entity_type == "inventory_item" and entity_id:
                await db.inventory_items.delete_one({"_id": ObjectId(entity_id)})
                return "Inventory item deleted"
        
        elif atype == "margin_change":
            if entity_id and "item_margins" in payload:
                project = await db.projects.find_one({"_id": ObjectId(entity_id)})
                if project:
                    items = project.get("selected_items", [])
                    for mu in payload["item_margins"]:
                        idx = mu.get("index")
                        if idx is not None and 0 <= idx < len(items):
                            items[idx]["margin_percentage"] = float(mu.get("margin_percentage", 0))
                    new_est = calculate_cost_estimation(items, project.get("manual_costs", []))
                    await db.projects.update_one(
                        {"_id": ObjectId(entity_id)},
                        {"$set": {"selected_items": items, "cost_estimation": new_est, "updated_at": datetime.now(timezone.utc).isoformat()}}
                    )
                    return "Margins updated"
        
        elif atype == "quotation_approval":
            if entity_id:
                await db.projects.update_one(
                    {"_id": ObjectId(entity_id)},
                    {"$set": {"status": "approved", "approved_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}}
                )
                return "Quotation approved"
        
        elif atype == "inventory_edit":
            if entity_id and payload:
                update_fields = {}
                for k in ["name", "unit_price", "gst_percentage", "quantity", "category", "description"]:
                    if k in payload:
                        update_fields[k] = payload[k]
                if update_fields:
                    update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
                    await db.inventory_items.update_one(
                        {"_id": ObjectId(entity_id)},
                        {"$set": update_fields}
                    )
                    return "Inventory item updated"
        
        elif atype == "user_access_change":
            user_id = payload.get("user_id")
            new_role = payload.get("new_role")
            if user_id and new_role:
                await db.users.update_one(
                    {"_id": ObjectId(user_id)},
                    {"$set": {"role": new_role}}
                )
                return f"User role changed to {new_role}"
        
        return "No action taken"
    except Exception as e:
        logger.error(f"Approval execution error: {e}")
        return f"Error: {str(e)}"

# ================== PERMISSIONS MANAGEMENT ==================

@api_router.get("/permissions")
async def get_all_permissions(request: Request):
    user = await require_role("admin")(request)
    roles = ["admin", "manager", "staff"]
    result = {}
    for role in roles:
        result[role] = await get_permissions(role)
    return result

@api_router.get("/permissions/{role_name}")
async def get_role_permissions(role_name: str, request: Request):
    user = await get_current_user(request)
    perms = await get_permissions(role_name)
    return {"role": role_name, "permissions": perms}

@api_router.put("/permissions/{role_name}")
async def update_role_permissions(role_name: str, request: Request):
    user = await require_role("admin")(request)
    body = await request.json()
    permissions = body.get("permissions", {})
    
    if role_name not in ["admin", "manager", "staff"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    await db.role_permissions.update_one(
        {"role_name": role_name},
        {"$set": {"role_name": role_name, "permissions": permissions, "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": user["name"]}},
        upsert=True
    )
    await create_audit_log(user["id"], user["name"], "update", "permissions", role_name, None, permissions)
    return {"message": f"Permissions for {role_name} updated", "permissions": permissions}

@api_router.get("/company/logo-base64")
async def get_logo_base64():
    """Return company logo as base64 data URL to bypass CORS for PDF generation"""
    company = await db.company_profiles.find_one({"is_active": True})
    if not company:
        company = await db.company_profiles.find_one({})
    logo_url = company.get("logo_url") if company else None
    if not logo_url:
        return {"logo_base64": None}
    # If already base64
    if logo_url.startswith("data:"):
        return {"logo_base64": logo_url}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(logo_url)
            if resp.status_code == 200:
                ct = resp.headers.get("content-type", "image/png")
                b64 = base64.b64encode(resp.content).decode("utf-8")
                return {"logo_base64": f"data:{ct};base64,{b64}"}
    except Exception as e:
        logger.error(f"Failed to fetch logo for base64: {e}")
    return {"logo_base64": None}

# ================== FORM TABS (Dynamic Form Engine) ==================

@api_router.get("/form-tabs")
async def get_form_tabs(request: Request):
    user = await get_current_user(request)
    query = {}
    if user["role"] != "admin":
        query["active"] = True
        query["roles_visible"] = user["role"]
    tabs = await db.form_tabs.find(query, {"_id": 0}).sort("order", 1).to_list(100)
    for t in tabs:
        doc = await db.form_tabs.find_one({"slug": t.get("slug")})
        if doc:
            t["id"] = str(doc["_id"])
        t.setdefault("system", False)
    return tabs

@api_router.post("/form-tabs")
async def create_form_tab(tab: FormTabCreate, request: Request):
    user = await require_permission(request, "can_manage_company")
    slug = tab.name.strip().lower().replace(" ", "_")
    slug = "".join(c for c in slug if c.isalnum() or c == "_")
    existing = await db.form_tabs.find_one({"slug": slug})
    if existing:
        raise HTTPException(status_code=400, detail="A tab with this name already exists")
    # Insert before site_docs: find max order among non-site_docs tabs
    non_docs = await db.form_tabs.find({"slug": {"$ne": "site_docs"}}).sort("order", -1).to_list(1)
    next_order = (non_docs[0]["order"] + 1) if non_docs else 1
    # Push site_docs order up
    await db.form_tabs.update_one({"slug": "site_docs"}, {"$set": {"order": next_order + 1}})
    doc = {
        "name": tab.name.strip(),
        "slug": slug,
        "fields": [f.model_dump() for f in tab.fields],
        "roles_visible": tab.roles_visible,
        "order": next_order,
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.form_tabs.insert_one(doc)
    await create_audit_log(user["id"], user["name"], "create", "form_tab", str(result.inserted_id), None, {"name": tab.name})
    return {"id": str(result.inserted_id), "message": "Form tab created"}

@api_router.put("/form-tabs/reorder")
async def reorder_form_tabs(request: Request):
    await require_permission(request, "can_manage_company")
    body = await request.json()
    order_list = body.get("order", [])
    for idx, tab_id in enumerate(order_list):
        await db.form_tabs.update_one({"_id": ObjectId(tab_id)}, {"$set": {"order": idx + 1, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"message": "Tabs reordered"}

@api_router.put("/form-tabs/{tab_id}")
async def update_form_tab(tab_id: str, updates: FormTabUpdate, request: Request):
    user = await require_permission(request, "can_manage_company")
    tab = await db.form_tabs.find_one({"_id": ObjectId(tab_id)})
    if not tab:
        raise HTTPException(status_code=404, detail="Tab not found")
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if updates.name is not None:
        update_data["name"] = updates.name.strip()
        # System tabs keep their original slug (used to identify hardcoded content)
        if not tab.get("system"):
            new_slug = updates.name.strip().lower().replace(" ", "_")
            new_slug = "".join(c for c in new_slug if c.isalnum() or c == "_")
            existing = await db.form_tabs.find_one({"slug": new_slug, "_id": {"$ne": ObjectId(tab_id)}})
            if existing:
                raise HTTPException(status_code=400, detail="A tab with this name already exists")
            update_data["slug"] = new_slug
    if updates.fields is not None:
        update_data["fields"] = [f.model_dump() for f in updates.fields]
    if updates.roles_visible is not None:
        update_data["roles_visible"] = updates.roles_visible
    if updates.active is not None:
        update_data["active"] = updates.active
    await db.form_tabs.update_one({"_id": ObjectId(tab_id)}, {"$set": update_data})
    await create_audit_log(user["id"], user["name"], "update", "form_tab", tab_id)
    return {"message": "Tab updated"}

@api_router.delete("/form-tabs/{tab_id}")
async def delete_form_tab(tab_id: str, request: Request):
    user = await require_permission(request, "can_manage_company")
    tab = await db.form_tabs.find_one({"_id": ObjectId(tab_id)})
    if not tab:
        raise HTTPException(status_code=404, detail="Tab not found")
    await db.form_tabs.delete_one({"_id": ObjectId(tab_id)})
    await create_audit_log(user["id"], user["name"], "delete", "form_tab", tab_id, {"name": tab.get("name")})
    return {"message": "Tab deleted"}

# ================== DAILY UPDATES ==================

@api_router.post("/daily-updates")
async def create_daily_update(update: DailyUpdateCreate, request: Request):
    user = await get_current_user(request)
    doc = {
        "project_id": update.project_id,
        "update_type": update.update_type,
        "data": update.data,
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.daily_updates.insert_one(doc)
    return {"id": str(result.inserted_id), "message": "Update created"}

@api_router.get("/daily-updates")
async def list_daily_updates(request: Request, project_id: str = None, update_type: str = None, date_from: str = None, date_to: str = None):
    await get_current_user(request)
    query = {}
    if project_id:
        query["project_id"] = project_id
    if update_type:
        query["update_type"] = update_type
    if date_from:
        query.setdefault("created_at", {})["$gte"] = date_from
    if date_to:
        query.setdefault("created_at", {})["$lte"] = date_to + "T23:59:59"
    updates = await db.daily_updates.find(query).sort("created_at", -1).to_list(500)
    for u in updates:
        u["id"] = str(u.pop("_id"))
    return updates

@api_router.get("/daily-updates/project/{project_id}")
async def get_project_updates(project_id: str, request: Request):
    await get_current_user(request)
    updates = await db.daily_updates.find({"project_id": project_id}).sort("created_at", -1).to_list(200)
    for u in updates:
        u["id"] = str(u.pop("_id"))
    return updates

@api_router.put("/daily-updates/{update_id}")
async def update_daily_update(update_id: str, body: DailyUpdateUpdate, request: Request):
    user = await get_current_user(request)
    doc = await db.daily_updates.find_one({"_id": ObjectId(update_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Update not found")
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.data is not None:
        update_data["data"] = body.data
    if body.update_type is not None:
        update_data["update_type"] = body.update_type
    await db.daily_updates.update_one({"_id": ObjectId(update_id)}, {"$set": update_data})
    return {"message": "Update modified"}

@api_router.delete("/daily-updates/{update_id}")
async def delete_daily_update(update_id: str, request: Request):
    await get_current_user(request)
    result = await db.daily_updates.delete_one({"_id": ObjectId(update_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Update not found")
    return {"message": "Update deleted"}

# ================== PAYMENTS ==================

@api_router.post("/payments")
async def create_payment(payment: PaymentCreate, request: Request):
    user = await get_current_user(request)
    project = await db.projects.find_one({"_id": ObjectId(payment.project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    doc = {
        "project_id": payment.project_id,
        "amount": payment.amount,
        "payment_method": payment.payment_method,
        "notes": payment.notes,
        "recorded_by": user["id"],
        "recorded_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.payments.insert_one(doc)
    return {"id": str(result.inserted_id), "message": "Payment recorded"}

@api_router.get("/payments/project/{project_id}")
async def get_project_payments(project_id: str, request: Request):
    await get_current_user(request)
    payments = await db.payments.find({"project_id": project_id}).sort("created_at", -1).to_list(200)
    for p in payments:
        p["id"] = str(p.pop("_id"))
    return payments

# ================== MATERIAL USAGE LOGS ==================

@api_router.post("/material-usage")
async def create_material_usage(usage: MaterialUsageCreate, request: Request):
    user = await get_current_user(request)
    doc = {
        "project_id": usage.project_id,
        "item_name": usage.item_name,
        "estimated_qty": usage.estimated_qty,
        "actual_qty": usage.actual_qty,
        "wastage": usage.wastage,
        "variance": usage.actual_qty - usage.estimated_qty,
        "notes": usage.notes,
        "logged_by": user["id"],
        "logged_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.material_usage_logs.insert_one(doc)
    return {"id": str(result.inserted_id), "message": "Usage logged"}

@api_router.get("/material-usage/project/{project_id}")
async def get_project_material_usage(project_id: str, request: Request):
    await get_current_user(request)
    logs = await db.material_usage_logs.find({"project_id": project_id}).sort("created_at", -1).to_list(200)
    for l in logs:
        l["id"] = str(l.pop("_id"))
    return logs

# ================== DATA COMPLETENESS ==================

@api_router.get("/projects/{project_id}/completeness")
async def get_project_completeness(project_id: str, request: Request):
    await get_current_user(request)
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    score = 0
    checks = {}
    # Customer details (20%)
    cust = project.get("customer", {})
    cust_ok = bool(cust.get("name") and cust.get("phone") and cust.get("address"))
    checks["customer_details"] = cust_ok
    if cust_ok: score += 20
    # Site data (20%)
    loc = project.get("location", {})
    site_ok = bool(loc.get("site_location_words") or loc.get("address"))
    checks["site_data"] = site_ok
    if site_ok: score += 20
    # Electrical data (15%)
    elec = project.get("electrical", {})
    elec_ok = bool(elec.get("sanction_load_kw") and elec.get("monthly_consumption_units"))
    checks["electrical_data"] = elec_ok
    if elec_ok: score += 15
    # Costing (20%)
    items = project.get("selected_items", [])
    cost_ok = len(items) > 0
    checks["costing"] = cost_ok
    if cost_ok: score += 20
    # Drive link (10%)
    drive_ok = bool(project.get("drive_folder_link"))
    checks["site_docs"] = drive_ok
    if drive_ok: score += 10
    # Daily updates (15%)
    update_count = await db.daily_updates.count_documents({"project_id": project_id})
    updates_ok = update_count >= 1
    checks["daily_updates"] = updates_ok
    if updates_ok: score += 15
    return {"score": min(score, 100), "checks": checks, "update_count": update_count}

# ================== PROJECT REPORT (Per-Project Download) ==================

@api_router.get("/projects/{project_id}/report")
async def get_project_report(project_id: str, request: Request):
    await get_current_user(request)
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    payments = await db.payments.find({"project_id": project_id}).to_list(100)
    for p in payments:
        p["id"] = str(p.pop("_id"))
    material_logs = await db.material_usage_logs.find({"project_id": project_id}).to_list(100)
    for m in material_logs:
        m["id"] = str(m.pop("_id"))
    updates = await db.daily_updates.find({"project_id": project_id}).sort("created_at", -1).to_list(100)
    for u in updates:
        u["id"] = str(u.pop("_id"))
    total_paid = sum(p.get("amount", 0) for p in payments)
    total_cost = project.get("cost_estimation", {}).get("total_cost", 0)
    return {
        "project": {
            "id": project_id,
            "ref": project.get("reference_number", ""),
            "customer": project.get("customer", {}),
            "location": project.get("location", {}),
            "status": project.get("status", ""),
            "electrical": project.get("electrical", {}),
            "solar_system": project.get("solar_system", {}),
            "cost_estimation": project.get("cost_estimation", {}),
            "selected_items": project.get("selected_items", []),
            "manual_costs": project.get("manual_costs", []),
            "site_measurements": project.get("site_measurements", {}),
            "created_at": project.get("created_at", ""),
            "updated_at": project.get("updated_at", "")
        },
        "payments": payments,
        "total_paid": total_paid,
        "balance": max(0, total_cost - total_paid),
        "payment_status": "Paid" if total_paid >= total_cost and total_cost > 0 else "Partial" if total_paid > 0 else "Pending",
        "material_usage": material_logs,
        "daily_updates": updates
    }

# ================== HEALTH CHECK ==================

@api_router.get("/")
async def root():
    return {"message": "Sensoper Solar Estimator API", "status": "healthy"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

# ================== STARTUP EVENTS ==================

@app.on_event("startup")
async def startup_event():
    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.projects.create_index("created_by")
    await db.projects.create_index("status")
    await db.audit_logs.create_index("timestamp")
    await db.audit_logs.create_index("entity_type")
    await db.inventory_items.create_index("sku_code", unique=True)
    await db.inventory_items.create_index("category")
    await db.inventory_categories.create_index("slug", unique=True)
    await db.terms_conditions.create_index([("language", 1), ("is_active", 1)])
    await db.deletion_requests.create_index("project_id")
    await db.deletion_requests.create_index("status")
    await db.approvals.create_index("status")
    await db.approvals.create_index("type")
    await db.form_tabs.create_index("slug", unique=True)
    await db.form_tabs.create_index("order")
    await db.daily_updates.create_index("project_id")
    await db.daily_updates.create_index("created_at")
    await db.payments.create_index("project_id")
    await db.material_usage_logs.create_index("project_id")
    await db.approvals.create_index("requested_by")
    await db.approvals.create_index("timestamp")
    await db.role_permissions.create_index("role_name", unique=True)
    
    # Seed admin user
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@sensoper.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@123")
    
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        hashed = hash_password(admin_password)
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hashed,
            "name": "System Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        logger.info(f"Admin user created: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}}
        )
        logger.info(f"Admin password updated: {admin_email}")
    
    # Update existing company profiles with new logo
    await db.company_profiles.update_many(
        {"logo_url": {"$regex": "job_solar-estimator|32se8qpu_snspr|x3rj9e2a_slg"}},
        {"$set": {"logo_url": "https://customer-assets.emergentagent.com/job_8c20414a-b147-464e-9c68-aaa2fa40fdbf/artifacts/q52gayft_snspr.png"}}
    )
    
    # Seed default company profile
    company = await db.company_profiles.find_one({})
    if not company:
        await db.company_profiles.insert_one({
            "company_name": "Sensoper Controls & Renewables",
            "tagline": "Solar Solutions Provider",
            "logo_url": "https://customer-assets.emergentagent.com/job_8c20414a-b147-464e-9c68-aaa2fa40fdbf/artifacts/q52gayft_snspr.png",
            "primary_color": "#4ADE40",
            "secondary_color": "#2D9BF0",
            "address": "123 Solar Street, Erode\nTamil Nadu, India - 638001",
            "phone": "+91 98765 43210",
            "email": "info@sensoper.com",
            "website": "www.sensoper.com",
            "gst_number": "33XXXXX1234X1ZX",
            "pan_number": "XXXXX1234X",
            "bank_details": {
                "account_name": "Sensoper Controls & Renewables",
                "account_number": "1234567890123456",
                "ifsc_code": "SBIN0001234",
                "bank_name": "State Bank of India",
                "branch": "Erode Main Branch"
            },
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
        logger.info("Default company profile created")
    
    # Seed default inventory categories
    default_categories = [
        {"name": "Solar Panels", "slug": "solar_panels", "description": "Photovoltaic solar panels"},
        {"name": "Inverters", "slug": "inverters", "description": "Solar inverters and micro-inverters"},
        {"name": "Batteries", "slug": "batteries", "description": "Battery storage systems"},
        {"name": "Mounting Structures", "slug": "mounting_structures", "description": "Panel mounting and racking"},
        {"name": "Cables & Accessories", "slug": "cables_accessories", "description": "Wiring, connectors, and accessories"},
    ]
    for cat in default_categories:
        existing_cat = await db.inventory_categories.find_one({"slug": cat["slug"]})
        if not existing_cat:
            await db.inventory_categories.insert_one({**cat, "created_at": datetime.now(timezone.utc).isoformat()})
    logger.info("Inventory categories seeded")
    
    # Seed default permissions
    for role_name, perms in DEFAULT_PERMISSIONS.items():
        existing_perm = await db.role_permissions.find_one({"role_name": role_name})
        if not existing_perm:
            await db.role_permissions.insert_one({
                "role_name": role_name,
                "permissions": perms,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
    logger.info("Default permissions seeded")
    
    # Seed system form tabs
    system_tabs = [
        {"name": "Customer", "slug": "customer", "system": True, "active": True, "icon": "User", "fields": [], "roles_visible": ["admin", "manager", "staff"]},
        {"name": "Location", "slug": "location", "system": True, "active": True, "icon": "MapPin", "fields": [], "roles_visible": ["admin", "manager", "staff"]},
        {"name": "Site & Electrical", "slug": "site_electrical", "system": True, "active": True, "icon": "Zap", "fields": [], "roles_visible": ["admin", "manager", "staff"]},
        {"name": "Materials", "slug": "materials", "system": True, "active": True, "icon": "Package", "fields": [], "roles_visible": ["admin", "manager", "staff"]},
        {"name": "Site Docs", "slug": "site_docs", "system": True, "active": True, "icon": "FolderOpen", "fields": [], "roles_visible": ["admin", "manager", "staff"]},
    ]
    for st in system_tabs:
        existing_tab = await db.form_tabs.find_one({"slug": st["slug"]})
        if not existing_tab:
            await db.form_tabs.insert_one({**st, "order": 0, "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()})
    # Normalize ordering: system tabs first (in defined order), custom tabs next, site_docs last
    system_order = ["customer", "location", "site_electrical", "materials"]
    all_tabs_list = await db.form_tabs.find().to_list(200)
    ordered = []
    for slug in system_order:
        tab = next((t for t in all_tabs_list if t.get("slug") == slug), None)
        if tab:
            ordered.append(tab)
    custom_tabs_sorted = sorted([t for t in all_tabs_list if not t.get("system")], key=lambda x: x.get("order", 999))
    ordered.extend(custom_tabs_sorted)
    site_docs = next((t for t in all_tabs_list if t.get("slug") == "site_docs"), None)
    if site_docs:
        ordered.append(site_docs)
    for idx, tab in enumerate(ordered):
        await db.form_tabs.update_one({"_id": tab["_id"]}, {"$set": {"order": idx + 1}})
    logger.info("System form tabs seeded")
    
    # Init object storage
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.warning(f"Object storage init failed (non-critical): {e}")
    
    # Write test credentials
    try:
        os.makedirs("/app/memory", exist_ok=True)
        with open("/app/memory/test_credentials.md", "w") as f:
            f.write(f"""# Test Credentials

## Admin Account
- Email: {admin_email}
- Password: {admin_password}
- Role: admin

## Auth Endpoints
- POST /api/auth/login
- POST /api/auth/register
- POST /api/auth/logout
- GET /api/auth/me
- POST /api/auth/refresh
""")
    except Exception as e:
        logger.warning(f"Could not write test credentials: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# Include the router in the main app
app.include_router(api_router)

# CORS Configuration
frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[frontend_url, "http://localhost:3000", "https://admin-tabs-studio.preview.emergentagent.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)
