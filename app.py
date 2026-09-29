"""
FastAPI application for coordinate mapping and clustering.

This is a web wrapper around the clustering logic. The clustering module
can be replaced with your exact implementation.
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import csv
import io
import json
import os
from typing import List, Dict, Optional
from pydantic import BaseModel

from clustering import cluster_customers, get_customer_cluster_mapping

app = FastAPI(title="CCBA Audit Map")

# CORS middleware for browser access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files (frontend) - must be before root route
import os
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")


class CustomerPoint(BaseModel):
    """Customer point data model"""
    account_number: str
    name: str
    latitude: float
    longitude: float
    color: Optional[str] = None


class ClusterData(BaseModel):
    """Cluster data model"""
    cluster_id: str
    name: str
    center_lat: float
    center_lon: float
    color: str
    customers: List[str]


class ProcessedData(BaseModel):
    """Processed data response"""
    customers: List[CustomerPoint]
    clusters: List[ClusterData]
    customer_cluster_map: Dict[str, str]


@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve the main application page"""
    html_path = os.path.join("static", "index.html")
    if not os.path.exists(html_path):
        return HTMLResponse(
            content="<h1>Error</h1><p>Static files not found. Please ensure the 'static' directory exists.</p>",
            status_code=404
        )
    with open(html_path, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


def _strip_wrapping_quotes(raw: str) -> str:
    """Remove surrounding single/double quotes repeatedly (e.g. '\"#ff0000\"' -> #ff0000)."""
    s = str(raw).strip()
    while len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
        s = s[1:-1].strip()
    return s


def _normalize_color(raw: str) -> Optional[str]:
    """Normalize CSV color to a value usable in CSS (hex or pass-through for valid CSS color strings)."""
    if not raw:
        return None
    s = _strip_wrapping_quotes(raw)
    if not s:
        return None
    # Hex without # (e.g. ff0000 or f00)
    hex_candidate = s[1:] if s.startswith('#') else s
    if len(hex_candidate) in (3, 6) and all(c in '0123456789AaBbCcDdEeFf' for c in hex_candidate):
        if len(hex_candidate) == 3:
            hex_candidate = (
                f"{hex_candidate[0]}{hex_candidate[0]}"
                f"{hex_candidate[1]}{hex_candidate[1]}"
                f"{hex_candidate[2]}{hex_candidate[2]}"
            )
        return f"#{hex_candidate}"
    # Pass through named colors/rgb()/hsl()/etc.
    return s


def _normalize_header(h: str) -> str:
    """Single canonical form for header matching: strip BOM/whitespace, lowercase, collapse spaces."""
    if not h:
        return ""
    s = h.strip().strip("\ufeff").lower()
    s = s.replace("_", " ").replace("-", " ")
    return " ".join(s.split())


def _find_column_key(headers: list, *candidate_names: str) -> Optional[str]:
    """Return the actual CSV column key that matches one of the candidate names (e.g. 'customer color')."""
    norm_to_key = {}
    for k in headers:
        n = _normalize_header(k)
        if n:
            norm_to_key[n] = k
    for c in candidate_names:
        n = _normalize_header(c)
        if n in norm_to_key:
            return norm_to_key[n]
    # Match header that contains both "customer" and "color" (e.g. "Customer Color", "Customer C")
    for k in headers:
        n = _normalize_header(k)
        if "customer" in n and "color" in n:
            return k
    return None


def _find_customer_color_column(headers: list) -> Optional[str]:
    """
    Resolve likely customer/location color column names.

    Priority:
    1) Exact/common names
    2) Any header containing customer + (color|colour)
    3) Any header containing a location-like qualifier + (color|colour)
    4) Generic color/colour column
    """
    norm_to_key = {}
    normalized = []
    for k in headers:
        n = _normalize_header(k)
        if n:
            norm_to_key[n] = k
            normalized.append((k, n))

    exact_candidates = (
        "customer color",
        "customer colour",
        "location color",
        "location colour",
        "assigned color",
        "assigned colour",
        "marker color",
        "marker colour",
        "point color",
        "point colour",
    )
    for c in exact_candidates:
        if c in norm_to_key:
            return norm_to_key[c]

    for original, n in normalized:
        has_color_word = ("color" in n) or ("colour" in n)
        if has_color_word and "customer" in n:
            return original

    qualifiers = ("location", "assigned", "marker", "point", "pin", "dot", "area", "cluster")
    for original, n in normalized:
        has_color_word = ("color" in n) or ("colour" in n)
        if has_color_word and any(q in n for q in qualifiers):
            return original

    for c in ("color", "colour"):
        if c in norm_to_key:
            return norm_to_key[c]

    return None


def _get_customer_color_from_row(row: dict, color_column_key: Optional[str]) -> Optional[str]:
    """Read Customer Color from row. Tries exact 'Customer Color' then resolved key."""
    raw = None
    if "Customer Color" in row and row["Customer Color"] is not None:
        raw = str(row["Customer Color"]).strip()
    if (not raw or raw == "") and color_column_key and color_column_key in row and row[color_column_key] is not None:
        raw = str(row[color_column_key]).strip()
    if not raw or raw == "":
        return None
    return _normalize_color(raw)


@app.post("/api/upload", response_model=ProcessedData)
async def upload_csv(file: UploadFile = File(...)):
    """
    Upload CSV file and process coordinates.

    Required columns:
    - Latitude
    - Longitude
    - Customer Account Name (or Customer Name)

    Optional columns:
    - Customer Account Number (unique ID; if missing, Customer Account Name or row index is used)
    - Customer Color (or Customer Colour / Location Color / Assigned Color / etc.)
      (hex e.g. #ff0000 or CSS color name; used for marker color)
    - Existing Cluster / Area Name, User-Assigned Area Name (ignored on import; used on export)
    """
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    
    # Read CSV content (try common encodings so "Customer Color" header is read correctly)
    contents = await file.read()
    text = None
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = contents.decode(encoding)
            break
        except (UnicodeDecodeError, LookupError):
            continue
    if text is None:
        text = contents.decode("latin-1")  # never fails
    csv_reader = csv.DictReader(io.StringIO(text))
    
    # Validate required columns.
    # Required: Latitude, Longitude, and a name column (Customer Account Name or Customer Name).
    # Customer Account Number is optional; if missing, we use Customer Account Name (plus index for duplicates) as unique ID.
    required_base_columns = ['Latitude', 'Longitude']
    rows = list(csv_reader)
    
    if not rows:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    headers = list(rows[0].keys()) if rows else []
    missing_base = [col for col in required_base_columns if col not in headers]
    has_account_name = 'Customer Account Name' in headers
    has_customer_name = 'Customer Name' in headers

    if missing_base or not (has_account_name or has_customer_name):
        missing_parts = list(missing_base)
        if not (has_account_name or has_customer_name):
            missing_parts.append("Customer Account Name (or Customer Name)")
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns: {', '.join(missing_parts)}"
        )
    
    # Resolve a likely color column for customer/location marker colors
    customer_color_column = _find_customer_color_column(headers)
    
    # Parse customers
    customers = []
    seen_accounts = set()
    
    for idx, row in enumerate(rows):
        # Unique ID: prefer "Customer Account Number", else "Customer Account Name", else name + index
        name = (row.get('Customer Account Name') or row.get('Customer Name') or "").strip()
        raw_id = (row.get('Customer Account Number') or "").strip()
        if raw_id:
            account_number = raw_id
        else:
            account_number = name or f"Row_{idx + 1}"
        
        # Deduplicate: if same account_number already seen, make this one unique
        if account_number in seen_accounts:
            account_number = f"{account_number}_{idx + 1}"
        seen_accounts.add(account_number)
        
        try:
            lat = float(row['Latitude'])
            lon = float(row['Longitude'])
            # Customer Color from CSV (column resolved once above)
            color = _get_customer_color_from_row(row, customer_color_column)

            # Validate coordinates
            if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                continue

            customers.append({
                'Customer Account Number': account_number,
                'Customer Account Name': name,
                'Customer Name': name,
                'Latitude': lat,
                'Longitude': lon,
                'Customer Color': color,
            })
        except (ValueError, KeyError):
            continue
    
    if not customers:
        raise HTTPException(status_code=400, detail="No valid customer data found")
    
    # Apply clustering logic (from clustering.py)
    clusters_dict = cluster_customers(customers)
    customer_cluster_map = get_customer_cluster_mapping(clusters_dict)
    
    # Format response (include color from CSV for each customer)
    customer_points = [
        CustomerPoint(
            account_number=c['Customer Account Number'],
            name=c['Customer Account Name'],
            latitude=c['Latitude'],
            longitude=c['Longitude'],
            color=c.get('Customer Color') or None,
        )
        for c in customers
    ]
    
    cluster_list = [
        ClusterData(
            cluster_id=cluster_id,
            name=cluster_data['name'],
            center_lat=cluster_data['center_lat'],
            center_lon=cluster_data['center_lon'],
            color=cluster_data['color'],
            customers=cluster_data['customers']
        )
        for cluster_id, cluster_data in clusters_dict.items()
    ]
    
    return ProcessedData(
        customers=customer_points,
        clusters=cluster_list,
        customer_cluster_map=customer_cluster_map
    )


