"""Seed a project with a REAL solar_report (sizing+financials from /api/solar/sizing)."""
import os, requests, sys
BASE = 'https://solar-ops-management.preview.emergentagent.com'
s = requests.Session()
r = s.post(f'{BASE}/api/auth/login', json={'email':'admin@sensoper.com','password':'Admin@123'})
assert r.status_code==200,r.text

# 1) get a real sizing result
sz = s.post(f'{BASE}/api/solar/sizing', json={
    "monthly_consumption_units": 500, "avg_monthly_bill": 3500,
    "tariff_per_unit": 6.5, "system_type": "on-grid",
    "irradiation_kwh_m2_day": 5.33, "cost_per_kwp": 65000,
    "performance_ratio": 0.75, "panel_wattage_w": 540
}).json()

solar_report = {
    "sizing": sz["sizing"], "financials": sz["financials"], "technical": sz["technical"],
    "assumptions": sz["assumptions"],
    "service_number": "012345678901", "consumer_name": "TEST_Iter30_PDF",
    "avg_monthly_bill": 3500, "avg_monthly_consumption": 500,
    "tariff_category": "Domestic", "system_type": "on-grid",
    "monthly_savings_year1": sz["financials"]["monthly_savings"],
}

payload = {
    "customer":{"name":"TEST_Iter30_PDF","phone":"9999988888","email":"pdf@x.com","address":"1 Test St, Chennai"},
    "location":{"site_address":"1 Test St","latitude":13.0,"longitude":80.2,"state":"TN","district":"Chennai"},
    "electrical":{"sanction_load_kw":5,"connected_load_kw":4,"monthly_consumption_units":500,
                  "tariff_category":"Domestic","connection_type":"Single Phase","phase":"single",
                  "voltage":230,"eb_tariff":6.5},
    "solar_system":{"system_type":"on-grid","panel_wattage_w":540,"panel_count":9,"inverter_capacity_kw":5},
    "mounting":{"structure_type":"RCC","roof_type":"rcc","tilt_angle":15},
    "additional":{"cable_length_meters":30,"inverter_to_panel_distance":5},
    "selected_items":[],"manual_costs":[],"site_images":[],
    "solar_report": solar_report
}
r = s.post(f'{BASE}/api/projects', json=payload)
assert r.status_code in (200,201), r.text
pid = r.json()['id']
print(f'PROJECT_ID={pid}')
