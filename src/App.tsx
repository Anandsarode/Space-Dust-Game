/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';
import {
  Volume2,
  VolumeX,
  RotateCcw,
  Zap,
  Crosshair,
  Share2,
  Check,
  Trophy,
  Sparkles,
  HelpCircle,
  X,
} from 'lucide-react';

// ============================================================================
// 1. CONSTANTS & ORB HIERARCHY CONFIGURATION
// ============================================================================

export interface OrbTier {
  tier: number;
  name: string;
  radius: number;
  color: string;
  secondaryColor: string;
  points: number;
  freq: number;
}

export const ORB_TIERS: OrbTier[] = [
  {
    tier: 1,
    name: 'Space Dust',
    radius: 16,
    color: '#00f5d4',
    secondaryColor: '#00a896',
    points: 2,
    freq: 261.63, // C4
  },
  {
    tier: 2,
    name: 'Asteroid',
    radius: 24,
    color: '#00bbf9',
    secondaryColor: '#0077b6',
    points: 4,
    freq: 293.66, // D4
  },
  {
    tier: 3,
    name: 'Moon',
    radius: 34,
    color: '#9b5de5',
    secondaryColor: '#5a189a',
    points: 8,
    freq: 329.63, // E4
  },
  {
    tier: 4,
    name: 'Mars',
    radius: 46,
    color: '#f15bb5',
    secondaryColor: '#b5179e',
    points: 16,
    freq: 349.23, // F4
  },
  {
    tier: 5,
    name: 'Earth',
    radius: 58,
    color: '#00f58a',
    secondaryColor: '#007f5f',
    points: 32,
    freq: 392.0, // G4
  },
  {
    tier: 6,
    name: 'Neptune',
    radius: 72,
    color: '#3a86ff',
    secondaryColor: '#1d3557',
    points: 64,
    freq: 440.0, // A4
  },
  {
    tier: 7,
    name: 'Saturn',
    radius: 88,
    color: '#ffbe0b',
    secondaryColor: '#ca6702',
    points: 128,
    freq: 493.88, // B4
  },
  {
    tier: 8,
    name: 'Neutron Star',
    radius: 106,
    color: '#fb5607',
    secondaryColor: '#9b2226',
    points: 256,
    freq: 523.25, // C5
  },
  {
    tier: 9,
    name: 'Supernova Sun',
    radius: 126,
    color: '#ff006e',
    secondaryColor: '#800f2f',
    points: 512,
    freq: 587.33, // D5
  },
];

const BOX_WIDTH = 420;
const BOX_HEIGHT = 620;
const DANGER_LINE_Y = 112;
const DROP_Y = 52;
const WALL_THICKNESS = 60;
const DROP_COOLDOWN_MS = 500;
const COMBO_WINDOW_MS = 2500;
const SETTLE_GRACE_MS = 1500;
const DANGER_DURATION_MS = 3000;
const SHAKE_COST = 100;
const VAPORIZE_COST = 200;
const HIGH_SCORE_KEY = 'cosmic_merge_neon_orbs_highscore_v1';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  alpha: number;
  lineWidth: number;
}

interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  subText?: string;
  color: string;
  alpha: number;
  scale: number;
}

interface LaserBeam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  alpha: number;
}

interface Star {
  x: number;
  y: number;
  size: number;
  baseAlpha: number;
  speed: number;
  phase: number;
}

interface OrbBody extends Matter.Body {
  orbTier?: number;
  spawnTime?: number;
  id: number;
  blinkOffset?: number;
  mergeScale?: number;
}

// ============================================================================
// 2. SYNTHESIZED WEB AUDIO ENGINE (ZERO EXTERNAL ASSETS)
// ============================================================================

class CosmicAudioEngine {
  private ctx: AudioContext | null = null;
  public isMuted: boolean = false;

  private ensureContext(): AudioContext | null {
    if (this.isMuted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public playDrop() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.14);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playMerge(tierIndex: number, isSupernova = false) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (isSupernova) {
      const notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = idx % 2 === 0 ? 'triangle' : 'sawtooth';
        osc.frequency.setValueAtTime(freq * 0.5, now + idx * 0.04);
        osc.frequency.exponentialRampToValueAtTime(freq, now + idx * 0.04 + 0.35);

        gain.gain.setValueAtTime(0.14, now + idx * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.65);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.04);
        osc.stop(now + idx * 0.04 + 0.66);
      });
      return;
    }

    const tierObj = ORB_TIERS[Math.min(tierIndex, ORB_TIERS.length - 1)];
    const baseFreq = tierObj ? tierObj.freq : 300;

    // Primary pop oscillator
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(baseFreq * 0.72, now);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 1.45, now + 0.11);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 1.15, now + 0.24);

    gain1.gain.setValueAtTime(0.24, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.27);

    // Rich harmonic chord layer for higher tiers
    const harmonic = ctx.createOscillator();
    const gain2 = ctx.createGain();
    harmonic.type = 'triangle';
    const fifth = baseFreq * 1.498;
    harmonic.frequency.setValueAtTime(fifth, now + 0.02);
    harmonic.frequency.exponentialRampToValueAtTime(fifth * 1.25, now + 0.22);

    gain2.gain.setValueAtTime(0.12 + tierIndex * 0.012, now + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    harmonic.connect(gain2);
    gain2.connect(ctx.destination);
    harmonic.start(now + 0.02);
    harmonic.stop(now + 0.33);
  }

  public playCombo(comboCount: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const base = 330 + Math.min(comboCount, 6) * 55;
    const ratios = [1, 1.25, 1.5, 2];

    ratios.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(base * ratio, now + i * 0.055);

      gain.gain.setValueAtTime(0.14, now + i * 0.055);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.055);
      osc.stop(now + i * 0.055 + 0.23);
    });
  }

  public playShake() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.32);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  public playVaporize() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.25);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.27);
  }

  public playAlarmBeep(secondsLeft: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const pitch = secondsLeft === 1 ? 880 : secondsLeft === 2 ? 740 : 620;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(pitch, now);

    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playGameOver() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const freqs = [392.0, 349.23, 311.13, 261.63];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, now + i * 0.14);

      gain.gain.setValueAtTime(0.14, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.36);
    });
  }
}

const audio = new CosmicAudioEngine();

// ============================================================================
// 3. CUSTOM ORB ARTWORK RENDERER (SHARED FOR MAIN CANVAS & PREVIEW)
// ============================================================================