@app.post("/api/export/csv")
async def export_csv(data: Dict):
    """
    Export data as CSV.
    
    Expected data structure:
    {
        "customers": [...],
        "clusters": {...},
        "customer_cluster_map": {...},
        "user_areas": {...},
        "customer_colors": {...}
    }
    """
    try:
        customers = data.get('customers', [])
        clusters = data.get('clusters', {})
        customer_cluster_map = data.get('customer_cluster_map', {})
        user_areas = data.get('user_areas', {})
        customer_colors = data.get('customer_colors', {})
        
        # Create reverse mapping for user areas
        account_to_user_area = {}
        for area_id, area_data in user_areas.items():
            for account in area_data.get('customers', []):
                account_to_user_area[account] = area_data.get('name', '')
        
        # Prepare CSV rows
        rows = []
        for customer in customers:
            account = customer['account_number']
            cluster_id = customer_cluster_map.get(account, '')
            cluster_name = clusters.get(cluster_id, {}).get('name', '') if cluster_id else ''
            user_area_name = account_to_user_area.get(account, '')
            color = customer_colors.get(account, '')
            
            rows.append({
                'Customer Account Number': account,
                'Customer Account Name': customer['name'],
                'Latitude': customer['latitude'],
                'Longitude': customer['longitude'],
                'Existing Cluster / Area Name': cluster_name,
                'User-Assigned Area Name': user_area_name,
                'Customer Color': color
            })
        
        # Generate CSV
        output = io.StringIO()
        if rows:
            fieldnames = [
                'Customer Account Number',
                'Customer Account Name',
                'Latitude',
                'Longitude',
                'Existing Cluster / Area Name',
                'User-Assigned Area Name',
                'Customer Color'
            ]
            writer = csv.DictWriter(output, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        
        csv_content = output.getvalue()
        
        return JSONResponse(
            content={"csv": csv_content},
            headers={"Content-Type": "application/json"}
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
