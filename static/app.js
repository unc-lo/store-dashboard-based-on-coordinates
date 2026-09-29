// Application state
const state = {
    map: null,
    customers: [],
    clusters: {},
    customerClusterMap: {},
    customerColors: {},
    clusterColors: {},
    clusterNames: {},
    userAreas: {},
    drawnCircles: {},
    drawnAreasFeatureGroup: null,
    walkingDistanceLayers: [],
    overlayLayers: [],
    showWalkingDistance: true,
    showOverlays: true,
    showClusters: true,
    showDrawnAreas: true,
    showFreehand: true,
    customerMarkers: {},
    clusterLayers: {},
    drawnAreaLayers: {},
    deletedClusters: {},

    // Freehand pencil drawings (polylines)
    pencil: {
        enabled: false,
        color: '#2ecc71',
        width: 4,
        drawing: false,
        currentId: null,
        currentLayer: null,
        layers: {}, // id -> L.Polyline
        meta: {}    // id -> { id, color, width, pointsCount }
    }
};

// Initialize map centered on Zambia
function initMap() {
    // Check if Leaflet is loaded
    if (typeof L === 'undefined') {
        throw new Error('Leaflet library not loaded. Check if CDN is accessible.');
    }
    
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        throw new Error('Map element not found');
    }
    
    // Ensure map container has explicit height
    const container = mapElement.parentElement;
    if (container) {
        // Calculate available height (viewport - header - sidebar if visible)
        const headerHeight = document.querySelector('header')?.offsetHeight || 80;
        const availableHeight = window.innerHeight - headerHeight;
        
        // Set explicit pixel height
        mapElement.style.height = availableHeight + 'px';
        container.style.height = availableHeight + 'px';
        
        console.log('Map container height set to:', availableHeight + 'px');
    } else {
        // Fallback: use viewport height
        mapElement.style.height = (window.innerHeight - 100) + 'px';
    }
    
    // Remove loading message if present
    const loadingMsg = mapElement.querySelector('div');
    if (loadingMsg && loadingMsg.textContent.includes('Loading')) {
        loadingMsg.remove();
    }
    
    // Create map
    state.map = L.map('map', {
        preferCanvas: false,
        zoomControl: true
    }).setView([-13.1339, 27.8493], 6); // Zambia center
    
    console.log('Map created, adding tile layer...');
    
    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(state.map);
    
    // Invalidate size after tiles load to ensure proper rendering
    state.map.whenReady(() => {
        setTimeout(() => {
            if (state.map) {
                state.map.invalidateSize();
                console.log('Map ready and size invalidated');
            }
        }, 100);
    });
    
    // Create feature group for drawn areas (needed for editing)
    state.drawnAreasFeatureGroup = new L.FeatureGroup();
    state.map.addLayer(state.drawnAreasFeatureGroup);
    
    // Initialize draw control for circles only
    const drawControl = new L.Control.Draw({
        draw: {
            circle: true,
            circlemarker: false,
            marker: false,
            polyline: false,
            polygon: false,
            rectangle: false
        },
        edit: {
            featureGroup: state.drawnAreasFeatureGroup,
            remove: true
        }
    });
    
    state.map.addControl(drawControl);

    // -----------------------------
    // Freehand pencil wiring
    // -----------------------------
    wirePencilControls();
    wirePencilMapEvents();
    
    // Handle circle drawing
    state.map.on(L.Draw.Event.CREATED, (e) => {
        const layer = e.layer;
        const circleId = 'drawn_' + Date.now();
        
        state.drawnCircles[circleId] = {
            id: circleId,
            name: `Drawn Area ${Object.keys(state.drawnCircles).length + 1}`,
            layer: layer,
            center: layer.getLatLng(),
            radius: layer.getRadius()
        };
        
        state.drawnAreaLayers[circleId] = layer;
        
        // Style the circle
        layer.setStyle({
            color: '#ff7800',
            fillColor: '#ff7800',
            fillOpacity: 0.2,
            weight: 2
        });
        
        // Store areaId on layer for tooltip/popup updates
        layer._drawnAreaId = circleId;
        
        // Tooltip: list of customers inside (hover)
        layer.bindTooltip(() => getDrawnAreaTooltipContent(circleId), {
            sticky: true,
            direction: 'top',
            className: 'drawn-area-tooltip',
            offset: [0, -10]
        });
        
        // Popup: list + Export CSV
        layer.bindPopup(getDrawnAreaPopupContent(circleId), { maxWidth: 320 });
        
        // Add to feature group for editing
        state.drawnAreasFeatureGroup.addLayer(layer);
        updateDrawnAreasList();
    });
    
    // Handle circle editing (radius/center changed -> update tooltip & popup)
    state.map.on(L.Draw.Event.EDITED, (e) => {
        const layers = e.layers;
        layers.eachLayer((layer) => {
            const areaId = layer._drawnAreaId;
            for (const [id, area] of Object.entries(state.drawnCircles)) {
                if (area.layer === layer) {
                    state.drawnCircles[id].center = layer.getLatLng();
                    state.drawnCircles[id].radius = layer.getRadius();
                    if (areaId) {
                        layer.setTooltipContent(getDrawnAreaTooltipContent(areaId));
                        layer.setPopupContent(getDrawnAreaPopupContent(areaId));
                    }
                    break;
                }
            }
        });
        updateDrawnAreasList();
    });
    
    // Handle circle deletion
    state.map.on(L.Draw.Event.DELETED, (e) => {
        const layers = e.layers;
        layers.eachLayer((layer) => {
            for (const [id, area] of Object.entries(state.drawnCircles)) {
                if (area.layer === layer) {
                    delete state.drawnCircles[id];
                    delete state.drawnAreaLayers[id];
                    break;
                }
            }
        });
        updateDrawnAreasList();
    });
}

// -----------------------------
// Pencil (freehand) implementation
// -----------------------------
function wirePencilControls() {
    const btn = document.getElementById('pencilToggleBtn');
    const colorEl = document.getElementById('pencilColor');
    const widthEl = document.getElementById('pencilWidth');
    const clearBtn = document.getElementById('clearPencilBtn');

    if (!btn || !colorEl || !widthEl || !clearBtn) return;

    // Init from UI
    state.pencil.color = colorEl.value || state.pencil.color;
    state.pencil.width = Number(widthEl.value) || state.pencil.width;

    const setBtnState = () => {
        btn.textContent = state.pencil.enabled ? 'Pencil: On' : 'Pencil: Off';
        btn.classList.toggle('btn-primary', state.pencil.enabled);
        btn.classList.toggle('btn-secondary', !state.pencil.enabled);
    };

    btn.addEventListener('click', () => {
        state.pencil.enabled = !state.pencil.enabled;
        state.pencil.drawing = false;
        state.pencil.currentLayer = null;
        state.pencil.currentId = null;
        setBtnState();
    });

    colorEl.addEventListener('change', (e) => {
        state.pencil.color = e.target.value || '#2ecc71';
    });

    widthEl.addEventListener('change', (e) => {
        const v = Number(e.target.value);
        state.pencil.width = Math.max(1, Math.min(20, isFinite(v) ? v : 4));
        widthEl.value = String(state.pencil.width);
    });

    clearBtn.addEventListener('click', () => {
        if (!confirm('Delete all pencil drawings?')) return;
        Object.keys(state.pencil.layers).forEach(id => deletePencilDrawing(id, false));
        updatePencilList();
    });

    // Esc to exit pencil mode quickly
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.pencil.enabled) {
            state.pencil.enabled = false;
            state.pencil.drawing = false;
            state.pencil.currentLayer = null;
            state.pencil.currentId = null;
            setBtnState();
        }
    });

    setBtnState();
    updatePencilList();
}

function wirePencilMapEvents() {
    if (!state.map) return;

    const start = (latlng) => {
        const id = 'pencil_' + Date.now();
        state.pencil.drawing = true;
        state.pencil.currentId = id;

        const line = L.polyline([latlng], {
            color: state.pencil.color,
            weight: state.pencil.width,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
        });

        state.pencil.currentLayer = line;
        state.pencil.layers[id] = line;
        state.pencil.meta[id] = { id, color: state.pencil.color, width: state.pencil.width, pointsCount: 1 };

        if (state.showFreehand) {
            line.addTo(state.map);
        }

        // Disable map drag while drawing stroke
        state.map.dragging.disable();
        state.map.doubleClickZoom.disable();
    };

    const addPoint = (latlng) => {
        if (!state.pencil.currentLayer || !state.pencil.currentId) return;
        const latlngs = state.pencil.currentLayer.getLatLngs();
        latlngs.push(latlng);
        state.pencil.currentLayer.setLatLngs(latlngs);
        state.pencil.meta[state.pencil.currentId].pointsCount = latlngs.length;
    };

    const finish = () => {
        if (!state.pencil.drawing) return;
        state.pencil.drawing = false;

        // Re-enable map interactions
        state.map.dragging.enable();
        state.map.doubleClickZoom.enable();

        updatePencilList();
        state.pencil.currentLayer = null;
        state.pencil.currentId = null;
    };

    // Throttle point creation
    let lastAddAt = 0;
    const minMs = 20;

    state.map.on('mousedown', (e) => {
        if (!state.pencil.enabled) return;
        if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest('.leaflet-control')) return;
        start(e.latlng);
        lastAddAt = Date.now();
    });

    state.map.on('mousemove', (e) => {
        if (!state.pencil.enabled || !state.pencil.drawing) return;
        const now = Date.now();
        if (now - lastAddAt < minMs) return;
        lastAddAt = now;
        addPoint(e.latlng);
    });

    state.map.on('mouseup', () => {
        if (!state.pencil.enabled) return;
        finish();
    });

    // If pointer leaves map container, end stroke
    state.map.getContainer().addEventListener('mouseleave', () => {
        if (!state.pencil.enabled) return;
        finish();
    });
}

