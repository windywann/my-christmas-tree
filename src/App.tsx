import { useState, useMemo, useRef, useEffect, Suspense, useCallback } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";
import { UploadPage, type UploadedImage } from './components/UploadPage';

const MAX_UPLOAD_PHOTOS = 31;
const MAX_IMAGE_DIMENSION = 2000; // 防止超大图导致 GPU/内存崩溃
type PhotoMode = 'photos' | 'empty';
const STORAGE_KEY = 'grand-tree-last-session';
const BGM_URL = 'https://cdn.pixabay.com/download/audio/2022/12/14/audio_1e3fb4a3c5.mp3?filename=christmas-jingle-bells-ambient-12651.mp3';

function cycleToLength<T>(arr: T[], length: number) {
  if (arr.length === 0) return [];
  return Array.from({ length }, (_, i) => arr[i % arr.length]);
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const dataUrlToFile = async (dataUrl: string, filename: string, mime = 'image/jpeg') => {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: mime });
};

// --- 视觉配置 ---
const CONFIG = {
  colors: {
    emerald: '#004225', // 纯正祖母绿
    gold: '#FFD700',
    silver: '#ECEFF1',
    red: '#D32F2F',
    green: '#2E7D32',
    white: '#FFFFFF',   // 纯白色
    warmLight: '#FFD54F',
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'], // 彩灯
    // 拍立得边框颜色池 (复古柔和色系)
    borders: ['#FFFAF0', '#F0E68C', '#E6E6FA', '#FFB6C1', '#98FB98', '#87CEFA', '#FFDAB9'],
    // 圣诞元素颜色
    giftColors: ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'],
    candyColors: ['#FF0000', '#FFFFFF']
  },
  counts: {
    foliage: 15000,
    ornaments: 300,   // 拍立得照片数量
    elements: 200,    // 圣诞元素数量
    lights: 400       // 彩灯数量
  },
  tree: { height: 22, radius: 9 }, // 树体尺寸
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.emerald), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h/2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i*3] = spherePoints[i*3]; positions[i*3+1] = spherePoints[i*3+1]; positions[i*3+2] = spherePoints[i*3+2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i*3] = tx; targetPositions[i*3+1] = ty; targetPositions[i*3+2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- Component: Photo Ornaments (Double-Sided Polaroid) ---
const PhotoOrnaments = ({ state, photoUrls, onPhotoClick }: { state: 'CHAOS' | 'FORMED', photoUrls: string[], onPhotoClick: (url: string) => void }) => {
  const textures = useTexture(photoUrls);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*70, (Math.random()-0.5)*70, (Math.random()-0.5)*70);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 2.2 : 0.8 + Math.random() * 0.6;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColor = CONFIG.colors.borders[Math.floor(Math.random() * CONFIG.colors.borders.length)];

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 1.0,
        y: (Math.random() - 0.5) * 1.0,
        z: (Math.random() - 0.5) * 1.0
      };
      const chaosRotation = new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);

      const textureIndex = i % (Array.isArray(textures) ? textures.length : 1);
      const textureUrl = photoUrls[textureIndex];

      return {
        chaosPos, targetPos, scale: baseScale, weight,
        textureIndex,
        textureUrl,
        borderColor,
        currentPos: chaosPos.clone(),
        chaosRotation,
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5
      };
    });
  }, [textures, photoUrls, count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;

      objData.currentPos.lerp(target, delta * (isFormed ? 0.8 * objData.weight : 0.5));
      group.position.copy(objData.currentPos);

      if (isFormed) {
         const targetLookPos = new THREE.Vector3(group.position.x * 2, group.position.y + 0.5, group.position.z * 2);
         group.lookAt(targetLookPos);

         const wobbleX = Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.05;
         const wobbleZ = Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) * 0.05;
         group.rotation.x += wobbleX;
         group.rotation.z += wobbleZ;

      } else {
         group.rotation.x += delta * objData.rotationSpeed.x;
         group.rotation.y += delta * objData.rotationSpeed.y;
         group.rotation.z += delta * objData.rotationSpeed.z;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group 
          key={i} 
          scale={[obj.scale, obj.scale, obj.scale]} 
          rotation={state === 'CHAOS' ? obj.chaosRotation : [0,0,0]}
          onClick={(e) => {
            e.stopPropagation();
            onPhotoClick(obj.textureUrl);
          }}
          onPointerOver={() => { document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { document.body.style.cursor = 'auto' }}
        >
          {/* 正面 */}
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={(Array.isArray(textures) ? textures[obj.textureIndex] : textures)}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={(Array.isArray(textures) ? textures[obj.textureIndex] : textures)} emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
          {/* 背面 */}
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={(Array.isArray(textures) ? textures[obj.textureIndex] : textures)}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={(Array.isArray(textures) ? textures[obj.textureIndex] : textures)} emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

// --- Component: Christmas Elements ---
const ChristmasElements = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);
  const caneGeometry = useMemo(() => new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;

      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const type = Math.floor(Math.random() * 3);
      let color; let scale = 1;
      if (type === 0) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.8 + Math.random() * 0.4; }
      else if (type === 1) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.6 + Math.random() * 0.4; }
      else { color = Math.random() > 0.5 ? CONFIG.colors.red : CONFIG.colors.white; scale = 0.7 + Math.random() * 0.3; }

      const rotationSpeed = { x: (Math.random()-0.5)*2.0, y: (Math.random()-0.5)*2.0, z: (Math.random()-0.5)*2.0 };
      return { type, chaosPos, targetPos, color, scale, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI), rotationSpeed };
    });
  }, [boxGeometry, sphereGeometry, caneGeometry]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x; mesh.rotation.y += delta * objData.rotationSpeed.y; mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        let geometry; if (obj.type === 0) geometry = boxGeometry; else if (obj.type === 1) geometry = sphereGeometry; else geometry = caneGeometry;
        return ( <mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={obj.color} roughness={0.3} metalness={0.4} emissive={obj.color} emissiveIntensity={0.2} />
        </mesh> )})}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2); const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.3; const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      const speed = 2 + Math.random() * 3;
      return { chaosPos, targetPos, color, speed, currentPos: chaosPos.clone(), timeOffset: Math.random() * 100 };
    });
  }, []);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      const intensity = (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      if (mesh.material) { (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isFormed ? 3 + intensity * 4 : 0; }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => ( <mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
          <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} />
        </mesh> ))}
    </group>
  );
};

