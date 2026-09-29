"""
clustering.py

Clustering module for coordinate mapping.

⚠️ CRITICAL — READ BEFORE EDITING ⚠️

This module CONTAINS PLACEHOLDER CLUSTERING LOGIC.

You MUST replace ONLY the body of the function:
    cluster_customers()

with your EXACT existing clustering implementation in order to preserve:
- Distance thresholds
- Grouping rules
- Conditions preventing over-grouping
- All existing behavior and edge cases

🚫 DO NOT:
- Change the function name
- Change the function signature
- Change the return structure
- Move clustering logic outside this file

The rest of the application depends on this contract.
"""

import math
from typing import List, Dict


# ---------------------------------------------------------------------
# Utility: Distance calculation (KEEP if used by your real logic)
# ---------------------------------------------------------------------
def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points on Earth.
    Returns distance in kilometers.
    """
    R = 6371  # Earth radius in km

    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.asin(math.sqrt(a))
    return R * c


# ---------------------------------------------------------------------
# 🚨 CLUSTERING FUNCTION — REPLACE BODY ONLY 🚨
# ---------------------------------------------------------------------
def cluster_customers(customers: List[Dict]) -> Dict[str, Dict]:
    """
    Cluster customers based on geographic proximity.

    INPUT (DO NOT CHANGE):
        customers: List of dicts with keys:
            - 'Latitude'
            - 'Longitude'
            - 'Customer Account Number'
            - 'Customer Account Name'

    OUTPUT (DO NOT CHANGE):
        Dict[str, Dict] where each value contains:
            - cluster_id: str
            - name: str
            - customers: List[str] (account numbers)
            - center_lat: float
            - center_lon: float
            - color: str (hex)

    ⚠️ REPLACE ONLY THE IMPLEMENTATION BELOW ⚠️
    """

    # -----------------------------
    # PLACEHOLDER IMPLEMENTATION
    # -----------------------------
    # ❌ THIS IS NOT YOUR REAL LOGIC
    # ❌ THIS EXISTS ONLY SO THE APP RUNS
    # ✔ REPLACE EVERYTHING BELOW WITH YOUR REAL CODE
    # -----------------------------

    if not customers:
        return {}

    DISTANCE_THRESHOLD_KM = 5.0   # ⚠️ REPLACE WITH REAL VALUE
    MIN_CLUSTER_SIZE = 1          # ⚠️ REPLACE WITH REAL VALUE

    clusters: Dict[str, Dict] = {}
    assigned = set()
    cluster_index = 0

    for i, customer in enumerate(customers):
        account = customer["Customer Account Number"]

        if account in assigned:
            continue

        # Start new cluster
        group = [customer]
        assigned.add(account)

        for j, other in enumerate(customers):
            other_account = other["Customer Account Number"]

            if i == j or other_account in assigned:
                continue

            dist = haversine_distance(
                float(customer["Latitude"]),
                float(customer["Longitude"]),
                float(other["Latitude"]),
                float(other["Longitude"]),
            )

            if dist <= DISTANCE_THRESHOLD_KM:
                group.append(other)
                assigned.add(other_account)

        if len(group) >= MIN_CLUSTER_SIZE:
            center_lat = sum(float(c["Latitude"]) for c in group) / len(group)
            center_lon = sum(float(c["Longitude"]) for c in group) / len(group)

            cluster_id = f"cluster_{cluster_index}"

            clusters[cluster_id] = {
                "cluster_id": cluster_id,
                "name": f"Area {cluster_index + 1}",
                "customers": [c["Customer Account Number"] for c in group],
                "center_lat": center_lat,
                "center_lon": center_lon,
                "color": "#3388ff",  # default color
            }

            cluster_index += 1

    return clusters


# ---------------------------------------------------------------------
# Helper: Customer → Cluster lookup (SAFE, DO NOT TOUCH)
# ---------------------------------------------------------------------
def get_customer_cluster_mapping(clusters: Dict[str, Dict]) -> Dict[str, str]:
    """
    Create a lookup mapping:
        Customer Account Number → Cluster ID
    """
    mapping: Dict[str, str] = {}

    for cluster_id, cluster_data in clusters.items():
        for account in cluster_data["customers"]:
            mapping[account] = cluster_id

    return mapping
