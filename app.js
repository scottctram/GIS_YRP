// APP JavaScript File Created by Scott Tram for GIS Analyst Opportunity #8166

// ===================================================================================================================================================== //
// MAP INITIALIZATION                                                                                                                                    //
// ===================================================================================================================================================== //

// Initial Zoom & Initial Centre kept as variables to be utilized by Home Button
const initialZoom = 13;
const initialCenter = [43.48, -80.54]; 
const map = L.map('map', { zoomControl: true }).setView(initialCenter, initialZoom);

// ===================================================================================================================================================== //
// GLOBAL VARIABLES                                                                                                                                      //
// ===================================================================================================================================================== //
let biodiversityData = { type: "FeatureCollection", features: [] };
let waterData = { type: "FeatureCollection", features: [] };
let sewerData = { type: "FeatureCollection", features: [] };
let parksPolyData = { type: "FeatureCollection", features: [] };

let bufferResultsData = { type: "FeatureCollection", features: [] };
let filteredQueryData = null; 
const bufferLayerGroup = L.layerGroup().addTo(map);


// ===================================================================================================================================================== //
// BASEMAPS                                                                                                                                              //
// Credit to OpenStreetMap, Esri, Carto                                                                                                                  //
// ===================================================================================================================================================== //
const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri' });
const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO', subdomains: 'abcd', maxZoom: 20 });

// ===================================================================================================================================================== //
// STATIC & DYNAMIC SYMBOLOGY & POPUP                                                                                                                    //
// ===================================================================================================================================================== //

// GreenStripe Pattern for Parks, as a Solid Green is already on most basemaps.
const greenStripe = new L.StripePattern({
    color: '#228b22', 
    weight: 2,
    spaceWeight: 5,
    angle: 45,
    opacity: 0.8
});
greenStripe.addTo(map); 

// Helper: Get color based on Pipe Material
// If the material is unknown, it defaults it to #ff6600ff
function getSewerColor(material) {
    if (!material) return '#ff6600ff'; 
    const mat = material.toString().toUpperCase();
    if (mat.includes('CHLORIDE')) return '#ff00c3ff';    
    if (mat.includes('CEMENT')) return '#642222fe';    
    if (mat.includes('CONCRETE') || mat.includes('VC')) return '#00ffaeff'; 
    if (mat.includes('CLAY') || mat.includes('DI')) return '#919191ff'; 
    return '#ff6600ff'; 
}

// Helper: Generate a consistent color from any text string for Trees, if no string, default to green
// This won't appear in the legend, but the Symbology Shape of a Tree will remain
function getColorFromText(str) {
    if(!str) return "#228b22"; 
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return "#" + "00000".substring(0, 6 - c.length) + c;
}

// Makeshift Popup, Displays the Feature's Fields and Values
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
// DATA & DATA API CALLS                                                                                                                                 //
// Data provided under the Waterloo Open Data User Licence.                                                                                              //
// All use of the data follows the terms of the licence, including proper handling, non-misrepresentation, and compliance with all applicable laws.      //
// The data is provided as is by the City of Waterloo, and no endorsement by the City is implied.                                                        //                                                                                                                    //
// ===================================================================================================================================================== //

// Non - Dynamic Data, Points of Interests
const pointsData = {
    "type": "FeatureCollection",
    "features": [
        { "type": "Feature", "properties": { "Name": "University of Waterloo", "Category": "University" }, "geometry": { "type": "Point", "coordinates": [-80.54,43.47] } },
        { "type": "Feature", "properties": { "Name": "Conestoga Mall", "Category": "Shopping Centre"}, "geometry": { "type": "Point", "coordinates": [-80.527, 43.498] } },
        { "type": "Feature", "properties": { "Name": "Wilfred Laurier University", "Category": "University"}, "geometry": { "type": "Point", "coordinates": [-80.527, 43.473] } }
    ]
};

