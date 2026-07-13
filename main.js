import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBB } from "three/addons/math/OBB.js";

THREE.Cache.enabled = true; // reuse already-loaded textures/models instead of re-fetching them for every part

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x01A2DF);

let velocityY = 0;
const gravity = -0.03;
let isClimbing = false;
const climbSpeed = 0.12;
const CLIMB_STICK = 0.05; // how much overlap to leave on climbable side-contact, so isClimbing doesn't flicker
const climbNormal = new THREE.Vector3(); // direction away from the climbable surface, updated while isClimbing is true
const groundY = 0;
let Siftlock = false
let Health = 100
let MaxHealth = 100
let ItemHeld = false

let Grafic = 1;

let Paused = false;
let Siting = false;

let delta;
let dt;
const terminalVelocity = 3;

let r;
let g;
let b;

let target;

const charForward = new THREE.Vector3(); // reused every collision check instead of allocating
let isFacingWall;
let pushOverlap;
let isVertical;

let hit;

let clock;

let ratio;
let percentage;

let totalDeltaY = velocityY * dt;
const maxStep = 0.05; // smaller than your thinnest platform's height
const MAX_SUBSTEPS = 8; // ceiling on how many collision passes one frame can trigger
let steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.abs(totalDeltaY) / maxStep)));
let stepY = totalDeltaY / steps;

//Made Game Faster code

const lockQuaternion = new THREE.Quaternion();   // reused every frame instead of allocating
const targetQuaternion = new THREE.Quaternion(); // reused every frame instead of allocating
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const heightOffset = 2.5;
let targetRotationY;

let walkAnim;
let idleAnim;

let forwardX;
let forwardZ;
let rightX;
let rightZ;

//menu

const menuButton = document.getElementById('menuButton');
const chatButton = document.getElementById('chatButton');
const emoteButton = document.getElementById('emoteButton');

const centerMenu = document.getElementById('centerMenu');
const resumeButton = document.getElementById('resumeButton');
const resetButton = document.getElementById('resetButton');
const leaveButton = document.getElementById('leaveButton');
const fill = document.getElementById('health-fill');
const GraficsSlider = document.getElementById('volume');

menuButton.addEventListener('click', function (event) {
   Paused = true;
	event.stopPropagation();
	centerMenu.classList.remove('hidden');
});

centerMenu.addEventListener('click', function (event) {
	event.stopPropagation();
});

resumeButton.addEventListener('click', function () {
   Paused = false;
	centerMenu.classList.add('hidden');
});
resetButton.addEventListener('click', function () {
	Health = 0
   Paused = false;
	centerMenu.classList.add('hidden');
});

leaveButton.addEventListener('click', function () {
	console.log('Leave clicked');
});

document.addEventListener('click', function () {
	if (!centerMenu.classList.contains('hidden')) {
      Paused = false;
		centerMenu.classList.add('hidden');
	}
});

// Chat and emote buttons don't open the center menu — wire up their own
// panels/behavior here when you're ready.
chatButton.addEventListener('click', function (event) {
	event.stopPropagation();
	console.log('Chat... does nothing >:3');
});

emoteButton.addEventListener('click', function (event) {
	event.stopPropagation();
	console.log('Emote... does nothing >:3');
});

// yay

let JumpPower = 0.54;
let WalkSpeed = -0.2;
let spawn = new THREE.Vector3();

function SetSpawn(x,y,z) {
   spawn = new THREE.Vector3(x,y,z);
}

const healthBar = document.getElementById("health-bar");
const title = document.getElementById("title");

const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 )
camera.rotation.order = 'YXZ'; // Prevent screen twisting

let theta = 0;          // Horizontal orbit angle
let phi = 0;            // Vertical orbit angle
let distance = 8;          // Strict camera distance from the model
const sensitivity = 0.007; // Look speed adjustment
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

const listener = new THREE.AudioListener();
camera.add(listener);