// --- Component: Top Star (No Photo, Pure Gold 3D Star) ---
const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const groupRef = useRef<THREE.Group>(null);

  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3; const innerRadius = 0.7; const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? shape.moveTo(radius*Math.cos(angle), radius*Math.sin(angle)) : shape.lineTo(radius*Math.cos(angle), radius*Math.sin(angle));
    }
    shape.closePath();
    return shape;
  }, []);

  const starGeometry = useMemo(() => {
    return new THREE.ExtrudeGeometry(starShape, {
      depth: 0.4, // 增加一点厚度
      bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3,
    });
  }, [starShape]);

  // 纯金材质
  const goldMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: CONFIG.colors.gold,
    emissive: CONFIG.colors.gold,
    emissiveIntensity: 1.5, // 适中亮度，既发光又有质感
    roughness: 0.1,
    metalness: 1.0,
  }), []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
      const targetScale = state === 'FORMED' ? 1 : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3);
    }
  });

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.8, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry} material={goldMaterial} />
      </Float>
    </group>
  );
};

// --- Main Scene Experience ---
const Experience = ({ sceneState, rotationSpeed, photoUrls, photoMode, zoom, tilt, hasHand, onPhotoClick }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number, photoUrls: string[], photoMode: PhotoMode, zoom: number, tilt: number, hasHand: boolean, onPhotoClick: (url: string) => void }) => {
  const controlsRef = useRef<any>(null);
  
  useFrame((_, delta) => {
    if (controlsRef.current) {
      if (hasHand) {
        // 1. 处理旋转
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
        
        // 2. 处理俯仰角 (上下移动手控制)
        const targetPolar = MathUtils.lerp(Math.PI / 4, Math.PI / 1.8, tilt);
        const currentPolar = controlsRef.current.getPolarAngle();
        const newPolar = MathUtils.damp(currentPolar, targetPolar, 2, delta);
        controlsRef.current.setPolarAngle(newPolar);

        // 3. 处理缩放 (前后移动手控制)
        const targetDist = MathUtils.lerp(30, 120, zoom);
        const currentDist = controlsRef.current.getDistance();
        const newDist = MathUtils.damp(currentDist, targetDist, 2, delta);
        
        controlsRef.current.minDistance = newDist - 0.1;
        controlsRef.current.maxDistance = newDist + 0.1;
      }
      
      controlsRef.current.update();
      
      if (!hasHand) {
        controlsRef.current.minDistance = 30;
        controlsRef.current.maxDistance = 120;
      }
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={30} maxDistance={120} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED'} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={['#000300']} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />

      <ambientLight intensity={0.4} color="#003311" />
      <pointLight position={[30, 30, 30]} intensity={100} color={CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />

      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
           {photoMode === 'photos' && photoUrls.length > 0 ? <PhotoOrnaments state={sceneState} photoUrls={photoUrls} onPhotoClick={onPhotoClick} /> : null}
           <ChristmasElements state={sceneState} />
           <FairyLights state={sceneState} />
           <TopStar state={sceneState} />
        </Suspense>
        <Sparkles count={600} scale={50} size={8} speed={0.4} opacity={0.4} color={CONFIG.colors.silver} />
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.5} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CameraOnIcon = ({ color = '#FFD700' }: { color?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="7" width="13" height="10" rx="2" ry="2" />
    <polygon points="16 8 21 5 21 19 16 16" />
    <circle cx="9" cy="12" r="2.2" fill={color} stroke="none" />
  </svg>
);

const CameraOffIcon = ({ color = '#FF6666' }: { color?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="7" width="10" height="8" rx="2" ry="2" />
    <line x1="1.5" y1="1.5" x2="22.5" y2="22.5" />
    <polygon points="15 9 21 5 21 14" />
  </svg>
);

const GestureController = ({ onGesture, onMove, onZoom, onTilt, onHandPresence, onStatus, debugMode, cameraEnabled, overlayVisible, overlayPos, onToggleOverlay, onDragOverlay }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; origX: number; origY: number }>({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;
    let stream: MediaStream | null = null;

    const setup = async () => {
      onStatus("DOWNLOADING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        onStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            onStatus("AI READY: SHOW HAND");
            predictWebcam();
          }
        } else {
            onStatus("ERROR: CAMERA PERMISSION DENIED");
        }
      } catch (err: any) {
        onStatus(`ERROR: ${err.message || 'MODEL FAILED'}`);
      }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
            const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
            const ctx = canvasRef.current.getContext("2d");
            if (ctx && debugMode) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
                if (results.landmarks) for (const landmarks of results.landmarks) {
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
                        drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
                }
            } else if (ctx && !debugMode) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

            if (results.gestures.length > 0 && results.landmarks.length > 0) {
              onHandPresence(true);
              const name = results.gestures[0][0].categoryName; const score = results.gestures[0][0].score;
              if (score > 0.4) {
                 if (name === "Open_Palm") onGesture("CHAOS"); if (name === "Closed_Fist") onGesture("FORMED");
                 if (debugMode) onStatus(`DETECTED: ${name}`);
              }
              
              const hand = results.landmarks[0];
              // 旋转控制 (x轴上下移动)
              const speed = (0.5 - hand[0].x) * 0.15;
                onMove(Math.abs(speed) > 0.01 ? speed : 0);

              // 俯仰角控制 (y轴上下移动)
              // 映射 hand[0].y (0-1) 到 tilt 值
              const tiltVal = MathUtils.clamp(hand[0].y, 0, 1);
              onTilt(tiltVal);

              // 缩放控制 (利用手掌大小作为距离估算)
              // 计算 0 (wrist) 到 9 (middle finger mcp) 的 2D 距离
              const dx = hand[0].x - hand[9].x;
              const dy = hand[0].y - hand[9].y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              
              // 映射距离到 0-1 的缩放值
              const zoomVal = MathUtils.clamp(MathUtils.mapLinear(distance, 0.1, 0.35, 1, 0), 0, 1);
              onZoom(zoomVal);
            } else { 
              onHandPresence(false);
              onMove(0); 
              if (debugMode) onStatus("AI READY: NO HAND"); 
            }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    if (!cameraEnabled) {
      onStatus("CAMERA OFF");
      if (videoRef.current && videoRef.current.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
      onHandPresence(false);
      return;
    }

    setup();
    return () => {
      cancelAnimationFrame(requestRef);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [onGesture, onMove, onZoom, onTilt, onHandPresence, onStatus, debugMode, cameraEnabled]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      onDragOverlay(dragRef.current.origX + dx, dragRef.current.origY + dy);
    };
    const handleUp = () => { dragRef.current.dragging = false; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [onDragOverlay]);

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, origX: overlayPos.x, origY: overlayPos.y };
  };

  return (
    <>
      {overlayVisible ? (
        <div
          style={{
            position: 'absolute',
            top: overlayPos.y,
            left: overlayPos.x,
            width: 340,
            height: 220,
            zIndex: 12,
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '12px',
            backdropFilter: 'blur(10px)',
            overflow: 'hidden',
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)'
          }}
        >
          <div
            style={{
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 10px',
              cursor: 'move',
              color: 'rgba(255,255,255,0.8)',
              fontSize: 12,
              letterSpacing: 1,
              borderBottom: '1px solid rgba(255,255,255,0.08)'
            }}
            onMouseDown={startDrag}
          >
            <span>摄像头画面</span>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleOverlay(); }}
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(0,0,0,0.3)',
                color: 'rgba(255,255,255,0.8)',
                cursor: 'pointer',
                fontSize: 12,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="收起画面"
            >
              –
            </button>
          </div>
          <div style={{ position: 'relative', width: '100%', height: 'calc(100% - 32px)' }}>
            <video
              ref={videoRef}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: cameraEnabled ? 0.9 : 0.3, transform: 'scaleX(-1)' }}
              playsInline
              muted
              autoPlay
            />
            <canvas
              ref={canvasRef}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'scaleX(-1)' }}
            />
          </div>
        </div>
      ) : (
        <div
          style={{
            position: 'absolute',
            top: overlayPos.y,
            left: overlayPos.x,
            zIndex: 12,
            width: 220,
            height: 40,
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '12px',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 10px',
            color: 'rgba(255,255,255,0.85)',
            boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
            cursor: 'move'
          }}
          onMouseDown={startDrag}
        >
          <span style={{ fontSize: 12, letterSpacing: 1 }}>摄像头画面</span>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleOverlay(); }}
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(0,0,0,0.3)',
              color: 'rgba(255,255,255,0.8)',
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="展开画面"
          >
            ▾
          </button>
        </div>
      )}
    </>
  );
};

