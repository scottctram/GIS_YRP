// APP JavaScript File - York Regional Police Public Safety & Intelligence Web Map

// ===================================================================================================================================================== //
// MAP INITIALIZATION                                                                                                                                    //
// ===================================================================================================================================================== //

const initialZoom = 10;
const initialCenter = [44.00, -79.45]; 
const map = L.map('map', { zoomControl: true }).setView(initialCenter, initialZoom);

const MIN_ZOOM_LEVEL = 15; 
const ROAD_SAFETY_ZOOM_LEVEL = 13; // Zoom 13 = ~2km viewport threshold for individual collision markers

// Month Mapping Array
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ===================================================================================================================================================== //
// GLOBAL VARIABLES                                                                                                                                      //
// ===================================================================================================================================================== //
let yorkData = { type: "FeatureCollection", features: [] };
let districtData = { type: "FeatureCollection", features: [] };
let policeData = { type: "FeatureCollection", features: [] };
let hospitalData = { type: "FeatureCollection", features: [] };
let crimeData = { type: "FeatureCollection", features: [] };
let roadSafetyData = { type: "FeatureCollection", features: [] };

let roadsData = { type: "FeatureCollection", features: [] };
let addressesData = { type: "FeatureCollection", features: [] };
let parcelsData = { type: "FeatureCollection", features: [] };

let bufferResultsData = { type: "FeatureCollection", features: [] };
let filteredQueryData = null; 
const bufferLayerGroup = L.layerGroup().addTo(map);

// Global Legend Container Reference
let legendContainerDiv = null;

// Heatmap & Operational Variables
let crimeHeatmapLayer = null;
let roadSafetyHeatmapLayer = null;

let currentShiftFilter = "ALL"; // "ALL", "DAY", "NIGHT"
let currentPersonaMode = "ANALYST"; // "ANALYST", "OFFICER"
let currentSelectedMonth = "ALL"; // "ALL" or 0-11 (0=Jan, 11=Dec)
let timelineInterval = null;

// ===================================================================================================================================================== //
// BASEMAPS                                                                                                                                              //
// ===================================================================================================================================================== //
const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri' });
const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO', subdomains: 'abcd', maxZoom: 20 });

// Helper: Popup displaying feature fields and a Buffer Trigger
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

// Helper: Extract 0-indexed Month (0-11) from occ_date property
function getMonthFromOccDate(occDateRaw) {
    if (!occDateRaw) return null;
    const dt = new Date(occDateRaw);
    if (!isNaN(dt.getTime())) {
        return dt.getMonth(); // Returns 0 for Jan, 11 for Dec
    }
    return null;
}

// ===================================================================================================================================================== //
// BOUNDARIES & DISTRICTS LAYERS                                                                                                                         //
// ===================================================================================================================================================== //

// 1. Regional Boundary Layer
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
        updateLegend();
    })
    .catch(err => console.error("Error loading York Boundaries GeoJSON:", err));

// 2. YRP District Boundaries Layer
const districtLayer = L.layerGroup().addTo(map);

function createDistrictLayer(data) {
    return L.geoJSON(data, {
        style: {
            color: "#003399",
            weight: 2,
            dashArray: "6, 6",
            fillColor: "#3388ff",
            fillOpacity: 0.12
        },
        onEachFeature: (feature, layer) => {
            bindPopupWithBuffer(feature, layer);
            if (feature.properties && feature.properties.DistrictNumber) {
                const districtNum = feature.properties.DistrictNumber;
                layer.bindTooltip(`District ${districtNum}`, {
                    permanent: true,
                    direction: 'center',
                    className: 'district-label-tooltip'
                });
            }
        }
    });
}

fetch('districts.json')
    .then(response => response.json())
    .then(data => {
        districtData = data;
        districtLayer.clearLayers();
        districtLayer.addLayer(createDistrictLayer(data));
        updateLegend();
    })
    .catch(err => console.error("Error loading Districts GeoJSON:", err));

// ===================================================================================================================================================== //
// STATIC PUBLIC SAFETY LAYERS (POLICE, HOSPITALS, CRIME, ROAD SAFETY)                                                                                  //
// ===================================================================================================================================================== //

// 1. Police Stations Layer
const policeLayer = L.layerGroup().addTo(map);