const activeParts = [];
const sharedTextureLoader = new THREE.TextureLoader(); // reuse instead of "new TextureLoader()" per texture
const textureCache = new Map();   // url+repeat -> THREE.Texture, so identical tiles share one GPU texture
const materialCache = new Map();  // cache key -> THREE.MeshStandardMaterial, so identical-looking parts share one material
const geometryCache = new Map();  // "sx|sy|sz" -> THREE.BoxGeometry, so same-sized parts share one geometry buffer

function getCachedTexture(url, repeatX, repeatZ) {
    const key = `${url}|${repeatX}|${repeatZ}`;
    let tex = textureCache.get(key);
    if (!tex) {
        tex = sharedTextureLoader.load(url);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatZ);
        textureCache.set(key, tex);
    }
    return tex;
}

function getCachedMaterial(key, factory) {
    let mat = materialCache.get(key);
    if (!mat) {
        mat = factory();
        materialCache.set(key, mat);
    }
    return mat;
}

class CreatePart {
    constructor({
        x = 0, y = 0, z = 0,
        sx = 1, sy = 1, sz = 1,
        rx = 0, ry = 0, rz = 0,
        color = "#ffffff",
       
        topTexture = "texture.png",
        bottomTexture = "texture2.png",
       
        killbrick = false,
        CanCollide = false,
        isSpawnLocation = false,
        IsClimbable = false,
        Siting = false
    } = {}) {
        this.killbrick = killbrick;
        this.isSpawnLocation = isSpawnLocation;
        this.CanCollide = CanCollide;
        this.IsClimbable = IsClimbable;

        this.x = x
        this.y = y
        this.z = z
        this.sx = sx
        this.sy = sy
        this.sz = sz
        this.rx = rx
        this.ry = ry
        this.rz = rz

        this.Siting = Siting

        // Keep the raw definition around so maps can be re-serialized later.
        this.def = {
            x, y, z, sx, sy, sz, rx, ry, rz, color,
            topTexture, bottomTexture,
            killbrick, CanCollide, isSpawnLocation, IsClimbable
        };

        const geomKey = `${sx}|${sy}|${sz}`;
        let geometry = geometryCache.get(geomKey);
        if (!geometry) {
            geometry = new THREE.BoxGeometry(sx, sy, sz);
            geometryCache.set(geomKey, geometry);
        }
        const repeatX = sx / 2.5;
        const repeatZ = sz / 2.5;

        let sideMat = getCachedMaterial(`side|${color}`, () => new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSided }));
        let topMat = sideMat;
        let bottomMat = sideMat;

        if (topTexture) {
            const tex = getCachedTexture(topTexture, repeatX, repeatZ);
            const tex2 = getCachedTexture(bottomTexture, repeatX, repeatZ);

            //---Load Mesh With Texture Bro---\\

            topMat = getCachedMaterial(`top|${color}|${topTexture}|${repeatX}|${repeatZ}`, () => new THREE.MeshStandardMaterial({ color, map: tex }));
            bottomMat = getCachedMaterial(`bottom|${color}|${bottomTexture}|${repeatX}|${repeatZ}`, () => new THREE.MeshStandardMaterial({ color, map: tex2 }));
        }

        const materials = [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat];
        this.mesh = new THREE.Mesh(geometry, materials);
        this.mesh.position.set(x, y, z);
        this.mesh.rotation.set(rx, ry, rz); // rotation is now actually applied to the mesh
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        this.localOBB = new OBB(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(sx / 2, sy / 2, sz / 2)
        );
        this.obb = this.localOBB.clone();

        // Bounding-sphere radius (rotation-independent) for a cheap broad-phase distance check,
        // so far-away parts can skip the expensive SAT overlap test entirely.
        this.boundingRadius = Math.sqrt((sx / 2) ** 2 + (sy / 2) ** 2 + (sz / 2) ** 2);

        activeParts.push(this);
    }

    addTo(targetScene) {
        targetScene.add(this.mesh);
    }

    updateHitbox() {
        this.mesh.updateMatrixWorld(true);
        this.obb.copy(this.localOBB);
        this.obb.applyMatrix4(this.mesh.matrixWorld);
    }
}

