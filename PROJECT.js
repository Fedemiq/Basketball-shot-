import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import GUI from 'lil-gui';

const clock = new THREE.Clock(); 

/* ----- Variabili Globali e Stato ----- */
let scene, camera, renderer, controls; 
let playerMixer, playerAction; 
let ballMesh, playerMesh, courtMesh, billboardMesh; 

// Variabili per l'illuminazione dinamica
let sunLight, hemiLight;
let stadiumLights = [];
let dayTime = 12; // Si parte da mezzogiorno (0 - 24)
const DAY_DURATION = 120; // 120 secondi reali = 24 ore nel gioco

// Macchina a stati per le diverse fasi del gioco
const STATE_IDLE = 0; 
const STATE_ANIMATING = 1; 
const STATE_FLYING = 2; 
const STATE_FINISHED = 3; 
const STATE_BOUNCING = 4;
let gameState = STATE_IDLE; 

let shotOutcome = 1;  
let flightProgress = 0;  
let startPos = new THREE.Vector3(); 
let targetPos = new THREE.Vector3(); 

const settings = {
    ballSpeed: 1.0, 
    flickeringLight: false,
};

const sounds = {}; 

const raycaster = new THREE.Raycaster(); 
const mouse = new THREE.Vector2(); 

// Vettori ottenuti tramite misurazione blender
const PLAYER_HAND_POS = new THREE.Vector3(0.5, 2.2, 0); 
const HOOP_POS = new THREE.Vector3(-10.8, 3.5, 0); 
const RIM_POS = new THREE.Vector3(-10.2, 3.5, 0); 

const MISS_POSITIONS = [
    new THREE.Vector3(-16, 0, -9),
    new THREE.Vector3(-17, 1, 3),
    new THREE.Vector3(-5, 0, 1)
];

/* ----- Inizializzazione ----- */
init(); 
animate(); 

function init() {
    const canvasContainer = document.body; 
    renderer = new THREE.WebGLRenderer({ antialias: true }); 
    renderer.setSize(window.innerWidth, window.innerHeight); 
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    canvasContainer.appendChild(renderer.domElement); 

    scene = new THREE.Scene(); 
    scene.background = new THREE.Color(0x87CEEB); 

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100); 
    camera.position.set(0, 2, 6); 

    // Definizione del movimento della camera con limiti
    controls = new OrbitControls(camera, renderer.domElement); 
    controls.enableDamping = true; 
    controls.maxPolarAngle = Math.PI / 2; 
    controls.minDistance = 2.0; 
    controls.maxDistance = 35.0; 
    
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
    };

    const audioListener = new THREE.AudioListener(); 
    camera.add(audioListener); 
    loadAudio(audioListener, 'score', './assets/audio/suono1.mp3'); 
    loadAudio(audioListener, 'rim', './assets/audio/suono2.mp3'); 
    loadAudio(audioListener, 'miss', './assets/audio/suono3.mp3'); 

    // Luce emisferica per riflettere il cielo sul terreno
    hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemiLight);

    // Sole direzionale
    sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    sunLight.position.set(0, 50, 0);
    scene.add(sunLight);

    // Inizializzazione lampioni del campetto
    createStadiumLight(6.1, 3, 8.5); 
    createStadiumLight(-6.1, 3, 8.5); 
    createStadiumLight(6.1, 3, -8.5); 
    createStadiumLight(-6.1, 3, -8.5); 

    setupGUI(); 
    loadAssets(); 

    window.addEventListener('resize', onWindowResize); 
    window.addEventListener('mousedown', onMouseClick); 
    window.addEventListener('touchstart', onTouchStart, { passive: false }); 
    window.addEventListener('keydown', onKeyDown); 
    
    const btnReset = document.getElementById('reset-btn');
    btnReset.addEventListener('click', resetGame);
    btnReset.addEventListener('touchstart', (e) => {
        e.preventDefault(); 
        resetGame();
    }, { passive: false });
}

function createStadiumLight(x, y, z) {
    const light = new THREE.PointLight(0xfff0dd, 0.0, 50); // Partono con intensità 0 
    light.position.set(x, y, z); 
    scene.add(light); 
    stadiumLights.push(light); // Salvati nell'array per essere controllati
}

