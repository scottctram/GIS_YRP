// ===================================================================================================================================================== //
// MAP INITIALIZATION                                                                                                                                    //
// ===================================================================================================================================================== //

// Initial Zoom & Center set to focus on York Region, Ontario
const initialZoom = 10;
const initialCenter = [44.00, -79.45]; 
const map = L.map('map', { zoomControl: true }).setView(initialCenter, initialZoom);

// ===================================================================================================================================================== //
// GLOBAL VARIABLES                                                                                                                                      //
// ===================================================================================================================================================== //
let yorkData = { type: "FeatureCollection", features: [] };
let roadsData = { type: "FeatureCollection", features: [] };
let addressesData = { type: "FeatureCollection", features: [] };
let parcelsData = { type: "FeatureCollection", features: [] };

let bufferResultsData = { type: "FeatureCollection", features: [] };
let filteredQueryData = null; 
const bufferLayerGroup = L.layerGroup().addTo(map);

// ===================================================================================================================================================== //
// BASEMAPS                                                                                                                                              //
// ===================================================================================================================================================== //
const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri' });
const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO', subdomains: 'abcd', maxZoom: 20 });

// Helper: Makeshift Popup displaying feature fields and a Buffer Trigger
function bindPopupWithBuffer(feature, layer) {
    const div = document.createElement('div');
    div.className = 'popup-content';
    let contentHtml = "";
    if (feature.properties) {
        contentHtml = Object.keys(feature.properties)
            .map(k => `<b>${k}:</b> ${feature.properties[k]}`)
            .join('<br>');
    }
    div.innerHTML = `<div style="max-height: 150px; overflow:auto; margin-bottom:5px;">${contentHtml}</div>`;
    const btn = document.createElement('button');
    btn.className = 'popup-btn';
    btn.innerHTML = '<i class="fa-solid fa-bullseye"></i> Buffer Nearby';
    btn.onclick = function() { initiateBuffer(feature); };
    div.appendChild(btn);
    layer.bindPopup(div);
}

// ===================================================================================================================================================== //
// DATA & DATA API CALLS (YORK REGION OPEN DATA)                                                                                                         //
// ===================================================================================================================================================== //

// 1. Boundaries Layer (York Region Boundary)
const yorkLayer = L.geoJSON(null, {
    style: { color: "#800020", weight: 2.5, opacity: 1, fillOpacity: 0.05 },
    onEachFeature: bindPopupWithBuffer
});

fetch('https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Boundary/MapServer/1/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        yorkData = data;
        yorkLayer.addData(data);
        map.addLayer(yorkLayer);
    })
    .catch(err => console.error("Error loading York Boundaries GeoJSON:", err));

// 2. Roads Layer
const roadsLayer = L.geoJSON(null, {
    style: { color: "#555555", weight: 1.5, opacity: 0.8 },
    onEachFeature: bindPopupWithBuffer
});

fetch('https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Transportation/MapServer/1/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        roadsData = data;
        roadsLayer.addData(data);
        map.addLayer(roadsLayer);
    })
    .catch(err => console.error("Error loading Roads GeoJSON:", err));

// 3. Addresses Layer (Marker Cluster for Performance)
const addressesLayer = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true
});
addressesLayer.currentData = { type: "FeatureCollection", features: [] };

fetch('https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Location/MapServer/0/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        addressesData = data;
        addressesLayer.currentData = data;
        const geoJsonData = L.geoJSON(data, {
            pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 4, fillColor: "#3388ff", color: "#000", weight: 0.5, opacity: 1, fillOpacity: 0.8 }),
            onEachFeature: bindPopupWithBuffer
        });
        addressesLayer.addLayer(geoJsonData);
        map.addLayer(addressesLayer);
    })
    .catch(err => console.error("Error loading Addresses GeoJSON:", err));

// 4. Parcels Layer
const parcelsLayer = L.geoJSON(null, {
    style: { color: "#228b22", weight: 1, opacity: 0.6, fillOpacity: 0.2 },
    onEachFeature: bindPopupWithBuffer
});

fetch('https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Planning/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        parcelsData = data;
        parcelsLayer.addData(data);
        map.addLayer(parcelsLayer);
    })
    .catch(err => console.error("Error loading Parcels GeoJSON:", err));