const pointsLayer = L.geoJSON(pointsData, {
    pointToLayer: function (feature, latlng) {
        let color = "#ff7800";
        if(feature.properties.Category === "University") color = "#e40606ff";
        if(feature.properties.Category === "Shopping Centre") color = "#f5d100ff";
        return L.circleMarker(latlng, { radius: 8, fillColor: color, color: "#000", weight: 1, opacity: 1, fillOpacity: 0.8 });
    },
    onEachFeature: bindPopupWithBuffer
}).addTo(map);


// Biodiversity Layer (Trees)
const biodiversityLayer = L.markerClusterGroup();
biodiversityLayer.currentData = { type: "FeatureCollection", features: [] };

function createBioLayer(data) {
    return L.geoJSON(data, {
        pointToLayer: (feature, latlng) => {
            const color = getColorFromText(feature.properties.COM_NAME);
            const iconHtml = `<i class="fa-solid fa-tree" style="color: ${color}; font-size: 20px; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;"></i>`;
            const treeIcon = L.divIcon({
                className: 'tree-div-icon',
                html: iconHtml,
                iconSize: [24, 24],    
                iconAnchor: [12, 22],  
                popupAnchor: [0, -22]  
            });
            return L.marker(latlng, { icon: treeIcon });
        },
        onEachFeature: bindPopupWithBuffer
    });
}

fetch('https://services.arcgis.com/ZpeBVw5o1kjit7LT/arcgis/rest/services/Street_Tree_Inventory/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        biodiversityData = data;
        biodiversityLayer.currentData = data;
        biodiversityLayer.addLayer(createBioLayer(data));
        map.addLayer(biodiversityLayer);
    })
    .catch(err => console.error("Error loading Bio GeoJSON:", err));

// Water Bodies Layer
const waterLayer = L.geoJSON(null, {
    style: { color: "#0077be", weight: 1, opacity: 1, fillOpacity: 0.5 },
    onEachFeature: bindPopupWithBuffer
});

fetch('https://services.arcgis.com/ZpeBVw5o1kjit7LT/arcgis/rest/services/WaterFeatures_WaterBodies/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        waterData = data;
        waterLayer.addData(data);
        map.addLayer(waterLayer);
    })
    .catch(err => console.error("Error loading Water GeoJSON:", err));

// Sanitary Utility Sewer Layer
const sewerLayer = L.geoJSON(null, {
    style: function(feature) {
        return { 
            color: getSewerColor(feature.properties.MATERIAL), 
            weight: 2, 
            opacity: 1 
        };
    },
    onEachFeature: bindPopupWithBuffer
});

fetch('https://services.arcgis.com/ZpeBVw5o1kjit7LT/arcgis/rest/services/Sanitary_Sewer_Gravity_Mains/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        sewerData = data;
        sewerLayer.addData(data);
        map.addLayer(sewerLayer);
    })
    .catch(err => console.error("Error loading Sewer GeoJSON:", err));

// Park Layer that takes the greenStripe Symbology
const parksPolyLayer = L.geoJSON(null, {
    style: { 
        fillPattern: greenStripe, 
        color: "#228b22",         
        weight: 2, 
        opacity: 1, 
        fillOpacity: 1.0          
    },
    onEachFeature: bindPopupWithBuffer
});

fetch('https://services.arcgis.com/ZpeBVw5o1kjit7LT/arcgis/rest/services/Parks/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        parksPolyData = data;
        parksPolyLayer.addData(data);
        map.addLayer(parksPolyLayer);
    })
    .catch(err => console.error("Error loading Parks GeoJSON:", err));

// ===================================================================================================================================================== //
// FUNCTIONS - BUFFER, Attribute Table, Search                                                                                                           //
// ===================================================================================================================================================== //