function loadAudio(listener, name, url) {
    const sound = new THREE.Audio(listener); 
    const audioLoader = new THREE.AudioLoader(); 
    audioLoader.load(url, (buffer) => { 
        sound.setBuffer(buffer); 
        sound.setVolume(0.5); 
        sounds[name] = sound; 
    }); 
}

function setupGUI() {
    const gui = new GUI({ title: 'Pannello di Controllo' }); 
    gui.add(settings, 'ballSpeed', 0.5, 2.0, 0.1).name('Velocità palla'); 
    gui.add(settings, 'flickeringLight').name('Sfarfallio lampione');
}

function loadAssets() {
    const textureLoader = new THREE.TextureLoader(); 
    const gltfLoader = new GLTFLoader(); 
    const objLoader = new OBJLoader(); 
    const mtlLoader = new MTLLoader(); 

    mtlLoader.setPath('./assets/models/'); 
    mtlLoader.load('palla.mtl', (materials) => { 
        materials.preload(); 
        
        objLoader.setMaterials(materials); 
        objLoader.setPath('./assets/models/'); 
        objLoader.load('palla.obj', (obj) => { 
            ballMesh = obj.children[0]; 
            ballMesh.visible = false; 
            scene.add(ballMesh); 
        });
    }); 

    gltfLoader.load('./assets/models/giocatore.gltf', (gltf) => { 
        playerMesh = gltf.scene; 
        scene.add(playerMesh); 

        if (gltf.animations && gltf.animations.length > 0) { 
            playerMixer = new THREE.AnimationMixer(playerMesh); 
            playerAction = playerMixer.clipAction(gltf.animations[0]); 
            playerAction.setLoop(THREE.LoopOnce, 1); 
            playerAction.clampWhenFinished = true;  
        } 
    }); 

    const photoTexture = textureLoader.load('./assets/mia_foto.jpg'); 
    const boardGeo = new THREE.PlaneGeometry(1, 1); 
    const boardMat = new THREE.MeshBasicMaterial({ map: photoTexture, side: THREE.DoubleSide }); 
    billboardMesh = new THREE.Mesh(boardGeo, boardMat); 
    billboardMesh.position.set(2.5, 1.5, -10.4); 
    scene.add(billboardMesh); 

    gltfLoader.load('./assets/models/campo.gltf', (gltf) => { 
        courtMesh = gltf.scene; 
        scene.add(courtMesh); 
    }); 
}

/* ----- Interazione ----- */

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight; 
    camera.updateProjectionMatrix(); 
    renderer.setSize(window.innerWidth, window.innerHeight); 
}

function onMouseClick(event) {
    if (event.target.id === 'reset-btn' || event.target.closest('.lil-gui')) return;
    if (gameState !== STATE_IDLE) return; 

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1; 
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1; 
    
    raycaster.setFromCamera(mouse, camera); 

    if (playerMesh) { 
        const intersects = raycaster.intersectObject(playerMesh, true); 
        if (intersects.length > 0) { 
            startShotSequence(); 
        } 
    } 
}

function onTouchStart(event) {
    if (event.target.id === 'reset-btn' || event.target.closest('.lil-gui')) return;
    if (gameState !== STATE_IDLE) return; 

    if (event.touches.length > 0) {
        mouse.x = (event.touches[0].clientX / window.innerWidth) * 2 - 1; 
        mouse.y = -(event.touches[0].clientY / window.innerHeight) * 2 + 1; 
        
        raycaster.setFromCamera(mouse, camera); 

        if (playerMesh) { 
            const intersects = raycaster.intersectObject(playerMesh, true); 
            if (intersects.length > 0) { 
                startShotSequence(); 
            } 
        }
    }
}

function onKeyDown(event) {
    if (event.code === 'Space' && gameState === STATE_IDLE) { 
        startShotSequence(); 
    } 
    if (event.key === 'r' || event.key === 'R') {
        resetGame();
    }
}

/* ----- Logica di Gioco ----- */