// 5. Crime Occurrences Layer (Local JSON)
let crimeData = { type: "FeatureCollection", features: [] };
const crimeLayer = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    spiderfyDistanceMultiplier: 2.5
});
crimeLayer.currentData = { type: "FeatureCollection", features: [] };

function getCrimeColor(type) {
    if (!type) return "#3388ff";
    const t = type.toString().toUpperCase();
    if (t.includes("ROBBERY") || t.includes("ASSAULT") || t.includes("WEAPON")) return "#d9534f"; 
    if (t.includes("AUTO THEFT") || t.includes("THEFT")) return "#f0ad4e";          
    if (t.includes("BREAK AND ENTER") || t.includes("MISCHIEF")) return "#5bc0de";               
    return "#3388ff";                                                                            
}

function createCrimeLayer(data) {
    return L.geoJSON(data, {
        pointToLayer: (feature, latlng) => {
            const crimeType = feature.properties.cr_ucr_tra || feature.properties.CATEGORY || "Incident";
            const color = getCrimeColor(crimeType);
            const iconHtml = `<i class="fa-solid fa-shield-halved" style="color: ${color}; font-size: 18px; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;"></i>`;
            const crimeIcon = L.divIcon({
                className: 'crime-div-icon',
                html: iconHtml,
                iconSize: [24, 24],
                iconAnchor: [12, 12],
                popupAnchor: [0, -12]
            });
            return L.marker(latlng, { icon: crimeIcon });
        },
        onEachFeature: bindPopupWithBuffer
    });
}

fetch('yk_crime_rpt22.json')
    .then(response => response.json())
    .then(data => {
        crimeData = data;
        crimeLayer.currentData = data;
        crimeLayer.addLayer(createCrimeLayer(data));
        map.addLayer(crimeLayer);
    })
    .catch(err => console.error("Error loading Crime GeoJSON:", err));

// ===================================================================================================================================================== //
// FUNCTIONS - BUFFER, ATTRIBUTE TABLE, SEARCH & QUERY                                                                                                 //
// ===================================================================================================================================================== //

function initiateBuffer(feature) {
    const distanceStr = prompt("Enter buffer radius in Kilometers:", "2");
    if (!distanceStr) return;
    const distance = parseFloat(distanceStr);
    if (isNaN(distance)) return alert("Invalid number");

    bufferLayerGroup.clearLayers();
    const buffered = turf.buffer(feature, distance, { units: 'kilometers' });
    
    const bufferVis = L.geoJSON(buffered, {
        style: { color: '#FF0000', weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }
    }).addTo(bufferLayerGroup);
    
    map.fitBounds(bufferVis.getBounds());

    const sources = [
        { name: "York Boundary", list: yorkData.features },
        { name: "Roads", list: roadsData.features },
        { name: "Addresses", list: addressesData.features },
        { name: "Parcels", list: parcelsData.features },
        { name: "Crime Occurrences", list: crimeData.features }
    ];
    
    const foundFeatures = [];
    sources.forEach(source => {
        if (!source.list) return;
        source.list.forEach(f => {
            try {
                if (turf.booleanIntersects(f, buffered)) {
                    const keys = Object.keys(f.properties);
                    const firstValue = keys.length > 0 ? f.properties[keys[0]] : "Unknown";
                    foundFeatures.push({
                        type: "Feature",
                        geometry: f.geometry,
                        properties: { "Table Name": source.name, "Identifier": firstValue }
                    });
                }
            } catch (e) { }
        });
    });

    bufferResultsData = { type: "FeatureCollection", features: foundFeatures };
    alert(`Found ${foundFeatures.length} features within ${distance}km! Opening table...`);
    
    document.getElementById('attributeTable').style.display = 'flex';
    document.getElementById('map').style.height = '65vh';
    map.invalidateSize();
    
    const select = document.getElementById('table-layer-select');
    select.value = "buffer_results";
    switchTableLayer(); 
}

function getActiveTableLayerId() { 
    const el = document.getElementById('table-layer-select');
    return el ? el.value : 'york'; 
}

function getLayerData(id) {
    const queryLayer = document.getElementById('q-layer-select').value;
    if (filteredQueryData && id === queryLayer) return filteredQueryData;

    if (id === 'york') return yorkData;
    if (id === 'roads') return roadsData;
    if (id === 'addresses') return addressesData;
    if (id === 'parcels') return parcelsData;
    if (id === 'crime') return crimeData;
    if (id === 'buffer_results') return bufferResultsData;
    return yorkData;
}