// BUFFER within 2 (default) KM Function on each Popup
function initiateBuffer(feature) {
    const distanceStr = prompt("Enter buffer radius in Kilometers:", "2");
    if (!distanceStr) return;
    const distance = parseFloat(distanceStr);
    // if NaN (Not A Number) - accounts for user error
    if (isNaN(distance)) return alert("Invalid number");

    bufferLayerGroup.clearLayers();
    
    const buffered = turf.buffer(feature, distance, {units: 'kilometers'});
    
    // Just to visualize the buffer
    const bufferVis = L.geoJSON(buffered, {
        style: { color: '#FF0000', weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }
    }).addTo(bufferLayerGroup);
    
    map.fitBounds(bufferVis.getBounds());

    // All Sources that are bufferable
    const sources = [
        { name: "Points of Interest", list: pointsData.features },
        { name: "Trees", list: biodiversityData.features },
        { name: "Water Bodies", list: waterData.features },
        { name: "Sanitary Sewers", list: sewerData.features },
        { name: "Parks", list: parksPolyData.features }
    ];
    
    const foundFeatures = [];
    
    sources.forEach(source => {
        if(!source.list) return;
        source.list.forEach(f => {
            try {
                if (turf.booleanIntersects(f, buffered)) {
                    const keys = Object.keys(f.properties);
                    const firstValue = keys.length > 0 ? f.properties[keys[0]] : "Unknown";

                    const formattedFeature = {
                        type: "Feature",
                        geometry: f.geometry,
                        properties: {
                            "Table Name": source.name,
                            "Identifier": firstValue
                        }
                    };
                    foundFeatures.push(formattedFeature);
                }
            } catch (e) { }
        });
    });

    bufferResultsData = { type: "FeatureCollection", features: foundFeatures };
    
    // Notifies and swaps to the Table of all buffer results.
    alert(`Found ${foundFeatures.length} features within ${distance}km! Opening table...`);
    
    document.getElementById('attributeTable').style.display = 'flex';
    document.getElementById('map').style.height = '65vh';
    map.invalidateSize();
    
    const select = document.getElementById('table-layer-select');
    select.value = "buffer_results";
    switchTableLayer(); 
}


// ATTRIBUTE TABLE LOGIC
function getActiveTableLayerId() { 
    const el = document.getElementById('table-layer-select');
    return el ? el.value : 'points'; 
}