function startShotSequence() {
    gameState = STATE_ANIMATING; 
    document.getElementById('result-ui').style.display = 'none'; 
    document.getElementById('reset-btn').style.display = 'none'; 

    //generazione randomica dell'esito di tiro
    shotOutcome = Math.floor(Math.random() * 3) + 1; 

    if (shotOutcome === 1) {
        targetPos.copy(HOOP_POS); 
    } else if (shotOutcome === 2) {
        targetPos.copy(RIM_POS); 
    } else {
        const randomIndex = Math.floor(Math.random() * MISS_POSITIONS.length);
        targetPos.copy(MISS_POSITIONS[randomIndex]); 
    }

    if (playerAction) { 
        playerAction.reset(); 
        playerAction.play(); 
    } 

    setTimeout(() => { 
        if (gameState === STATE_ANIMATING) { 
            releaseBall(); 
        } 
    }, 1000);  
}

function releaseBall() {
    gameState = STATE_FLYING; 
    flightProgress = 0; 
    
    ballMesh.position.copy(PLAYER_HAND_POS); 
    startPos.copy(PLAYER_HAND_POS); 
    ballMesh.visible = true; 
}

function triggerOutcome() {
    const ui = document.getElementById('result-ui'); 
    const text = document.getElementById('result-text'); 
    ui.style.display = 'block'; 
    
    document.getElementById('reset-btn').style.display = 'block'; 

    if (shotOutcome === 1) { 
        text.innerText = "CANESTRO!"; 
        text.style.color = "#00ff00"; 
        if(sounds.score) sounds.score.play(); 
    } else if (shotOutcome === 2) { 
        text.innerText = "FERRO!"; 
        text.style.color = "#ffaa00"; 
        if(sounds.rim) sounds.rim.play(); 
    } else { 
        text.innerText = "FUORI!"; 
        text.style.color = "#ff0000"; 
        if(sounds.miss) sounds.miss.play(); 
    } 
}

function endShot() {
    gameState = STATE_FINISHED; 
    if (ballMesh) ballMesh.visible = false; 
}

function resetGame() {
    gameState = STATE_IDLE; 
    document.getElementById('result-ui').style.display = 'none'; 
    document.getElementById('reset-btn').style.display = 'none'; 
    
    if (ballMesh) ballMesh.visible = false; 
    
    if (playerAction) { 
        playerAction.stop();  
    } 
}

/* ----- Ciclo Giorno / Notte ----- */