function createPoliceLayer(data) {
    return L.geoJSON(data, {
        pointToLayer: (feature, latlng) => {
            const svgBadge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ffffff" width="18px" height="18px">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-5.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z"/>
            </svg>`;

            const iconHtml = `<div style="display:flex; align-items:center; justify-content:center; width:32px; height:32px; background:#002b80; border:2px solid #ffffff; border-radius:50%; box-shadow:0 3px 6px rgba(0,0,0,0.4);">
                ${svgBadge}
            </div>`;

            const policeIcon = L.divIcon({
                className: 'police-div-icon',
                html: iconHtml,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
                popupAnchor: [0, -16]
            });
            return L.marker(latlng, { icon: policeIcon });
        },
        onEachFeature: bindPopupWithBuffer
    });
}

fetch('https://services8.arcgis.com/lYI034SQcOoxRCR7/arcgis/rest/services/PoliceStation/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        policeData = data;
        policeLayer.clearLayers();
        policeLayer.addLayer(createPoliceLayer(data));
        updateLegend();
    })
    .catch(err => console.error("Error loading Police Stations GeoJSON:", err));

// 2. Hospitals Layer
const hospitalLayer = L.layerGroup().addTo(map);

function createHospitalLayer(data) {
    return L.geoJSON(data, {
        pointToLayer: (feature, latlng) => {
            const iconHtml = `<div style="display:flex; align-items:center; justify-content:center; width:28px; height:28px; background:#d9534f; border:2px solid #ffffff; border-radius:50%; box-shadow:0 2px 6px rgba(0,0,0,0.4); color:#ffffff; font-weight:bold; font-size:15px; font-family:sans-serif;">
                H
            </div>`;

            const hospitalIcon = L.divIcon({
                className: 'hospital-div-icon',
                html: iconHtml,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                popupAnchor: [0, -14]
            });
            return L.marker(latlng, { icon: hospitalIcon });
        },
        onEachFeature: bindPopupWithBuffer
    });
}

fetch('https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Health_And_Safety/MapServer/1/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        hospitalData = data;
        hospitalLayer.clearLayers();
        hospitalLayer.addLayer(createHospitalLayer(data));
        updateLegend();
    })
    .catch(err => console.error("Error loading Hospitals GeoJSON:", err));

// 3. Crime Occurrences Layer
const crimeLayer = L.layerGroup().addTo(map);

function getCrimeCategory(type) {
    if (!type) return "OTHER";
    const t = type.toString().toUpperCase();
    if (t.includes("ROBBERY") || t.includes("ASSAULT") || t.includes("WEAPON")) return "HIGH_RISK";
    if (t.includes("AUTO THEFT") || t.includes("THEFT")) return "PROPERTY";
    if (t.includes("BREAK AND ENTER") || t.includes("MISCHIEF") || t.includes("B & E")) return "BE_MISCHIEF";
    return "OTHER";
}

function getCrimeColor(type) {
    const cat = getCrimeCategory(type);
    if (cat === "HIGH_RISK") return "#d9534f";    // Red
    if (cat === "PROPERTY") return "#f0ad4e";     // Orange
    if (cat === "BE_MISCHIEF") return "#5bc0de";  // Light Blue
    return "#3388ff";                            // Dark Blue
}

function isHighRiskCrime(type) {
    return getCrimeCategory(type) === "HIGH_RISK";
}

function createCrimeLayer(data) {
    const layerGroup = L.layerGroup();
    if (!data || !data.features) return layerGroup;

    const heatPoints = [];

    data.features.forEach(feature => {
        let lat, lng;

        if (feature.geometry && feature.geometry.coordinates) {
            lng = parseFloat(feature.geometry.coordinates[0]);
            lat = parseFloat(feature.geometry.coordinates[1]);
        }
        
        if ((isNaN(lat) || isNaN(lng)) && feature.properties) {
            lng = parseFloat(feature.properties.X);
            lat = parseFloat(feature.properties.Y);
        }

        if (!isNaN(lat) && !isNaN(lng)) {
            const crimeType = feature.properties.cr_ucr_tra || feature.properties.CATEGORY || "Incident";
            const color = getCrimeColor(crimeType);
            const highRisk = isHighRiskCrime(crimeType);

            heatPoints.push([lat, lng, highRisk ? 1.0 : 0.6]);

            const marker = L.circleMarker([lat, lng], {
                radius: highRisk ? 8 : 6,
                fillColor: color,
                color: highRisk ? "#ff0000" : "#000000",
                weight: highRisk ? 2 : 1,
                opacity: 1,
                fillOpacity: 0.85
            });

            bindPopupWithBuffer(feature, marker);
            layerGroup.addLayer(marker);
        }
    });

    if (typeof L.heatLayer === 'function') {
        if (crimeHeatmapLayer) map.removeLayer(crimeHeatmapLayer);
        crimeHeatmapLayer = L.heatLayer(heatPoints, { radius: 25, blur: 15, maxZoom: 15 });
    }

    return layerGroup;
}

fetch('yk_crime_rpt22.json')
    .then(response => response.json())
    .then(data => {
        crimeData = data;
        crimeLayer.clearLayers();
        crimeLayer.addLayer(createCrimeLayer(data));
        populateCrimeTypeDropdown(data);
        updateOperationalBriefingCard();
        updateLegend();
    })
    .catch(err => console.error("Error loading Crime GeoJSON:", err));

// 4. Road Safety Layer
const roadSafetyLayer = L.layerGroup().addTo(map);

function renderRoadSafetyMarkers(dataToRender) {
    roadSafetyLayer.clearLayers();
    const sourceFeatures = (dataToRender && dataToRender.features) ? dataToRender.features : (roadSafetyData ? roadSafetyData.features : []);
    if (!sourceFeatures) return;

    const heatPoints = [];

    sourceFeatures.forEach(feature => {
        if (feature.geometry && feature.geometry.coordinates) {
            const lng = parseFloat(feature.geometry.coordinates[0]);
            const lat = parseFloat(feature.geometry.coordinates[1]);

            if (!isNaN(lat) && !isNaN(lng)) {
                heatPoints.push([lat, lng, 0.7]);

                if (map.getZoom() >= ROAD_SAFETY_ZOOM_LEVEL) {
                    const warningSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#d9534f" width="14px" height="14px">
                        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
                    </svg>`;

                    const iconHtml = `<div style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; background:#fff3cd; border:2px solid #ffc107; border-radius:50%; box-shadow:0 2px 5px rgba(0,0,0,0.3);">${warningSvg}</div>`;

                    const warningIcon = L.divIcon({
                        className: 'road-safety-div-icon',
                        html: iconHtml,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12],
                        popupAnchor: [0, -12]
                    });

                    const marker = L.marker([lat, lng], { icon: warningIcon });
                    bindPopupWithBuffer(feature, marker);
                    roadSafetyLayer.addLayer(marker);
                }
            }
        }
    });

    if (typeof L.heatLayer === 'function' && heatPoints.length > 0) {
        if (roadSafetyHeatmapLayer) map.removeLayer(roadSafetyHeatmapLayer);
        roadSafetyHeatmapLayer = L.heatLayer(heatPoints, { 
            radius: 25, 
            blur: 15, 
            maxZoom: 15,
            gradient: { 0.4: '#ffeb3b', 0.7: '#ff9800', 1.0: '#f44336' }
        });
    }
}