// --- Component: Photo Viewer Modal ---
const PhotoViewer = ({ url, onClose }: { url: string | null, onClose: () => void }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);

  useEffect(() => {
    if (url) {
      setActiveUrl(url);
      setIsVisible(true);
    } else {
      setIsVisible(false);
      // 等待动画结束再清空 url，避免闪烁
      const timer = setTimeout(() => setActiveUrl(null), 400);
      return () => clearTimeout(timer);
    }
  }, [url]);

  if (!activeUrl && !isVisible) return null;

  return (
    <div 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        zIndex: 1000, 
        backgroundColor: 'rgba(0,0,0,0.92)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        backdropFilter: 'blur(15px)',
        cursor: 'zoom-out',
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? 'auto' : 'none',
        transition: 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onClick={onClose}
    >
      <div 
        style={{ 
          position: 'relative', 
          maxWidth: '85vw', 
          maxHeight: '85vh',
          boxShadow: '0 20px 80px rgba(0, 0, 0, 0.8), 0 0 40px rgba(255, 215, 0, 0.1)',
          borderRadius: '16px',
          overflow: 'hidden',
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)',
          transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
          background: '#111'
        }}
      >
        <img 
          src={activeUrl || ''} 
          alt="Large View" 
          style={{ 
            display: 'block', 
            maxWidth: '100%', 
            maxHeight: '85vh', 
            objectFit: 'contain' 
          }} 
        />
        <button 
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            position: 'absolute',
            top: '24px',
            right: '24px',
            width: '44px',
            height: '44px',
            borderRadius: '22px',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(0,0,0,0.4)',
            color: '#fff',
            fontSize: '28px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.2s ease',
            lineHeight: 1
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.4)'}
        >
          ×
        </button>
      </div>
    </div>
  );
};

