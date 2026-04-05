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
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
import secrets

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
    latitude: float
    longitude: float
    address: Optional[str] = None

class ElectricalDetails(BaseModel):
    sanction_load_kw: float
    connected_load_kw: float
    monthly_consumption_units: float
    eb_tariff: float

class SolarSystemInputs(BaseModel):
    system_type: Literal["on-grid", "off-grid", "hybrid"]
    inverter_model: str
    panel_wattage: int
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

class ProjectCreate(BaseModel):
    customer: CustomerDetails
    location: LocationDetails
    electrical: ElectricalDetails
    solar_system: SolarSystemInputs
    mounting: MountingStructure
    additional: AdditionalInputs
    site_images: List[str] = []

class ProjectUpdate(BaseModel):
    customer: Optional[CustomerDetails] = None
    location: Optional[LocationDetails] = None
    electrical: Optional[ElectricalDetails] = None
    solar_system: Optional[SolarSystemInputs] = None
    mounting: Optional[MountingStructure] = None
    additional: Optional[AdditionalInputs] = None
    site_images: Optional[List[str]] = None
    status: Optional[Literal["draft", "submitted", "approved", "rejected", "completed"]] = None

class PricingConfig(BaseModel):
    panel_price_per_watt: float = 25.0
    inverter_price_per_kw: float = 8000.0
    structure_price_per_kw: float = 5000.0
    wiring_price_per_meter: float = 50.0
    labor_price_per_kw: float = 3000.0
    transportation_base: float = 5000.0
    margin_percentage: float = 15.0
    gst_percentage: float = 13.8
    battery_price_per_ah: float = 150.0

class CostEstimation(BaseModel):
    panels_required: int
    total_capacity_kw: float
    panel_cost: float
    inverter_cost: float
    structure_cost: float
    wiring_cost: float
    labor_cost: float
    transportation_cost: float
    subtotal: float
    margin: float
    gst: float
    total_cost: float

class AIRecommendationRequest(BaseModel):
    monthly_consumption_units: float
    sanction_load_kw: float
    roof_type: str
    budget_range: Optional[str] = None

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