function drawCustomOrb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  angle: number,
  tierNumber: number,
  options?: {
    isPreview?: boolean;
    isInDanger?: boolean;
    isTargeted?: boolean;
    time?: number;
    blinkOffset?: number;
  }
) {
  const tier = ORB_TIERS[tierNumber - 1] || ORB_TIERS[0];
  const time = options?.time ?? performance.now();

  ctx.save();
  ctx.translate(x, y);

  // Outer Neon Glow
  ctx.shadowColor = tier.color;
  ctx.shadowBlur = options?.isPreview ? 14 : 18;

  // Tier 7 (Saturn) Back Ring
  if (tierNumber === 7) {
    ctx.save();
    ctx.rotate(angle + 0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.38, radius * 0.34, 0, Math.PI, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 190, 11, 0.55)';
    ctx.lineWidth = Math.max(3, radius * 0.11);
    ctx.stroke();
    ctx.restore();
  }

  // Tier 8 (Neutron Star) Pulsar Jets
  if (tierNumber === 8) {
    ctx.save();
    ctx.rotate(angle);
    const jetGrad = ctx.createLinearGradient(-radius * 1.35, 0, radius * 1.35, 0);
    jetGrad.addColorStop(0, 'rgba(251, 86, 7, 0)');
    jetGrad.addColorStop(0.5, 'rgba(255, 200, 120, 0.65)');
    jetGrad.addColorStop(1, 'rgba(251, 86, 7, 0)');
    ctx.strokeStyle = jetGrad;
    ctx.lineWidth = Math.max(4, radius * 0.14);
    ctx.beginPath();
    ctx.moveTo(-radius * 1.3, 0);
    ctx.lineTo(radius * 1.3, 0);
    ctx.stroke();
    ctx.restore();
  }

  // Tier 9 (Supernova Sun) Corona Rays
  if (tierNumber === 9) {
    ctx.save();
    ctx.rotate(time * 0.0008);
    const spikes = 12;
    ctx.fillStyle = 'rgba(255, 0, 110, 0.28)';
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? radius * 1.14 : radius * 0.96;
      const a = (i * Math.PI) / spikes;
      const sx = Math.cos(a) * r;
      const sy = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Main Sphere Radial Gradient
  const grad = ctx.createRadialGradient(
    -radius * 0.32,
    -radius * 0.32,
    radius * 0.08,
    0,
    0,
    radius
  );
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.22, tier.color);
  grad.addColorStop(0.82, tier.secondaryColor);
  grad.addColorStop(1, '#090b10');

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Crisp Neon Rim Border
  ctx.lineWidth = Math.max(2, radius * 0.065);
  ctx.strokeStyle = tier.color;
  ctx.stroke();

  // Disable heavy shadow for internal surface details
  ctx.shadowBlur = 0;

  // Clip inside sphere for planetary surface details
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.96, 0, Math.PI * 2);
  ctx.clip();
  ctx.rotate(angle);

  if (tierNumber === 2 || tierNumber === 3) {
    // Asteroid / Moon craters
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.arc(-radius * 0.35, -radius * 0.2, radius * 0.18, 0, Math.PI * 2);
    ctx.arc(radius * 0.38, radius * 0.25, radius * 0.14, 0, Math.PI * 2);
    ctx.arc(-radius * 0.15, radius * 0.45, radius * 0.11, 0, Math.PI * 2);
    ctx.fill();
  } else if (tierNumber === 4) {
    // Mars bands & polar ice cap
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, -radius * 0.82, radius * 0.55, radius * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (tierNumber === 5) {
    // Earth stylized continents
    ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
    ctx.beginPath();
    ctx.arc(-radius * 0.3, -radius * 0.15, radius * 0.36, 0, Math.PI * 2);
    ctx.arc(radius * 0.35, radius * 0.25, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (tierNumber === 6) {
    // Neptune atmospheric bands
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = radius * 0.12;
    ctx.beginPath();
    ctx.moveTo(-radius, -radius * 0.28);
    ctx.lineTo(radius, -radius * 0.28);
    ctx.moveTo(-radius, radius * 0.32);
    ctx.lineTo(radius, radius * 0.32);
    ctx.stroke();
  } else if (tierNumber === 9) {
    // Supernova core rings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.68, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Top-Left Specular Glass Highlight
  ctx.rotate(-angle);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.beginPath();
  ctx.ellipse(
    -radius * 0.34,
    -radius * 0.36,
    radius * 0.26,
    radius * 0.13,
    -Math.PI / 4,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.restore(); // End internal clip

  // Cute Minimalist Geometric Face (rotates slightly with body)
  ctx.save();
  ctx.rotate(Math.sin(angle) * 0.35);

  const eyeSpacing = Math.max(4.5, radius * 0.28);
  const eyeY = -radius * 0.06;
  const eyeRadius = Math.max(1.8, radius * 0.095);

  const blinkPhase = ((time + (options?.blinkOffset ?? 0)) % 4200);
  const isBlinking = blinkPhase > 4060;

  ctx.fillStyle = '#090b10';
  ctx.strokeStyle = '#090b10';
  ctx.lineWidth = Math.max(1.5, radius * 0.06);
  ctx.lineCap = 'round';

  if (options?.isInDanger) {
    // Nervous > < eyes when near the danger line
    const s = eyeRadius * 1.2;
    ctx.beginPath();
    ctx.moveTo(-eyeSpacing - s, eyeY - s);
    ctx.lineTo(-eyeSpacing + s * 0.5, eyeY);
    ctx.lineTo(-eyeSpacing - s, eyeY + s);
    ctx.moveTo(eyeSpacing + s, eyeY - s);
    ctx.lineTo(eyeSpacing - s * 0.5, eyeY);
    ctx.lineTo(eyeSpacing + s, eyeY + s);
    ctx.stroke();

    // Worried wavy mouth
    ctx.beginPath();
    ctx.arc(0, eyeY + radius * 0.28, radius * 0.12, Math.PI, 0, false);
    ctx.stroke();
  } else {
    // Eyes
    if (isBlinking) {
      ctx.beginPath();
      ctx.moveTo(-eyeSpacing - eyeRadius, eyeY);
      ctx.lineTo(-eyeSpacing + eyeRadius, eyeY);
      ctx.moveTo(eyeSpacing - eyeRadius, eyeY);
      ctx.lineTo(eyeSpacing + eyeRadius, eyeY);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(-eyeSpacing, eyeY, eyeRadius, 0, Math.PI * 2);
      ctx.arc(eyeSpacing, eyeY, eyeRadius, 0, Math.PI * 2);
      ctx.fill();

      // Tiny white eye shine
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(
        -eyeSpacing - eyeRadius * 0.3,
        eyeY - eyeRadius * 0.3,
        eyeRadius * 0.38,
        0,
        Math.PI * 2
      );
      ctx.arc(
        eyeSpacing - eyeRadius * 0.3,
        eyeY - eyeRadius * 0.3,
        eyeRadius * 0.38,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // Rosy neon cheeks
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.ellipse(
      -eyeSpacing * 1.45,
      eyeY + eyeRadius * 1.2,
      eyeRadius * 0.9,
      eyeRadius * 0.55,
      0,
      0,
      Math.PI * 2
    );
    ctx.ellipse(
      eyeSpacing * 1.45,
      eyeY + eyeRadius * 1.2,
      eyeRadius * 0.9,
      eyeRadius * 0.55,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Expressive Mouth per Tier
    ctx.strokeStyle = '#090b10';
    ctx.beginPath();
    if (tierNumber <= 3) {
      // Cute simple smile
      ctx.arc(0, eyeY + radius * 0.1, radius * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else if (tierNumber <= 6) {
      // Happy cat/w-smile or open grin
      ctx.arc(0, eyeY + radius * 0.08, radius * 0.18, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    } else {
      // Cosmic awe grin
      ctx.fillStyle = '#090b10';
      ctx.arc(0, eyeY + radius * 0.12, radius * 0.16, 0, Math.PI, false);
      ctx.fill();
    }
  }

  ctx.restore();

  // Tier 7 (Saturn) Front Ring Overlap
  if (tierNumber === 7) {
    ctx.save();
    ctx.rotate(angle + 0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.38, radius * 0.34, 0, 0, Math.PI);
    ctx.strokeStyle = '#ffbe0b';
    ctx.lineWidth = Math.max(3, radius * 0.11);
    ctx.shadowColor = '#ffbe0b';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();
  }

  // Target reticle overlay when Laser Vaporizer mode is active
  if (options?.isTargeted) {
    ctx.save();
    ctx.strokeStyle = '#ff006e';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, radius + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ============================================================================
// 4. MAIN REACT APPLICATION COMPONENT
// ============================================================================

export default function App() {
  // UI Reactive State
  const [score, setScore] = useState<number>(0);
  const [displayScore, setDisplayScore] = useState<number>(0);
  const [highScore, setHighScore] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(HIGH_SCORE_KEY);
      return saved ? parseInt(saved, 10) || 0 : 0;
    } catch {
      return 0;
    }
  });
  const [isNewHighScore, setIsNewHighScore] = useState<boolean>(false);
  const [currentTier, setCurrentTier] = useState<number>(1);
  const [nextTier, setNextTier] = useState<number>(2);
  const [totalMerges, setTotalMerges] = useState<number>(0);
  const [highestTierReached, setHighestTierReached] = useState<number>(1);
  const [comboCount, setComboCount] = useState<number>(1);
  const [freeShakeLeft, setFreeShakeLeft] = useState<number>(1);
  const [freeVaporizeLeft, setFreeVaporizeLeft] = useState<number>(1);
  const [vaporizerMode, setVaporizerMode] = useState<boolean>(false);
  const [dangerCountdown, setDangerCountdown] = useState<number | null>(null);
  const [isGameOver, setIsGameOver] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [copiedShare, setCopiedShare] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [chamberScale, setChamberScale] = useState<number>(1);

  // Refs for synchronous access inside 60fps Matter.js + Canvas loop
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nextOrbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageWrapperRef = useRef<HTMLDivElement | null>(null);

  const engineRef = useRef<Matter.Engine | null>(null);
  const scoreRef = useRef<number>(0);
  const highScoreRef = useRef<number>(highScore);
  const currentTierRef = useRef<number>(1);
  const nextTierRef = useRef<number>(2);
  const pointerXRef = useRef<number>(BOX_WIDTH / 2);
  const lastDropTimeRef = useRef<number>(0);
  const isCoolingDownRef = useRef<boolean>(false);
  const vaporizerModeRef = useRef<boolean>(false);
  const isGameOverRef = useRef<boolean>(false);

  // Combo state refs
  const lastMergeTimeRef = useRef<number>(0);
  const comboRef = useRef<number>(0);

  // Danger timer refs
  const dangerTimerMsRef = useRef<number>(0);
  const lastAlarmSecRef = useRef<number | null>(null);

  // Visual FX arrays
  const particlesRef = useRef<Particle[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const laserBeamsRef = useRef<LaserBeam[]>([]);
  const screenShakeRef = useRef<number>(0);
  const starsRef = useRef<Star[]>([]);

  // Generate random spawn tier (only Tiers 1 to 4 can spawn at top)
  const rollSpawnTier = useCallback(() => {
    const weights = [0.38, 0.3, 0.2, 0.12]; // Weighted toward smaller orbs for smooth gameplay
    const r = Math.random();
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (r <= acc) return i + 1;
    }
    return 1;
  }, []);

  // Smooth rolling score animation
  useEffect(() => {
    if (displayScore === score) return;
    let rafId: number;
    const step = () => {
      setDisplayScore((prev) => {
        if (prev === score) return prev;
        const diff = score - prev;
        const delta =
          Math.abs(diff) <= 2
            ? diff
            : Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * 0.18));
        return prev + delta;
      });
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [score, displayScore]);

  // Render "Next Orb" preview canvas whenever nextTier changes
  useEffect(() => {
    const canvas = nextOrbCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const tierInfo = ORB_TIERS[nextTier - 1] || ORB_TIERS[0];
    const displayRadius = Math.min(28, tierInfo.radius * 0.78);
    drawCustomOrb(ctx, canvas.width / 2, canvas.height / 2, displayRadius, 0, nextTier, {
      isPreview: true,
      time: 0,
    });
  }, [nextTier]);

  // Responsive scaling calculation so the 420x620 chamber fits any screen with zero scroll
  useEffect(() => {
    const updateScale = () => {
      if (!stageWrapperRef.current) return;
      const rect = stageWrapperRef.current.getBoundingClientRect();
      const padX = 12;
      const padY = 12;
      const availW = Math.max(240, rect.width - padX);
      const availH = Math.max(320, rect.height - padY);
      const scale = Math.min(1, availW / BOX_WIDTH, availH / BOX_HEIGHT);
      setChamberScale(scale);
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Helper to add points and update High Score
  const addPoints = useCallback((pts: number) => {
    const nextScore = Math.max(0, scoreRef.current + pts);
    scoreRef.current = nextScore;
    setScore(nextScore);

    if (nextScore > highScoreRef.current) {
      highScoreRef.current = nextScore;
      setHighScore(nextScore);
      setIsNewHighScore(true);
      try {
        localStorage.setItem(HIGH_SCORE_KEY, String(nextScore));
      } catch {
        // Ignore storage errors in restricted environments
      }
    }
  }, []);

  // Spawn a burst of glowing particles
  const spawnParticles = useCallback((x: number, y: number, color: string, count = 18) => {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 1.8 + Math.random() * 5.2;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.6,
        radius: 2.2 + Math.random() * 3.5,
        color,
        alpha: 1,
        decay: 0.02 + Math.random() * 0.018,
      });
    }
  }, []);

  // Create an orb physics body
  const createOrbBody = useCallback(
    (x: number, y: number, tierNumber: number, isMerged = false): OrbBody => {
      const tier = ORB_TIERS[tierNumber - 1];
      const clampedX = Math.max(
        tier.radius + 4,
        Math.min(BOX_WIDTH - tier.radius - 4, x)
      );
      const clampedY = Math.min(BOX_HEIGHT - tier.radius - 4, y);

      const body = Matter.Bodies.circle(clampedX, clampedY, tier.radius, {
        restitution: 0.3,
        friction: 0.1,
        frictionAir: 0.004,
        density: 0.0015 * (1 + tierNumber * 0.12),
        label: `orb_${tierNumber}`,
      }) as OrbBody;

      body.orbTier = tierNumber;
      body.spawnTime = isMerged ? performance.now() - SETTLE_GRACE_MS : performance.now();
      body.blinkOffset = Math.floor(Math.random() * 4000);
      body.mergeScale = isMerged ? 0.25 : 1;

      if (isMerged) {
        Matter.Body.setVelocity(body, {
          x: (Math.random() - 0.5) * 1.4,
          y: -2.4,
        });
      }

      return body;
    },
    []
  );

  // Initialize Matter.js Physics World and 60fps Render Loop
  useEffect(() => {
    // Initialize background stars
    const initialStars: Star[] = [];
    for (let i = 0; i < 65; i++) {
      initialStars.push({
        x: Math.random() * BOX_WIDTH,
        y: Math.random() * BOX_HEIGHT,
        size: 0.8 + Math.random() * 1.8,
        baseAlpha: 0.2 + Math.random() * 0.55,
        speed: 0.0015 + Math.random() * 0.003,
        phase: Math.random() * Math.PI * 2,
      });
    }
    starsRef.current = initialStars;

    const engine = Matter.Engine.create({
      gravity: { x: 0, y: 1.15, scale: 0.001 },
      positionIterations: 8,
      velocityIterations: 6,
    });
    engineRef.current = engine;

    // Create solid containment walls (left, right, bottom)
    const wallOptions: Matter.IChamberBodyDefinition = {
      isStatic: true,
      restitution: 0.2,
      friction: 0.1,
      label: 'wall',
    };

    const ground = Matter.Bodies.rectangle(
      BOX_WIDTH / 2,
      BOX_HEIGHT + WALL_THICKNESS / 2,
      BOX_WIDTH + WALL_THICKNESS * 2,
      WALL_THICKNESS,
      wallOptions
    );
    const leftWall = Matter.Bodies.rectangle(
      -WALL_THICKNESS / 2,
      BOX_HEIGHT / 2,
      WALL_THICKNESS,
      BOX_HEIGHT * 2,
      wallOptions
    );
    const rightWall = Matter.Bodies.rectangle(
      BOX_WIDTH + WALL_THICKNESS / 2,
      BOX_HEIGHT / 2,
      WALL_THICKNESS,
      BOX_HEIGHT * 2,
      wallOptions
    );

    Matter.World.add(engine.world, [ground, leftWall, rightWall]);

    // Initial spawn tiers
    const first = rollSpawnTier();
    const second = rollSpawnTier();
    currentTierRef.current = first;
    nextTierRef.current = second;
    setCurrentTier(first);
    setNextTier(second);

    // Handle collisions (both collisionStart and collisionActive so resting same-tier orbs always merge)
    const mergedIdsInStep = new Set<number>();

    const handleCollisions = (event: Matter.IEventCollision<Matter.Engine>) => {
      if (isGameOverRef.current) return;

      for (const pair of event.pairs) {
        const bodyA = pair.bodyA as OrbBody;
        const bodyB = pair.bodyB as OrbBody;

        if (!bodyA.orbTier || !bodyB.orbTier) continue;
        if (bodyA.orbTier !== bodyB.orbTier) continue;
        if (mergedIdsInStep.has(bodyA.id) || mergedIdsInStep.has(bodyB.id)) continue;

        mergedIdsInStep.add(bodyA.id);
        mergedIdsInStep.add(bodyB.id);

        const tier = bodyA.orbTier;
        const midX = (bodyA.position.x + bodyB.position.x) / 2;
        const midY = (bodyA.position.y + bodyB.position.y) / 2;

        // Immediately remove both colliding bodies
        Matter.World.remove(engine.world, [bodyA, bodyB]);

        // Calculate Combo Multiplier (within 2.5s window)
        const now = performance.now();
        if (now - lastMergeTimeRef.current <= COMBO_WINDOW_MS) {
          comboRef.current += 1;
        } else {
          comboRef.current = 1;
        }
        lastMergeTimeRef.current = now;
        const activeMultiplier = comboRef.current;
        setComboCount(activeMultiplier);

        setTotalMerges((prev) => prev + 1);

        if (tier < 9) {
          // Spawn Tier + 1 at exact midpoint
          const nextTierNum = tier + 1;
          const nextTierData = ORB_TIERS[nextTierNum - 1];
          const mergedOrb = createOrbBody(midX, midY, nextTierNum, true);
          Matter.World.add(engine.world, mergedOrb);

          setHighestTierReached((prev) => Math.max(prev, nextTierNum));

          const earnedPoints = nextTierData.points * activeMultiplier;
          addPoints(earnedPoints);

          // Audio & Visual FX
          audio.playMerge(nextTierNum - 1, false);
          if (activeMultiplier >= 2) {
            audio.playCombo(activeMultiplier);
          }

          spawnParticles(midX, midY, nextTierData.color, 20);
          shockwavesRef.current.push({
            x: midX,
            y: midY,
            radius: nextTierData.radius * 0.4,
            maxRadius: nextTierData.radius * 1.9,
            color: nextTierData.color,
            alpha: 0.9,
            lineWidth: 3.5,
          });

          const comboLabels: Record<number, string> = {
            2: '2x COMBO!',
            3: '3x SUPER!',
            4: '4x COSMIC!',
          };
          const comboText =
            activeMultiplier >= 5
              ? `${activeMultiplier}x SUPERNOVA!`
              : comboLabels[activeMultiplier];

          floatingTextsRef.current.push({
            x: midX,
            y: midY - 10,
            vy: -1.6,
            text: `+${earnedPoints}`,
            subText: comboText,
            color: nextTierData.color,
            alpha: 1,
            scale: activeMultiplier >= 2 ? 1.25 : 1,
          });
        } else {
          // Two Tier 9 (Supernova Sun) Orbs Merge -> Massive Explosion + 1500 Bonus Points!
          const bonusPoints = 1500 * activeMultiplier;
          addPoints(bonusPoints);
          audio.playMerge(8, true);
          screenShakeRef.current = 18;

          // Clear nearby small orbs (Tier 1-5 within blast radius) and push larger orbs
          const allBodies = Matter.Composite.allBodies(engine.world) as OrbBody[];
          const toRemove: OrbBody[] = [];
          for (const b of allBodies) {
            if (!b.orbTier) continue;
            const dx = b.position.x - midX;
            const dy = b.position.y - midY;
            const dist = Math.hypot(dx, dy);
            if (dist < 240 && b.orbTier <= 5) {
              toRemove.push(b);
              spawnParticles(b.position.x, b.position.y, ORB_TIERS[b.orbTier - 1].color, 10);
            } else if (dist > 0 && dist < 320) {
              const forceMag = 0.08 * b.mass;
              Matter.Body.applyForce(b, b.position, {
                x: (dx / dist) * forceMag,
                y: (dy / dist) * forceMag - 0.04 * b.mass,
              });
            }
          }
          if (toRemove.length > 0) {
            Matter.World.remove(engine.world, toRemove);
          }

          spawnParticles(midX, midY, '#ff006e', 45);
          spawnParticles(midX, midY, '#ffbe0b', 30);
          shockwavesRef.current.push({
            x: midX,
            y: midY,
            radius: 20,
            maxRadius: 320,
            color: '#ff006e',
            alpha: 1,
            lineWidth: 6,
          });

          floatingTextsRef.current.push({
            x: midX,
            y: midY,
            vy: -1.8,
            text: `SUPERNOVA! +${bonusPoints}`,
            subText: 'CHAMBER BLAST CLEARED!',
            color: '#ff006e',
            alpha: 1,
            scale: 1.45,
          });
        }
      }
    };

    Matter.Events.on(engine, 'collisionStart', handleCollisions);
    Matter.Events.on(engine, 'collisionActive', handleCollisions);

    // 60FPS Physics & Custom Canvas Render Loop
    let animationFrameId: number;
    let lastTime = performance.now();

    const renderLoop = (now: number) => {
      const dt = Math.min(32, now - lastTime);
      lastTime = now;

      mergedIdsInStep.clear();
      if (!isGameOverRef.current) {
        Matter.Engine.update(engine, 1000 / 60);
      }

      // Reset combo UI display if window expired
      if (
        comboRef.current > 1 &&
        now - lastMergeTimeRef.current > COMBO_WINDOW_MS
      ) {
        comboRef.current = 1;
        setComboCount(1);
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.clearRect(0, 0, BOX_WIDTH, BOX_HEIGHT);

          // Apply screen shake if active
          if (screenShakeRef.current > 0.2) {
            const sx = (Math.random() - 0.5) * screenShakeRef.current;
            const sy = (Math.random() - 0.5) * screenShakeRef.current;
            ctx.translate(sx, sy);
            screenShakeRef.current *= 0.88;
          } else {
            screenShakeRef.current = 0;
          }

          // 1. Subtle Space Starfield & Grid Backdrop inside Chamber
          for (const star of starsRef.current) {
            const twinkle =
              star.baseAlpha + Math.sin(now * star.speed + star.phase) * 0.2;
            ctx.fillStyle = `rgba(226, 232, 240, ${Math.max(0.05, twinkle)})`;
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            ctx.fill();
          }

          // Subtle vertical grid lines
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.04)';
          ctx.lineWidth = 1;
          for (let gx = 60; gx < BOX_WIDTH; gx += 60) {
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            ctx.lineTo(gx, BOX_HEIGHT);
            ctx.stroke();
          }

          // 2. Dynamic Danger Line & Settled Orb Check
          const bodies = Matter.Composite.allBodies(engine.world) as OrbBody[];
          let anyOrbInDanger = false;

          for (const b of bodies) {
            if (!b.orbTier) continue;
            const tierInfo = ORB_TIERS[b.orbTier - 1];
            const settledEnough =
              now - (b.spawnTime ?? now) > SETTLE_GRACE_MS;
            if (settledEnough && b.position.y - tierInfo.radius < DANGER_LINE_Y) {
              anyOrbInDanger = true;
              break;
            }
          }

          if (!isGameOverRef.current) {
            if (anyOrbInDanger) {
              dangerTimerMsRef.current += dt;
              const remainingMs = Math.max(
                0,
                DANGER_DURATION_MS - dangerTimerMsRef.current
              );
              const secLeft = Math.ceil(remainingMs / 1000);

              if (secLeft >= 1 && secLeft <= 3) {
                setDangerCountdown(secLeft);
                if (lastAlarmSecRef.current !== secLeft) {
                  lastAlarmSecRef.current = secLeft;
                  audio.playAlarmBeep(secLeft);
                }
              }

              if (dangerTimerMsRef.current >= DANGER_DURATION_MS) {
                isGameOverRef.current = true;
                setIsGameOver(true);
                setDangerCountdown(null);
                audio.playGameOver();
              }
            } else {
              if (dangerTimerMsRef.current > 0) {
                dangerTimerMsRef.current = 0;
                lastAlarmSecRef.current = null;
                setDangerCountdown(null);
              }
            }
          }

          // Draw Dashed Red Danger Line
          ctx.save();
          const dangerPulse = anyOrbInDanger
            ? 0.55 + Math.sin(now * 0.015) * 0.35
            : 0.38;
          ctx.strokeStyle = `rgba(255, 0, 110, ${dangerPulse})`;
          ctx.lineWidth = anyOrbInDanger ? 2.5 : 1.5;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(0, DANGER_LINE_Y);
          ctx.lineTo(BOX_WIDTH, DANGER_LINE_Y);
          ctx.stroke();

          ctx.fillStyle = `rgba(255, 0, 110, ${dangerPulse + 0.15})`;
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.fillText('DANGER LIMIT', 10, DANGER_LINE_Y - 6);
          ctx.restore();

          // 3. Held Orb Preview & Vertical Dashed Laser Aim-Line
          if (!isGameOverRef.current && !vaporizerModeRef.current) {
            const heldTier = ORB_TIERS[currentTierRef.current - 1];
            const clampedDropX = Math.max(
              heldTier.radius + 6,
              Math.min(BOX_WIDTH - heldTier.radius - 6, pointerXRef.current)
            );

            // Vertical dashed laser aim-line from held orb down into box
            ctx.save();
            const laserGrad = ctx.createLinearGradient(
              clampedDropX,
              DROP_Y + heldTier.radius,
              clampedDropX,
              BOX_HEIGHT
            );
            laserGrad.addColorStop(0, `${heldTier.color}99`);
            laserGrad.addColorStop(0.7, `${heldTier.color}33`);
            laserGrad.addColorStop(1, 'rgba(0, 245, 212, 0.04)');

            ctx.strokeStyle = laserGrad;
            ctx.lineWidth = 1.75;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(clampedDropX, DROP_Y + heldTier.radius);
            ctx.lineTo(clampedDropX, BOX_HEIGHT - 4);
            ctx.stroke();
            ctx.restore();

            // Draw Held Orb at top drop-zone (slightly translucent while cooling down)
            ctx.save();
            if (isCoolingDownRef.current) {
              ctx.globalAlpha = 0.45;
            }
            drawCustomOrb(
              ctx,
              clampedDropX,
              DROP_Y,
              heldTier.radius,
              0,
              currentTierRef.current,
              { isPreview: true, time: now }
            );
            ctx.restore();
          }

          // 4. Render All Physics Orbs inside the Chamber
          for (const b of bodies) {
            if (!b.orbTier) continue;
            const tierInfo = ORB_TIERS[b.orbTier - 1];

            // Pop-in scale animation on newly merged orbs
            if (b.mergeScale !== undefined && b.mergeScale < 1) {
              b.mergeScale = Math.min(1, b.mergeScale + 0.12);
            }
            const scale = b.mergeScale ?? 1;

            const settledEnough =
              now - (b.spawnTime ?? now) > SETTLE_GRACE_MS;
            const inDanger =
              settledEnough && b.position.y - tierInfo.radius < DANGER_LINE_Y;

            drawCustomOrb(
              ctx,
              b.position.x,
              b.position.y,
              tierInfo.radius * scale,
              b.angle,
              b.orbTier,
              {
                isInDanger: inDanger,
                isTargeted: vaporizerModeRef.current,
                time: now,
                blinkOffset: b.blinkOffset,
              }
            );
          }

          // 5. Render Shockwave Rings
          for (let i = shockwavesRef.current.length - 1; i >= 0; i--) {
            const sw = shockwavesRef.current[i];
            sw.radius += (sw.maxRadius - sw.radius) * 0.16;
            sw.alpha -= 0.045;
            if (sw.alpha <= 0) {
              shockwavesRef.current.splice(i, 1);
              continue;
            }
            ctx.save();
            ctx.strokeStyle = sw.color;
            ctx.globalAlpha = sw.alpha;
            ctx.lineWidth = sw.lineWidth;
            ctx.shadowColor = sw.color;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          // 6. Render Glowing Burst Particles
          for (let i = particlesRef.current.length - 1; i >= 0; i--) {
            const p = particlesRef.current[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.12; // gentle gravity
            p.alpha -= p.decay;
            if (p.alpha <= 0) {
              particlesRef.current.splice(i, 1);
              continue;
            }
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          // 7. Render Laser Vaporizer Beams
          for (let i = laserBeamsRef.current.length - 1; i >= 0; i--) {
            const beam = laserBeamsRef.current[i];
            beam.alpha -= 0.07;
            if (beam.alpha <= 0) {
              laserBeamsRef.current.splice(i, 1);
              continue;
            }
            ctx.save();
            ctx.globalAlpha = beam.alpha;
            ctx.strokeStyle = beam.color;
            ctx.lineWidth = 6 * beam.alpha;
            ctx.shadowColor = beam.color;
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.moveTo(beam.x1, beam.y1);
            ctx.lineTo(beam.x2, beam.y2);
            ctx.stroke();
            ctx.restore();
          }

          // 8. Render Floating "+Points" and Combo Multiplier Texts
          for (let i = floatingTextsRef.current.length - 1; i >= 0; i--) {
            const ft = floatingTextsRef.current[i];
            ft.y += ft.vy;
            ft.alpha -= 0.018;
            if (ft.alpha <= 0) {
              floatingTextsRef.current.splice(i, 1);
              continue;
            }
            ctx.save();
            ctx.globalAlpha = ft.alpha;
            ctx.textAlign = 'center';
            ctx.shadowColor = ft.color;
            ctx.shadowBlur = 10;

            if (ft.subText) {
              ctx.fillStyle = '#ffffff';
              ctx.font = `800 ${Math.round(13 * ft.scale)}px "Outfit", sans-serif`;
              ctx.fillText(ft.subText, ft.x, ft.y - 16);
            }

            ctx.fillStyle = ft.color;
            ctx.font = `700 ${Math.round(18 * ft.scale)}px "JetBrains Mono", monospace`;
            ctx.fillText(ft.text, ft.x, ft.y);
            ctx.restore();
          }

          ctx.restore();
        }
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
      Matter.Events.off(engine, 'collisionStart', handleCollisions);
      Matter.Events.off(engine, 'collisionActive', handleCollisions);
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
    };
  }, [addPoints, createOrbBody, rollSpawnTier, spawnParticles]);

  // Convert pointer event coordinates to internal 420x620 canvas coordinates
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: BOX_WIDTH / 2, y: DROP_Y };
    const rect = canvas.getBoundingClientRect();
    const scaleX = BOX_WIDTH / rect.width;
    const scaleY = BOX_HEIGHT / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // Drop the currently held orb into the chamber
  const dropCurrentOrb = useCallback(
    (targetX: number) => {
      if (isGameOverRef.current || vaporizerModeRef.current) return;
      const now = performance.now();
      if (now - lastDropTimeRef.current < DROP_COOLDOWN_MS) return;

      const engine = engineRef.current;
      if (!engine) return;

      const tierToDrop = currentTierRef.current;
      const tierInfo = ORB_TIERS[tierToDrop - 1];
      const clampedX = Math.max(
        tierInfo.radius + 6,
        Math.min(BOX_WIDTH - tierInfo.radius - 6, targetX)
      );
      pointerXRef.current = clampedX;

      const newOrb = createOrbBody(clampedX, DROP_Y, tierToDrop, false);
      Matter.World.add(engine.world, newOrb);
      audio.playDrop();

      lastDropTimeRef.current = now;
      isCoolingDownRef.current = true;

      // Advance Next Orb -> Current Orb and roll a new Next Orb (Tiers 1-4)
      const upcoming = nextTierRef.current;
      const freshNext = rollSpawnTier();
      currentTierRef.current = upcoming;
      nextTierRef.current = freshNext;
      setCurrentTier(upcoming);
      setNextTier(freshNext);

      setTimeout(() => {
        isCoolingDownRef.current = false;
      }, DROP_COOLDOWN_MS);
    },
    [createOrbBody, rollSpawnTier]
  );

  // Handle Laser Vaporizer click on a target orb
  const tryVaporizeOrbAt = useCallback(
    (x: number, y: number) => {
      const engine = engineRef.current;
      if (!engine) return false;

      const bodies = Matter.Composite.allBodies(engine.world) as OrbBody[];
      for (const b of bodies) {
        if (!b.orbTier) continue;
        const tierInfo = ORB_TIERS[b.orbTier - 1];
        const dist = Math.hypot(b.position.x - x, b.position.y - y);
        if (dist <= tierInfo.radius + 8) {
          // Deduct cost or free charge
          if (freeVaporizeLeft > 0) {
            setFreeVaporizeLeft((prev) => prev - 1);
          } else if (scoreRef.current >= VAPORIZE_COST) {
            addPoints(-VAPORIZE_COST);
          } else {
            return false;
          }

          // Remove targeted orb and fire laser + particles
          Matter.World.remove(engine.world, b);
          audio.playVaporize();
          laserBeamsRef.current.push({
            x1: BOX_WIDTH / 2,
            y1: 0,
            x2: b.position.x,
            y2: b.position.y,
            color: '#ff006e',
            alpha: 1,
          });
          spawnParticles(b.position.x, b.position.y, tierInfo.color, 26);
          floatingTextsRef.current.push({
            x: b.position.x,
            y: b.position.y,
            vy: -1.5,
            text: 'VAPORIZED!',
            color: '#ff006e',
            alpha: 1,
            scale: 1.1,
          });

          vaporizerModeRef.current = false;
          setVaporizerMode(false);
          return true;
        }
      }
      return false;
    },
    [addPoints, freeVaporizeLeft, spawnParticles]
  );

  // Canvas Pointer Handlers (supports both desktop click & mobile drag-release)
  const isDraggingRef = useRef<boolean>(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isGameOverRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const coords = getCanvasCoords(e);

    if (vaporizerModeRef.current) {
      tryVaporizeOrbAt(coords.x, coords.y);
      return;
    }

    isDraggingRef.current = true;
    pointerXRef.current = coords.x;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isGameOverRef.current) return;
    const coords = getCanvasCoords(e);
    pointerXRef.current = coords.x;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isGameOverRef.current) return;
    if (vaporizerModeRef.current) return;
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const coords = getCanvasCoords(e);
    pointerXRef.current = coords.x;
    dropCurrentOrb(coords.x);
  };

  // Power-Up 1: Shake Box (Costs 100 pts or 1 Free use per game)
  const handleShakeBox = () => {
    if (isGameOver) return;
    const engine = engineRef.current;
    if (!engine) return;

    const canUseFree = freeShakeLeft > 0;
    const canAfford = scoreRef.current >= SHAKE_COST;
    if (!canUseFree && !canAfford) return;

    if (canUseFree) {
      setFreeShakeLeft((prev) => prev - 1);
    } else {
      addPoints(-SHAKE_COST);
    }

    // Cancel vaporizer targeting if active
    vaporizerModeRef.current = false;
    setVaporizerMode(false);

    audio.playShake();
    screenShakeRef.current = 14;

    const bodies = Matter.Composite.allBodies(engine.world) as OrbBody[];
    for (const b of bodies) {
      if (!b.orbTier) continue;
      // Refresh grace period briefly so shaking near top doesn't unfairly trigger instant Game Over
      b.spawnTime = Math.max(b.spawnTime ?? 0, performance.now() - 800);
      Matter.Body.setVelocity(b, {
        x: (Math.random() - 0.5) * 9.5,
        y: -5.5 - Math.random() * 4.5,
      });
      Matter.Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.25);
    }

    floatingTextsRef.current.push({
      x: BOX_WIDTH / 2,
      y: BOX_HEIGHT / 2,
      vy: -1.4,
      text: 'GRAVITY PULSE!',
      color: '#00f5d4',
      alpha: 1,
      scale: 1.2,
    });
  };

  // Power-Up 2: Laser Vaporizer (Costs 200 pts or 1 Free use per game)
  const handleToggleVaporizer = () => {
    if (isGameOver) return;
    if (vaporizerMode) {
      vaporizerModeRef.current = false;
      setVaporizerMode(false);
      return;
    }

    const canUseFree = freeVaporizeLeft > 0;
    const canAfford = scoreRef.current >= VAPORIZE_COST;
    if (!canUseFree && !canAfford) return;

    vaporizerModeRef.current = true;
    setVaporizerMode(true);
  };

  // Cleanly Reset Game World without reloading page
  const handleResetGame = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const allBodies = Matter.Composite.allBodies(engine.world) as OrbBody[];
    const orbsToRemove = allBodies.filter((b) => Boolean(b.orbTier));
    Matter.World.remove(engine.world, orbsToRemove);

    scoreRef.current = 0;
    setScore(0);
    setDisplayScore(0);
    setIsNewHighScore(false);
    setTotalMerges(0);
    setHighestTierReached(1);
    comboRef.current = 1;
    setComboCount(1);
    setFreeShakeLeft(1);
    setFreeVaporizeLeft(1);
    vaporizerModeRef.current = false;
    setVaporizerMode(false);
    dangerTimerMsRef.current = 0;
    lastAlarmSecRef.current = null;
    setDangerCountdown(null);
    isGameOverRef.current = false;
    setIsGameOver(false);
    setCopiedShare(false);

    particlesRef.current = [];
    shockwavesRef.current = [];
    floatingTextsRef.current = [];
    laserBeamsRef.current = [];

    const first = rollSpawnTier();
    const second = rollSpawnTier();
    currentTierRef.current = first;
    nextTierRef.current = second;
    setCurrentTier(first);
    setNextTier(second);
  }, [rollSpawnTier]);

  // Toggle Audio Mute
  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    audio.isMuted = nextMuted;
    setIsMuted(nextMuted);
  };

  // Copy Formatted Share Score to Clipboard
  const handleCopyShare = async () => {
    const shareText = `🪐 I scored ${score.toLocaleString()} in Cosmic Merge: Neon Orbs! (${totalMerges} merges · Highest Orb: ${ORB_TIERS[highestTierReached - 1]?.name}) Can you beat me?`;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    }
  };

  const canShake = freeShakeLeft > 0 || score >= SHAKE_COST;
  const canVaporize = freeVaporizeLeft > 0 || score >= VAPORIZE_COST;
  const nextOrbInfo = ORB_TIERS[nextTier - 1] || ORB_TIERS[0];
  const currentOrbInfo = ORB_TIERS[currentTier - 1] || ORB_TIERS[0];

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#0b0c10] text-slate-100 flex flex-col justify-between select-none">
      {/* Ambient Deep Space Radial Illumination */}
      <div
        className="pointer-events-none fixed inset-0 opacity-35"
        style={{
          background:
            'radial-gradient(circle at 50% 18%, rgba(0, 245, 212, 0.12), transparent 55%), radial-gradient(circle at 80% 80%, rgba(155, 93, 229, 0.12), transparent 50%)',
        }}
      />

      {/* ====================================================================
          TOP NAVIGATION & TELEMETRY BAR (3-Zone Contract)
         ==================================================================== */}
      <header className="relative z-20 flex items-center justify-between gap-4 px-4 py-2.5 sm:px-6 sm:py-3 border-b border-slate-800/80 bg-[#0b0c10]/80 backdrop-blur-md shrink-0">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <div
            className="w-3.5 h-3.5 rounded-full shrink-0"
            style={{
              background: 'radial-gradient(circle at 30% 30%, #ffffff, #00f5d4)',
              boxShadow: '0 0 12px #00f5d4',
            }}
          />
          <span className="font-display text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            Space Dust
          </span>
        </div>

        {/* Zone 2: Live Score & High Score Readout */}
        <div className="flex items-center gap-4 sm:gap-8 text-xs sm:text-sm">
          <div className="flex items-baseline gap-2 whitespace-nowrap shrink-0">
            <span className="text-slate-400 font-medium">Score</span>
            <span className="font-mono-num text-base sm:text-xl font-bold text-[#00f5d4]">
              {displayScore.toLocaleString()}
            </span>
          </div>

          <span className="text-slate-700" aria-hidden="true">
            ·
          </span>

          <div className="flex items-baseline gap-2 whitespace-nowrap shrink-0">
            <span className="text-slate-400 font-medium">Best</span>
            <span className="font-mono-num text-base sm:text-xl font-bold text-amber-400">
              {highScore.toLocaleString()}
            </span>
          </div>

          {comboCount > 1 && (
            <>
              <span className="hidden sm:inline text-slate-700" aria-hidden="true">
                ·
              </span>
              <span className="hidden sm:inline font-mono-num text-xs font-bold text-[#f15bb5] whitespace-nowrap shrink-0">
                {comboCount}x Combo Active
              </span>
            </>
          )}
        </div>

        {/* Zone 3: Primary Controls (Audio Mute, Rules, Reset) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowHelpModal(true)}
            className="p-2 rounded-lg border border-slate-800 bg-slate-900/70 text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
            title="How to Play"
            aria-label="How to Play"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button
            onClick={handleToggleMute}
            className="p-2 rounded-lg border border-slate-800 bg-slate-900/70 text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-rose-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-[#00f5d4]" />
            )}
          </button>
          <button
            onClick={handleResetGame}
            className="px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/70 text-xs font-semibold text-slate-200 hover:text-white hover:border-slate-700 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Restart</span>
          </button>
        </div>
      </header>

      {/* ====================================================================
          MAIN WORKSPACE (3-COLUMN DESKTOP / COMPACT VERTICAL MOBILE)
         ==================================================================== */}
      <main className="relative z-10 flex-1 min-h-0 w-full max-w-[1380px] mx-auto px-3 sm:px-6 py-2 flex flex-col lg:grid lg:grid-cols-12 gap-3 lg:gap-6 items-center justify-center">
        {/* LEFT COLUMN (Desktop Telemetry & Controls Guide) */}
        <aside className="hidden lg:flex lg:col-span-3 flex-col gap-4 w-full self-center">
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/45 backdrop-blur-md p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">
                Chamber Telemetry
              </span>
              <span className="font-mono-num text-xs text-slate-400">
                {totalMerges} Merges
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-800/70">
              <div>
                <div className="text-xs text-slate-400">Current Score</div>
                <div className="font-mono-num text-2xl font-bold text-white mt-0.5">
                  {displayScore.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">All-Time Best</div>
                <div className="font-mono-num text-2xl font-bold text-amber-400 mt-0.5">
                  {highScore.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs text-slate-300">
              <span>Highest Celestial Tier</span>
              <span
                className="font-semibold"
                style={{
                  color: ORB_TIERS[highestTierReached - 1]?.color,
                }}
              >
                T{highestTierReached} · {ORB_TIERS[highestTierReached - 1]?.name}
              </span>
            </div>

            <div className="pt-3 border-t border-slate-800/70 text-xs text-slate-400 leading-relaxed">
              Align the vertical laser and release to drop orbs. Colliding identical tiers fuse into the next celestial body. Chain merges within 2.5s for multiplied combo points.
            </div>
          </div>

          {/* Desktop Power-Ups Panel */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/45 backdrop-blur-md p-5 flex flex-col gap-3">
            <div className="text-xs font-semibold text-slate-400">
              Interactive Power-Ups
            </div>

            <button
              onClick={handleShakeBox}
              disabled={!canShake || isGameOver}
              className={`w-full py-2.5 px-4 rounded-xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                canShake && !isGameOver
                  ? 'border-[#00f5d4]/40 bg-[#00f5d4]/10 hover:bg-[#00f5d4]/20 text-white'
                  : 'border-slate-800 bg-slate-900/40 text-slate-500 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Zap className="w-4 h-4 text-[#00f5d4] shrink-0" />
                <div className="truncate">
                  <div className="text-sm font-semibold whitespace-nowrap">
                    Shake Box
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    Jolt stuck orbs upward
                  </div>
                </div>
              </div>
              <span className="font-mono-num text-xs font-semibold text-[#00f5d4] whitespace-nowrap shrink-0">
                {freeShakeLeft > 0 ? '1 FREE' : `${SHAKE_COST} pts`}
              </span>
            </button>

            <button
              onClick={handleToggleVaporizer}
              disabled={!canVaporize || isGameOver}
              className={`w-full py-2.5 px-4 rounded-xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                vaporizerMode
                  ? 'border-[#ff006e] bg-[#ff006e]/25 text-white shadow-[0_0_16px_rgba(255,0,110,0.35)]'
                  : canVaporize && !isGameOver
                  ? 'border-[#ff006e]/40 bg-[#ff006e]/10 hover:bg-[#ff006e]/20 text-white'
                  : 'border-slate-800 bg-slate-900/40 text-slate-500 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Crosshair className="w-4 h-4 text-[#ff006e] shrink-0" />
                <div className="truncate">
                  <div className="text-sm font-semibold whitespace-nowrap">
                    {vaporizerMode ? 'Cancel Target' : 'Laser Vaporizer'}
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    {vaporizerMode
                      ? 'Click any orb in box'
                      : 'Destroy 1 blocking orb'}
                  </div>
                </div>
              </div>
              <span className="font-mono-num text-xs font-semibold text-[#ff006e] whitespace-nowrap shrink-0">
                {freeVaporizeLeft > 0 ? '1 FREE' : `${VAPORIZE_COST} pts`}
              </span>
            </button>
          </div>
        </aside>

        {/* CENTER COLUMN: CONTAINMENT CHAMBER CANVAS */}
        <section
          ref={stageWrapperRef}
          className="lg:col-span-6 flex-1 min-h-0 w-full h-full flex items-center justify-center relative"
        >
          <div
            style={{
              width: `${BOX_WIDTH * chamberScale}px`,
              height: `${BOX_HEIGHT * chamberScale}px`,
            }}
            className="relative flex items-center justify-center"
          >
            <div
              style={{
                width: `${BOX_WIDTH}px`,
                height: `${BOX_HEIGHT}px`,
                transform: `scale(${chamberScale})`,
                transformOrigin: 'center center',
              }}
              className={`relative rounded-b-2xl border-x-2 border-b-2 transition-colors duration-200 bg-slate-950/75 backdrop-blur-md shadow-[0_0_40px_rgba(0,245,212,0.08)] overflow-hidden ${
                vaporizerMode
                  ? 'border-[#ff006e] shadow-[0_0_35px_rgba(255,0,110,0.28)]'
                  : dangerCountdown !== null
                  ? 'border-rose-500 shadow-[0_0_35px_rgba(244,63,94,0.35)]'
                  : 'border-[#00f5d4]/45'
              }`}
            >
              {/* Top Rim Corner Accents */}
              <div className="pointer-events-none absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#00f5d4]/60 via-transparent to-[#00f5d4]/60" />

              {/* Compact Current / Next Indicator Overlay inside Top-Right of Chamber for Mobile */}
              <div className="pointer-events-none absolute top-2.5 right-3 z-10 flex items-center gap-2 text-xs text-slate-300 bg-slate-900/75 border border-slate-800/90 rounded-lg px-2.5 py-1 backdrop-blur-sm">
                <span className="text-slate-400">Next:</span>
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: nextOrbInfo.color,
                    boxShadow: `0 0 8px ${nextOrbInfo.color}`,
                  }}
                />
                <span className="font-semibold text-white">
                  {nextOrbInfo.name}
                </span>
              </div>

              {/* Vaporizer Active Targeting Banner */}
              {vaporizerMode && (
                <div className="pointer-events-none absolute top-11 inset-x-6 z-20 rounded-lg bg-[#ff006e]/90 text-white px-3 py-1.5 text-center text-xs font-bold tracking-wide shadow-lg">
                  LASER TARGETING ACTIVE · TAP ANY ORB TO VAPORIZE
                </div>
              )}

              {/* Pulsing Danger Countdown Overlay (3... 2... 1...) */}
              {dangerCountdown !== null && !isGameOver && (
                <div className="pointer-events-none absolute inset-x-0 top-28 z-20 flex flex-col items-center justify-center animate-pulse-danger">
                  <div className="text-xs font-mono-num font-bold tracking-widest text-rose-400 bg-rose-950/90 border border-rose-500/60 px-3 py-1 rounded-md">
                    CONTAINMENT BREACH IN
                  </div>
                  <div
                    className="font-display text-6xl font-extrabold text-rose-500 mt-1"
                    style={{ textShadow: '0 0 24px rgba(244, 63, 94, 0.85)' }}
                  >
                    {dangerCountdown}...
                  </div>
                </div>
              )}

              {/* Interactive Physics Canvas */}
              <canvas
                ref={canvasRef}
                width={BOX_WIDTH}
                height={BOX_HEIGHT}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className={`block w-full h-full ${
                  vaporizerMode ? 'cursor-crosshair' : 'cursor-pointer'
                }`}
              />
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN (Next Orb Preview & 9-Tier Evolution Guide on Desktop) */}
        <aside className="hidden lg:flex lg:col-span-3 flex-col gap-4 w-full self-center">
          {/* Next Orb Preview Widget */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/45 backdrop-blur-md p-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-400">
                Next Orb Queue
              </div>
              <div className="text-lg font-bold text-white mt-1">
                {nextOrbInfo.name}
              </div>
              <div className="text-xs text-slate-400 mt-0.5 font-mono-num">
                Tier {nextOrbInfo.tier} · +{nextOrbInfo.points} pts
              </div>
              <div className="text-xs text-slate-400 mt-2">
                Dropping now:{' '}
                <span
                  className="font-semibold"
                  style={{ color: currentOrbInfo.color }}
                >
                  {currentOrbInfo.name}
                </span>
              </div>
            </div>
            <div className="w-20 h-20 rounded-xl border border-slate-800 bg-slate-950/80 flex items-center justify-center shrink-0">
              <canvas ref={nextOrbCanvasRef} width={76} height={76} />
            </div>
          </div>

          {/* 9-Tier Evolution Hierarchy List */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/45 backdrop-blur-md p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">
                9-Tier Orb Evolution
              </span>
              <span className="text-xs text-slate-400 font-mono-num">
                Radius & Points
              </span>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {ORB_TIERS.map((t) => {
                const isUnlocked = highestTierReached >= t.tier;
                return (
                  <div
                    key={t.tier}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                      isUnlocked
                        ? 'bg-slate-900/80 text-slate-100'
                        : 'bg-slate-950/40 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{
                          background: `radial-gradient(circle at 30% 30%, #ffffff, ${t.color})`,
                          boxShadow: `0 0 8px ${t.color}`,
                        }}
                      />
                      <span className="font-mono-num text-slate-400 w-4">
                        {t.tier}.
                      </span>
                      <span className="font-medium truncate">{t.name}</span>
                    </div>
                    <span className="font-mono-num text-xs text-slate-300 shrink-0">
                      +{t.points}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </main>

      {/* ====================================================================
          BOTTOM BAR (MOBILE POWER-UPS + UNIVERSAL 9-ORB EVOLUTION GUIDE BAR)
         ==================================================================== */}
      <footer className="relative z-20 border-t border-slate-800/80 bg-[#0b0c10]/90 backdrop-blur-md px-3 py-2 sm:px-6 sm:py-2.5 shrink-0">
        <div className="max-w-[1380px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5">
          {/* Compact Power-Up Buttons (Always accessible on Mobile/Tablet, mirrored on Desktop) */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
            <button
              onClick={handleShakeBox}
              disabled={!canShake || isGameOver}
              className={`flex-1 sm:flex-initial py-1.5 px-3.5 rounded-lg border text-xs font-semibold transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                canShake && !isGameOver
                  ? 'border-[#00f5d4]/45 bg-[#00f5d4]/10 hover:bg-[#00f5d4]/20 text-white'
                  : 'border-slate-800 bg-slate-900/50 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-[#00f5d4]" />
              <span>Shake Box</span>
              <span className="font-mono-num text-[#00f5d4]">
                ({freeShakeLeft > 0 ? 'Free' : `${SHAKE_COST}`})
              </span>
            </button>

            <button
              onClick={handleToggleVaporizer}
              disabled={!canVaporize || isGameOver}
              className={`flex-1 sm:flex-initial py-1.5 px-3.5 rounded-lg border text-xs font-semibold transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                vaporizerMode
                  ? 'border-[#ff006e] bg-[#ff006e]/25 text-white'
                  : canVaporize && !isGameOver
                  ? 'border-[#ff006e]/45 bg-[#ff006e]/10 hover:bg-[#ff006e]/20 text-white'
                  : 'border-slate-800 bg-slate-900/50 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5 text-[#ff006e]" />
              <span>{vaporizerMode ? 'Cancel Laser' : 'Laser Vaporizer'}</span>
              <span className="font-mono-num text-[#ff006e]">
                ({freeVaporizeLeft > 0 ? 'Free' : `${VAPORIZE_COST}`})
              </span>
            </button>
          </div>

          {/* 9-Tier Evolution Guide Bar (Smallest to Largest) */}
          <div className="flex items-center justify-center gap-1.5 sm:gap-2.5 overflow-x-auto max-w-full py-0.5">
            <span className="text-[11px] text-slate-400 font-medium hidden md:inline mr-1 whitespace-nowrap">
              Evolution Guide:
            </span>
            {ORB_TIERS.map((tier, idx) => {
              const dotSize = 10 + idx * 1.8;
              return (
                <div
                  key={tier.tier}
                  className="flex items-center gap-1 sm:gap-1.5 shrink-0"
                  title={`Tier ${tier.tier}: ${tier.name} (+${tier.points} pts)`}
                >
                  <div className="flex flex-col items-center">
                    <div
                      className="rounded-full transition-transform hover:scale-110"
                      style={{
                        width: `${dotSize}px`,
                        height: `${dotSize}px`,
                        background: `radial-gradient(circle at 30% 30%, #ffffff, ${tier.color})`,
                        boxShadow: `0 0 8px ${tier.color}`,
                      }}
                    />
                    <span className="text-[10px] text-slate-400 font-mono-num mt-0.5 hidden sm:inline">
                      {tier.name.split(' ')[0]}
                    </span>
                  </div>
                  {idx < ORB_TIERS.length - 1 && (
                    <span className="text-slate-700 text-[10px] select-none">
                      ›
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </footer>

      {/* ====================================================================
          HOW TO PLAY MODAL
         ==================================================================== */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#11131a] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="font-display text-lg font-bold text-white">
                How to Play Cosmic Merge
              </h2>
              <button
                onClick={() => setShowHelpModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 py-4 text-xs sm:text-sm text-slate-300 leading-relaxed">
              <p>
                <strong className="text-white">1. Drop & Align:</strong> Move your mouse or drag with your finger to aim the laser line, then click or release to drop the celestial orb.
              </p>
              <p>
                <strong className="text-white">2. Merge Identical Orbs:</strong> When two orbs of the exact same tier touch, they fuse into the next larger planet or star at their midpoint.
              </p>
              <p>
                <strong className="text-white">3. Chain Combos:</strong> Trigger multiple merges within 2.5 seconds to activate 2x, 3x, and 4x+ Cosmic Combo multipliers.
              </p>
              <p>
                <strong className="text-white">4. Supernova Climax:</strong> Merging two Tier 9 Supernova Suns unleashes a shockwave clearing nearby smaller orbs and awards +1,500 bonus points.
              </p>
              <p>
                <strong className="text-white">5. Watch the Danger Line:</strong> If settled orbs stay above the red dashed line for 3 continuous seconds, containment breaches and the game ends.
              </p>
            </div>

            <button
              onClick={() => setShowHelpModal(false)}
              className="w-full py-2.5 px-4 rounded-xl bg-[#00f5d4] text-slate-950 font-bold text-sm hover:brightness-110 transition-all cursor-pointer"
            >
              Got It, Back to Game
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          GAME OVER MODAL
         ==================================================================== */}
      {isGameOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#11131a]/95 p-6 shadow-[0_0_50px_rgba(255,0,110,0.25)] flex flex-col gap-5 text-center">
            <div>
              {isNewHighScore && (
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 mb-2">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span>NEW ALL-TIME HIGH SCORE!</span>
                </div>
              )}
              <h2 className="font-display text-3xl font-extrabold text-white tracking-tight">
                Containment Breached
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                The chamber reached critical celestial density
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 py-4 px-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
              <div>
                <div className="text-xs text-slate-400">Final Score</div>
                <div className="font-mono-num text-xl font-bold text-[#00f5d4] mt-0.5">
                  {score.toLocaleString()}
                </div>
              </div>
              <div className="border-x border-slate-800">
                <div className="text-xs text-slate-400">Best Score</div>
                <div className="font-mono-num text-xl font-bold text-amber-400 mt-0.5">
                  {highScore.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Total Merges</div>
                <div className="font-mono-num text-xl font-bold text-white mt-0.5">
                  {totalMerges}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-slate-300">
              <Sparkles className="w-4 h-4 text-[#f15bb5]" />
              <span>Highest Celestial Body Reached:</span>
              <span
                className="font-bold"
                style={{ color: ORB_TIERS[highestTierReached - 1]?.color }}
              >
                {ORB_TIERS[highestTierReached - 1]?.name} (Tier {highestTierReached})
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                onClick={handleCopyShare}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                {copiedShare ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400">Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4 text-[#00bbf9]" />
                    <span>Copy Score to Share</span>
                  </>
                )}
              </button>

              <button
                onClick={handleResetGame}
                className="flex-1 py-2.5 px-4 rounded-xl bg-[#00f5d4] hover:brightness-110 text-slate-950 font-bold text-sm transition-all flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Play Again</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
