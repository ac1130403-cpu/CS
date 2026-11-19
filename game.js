import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

const canvas = document.querySelector("#viewport");
const startScreen = document.querySelector("#start-screen");
const endScreen = document.querySelector("#end-screen");
const hud = document.querySelector("#hud");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020711);
scene.fog = new THREE.FogExp2(0x07101d, 0.018);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 180);
camera.position.set(0, 1.65, 31);
scene.add(camera);

const clock = new THREE.Clock();
const keys = {};
const colliders = [];
const enemies = [];
const raycaster = new THREE.Raycaster();
const gunFlash = new THREE.PointLight(0x63eaff, 0, 8);
camera.add(gunFlash);

let yaw = 0;
let pitch = 0;
let health = 100;
let ammo = 12;
let reserve = 48;
let kills = 0;
let playing = false;
let reloading = false;
let lastShot = 0;

function material(color, emissive = 0x000000, emissiveIntensity = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.72, emissive, emissiveIntensity });
}

function box(name, size, position, color, emissive = 0x000000, emissiveIntensity = 0, collider = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, emissive, emissiveIntensity));
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (collider) colliders.push({ mesh, min: new THREE.Vector3(position[0] - size[0] / 2, position[1] - size[1] / 2, position[2] - size[2] / 2), max: new THREE.Vector3(position[0] + size[0] / 2, position[1] + size[1] / 2, position[2] + size[2] / 2) });
  return mesh;
}

function cylinder(size, position, color, emissive = 0x000000, emissiveIntensity = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(...size, 16), material(color, emissive, emissiveIntensity));
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function buildWorld() {
  scene.add(new THREE.HemisphereLight(0x9cbbff, 0x080510, 0.62));
  const coreLight = new THREE.PointLight(0x994dff, 34, 38);
  coreLight.position.set(0, 5, -29);
  scene.add(coreLight);

  box("floor", [44, 0.25, 74], [0, -0.15, 0], 0x111827);
  box("ceiling", [44, 0.25, 74], [0, 8, 0], 0x090d16);

  box("north-wall", [44, 8, 1], [0, 4, -38], 0x182236);
  box("south-wall", [44, 8, 1], [0, 4, 38], 0x182236);
  box("west-wall", [1, 8, 76], [-22, 4, 0], 0x182236);
  box("east-wall", [1, 8, 76], [22, 4, 0], 0x182236);

  [-30, -10, 10, 30].forEach((z) => {
    [-16, 16].forEach((x) => box("pillar", [1.2, 7.8, 1.2], [x, 3.9, z], 0x26344a));
  });

  // Central display
  box("central-cover", [8, 2.2, 5], [0, 1.1, 4], 0x1a2234);
  box("central-top", [8.4, 0.18, 5.4], [0, 2.28, 4], 0x9a59ff, 0x7b32ff, 2);

  // West rack lane
  [-17, -11, 5, 11].forEach((z) => {
    box("rack", [5.8, 3.8, 1.2], [-14.8, 1.9, z], 0x263b4d);
    box("rack-light", [4.8, 0.08, 0.12], [-14.8, 3.2, z + 0.62], 0x49dfff, 0x49dfff, 3, false);
  });

  // East control room
  box("control-divider", [10, 5, 0.6], [16.8, 2.5, 11], 0x1b2739);
  box("control-window", [5.5, 2.2, 0.12], [14.2, 3.3, 10.66], 0x35d5ff, 0x35d5ff, 1.4, false);
  box("control-desk", [6, 1.1, 2], [16.7, 0.55, 16], 0x26344a);

  // Core chamber
  box("core-base", [10, 0.5, 10], [0, 0.25, -31], 0x151d2c);
  cylinder([3.2, 3.2, 5.8, 24], [0, 3, -31], 0x202a40, 0x3ccfff, 0.7);
  const core = cylinder([1.5, 1.5, 7.2, 24], [0, 3.5, -31], 0x5636a1, 0x994dff, 3);
  core.rotation.z = Math.PI / 2;

  // Neon lines
  [-18, 18].forEach((x) => {
    box("neon-wall", [0.08, 0.08, 54], [x, 5.8, 1], 0x65e8ff, 0x65e8ff, 4, false);
  });
  [-24, -14, 14, 24].forEach((z) => {
    box("floor-neon", [12, 0.04, 0.12], [z < 0 ? -8 : 8, 0.02, z], 0xb66eff, 0xb66eff, 4, false);
  });

  // Hanging signs
  box("entry-sign", [7, 1.2, 0.2], [0, 6.2, 34.5], 0x18253a, 0x39cff8, 2, false);
  box("core-sign", [8, 1.1, 0.2], [0, 6.2, -34], 0x18253a, 0xa86fff, 2, false);
}