function toggleAttributeTable() {
    const container = document.getElementById('attributeTable');
    const mapDiv = document.getElementById('map');
    if (container.style.display === 'flex') {
        container.style.display = 'none';
        mapDiv.style.height = '100vh';
    } else {
        container.style.display = 'flex';
        mapDiv.style.height = '65vh';
        switchTableLayer();
    }
    setTimeout(() => map.invalidateSize(), 300);
}

function switchTableLayer() {
    const searchBox = document.getElementById('table-search');
    if (searchBox) searchBox.value = ""; 
    renderTable(getLayerData(getActiveTableLayerId()));
}

const tableSearchInput = document.getElementById('table-search');
if (tableSearchInput) {
    tableSearchInput.addEventListener('input', function(e) {
        const term = e.target.value.toLowerCase();
        const fullData = getLayerData(getActiveTableLayerId());
        if (!fullData.features) return;

        const filteredFeatures = fullData.features.filter(feature => 
            Object.values(feature.properties).some(val => String(val).toLowerCase().includes(term))
        );
        renderTable({ type: "FeatureCollection", features: filteredFeatures });
    });
}

function renderTable(data) {
    const thead = document.getElementById('table-headers');
    const tbody = document.getElementById('table-body');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (!data.features || data.features.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No features found, please check if layers are filtered or loading.</td></tr>';
        return;
    }

    const props = data.features[0].properties;
    const headers = Object.keys(props);
    headers.forEach(h => {
        const th = document.createElement('th');
        th.innerText = h;
        thead.appendChild(th);
    });
    
    const actionTh = document.createElement('th');
    actionTh.innerText = "Zoom";
    thead.appendChild(actionTh);

    data.features.slice(0, 100).forEach(feature => {
        const tr = document.createElement('tr');
        headers.forEach(key => {
            const td = document.createElement('td');
            let val = feature.properties[key];
            if (typeof val === 'object') val = JSON.stringify(val);
            td.innerText = val || "";
            tr.appendChild(td);
        });
        
        const actionTd = document.createElement('td');
        const btn = document.createElement('button');
        btn.innerText = "Go";
        btn.onclick = () => {
            const temp = L.geoJSON(feature);
            if (feature.geometry.type === 'Point') map.flyTo(temp.getBounds().getCenter(), 16);
            else map.fitBounds(temp.getBounds());
        };
        actionTd.appendChild(btn);
        tr.appendChild(actionTd);
        tbody.appendChild(tr);
    });
}

// Query Modal Logic
function toggleQueryModal() {
    const modal = document.getElementById('queryModal');
    if (modal.style.display !== 'flex') updateQueryFields(); 
    modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
}

function updateQueryFields() {
    const layerVal = document.getElementById('q-layer-select').value;
    const fieldSelect = document.getElementById('q-field');
    const data = getLayerData(layerVal);

    fieldSelect.innerHTML = "";
    if (data && data.features && data.features.length > 0) {
        Object.keys(data.features[0].properties).forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.innerText = key;
            fieldSelect.appendChild(opt);
        });
    } else {
        const opt = document.createElement('option');
        opt.innerText = "No fields/Data loading...";
        fieldSelect.appendChild(opt);
    }
}

document.getElementById('q-layer-select').addEventListener('change', updateQueryFields);