def calculate_cost_estimation(project: dict, pricing: dict) -> dict:
    """Calculate cost estimation based on project details and pricing config"""
    electrical = project.get("electrical", {})
    solar_system = project.get("solar_system", {})
    additional = project.get("additional", {})
    
    monthly_consumption = electrical.get("monthly_consumption_units", 0)
    panel_wattage = solar_system.get("panel_wattage", 540)
    
    # Calculate required capacity (rough estimate: monthly units / 120 = kW needed)
    required_kw = max(1, monthly_consumption / 120)
    total_capacity_kw = round(required_kw, 2)
    
    # Calculate panels needed
    panels_required = int((total_capacity_kw * 1000) / panel_wattage) + 1
    
    # Calculate costs
    panel_cost = panels_required * panel_wattage * pricing.get("panel_price_per_watt", 25)
    inverter_cost = total_capacity_kw * pricing.get("inverter_price_per_kw", 8000)
    structure_cost = total_capacity_kw * pricing.get("structure_price_per_kw", 5000)
    
    cable_length = additional.get("cable_length_meters", 50)
    wiring_cost = cable_length * pricing.get("wiring_price_per_meter", 50)
    
    labor_cost = total_capacity_kw * pricing.get("labor_price_per_kw", 3000)
    transportation_cost = pricing.get("transportation_base", 5000)
    
    # Battery cost if applicable
    battery_cost = 0
    if solar_system.get("battery_required") and solar_system.get("battery_capacity_ah"):
        battery_cost = solar_system["battery_capacity_ah"] * pricing.get("battery_price_per_ah", 150)
    
    subtotal = panel_cost + inverter_cost + structure_cost + wiring_cost + labor_cost + transportation_cost + battery_cost
    
    margin_percentage = pricing.get("margin_percentage", 15)
    margin = subtotal * (margin_percentage / 100)
    
    subtotal_with_margin = subtotal + margin
    
    gst_percentage = pricing.get("gst_percentage", 13.8)
    gst = subtotal_with_margin * (gst_percentage / 100)
    
    total_cost = subtotal_with_margin + gst
    
    return {
        "panels_required": panels_required,
        "total_capacity_kw": total_capacity_kw,
        "panel_cost": round(panel_cost, 2),
        "inverter_cost": round(inverter_cost, 2),
        "structure_cost": round(structure_cost, 2),
        "wiring_cost": round(wiring_cost, 2),
        "labor_cost": round(labor_cost, 2),
        "transportation_cost": round(transportation_cost, 2),
        "battery_cost": round(battery_cost, 2),
        "subtotal": round(subtotal, 2),
        "margin": round(margin, 2),
        "margin_percentage": margin_percentage,
        "gst": round(gst, 2),
        "gst_percentage": gst_percentage,
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
    await require_role("admin")(request)
    
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
    await require_role("admin")(request)
    
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
    
    return {"message": "User updated successfully"}

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    current_user = await require_role("admin")(request)
    
    if current_user["id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    result = await db.users.delete_one({"_id": ObjectId(user_id)})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"message": "User deleted successfully"}

# ================== PRICING CONFIG (Admin Only) ==================

@api_router.get("/pricing")
async def get_pricing(request: Request):
    await get_current_user(request)
    
    pricing = await db.pricing_config.find_one({}, {"_id": 0})
    if not pricing:
        # Return default pricing
        return PricingConfig().model_dump()
    return pricing

@api_router.put("/pricing")
async def update_pricing(pricing: PricingConfig, request: Request):
    await require_role("admin")(request)
    
    await db.pricing_config.update_one(
        {},
        {"$set": pricing.model_dump()},
        upsert=True
    )
    
    return {"message": "Pricing updated successfully"}

# ================== PROJECTS ==================

@api_router.post("/projects")
async def create_project(project: ProjectCreate, request: Request):
    user = await get_current_user(request)
    
    # Get pricing for cost estimation
    pricing = await db.pricing_config.find_one({}, {"_id": 0})
    if not pricing:
        pricing = PricingConfig().model_dump()
    
    project_doc = {
        "customer": project.customer.model_dump(),
        "location": project.location.model_dump(),
        "electrical": project.electrical.model_dump(),
        "solar_system": project.solar_system.model_dump(),
        "mounting": project.mounting.model_dump(),
        "additional": project.additional.model_dump(),
        "site_images": project.site_images,
        "status": "draft",
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Calculate cost estimation
    project_doc["cost_estimation"] = calculate_cost_estimation(project_doc, pricing)
    
    result = await db.projects.insert_one(project_doc)
    
    return {
        "id": str(result.inserted_id),
        "message": "Project created successfully"
    }

@api_router.get("/projects")
async def get_projects(request: Request, status: Optional[str] = None):
    user = await get_current_user(request)
    
    query = {}
    
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
    
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Staff can only see their own projects
    if user["role"] == "staff" and project["created_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    return {
        "id": str(project["_id"]),
        "customer": project["customer"],
        "location": project["location"],
        "electrical": project["electrical"],
        "solar_system": project["solar_system"],
        "mounting": project["mounting"],
        "additional": project["additional"],
        "site_images": project.get("site_images", []),
        "status": project["status"],
        "cost_estimation": project.get("cost_estimation", {}),
        "created_by": project["created_by"],
        "created_by_name": project.get("created_by_name", "Unknown"),
        "created_at": project["created_at"],
        "updated_at": project["updated_at"],
        "approved_by": project.get("approved_by"),
        "approved_at": project.get("approved_at"),
        "rejection_reason": project.get("rejection_reason")
    }

@api_router.put("/projects/{project_id}")
async def update_project(project_id: str, updates: ProjectUpdate, request: Request):
    user = await get_current_user(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    
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
    if updates.status and user["role"] in ["admin", "manager"]:
        update_data["status"] = updates.status
    
    # Recalculate cost if relevant fields changed
    if any(k in update_data for k in ["electrical", "solar_system", "additional"]):
        pricing = await db.pricing_config.find_one({}, {"_id": 0})
        if not pricing:
            pricing = PricingConfig().model_dump()
        
        # Merge with existing project data
        merged = {**project}
        merged.update(update_data)
        update_data["cost_estimation"] = calculate_cost_estimation(merged, pricing)
    
    await db.projects.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": update_data}
    )
    
    return {"message": "Project updated successfully"}

@api_router.post("/projects/{project_id}/submit")
async def submit_project(project_id: str, request: Request):
    user = await get_current_user(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    
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
    
    return {"message": "Project submitted for review"}

@api_router.post("/projects/{project_id}/approve")
async def approve_project(project_id: str, request: Request):
    user = await require_role("admin", "manager")(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    
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
    
    return {"message": "Project approved"}

@api_router.post("/projects/{project_id}/reject")
async def reject_project(project_id: str, request: Request):
    user = await require_role("admin", "manager")(request)
    
    body = await request.json()
    reason = body.get("reason", "No reason provided")
    
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    
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
    
    return {"message": "Project rejected"}

@api_router.post("/projects/{project_id}/complete")
async def complete_project(project_id: str, request: Request):
    user = await require_role("admin", "manager")(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    
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
    
    return {"message": "Project marked as completed"}

@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, request: Request):
    user = await get_current_user(request)
    
    project = await db.projects.find_one({"_id": ObjectId(project_id)})
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Staff can only delete their own draft projects
    if user["role"] == "staff":
        if project["created_by"] != user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
        if project["status"] != "draft":
            raise HTTPException(status_code=400, detail="Can only delete draft projects")
    
    await db.projects.delete_one({"_id": ObjectId(project_id)})
    
    return {"message": "Project deleted"}

# ================== DASHBOARD STATS ==================

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(request: Request):
    user = await get_current_user(request)
    
    query = {}
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
    
    # Seed admin user
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@sensoper.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    
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
    
    # Seed default pricing if not exists
    pricing = await db.pricing_config.find_one({})
    if not pricing:
        await db.pricing_config.insert_one(PricingConfig().model_dump())
        logger.info("Default pricing configuration created")
    
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
    allow_origins=[frontend_url, "http://localhost:3000", "https://solar-estimator-14.preview.emergentagent.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)
