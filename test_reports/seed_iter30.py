"""Seed a completed project with completion_drive_link + inverter_login + solar_report,
prints the project_id to stdout. Used by the Playwright E2E test in iteration 30."""
import os
import sys
import requests

BASE_URL = 'https://solar-ops-management.preview.emergentagent.com'
s = requests.Session()
r = s.post(f'{BASE_URL}/api/auth/login',
           json={'email': 'admin@sensoper.com', 'password': 'Admin@123'})
assert r.status_code == 200, f'login {r.status_code} {r.text}'

payload = {
    "customer": {"name": "TEST_Iter30_E2E", "phone": "9999988888",
                 "email": "iter30e2e@example.com",
                 "address": "1, Test St, Chennai"},
    "location": {"site_address": "1, Test St, Chennai", "latitude": 13.08,
                 "longitude": 80.27, "state": "Tamil Nadu", "district": "Chennai"},
    "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4,
                   "monthly_consumption_units": 500, "tariff_category": "Domestic",
                   "connection_type": "Single Phase", "phase": "single",
                   "voltage": 230, "eb_tariff": 6.5},
    "solar_system": {"system_type": "on-grid", "panel_wattage_w": 540,
                     "panel_count": 8, "inverter_capacity_kw": 4},
    "mounting": {"structure_type": "RCC", "roof_type": "rcc", "tilt_angle": 15},
    "additional": {"cable_length_meters": 30, "inverter_to_panel_distance": 5},
    "selected_items": [], "manual_costs": [], "site_images": [],
    "solar_report": {
        "system_overview": {"system_size_kw": 5.0, "panel_count": 9,
                            "inverter_capacity_kw": 5, "total_investment": 350000,
                            "expected_generation_kwh_year": 7300, "co2_offset_tons_year": 5},
        "cost_breakdown": [{"name": "Panels", "value": 200000},
                           {"name": "Inverter", "value": 80000},
                           {"name": "Mounting", "value": 30000},
                           {"name": "Cabling", "value": 25000},
                           {"name": "Installation", "value": 15000}],
        "energy_source_mix": [{"name": "Solar", "value": 70},
                               {"name": "Grid", "value": 30}],
        "monthly_economics": [{"month": "Jan", "generation": 600, "savings": 4000}],
        "savings_projection": [{"year": i, "cumulative_savings": i * 50000} for i in range(1, 26)],
        "payback_years": 5.2, "roi_percent": 18, "total_savings_25y": 1250000,
        "monthly_savings_year1": 4500
    }
}
r = s.post(f'{BASE_URL}/api/projects', json=payload)
assert r.status_code in (200, 201), f'create {r.status_code} {r.text}'
pid = r.json()['id']
# submit
r = s.put(f'{BASE_URL}/api/projects/{pid}/status', json={'status': 'submitted'})
assert r.status_code == 200, r.text
# approve
r = s.put(f'{BASE_URL}/api/projects/{pid}/status', json={'status': 'approved'})
assert r.status_code == 200, r.text
# complete
r = s.post(f'{BASE_URL}/api/projects/{pid}/complete',
           json={'completion_drive_link': 'https://drive.google.com/drive/folders/TESTITER30',
                 'inverter_login': {'url': 'https://inv.example.com',
                                    'username': 'admin@iter30',
                                    'password': 'SuperSecret123!',
                                    'notes': 'WiFi SSID: SolarNet'},
                 'customer_feedback': 'Great install'})
assert r.status_code == 200, f'complete {r.status_code} {r.text}'

# Get the auth cookie value
cookie = None
for c in s.cookies:
    if c.name in ('access_token', 'auth_token', 'token', 'session'):
        cookie = (c.name, c.value)
        break
print(f'PROJECT_ID={pid}')
print(f'COOKIE_NAME={cookie[0] if cookie else "NONE"}')
print(f'COOKIE_VALUE={cookie[1] if cookie else "NONE"}')
