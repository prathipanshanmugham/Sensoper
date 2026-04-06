from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Form
from fastapi.responses import JSONResponse
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

class SolarSystemInputs(BaseModel):
    system_type: Literal["on-grid", "off-grid", "hybrid"]
    inverter_model: Optional[str] = None
    panel_wattage: Optional[int] = 540
    battery_required: bool = False
    battery_capacity_ah: Optional[int] = None

class MountingStructure(BaseModel):
    roof_type: Literal["rcc", "metal", "ground"]
    tilt_angle: int
    structure_type: str

class AdditionalInputs(BaseModel):
    cable_length_meters: float
    inverter_to_panel_distance: float
    installation_complexity: Literal["simple", "moderate", "complex"]
    shadow_analysis_notes: Optional[str] = None

class SelectedItem(BaseModel):
    inventory_item_id: Optional[str] = None
    name: str
    category: str
    unit_price: float
    gst_percentage: float = 18.0
    quantity: int = 1

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

class InventoryLocationCreate(BaseModel):
    code: str  # e.g., WH-Erode-01
    name: str
    address: Optional[str] = None

class InventoryItemCreate(BaseModel):
    name: str
    sku_code: str
    category: Literal["solar_panels", "inverters", "batteries", "mounting_structures", "cables_accessories"]
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

class InventoryItemUpdate(BaseModel):
    name: Optional[str] = None
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

class DeletionRequestCreate(BaseModel):
    reason: str

# ================== COMPANY PROFILE MODELS ==================

class BankDetails(BaseModel):
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    ifsc_code: Optional[str] = None
    bank_name: Optional[str] = None
    branch: Optional[str] = None

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