function createEnemy(x, z) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.72, 1.05),
    material(0x313e59, 0x6c35e6, 1)
  );
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);

  const topCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.18, 12),
    material(0x9daee0, 0x993cff, 3)
  );
  topCore.position.y = 1.58;
  topCore.rotation.z = Math.PI / 2;
  group.add(topCore);

  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 8),
    material(0xb9efff, 0x66efff, 5)
  );
  eye.position.set(0, 1.08, 0.56);
  group.add(eye);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.055, 8, 24),
    material(0x66efff, 0x66efff, 3)
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.58;
  group.add(ring);

  const treadParts = [];
  [-0.82, 0.82].forEach((x) => {
    const tread = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.5, 1.16),
      material(0x171d2b, 0x242d48, 0.2)
    );
    tread.position.set(x, 0.38, 0);
    tread.castShadow = true;
    group.add(tread);
    treadParts.push(tread);

    [-0.34, 0.34].forEach((z) => {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12),
        material(0x59677d, 0x3bdfff, 1)
      );
      wheel.position.set(x + (x > 0 ? 0.21 : -0.21), 0.38, z);
      wheel.rotation.z = Math.PI / 2;
      group.add(wheel);
      treadParts.push(wheel);
    });
  });

  [-0.48, 0.48].forEach((x) => {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.58),
      material(0x65738d, 0x48dbff, 0.8)
    );
    arm.position.set(x, 1.02, 0.72);
    arm.rotation.x = -0.35;
    group.add(arm);
  });

  group.position.set(x, 0, z);
  scene.add(group);

  enemies.push({
    group,
    body,
    ring,
    eye,
    topCore,
    treadParts,
    health: 60,
    alive: true,
    speed: 1.45 + Math.random() * 0.35,
    hitFlash: 0,
    walkTime: Math.random() * Math.PI * 2
  });
}

function buildEnemies() {
  [[-7, 22], [13, 18], [-15, 1], [12, -11], [0, -24]].forEach(([x, z]) => createEnemy(x, z));
}

buildWorld();
buildEnemies();

function collides(position) {
  const radius = 0.42;
  for (const collider of colliders) {
    if (position.x + radius > collider.min.x && position.x - radius < collider.max.x &&
        position.z + radius > collider.min.z && position.z - radius < collider.max.z &&
        position.y + 1.7 > collider.min.y && position.y - 0.2 < collider.max.y) return true;
  }
  return false;
}

function updateCameraRotation() {
  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

document.addEventListener("mousemove", (event) => {
  if (!playing || document.pointerLockElement !== canvas) return;
  yaw -= event.movementX * 0.0022;
  pitch -= event.movementY * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch, -1.45, 1.45);
  updateCameraRotation();
});

document.addEventListener("keydown", (event) => {
  keys[event.code] = true;
  if (event.code === "KeyR") reload();
});
document.addEventListener("keyup", (event) => { keys[event.code] = false; });

canvas.addEventListener("click", () => {
  if (playing) canvas.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  if (playing && document.pointerLockElement !== canvas) showMessage("點擊畫面繼續");
});

document.querySelector("#start-button").addEventListener("click", startGame);
document.querySelector("#restart-button").addEventListener("click", resetGame);

function startGame() {
  startScreen.classList.add("hidden");
  endScreen.classList.add("hidden");
  hud.classList.remove("hidden");
  playing = true;
  canvas.requestPointerLock();
  updateHud();
}

function resetGame() {
  health = 100;
  ammo = 12;
  reserve = 48;
  kills = 0;
  reloading = false;
  camera.position.set(0, 1.65, 31);
  yaw = 0;
  pitch = 0;
  updateCameraRotation();
  enemies.forEach((enemy, index) => {
    enemy.health = 60;
    enemy.alive = true;
    enemy.group.visible = true;
    const positions = [[-7, 22], [13, 18], [-15, 1], [12, -11], [0, -24]];
    enemy.group.position.set(positions[index][0], 0, positions[index][1]);
  });
  startGame();
}

function updateHud() {
  document.querySelector("#health").textContent = Math.max(0, Math.ceil(health));
  document.querySelector("#health-bar").style.width = `${Math.max(0, health)}%`;
  document.querySelector("#ammo").textContent = ammo;
  document.querySelector("#reserve").textContent = reserve;
  document.querySelector("#score").textContent = `${kills} / ${enemies.length}`;
}

function showMessage(text, duration = 1800) {
  const message = document.querySelector("#message");
  message.textContent = text;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { message.textContent = ""; }, duration);
}

function reload() {
  if (!playing || reloading || ammo === 12 || reserve === 0) return;
  reloading = true;
  showMessage("裝填中...", 900);
  setTimeout(() => {
    const needed = 12 - ammo;
    const taken = Math.min(needed, reserve);
    ammo += taken;
    reserve -= taken;
    reloading = false;
    updateHud();
  }, 900);
}