fetch('https://services8.arcgis.com/lYI034SQcOoxRCR7/arcgis/rest/services/Road_Safety/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson')
    .then(response => response.json())
    .then(data => {
        roadSafetyData = data;
        renderRoadSafetyMarkers();
        updateOperationalBriefingCard();
        updateLegend();
    })
    .catch(err => console.error("Error loading Road Safety GeoJSON:", err));

// ===================================================================================================================================================== //
// DYNAMIC VIEWPORT (BBOX) LAYERS                                                                                                                       //
// ===================================================================================================================================================== //

const roadsLayer = L.geoJSON(null, { style: { color: "#555555", weight: 2, opacity: 0.8 }, onEachFeature: bindPopupWithBuffer });
const addressesLayer = L.markerClusterGroup({ spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: true });
const parcelsLayer = L.geoJSON(null, { style: { color: "#228b22", weight: 1, opacity: 0.8, fillOpacity: 0.2 }, onEachFeature: bindPopupWithBuffer });

function fetchViewportData() {
    const currentZoom = map.getZoom();

    renderRoadSafetyMarkers();

    if (currentZoom < MIN_ZOOM_LEVEL) {
        roadsLayer.clearLayers();
        addressesLayer.clearLayers();
        parcelsLayer.clearLayers();
        roadsData = { type: "FeatureCollection", features: [] };
        addressesData = { type: "FeatureCollection", features: [] };
        parcelsData = { type: "FeatureCollection", features: [] };
        return;
    }

    const bbox = map.getBounds().toBBoxString();

    if (map.hasLayer(roadsLayer)) {
        fetch(`https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Transportation/MapServer/1/query?outFields=*&geometry=${bbox}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&f=geojson`)
            .then(res => res.json())
            .then(data => { roadsData = data; roadsLayer.clearLayers(); roadsLayer.addData(data); })
            .catch(err => console.error("Error fetching BBOX Roads:", err));
    }

    if (map.hasLayer(addressesLayer)) {
        fetch(`https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Location/MapServer/0/query?outFields=*&geometry=${bbox}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&f=geojson`)
            .then(res => res.json())
            .then(data => {
                addressesData = data;
                addressesLayer.clearLayers();
                const geoJsonData = L.geoJSON(data, {
                    pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 5, fillColor: "#3388ff", color: "#000", weight: 0.5, opacity: 1, fillOpacity: 0.8 }),
                    onEachFeature: bindPopupWithBuffer
                });
                addressesLayer.addLayer(geoJsonData);
            })
            .catch(err => console.error("Error fetching BBOX Addresses:", err));
    }

    if (map.hasLayer(parcelsLayer)) {
        fetch(`https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Planning/FeatureServer/0/query?outFields=*&geometry=${bbox}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&f=geojson`)
            .then(res => res.json())
            .then(data => { parcelsData = data; parcelsLayer.clearLayers(); parcelsLayer.addData(data); })
            .catch(err => console.error("Error fetching BBOX Parcels:", err));
    }
}