function updatePencilList() {
    const container = document.getElementById('pencilList');
    if (!container) return;
    container.innerHTML = '';

    const ids = Object.keys(state.pencil.meta);
    if (ids.length === 0) {
        container.innerHTML = '<div style="color: #7f8c8d; font-size: 0.9rem;">No pencil drawings</div>';
        return;
    }

    // Newest first
    ids.sort((a, b) => (b.localeCompare(a)));

    ids.forEach((id) => {
        const meta = state.pencil.meta[id];
        const item = document.createElement('div');
        item.className = 'drawn-area-item';
        item.innerHTML = `
            <div class="drawn-area-header">
                <div class="drawn-area-name">Stroke (${meta.pointsCount} pts)</div>
                <div class="drawn-area-controls">
                    <span class="swatch" style="background:${meta.color}; width:14px; height:14px; border-radius:3px; border:1px solid rgba(0,0,0,0.2);"></span>
                    <button class="btn-small" onclick="deletePencilDrawing('${id}')">Delete</button>
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

function deletePencilDrawing(id, confirmFirst = true) {
    if (!state.pencil.layers[id]) return;
    if (confirmFirst && !confirm('Delete this pencil stroke?')) return;

    const layer = state.pencil.layers[id];
    if (state.map && state.map.hasLayer(layer)) {
        state.map.removeLayer(layer);
    }
    delete state.pencil.layers[id];
    delete state.pencil.meta[id];
    updatePencilList();
}

// Upload CSV file
document.getElementById('uploadBtn').addEventListener('click', () => {
    document.getElementById('csvFile').click();
});

document.getElementById('csvFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            alert(`Error: ${error.detail}`);
            return;
        }
        
        const data = await response.json();
        
        // Clear existing data
        clearMap();
        
        // Store data
        state.customers = data.customers;
        state.customerClusterMap = data.customer_cluster_map;
        
        // Apply Customer Color from CSV (API returns color per customer)
        state.customerColors = {};
        data.customers.forEach((c) => {
            const color = c.color != null ? String(c.color).trim() : '';
            if (color) {
                state.customerColors[c.account_number] = color;
            }
        });
        
        // Reset filters to default
        state.showWalkingDistance = document.getElementById('showWalkingDistance').checked;
        state.showOverlays = document.getElementById('showOverlays').checked;
        
        // Convert clusters array to object
        state.clusters = {};
        data.clusters.forEach(cluster => {
            state.clusters[cluster.cluster_id] = {
                name: cluster.name,
                center_lat: cluster.center_lat,
                center_lon: cluster.center_lon,
                color: cluster.color,
                customers: cluster.customers
            };
            state.clusterNames[cluster.cluster_id] = cluster.name;
            state.clusterColors[cluster.cluster_id] = cluster.color;
        });
        
        // Render map
        renderCustomers();
        renderClusters();
        updateCustomerList();
        updateClusterList();
        
    } catch (error) {
        alert(`Error uploading file: ${error.message}`);
    }
});

// Render customer points
function renderCustomers() {
    state.customers.forEach(customer => {
        // Customer Color: from state (CSV on upload) or from API response, then default red
        const raw = state.customerColors[customer.account_number]
            ?? (customer.color != null ? String(customer.color).trim() : '');
        const color = (raw && raw.length > 0) ? raw : '#e74c3c';
        
        const marker = L.circleMarker(
            [customer.latitude, customer.longitude],
            {
                radius: 8,
                fillColor: color,
                color: '#fff',
                weight: 2,
                fillOpacity: 0.8
            }
        );
        
        // Tooltip: show customer name on hover (explicit open/close for reliability)
        marker.bindTooltip(customer.name, {
            permanent: false,
            direction: 'top',
            offset: [0, -8],
            opacity: 0.95,
            sticky: true
        });
        marker.on('mouseover', () => marker.openTooltip());
        marker.on('mouseout', () => marker.closeTooltip());
        marker.bindPopup(`
            <b>${customer.name}</b><br>
            Account: ${customer.account_number}<br>
            <button onclick="changeCustomerColor('${customer.account_number}')">Change Color</button>
        `);
        
        state.customerMarkers[customer.account_number] = marker;
        marker.addTo(state.map);
        
        // Add walking distance indicators (1km and 2km circles)
        if (state.showWalkingDistance) {
            const walking1km = L.circle(
                [customer.latitude, customer.longitude],
                { radius: 1000, color: '#95a5a6', fillColor: '#95a5a6', fillOpacity: 0.1, weight: 1, dashArray: '5, 5' }
            );
            const walking2km = L.circle(
                [customer.latitude, customer.longitude],
                { radius: 2000, color: '#7f8c8d', fillColor: '#7f8c8d', fillOpacity: 0.05, weight: 1, dashArray: '5, 5' }
            );
            
            state.walkingDistanceLayers.push(walking1km, walking2km);
            walking1km.addTo(state.map);
            walking2km.addTo(state.map);
        }
    });
}

// Render clusters
function renderClusters() {
    Object.entries(state.clusters).forEach(([clusterId, cluster]) => {
        // Skip clusters the user has deleted (visual only)
        if (state.deletedClusters[clusterId]) {
            return;
        }

        const color = state.clusterColors[clusterId] || cluster.color;
        
        // Create a circle for the cluster area
        // Estimate radius based on customer spread
        const customerCoords = state.customers
            .filter(c => cluster.customers.includes(c.account_number))
            .map(c => [c.latitude, c.longitude]);
        
        let maxDistance = 0;
        if (customerCoords.length > 1) {
            customerCoords.forEach(([lat1, lon1]) => {
                customerCoords.forEach(([lat2, lon2]) => {
                    const dist = state.map.distance(
                        L.latLng(lat1, lon1),
                        L.latLng(lat2, lon2)
                    );
                    maxDistance = Math.max(maxDistance, dist);
                });
            });
        } else {
            maxDistance = 1000; // Default 1km radius
        }
        
        const circle = L.circle(
            [cluster.center_lat, cluster.center_lon],
            {
                radius: maxDistance / 2,
                color: color,
                fillColor: color,
                fillOpacity: 0.2,
                weight: 2
            }
        );
        
        circle.bindPopup(`
            <b>${state.clusterNames[clusterId]}</b><br>
            Customers: ${cluster.customers.length}<br>
            <button onclick="renameCluster('${clusterId}')">Rename</button>
            <button onclick="changeClusterColor('${clusterId}')">Change Color</button>
        `);
        
        state.clusterLayers[clusterId] = circle;

        // Respect global visibility toggle
        if (state.showClusters) {
            circle.addTo(state.map);
        }
    });
}

// Update customer list in sidebar
function updateCustomerList() {
    const container = document.getElementById('customerList');
    container.innerHTML = '';
    
    state.customers.forEach(customer => {
        const item = document.createElement('div');
        item.className = 'customer-item';
        item.dataset.account = customer.account_number;
        
        const raw = state.customerColors[customer.account_number]
            ?? (customer.color != null ? String(customer.color).trim() : '');
        const color = (raw && raw.length > 0) ? raw : '#e74c3c';
        
        item.innerHTML = `
            <div class="customer-header">
                <div>
                    <div class="customer-name">${customer.name}</div>
                    <div class="customer-account">${customer.account_number}</div>
                </div>
                <div class="customer-controls">
                    <input type="color" class="color-picker" value="${color}" 
                           onchange="changeCustomerColor('${customer.account_number}', this.value)">
                </div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            const marker = state.customerMarkers[customer.account_number];
            if (marker) {
                state.map.setView(marker.getLatLng(), 15);
                marker.openPopup();
            }
        });
        
        container.appendChild(item);
    });
}

// Update cluster list in sidebar
function updateClusterList() {
    const container = document.getElementById('clusterList');
    container.innerHTML = '';
    
    Object.entries(state.clusters).forEach(([clusterId, cluster]) => {
        // Skip clusters the user has deleted (visual only)
        if (state.deletedClusters[clusterId]) {
            return;
        }

        const item = document.createElement('div');
        item.className = 'cluster-item';
        item.dataset.clusterId = clusterId;
        
        const color = state.clusterColors[clusterId] || cluster.color;
        
        item.innerHTML = `
            <div class="cluster-header">
                <div class="cluster-name">${state.clusterNames[clusterId]}</div>
                <div class="cluster-controls">
                    <input type="color" class="color-picker" value="${color}" 
                           onchange="changeClusterColor('${clusterId}', this.value)">
                </div>
            </div>
            <div style="font-size: 0.8rem; color: #7f8c8d; margin-top: 0.25rem;">
                ${cluster.customers.length} customer(s)
            </div>
            <div style="margin-top: 0.5rem;">
                <button class="btn-small" onclick="renameCluster('${clusterId}')">Rename</button>
                <button class="btn-small" onclick="deleteCluster('${clusterId}')">Delete</button>
            </div>
        `;
        
        item.addEventListener('click', () => {
            const layer = state.clusterLayers[clusterId];
            if (layer) {
                state.map.setView(layer.getLatLng(), 12);
                layer.openPopup();
            }
        });
        
        container.appendChild(item);
    });
}

// -----------------------------
// Customers within drawn circle (for tooltip + CSV export)
// -----------------------------
function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function getCustomersInDrawnArea(areaId) {
    const area = state.drawnCircles[areaId];
    if (!area || !state.customers.length) return [];
    const center = area.center;
    const radiusM = area.radius;
    const lat = center.lat;
    const lon = center.lng;
    return state.customers.filter((c) => haversineMeters(lat, lon, c.latitude, c.longitude) <= radiusM);
}