function getOBBAxes(obb, out) {
    const e = obb.rotation.elements; // column-major: each column is a local axis in world space
    out[0].set(e[0], e[1], e[2]);
    out[1].set(e[3], e[4], e[5]);
    out[2].set(e[6], e[7], e[8]);
    return out;
}

function projectedRadius(obb, axes, axis) {
    return (
        obb.halfSize.x * Math.abs(axis.dot(axes[0])) +
        obb.halfSize.y * Math.abs(axis.dot(axes[1])) +
        obb.halfSize.z * Math.abs(axis.dot(axes[2]))
    );
}

const _axesA = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _axesB = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _testAxes = Array.from({ length: 15 }, () => new THREE.Vector3());
const _centerDelta = new THREE.Vector3();
const _minAxis = new THREE.Vector3();
const _obbHit = { axis: new THREE.Vector3(), overlap: 0 };
const _pushVec = new THREE.Vector3();

function resolveOBBOverlap(a, b) {
    getOBBAxes(a, _axesA);
    getOBBAxes(b, _axesB);

    let axisCount = 0;
    for (let i = 0; i < 3; i++) _testAxes[axisCount++].copy(_axesA[i]);
    for (let i = 0; i < 3; i++) _testAxes[axisCount++].copy(_axesB[i]);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            const cross = _testAxes[axisCount];
            cross.crossVectors(_axesA[i], _axesB[j]);
            if (cross.lengthSq() > 1e-8) {
                cross.normalize();
                axisCount++;
            }
        }
    }

    _centerDelta.copy(a.center).sub(b.center);

    let minOverlap = Infinity;
    let found = false;

    for (let k = 0; k < axisCount; k++) {
        const axis = _testAxes[k];
        const rA = projectedRadius(a, _axesA, axis);
        const rB = projectedRadius(b, _axesB, axis);
        const dist = Math.abs(_centerDelta.dot(axis));
        const overlap = rA + rB - dist;

        if (overlap <= 0) return null; // found a separating axis -> no collision

        if (overlap < minOverlap) {
            minOverlap = overlap;
            found = true;
            _minAxis.copy(axis);
            if (_centerDelta.dot(_minAxis) < 0) _minAxis.negate(); // point from b -> a
        }
    }

    if (!found) return null;
    _obbHit.axis.copy(_minAxis);
    _obbHit.overlap = minOverlap;
    return _obbHit;
}

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 2x on a retina/4K display renders ~1.8x more pixels for barely-visible sharpness gain
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // PCFSoftShadowMap does extra samples per pixel; regular PCF looks close to identical here for a big perf win
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

let modelReady = false;   // flips true once the gltf character has loaded
let pendingSpawn = null;  // a spawn point waiting for the model to be ready
let currentMapData = null;

function clearMap() {
    activeParts.forEach(part => scene.remove(part.mesh));
    activeParts.length = 0;
}

function loadMap(mapData) {
    clearMap();
 
    (mapData.parts || []).forEach(partDef => {
        const part = new CreatePart(partDef);
        part.addTo(scene);
    });
 
    currentMapData = mapData;

    SetSpawn(0,0,0)

    if (mapData.spawn) {
        if (modelReady === true) {
            gltf.scene.position.set(spawn.x, spawn.y, spawn.z);
            velocityY = 0;
        } else {
            pendingSpawn = mapData.spawn;
        }
    }
}