def calculate_cost_estimation(selected_items: list, manual_costs: list, margin_percentage: float = 15.0) -> dict:
    """Calculate cost estimation from selected inventory items and manual costs"""
    items_breakdown = []
    total_items_cost = 0
    total_gst = 0

    for item in selected_items:
        item_cost = item["unit_price"] * item["quantity"]
        item_gst = item_cost * (item["gst_percentage"] / 100)
        total_items_cost += item_cost
        total_gst += item_gst
        items_breakdown.append({
            "name": item["name"],
            "category": item["category"],
            "unit_price": item["unit_price"],
            "quantity": item["quantity"],
            "gst_percentage": item["gst_percentage"],
            "amount": round(item_cost, 2),
            "gst_amount": round(item_gst, 2)
        })

    manual_total = sum(c["amount"] for c in manual_costs)
    subtotal = total_items_cost + manual_total
    margin = subtotal * (margin_percentage / 100)
    total_cost = subtotal + margin + total_gst

    return {
        "items_breakdown": items_breakdown,
        "manual_costs": [{"description": c["description"], "amount": round(c["amount"], 2)} for c in manual_costs],
        "items_subtotal": round(total_items_cost, 2),
        "manual_subtotal": round(manual_total, 2),
        "subtotal": round(subtotal, 2),
        "margin": round(margin, 2),
        "margin_percentage": margin_percentage,
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
            "logo_url": "https://customer-assets.emergentagent.com/job_solar-estimator-14/artifacts/y3yo3sfo_snspr.png",
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

# ================== INVENTORY MANAGEMENT ==================

@api_router.get("/inventory/locations")
async def get_inventory_locations(request: Request):
    await get_current_user(request)
    
    locations = await db.inventory_locations.find().to_list(100)
    return [
        {
            "id": str(loc["_id"]),
            "code": loc["code"],
            "name": loc["name"],
            "address": loc.get("address"),
            "created_at": loc["created_at"]
        }
        for loc in locations
    ]

@api_router.post("/inventory/locations")
async def create_inventory_location(location: InventoryLocationCreate, request: Request):
    current_user = await require_role("admin")(request)
    
    existing = await db.inventory_locations.find_one({"code": location.code})
    if existing:
        raise HTTPException(status_code=400, detail="Location code already exists")
    
    loc_doc = {
        "code": location.code,
        "name": location.name,
        "address": location.address,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = await db.inventory_locations.insert_one(loc_doc)
    
    await create_audit_log(
        current_user["id"], current_user["name"], "create", "inventory_location",
        str(result.inserted_id), None, loc_doc
    )
    
    return {"id": str(result.inserted_id), "message": "Location created successfully"}

@api_router.delete("/inventory/locations/{location_id}")
async def delete_inventory_location(location_id: str, request: Request):
    current_user = await require_role("admin")(request)
    
    # Check if any items use this location
    loc = await db.inventory_locations.find_one({"_id": ObjectId(location_id)})
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    
    items_count = await db.inventory_items.count_documents({"location_code": loc["code"]})
    if items_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete location with {items_count} items")
    
    await db.inventory_locations.delete_one({"_id": ObjectId(location_id)})
    
    await create_audit_log(
        current_user["id"], current_user["name"], "delete", "inventory_location", location_id
    )
    
    return {"message": "Location deleted successfully"}

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
        "status": "draft",
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Calculate cost estimation from selected items
    project_doc["cost_estimation"] = calculate_cost_estimation(selected_items_data, manual_costs_data)
    
    result = await db.projects.insert_one(project_doc)
    
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
        "customer": project["customer"],
        "location": project["location"],
        "electrical": project["electrical"],
        "solar_system": project["solar_system"],
        "mounting": project["mounting"],
        "additional": project["additional"],
        "selected_items": project.get("selected_items", []),
        "manual_costs": project.get("manual_costs", []),
        "site_images": project.get("site_images", []),
        "status": project["status"],
        "cost_estimation": project.get("cost_estimation", {}),
        "created_by": project["created_by"],
        "created_by_name": project.get("created_by_name", "Unknown"),
        "created_at": project["created_at"],
        "updated_at": project["updated_at"],
        "approved_by": project.get("approved_by"),
        "approved_at": project.get("approved_at"),
        "rejection_reason": project.get("rejection_reason"),
        "deletion_request": deletion_request
    }

@api_router.put("/projects/{project_id}")
async def update_project(project_id: str, updates: ProjectUpdate, request: Request):
    user = await get_current_user(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Staff can only edit their own draft projects
    if user["role"] == "staff":
        if project["created_by"] != user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
        if project["status"] != "draft":
            raise HTTPException(status_code=400, detail="Can only edit draft projects")
    
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
    if updates.selected_items is not None:
        update_data["selected_items"] = [si.model_dump() for si in updates.selected_items]
    if updates.manual_costs is not None:
        update_data["manual_costs"] = [mc.model_dump() for mc in updates.manual_costs]
    if updates.status and user["role"] in ["admin", "manager"]:
        update_data["status"] = updates.status
    
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
    
    project = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if project["status"] != "approved":
        raise HTTPException(status_code=400, detail="Only approved projects can be completed")
    
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await create_audit_log(
        user["id"], user["name"], "complete", "project", project_id
    )
    
    return {"message": "Project marked as completed"}

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
        
        # Low stock alerts count
        low_stock_pipeline = [
            {"$match": {"$expr": {"$lte": ["$quantity", "$reorder_level"]}}}
        ]
        low_stock_items = await db.inventory_items.aggregate(low_stock_pipeline).to_list(100)
        stats["low_stock_alerts"] = len(low_stock_items)
    
    return stats

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
    await db.inventory_locations.create_index("code", unique=True)
    await db.terms_conditions.create_index([("language", 1), ("is_active", 1)])
    await db.deletion_requests.create_index("project_id")
    await db.deletion_requests.create_index("status")
    
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
    
    # Seed default company profile
    company = await db.company_profiles.find_one({})
    if not company:
        await db.company_profiles.insert_one({
            "company_name": "Sensoper Controls & Renewables",
            "tagline": "Solar Solutions Provider",
            "logo_url": "https://customer-assets.emergentagent.com/job_solar-estimator-14/artifacts/y3yo3sfo_snspr.png",
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
            "authorized_signatory": "John Doe",
            "designation": "Managing Director",
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
        logger.info("Default company profile created")
    
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
    allow_origins=[frontend_url, "http://localhost:3000", "https://renewable-estimator.preview.emergentagent.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)