map.on('moveend', () => {
    fetchViewportData();
    updateOperationalBriefingCard();
});

map.on('overlayadd overlayremove', function(e) {
    if (e.layer === roadsLayer || e.layer === addressesLayer || e.layer === parcelsLayer) {
        fetchViewportData();
    }
    updateLegend();
});

// ===================================================================================================================================================== //
// OPERATIONAL SHIFT, TEMPORAL SLIDER & COMBINED FILTERS                                                                                               //
// ===================================================================================================================================================== //

function setPersonaMode(mode) {
    currentPersonaMode = mode;
    const analystBtn = document.getElementById('btn-persona-analyst');
    const officerBtn = document.getElementById('btn-persona-officer');
    const shiftBar = document.getElementById('shift-filter-bar');

    if (mode === 'OFFICER') {
        if (analystBtn) analystBtn.classList.remove('active');
        if (officerBtn) officerBtn.classList.add('active');
        if (shiftBar) shiftBar.style.display = 'flex';
        if (crimeHeatmapLayer && map.hasLayer(crimeHeatmapLayer)) map.removeLayer(crimeHeatmapLayer);
        if (roadSafetyHeatmapLayer && map.hasLayer(roadSafetyHeatmapLayer)) map.removeLayer(roadSafetyHeatmapLayer);
        if (!map.hasLayer(crimeLayer)) map.addLayer(crimeLayer);
    } else {
        if (officerBtn) officerBtn.classList.remove('active');
        if (analystBtn) analystBtn.classList.add('active');
        if (shiftBar) shiftBar.style.display = 'none';
        setShiftFilter('ALL');
    }
    updateOperationalBriefingCard();
}

