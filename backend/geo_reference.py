"""Iter 54 — fixed Indian state/district reference list for vendor location dropdowns + checkbox filters."""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

INDIAN_STATES: List[str] = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
    "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
]

DISTRICTS_BY_STATE: Dict[str, List[str]] = {
    "Tamil Nadu": ["Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode",
                   "Kallakurichi", "Kancheepuram", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam",
                   "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem",
                   "Sivaganga", "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli",
                   "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram",
                   "Virudhunagar"],
    "Kerala": ["Alappuzha", "Ernakulam", "Idukki", "Kannur", "Kasaragod", "Kollam", "Kottayam", "Kozhikode",
               "Malappuram", "Palakkad", "Pathanamthitta", "Thiruvananthapuram", "Thrissur", "Wayanad"],
    "Karnataka": ["Bagalkot", "Ballari", "Belagavi", "Bengaluru Rural", "Bengaluru Urban", "Bidar", "Chamarajanagar",
                  "Chikkaballapur", "Chikkamagaluru", "Chitradurga", "Dakshina Kannada", "Davanagere", "Dharwad",
                  "Gadag", "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal", "Mandya", "Mysuru",
                  "Raichur", "Ramanagara", "Shivamogga", "Tumakuru", "Udupi", "Uttara Kannada", "Vijayanagara",
                  "Vijayapura", "Yadgir"],
    "Andhra Pradesh": ["Alluri Sitharama Raju", "Anakapalli", "Anantapur", "Annamayya", "Bapatla", "Chittoor",
                       "East Godavari", "Eluru", "Guntur", "Kakinada", "Konaseema", "Krishna", "Kurnool", "Nandyal",
                       "NTR", "Palnadu", "Parvathipuram Manyam", "Prakasam", "Sri Sathya Sai", "Srikakulam",
                       "SPSR Nellore", "Tirupati", "Visakhapatnam", "Vizianagaram", "West Godavari", "YSR Kadapa"],
    "Telangana": ["Adilabad", "Bhadradri Kothagudem", "Hanumakonda", "Hyderabad", "Jagtial", "Jangaon",
                  "Jayashankar Bhupalpally", "Jogulamba Gadwal", "Kamareddy", "Karimnagar", "Khammam",
                  "Kumuram Bheem Asifabad", "Mahabubabad", "Mahabubnagar", "Mancherial", "Medak", "Medchal-Malkajgiri",
                  "Mulugu", "Nagarkurnool", "Nalgonda", "Narayanpet", "Nirmal", "Nizamabad", "Peddapalli",
                  "Rajanna Sircilla", "Ranga Reddy", "Sangareddy", "Siddipet", "Suryapet", "Vikarabad", "Wanaparthy",
                  "Warangal", "Yadadri Bhuvanagiri"],
    "Puducherry": ["Karaikal", "Mahe", "Puducherry", "Yanam"],
}


class ExtraDistrictIn(BaseModel):
    state: str
    district: str


def create_router(db, get_current_user, require_role, get_default_pincodes):
    router = APIRouter()

    async def _extras() -> Dict[str, List[str]]:
        doc = await db.geo_config.find_one({"key": "extra_districts"}) or {}
        return doc.get("districts", {})

    def _pincode_districts() -> Dict[str, List[str]]:
        out: Dict[str, List[str]] = {}
        for p in get_default_pincodes() or []:
            st, d = p.get("state"), p.get("district")
            if st and d and st != "ALL":
                out.setdefault(st, [])
                if d not in out[st]:
                    out[st].append(d)
        return out

    async def _districts_for(state: Optional[str]) -> Dict[str, List[str]]:
        merged: Dict[str, List[str]] = {s: list(d) for s, d in DISTRICTS_BY_STATE.items()}
        for src in (_pincode_districts(), await _extras()):
            for s, ds in src.items():
                merged.setdefault(s, [])
                for d in ds:
                    if d not in merged[s]:
                        merged[s].append(d)
        for s in merged:
            merged[s].sort()
        if state:
            return {state: merged.get(state, [])}
        return merged

    @router.get("/geo/states")
    async def list_states(request: Request):
        await get_current_user(request)
        return INDIAN_STATES

    @router.get("/geo/districts")
    async def list_districts(request: Request, state: Optional[str] = None):
        await get_current_user(request)
        return await _districts_for(state)

    @router.post("/geo/districts")
    async def add_district(payload: ExtraDistrictIn, request: Request):
        await require_role("admin")(request)
        state, district = payload.state.strip(), payload.district.strip()
        if state not in INDIAN_STATES or not district:
            raise HTTPException(status_code=400, detail="Pick a valid state and a non-empty district name")
        await db.geo_config.update_one({"key": "extra_districts"}, {"$addToSet": {f"districts.{state}": district}}, upsert=True)
        return await _districts_for(state)

    return router