canvas.addEventListener("mousedown", (event) => {
  if (!playing || event.button !== 0 || document.pointerLockElement !== canvas) return;
  const now = performance.now();
  if (now - lastShot < 180 || reloading) return;
  lastShot = now;
  if (ammo <= 0) {
    showMessage("彈藥不足");
    reload();
    return;
  }
  ammo--;
  gunFlash.intensity = 5;
  updateHud();
  shoot();
  setTimeout(() => { gunFlash.intensity = 0; }, 45);
});

function shoot() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const targets = [];
  enemies.forEach((enemy) => {
    if (enemy.alive) enemy.group.traverse((object) => {
      if (object.isMesh) {
        object.userData.enemy = enemy;
        targets.push(object);
      }
    });
  });

  const hit = raycaster.intersectObjects(targets, false)[0];
  if (hit) {
    const enemy = hit.object.userData.enemy;
    enemy.health -= 25;
    enemy.hitFlash = 0.12;
    enemy.body.material.emissive.setHex(0xff2c77);
    createSpark(hit.point);
    if (enemy.health <= 0) {
      enemy.alive = false;
      enemy.group.visible = false;
      kills++;
      showMessage("目標已清除");
      updateHud();
      if (kills === enemies.length) endGame(true);
    }
  } else {
    const point = raycaster.ray.origin.clone().add(raycaster.ray.direction.multiplyScalar(25));
    createSpark(point);
  }
}

function createSpark(position) {
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0x75efff })
  );
  spark.position.copy(position);
  scene.add(spark);
  setTimeout(() => scene.remove(spark), 90);
}

function endGame(won) {
  playing = false;
  if (document.pointerLockElement) document.exitPointerLock();
  endScreen.classList.remove("hidden");
  hud.classList.add("hidden");
  document.querySelector("#end-title").textContent = won ? "任務完成" : "連線中斷";
  document.querySelector("#end-eyebrow").textContent = won ? "CORE SECURED" : "SYSTEM FAILURE";
  document.querySelector("#end-detail").textContent = won
    ? `已清除全部機械守衛，分數 ${kills * 1000}`
    : `已擊敗守衛 ${kills} 台`;
}

function updateEnemies(delta) {
  enemies.forEach((enemy) => {
    if (!enemy.alive) return;
    const toPlayer = new THREE.Vector3(
      camera.position.x - enemy.group.position.x,
      0,
      camera.position.z - enemy.group.position.z
    );
    const distance = toPlayer.length();
    if (distance > 2.4) {
      toPlayer.normalize();
      const next = enemy.group.position.clone().addScaledVector(toPlayer, enemy.speed * delta);
      if (!collides(new THREE.Vector3(next.x, 0, next.z))) enemy.group.position.copy(next);
      enemy.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
    } else {
      enemy.hitFlash = enemy.hitFlash || 0;
      enemy.lastAttack = enemy.lastAttack || 0;
      enemy.lastAttack += delta;
      if (enemy.lastAttack > 1) {
        enemy.lastAttack = 0;
        health -= 8;
        updateHud();
        if (health <= 0) endGame(false);
      }
    }
    enemy.ring.rotation.z += delta * 2;
    enemy.walkTime += delta * (distance > 2.4 ? 7 : 2);
    enemy.body.position.y = 1.05 + Math.sin(enemy.walkTime) * 0.035;
    enemy.topCore.position.y = 1.58 + Math.sin(enemy.walkTime) * 0.035;
    enemy.eye.position.y = 1.08 + Math.sin(enemy.walkTime) * 0.035;
    enemy.ring.position.y = 1.58 + Math.sin(enemy.walkTime) * 0.035;
    enemy.treadParts.forEach((part, index) => {
      if (index > 1) part.rotation.x += delta * 4;
    });
    if (enemy.hitFlash > 0) {
      enemy.hitFlash -= delta;
      if (enemy.hitFlash <= 0) enemy.body.material.emissive.setHex(0x6c35e6);
    }
  });
}

function updateMovement(delta) {
  if (!playing || document.pointerLockElement !== canvas) return;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const direction = new THREE.Vector3();

  if (keys.KeyW) direction.add(forward);
  if (keys.KeyS) direction.sub(forward);
  if (keys.KeyD) direction.add(right);
  if (keys.KeyA) direction.sub(right);
  if (direction.lengthSq() > 0) {
    direction.normalize();
    const speed = 6.2 * delta;
    const nextX = camera.position.clone();
    nextX.x += direction.x * speed;
    if (!collides(nextX)) camera.position.x = nextX.x;
    const nextZ = camera.position.clone();
    nextZ.z += direction.z * speed;
    if (!collides(nextZ)) camera.position.z = nextZ.z;
  }
  camera.position.y = 1.65;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  updateMovement(delta);
  updateEnemies(delta);
  gunFlash.intensity = THREE.MathUtils.lerp(gunFlash.intensity, 0, delta * 18);
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

updateCameraRotation();
animate();