async function loadMapFromURL(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load map "${url}": ${response.status}`);
    const mapData = await response.json();
    loadMap(mapData);
    return mapData;
}

window.loadMap = loadMap;
window.CreatePart = CreatePart; // expose the class itself, not an instance (instantiating here was creating a stray, unused part every load)
window.THREE = THREE;
window.scene = scene;
window.spawn = spawn;
window.Health = Health;

function serializeCurrentMap(name, author) {
    return {
        name: name || (currentMapData && currentMapData.name) || 'Untitled',
        author: author || '',
        background: currentMapData ? currentMapData.background : undefined,
        spawn: (modelReady && gltf.scene)
            ? { x: gltf.scene.position.x, y: gltf.scene.position.y, z: gltf.scene.position.z }
            : (currentMapData && currentMapData.spawn) || { x: 0, y: 0, z: 0.9 },
        parts: activeParts.map(part => part.def)
    };
}

const loader = new GLTFLoader();
const controls = new OrbitControls(camera, renderer.domElement)

const ambientLight = new THREE.AmbientLight( 0x616161 );
scene.add(ambientLight)

const defaultMap = {
    name: "Default",
    spawn: { x: 0, y: 0, z: 0.9 },
    parts: [
        { x: 0, y: -0.5, z: 0, sx: 60, sy: 1, sz: 60, color: "#5cb85c" },
        { x: 10, y: 2, z: -10, sx: 10, sy: 4, sz: 10, color: "#6e6e6e" },
        { x: 0, y: 0.5, z: 0, sx: 1, sy: 1, sz: 1, Siting: true, color: "#304173" }
    ]
};

window.defaultMap = defaultMap;
window.loadMapFromURL = loadMapFromURL;
window.clearMap = clearMap;
loadMap(defaultMap);


//const floor = new CreatePart({ x: 0, y: -0.5, z: 0, sx: 60, sy: 1, sz: 60, color: "#5cb85c" });
//floor.addTo(scene);

//const wall = new CreatePart({
   //x: 10, 
   //y: 2, 
   //z: -10, 
   //sx: 10, 
   //sy: 4, 
   //sz: 10, 
   //color: "#6e6e6e"
//});
//wall.addTo(scene);

//const cube2 = new CreatePart({ x: 0, y: 0.5, z: 0, sx: 1, sy: 1, sz: 1, color: "#304173" });
//cube2.addTo(scene);

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x1a1a1a, 0.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(30, 40, 20);
sun.castShadow = true;
sun.shadow.normalBias = 0.02;
//sun.shadow.mapSize.set(1024, 1024); // 2048 is 4x the pixel cost of 1024 for a scene this size
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110;
sun.shadow.camera.bottom = -110;
sun.shadow.camera.far = 150;
sun.shadow.bias = 0.0001; // tighter frustum can introduce shadow acne; this offsets it
scene.add(sun);

let mixer = null;
let animationsMap = {};
let currentAction = null;
let currentState = "";
let lockedAnimation = false;
let isGrounded = true;

let faceTexture = sharedTextureLoader.load("faces/default.png");
faceTexture.colorSpace = THREE.SRGBColorSpace;
faceTexture.flipY = false;

let TShirt = sharedTextureLoader.load("t-shirts/Hoodie.png");
TShirt.colorSpace = THREE.SRGBColorSpace;
TShirt.flipY = false;

const gltf = await loader.loadAsync( 'models/model.gltf' );
gltf.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.receiveShadow = true;
    obj.castShadow = true;

    if (obj.name === "Head_1") {
        obj.material = new THREE.MeshStandardMaterial({ color: "#b3b3b3", flatShading: false });
    }
    if (obj.name === "Torso_1") {
        obj.material = new THREE.MeshStandardMaterial({ color: "#9c253b" });
    }
    if (obj.name === "Arm1") {
        obj.material = new THREE.MeshStandardMaterial({ color: "#b3b3b3" });
    }
    if (obj.name === "Right2") {
        obj.material = new THREE.MeshStandardMaterial({ color: "#b3b3b3" });
        let RightArmPos = obj.position
    }
    if (obj.name === "Leg1" || obj.name === "Leg2") {
        obj.material = new THREE.MeshStandardMaterial({ color: "#241616" });
    }
    if (["Face", "Face_1", "Face1"].includes(obj.name)) {
        obj.material = new THREE.MeshStandardMaterial({ map: faceTexture, transparent: true });
        obj.receiveShadow = true;
        obj.castShadow = false;
    }
    if (obj.name === "T-shirt") {
        obj.material = new THREE.MeshStandardMaterial({ map: TShirt, transparent: true });
        obj.receiveShadow = true;
        obj.castShadow = false;
    }
});

//---Sounds---\\\

const globalSound = new THREE.Audio(listener);

const audioLoader = new THREE.AudioLoader();
audioLoader.load('sound/jump.mp3', function(buffer) {
    globalSound.setBuffer(buffer);
    globalSound.setLoop(false);
    globalSound.setVolume(0.5);
});

if (gltf.animations && gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(gltf.scene);

    mixer.addEventListener('finished', (e) => {
        if (e.action === animationsMap['point']) {
            lockedAnimation = false;
            currentState = "";
            fadeToAnimation('Idle');
        }
     });

    gltf.animations.forEach((clip) => {
        animationsMap[clip.name.toLowerCase()] = mixer.clipAction(clip);
    });

    if (animationsMap['idle']) {
        currentAction = animationsMap['idle'];
        currentAction.play();
    }
}

//---Thingy---\\\

gltf.scene.rotation.y = Math.PI;
gltf.scene.position.z = 0.9;
scene.add( gltf.scene );

//=========HitBoxs=========\\\
const hitboxHeight = 3;
const hitboxGeo = new THREE.BoxGeometry(1.3, hitboxHeight, 0.6);

let hitboxMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, visible: false });
const playerHitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
hitboxGeo.translate(0, hitboxHeight / 2, 0); 
scene.add(playerHitboxMesh);

const playerLocalOBB = new OBB(
    new THREE.Vector3(0, hitboxHeight / 2, 0),
    new THREE.Vector3(0.65, hitboxHeight / 2, 0.3)
);
const playerOBB = playerLocalOBB.clone();
const playerBoundingRadius = Math.sqrt(0.65 * 0.65 + (hitboxHeight / 2) * (hitboxHeight / 2) + 0.3 * 0.3);

function syncPlayerHitbox() {
    playerHitboxMesh.position.copy(gltf.scene.position);
    playerHitboxMesh.quaternion.copy(gltf.scene.quaternion); // hitbox now turns with the character
    playerHitboxMesh.updateMatrixWorld(true);

    playerOBB.copy(playerLocalOBB);
    playerOBB.applyMatrix4(playerHitboxMesh.matrixWorld);
}

function GraficsUpdate() {
   if (GraficsSlider.value === "1") {
       sun.shadow.mapSize.width = 2048;
       sun.shadow.mapSize.height = 2048;
       console.log("a")
   }

   if (GraficsSlider.value === "2") {
       sun.shadow.mapSize.width = 3072;
       sun.shadow.mapSize.height = 3072;
   }

   if (GraficsSlider.value === "3") {
       sun.shadow.mapSize.width = 4096;
       sun.shadow.mapSize.height = 4096;
   }

   if (GraficsSlider.value === "4") {
       sun.shadow.mapSize.width = 5120;
       sun.shadow.mapSize.height = 5120;
   }

   if (GraficsSlider.value === "4") {
       sun.shadow.mapSize.width = 6144;
       sun.shadow.mapSize.height = 6144;
   }

   if (GraficsSlider.value === "5") {
       sun.shadow.mapSize.width = 7168;
       sun.shadow.mapSize.height = 7168;
   }
   sun.shadow.map.dispose();
   sun.shadow.map = null;
   renderer.shadowMap.needsUpdate = true;
}

GraficsSlider.addEventListener('input', function() {
    GraficsUpdate()
});
function checkPartCollisions() {
    syncPlayerHitbox();

    isGrounded = false;
    isClimbing = false;

    const px = playerOBB.center.x, py = playerOBB.center.y, pz = playerOBB.center.z;

    for (let i = 0; i < activeParts.length; i++) {
        const part = activeParts[i];

        // Broad-phase: skip the expensive matrix update + 15-axis SAT test for parts
        // that couldn't possibly be touching the player, based on a cheap distance check.
        const dx = part.x - px;
        const dy = part.y - py;
        const dz = part.z - pz;
        const reach = part.boundingRadius + playerBoundingRadius;
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;

        part.updateHitbox();

        hit = resolveOBBOverlap(playerOBB, part.obb);
        if (!hit) continue;

        if (part.killbrick) {
            Health = 0;
            continue;
        }

        if (part.isSpawnLocation) {
            SetSpawn(part.x, part.y + part.sy, part.z);
        }

        if (part.Siting) {
            velocityY = 0
            Siting = true
            fadeToAnimation("Sit")
            gltf.scene.position.x = part.x
            gltf.scene.position.z = part.z
            gltf.scene.rotation.y = part.rx
            console.log(gltf.scene.rotation.y)
        }

        isVertical = Math.abs(hit.axis.y) > 0.5;

        pushOverlap = hit.overlap;

        charForward.set(0, 0, -1).applyQuaternion(gltf.scene.quaternion).normalize();
        isFacingWall = charForward.dot(hit.axis) < -0.97;
        
        if (part.IsClimbable && !isVertical && isFacingWall ) {
            isClimbing = true;
            climbNormal.copy(hit.axis);
            pushOverlap = Math.max(0, hit.overlap - CLIMB_STICK);
        }

        if (part.CanCollide) continue;

        _pushVec.copy(hit.axis).multiplyScalar(pushOverlap);
        gltf.scene.position.add(_pushVec);
        syncPlayerHitbox();

        if (isVertical) {
            velocityY = 0;
            if (hit.axis.y > 0) {
                isGrounded = true; // pushed upward -> standing on top of the part
            }
            // pushed downward -> bonked a ceiling from below
        }
    }
}

function CheckHealth() {
    if (Health <= 0) {
       WalkSpeed = 0;
       setTimeout(() => {
           gltf.scene.position.y = spawn.y;
           gltf.scene.position.x = spawn.x;
           gltf.scene.position.z = spawn.z;
           velocityY = 0
           gltf.scene.rotation.y = 3.14;
           gltf.scene.rotation.x = 0;
           gltf.scene.rotation.z = 0;
           ItemHeld = false
           Health = 100;
           WalkSpeed = -0.18;
       }, 200);
    }
}


//---------Mouse and Keyborad=========\\\
window.addEventListener('mousedown', (event) => {
    if (event.button === 2 || event.button === 0) { 
        isDragging = true;
        previousMousePosition = { x: event.clientX, y: event.clientY };
    }
});

window.addEventListener('mousemove', (event) => {
    if (!isDragging) return; 

    const deltaX = event.clientX - previousMousePosition.x;
    const deltaY = event.clientY - previousMousePosition.y;

    theta -= deltaX * sensitivity;
    phi += deltaY * sensitivity; 

    const maxVerticalAngle = Math.PI / 2 - 0.05; 
    phi = Math.max(-maxVerticalAngle, Math.min(maxVerticalAngle, phi));

    previousMousePosition = { x: event.clientX, y: event.clientY };
});

window.addEventListener('mouseup', (event) => {
    if (event.button === 2 || event.button === 0) isDragging = false;
});

window.addEventListener('wheel', (event) => {
    distance += event.deltaY * 0.05;
    distance = Math.max(3, Math.min(260, distance));
});

window.addEventListener('contextmenu', (e) => e.preventDefault());

const keys = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };
window.addEventListener('keydown', (e) => { if (e.code in keys) keys[e.code] = true; });
window.addEventListener('keyup', (e) => { if (e.code in keys) keys[e.code] = false; });

document.addEventListener("keydown", (event) => {
    if (event.key === 'p') {
        fadeToAnimation('Point');
    }
    if (event.key === 'y') {
        TShirt = sharedTextureLoader.load("faces/default.png");
        TShirt.flipY = false;
        gltf.scene.traverse((obj) => {
            if (obj.isMesh && obj.name === "T-shirt") {
                obj.material.map = TShirt;
                obj.material.needsUpdate = true;
            }
        });
    }
});

document.addEventListener('keydown', (event) => {
  if (event.code === "Space") {
    Siting = false
    if (isClimbing) {
      isClimbing = false;
      velocityY = JumpPower;
      gltf.scene.position.addScaledVector(climbNormal, 0.4);
      syncPlayerHitbox();
      globalSound.play();
    } else if (velocityY === 0) {
      velocityY = JumpPower; 
      globalSound.play();
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.code === "KeyT") {
     Health -= 10
     console.log(Health)
  }
});

document.addEventListener('keydown', (event) => {
  if (event.code === "KeyU") {
     if (ItemHeld === true) {
         ItemHeld = false
     } else {
         ItemHeld = true
     }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.code === "Escape") {
     centerMenu.classList.remove('hidden');
     Paused = true;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.code === "Period") {
     centerMenu.classList.remove('hidden');
     Paused = true;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.shiftKey) {
     if (Siftlock === true) {
         Siftlock = false
     } else {
         Siftlock = true
     }
   console.log(Siftlock)
  }
});

function Respawn() {
   Health = 0;
}

window.Respawn = Respawn
window.SetSpawn = SetSpawn

//---Animation---\\\

function fadeToAnimation(nextAnimationName) {
    const nextAction = animationsMap[nextAnimationName.toLowerCase()];
    if (!nextAction || currentAction === nextAction || lockedAnimation) return;

    nextAction.reset();
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);

    if (nextAnimationName === "Point") {
        nextAction.setLoop(THREE.LoopOnce, 1);
        nextAction.clampWhenFinished = true;
        lockedAnimation = true;
    } else {
        nextAction.setLoop(THREE.LoopRepeat);
    }

    if (currentAction) currentAction.crossFadeTo(nextAction, 0.2, true);

    nextAction.play();
    currentAction = nextAction;
}

window.addEventListener('resize', () => {
   camera.aspect = window.innerWidth / window.innerHeight;
   camera.updateProjectionMatrix();
   renderer.setSize(window.innerWidth, window.innerHeight);
});

window.gltf = gltf;
window.ItemHeld = ItemHeld;
window.fadeToAnimation = fadeToAnimation

clock = new THREE.Clock();
const moveDirection = new THREE.Vector3();

camera.position.set(0, 3.5, 12);

console.log("Loaded clips:", gltf.animations.map(a => a.name));

window.isClimbing = isClimbing

function animate() {
    requestAnimationFrame(animate);

    delta = clock.getDelta(); // grab it once, at the top
    dt = delta * 60;

    if (playerHitboxMesh.position.y <= -90) {
       Health = 0
    }

    if (Health >= MaxHealth) {
       Health = MaxHealth
    }
    ratio = Health / MaxHealth
    percentage = ratio * 100
    fill.style.width = percentage + "%";

    r = Math.floor((1.5 - ratio) * 255); -3
    g = Math.floor(ratio * 255); -3
    b = 25;

    fill.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;

    CheckHealth()

    if (gltf && gltf.scene) {
        if (isClimbing === false) {
            velocityY += gravity * dt;
        } else if (isClimbing === true && Paused === false)  {
            velocityY = 0;
            if (keys.KeyW) {
                gltf.scene.position.y += climbSpeed * dt;
            } else if (keys.KeyS) {
                gltf.scene.position.y -= climbSpeed * dt;
            }
        }

        velocityY = Math.max(-terminalVelocity, Math.min(terminalVelocity, velocityY));

        totalDeltaY = velocityY * dt;
        steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.abs(totalDeltaY) / maxStep)));
        stepY = totalDeltaY / steps;

        for (let i = 0; i < steps; i++) {
             gltf.scene.position.y += stepY;
             checkPartCollisions();
             if (velocityY === 0) break;
        }

        // Ground floor constraint fallback
        //if (gltf.scene.position.y <= groundY) {
            //gltf.scene.position.y = groundY;
            //velocityY = 0;
        //}

        moveDirection.set(0, 0, 0);

        forwardX = Math.sin(theta);
        forwardZ = Math.cos(theta);
        rightX = Math.cos(theta);
        rightZ = -Math.sin(theta);

        if (keys.KeyW && Paused === false && Siting === false) { moveDirection.x += forwardX; moveDirection.z += forwardZ; }
        if (keys.KeyS && Paused === false && Siting === false) { moveDirection.x -= forwardX; moveDirection.z -= forwardZ; }
        if (keys.KeyA && Paused === false && Siting === false) { moveDirection.x += rightX;   moveDirection.z += rightZ; }
        if (keys.KeyD && Paused === false && Siting === false) { moveDirection.x -= rightX;   moveDirection.z -= rightZ; }

        if (Siftlock && Siting === false) {
            lockQuaternion.setFromAxisAngle(UP_AXIS, theta);
            gltf.scene.quaternion.slerp(lockQuaternion, 0.15);
        }

        if (moveDirection.lengthSq() > 0.0001 && !Siftlock && !isClimbing) {
             targetRotationY = Math.atan2(moveDirection.x, moveDirection.z);
             targetQuaternion.setFromAxisAngle(UP_AXIS, targetRotationY);
             gltf.scene.quaternion.slerp(targetQuaternion, 0.15);
        }

        if (moveDirection.lengthSq() > 0.0001) {
            moveDirection.normalize();
            if (!isClimbing) {
                gltf.scene.position.addScaledVector(moveDirection, WalkSpeed + 0.0001);
            }
        }


        if (!isGrounded) {
            if (currentState !== "jump") {
                fadeToAnimation('Jump');
                currentState = "jump";
            }
        } else if (moveDirection.lengthSq() > 0.0001) {
            walkAnim = ItemHeld ? 'itemheld-walk' : "walk";
            if (currentState !== walkAnim) {
                fadeToAnimation(ItemHeld ? 'IdleHeld-Walk' : 'Walk');
                currentState = walkAnim;
            }
        } else {
            idleAnim = ItemHeld ? 'itemheld-idle' : "idle";
            if (currentState !== idleAnim) {
                fadeToAnimation(ItemHeld ? 'ItemHeld-Idle' : 'Idle');
                currentState = idleAnim;
            }
        }

        if (isClimbing) {
            if (currentState !== "climb") {
                fadeToAnimation("Climb");
                currentState = "climb";
            }
        }

        checkPartCollisions();

        target = playerHitboxMesh.position;
        camera.position.x = target.x + distance * Math.sin(theta) * Math.cos(phi);
        camera.position.z = target.z + distance * Math.cos(theta) * Math.cos(phi);
        //sun.position.set(playerHitboxMesh.position.x + 30, playerHitboxMesh.position.y + 40, playerHitboxMesh.position.z + 20);

        if (Siting === false) {
           camera.position.y = target.y + heightOffset + distance * Math.sin(phi);
        }

        if (Siting === true) {
           camera.position.y = target.y + heightOffset + distance * Math.sin(phi);
        }
        camera.lookAt(target.x, target.y + heightOffset, target.z);

        Grafic = document.getElementById('volume').value
    }

    if (mixer) {
        mixer.update(delta);
    }

    renderer.render(scene, camera);
}

animate();