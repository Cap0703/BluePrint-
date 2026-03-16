const mapCanvas = document.getElementById("mapcanvas");

const mapData = {
    rooms: [],
    scanners: []
};

function addScanner(roomId){
    const scanner = {
        id: "scanner" + Date.now(),
        roomId: roomId,
        x: 40,
        y: 40
    };
    mapData.scanners.push(scanner);
    renderScanner(scanner);
}

function renderScanner(scanner){
    const room = document.querySelector(`[data-room-id="${scanner.roomId}"]`);
    const dot = document.createElement("div");
    dot.className = "scanner";
    dot.style.left = scanner.x + "px";
    dot.style.top = scanner.y + "px";
    dot.title = scanner.id;
    room.appendChild(dot);
}

function createRoom(NAME, z){
    console.log("Creating room with name:", NAME, "and z-index:", z);
    const room = {
        id: "room_" + Date.now(),
        name: NAME,
        students: null,
        z: z,
        x: 100,
        y: 100,
        width: 200,
        height: 150
    };
    mapData.rooms.push(room);
    renderRoom(room);
}

function renderRoom(room){
    const map = document.getElementById("mapCanvas");
    const div = document.createElement("div");
    if(!room.students) room.students = "No Students Here😛";
    div.className = "room";
    div.dataset.id = room.id;
    div.style.left = room.x + "px";
    div.style.top = room.y + "px";
    div.style.width = room.width + "px";
    div.style.height = room.height + "px";
    div.innerHTML = `
        <div class="room-header">${room.name}</div>
        <div class="room-content" style="padding: 5px; align-items: center; display: flex; justify-content: center; height: 80%;">
            ${room.students}
        </div>
    `;
    // CHATGPT STARTED HERE
    let moved = false;
    div.addEventListener("mousedown",()=>{
        moved = false;
    });
    div.addEventListener("mousemove",()=>{
        moved = true;
    });
    div.addEventListener("click",()=>{
        if(!moved){
            alert("Touch Me Again 🙈");
        }
    });
    // CHATGPT ENDED HERE
    enableRoomDrag(div, room);
    map.appendChild(div);
}

function enableRoomDrag(el, room){
    let offsetX, offsetY, dragging=false;
    el.addEventListener("mousedown",(e)=>{
        dragging=true;
        offsetX = e.offsetX;
        offsetY = e.offsetY;
    });
    document.addEventListener("mousemove",(e)=>{
        if(!dragging) return;
        const canvas = document.getElementById("mapCanvas");
        const rect = canvas.getBoundingClientRect();
        room.x = e.clientX - rect.left - offsetX;
        room.y = e.clientY - rect.top - offsetY;
        el.style.left = room.x + "px";
        el.style.top = room.y + "px";
    });
    document.addEventListener("mouseup",()=> dragging=false);
}

//mapData.scanners = scanners;
renderScanners();

function renderScanners(){
    const map = document.getElementById("mapCanvas");
    mapData.scanners.forEach(scanner=>{
        const dot = document.createElement("div");
        dot.className="scanner-dot";
        dot.title=scanner.scanner_id;
        dot.style.left="20px";
        dot.style.top="20px";
        dot.dataset.id=scanner.id;
        enableScannerDrag(dot,scanner);
        map.appendChild(dot);
    });
}

function enableScannerDrag(el, scanner){
    let dragging=false;
    el.addEventListener("mousedown",()=> dragging=true);
    document.addEventListener("mousemove",(e)=>{
        if(!dragging) return;
        const canvas=document.getElementById("mapCanvas");
        const rect=canvas.getBoundingClientRect();
        const x=e.clientX-rect.left;
        const y=e.clientY-rect.top;
        el.style.left=x+"px";
        el.style.top=y+"px";
        scanner.x=x;
        scanner.y=y;
        detectRoom(scanner);
    });
    document.addEventListener("mouseup",()=> dragging=false);
}

function detectRoom(scanner){
    mapData.rooms.forEach(room=>{
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

async function saveMap(){
    const token = localStorage.getItem('auth_token');
    await fetch("/api/map-layout",{
        method:"POST",
        headers:{
            "Content-Type":"application/json",
            "Authorization":`Bearer ${token}`
        },
        body:JSON.stringify(mapData)
    });
    alert("Map saved");
}

function upLayer(){
    const currentLayer = document.getElementById("currentMapLayer");
    let z = parseInt(currentLayer.style.zIndex) || 0;
    currentLayer.style.zIndex = z + 1;
    //console.log("Layer moved up, current z-index:", currentLayer.style.zIndex);
}

function downLayer(){
    const currentLayer = document.getElementById("currentMapLayer");
    let z = parseInt(currentLayer.style.zIndex) || 0;
    currentLayer.style.zIndex = z - 1;
    //console.log("Layer moved down, current z-index:", currentLayer.style.zIndex);
}