function getDrawnAreaTooltipContent(areaId) {
    const area = state.drawnCircles[areaId];
    if (!area) return '';
    const inside = getCustomersInDrawnArea(areaId);
    const names = inside.map((c) => c.name);
    const maxShow = 8;
    const shown = names.slice(0, maxShow);
    const rest = names.length - maxShow;
    let list = shown.join(', ');
    if (rest > 0) list += ' and ' + rest + ' more';
    return (
        '<strong>' +
        escapeHtml(area.name) +
        '</strong><br>' +
        inside.length +
        ' customer(s) inside<br>' +
        (list ? escapeHtml(list) : '—') +
        '<br><em>Click to export CSV</em>'
    );
}

function getDrawnAreaPopupContent(areaId) {
    const area = state.drawnCircles[areaId];
    if (!area) return '';
    const inside = getCustomersInDrawnArea(areaId);
    const names = inside.map((c) => c.name);
    const maxShow = 12;
    const shown = names.slice(0, maxShow);
    const rest = names.length - maxShow;
    let listHtml = shown.map((n) => escapeHtml(n)).join('<br>');
    if (rest > 0) listHtml += '<br><em>… and ' + rest + ' more</em>';
    return (
        '<b>' +
        escapeHtml(area.name) +
        '</b><br>' +
        '<span style="font-size:12px">' +
        inside.length +
        ' customer(s) within bounds</span><br>' +
        (listHtml ? '<div style="max-height:120px;overflow:auto;margin:6px 0;text-align:left;font-size:12px">' + listHtml + '</div>' : '') +
        '<button class="btn-small" onclick="exportDrawnAreaCSV(\'' +
        areaId +
        '\')">Export list as CSV</button><br>' +
        '<button onclick="renameDrawnArea(\'' +
        areaId +
        '\')">Rename</button> ' +
        '<button onclick="changeDrawnAreaColor(\'' +
        areaId +
        '\')">Change Color</button>'
    );
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function csvEscape(cell) {
    const s = String(cell);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function exportDrawnAreaCSV(areaId) {
    const area = state.drawnCircles[areaId];
    if (!area) return;
    const inside = getCustomersInDrawnArea(areaId);
    const headers = ['Customer Account Number', 'Customer Account Name', 'Latitude', 'Longitude', 'Drawn Area Name'];
    const rows = inside.map((c) => [c.account_number, c.name, c.latitude, c.longitude, area.name]);
    const csv =
        headers.map(csvEscape).join(',') +
        '\n' +
        rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (area.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'area') + '_customers.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// Update drawn areas list
function updateDrawnAreasList() {
    const container = document.getElementById('drawnAreasList');
    container.innerHTML = '';
    
    if (Object.keys(state.drawnCircles).length === 0) {
        container.innerHTML = '<div style="color: #7f8c8d; font-size: 0.9rem;">No drawn areas</div>';
        return;
    }
    
    Object.entries(state.drawnCircles).forEach(([areaId, area]) => {
        const inside = getCustomersInDrawnArea(areaId);
        const item = document.createElement('div');
        item.className = 'drawn-area-item';
        
        item.innerHTML = `
            <div class="drawn-area-header">
                <div class="drawn-area-name">${escapeHtml(area.name)}</div>
                <div class="drawn-area-controls">
                    <button class="btn-small" onclick="event.stopPropagation(); exportDrawnAreaCSV('${areaId}')" title="Export customers inside as CSV">Export CSV</button>
                    <button class="btn-small" onclick="event.stopPropagation(); renameDrawnArea('${areaId}')">Rename</button>
                    <button class="btn-small" onclick="event.stopPropagation(); changeDrawnAreaColor('${areaId}')">Color</button>
                    <button class="btn-small" onclick="event.stopPropagation(); deleteDrawnArea('${areaId}')">Delete</button>
                </div>
            </div>
            <div style="font-size:0.8rem; color:#7f8c8d; margin-top:0.25rem;">${inside.length} customer(s) inside</div>
        `;
        
        item.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            if (area.layer) {
                state.map.setView(area.center, 14);
                area.layer.openPopup();
            }
        });
        
        container.appendChild(item);
    });
}

// Change customer color
function changeCustomerColor(accountNumber, color = null) {
    if (!color) {
        color = prompt('Enter hex color (e.g., #ff0000):', 
                      state.customerColors[accountNumber] || '#e74c3c');
        if (!color) return;
    }
    
    state.customerColors[accountNumber] = color;
    const marker = state.customerMarkers[accountNumber];
    if (marker) {
        marker.setStyle({
            fillColor: color,
            color: '#fff'
        });
    }
    updateCustomerList();
}

// Change cluster color
function changeClusterColor(clusterId, color = null) {
    if (!color) {
        color = prompt('Enter hex color (e.g., #3388ff):', 
                      state.clusterColors[clusterId] || state.clusters[clusterId].color);
        if (!color) return;
    }
    
    state.clusterColors[clusterId] = color;
    const layer = state.clusterLayers[clusterId];
    if (layer) {
        layer.setStyle({
            color: color,
            fillColor: color
        });
    }
    updateClusterList();
}

// Rename cluster
function renameCluster(clusterId) {
    const currentName = state.clusterNames[clusterId];
    const newName = prompt('Enter new name:', currentName);
    if (newName && newName.trim()) {
        state.clusterNames[clusterId] = newName.trim();
        const layer = state.clusterLayers[clusterId];
        if (layer) {
            layer.setPopupContent(`
                <b>${newName.trim()}</b><br>
                Customers: ${state.clusters[clusterId].customers.length}<br>
                <button onclick="renameCluster('${clusterId}')">Rename</button>
                <button onclick="changeClusterColor('${clusterId}')">Change Color</button>
            `);
        }
        updateClusterList();
    }
}

// Delete (hide) cluster area — visual only, does NOT change cluster membership
function deleteCluster(clusterId) {
    const name = state.clusterNames[clusterId] || state.clusters[clusterId]?.name || clusterId;
    if (!state.clusters[clusterId]) return;

    if (!confirm(`Hide area "${name}" from the map? This does not change cluster membership or exports.`)) {
        return;
    }

    // Mark as deleted in local UI state
    state.deletedClusters[clusterId] = true;

    // Remove layer from map if present
    const layer = state.clusterLayers[clusterId];
    if (layer && state.map.hasLayer(layer)) {
        state.map.removeLayer(layer);
    }

    updateClusterList();
}

// Rename drawn area
function renameDrawnArea(areaId) {
    const area = state.drawnCircles[areaId];
    if (!area) return;
    
    const newName = prompt('Enter new name:', area.name);
    if (newName && newName.trim()) {
        state.drawnCircles[areaId].name = newName.trim();
        if (area.layer) {
            area.layer.setTooltipContent(getDrawnAreaTooltipContent(areaId));
            area.layer.setPopupContent(getDrawnAreaPopupContent(areaId));
        }
        updateDrawnAreasList();
    }
}

// Change drawn area color
function changeDrawnAreaColor(areaId) {
    const area = state.drawnCircles[areaId];
    if (!area) return;
    
    const currentColor = area.layer && (area.layer.options.color || '#ff7800');
    const newColor = prompt('Enter hex color:', currentColor);
    if (newColor) {
        if (area.layer) {
            area.layer.setStyle({
                color: newColor,
                fillColor: newColor
            });
        }
        updateDrawnAreasList();
    }
}

// Delete drawn area
function deleteDrawnArea(areaId) {
    const area = state.drawnCircles[areaId];
    if (!area) return;
    
    if (confirm(`Delete "${area.name}"?`)) {
        if (area.layer) {
            state.map.removeLayer(area.layer);
        }
        delete state.drawnCircles[areaId];
        delete state.drawnAreaLayers[areaId];
        updateDrawnAreasList();
    }
}

// Filter controls
document.getElementById('showWalkingDistance').addEventListener('change', (e) => {
    state.showWalkingDistance = e.target.checked;
    // Toggle walking distance layers
    state.walkingDistanceLayers.forEach(layer => {
        if (state.showWalkingDistance) {
            if (!state.map.hasLayer(layer)) {
                layer.addTo(state.map);
            }
        } else {
            if (state.map.hasLayer(layer)) {
                state.map.removeLayer(layer);
            }
        }
    });
    
    // If enabling, recreate walking distance indicators
    if (state.showWalkingDistance && state.customers.length > 0) {
        // Clear existing
        state.walkingDistanceLayers.forEach(layer => state.map.removeLayer(layer));
        state.walkingDistanceLayers = [];
        
        // Recreate
        state.customers.forEach(customer => {
            const walking1km = L.circle(
                [customer.latitude, customer.longitude],
                { radius: 1000, color: '#95a5a6', fillColor: '#95a5a6', fillOpacity: 0.1, weight: 1, dashArray: '5, 5' }
            );
            const walking2km = L.circle(
                [customer.latitude, customer.longitude],
                { radius: 2000, color: '#7f8c8d', fillColor: '#7f8c8d', fillOpacity: 0.05, weight: 1, dashArray: '5, 5' }
            );
            
            state.walkingDistanceLayers.push(walking1km, walking2km);
            walking1km.addTo(state.map);
            walking2km.addTo(state.map);
        });
    }
});

document.getElementById('showOverlays').addEventListener('change', (e) => {
    state.showOverlays = e.target.checked;
    // Toggle overlay layers
    state.overlayLayers.forEach(layer => {
        if (state.showOverlays) {
            layer.addTo(state.map);
        } else {
            state.map.removeLayer(layer);
        }
    });
});

// Toggle visibility of cluster areas (pre-computed clusters)
document.getElementById('showClusters').addEventListener('change', (e) => {
    state.showClusters = e.target.checked;

    Object.entries(state.clusterLayers).forEach(([clusterId, layer]) => {
        // Respect per-cluster deletion flag
        if (state.deletedClusters[clusterId]) {
            if (state.map.hasLayer(layer)) {
                state.map.removeLayer(layer);
            }
            return;
        }

        if (state.showClusters) {
            if (!state.map.hasLayer(layer)) {
                layer.addTo(state.map);
            }
        } else if (state.map.hasLayer(layer)) {
            state.map.removeLayer(layer);
        }
    });
});

// Toggle visibility of user-drawn areas (circles)
document.getElementById('showDrawnAreas').addEventListener('change', (e) => {
    state.showDrawnAreas = e.target.checked;

    Object.values(state.drawnAreaLayers).forEach(layer => {
        if (state.showDrawnAreas) {
            if (!state.map.hasLayer(layer)) {
                layer.addTo(state.map);
            }
        } else if (state.map.hasLayer(layer)) {
            state.map.removeLayer(layer);
        }
    });
});

// Toggle visibility of pencil drawings (freehand)
document.getElementById('showFreehand').addEventListener('change', (e) => {
    state.showFreehand = e.target.checked;
    Object.values(state.pencil.layers).forEach(layer => {
        if (!state.map) return;
        if (state.showFreehand) {
            if (!state.map.hasLayer(layer)) layer.addTo(state.map);
        } else {
            if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
        }
    });
});

// Clear map
function clearMap() {
    // Remove all markers and layers
    Object.values(state.customerMarkers).forEach(marker => state.map.removeLayer(marker));
    Object.values(state.clusterLayers).forEach(layer => state.map.removeLayer(layer));
    Object.values(state.drawnAreaLayers).forEach(layer => state.map.removeLayer(layer));
    
    state.customerMarkers = {};
    state.clusterLayers = {};
    state.drawnAreaLayers = {};
    state.walkingDistanceLayers = [];
    state.overlayLayers = [];
    state.deletedClusters = {};
    // Note: state.customerColors is only cleared on new CSV upload so CSV "Customer Color" is applied then

    // Clear pencil drawings
    Object.values(state.pencil.layers).forEach(layer => {
        if (state.map && state.map.hasLayer(layer)) state.map.removeLayer(layer);
    });
    state.pencil.layers = {};
    state.pencil.meta = {};
    updatePencilList();
}

// Export map as HTML
document.getElementById('exportMapBtn').addEventListener('click', () => {
    const html = generateMapHTML();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'map_export.html';
    a.click();
    URL.revokeObjectURL(url);
});

// Export offline HTML with embedded OSM tiles (current view/zoom only)
document.getElementById('exportOfflineTilesBtn').addEventListener('click', async () => {
    try {
        if (!state.map) {
            alert('Map is not ready yet.');
            return;
        }
        const html = await generateOfflineMapWithTilesHTML();
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'map_export_offline_with_tiles.html';
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        alert(`Offline export failed: ${e.message}`);
        console.error(e);
    }
});

// Export KML for Google Maps / map apps
document.getElementById('exportKmlBtn').addEventListener('click', () => {
    try {
        const kml = generateKml();
        const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ccba_export.kml';
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        alert(`KML export failed: ${e.message}`);
        console.error(e);
    }
});

function generateMapHTML() {
    // OFFLINE export: fully self-contained HTML (no CDN, no server, no tiles).
    // Renders customers/clusters/drawn circles on an interactive canvas (pan/zoom).

    // Serialize customers
    const customersData = state.customers.map(c => ({
        name: c.name,
        account: c.account_number,
        lat: c.latitude,
        lon: c.longitude,
        color: state.customerColors[c.account_number] || '#e74c3c'
    }));

    // Serialize clusters (skip deleted)
    const clustersData = Object.entries(state.clusters)
        .filter(([id]) => !state.deletedClusters[id])
        .map(([id, cluster]) => ({
            id,
            name: state.clusterNames[id] || cluster.name,
            center_lat: cluster.center_lat,
            center_lon: cluster.center_lon,
            color: state.clusterColors[id] || cluster.color,
            customers: cluster.customers
        }));

    // Serialize drawn areas (include even if currently hidden; export is a snapshot of data)
    const drawnAreasData = Object.entries(state.drawnCircles).map(([id, area]) => ({
        id,
        name: area.name,
        center_lat: area.center.lat,
        center_lon: area.center.lng,
        radius_m: area.radius,
        color: area.layer?.options?.color || '#ff7800'
    }));

    // Use current map center/zoom if available, otherwise Zambia
    const center = state.map ? state.map.getCenter() : { lat: -13.1339, lng: 27.8493 };
    const zoom = state.map ? state.map.getZoom() : 6;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Exported Map (Offline)</title>
  <style>
    html, body { height: 100%; width: 100%; margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    #app { height: 100%; width: 100%; display: flex; flex-direction: column; }
    header { padding: 10px 12px; background: #2c3e50; color: white; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    header .pill { background: rgba(255,255,255,0.12); padding: 6px 10px; border-radius: 999px; font-size: 12px; }
    #stage { position: relative; flex: 1; background: #f7f7f7; overflow: hidden; }
    canvas { display: block; width: 100%; height: 100%; }
    #hud { position: absolute; top: 12px; left: 12px; background: rgba(255,255,255,0.95); border: 1px solid #ddd; border-radius: 8px; padding: 10px; max-width: min(380px, calc(100% - 24px)); box-shadow: 0 2px 10px rgba(0,0,0,0.12); }
    #hud h2 { margin: 0 0 6px 0; font-size: 14px; }
    #hud .row { font-size: 12px; color: #333; margin-top: 4px; }
    #hud .muted { color: #666; }
    #tooltip { position: absolute; pointer-events: none; display: none; background: rgba(0,0,0,0.85); color: white; padding: 6px 8px; border-radius: 6px; font-size: 12px; max-width: 280px; }
    #popup { position: absolute; display: none; background: white; border: 1px solid #ddd; border-radius: 8px; padding: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); min-width: 220px; }
    #popup h3 { margin: 0 0 6px 0; font-size: 14px; }
    #popup .kv { font-size: 12px; margin-top: 4px; }
    #popup .close { position: absolute; top: 8px; right: 8px; border: none; background: transparent; cursor: pointer; font-size: 16px; }
    .legend { position: absolute; bottom: 12px; left: 12px; background: rgba(255,255,255,0.95); border: 1px solid #ddd; border-radius: 8px; padding: 10px; font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.12); }
    .legend .item { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
    .swatch { width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.25); }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #e74c3c; border: 2px solid white; box-shadow: 0 0 0 1px rgba(0,0,0,0.2); }
    .ring { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #3388ff; background: rgba(51,136,255,0.15); }
    .ring2 { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #ff7800; background: rgba(255,120,0,0.15); }
    @media (max-width: 640px) {
      #hud { right: 12px; left: 12px; }
    }
  </style>
</head>
<body>
  <div id="app">
    <header>
      <strong>Exported Map (Offline)</strong>
      <span class="pill">No internet required</span>
      <span class="pill">Pan: drag · Zoom: wheel/pinch</span>
      <span class="pill">Points: ${customersData.length} · Areas: ${clustersData.length} · Drawn: ${drawnAreasData.length}</span>
    </header>
    <div id="stage">
      <canvas id="c"></canvas>
      <div id="hud">
        <h2>Offline export</h2>
        <div class="row">This file is fully self-contained and opens offline.</div>
        <div class="row muted">Basemap tiles are not included; this view shows a coordinate background with your data overlaid.</div>
      </div>
      <div class="legend">
        <div><strong>Legend</strong></div>
        <div class="item"><span class="dot"></span><span>Customer point</span></div>
        <div class="item"><span class="ring"></span><span>Cluster / area</span></div>
        <div class="item"><span class="ring2"></span><span>Drawn area</span></div>
      </div>
      <div id="tooltip"></div>
      <div id="popup">
        <button class="close" title="Close">×</button>
        <h3 id="popupTitle"></h3>
        <div class="kv" id="popupBody"></div>
      </div>
    </div>
  </div>

  <script>
    const DATA = {
      customers: ${JSON.stringify(customersData)},
      clusters: ${JSON.stringify(clustersData)},
      drawnAreas: ${JSON.stringify(drawnAreasData)},
      initial: { center: { lat: ${center.lat}, lon: ${center.lng} }, zoom: ${zoom} }
    };

    // WebMercator helpers
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
    function latLonToMercator(lat, lon) {
      const x = (lon * Math.PI) / 180;
      const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      return { x, y };
    }
    function mercatorToLatLon(x, y) {
      const lon = (x * 180) / Math.PI;
      const lat = (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);
      return { lat, lon };
    }
    function haversineMeters(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }

    // Canvas + viewport transform
    const canvas = document.getElementById('c');
    const stage = document.getElementById('stage');
    const tooltip = document.getElementById('tooltip');
    const popup = document.getElementById('popup');
    const popupTitle = document.getElementById('popupTitle');
    const popupBody = document.getElementById('popupBody');
    popup.querySelector('.close').addEventListener('click', () => popup.style.display = 'none');

    const ctx = canvas.getContext('2d');
    let W = 0, H = 0;

    // Compute data bounds in mercator
    const allPts = [];
    DATA.customers.forEach(c => allPts.push({ lat: c.lat, lon: c.lon, kind: 'customer', ref: c }));
    DATA.clusters.forEach(a => allPts.push({ lat: a.center_lat, lon: a.center_lon, kind: 'cluster', ref: a }));
    DATA.drawnAreas.forEach(a => allPts.push({ lat: a.center_lat, lon: a.center_lon, kind: 'drawn', ref: a }));

    // Default view: based on initial center and zoom mapping to scale
    const initialMerc = latLonToMercator(DATA.initial.center.lat, DATA.initial.center.lon);
    // Leaflet-ish zoom mapping: scale doubles per zoom.
    // Use an arbitrary base scale that looks good for Zambia-level zoom.
    let scale = Math.pow(2, DATA.initial.zoom - 6) * 220;
    let tx = 0, ty = 0;

    function resize() {
      const rect = stage.getBoundingClientRect();
      W = Math.max(1, Math.floor(rect.width));
      H = Math.max(1, Math.floor(rect.height));
      canvas.width = W * devicePixelRatio;
      canvas.height = H * devicePixelRatio;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      // Center the initial mercator at the middle of the canvas
      tx = W/2 - initialMerc.x * scale;
      ty = H/2 - initialMerc.y * scale;

      draw();
    }

    function worldToScreen(mx, my) {
      return { x: mx * scale + tx, y: my * scale + ty };
    }
    function screenToWorld(px, py) {
      return { x: (px - tx) / scale, y: (py - ty) / scale };
    }

    function drawGrid() {
      // Draw a light graticule (lat/lon lines) for context
      ctx.save();
      ctx.fillStyle = '#f7f7f7';
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      const stepDeg = (scale < 120) ? 5 : (scale < 260 ? 2 : 1);

      // Determine visible bounds in lat/lon
      const topLeft = mercatorToLatLon(...Object.values(screenToWorld(0, 0)));
      const botRight = mercatorToLatLon(...Object.values(screenToWorld(W, H)));
      const minLat = clamp(Math.min(topLeft.lat, botRight.lat), -85, 85);
      const maxLat = clamp(Math.max(topLeft.lat, botRight.lat), -85, 85);
      const minLon = Math.min(topLeft.lon, botRight.lon);
      const maxLon = Math.max(topLeft.lon, botRight.lon);

      const latStart = Math.floor(minLat / stepDeg) * stepDeg;
      const latEnd = Math.ceil(maxLat / stepDeg) * stepDeg;
      const lonStart = Math.floor(minLon / stepDeg) * stepDeg;
      const lonEnd = Math.ceil(maxLon / stepDeg) * stepDeg;

      // Lat lines
      for (let lat = latStart; lat <= latEnd; lat += stepDeg) {
        const a = latLonToMercator(lat, lonStart);
        const b = latLonToMercator(lat, lonEnd);
        const p1 = worldToScreen(a.x, a.y);
        const p2 = worldToScreen(b.x, b.y);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      // Lon lines
      for (let lon = lonStart; lon <= lonEnd; lon += stepDeg) {
        const a = latLonToMercator(minLat, lon);
        const b = latLonToMercator(maxLat, lon);
        const p1 = worldToScreen(a.x, a.y);
        const p2 = worldToScreen(b.x, b.y);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      // Label in corner
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillText('Coordinate view (offline export)', 12, H - 12);

      ctx.restore();
    }

    function drawCircle(mx, my, rPx, stroke, fill, alphaFill=0.18, lineWidth=2, dash=null) {
      const p = worldToScreen(mx, my);
      ctx.save();
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.arc(p.x, p.y, rPx, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.globalAlpha = alphaFill;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.restore();
    }

    function drawPoint(mx, my, color) {
      const p = worldToScreen(mx, my);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    }

    function clusterRadiusMeters(cluster) {
      // Recompute radius from member spread (same idea as live app, but offline)
      const members = DATA.customers.filter(c => cluster.customers.includes(c.account));
      let maxDist = 1000;
      if (members.length > 1) {
        for (let i = 0; i < members.length; i++) {
          for (let j = i + 1; j < members.length; j++) {
            const d = haversineMeters(members[i].lat, members[i].lon, members[j].lat, members[j].lon);
            if (d > maxDist) maxDist = d;
          }
        }
      }
      return maxDist / 2;
    }

    // Hit-testing: store screen-space shapes each render
    let shapes = [];
    function draw() {
      shapes = [];
      drawGrid();

      // Draw clusters first (behind points)
      DATA.clusters.forEach(cluster => {
        const m = latLonToMercator(cluster.center_lat, cluster.center_lon);
        const rM = clusterRadiusMeters(cluster);
        // Convert meters to pixels approx at current latitude by sampling 1 meter offset in mercator:
        const p0 = worldToScreen(m.x, m.y);
        const lat2 = cluster.center_lat;
        const lon2 = cluster.center_lon + 0.01;
        const metersPer0_01 = haversineMeters(lat2, cluster.center_lon, lat2, lon2);
        const m2 = latLonToMercator(lat2, lon2);
        const p2 = worldToScreen(m2.x, m2.y);
        const pxPerMeter = Math.abs(p2.x - p0.x) / metersPer0_01;
        const rPx = Math.max(8, rM * pxPerMeter);

        drawCircle(m.x, m.y, rPx, cluster.color, cluster.color, 0.16, 2);
        shapes.push({ type: 'cluster', x: p0.x, y: p0.y, r: rPx, data: cluster });
      });

      // Draw drawn areas
      DATA.drawnAreas.forEach(area => {
        const m = latLonToMercator(area.center_lat, area.center_lon);
        const p0 = worldToScreen(m.x, m.y);
        const lat2 = area.center_lat;
        const lon2 = area.center_lon + 0.01;
        const metersPer0_01 = haversineMeters(lat2, area.center_lon, lat2, lon2);
        const m2 = latLonToMercator(lat2, lon2);
        const p2 = worldToScreen(m2.x, m2.y);
        const pxPerMeter = Math.abs(p2.x - p0.x) / metersPer0_01;
        const rPx = Math.max(8, area.radius_m * pxPerMeter);

        drawCircle(m.x, m.y, rPx, area.color, area.color, 0.14, 2, [6, 4]);
        shapes.push({ type: 'drawn', x: p0.x, y: p0.y, r: rPx, data: area });
      });

      // Draw customer points on top
      DATA.customers.forEach(c => {
        const m = latLonToMercator(c.lat, c.lon);
        drawPoint(m.x, m.y, c.color);
        const p = worldToScreen(m.x, m.y);
        shapes.push({ type: 'customer', x: p.x, y: p.y, r: 8, data: c });
      });
    }

    // Interaction: pan/zoom
    let isDown = false;
    let last = { x: 0, y: 0 };
    stage.addEventListener('mousedown', (e) => {
      isDown = true;
      last = { x: e.clientX, y: e.clientY };
      stage.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => {
      isDown = false;
      stage.style.cursor = 'default';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      tx += dx;
      ty += dy;
      draw();
    });

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const worldBefore = screenToWorld(mx, my);

      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      scale = clamp(scale * factor, 30, 8000);

      const worldAfter = screenToWorld(mx, my);
      // Adjust translation so cursor stays anchored
      tx += (worldAfter.x - worldBefore.x) * scale;
      ty += (worldAfter.y - worldBefore.y) * scale;

      draw();
    }, { passive: false });

    // Tooltip / popup hit testing
    function hitTest(px, py) {
      // Search top-most: customers first
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        const dx = px - s.x;
        const dy = py - s.y;
        if (dx*dx + dy*dy <= s.r*s.r) return s;
      }
      return null;
    }

    stage.addEventListener('mousemove', (e) => {
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTest(x, y);
      if (!hit) {
        tooltip.style.display = 'none';
        return;
      }
      tooltip.style.display = 'block';
      tooltip.style.left = (x + 12) + 'px';
      tooltip.style.top = (y + 12) + 'px';
      if (hit.type === 'customer') {
        tooltip.textContent = hit.data.name;
      } else if (hit.type === 'cluster') {
        tooltip.textContent = hit.data.name + ' (cluster)';
      } else {
        tooltip.textContent = hit.data.name + ' (drawn)';
      }
    });

    stage.addEventListener('click', (e) => {
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTest(x, y);
      if (!hit) return;

      popup.style.display = 'block';
      popup.style.left = clamp(x + 12, 12, W - 260) + 'px';
      popup.style.top = clamp(y + 12, 12, H - 160) + 'px';

      if (hit.type === 'customer') {
        popupTitle.textContent = hit.data.name;
        popupBody.innerHTML =
          '<div class="kv"><strong>Customer Account Number:</strong> ' + hit.data.account + '</div>' +
          '<div class="kv"><strong>Latitude:</strong> ' + hit.data.lat + '</div>' +
          '<div class="kv"><strong>Longitude:</strong> ' + hit.data.lon + '</div>';
      } else if (hit.type === 'cluster') {
        popupTitle.textContent = hit.data.name;
        popupBody.innerHTML =
          '<div class="kv"><strong>Type:</strong> Cluster / area</div>' +
          '<div class="kv"><strong>Customers:</strong> ' + hit.data.customers.length + '</div>' +
          '<div class="kv"><strong>Center:</strong> ' + hit.data.center_lat + ', ' + hit.data.center_lon + '</div>';
      } else {
        popupTitle.textContent = hit.data.name;
        popupBody.innerHTML =
          '<div class="kv"><strong>Type:</strong> Drawn area</div>' +
          '<div class="kv"><strong>Radius (m):</strong> ' + Math.round(hit.data.radius_m) + '</div>' +
          '<div class="kv"><strong>Center:</strong> ' + hit.data.center_lat + ', ' + hit.data.center_lon + '</div>';
      }
    });

    // Touch: pan + pinch zoom (basic)
    let touchMode = null;
    let t0 = null, t1 = null;
    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchMode = 'pan';
        t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        touchMode = 'pinch';
        t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        t1 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
      }
    }, { passive: true });
    stage.addEventListener('touchmove', (e) => {
      if (touchMode === 'pan' && e.touches.length === 1) {
        const nx = e.touches[0].clientX;
        const ny = e.touches[0].clientY;
        tx += (nx - t0.x);
        ty += (ny - t0.y);
        t0 = { x: nx, y: ny };
        draw();
      } else if (touchMode === 'pinch' && e.touches.length === 2) {
        const a = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        const b = { x: e.touches[1].clientX, y: e.touches[1].clientY };
        const prev = Math.hypot(t1.x - t0.x, t1.y - t0.y);
        const curr = Math.hypot(b.x - a.x, b.y - a.y);
        const factor = curr / prev;

        const rect = stage.getBoundingClientRect();
        const mx = ((a.x + b.x) / 2) - rect.left;
        const my = ((a.y + b.y) / 2) - rect.top;
        const worldBefore = screenToWorld(mx, my);

        scale = clamp(scale * factor, 30, 8000);

        const worldAfter = screenToWorld(mx, my);
        tx += (worldAfter.x - worldBefore.x) * scale;
        ty += (worldAfter.y - worldBefore.y) * scale;

        t0 = a; t1 = b;
        draw();
      }
    }, { passive: true });
    stage.addEventListener('touchend', () => { touchMode = null; }, { passive: true });

    window.addEventListener('resize', resize);
    resize();
  </script>
</body>
</html>`;
}

// -----------------------------
// Offline export with embedded tiles (OSM)
// -----------------------------
function lonLatToTile(lon, lat, z) {
    const latRad = (lat * Math.PI) / 180;
    const n = Math.pow(2, z);
    const x = Math.floor(((lon + 180) / 360) * n);
    const y = Math.floor(
        (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
    );
    return { x, y, z };
}

function lonLatToWorldPx(lon, lat, z) {
    const n = Math.pow(2, z);
    const x = ((lon + 180) / 360) * 256 * n;
    const latRad = (lat * Math.PI) / 180;
    const y =
        (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * 256 * n;
    return { x, y };
}

async function fetchTileAsDataUrl(z, x, y) {
    // OSM standard tile server
    const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`Tile fetch failed (${res.status}) for ${z}/${x}/${y}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read tile image'));
        reader.readAsDataURL(blob);
    });
}

async function generateOfflineMapWithTilesHTML() {
    // MULTI-ZOOM offline export:
    // - Downloads tiles for an area (default: current view bounds)
    // - Includes multiple zoom levels so you can zoom to street level offline

    // Area: current map bounds by default (works for "full map for this area")
    const bounds = state.map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    // Zoom range: from current zoom to street level (18) by default
    const currentZ = state.map.getZoom();
    const minZ = Math.max(0, Math.min(18, currentZ));
    const maxZ = 18; // street level

    // Estimate tile counts across zooms
    function tileRangeForBounds(z) {
        const tSW = lonLatToTile(sw.lng, sw.lat, z);
        const tNE = lonLatToTile(ne.lng, ne.lat, z);
        const minX = Math.min(tSW.x, tNE.x) - 1;
        const maxX = Math.max(tSW.x, tNE.x) + 1;
        const minY = Math.min(tSW.y, tNE.y) - 1;
        const maxY = Math.max(tSW.y, tNE.y) + 1;
        return { minX, maxX, minY, maxY };
    }

    let totalTiles = 0;
    for (let z = minZ; z <= maxZ; z++) {
        const r = tileRangeForBounds(z);
        const nx = (r.maxX - r.minX + 1);
        const ny = (r.maxY - r.minY + 1);
        totalTiles += nx * ny;
    }

    // Rough size estimate: average PNG tile ~ 20–40KB at street zooms (varies a lot).
    const estMB = Math.round((totalTiles * 30) / 1024); // 30KB avg -> MB

    if (!confirm(
        `This will download and embed tiles for zoom ${minZ}–${maxZ} for the CURRENT VIEW area.\n\n` +
        `Estimated tiles: ~${totalTiles.toLocaleString()}\n` +
        `Estimated file size: ~${estMB} MB (very approximate)\n\n` +
        `You must be online during export. Continue?`
    )) {
        throw new Error('Cancelled');
    }

    // Progress overlay
    const progressEl = document.createElement('div');
    progressEl.style.cssText =
        'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:16px;';
    progressEl.innerHTML =
        '<div style="background:#fff;border-radius:10px;max-width:520px;width:100%;padding:16px 18px;box-shadow:0 10px 30px rgba(0,0,0,0.35)">' +
        '  <div style="font-weight:600;margin-bottom:8px">Downloading tiles for offline export…</div>' +
        '  <div id="tileProgText" style="font-size:13px;color:#333;margin-bottom:10px"></div>' +
        '  <div style="height:10px;background:#eee;border-radius:999px;overflow:hidden">' +
        '    <div id="tileProgBar" style="height:100%;width:0%;background:#3498db"></div>' +
        '  </div>' +
        '  <div style="font-size:12px;color:#666;margin-top:10px">Keep this tab open. This may take a while at street-level zoom.</div>' +
        '</div>';
    document.body.appendChild(progressEl);
    const progText = progressEl.querySelector('#tileProgText');
    const progBar = progressEl.querySelector('#tileProgBar');

    const tiles = {};
    let done = 0;
    let failed = 0;
    const startedAt = Date.now();

    // Download queue with limited concurrency
    const concurrency = 8;
    const jobs = [];
    for (let z = minZ; z <= maxZ; z++) {
        const r = tileRangeForBounds(z);
        const n = Math.pow(2, z);
        for (let x = r.minX; x <= r.maxX; x++) {
            const wx = ((x % n) + n) % n;
            for (let y = r.minY; y <= r.maxY; y++) {
                if (y < 0 || y >= n) continue;
                const key = `${z}/${wx}/${y}`;
                jobs.push({ z, x: wx, y, key });
            }
        }
    }

    async function worker() {
        while (jobs.length) {
            const job = jobs.pop();
            try {
                // retry once
                tiles[job.key] = await fetchTileAsDataUrl(job.z, job.x, job.y);
            } catch (e) {
                try {
                    tiles[job.key] = await fetchTileAsDataUrl(job.z, job.x, job.y);
                } catch (e2) {
                    failed++;
                }
            } finally {
                done++;
                const pct = Math.max(0, Math.min(100, (done / totalTiles) * 100));
                const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
                const rate = Math.round(done / elapsedSec);
                progText.textContent = `${done.toLocaleString()} / ${totalTiles.toLocaleString()} tiles  (${Math.round(pct)}%)  ·  ${rate}/sec  ·  failed: ${failed}`;
                progBar.style.width = `${pct}%`;
                // Yield to UI thread
                if (done % 25 === 0) await new Promise(r => setTimeout(r, 0));
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    progressEl.remove();

    console.log(`Downloaded tiles: ${done}/${totalTiles} (failed ${failed}) in ${(Date.now() - startedAt)}ms`);

    // Serialize overlay data (same as offline-lite)
    const customersData = state.customers.map(c => ({
        name: c.name,
        account: c.account_number,
        lat: c.latitude,
        lon: c.longitude,
        color: state.customerColors[c.account_number] || '#e74c3c'
    }));

    const clustersData = Object.entries(state.clusters)
        .filter(([id]) => !state.deletedClusters[id])
        .map(([id, cluster]) => ({
            id,
            name: state.clusterNames[id] || cluster.name,
            center_lat: cluster.center_lat,
            center_lon: cluster.center_lon,
            color: state.clusterColors[id] || cluster.color,
            customers: cluster.customers
        }));

    const drawnAreasData = Object.entries(state.drawnCircles).map(([id, area]) => ({
        id,
        name: area.name,
        center_lat: area.center.lat,
        center_lon: area.center.lng,
        radius_m: area.radius,
        color: area.layer?.options?.color || '#ff7800'
    }));

    const center = state.map.getCenter();

    // Single-file offline viewer with embedded tiles (multi-zoom)
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Exported Map (Offline with Tiles)</title>
  <style>
    html, body { height: 100%; width: 100%; margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    header { padding: 10px 12px; background: #2c3e50; color: white; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    header .pill { background: rgba(255,255,255,0.12); padding: 6px 10px; border-radius: 999px; font-size: 12px; }
    #stage { position: relative; height: calc(100% - 52px); width: 100%; overflow: hidden; background: #eaeaea; }
    canvas { display: block; width: 100%; height: 100%; }
    #tooltip { position: absolute; pointer-events: none; display: none; background: rgba(0,0,0,0.85); color: white; padding: 6px 8px; border-radius: 6px; font-size: 12px; max-width: 280px; }
    #popup { position: absolute; display: none; background: white; border: 1px solid #ddd; border-radius: 8px; padding: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); min-width: 220px; }
    #popup h3 { margin: 0 0 6px 0; font-size: 14px; }
    #popup .kv { font-size: 12px; margin-top: 4px; }
    #popup .close { position: absolute; top: 8px; right: 8px; border: none; background: transparent; cursor: pointer; font-size: 16px; }
  </style>
</head>
<body>
  <header>
    <strong>Exported Map (Offline with Tiles)</strong>
    <span class="pill">Tiles embedded · Opens offline</span>
    <span class="pill">Zoom: ${minZ}–${maxZ} (street)</span>
    <span class="pill">Pan: drag · Zoom: wheel/pinch</span>
    ${failed ? `<span class="pill" style="background:rgba(231,76,60,0.2);border:1px solid rgba(231,76,60,0.35)">Missing tiles: ${failed}</span>` : ``}
  </header>
  <div id="stage">
    <canvas id="c"></canvas>
    <div id="tooltip"></div>
    <div id="popup">
      <button class="close" title="Close">×</button>
      <h3 id="popupTitle"></h3>
      <div class="kv" id="popupBody"></div>
    </div>
  </div>

  <script>
    const DATA = {
      minZ: ${minZ},
      maxZ: ${maxZ},
      z: ${currentZ},
      center: { lat: ${center.lat}, lon: ${center.lng} },
      tiles: ${JSON.stringify(tiles)},
      bounds: { sw: { lat: ${sw.lat}, lon: ${sw.lng} }, ne: { lat: ${ne.lat}, lon: ${ne.lng} } },
      customers: ${JSON.stringify(customersData)},
      clusters: ${JSON.stringify(clustersData)},
      drawnAreas: ${JSON.stringify(drawnAreasData)}
    };

    function haversineMeters(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    function lonLatToWorldPx(lon, lat, z) {
      const n = Math.pow(2, z);
      const x = ((lon + 180) / 360) * 256 * n;
      const latRad = (lat * Math.PI) / 180;
      const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * 256 * n;
      return { x, y };
    }
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    const canvas = document.getElementById('c');
    const stage = document.getElementById('stage');
    const tooltip = document.getElementById('tooltip');
    const popup = document.getElementById('popup');
    const popupTitle = document.getElementById('popupTitle');
    const popupBody = document.getElementById('popupBody');
    popup.querySelector('.close').addEventListener('click', () => popup.style.display = 'none');
    const ctx = canvas.getContext('2d');

    let W = 0, H = 0;
    let z = clamp(Math.round(DATA.z), DATA.minZ, DATA.maxZ);
    let center = { lat: DATA.center.lat, lon: DATA.center.lon };
    let centerPx = lonLatToWorldPx(center.lon, center.lat, z);
    let tx = 0, ty = 0;
    let shapes = [];

    const tileImgCache = new Map(); // key -> HTMLImageElement
    function getTileImg(key, dataUrl) {
      if (tileImgCache.has(key)) return tileImgCache.get(key);
      const img = new Image();
      img.src = dataUrl;
      tileImgCache.set(key, img);
      return img;
    }

    function resize() {
      const rect = stage.getBoundingClientRect();
      W = Math.max(1, Math.floor(rect.width));
      H = Math.max(1, Math.floor(rect.height));
      canvas.width = W * devicePixelRatio;
      canvas.height = H * devicePixelRatio;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      centerPx = lonLatToWorldPx(center.lon, center.lat, z);
      tx = W/2 - centerPx.x;
      ty = H/2 - centerPx.y;
      draw();
    }

    function worldToScreen(wx, wy) { return { x: wx + tx, y: wy + ty }; }

    function drawTiles() {
      // Draw tiles for current zoom within visible viewport
      const topLeftWorld = { x: -tx, y: -ty };
      const botRightWorld = { x: -tx + W, y: -ty + H };
      const minX = Math.floor(topLeftWorld.x / 256) - 1;
      const maxX = Math.floor(botRightWorld.x / 256) + 1;
      const minY = Math.floor(topLeftWorld.y / 256) - 1;
      const maxY = Math.floor(botRightWorld.y / 256) + 1;
      const n = Math.pow(2, z);

      for (let x = minX; x <= maxX; x++) {
        const wx = ((x % n) + n) % n;
        for (let y = minY; y <= maxY; y++) {
          if (y < 0 || y >= n) continue;
          const key = \`\${z}/\${wx}/\${y}\`;
          const dataUrl = DATA.tiles[key];
          const p = worldToScreen(wx * 256, y * 256);
          if (!dataUrl) {
            // Missing tile placeholder
            ctx.fillStyle = '#dcdcdc';
            ctx.fillRect(p.x, p.y, 256, 256);
            ctx.strokeStyle = 'rgba(0,0,0,0.07)';
            ctx.strokeRect(p.x, p.y, 256, 256);
            continue;
          }
          const img = getTileImg(key, dataUrl);
          if (!img.complete) continue;
          ctx.drawImage(img, p.x, p.y, 256, 256);
        }
      }
    }

    function clusterRadiusMeters(cluster) {
      const members = DATA.customers.filter(c => cluster.customers.includes(c.account));
      let maxDist = 1000;
      if (members.length > 1) {
        for (let i = 0; i < members.length; i++) {
          for (let j = i + 1; j < members.length; j++) {
            const d = haversineMeters(members[i].lat, members[i].lon, members[j].lat, members[j].lon);
            if (d > maxDist) maxDist = d;
          }
        }
      }
      return maxDist / 2;
    }

    function metersToPxAtLat(meters, lat) {
      // approximate meters-per-pixel at given latitude and zoom
      const earthCirc = 40075016.686; // meters
      const latRad = lat * Math.PI / 180;
      const metersPerPx = (earthCirc * Math.cos(latRad)) / (256 * Math.pow(2, z));
      return meters / metersPerPx;
    }

    function drawCircleWorld(centerLat, centerLon, radiusMeters, stroke, fill, alphaFill, lineWidth, dash) {
      const cpx = lonLatToWorldPx(centerLon, centerLat, z);
      const p = worldToScreen(cpx.x, cpx.y);
      const rPx = Math.max(8, metersToPxAtLat(radiusMeters, centerLat));
      ctx.save();
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.arc(p.x, p.y, rPx, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.globalAlpha = alphaFill;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.restore();
      return { x: p.x, y: p.y, r: rPx };
    }

    function drawPointWorld(lat, lon, color) {
      const w = lonLatToWorldPx(lon, lat, z);
      const p = worldToScreen(w.x, w.y);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
      return { x: p.x, y: p.y, r: 8 };
    }

    function draw() {
      shapes = [];
      ctx.clearRect(0, 0, W, H);
      drawTiles();

      // clusters behind
      DATA.clusters.forEach(cluster => {
        const rM = clusterRadiusMeters(cluster);
        const hit = drawCircleWorld(cluster.center_lat, cluster.center_lon, rM, cluster.color, cluster.color, 0.16, 2, null);
        shapes.push({ type: 'cluster', ...hit, data: cluster });
      });

      // drawn areas
      DATA.drawnAreas.forEach(area => {
        const hit = drawCircleWorld(area.center_lat, area.center_lon, area.radius_m, area.color, area.color, 0.14, 2, [6,4]);
        shapes.push({ type: 'drawn', ...hit, data: area });
      });

      // points on top
      DATA.customers.forEach(c => {
        const hit = drawPointWorld(c.lat, c.lon, c.color);
        shapes.push({ type: 'customer', ...hit, data: c });
      });
    }

    // Hit testing
    function hitTest(px, py) {
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        const dx = px - s.x;
        const dy = py - s.y;
        if (dx*dx + dy*dy <= s.r*s.r) return s;
      }
      return null;
    }

    // Pan interaction
    let isDown = false;
    let last = { x: 0, y: 0 };
    stage.addEventListener('mousedown', (e) => {
      isDown = true;
      last = { x: e.clientX, y: e.clientY };
      stage.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => { isDown = false; stage.style.cursor = 'default'; });
    window.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      tx += dx;
      ty += dy;
      draw();
    });

    // Tooltip/popup
    stage.addEventListener('mousemove', (e) => {
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTest(x, y);
      if (!hit) {
        tooltip.style.display = 'none';
        return;
      }
      tooltip.style.display = 'block';
      tooltip.style.left = (x + 12) + 'px';
      tooltip.style.top = (y + 12) + 'px';
      tooltip.textContent = hit.type === 'customer' ? hit.data.name : (hit.data.name + (hit.type === 'cluster' ? ' (cluster)' : ' (drawn)'));
    });
    stage.addEventListener('click', (e) => {
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTest(x, y);
      if (!hit) return;

      popup.style.display = 'block';
      popup.style.left = clamp(x + 12, 12, W - 260) + 'px';
      popup.style.top = clamp(y + 12, 12, H - 160) + 'px';

      if (hit.type === 'customer') {
        popupTitle.textContent = hit.data.name;
        popupBody.innerHTML =
          '<div class="kv"><strong>Customer Account Number:</strong> ' + hit.data.account + '</div>' +
          '<div class="kv"><strong>Latitude:</strong> ' + hit.data.lat + '</div>' +
          '<div class="kv"><strong>Longitude:</strong> ' + hit.data.lon + '</div>';
      } else if (hit.type === 'cluster') {
        popupTitle.textContent = hit.data.name;
        popupBody.innerHTML =
          '<div class="kv"><strong>Type:</strong> Cluster / area</div>' +
          '<div class="kv"><strong>Customers:</strong> ' + hit.data.customers.length + '</div>' +
          '<div class="kv"><strong>Center:</strong> ' + hit.data.center_lat + ', ' + hit.data.center_lon + '</div>';
      } else {
        popupTitle.textContent = hit.data.name;
        popupBody.innerHTML =
          '<div class="kv"><strong>Type:</strong> Drawn area</div>' +
          '<div class="kv"><strong>Radius (m):</strong> ' + Math.round(hit.data.radius_m) + '</div>' +
          '<div class="kv"><strong>Center:</strong> ' + hit.data.center_lat + ', ' + hit.data.center_lon + '</div>';
      }
    });

    // Zoom interaction (wheel): change zoom level and keep cursor anchored
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // World pixel under cursor before zoom
      const worldBefore = { x: (mx - tx), y: (my - ty) };
      const geoBefore = (() => {
        // Convert world px -> lon/lat at current z via inverse WebMercator
        const n = Math.pow(2, z);
        const lon = (worldBefore.x / (256 * n)) * 360 - 180;
        const y = (worldBefore.y / (256 * n));
        const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y)));
        const lat = latRad * 180 / Math.PI;
        return { lat, lon };
      })();

      const delta = e.deltaY < 0 ? 1 : -1;
      const newZ = clamp(z + delta, DATA.minZ, DATA.maxZ);
      if (newZ === z) return;

      z = newZ;
      centerPx = lonLatToWorldPx(center.lon, center.lat, z);

      // After zoom, re-project the same geo point to new world px and update tx/ty so it stays under cursor
      const worldAfter = lonLatToWorldPx(geoBefore.lon, geoBefore.lat, z);
      tx = mx - worldAfter.x;
      ty = my - worldAfter.y;

      draw();
    }, { passive: false });

    // Touch pinch zoom (basic)
    let touchMode = null;
    let t0 = null, t1 = null;
    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchMode = 'pan';
        t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        touchMode = 'pinch';
        t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        t1 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
      }
    }, { passive: true });
    stage.addEventListener('touchmove', (e) => {
      if (touchMode === 'pinch' && e.touches.length === 2) {
        const a = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        const b = { x: e.touches[1].clientX, y: e.touches[1].clientY };
        const prev = Math.hypot(t1.x - t0.x, t1.y - t0.y);
        const curr = Math.hypot(b.x - a.x, b.y - a.y);
        if (prev <= 0) return;
        const factor = curr / prev;

        // Convert factor to zoom step
        const delta = factor > 1.12 ? 1 : (factor < (1/1.12) ? -1 : 0);
        if (delta === 0) return;
        const rect = stage.getBoundingClientRect();
        const mx = ((a.x + b.x) / 2) - rect.left;
        const my = ((a.y + b.y) / 2) - rect.top;

        const worldBefore = { x: (mx - tx), y: (my - ty) };
        const geoBefore = (() => {
          const n = Math.pow(2, z);
          const lon = (worldBefore.x / (256 * n)) * 360 - 180;
          const y = (worldBefore.y / (256 * n));
          const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y)));
          const lat = latRad * 180 / Math.PI;
          return { lat, lon };
        })();

        const newZ = clamp(z + delta, DATA.minZ, DATA.maxZ);
        if (newZ === z) return;
        z = newZ;
        const worldAfter = lonLatToWorldPx(geoBefore.lon, geoBefore.lat, z);
        tx = mx - worldAfter.x;
        ty = my - worldAfter.y;

        t0 = a; t1 = b;
        draw();
      } else if (touchMode === 'pan' && e.touches.length === 1) {
        const nx = e.touches[0].clientX;
        const ny = e.touches[0].clientY;
        tx += (nx - t0.x);
        ty += (ny - t0.y);
        t0 = { x: nx, y: ny };
        draw();
      }
    }, { passive: true });
    stage.addEventListener('touchend', () => { touchMode = null; }, { passive: true });

    window.addEventListener('resize', resize);
    resize();
  </script>
</body>
</html>`;
}

// -----------------------------
// KML export (Google Maps / Google Earth / many map apps)
// -----------------------------
function xmlEscape(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function colorHexToKmlAabbggrr(hex, alpha = 'cc') {
    // KML uses aabbggrr
    const h = (hex || '#000000').replace('#', '').padEnd(6, '0').slice(0, 6);
    const rr = h.slice(0, 2);
    const gg = h.slice(2, 4);
    const bb = h.slice(4, 6);
    return `${alpha}${bb}${gg}${rr}`;
}

function circleToPolygonCoords(lat, lon, radiusMeters, steps = 64) {
    // Approximate a circle as polygon points (for KML)
    const R = 6378137;
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const d = radiusMeters / R;
    const coords = [];
    for (let i = 0; i <= steps; i++) {
        const brng = (2 * Math.PI * i) / steps;
        const lat2 = Math.asin(Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(brng));
        const lon2 = lonRad + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(latRad), Math.cos(d) - Math.sin(latRad) * Math.sin(lat2));
        coords.push(`${(lon2 * 180 / Math.PI).toFixed(6)},${(lat2 * 180 / Math.PI).toFixed(6)},0`);
    }
    return coords.join(' ');
}

function computeClusterRadiusMeters(cluster) {
    // Same idea as live app: half of maximum pairwise distance, default 1000m
    const members = state.customers.filter(c => cluster.customers.includes(c.account_number));
    let maxDist = 1000;
    if (members.length > 1) {
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                const d = state.map
                    ? state.map.distance(L.latLng(members[i].latitude, members[i].longitude), L.latLng(members[j].latitude, members[j].longitude))
                    : 1000;
                if (d > maxDist) maxDist = d;
            }
        }
    }
    return maxDist / 2;
}

function generateKml() {
    const customers = state.customers || [];
    const clusters = state.clusters || {};

    const kmlParts = [];
    kmlParts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    kmlParts.push(`<kml xmlns="http://www.opengis.net/kml/2.2">`);
    kmlParts.push(`<Document>`);
    kmlParts.push(`<name>CCBA Export</name>`);

    // Points folder
    kmlParts.push(`<Folder><name>Customers</name>`);
    customers.forEach(c => {
        const name = xmlEscape(c.name);
        const acc = xmlEscape(c.account_number);
        const color = colorHexToKmlAabbggrr(state.customerColors[c.account_number] || '#e74c3c', 'ff');
        kmlParts.push(`
  <Placemark>
    <name>${name}</name>
    <description>${xmlEscape('Customer Account Number: ' + c.account_number)}</description>
    <Style>
      <IconStyle>
        <color>${color}</color>
        <scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon>
      </IconStyle>
    </Style>
    <Point><coordinates>${c.longitude},${c.latitude},0</coordinates></Point>
  </Placemark>`);
    });
    kmlParts.push(`</Folder>`);

    // Areas folder (clusters as polygons)
    kmlParts.push(`<Folder><name>Areas (Clusters)</name>`);
    Object.entries(clusters).forEach(([id, cluster]) => {
        if (state.deletedClusters[id]) return;
        const name = xmlEscape(state.clusterNames[id] || cluster.name || id);
        const color = colorHexToKmlAabbggrr(state.clusterColors[id] || cluster.color || '#3388ff', '66');
        const radius = computeClusterRadiusMeters(cluster);
        const coords = circleToPolygonCoords(cluster.center_lat, cluster.center_lon, radius, 64);
        kmlParts.push(`
  <Placemark>
    <name>${name}</name>
    <description>${xmlEscape('Cluster ID: ' + id + ' | Customers: ' + (cluster.customers?.length || 0))}</description>
    <Style>
      <LineStyle><color>${colorHexToKmlAabbggrr(state.clusterColors[id] || cluster.color || '#3388ff', 'cc')}</color><width>2</width></LineStyle>
      <PolyStyle><color>${color}</color></PolyStyle>
    </Style>
    <Polygon>
      <outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>
    </Polygon>
  </Placemark>`);
    });
    kmlParts.push(`</Folder>`);

    // Drawn areas folder
    kmlParts.push(`<Folder><name>Drawn Areas</name>`);
    Object.entries(state.drawnCircles || {}).forEach(([id, area]) => {
        const name = xmlEscape(area.name || id);
        const colorHex = area.layer?.options?.color || '#ff7800';
        const color = colorHexToKmlAabbggrr(colorHex, '66');
        const coords = circleToPolygonCoords(area.center.lat, area.center.lng, area.radius, 64);
        kmlParts.push(`
  <Placemark>
    <name>${name}</name>
    <description>${xmlEscape('Drawn Area ID: ' + id + ' | Radius(m): ' + Math.round(area.radius))}</description>
    <Style>
      <LineStyle><color>${colorHexToKmlAabbggrr(colorHex, 'cc')}</color><width>2</width></LineStyle>
      <PolyStyle><color>${color}</color></PolyStyle>
    </Style>
    <Polygon>
      <outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>
    </Polygon>
  </Placemark>`);
    });
    kmlParts.push(`</Folder>`);

    kmlParts.push(`</Document></kml>`);
    return kmlParts.join('\n');
}

// Export CSV
document.getElementById('exportCsvBtn').addEventListener('click', async () => {
    try {
        const exportData = {
            customers: state.customers,
            clusters: state.clusters,
            customer_cluster_map: state.customerClusterMap,
            user_areas: state.drawnCircles,
            customer_colors: state.customerColors
        };
        
        const response = await fetch('/api/export/csv', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(exportData)
        });
        
        if (!response.ok) {
            throw new Error('Export failed');
        }
        
        const data = await response.json();
        const blob = new Blob([data.csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'export.csv';
        a.click();
        URL.revokeObjectURL(url);
        
    } catch (error) {
        alert(`Error exporting CSV: ${error.message}`);
    }
});

// Initialize on page load - wait for both DOM and scripts to be ready
function initializeApp() {
    if (typeof L === 'undefined') {
        console.error('Leaflet not loaded yet, retrying...');
        setTimeout(initializeApp, 100);
        return;
    }
    
    try {
        initMap();
        console.log('Map initialized successfully');
    } catch (error) {
        console.error('Error initializing map:', error);
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; background: #e74c3c; color: white; padding: 20px; z-index: 10000;';
        errorDiv.innerHTML = '<h2>Error Initializing Map</h2><p>' + error.message + '</p><p>Check browser console for details.</p>';
        document.body.appendChild(errorDiv);
    }
}

// Try to initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM is already ready
    setTimeout(initializeApp, 100);
}