function setShiftFilter(shift) {
    currentShiftFilter = shift;
    document.querySelectorAll('.btn-shift').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-shift-${shift.toLowerCase()}`);
    if (activeBtn) activeBtn.classList.add('active');

    applyCombinedFilters();
}

function toggleCrimeHeatmap() {
    if (!crimeHeatmapLayer) return alert("Crime Heatmap initializing...");
    if (map.hasLayer(crimeHeatmapLayer)) {
        map.removeLayer(crimeHeatmapLayer);
    } else {
        map.addLayer(crimeHeatmapLayer);
    }
}

function toggleTrafficHeatmap() {
    if (!roadSafetyHeatmapLayer) return alert("Traffic Heatmap initializing...");
    if (map.hasLayer(roadSafetyHeatmapLayer)) {
        map.removeLayer(roadSafetyHeatmapLayer);
    } else {
        map.addLayer(roadSafetyHeatmapLayer);
    }
}

// Timeline Modal & Playback Control Functions
function toggleTimelineModal() {
    const modal = document.getElementById('timelineModal');
    if (modal) modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
}

function updateTemporalSlider(val) {
    const monthLabel = document.getElementById('time-slider-label');
    if (val === "12" || val === 12) {
        currentSelectedMonth = "ALL";
        if (monthLabel) monthLabel.innerText = "All Months (Jan - Dec)";
    } else {
        const monthIndex = parseInt(val, 10);
        currentSelectedMonth = monthIndex;
        if (monthLabel) monthLabel.innerText = MONTH_NAMES[monthIndex];
    }
    applyCombinedFilters();
}

function toggleTimelinePlayback() {
    const btn = document.getElementById('btn-play-timeline');
    if (timelineInterval) {
        clearInterval(timelineInterval);
        timelineInterval = null;
        if (btn) btn.innerHTML = `<i class="fa-solid fa-play"></i> Play Timeline`;
    } else {
        if (btn) btn.innerHTML = `<i class="fa-solid fa-pause"></i> Pause Timeline`;
        let curVal = (currentSelectedMonth === "ALL") ? 0 : currentSelectedMonth;
        
        timelineInterval = setInterval(() => {
            updateTemporalSlider(curVal);
            const slider = document.getElementById('time-slider');
            if (slider) slider.value = curVal;
            
            curVal = (curVal + 1) % 12;
        }, 1200);
    }
}

function resetTimelineFilter() {
    if (timelineInterval) {
        clearInterval(timelineInterval);
        timelineInterval = null;
        const btn = document.getElementById('btn-play-timeline');
        if (btn) btn.innerHTML = `<i class="fa-solid fa-play"></i> Play Timeline`;
    }
    const timeSlider = document.getElementById('time-slider');
    if (timeSlider) {
        timeSlider.value = 12;
        updateTemporalSlider(12);
    }
}

function applyCombinedFilters() {
    const selectedRiskCategory = document.getElementById('crime-risk-select') ? document.getElementById('crime-risk-select').value : 'ALL';
    const selectedCrimeType = document.getElementById('crime-type-select') ? document.getElementById('crime-type-select').value : 'ALL';
    const statusDiv = document.getElementById('crime-filter-status');

    // 1. Filter Crime Occurrences Layer
    let filteredCrimes = [];
    if (crimeData && crimeData.features) {
        filteredCrimes = crimeData.features.filter(f => {
            const props = f.properties || {};
            const offenseType = props.cr_ucr_tra || props.CATEGORY || "";
            const riskCategory = getCrimeCategory(offenseType);

            const riskMatch = (selectedRiskCategory === 'ALL') || (riskCategory === selectedRiskCategory);
            const typeMatch = (selectedCrimeType === 'ALL') || (offenseType === selectedCrimeType);

            let shiftMatch = true;
            if (currentShiftFilter !== 'ALL') {
                const rawTime = parseInt(props.occ_time, 10);
                if (!isNaN(rawTime)) {
                    const isDay = (rawTime >= 700 && rawTime < 1900);
                    shiftMatch = (currentShiftFilter === 'DAY') ? isDay : !isDay;
                }
            }

            let temporalMatch = true;
            if (currentSelectedMonth !== "ALL") {
                const featureMonth = getMonthFromOccDate(props.occ_date);
                temporalMatch = (featureMonth === currentSelectedMonth);
            }

            return riskMatch && typeMatch && shiftMatch && temporalMatch;
        });
    }

    crimeLayer.clearLayers();
    crimeLayer.addLayer(createCrimeLayer({ type: "FeatureCollection", features: filteredCrimes }));

    // 2. Filter Road Safety Layer
    let filteredTraffic = [];
    if (roadSafetyData && roadSafetyData.features) {
        filteredTraffic = roadSafetyData.features.filter(f => {
            const props = f.properties || {};

            let shiftMatch = true;
            if (currentShiftFilter !== 'ALL') {
                const rawTime = parseInt(props.time_est || props.ACCIDENT_TIME || props.TIME, 10);
                if (!isNaN(rawTime)) {
                    const isDay = (rawTime >= 700 && rawTime < 1900);
                    shiftMatch = (currentShiftFilter === 'DAY') ? isDay : !isDay;
                }
            }

            let temporalMatch = true;
            if (currentSelectedMonth !== "ALL") {
                const featureMonth = getMonthFromOccDate(props.occ_date);
                temporalMatch = (featureMonth === currentSelectedMonth);
            }

            return shiftMatch && temporalMatch;
        });
    }

    renderRoadSafetyMarkers({ type: "FeatureCollection", features: filteredTraffic });

    if (statusDiv) {
        statusDiv.innerText = `Displaying ${filteredCrimes.length} crimes & ${filteredTraffic.length} traffic incidents.`;
    }

    updateOperationalBriefingCard();
}

function updateOperationalBriefingCard() {
    const briefingDiv = document.getElementById('operational-briefing-content');
    if (!briefingDiv || !crimeData.features) return;

    const bounds = map.getBounds();
    let totalInView = 0;
    let highRiskCount = 0;
    let trafficCollisionsInView = 0;
    const categoryCounts = {};

    crimeData.features.forEach(f => {
        let lat, lng;
        if (f.geometry && f.geometry.coordinates) {
            lng = parseFloat(f.geometry.coordinates[0]);
            lat = parseFloat(f.geometry.coordinates[1]);
        } else if (f.properties) {
            lng = parseFloat(f.properties.X);
            lat = parseFloat(f.properties.Y);
        }

        if (!isNaN(lat) && !isNaN(lng) && bounds.contains([lat, lng])) {
            const type = f.properties.cr_ucr_tra || f.properties.CATEGORY || "Other";
            totalInView++;
            if (isHighRiskCrime(type)) highRiskCount++;
            categoryCounts[type] = (categoryCounts[type] || 0) + 1;
        }
    });

    if (roadSafetyData && roadSafetyData.features) {
        roadSafetyData.features.forEach(f => {
            if (f.geometry && f.geometry.coordinates) {
                const lng = parseFloat(f.geometry.coordinates[0]);
                const lat = parseFloat(f.geometry.coordinates[1]);
                if (!isNaN(lat) && !isNaN(lng) && bounds.contains([lat, lng])) {
                    trafficCollisionsInView++;
                }
            }
        });
    }

    const topOffense = Object.keys(categoryCounts).sort((a, b) => categoryCounts[b] - categoryCounts[a])[0] || "None";
    const monthText = (currentSelectedMonth === "ALL") ? "All Months" : MONTH_NAMES[currentSelectedMonth];

    briefingDiv.innerHTML = `
        <div class="briefing-stat-row"><span>Crimes in View:</span> <b>${totalInView}</b></div>
        <div class="briefing-stat-row"><span>High-Risk Hazards:</span> <b style="color:#d9534f;">${highRiskCount}</b></div>
        <div class="briefing-stat-row"><span>Traffic Hazards:</span> <b style="color:#f0ad4e;">${trafficCollisionsInView}</b></div>
        <div class="briefing-stat-row"><span>Primary Offense:</span> <b>${topOffense.substring(0, 20)}</b></div>
        <div class="briefing-stat-row"><span>Active Month:</span> <b>${monthText}</b></div>
        <div class="briefing-stat-row"><span>Active Shift:</span> <b>${currentShiftFilter}</b></div>
    `;
}

// ===================================================================================================================================================== //
// CRIME FILTER MODAL FUNCTIONS                                                                                                                          //
// ===================================================================================================================================================== //

function toggleCrimeFilterModal() {
    const modal = document.getElementById('crimeFilterModal');
    if (modal) modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
}

function populateCrimeTypeDropdown(data) {
    const select = document.getElementById('crime-type-select');
    if (!select || !data || !data.features) return;

    const types = new Set();
    data.features.forEach(f => {
        const type = f.properties.cr_ucr_tra || f.properties.CATEGORY;
        if (type) types.add(type);
    });

    select.innerHTML = '<option value="ALL">-- All Specific Offense Types --</option>';
    Array.from(types).sort().forEach(type => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.innerText = type;
        select.appendChild(opt);
    });
}

function filterCrimeData() {
    applyCombinedFilters();
}

function resetCrimeFilter() {
    const riskSelect = document.getElementById('crime-risk-select');
    const typeSelect = document.getElementById('crime-type-select');
    if (riskSelect) riskSelect.value = 'ALL';
    if (typeSelect) typeSelect.value = 'ALL';
    resetTimelineFilter();
}

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
        { name: "York Boundary", list: yorkData.features, aliasKey: "NAME", locKey: "MUNICIPALITY" },
        { name: "YRP Districts", list: districtData.features, aliasKey: "DistrictNumber", locKey: "DistrictNumber" },
        { name: "Roads", list: roadsData.features, aliasKey: "STREET_NAME", locKey: "FULL_CIVIC_ADDR" },
        { name: "Addresses", list: addressesData.features, aliasKey: "FULL_ADDRESS", locKey: "MUNICIPALITY" },
        { name: "Parcels", list: parcelsData.features, aliasKey: "ARN", locKey: "LOCATION" },
        { name: "Police Stations", list: policeData.features, aliasKey: "NAME", locKey: "ADDRESS" },
        { name: "Hospitals", list: hospitalData.features, aliasKey: "NAME", locKey: "ADDRESS" },
        { name: "Crime Occurrences", list: crimeData.features, aliasKey: "cr_ucr_tra", locKey: "cr_loc" },
        { name: "Road Safety", list: roadSafetyData.features, aliasKey: "CollisionDetail", locKey: "LocationCode" }
    ];
    
    const foundFeatures = [];
    sources.forEach(source => {
        if (!source.list) return;
        source.list.forEach(f => {
            try {
                if (turf.booleanIntersects(f, buffered)) {
                    const props = f.properties || {};
                    const keys = Object.keys(props);
                    
                    const idValue = keys.length > 0 ? props[keys[0]] : "Unknown";

                    const aliasValue = props[source.aliasKey] 
                        || props.CollisionDetail
                        || props.ACCIDENT_LOCATION
                        || props.NAME 
                        || props.STREET_NAME 
                        || props.FULL_ADDRESS 
                        || props.DistrictNumber
                        || "N/A";

                    const locationValue = props[source.locKey] 
                        || props.LocationCode
                        || props.LOCATIONCODE
                        || props.cr_loc 
                        || props.LOCATION 
                        || props.FULL_CIVIC_ADDR 
                        || props.ADDRESS 
                        || props.MUNICIPALITY 
                        || props.CITY 
                        || "York Region";

                    foundFeatures.push({
                        type: "Feature",
                        geometry: f.geometry,
                        properties: { 
                            "Layer": source.name,
                            "Identifier": idValue,
                            "Name / Details": aliasValue,
                            "Location": locationValue
                        }
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
    if (id === 'districts') return districtData;
    if (id === 'roads') return roadsData;
    if (id === 'addresses') return addressesData;
    if (id === 'parcels') return parcelsData;
    if (id === 'police') return policeData;
    if (id === 'hospitals') return hospitalData;
    if (id === 'crime') return crimeData;
    if (id === 'road_safety') return roadSafetyData;
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
        tbody.innerHTML = '<tr><td colspan="5">No features loaded in view. Please turn on layers and zoom in closer (Zoom level 15+).</td></tr>';
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
            if (feature.geometry.type === 'Point') map.flyTo(temp.getBounds().getCenter(), 18);
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
        opt.innerText = "No fields loaded...";
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
    else if (layerSelect === 'districts') targetLayer = districtLayer;
    else if (layerSelect === 'roads') targetLayer = roadsLayer;
    else if (layerSelect === 'addresses') targetLayer = addressesLayer;
    else if (layerSelect === 'parcels') targetLayer = parcelsLayer;
    else if (layerSelect === 'police') targetLayer = policeLayer;
    else if (layerSelect === 'hospitals') targetLayer = hospitalLayer;
    else if (layerSelect === 'crime') targetLayer = crimeLayer;
    else if (layerSelect === 'road_safety') targetLayer = roadSafetyLayer;

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
    } else if (layerSelect === 'police') {
        targetLayer.addLayer(createPoliceLayer({ type: "FeatureCollection", features: filtered }));
    } else if (layerSelect === 'hospitals') {
        targetLayer.addLayer(createHospitalLayer({ type: "FeatureCollection", features: filtered }));
    } else if (layerSelect === 'road_safety') {
        renderRoadSafetyMarkers({ type: "FeatureCollection", features: filtered });
    } else if (layerSelect === 'districts') {
        targetLayer.addLayer(createDistrictLayer({ type: "FeatureCollection", features: filtered }));
    } else if (layerSelect === 'addresses') {
        const geoJsonData = L.geoJSON({ type: "FeatureCollection", features: filtered }, {
            pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 5, fillColor: "#3388ff", color: "#000", weight: 0.5, opacity: 1, fillOpacity: 0.8 }),
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
    filteredQueryData = null;
    document.getElementById('query-status').innerText = "Reset done.";
    policeLayer.clearLayers(); policeLayer.addLayer(createPoliceLayer(policeData));
    hospitalLayer.clearLayers(); hospitalLayer.addLayer(createHospitalLayer(hospitalData));
    crimeLayer.clearLayers(); crimeLayer.addLayer(createCrimeLayer(crimeData));
    roadSafetyLayer.clearLayers(); renderRoadSafetyMarkers();
    yorkLayer.clearLayers(); yorkLayer.addData(yorkData);
    districtLayer.clearLayers(); districtLayer.addLayer(createDistrictLayer(districtData));
    fetchViewportData();
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
    "YRP Districts": districtLayer,
    "Police Stations": policeLayer,
    "Hospitals": hospitalLayer,
    "Crime Occurrences": crimeLayer,
    "Road Safety (Zoom 13+)": roadSafetyLayer,
    "Roads (Zoomed)": roadsLayer,
    "Addresses (Zoomed)": addressesLayer,
    "Parcels (Zoomed)": parcelsLayer
};

L.control.scale().addTo(map);
L.Control.geocoder({ defaultMarkGeocode: true, collapsed: true, placeholder: 'Search location...' }).addTo(map);
L.control.layers(baseMaps, overlayMaps).addTo(map);

// Navigation Bar Controls
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
        createBtn('fa-solid fa-filter', 'Query Builder', toggleQueryModal);
        createBtn('fa-solid fa-mask', 'Crime Filter', toggleCrimeFilterModal);
        createBtn('fa-solid fa-calendar-days', 'Timeline Filter', toggleTimelineModal);
        createBtn('fa-solid fa-fire', 'Toggle Crime Heatmap', toggleCrimeHeatmap);
        createBtn('fa-solid fa-triangle-exclamation', 'Toggle Traffic Heatmap', toggleTrafficHeatmap);
        createBtn('fa-solid fa-table-list', 'Table', toggleAttributeTable);
        return c;
    }
});
map.addControl(new navControl());

// ===================================================================================================================================================== //
// DYNAMIC LEGEND CONTROL                                                                                                                                //
// ===================================================================================================================================================== //
const legend = L.control({ position: 'bottomleft' });

legend.onAdd = function () {
    legendContainerDiv = L.DomUtil.create('div', 'info legend');
    updateLegend();
    return legendContainerDiv;
};
legend.addTo(map);

function updateLegend() {
    if (!legendContainerDiv) return;

    let itemsHtml = "";

    // 1. York Boundary
    if (map.hasLayer(yorkLayer)) {
        itemsHtml += `
            <div class="legend-row">
                <i class="legend-symbol" style="background: rgba(128, 0, 32, 0.2); border: 2px solid #800020; width:16px; height:16px; display:inline-block;"></i> York Boundary
            </div>`;
    }

    // 2. YRP District Boundaries
    if (map.hasLayer(districtLayer)) {
        itemsHtml += `
            <div class="legend-row">
                <i class="legend-symbol" style="background: rgba(51, 136, 255, 0.2); border: 2px dashed #003399; width:16px; height:16px; display:inline-block;"></i> YRP District
            </div>`;
    }

    // 3. Police Stations (Solid Blue Badge with White Shield SVG)
    if (map.hasLayer(policeLayer)) {
        const policeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ffffff" width="12px" height="12px"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-5.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z"/></svg>`;
        itemsHtml += `
            <div class="legend-row">
                <span class="legend-symbol" style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; background:#002b80; border:1px solid #fff; border-radius:50%; box-shadow:0 1px 3px rgba(0,0,0,0.3);">
                    ${policeSvg}
                </span> Police Stations
            </div>`;
    }

    // 4. Hospitals (Red Circle Badge with White "H")
    if (map.hasLayer(hospitalLayer)) {
        itemsHtml += `
            <div class="legend-row">
                <span class="legend-symbol" style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; background:#d9534f; border:1px solid #fff; border-radius:50%; box-shadow:0 1px 3px rgba(0,0,0,0.3); color:#fff; font-weight:bold; font-size:11px; font-family:sans-serif;">
                    H
                </span> Hospitals
            </div>`;
    }

    // 5. Crime Occurrences
    if (map.hasLayer(crimeLayer)) {
        itemsHtml += `
            <div class="legend-row">
                <i class="legend-symbol" style="background: #d9534f; border-radius: 50%; border: 1px solid #000; width: 12px; height: 12px; display:inline-block;"></i> High-Risk Incident
            </div>
            <div class="legend-row">
                <i class="legend-symbol" style="background: #f0ad4e; border-radius: 50%; border: 1px solid #000; width: 12px; height: 12px; display:inline-block;"></i> Property / Theft Incident
            </div>
            <div class="legend-row">
                <i class="legend-symbol" style="background: #5bc0de; border-radius: 50%; border: 1px solid #000; width: 12px; height: 12px; display:inline-block;"></i> B&E / Mischief
            </div>
            <div class="legend-row">
                <i class="legend-symbol" style="background: #3388ff; border-radius: 50%; border: 1px solid #000; width: 12px; height: 12px; display:inline-block;"></i> Other Incident
            </div>`;
    }

    // 6. Road Safety (Yellow Warning Badge with Triangle SVG)
    if (map.hasLayer(roadSafetyLayer)) {
        const warningSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#d9534f" width="10px" height="10px"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`;
        itemsHtml += `
            <div class="legend-row">
                <span class="legend-symbol" style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; background:#fff3cd; border:1px solid #ffc107; border-radius:50%; box-shadow:0 1px 3px rgba(0,0,0,0.3);">
                    ${warningSvg}
                </span> Road Safety (Zoom 13+)
            </div>`;
    }

    // 7. Roads
    if (map.hasLayer(roadsLayer)) {
        itemsHtml += `
            <div class="legend-row">
                <i class="legend-symbol" style="background: #555; height: 3px; width:16px; display:inline-block;"></i> Roads (Zoom 15+)
            </div>`;
    }

    // 8. Addresses
    if (map.hasLayer(addressesLayer)) {
        itemsHtml += `
            <div class="legend-row">
                <i class="legend-symbol" style="background: #3388ff; border-radius: 50%; border: 1px solid #000; width: 12px; height: 12px; display:inline-block;"></i> Addresses (Zoom 15+)
            </div>`;
    }

    // 9. Parcels
    if (map.hasLayer(parcelsLayer)) {
        itemsHtml += `
            <div class="legend-row">
                <i class="legend-symbol" style="background: rgba(34, 139, 34, 0.2); border: 1px solid #228b22; width:16px; height:16px; display:inline-block;"></i> Parcels (Zoom 15+)
            </div>`;
    }

    if (itemsHtml === "") {
        legendContainerDiv.style.display = "none";
    } else {
        legendContainerDiv.style.display = "block";
        legendContainerDiv.innerHTML = `<h4>Legend</h4>` + itemsHtml;
    }
}
