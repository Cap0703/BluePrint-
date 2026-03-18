let deleteMode = false;

const mapData = {
    rooms: [],
    scanners: []
};

document.addEventListener('DOMContentLoaded', async () => {
    const toggle = document.getElementById("mapMenuToggle");
    const menu   = document.getElementById("mapMenu");
    toggle.addEventListener("click", () => {
        menu.style.display = menu.style.display === "flex" ? "none" : "flex";
    });
    reloadLevel();
    await loadMap();
});

/*---------------------------------------- Layer Controls ----------------------------------------*/

function reloadLevel(){
    const layerEl = document.getElementById('currentMapLayer');
    let z = parseInt(layerEl.dataset.z) || 0;
    layerEl.dataset.z = z;
    layerEl.innerText  = z;
    updateLayerVisibility();
}

function upLayer(){
    const layerEl = document.getElementById('currentMapLayer');
    let z = parseInt(layerEl.dataset.z) || 0;
    layerEl.dataset.z = z + 1;
    reloadLevel();
}

function downLayer(){
    const layerEl = document.getElementById('currentMapLayer');
    let z = parseInt(layerEl.dataset.z) || 0;
    layerEl.dataset.z = z - 1;
    reloadLevel();
}

function getCurrentLayer(){
    return parseInt(document.getElementById('currentMapLayer').dataset.z) || 0;
}

function updateLayerVisibility(){
    const currentLayer = getCurrentLayer();
    document.querySelectorAll(".room").forEach(room => {
        const roomLayer = parseInt(room.dataset.layer);
        if(roomLayer === currentLayer){
            room.style.opacity       = "1";
            room.style.pointerEvents = "auto";
        } else {
            room.style.opacity       = "0.2";
            room.style.pointerEvents = "none";
        }
    });
}

/*---------------------------------------- Delete Mode ----------------------------------------*/

function toggleDeleteMode(){
    deleteMode = !deleteMode;
    const btn = document.getElementById("deleteModeBtn");
    if(deleteMode){
        btn.style.background = "#e74c3c";
        btn.innerText = "Exit Delete Mode";
    } else {
        btn.style.background = "";
        btn.innerText = "Delete Mode";
    }
}

/*---------------------------------------- Rooms ----------------------------------------*/

function createRoom(NAME, z){
    if(!NAME || NAME.trim() === ""){
        alert("Please enter a room name.");
        return;
    }
    const room = {
        id:       "room_" + Date.now(),
        name:     NAME.trim(),
        students: null,
        z:        z,
        x:        120,
        y:        120,
        width:    200,
        height:   150
    };
    mapData.rooms.push(room);
    renderRoom(room);
    document.getElementById('roomName').value = "";
}

function renderRoom(room){
    const map = document.getElementById("mapCanvas");
    const div = document.createElement("div");
    if(!room.students) room.students = "No Students Here 😛";
    div.className      = "room";
    div.dataset.id     = room.id;
    div.dataset.layer  = room.z;
    div.style.left     = room.x      + "px";
    div.style.top      = room.y      + "px";
    div.style.width    = room.width  + "px";
    div.style.height   = room.height + "px";
    div.innerHTML = `
        <div class="room-header">${room.name}</div>
        <div class="room-content" style="padding:5px;display:flex;align-items:center;justify-content:center;height:80%;">
            ${room.students}
        </div>
    `;
    let moved = false;
    div.addEventListener("mousedown", () => { moved = false; });
    div.addEventListener("mousemove", () => { moved = true;  });
    div.addEventListener("click", () => {
        if(deleteMode){
            div.remove();
            mapData.rooms = mapData.rooms.filter(r => r.id !== room.id);
            return;
        }
        if(!moved){
            window.location.href = `/room?room_name=${room.name}`;
        }
    });
    enableRoomDrag(div, room);
    map.appendChild(div);
    updateLayerVisibility();
}

function enableRoomDrag(el, room){
    let offsetX, offsetY, dragging = false;
    el.addEventListener("mousedown", (e) => {
        dragging = true;
        offsetX  = e.offsetX;
        offsetY  = e.offsetY;
        e.stopPropagation();
    });
    document.addEventListener("mousemove", (e) => {
        if(!dragging) return;
        const rect = document.getElementById("mapCanvas").getBoundingClientRect();
        room.x = e.clientX - rect.left - offsetX;
        room.y = e.clientY - rect.top  - offsetY;
        el.style.left = room.x + "px";
        el.style.top  = room.y + "px";
    });
    document.addEventListener("mouseup", () => { dragging = false; });
}

/*---------------------------------------- Scanners ----------------------------------------*/

function renderScanners(){
    const map = document.getElementById("mapCanvas");
    mapData.scanners.forEach(scanner => {
        const dot = document.createElement("div");
        dot.className  = "scanner-dot";
        dot.title      = scanner.scanner_id || scanner.id;
        dot.style.left = (scanner.x || 20) + "px";
        dot.style.top  = (scanner.y || 20) + "px";
        dot.dataset.id = scanner.id;
        enableScannerDrag(dot, scanner);
        map.appendChild(dot);
    });
}

function enableScannerDrag(el, scanner){
    let dragging = false;
    el.addEventListener("mousedown", (e) => {
        dragging = true;
        e.stopPropagation();
    });
    document.addEventListener("mousemove", (e) => {
        if(!dragging) return;
        const rect = document.getElementById("mapCanvas").getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        el.style.left = x + "px";
        el.style.top  = y + "px";
        scanner.x = x;
        scanner.y = y;
        detectRoom(scanner);
    });
    document.addEventListener("mouseup", () => { dragging = false; });
}

function detectRoom(scanner){
    mapData.rooms.forEach(room => {
        if(
            scanner.x > room.x &&
            scanner.x < room.x + room.width &&
            scanner.y > room.y &&
            scanner.y < room.y + room.height
        ){
            scanner.room_id = room.id;
        }
    });
}

/*---------------------------------------- Save / Load ----------------------------------------*/

async function saveMap(){
    const token = localStorage.getItem('auth_token');
    try {
        const res = await fetch("/api/map-layout", {
            method: "POST",
            headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(mapData)
        });
        if(!res.ok) throw new Error(await res.text());
        alert("Map saved");
    } catch(err) {
        console.error("Save failed:", err);
        alert("Failed to save map");
    }
}

async function loadMap(){
    const token = localStorage.getItem('auth_token');
    try {
        const res = await fetch("/api/map-layout", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if(!res.ok) throw new Error(await res.text());
        const data = await res.json();
        mapData.rooms    = data.rooms    || [];
        mapData.scanners = data.scanners || [];
        mapData.rooms.forEach(room => renderRoom(room));
        renderScanners();
    } catch(err) {
        console.error("Failed to load map:", err);
    }
}