// --- App Entry ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [zoom, setZoom] = useState(0.5); // 0 为最近, 1 为最远
  const [tilt, setTilt] = useState(0.5); // 0 为仰视, 1 为俯视
  const [hasHand, setHasHand] = useState(false);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);
  const [page, setPage] = useState<'UPLOAD' | 'TREE'>('UPLOAD');
  const [uploaded, setUploaded] = useState<UploadedImage[]>([]);
  const uploadedRef = useRef<UploadedImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [photoMode, setPhotoMode] = useState<PhotoMode>('photos'); // empty 用于无照片模式
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [musicOn, setMusicOn] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [cameraOverlayVisible, setCameraOverlayVisible] = useState(true);
  const [cameraOverlayPos, setCameraOverlayPos] = useState<{ x: number, y: number }>({ x: window.innerWidth - 380, y: 20 });
  const [sharedView, setSharedView] = useState(false);

  const persistSession = useCallback((images: UploadedImage[], mode: PhotoMode) => {
    try {
      if (mode === 'photos' && images.length > 0) {
        const payload = {
          photoMode: mode,
          images: images.map(img => ({
            id: img.id,
            name: img.file.name,
            dataUrl: img.dataUrl
          }))
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        setHasSavedSession(true);
      } else {
        localStorage.removeItem(STORAGE_KEY);
        setHasSavedSession(false);
      }
    } catch (err) {
      console.error('保存上次圣诞树失败:', err);
    }
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) setHasSavedSession(true);
  }, []);

  const userPhotoUrls = useMemo(() => cycleToLength(uploaded.map(u => u.url), MAX_UPLOAD_PHOTOS), [uploaded]);
  const photoUrls = useMemo(
    () => (photoMode === 'photos' && userPhotoUrls.length > 0 ? userPhotoUrls : []),
    [photoMode, userPhotoUrls]
  );

  const copyShareLink = useCallback(async () => {
    if (photoMode !== 'photos' || uploaded.length === 0) return;
    const payload = {
      photoMode,
      images: uploaded.map(img => ({ id: img.id, name: img.file.name, dataUrl: img.dataUrl }))
    };
    try {
      const json = JSON.stringify(payload);
      const encoded = btoa(unescape(encodeURIComponent(json)));
      const url = `${window.location.origin}${window.location.pathname}#shared=${encoded}`;
      await navigator.clipboard.writeText(url);
      alert('分享链接已复制，可发送给好友查看你的圣诞树');
    } catch (err) {
      console.error('复制分享链接失败:', err);
      alert('复制失败，请重试或检查浏览器权限');
    }
  }, [photoMode, uploaded]);

  const resizeImageIfNeeded = useCallback(async (file: File) => {
    // 仅对尺寸超大的图片做压缩，减轻内存/显存压力
    const imgUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = imgUrl;
    });

    const { width, height } = img;
    if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
      URL.revokeObjectURL(imgUrl);
      return file;
    }

    const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, 0, 0, targetW, targetH);

    const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.9));
    URL.revokeObjectURL(imgUrl);
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: mime });
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    setFallbackNotice(null);
    setSharedView(false);
    try {
      const processed: UploadedImage[] = [];
      for (const file of files) {
        const resized = await resizeImageIfNeeded(file);
        const dataUrl = await fileToDataUrl(resized);
        processed.push({
          id: crypto.randomUUID(),
          file: resized,
          url: URL.createObjectURL(resized),
          dataUrl
        });
      }
      setUploaded(prev => {
        const remaining = Math.max(0, MAX_UPLOAD_PHOTOS - prev.length);
        const accepted = processed.slice(0, remaining);
        return [...prev, ...accepted];
      });
      setPhotoMode('photos');
    } catch (err: any) {
      console.error('图片处理失败，切换无照片模式：', err);
      setPhotoMode('empty');
      setFallbackNotice('图片解析失败，将以无照片模式展示圣诞树');
      setUploaded([]);
    } finally {
      setIsProcessing(false);
    }
  }, [resizeImageIfNeeded]);

  const removeById = useCallback((id: string) => {
    setUploaded(prev => {
      const target = prev.find(p => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter(p => p.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setUploaded(prev => {
      prev.forEach(p => URL.revokeObjectURL(p.url));
      return [];
    });
    setSharedView(false);
  }, []);

  const restoreLastSession = useCallback(async () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    setIsProcessing(true);
    setSharedView(false);
    try {
      const parsed = JSON.parse(raw) as { photoMode: PhotoMode, images?: { id: string, name: string, dataUrl: string }[] };
      if (parsed.photoMode === 'empty' || !parsed.images || parsed.images.length === 0) {
        clearAll();
        setPhotoMode('empty');
        setPage('TREE');
        return;
      }
      const rebuilt: UploadedImage[] = [];
      for (const img of parsed.images.slice(0, MAX_UPLOAD_PHOTOS)) {
        const file = await dataUrlToFile(img.dataUrl, img.name || 'photo.jpg');
        const url = URL.createObjectURL(file);
        rebuilt.push({ id: img.id || crypto.randomUUID(), file, url, dataUrl: img.dataUrl });
      }
      setUploaded(rebuilt);
      setPhotoMode('photos');
      setPage('TREE');
    } catch (err) {
      console.error('恢复上次圣诞树失败:', err);
    } finally {
      setIsProcessing(false);
    }
  }, [clearAll]);

  useEffect(() => {
    uploadedRef.current = uploaded;
    persistSession(uploaded, photoMode);
  }, [uploaded, photoMode, persistSession]);

  useEffect(() => {
    // 防止把文件拖到窗口外层触发浏览器导航导致整页刷新/黑屏
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('dragover', prevent, { passive: false });
    window.addEventListener('drop', prevent, { passive: false });
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  useEffect(() => {
    return () => {
      // 卸载时清理 object url，避免热更新/刷新累积
      uploadedRef.current.forEach(p => URL.revokeObjectURL(p.url));
    };
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    const token = hash.startsWith('#shared=') ? hash.replace('#shared=', '') : null;
    if (!token) return;
    (async () => {
      try {
        const json = decodeURIComponent(escape(atob(token)));
        const payload = JSON.parse(json) as { photoMode: PhotoMode, images?: { id: string, name: string, dataUrl: string }[] };
        if (!payload.images || payload.images.length === 0) return;
        setIsProcessing(true);
        const rebuilt: UploadedImage[] = [];
        for (const img of payload.images.slice(0, MAX_UPLOAD_PHOTOS)) {
          const file = await dataUrlToFile(img.dataUrl, img.name || 'photo.jpg');
          const url = URL.createObjectURL(file);
          rebuilt.push({ id: img.id || crypto.randomUUID(), file, url, dataUrl: img.dataUrl });
        }
        setUploaded(rebuilt);
        setPhotoMode('photos');
        setPage('TREE');
        setSharedView(true);
        window.history.replaceState(null, '', window.location.pathname);
      } catch (err) {
        console.error('解析分享链接失败:', err);
      } finally {
        setIsProcessing(false);
      }
    })();
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = true;
    audio.volume = 0.4;
    if (page === 'TREE' && musicOn) {
      audio.play().catch(() => {
        // 自动播放被阻止时，静音图标状态切换为关闭
        setMusicOn(false);
      });
    } else {
      audio.pause();
    }
  }, [page, musicOn]);

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      <audio ref={audioRef} src={BGM_URL} />
      {page === 'UPLOAD' ? (
        <UploadPage
          maxUploads={MAX_UPLOAD_PHOTOS}
          images={uploaded}
          isProcessing={isProcessing}
          canStart={photoMode === 'empty' || uploaded.length > 0}
          fallbackNotice={fallbackNotice}
          hasSaved={hasSavedSession}
          onRestore={restoreLastSession}
          onAddFiles={addFiles}
          onRemove={removeById}
          onClear={clearAll}
          onStart={() => {
            if ((!uploaded.length && photoMode !== 'empty') || isProcessing) return;
            setPage('TREE');
          }}
          onStartEmpty={() => {
            if (isProcessing) return;
            // 切换到无照片模式并进入场景
            uploaded.forEach(p => URL.revokeObjectURL(p.url));
            setUploaded([]);
            setPhotoMode('empty');
            setFallbackNotice(null);
            setPage('TREE');
          }}
        />
      ) : (
        <>
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
            <Suspense fallback={
              <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFD700', fontSize: '12px', letterSpacing: '4px' }}>
                GENERATING LUXURY TREE...
              </div>
            }>
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
                  <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} photoUrls={photoUrls} photoMode={photoMode} zoom={zoom} tilt={tilt} hasHand={hasHand} onPhotoClick={setSelectedImageUrl} />
        </Canvas>
            </Suspense>
      </div>
          <GestureController
            onGesture={setSceneState}
            onMove={setRotationSpeed}
            onZoom={setZoom}
            onTilt={setTilt}
            onHandPresence={setHasHand}
            onStatus={setAiStatus}
            debugMode={debugMode}
            cameraEnabled={cameraEnabled}
            overlayVisible={cameraOverlayVisible}
            overlayPos={cameraOverlayPos}
            onToggleOverlay={() => setCameraOverlayVisible(v => !v)}
            onDragOverlay={(x: number, y: number) => setCameraOverlayPos({ x: Math.max(10, x), y: Math.max(10, y) })}
          />

          <PhotoViewer url={selectedImageUrl} onClose={() => setSelectedImageUrl(null)} />

          {/* UI - Buttons */}
          <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button
              onClick={() => setMusicOn(m => !m)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '20px',
                backgroundColor: musicOn ? 'rgba(255,215,0,0.9)' : 'rgba(0,0,0,0.5)',
                border: musicOn ? '1px solid rgba(255,215,0,1)' : '1px solid rgba(255, 255, 255, 0.15)',
                color: musicOn ? '#000' : 'rgba(255,255,255,0.85)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: '16px',
                fontWeight: '700',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transformOrigin: '50% 50%',
                animation: musicOn ? 'spin 6s linear infinite' : 'none'
              }}
              title={musicOn ? '关闭音乐' : '开启音乐'}
            >
              ♪
            </button>
            <button
              onClick={() => {
                setCameraEnabled(v => !v);
                setCameraOverlayVisible(true);
              }}
              style={{
                height: '40px',
                padding: '0 14px',
                borderRadius: '10px',
                backgroundColor: cameraEnabled ? 'rgba(0,0,0,0.5)' : 'rgba(255, 0, 0, 0.15)',
                border: cameraEnabled ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid rgba(255,0,0,0.5)',
                color: cameraEnabled ? 'rgba(255, 255, 255, 0.9)' : '#ff8888',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
              }}
              title={cameraEnabled ? '关闭摄像头' : '开启摄像头'}
            >
              {cameraEnabled ? <CameraOnIcon color="#FFD700" /> : <CameraOffIcon color="#ff6666" />}
              <span>摄像头</span>
            </button>
            {!sharedView && (
              <button
                onClick={copyShareLink}
                style={{
                  height: '40px',
                  padding: '0 16px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: 'rgba(255, 255, 255, 0.9)',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                }}
                title="复制分享链接"
              >
                📤
                <span>分享</span>
              </button>
            )}
            {!sharedView && (
              <>
                <button
                  onClick={() => setPage('UPLOAD')}
                  style={{
                    height: '40px',
                    padding: '0 20px',
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: 'rgba(255, 255, 255, 0.85)',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontSize: '13px',
                    fontWeight: '500',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    backdropFilter: 'blur(8px)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  更换照片
                </button>
                <button 
                  onClick={() => setDebugMode(!debugMode)} 
                  style={{ 
                    height: '40px',
                    padding: '0 20px', 
                    backgroundColor: debugMode ? 'rgba(255, 215, 0, 0.9)' : 'rgba(0,0,0,0.5)', 
                    border: debugMode ? '1px solid rgba(255, 215, 0, 1)' : '1px solid rgba(255, 215, 0, 0.4)', 
                    color: debugMode ? '#000' : '#FFD700', 
                    fontFamily: 'system-ui, -apple-system, sans-serif', 
                    fontSize: '13px', 
                    fontWeight: '600', 
                    borderRadius: '10px',
                    cursor: 'pointer', 
                    backdropFilter: 'blur(8px)',
                    transition: 'all 0.2s ease'
                  }}
                >
                   {debugMode ? '隐藏画面' : '📷 摄像头画面'}
                </button>
                <button 
                  onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} 
                  style={{ 
                    height: '40px',
                    padding: '0 28px', 
                    backgroundColor: 'rgba(255, 215, 0, 0.9)', 
                    border: '1px solid rgba(255, 215, 0, 1)', 
                    color: '#000', 
                    fontFamily: 'system-ui, -apple-system, sans-serif', 
                    fontSize: '14px', 
                    fontWeight: '600', 
                    letterSpacing: '1px',
                    borderRadius: '10px',
                    cursor: 'pointer', 
                    backdropFilter: 'blur(8px)',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 4px 15px rgba(255, 215, 0, 0.2)'
                  }}
                >
                   {sceneState === 'CHAOS' ? '聚合' : '散开'}
                </button>
              </>
            )}
            {sharedView && (
              <button
                onClick={() => {
                  setSharedView(false);
                  setPage('UPLOAD');
                  setUploaded([]);
                  setPhotoMode('photos');
                }}
                style={{
                  height: '40px',
                  padding: '0 18px',
                  backgroundColor: 'rgba(255, 215, 0, 0.9)',
                  border: '1px solid rgba(255, 215, 0, 1)',
                  color: '#000',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontSize: '13px',
                  fontWeight: '700',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s ease'
                }}
              >
                去制作我的圣诞树
              </button>
            )}
          </div>

      {/* UI - AI Status */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>
          <div style={{ 
            position: 'absolute', 
            top: '60px', 
            left: '50%', 
            transform: 'translateX(-50%)', 
            color: 'rgba(255, 255, 255, 0.85)', 
            fontSize: '12px', 
            letterSpacing: '1px', 
            zIndex: 10, 
            background: 'rgba(0,0,0,0.5)', 
            padding: '10px 25px', 
            borderRadius: '40px', 
            border: '1px solid rgba(255, 255, 255, 0.15)',
            backdropFilter: 'blur(10px)',
            whiteSpace: 'nowrap',
            fontFamily: 'sans-serif'
          }}>
            开启摄像头，试试🖐张手掌、✊握拳头、👋移动手掌，点击照片可查看大图～
          </div>
        </>
      )}
    </div>
  );
}