function runQuery() {
    const layerSelect = document.getElementById('q-layer-select').value;
    const fieldInput = document.getElementById('q-field').value;
    const operator = document.getElementById('q-operator').value;
    const valueInput = document.getElementById('q-value').value.toLowerCase();
    const statusDiv = document.getElementById('query-status');

    let sourceData = getLayerData(layerSelect);
    let targetLayer;

    if (layerSelect === 'york') targetLayer = yorkLayer;
    else if (layerSelect === 'roads') targetLayer = roadsLayer;
    else if (layerSelect === 'addresses') targetLayer = addressesLayer;
    else if (layerSelect === 'parcels') targetLayer = parcelsLayer;
    else if (layerSelect === 'crime') targetLayer = crimeLayer;

    const filtered = sourceData.features.filter(f => {
        const propVal = (f.properties[fieldInput] || "").toString().toLowerCase();
        if (operator === 'contains') return propVal.includes(valueInput);
        if (operator === 'equals') return propVal === valueInput;
        if (operator === 'starts') return propVal.startsWith(valueInput);
        return false;
    });

    statusDiv.innerText = `Found ${filtered.length} features.`;

    targetLayer.clearLayers();
    if (layerSelect === 'crime') {
        targetLayer.addLayer(createCrimeLayer({ type: "FeatureCollection", features: filtered }));
    } else if (layerSelect === 'addresses') {
        const geoJsonData = L.geoJSON({ type: "FeatureCollection", features: filtered }, {
            pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 4, fillColor: "#3388ff", color: "#000", weight: 0.5, opacity: 1, fillOpacity: 0.8 }),
            onEachFeature: bindPopupWithBuffer
        });
        targetLayer.addLayer(geoJsonData);
    } else {
        targetLayer.addData({ type: "FeatureCollection", features: filtered });
    }

    filteredQueryData = { type: "FeatureCollection", features: filtered };
    const tableSelect = document.getElementById('table-layer-select');
    if (tableSelect) {
        tableSelect.value = layerSelect; 
        if (document.getElementById('attributeTable').style.display === 'flex') switchTableLayer();
    }
}

function resetQuery() {
    yorkLayer.clearLayers(); yorkLayer.addData(yorkData);
    roadsLayer.clearLayers(); roadsLayer.addData(roadsData);
    addressesLayer.clearLayers(); 
    addressesLayer.addLayer(L.geoJSON(addressesData, {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 4, fillColor: "#3388ff", color: "#000", weight: 0.5, opacity: 1, fillOpacity: 0.8 }),
        onEachFeature: bindPopupWithBuffer
    }));
    parcelsLayer.clearLayers(); parcelsLayer.addData(parcelsData);
    crimeLayer.clearLayers(); crimeLayer.addLayer(createCrimeLayer(crimeData));

    filteredQueryData = null;
    document.getElementById('query-status').innerText = "Reset done.";
    if (document.getElementById('attributeTable').style.display === 'flex') switchTableLayer();
}

// Map Controls Setup
function toggleInfoModal() {
    const modal = document.getElementById('infoModal');
    modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
}

function goHome() { map.setView(initialCenter, initialZoom); }

const baseMaps = { "OpenStreetMap": osmLayer, "Satellite": satelliteLayer, "Dark": darkLayer };
const overlayMaps = { 
    "York Boundaries": yorkLayer, 
    "Roads": roadsLayer,
    "Addresses": addressesLayer,
    "Parcels": parcelsLayer,
    "Crime Occurrences": crimeLayer
};

L.control.scale().addTo(map);
L.Control.geocoder({ defaultMarkGeocode: true, collapsed: true, placeholder: 'Search location...' }).addTo(map);
L.control.layers(baseMaps, overlayMaps).addTo(map);

const navControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function() {
        const c = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        const createBtn = (icon, title, fn) => {
            const a = L.DomUtil.create('a', '', c);
            a.innerHTML = `<i class="${icon}"></i>`;
            a.title = title; a.href = "#"; a.onclick = (e) => { e.preventDefault(); fn(); };
            return a;
        };
        createBtn('fa-solid fa-circle-info', 'Info', toggleInfoModal);
        createBtn('fa-solid fa-house', 'Home', goHome);
        createBtn('fa-solid fa-filter', 'Query', toggleQueryModal);
        createBtn('fa-solid fa-table-list', 'Table', toggleAttributeTable);
        return c;
    }
});
map.addControl(new navControl());

// Legend
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'info legend');
    div.innerHTML = `
        <h4>Legend</h4>
        <i style="background: rgba(128, 0, 32, 0.2); border: 2px solid #800020;"></i> York Boundary<br>
        <i style="background: #555"></i> Roads<br>
        <i style="background: #3388ff; border-radius: 50%;"></i> Addresses<br>
        <i style="background: rgba(34, 139, 34, 0.2); border: 1px solid #228b22;"></i> Parcels<br>
        <i class="fa-solid fa-shield-halved" style="color: #d9534f; font-size: 14px;"></i> High-Risk Incident<br>
        <i class="fa-solid fa-shield-halved" style="color: #f0ad4e; font-size: 14px;"></i> Property Incident
    `;
    return div;
};
legend.addTo(map);