function updateDayNightCycle(time) {
    // time: da 0.0 a 24.0 (Alba, Giorno, Tramonto, Crepuscolo, Notte)
    // Angolo orbita del "sole": alle 6 deve essere 0°
    const angle = ((time - 6) / 24) * Math.PI * 2; 
    
    // Orbita sole/luna
    sunLight.position.x = -Math.cos(angle) * 50; 
    sunLight.position.y = Math.abs(Math.sin(angle)) * 50 + 10; // Luce con y sempre positiva
    sunLight.position.z = Math.sin(angle) * 20;

    let mix = 0;
    let bgColor = new THREE.Color();
    let sColor = new THREE.Color();

    // Definizione di 6 colori (3 per Background e 3 per luce solare/lunare) che verranno poi mixati
    const colorNight = new THREE.Color(0x323261);
    const colorDawn = new THREE.Color(0xff9271);
    const colorDay = new THREE.Color(0x6caede);
    
    const sunColorNight = new THREE.Color(0x93c8fa);
    const sunColorDawn = new THREE.Color(0xff77a4);
    const sunColorDay = new THREE.Color(0xffffff);

    // Interpolazione di colori e intensità
    if (time >= 5 && time < 8) { // Alba (5 - 8)
        mix = (time - 5) / 3;
        bgColor.lerpColors(colorNight, colorDawn, mix);
        sColor.lerpColors(sunColorNight, sunColorDawn, mix);

        sunLight.intensity = 0.2 + (mix * 0.8);
        hemiLight.intensity = 0.1 + (mix * 0.5);
    } else if (time >= 8 && time < 16) { // Giorno (8 - 16)
        mix = (time - 8) / 8;
        if (mix < 0.3) {
            bgColor.lerpColors(colorDawn, colorDay, mix / 0.3);
            sColor.lerpColors(sunColorDawn, sunColorDay, mix / 0.3);
        } else { // dalle 10 in poi il colore è fisso
            bgColor.copy(colorDay);
            sColor.copy(sunColorDay);
        }

        sunLight.intensity = 1.0;
        hemiLight.intensity = 0.6;
    } else if (time >= 16 && time < 19) { // Tramonto (16 - 19)
        mix = (time - 16) / 3;
        bgColor.lerpColors(colorDay, colorDawn, mix);
        sColor.lerpColors(sunColorDay, sunColorDawn, mix);

        sunLight.intensity = 1.0 - (mix * 0.5);
        hemiLight.intensity = 0.6 - (mix * 0.3);
    } else if (time >= 19 && time < 21) { // Crepuscolo (19 - 21)
        mix = (time - 19) / 2;
        bgColor.lerpColors(colorDawn, colorNight, mix);
        sColor.lerpColors(sunColorDawn, sunColorNight, mix);

        sunLight.intensity = 0.5 - (mix * 0.4);
        hemiLight.intensity = 0.3 - (mix * 0.25);
    } else { // Notte (21 - 5)
        bgColor.copy(colorNight);
        sColor.copy(sunColorNight);

        sunLight.intensity = 0.2;
        hemiLight.intensity = 0.1;
    }

    scene.background = bgColor;
    sunLight.color = sColor;

    // Gestione Lampioni dello stadio (Accesi da sera a mattina presto)
    let lampIntensity = 0;
    if (time >= 19.5 || time <= 5.5) { 
        lampIntensity = 20.0; // Costante una volta accesi
    } else if (time > 18.5 && time < 19.5) {
        lampIntensity = (time - 18.5) * 20.0; // Si accendono gradualmente al tramonto (funzione crescente con lo scorrere del tempo)
    } else if (time > 5.5 && time < 6.5) {
        lampIntensity = (1 - (time - 5.5)) * 20.0; // Si spengono gradualmente all'alba (funzione decrescente con lo scorrere del tempo)
    }

    const delta = clock.getDelta(); 
    for (let i = 0; i < stadiumLights.length; i++) {
        if (i === 2 && delta % 5 === 0 && settings.flickeringLight && (time > 20 || time < 5)){
            stadiumLights[i].intensity = 3; //simula sfarfallio lampione n.2 
        } else {
            stadiumLights[i].intensity = lampIntensity;
        }
    }

}

function animate() {
    requestAnimationFrame(animate); 

    const delta = clock.getDelta(); 

    // Aggiornamento Giorno/Notte
    dayTime += (delta / DAY_DURATION) * 24;
    if (dayTime >= 24) dayTime -= 24; // Reset dell tempo ogni 24 ore
    updateDayNightCycle(dayTime);

    if (playerMixer) playerMixer.update(delta); 

    if (gameState === STATE_FLYING && ballMesh) { 
        flightProgress += delta * settings.ballSpeed; 

        if (flightProgress >= 1.0) { 
            flightProgress = 1.0; 
            triggerOutcome(); 

            if (shotOutcome === 2) {
                gameState = STATE_BOUNCING;
                flightProgress = 0;
                startPos.copy(ballMesh.position);
                targetPos.set(-10.2, 0, 1.0); 
            } else {
                endShot(); 
            }
        } else {
            ballMesh.position.lerpVectors(startPos, targetPos, flightProgress); 
            const arcHeight = 4.0; 
            ballMesh.position.y += Math.sin(flightProgress * Math.PI) * arcHeight; 

            // Aggiunta rotazione palla in aria
            ballMesh.rotation.x += 10 * delta; 
            ballMesh.rotation.z += 5 * delta; 
        }
    } else if (gameState === STATE_BOUNCING && ballMesh) {
        flightProgress += delta * (settings.ballSpeed * 1.5); 

        if (flightProgress >= 1.0) {
            endShot(); 
        } else {
            ballMesh.position.lerpVectors(startPos, targetPos, flightProgress); 
            const bounceHeight = 2.0; 
            ballMesh.position.y += Math.sin(flightProgress * Math.PI) * bounceHeight; 
            
            ballMesh.rotation.x += 10 * delta; 
            ballMesh.rotation.z += 5 * delta;
        }
    }

    controls.update(); 
    renderer.render(scene, camera); 
}