function getLayerData(id) {
    const queryLayer = document.getElementById('q-layer-select').value;
    if (filteredQueryData && id === queryLayer) {
        return filteredQueryData;
    }
    if (id === 'biodiversity') return biodiversityLayer.currentData;
    if (id === 'water') return waterData;
    if (id === 'sewer') return sewerData;
    if (id === 'parks_poly') return parksPolyData;
    if (id === 'buffer_results') return bufferResultsData;
    return pointsData;
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

// Table Search heavily inspired by FME Workbench
function switchTableLayer() {
    const searchBox = document.getElementById('table-search');
    if (searchBox) searchBox.value = ""; 
    
    const activeId = getActiveTableLayerId();
    const data = getLayerData(activeId);
    renderTable(data);
}

const tableSearchInput = document.getElementById('table-search');
if (tableSearchInput) {
    tableSearchInput.addEventListener('input', function(e) {
        const term = e.target.value.toLowerCase();
        const activeId = getActiveTableLayerId();
        const fullData = getLayerData(activeId);

        if (!fullData.features) return;

        const filteredFeatures = fullData.features.filter(feature => {
            const props = feature.properties;
            return Object.values(props).some(val => 
                String(val).toLowerCase().includes(term)
            );
        });

        renderTable({ type: "FeatureCollection", features: filteredFeatures });
    });
}

function renderTable(data) {
    const thead = document.getElementById('table-headers');
    const tbody = document.getElementById('table-body');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (!data.features || data.features.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No features found, please check if layers are filtered.</td></tr>';
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

    const displayFeatures = data.features.slice(0, 100); 

    displayFeatures.forEach(feature => {
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

// ===================================================================================================================================================== //
// FUNCTIONS - QUERY & FILTER                                                                                                                            //
// ===================================================================================================================================================== //

function toggleQueryModal() {
    const modal = document.getElementById('queryModal');
    if (modal.style.display !== 'flex') {
        updateQueryFields(); 
    }
    modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
}

function updateQueryFields() {
    const layerSelect = document.getElementById('q-layer-select');
    const fieldSelect = document.getElementById('q-field');
    const layerVal = layerSelect.value;

    let data;
    if (layerVal === 'points') data = pointsData;
    else if (layerVal === 'biodiversity') data = biodiversityLayer.currentData;
    else if (layerVal === 'water') data = waterData;
    else if (layerVal === 'sewer') data = sewerData;
    else if (layerVal === 'parks_poly') data = parksPolyData;

    fieldSelect.innerHTML = "";

    if (data && data.features && data.features.length > 0) {
        const props = data.features[0].properties;
        Object.keys(props).forEach(key => {
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

function clearQueryForm() {
    const layerSelect = document.getElementById('q-layer-select');
    layerSelect.selectedIndex = 0;
    updateQueryFields();
    document.getElementById('q-operator').selectedIndex = 0;
    document.getElementById('q-value').value = "";
    document.getElementById('query-status').innerText = "";
}

function runQuery() {
    const layerSelect = document.getElementById('q-layer-select').value;
    const fieldInput = document.getElementById('q-field').value;
    const operator = document.getElementById('q-operator').value;
    const valueInput = document.getElementById('q-value').value.toLowerCase();
    const statusDiv = document.getElementById('query-status');

    let sourceData;
    let targetLayer;

    if (layerSelect === 'points') { sourceData = pointsData; targetLayer = pointsLayer; } 
    else if (layerSelect === 'biodiversity') { sourceData = biodiversityData; targetLayer = biodiversityLayer; }
    else if (layerSelect === 'water') { sourceData = waterData; targetLayer = waterLayer; }
    else if (layerSelect === 'sewer') { sourceData = sewerData; targetLayer = sewerLayer; }
    else if (layerSelect === 'parks_poly') { sourceData = parksPolyData; targetLayer = parksPolyLayer; }

    // Only using Contains, Equals, or Starts with. Future Release will have Not Equal and Multi Field Query
    const filtered = sourceData.features.filter(f => {
        const propVal = (f.properties[fieldInput] || "").toString().toLowerCase();
        if (operator === 'contains') return propVal.includes(valueInput);
        if (operator === 'equals') return propVal === valueInput;
        if (operator === 'starts') return propVal.startsWith(valueInput);
        return false;
    });

    statusDiv.innerText = `Found ${filtered.length} features.`;

    if (layerSelect === 'biodiversity') {
        targetLayer.clearLayers();
        targetLayer.addLayer(createBioLayer({type: "FeatureCollection", features: filtered}));
    } else {
        targetLayer.clearLayers();
        targetLayer.addData({type: "FeatureCollection", features: filtered});
    }

    filteredQueryData = { type: "FeatureCollection", features: filtered };
    const tableSelect = document.getElementById('table-layer-select');
    if(tableSelect) {
        tableSelect.value = layerSelect; 
        if(document.getElementById('attributeTable').style.display === 'flex') {
            switchTableLayer();
        }
    }
}

function resetQuery() {
    pointsLayer.clearLayers(); pointsLayer.addData(pointsData);
    biodiversityLayer.clearLayers(); biodiversityLayer.addLayer(createBioLayer(biodiversityData));
    waterLayer.clearLayers(); waterLayer.addData(waterData);
    sewerLayer.clearLayers(); sewerLayer.addData(sewerData);
    parksPolyLayer.clearLayers(); parksPolyLayer.addData(parksPolyData);

    filteredQueryData = null;
    document.getElementById('query-status').innerText = "Reset done.";
    clearQueryForm();

    if(document.getElementById('attributeTable').style.display === 'flex') {
        switchTableLayer();
    }
}


// ===================================================================================================================================================== //
// FUNCTIONS - Additional Buttons                                                                                                                        //
// ===================================================================================================================================================== //

// Info Button Toggles HTML
function toggleInfoModal() {
    const modal = document.getElementById('infoModal');
    modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
}

// Back Button to go back to last previous extents, keeps track of coordinates and centre within an Array.
let viewHistory = [];
let isGoingBack = false;
viewHistory.push({ center: map.getCenter(), zoom: map.getZoom() });
map.on('moveend', function() {
    if (isGoingBack) { isGoingBack = false; return; }
    if (viewHistory.length > 50) viewHistory.shift();
    viewHistory.push({ center: map.getCenter(), zoom: map.getZoom() });
});
function goBack() {
    if (viewHistory.length > 1) {
        viewHistory.pop();
        const prev = viewHistory[viewHistory.length - 1];
        isGoingBack = true;
        map.setView(prev.center, prev.zoom);
    }
}

// Home Button
function goHome() { map.setView(initialCenter, initialZoom); }

const baseMaps = { "OpenStreetMap": osmLayer, "Satellite": satelliteLayer, "Dark": darkLayer };
const overlayMaps = { 
    "Points of Interests": pointsLayer, 
    "Biodiversity": biodiversityLayer,
    "Water Bodies": waterLayer,
    "Sanitary Sewers": sewerLayer,
    "Parks": parksPolyLayer
};

// Default Scale bottom left
L.control.scale().addTo(map);

// External Plugin for Search L.Control not L.control
L.Control.geocoder({ defaultMarkGeocode: true, 
                     collapsed: true,
                     placeholder: 'Search for a location..'
                     }).addTo(map);

// Layers & Basemap Toggle 
L.control.layers(baseMaps, overlayMaps).addTo(map);

// Buttons for Each Function
const navControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function(map) {
        const c = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        const createBtn = (icon, title, fn) => {
            const a = L.DomUtil.create('a', '', c);
            a.innerHTML = `<i class="${icon}"></i>`;
            a.title = title; a.href = "#"; a.onclick = (e) => { e.preventDefault(); fn(); };
            return a;
        };
        createBtn('fa-solid fa-circle-info', 'Info', toggleInfoModal);
        createBtn('fa-solid fa-house', 'Home', goHome);
        createBtn('fa-solid fa-rotate-left', 'Back', goBack);
        createBtn('fa-solid fa-filter', 'Query', toggleQueryModal);
        createBtn('fa-solid fa-table-list', 'Table', toggleAttributeTable);
        return c;
    }
});
map.addControl(new navControl());

// Legend
// Since Trees are dynamically being coloured, showing default symbol only
const legend = L.control({position: 'bottomleft'});
legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'info legend');
    div.innerHTML = `
        <h4>Legend</h4>
        <i class="legend-poi-uni"></i> University<br>
        <i class="legend-poi-shoppingcentre"></i> Shopping Centre<br>
        <i class="fa-solid fa-tree" style="color: #228b22; font-size: 16px;"></i> Trees <br>
        <i style="background:#0077be"></i> Water Bodies<br>
        <i style="background: repeating-linear-gradient(45deg, #228b22, #228b22 2px, #fff 2px, #fff 4px); opacity:0.8; border: 1px solid #228b22;"></i> Parks<br>
        <hr>
        <strong>Sewer Material:</strong><br>
        <i style="background:#ff00c3ff"></i> Chloride<br>
        <i style="background:#642222fe"></i> Cement<br>
        <i style="background:#00ffaeff"></i> Concrete/VC<br>
        <i style="background:#919191ff"></i> Clay/DI<br>
        <i style="background:#ff6600ff"></i> Other/Unknown
    `;
    return div;
};
legend.addTo(map);