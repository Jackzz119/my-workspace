// rig-core.ts — engine-agnostic runtime for a marionette character rig.
//
// Everything here is plain math on typed arrays and timestamps: no renderer, no DOM, no clock of
// its own (the caller passes `nowMs`), no randomness of its own (the caller passes `random`), so a
// test can replay any sequence exactly. An engine adapter (rig-pixi.ts, or your own) owns the
// meshes and applies what this computes:
//
//   deformVertices  idle breath / lean / hair sway, plus a morph shift and a gesture, into a mesh
//   createSwitcher  which poses are visible at what opacity, and which ones are mid-morph
//   partFrame       where a scene part the character picks up is this frame (the mug), and how opaque
//   createBlinker   when the current pose shows its closed-eye frame
//   createGesturePlayer  short computed body motions (a flinch, a laugh) on top of the idle
//
// The files it reads are written by the pipeline's export stage (rig.json + data PNGs).

/** The export stage's manifest (rig.json). */
export type RigManifest = {
    version: 2;
    canvas: { w: number; h: number };
    /** Canvas px between mesh vertices: the mesh is (w / grid + 1) x (h / grid + 1) vertices. */
    grid: number;
    flowFormat: 'rgb12';
    anchor: string;
    poses: Record<
        string,
        {
            open: string;
            closed?: string;
            idle?: string;
            slow: boolean;
            /** Scene parts this pose stands in for while it shows (the mug is in his hand, not on the table). */
            hides?: string[];
            /**
             * Scene parts this pose draws in the hand, and how far from their own place, canvas px (measured
             * by the pipeline): the scene's part rides along while a morph runs into or out of this pose.
             */
            holds?: Record<string, [number, number]>;
        }
    >;
    /** Keyframe chains (rig-director Sequence): each neighbouring pair of `frames` has morph fields. */
    sequences?: Record<string, { frames: string[]; stepMs: number; holdMs?: number; back?: boolean }>;
    /** Flow fields keyed `from-to`; both directions of a pair are always present together. */
    morphs: Record<string, string>;
    /** The pairs whose field was guided by region boxes, not measured: they swap in the narrow window. */
    guided?: string[];
    /** Where the canvas sits in the scene frame it was registered onto, if any. */
    placement?: { origin: [number, number]; scale: number };
};

/** Per-vertex motion weights, 0..1, row by row. */
export type WeightMap = { cols: number; rows: number; breath: Float32Array; hair: Float32Array };

/** Per-vertex flow: where each vertex's content sits in the other pose, canvas px. */
export type FlowField = { dx: Float32Array; dy: Float32Array };

/** Vertex grid size for a canvas, matching the pipeline's sampling. */
export const gridSize = (m: Pick<RigManifest, 'canvas' | 'grid'>) => ({
    cols: Math.floor(m.canvas.w / m.grid) + 1,
    rows: Math.floor(m.canvas.h / m.grid) + 1
});

/** Decode an idle weight map from its RGBA bytes (R = breath, G = hair). */
export function decodeWeights(px: Uint8ClampedArray, cols: number, rows: number): WeightMap {
    const breath = new Float32Array(cols * rows);
    const hair = new Float32Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) {
        breath[i] = px[i * 4] / 255;
        hair[i] = px[i * 4 + 1] / 255;
    }
    return { cols, rows, breath, hair };
}

/** Decode a flow field from its RGBA bytes: dx, dy as 12 bits each at 1/8 px (pipeline pack_flow). */
export function decodeFlow(px: Uint8ClampedArray, cols: number, rows: number): FlowField {
    const dx = new Float32Array(cols * rows);
    const dy = new Float32Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) {
        const r = px[i * 4];
        const g = px[i * 4 + 1];
        const b = px[i * 4 + 2];
        dx[i] = (((r << 4) | (g >> 4)) - 2048) / 8;
        dy[i] = ((((g & 15) << 8) | b) - 2048) / 8;
    }
    return { dx, dy };
}

/* ---------------------------------------------------------------- idle motion */

/** Idle motion, in canvas px, radians and seconds. Tune per character, keep it subtle. */
export type Motion = {
    breathPx: number;
    breathS: number;
    leanRad: number;
    leanS: number;
    hairPx: number;
    /** Three incommensurate periods, so the sway never visibly repeats. */
    hairS: [number, number, number];
    /** Canvas y the upper body leans about (the seat / the torso cut). */
    pivotY: number;
};

export const DEFAULT_MOTION: Omit<Motion, 'pivotY'> = {
    breathPx: 3.2,
    breathS: 3.6,
    leanRad: 0.004,
    leanS: 7.4,
    hairPx: 4.5,
    hairS: [4.2, 2.3, 3.1]
};

const TAU = Math.PI * 2;

/**
 * A gesture's offsets at one moment, added on top of the idle motion. The weight maps decide who
 * carries them: the body terms ride the breath weight (shoulders and head move, hands resting on the
 * table stay), the hair terms ride the hair weight.
 */
export type Pulse = {
    /** Body lift, canvas px, + = up. */
    lift: number;
    /** Upper-body lean about pivotY, radians. */
    lean: number;
    /** Extra sideways hair offset, px. */
    hairX: number;
    /** How far the hair trails below the body, px: the hair lags a moving body, so it bounces. */
    hairLag: number;
};

export const REST_PULSE: Pulse = { lift: 0, lean: 0, hairX: 0, hairLag: 0 };

/**
 * Write one moment of a pose's mesh into `out` (x, y interleaved, same layout as `rest`).
 * Breath lifts along -y by the breath weight; the lean turns the weighted upper body about pivotY;
 * hair drifts sideways by the hair weight with its phase running down the hair, so the tips follow
 * the roots. `shift` * `amount` adds a morph on top, so idle motion never stops during a transition;
 * `pulse` adds a gesture on top of both.
 */
export function deformVertices(
    rest: Float32Array,
    out: Float32Array,
    w: WeightMap,
    t: number,
    m: Motion,
    shift: FlowField | null = null,
    amount = 0,
    pulse: Pulse = REST_PULSE
): void {
    const lift = -m.breathPx * 0.5 * (1 + Math.sin((t / m.breathS) * TAU)) - pulse.lift;
    const lean = m.leanRad * Math.sin((t / m.leanS) * TAU) + pulse.lean;
    const a1 = (t / m.hairS[0]) * TAU;
    const a2 = (t / m.hairS[1]) * TAU + 1.3;
    const a3 = (t / m.hairS[2]) * TAU + 0.6;
    for (let i = 0, n = w.cols * w.rows; i < n; i++) {
        const x = rest[i * 2];
        const y = rest[i * 2 + 1];
        const b = w.breath[i];
        const h = w.hair[i];
        let dx = lean * (m.pivotY - y) * b;
        let dy = lift * b;
        if (h > 0.01) {
            dx += m.hairPx * h * (0.65 * Math.sin(a1 + y * 0.011) + 0.35 * Math.sin(a2 + y * 0.017));
            dy += m.hairPx * 0.25 * h * Math.sin(a3 + y * 0.013);
            dx += pulse.hairX * h;
            dy += pulse.hairLag * h;
        }
        if (shift) {
            dx += shift.dx[i] * amount;
            dy += shift.dy[i] * amount;
        }
        out[i * 2] = x + dx;
        out[i * 2 + 1] = y + dy;
    }
}

/* ---------------------------------------------------------------- pose switching */

export type Timing = {
    /** A morph between two poses with flow fields. */
    morphMs: number;
    /**
     * A morph into or out of a pose marked `slow` (the head going down onto the arms): the shapes
     * travel longer and the pictures swap in a shorter middle window, so the two never sit on top of
     * each other half-seen for long.
     */
    slowMorphMs: number;
    /** Cover-and-fade: the incoming pose fades in above the (still opaque) outgoing one... */
    crossfadeMs: number;
    /** ...which then fades out once covered. */
    handoverMs: number;
    /** The same two steps for poses marked `slow` (falling asleep reads as dozing off). */
    slowCrossfadeMs: number;
    slowHandoverMs: number;
};

export const DEFAULT_TIMING: Timing = {
    morphMs: 420,
    slowMorphMs: 900,
    crossfadeMs: 180,
    handoverMs: 120,
    slowCrossfadeMs: 400,
    slowHandoverMs: 300
};

/**
 * How one pose change is animated: its length and easing. A keyframe chain eases in on its first step,
 * runs linear through the middle and eases out on the last, so the steps move as one gesture; a lone
 * change eases in and out. `window` overrides when the pictures swap (see SwapWindow): a chain whose
 * steps bring in something the field cannot bend (a mouth opening) swaps wide. (rig-director.ts hands
 * these out; the shape is the same there.)
 */
export type Ease = 'inOut' | 'in' | 'out' | 'linear';
export type Transition = { ms: number; ease: Ease; window?: SwapWindow };

// in and out leave / arrive at the speed of linear (derivative 1), so they join a linear middle smoothly
const EASE: Record<Ease, (t: number) => number> = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    in: (t) => t * t * (2 - t),
    out: (t) => 1 - (1 - t) * (1 - t) * (1 + t),
    linear: (t) => t
};

/** One visible pose this frame: its opacity, and the morph field bending it, if any. */
export type PoseFrame = { alpha: number; shift: { field: string; amount: number } | null };

/** The morph a frame drew: its two poses, raw progress `t` and eased progress `e`, both 0..1. */
export type MorphProgress = { from: string; to: string; t: number; e: number };

export type Switcher = {
    /**
     * Change to `pose` (null = nobody there). The adapter must draw `pose` above the others. With a
     * `transition`, a morph takes its length and easing (a keyframe step); without, the defaults.
     */
    show: (pose: string | null, nowMs: number, animate: boolean, transition?: Transition | null) => void;
    /** Opacity and morph per pose at `nowMs`; poses not listed are invisible. */
    frame: (nowMs: number) => Map<string, PoseFrame>;
    /** True while a morph runs: hold the blink until it lands. */
    morphing: () => boolean;
    /** The morph the last `frame()` drew, or null (a scene part carried by a hand follows it). */
    progress: () => MorphProgress | null;
    current: () => string | null;
};

const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

type Tween = { from: number; to: number; start: number; ms: number };

/**
 * The progress window in which the incoming pose appears during a morph (the pipeline simulates the
 * same): wide for a lone change, narrow for slow poses and guided pairs, whose shapes only roughly
 * meet, and quick for a keyframe step: the steps are short and many, the mesh carries the motion,
 * and whatever the field could not bend (a mug carried across the chest) shows twice only as long as
 * the pictures take to swap. A step that brings in something new where nothing moves (a mouth
 * opening, the head still) has no motion to carry it, and a quick swap pops it in: such a chain asks
 * for wide (Transition.window).
 */
export type SwapWindow = 'wide' | 'narrow' | 'step';
const SWAP: Record<SwapWindow, [number, number]> = { wide: [0.25, 0.75], narrow: [0.35, 0.65], step: [0.42, 0.58] };
export const morphSwap = (window: SwapWindow): [number, number] => SWAP[window];

/**
 * Pose switching without a see-through moment. Two rules carry it:
 *  1. Never two poses half-transparent at once: the scene would show through the figure (reads as a
 *     flicker). The outgoing pose stays opaque until the incoming one covers it.
 *  2. Morph where the pipeline found a trustworthy flow, so silhouettes meet instead of dissolving.
 */
export function createSwitcher(opts: {
    morphs: Pick<RigManifest, 'morphs'>['morphs'];
    slow: (pose: string) => boolean;
    /** Pairs that swap their pictures in the narrow window (the manifest's `guided`). */
    narrow?: (from: string, to: string) => boolean;
    timing?: Partial<Timing>;
}): Switcher {
    const T = { ...DEFAULT_TIMING, ...opts.timing };
    const alpha = new Map<string, number>();
    const tweens = new Map<string, Tween>();
    let handovers: { pose: string; at: number; ms: number }[] = [];
    let morph: { from: string; to: string; start: number; ms: number; ease: Ease; window: SwapWindow } | null = null;
    let drawn: MorphProgress | null = null;
    let current: string | null = null;

    const tween = (pose: string, to: number, now: number, ms: number) => {
        const from = valueAt(pose, now);
        if (ms <= 0 || from === to) {
            tweens.delete(pose);
            alpha.set(pose, to);
        } else tweens.set(pose, { from, to, start: now, ms });
    };
    const valueAt = (pose: string, now: number) => {
        const tw = tweens.get(pose);
        if (!tw) return alpha.get(pose) ?? 0;
        const k = Math.min(1, (now - tw.start) / tw.ms);
        return tw.from + (tw.to - tw.from) * k;
    };
    const land = () => {
        if (!morph) return;
        alpha.set(morph.from, 0);
        alpha.set(morph.to, 1);
        morph = null;
    };

    return {
        show(pose, now, animate, transition) {
            if (pose === current) return;
            // a new change lands the running morph first; half-bent meshes never stack
            land();
            const from = current;
            const slow = (from !== null && opts.slow(from)) || (pose !== null && opts.slow(pose));
            // coming back before a hand-over finished: that pose simply fades up again
            handovers = handovers.filter((h) => h.pose !== pose);
            if (animate && from && pose && opts.morphs[`${from}-${pose}`] && opts.morphs[`${pose}-${from}`]) {
                tweens.delete(from);
                tweens.delete(pose);
                alpha.set(from, 1);
                alpha.set(pose, 0);
                morph = {
                    from,
                    to: pose,
                    start: now,
                    ms: transition?.ms ?? (slow ? T.slowMorphMs : T.morphMs),
                    ease: transition?.ease ?? 'inOut',
                    window:
                        transition?.window ??
                        (slow || (opts.narrow?.(from, pose) ?? false) ? 'narrow' : transition ? 'step' : 'wide')
                };
            } else {
                if (pose) tween(pose, 1, now, animate ? (slow ? T.slowCrossfadeMs : T.crossfadeMs) : 0);
                if (from) {
                    if (!animate) tween(from, 0, now, 0);
                    else if (pose)
                        handovers.push({
                            pose: from,
                            at: now + (slow ? T.slowCrossfadeMs : T.crossfadeMs),
                            ms: slow ? T.slowHandoverMs : T.handoverMs
                        });
                    else tween(from, 0, now, T.crossfadeMs);
                }
            }
            current = pose;
        },
        frame(now) {
            handovers = handovers.filter((h) => {
                if (now < h.at) return true;
                tween(h.pose, 0, now, h.ms);
                return false;
            });
            const out = new Map<string, PoseFrame>();
            for (const [pose, tw] of tweens) {
                if (now >= tw.start + tw.ms) {
                    alpha.set(pose, tw.to);
                    tweens.delete(pose);
                }
            }
            drawn = null;
            if (morph) {
                const t = (now - morph.start) / morph.ms;
                if (t >= 1) land();
                else {
                    const e = EASE[morph.ease](t);
                    drawn = { from: morph.from, to: morph.to, t, e };
                    const [swapIn, swapOut] = morphSwap(morph.window);
                    // shapes travel the whole way; the pictures swap only in the middle, and whatever
                    // the field could not bend into the new silhouette leaves once it is covered
                    out.set(morph.from, {
                        alpha: 1 - smoothstep(swapOut + 0.05, 1, t),
                        shift: { field: `${morph.from}-${morph.to}`, amount: e }
                    });
                    out.set(morph.to, {
                        alpha: smoothstep(swapIn, swapOut, t),
                        shift: { field: `${morph.to}-${morph.from}`, amount: 1 - e }
                    });
                }
            }
            for (const pose of new Set([...alpha.keys(), ...tweens.keys()])) {
                if (out.has(pose)) continue;
                const a = valueAt(pose, now);
                if (a > 0) out.set(pose, { alpha: a, shift: null });
            }
            return out;
        },
        morphing: () => morph !== null,
        progress: () => drawn,
        current: () => current
    };
}

/* ---------------------------------------------------------------- scene parts in the hand */

/** A scene part this frame: its opacity, and how far a hand has carried it from its place, canvas px. */
export type PartFrame = { alpha: number; dx: number; dy: number };

/**
 * Scene part `name` (the mug on the table) this frame, from the manifest's `hides` and `holds`.
 * A pose that only hides the part cross-fades with it: the part fades as the pose appears. A pose that
 * also holds it draws the part in the hand where the pipeline measured it, so during a morph into or
 * out of that pose the scene's part rides along the hold, opaque and in front of the figure, and only
 * leaves once the pose has arrived: the painted part and the drawn one lie on top of each other while
 * the pictures swap, and a hand-off never shows two mugs. A pose that holds without hiding (the hand
 * closing on the mug) nudges the part onto the drawn one and keeps showing it.
 */
export function partFrame(
    poses: RigManifest['poses'],
    frame: Map<string, PoseFrame>,
    progress: MorphProgress | null,
    current: string | null,
    name: string
): PartFrame {
    const hides = (id: string | null) => (id ? (poses[id]?.hides?.includes(name) ?? false) : false);
    const held = (id: string | null): [number, number] | undefined => (id ? poses[id]?.holds?.[name] : undefined);
    const still: [number, number] = [0, 0];
    if (progress) {
        const { from, to, t, e } = progress;
        const [fx, fy] = held(from) ?? still;
        const [tx, ty] = held(to) ?? still;
        const at = { dx: fx + (tx - fx) * e, dy: fy + (ty - fy) * e };
        const taken = hides(to) && !hides(from);
        const putBack = hides(from) && !hides(to);
        if (!taken && !putBack) return { alpha: hides(to) ? 0 : 1, ...at };
        // carried: gone only in the last stretch of the way in, back in the first stretch of the way out
        if (held(taken ? to : from))
            return { alpha: taken ? 1 - smoothstep(0.85, 1, t) : smoothstep(0, 0.15, t), ...at };
    }
    let covered = 0;
    for (const [id, f] of frame) if (hides(id)) covered = Math.max(covered, f.alpha);
    const [dx, dy] = (hides(current) ? undefined : held(current)) ?? still;
    return { alpha: 1 - covered, dx, dy };
}

/* ---------------------------------------------------------------- blinking */

export type BlinkTiming = { closeMs: number; gapMs: [number, number]; doubleChance: number; doubleGapMs: number };
export const DEFAULT_BLINK: BlinkTiming = { closeMs: 140, gapMs: [2400, 6500], doubleChance: 0.15, doubleGapMs: 180 };

export type Blinker = {
    /** Restart the rhythm (after a pose change). */
    reset: (nowMs: number) => void;
    /** Whether the closed-eye frame shows at `nowMs`. */
    closed: (nowMs: number) => boolean;
};

export function createBlinker(random: () => number, nowMs: number, timing: Partial<BlinkTiming> = {}): Blinker {
    const B = { ...DEFAULT_BLINK, ...timing };
    const gap = () => B.gapMs[0] + random() * (B.gapMs[1] - B.gapMs[0]);
    let next = nowMs + gap() * 0.6;
    let until = 0;
    let again = false;
    return {
        reset(now) {
            until = 0;
            again = false;
            next = now + gap();
        },
        closed(now) {
            if (until > 0 && now >= until) {
                until = 0;
                next = now + (again ? B.doubleGapMs : gap());
                again = false;
            } else if (until === 0 && now >= next) {
                until = now + B.closeMs;
                again = random() < B.doubleChance;
            }
            return until > 0;
        }
    };
}

/* ---------------------------------------------------------------- gestures */

/** A short computed motion: offsets as a function of ms since it started, over by `ms`. */
export type Gesture = { ms: number; at: (ms: number) => Pulse };

// rises fast to 1 at `peak` ms, then dies away with time constant `decay`
const spike = (t: number, peak: number, decay: number) =>
    t <= 0 ? 0 : t < peak ? 1 - (1 - t / peak) ** 2 : Math.exp(-(t - peak) / decay);

/** A gesture from its body curves; the hair trails the body by `lagMs`, and it all fades out at the end. */
function withTrailingHair(ms: number, body: (t: number) => Omit<Pulse, 'hairLag'>, lagMs = 70): Gesture {
    return {
        ms,
        at(t) {
            const now = body(t);
            const before = body(t - lagMs);
            const k = 1 - smoothstep(ms - 200, ms, t);
            return {
                lift: now.lift * k,
                lean: now.lean * k,
                hairX: now.hairX * k,
                hairLag: (now.lift - before.lift) * k
            };
        }
    };
}

/**
 * Stock gestures, sized for a half-body figure about 1000 canvas px tall; scale them for yours.
 * They are what makes a reaction more than a picture swap: the pose changes the face, the gesture
 * gives the body a moment of physics.
 */
export const GESTURES = {
    /** Poked: a startled little jump, then the shoulders shake with a laugh. */
    flinchLaugh: withTrailingHair(1300, (t) => {
        const laugh = t < 220 ? 0 : smoothstep(220, 300, t) * Math.exp(-(t - 220) / 520);
        // "ha-ha" at about 4.5 a second
        const beat = Math.abs(Math.sin((Math.PI * (t - 220)) / 220));
        return {
            lift: 9 * spike(t, 80, 200) + 4.5 * laugh * beat,
            lean: 0.014 * spike(t, 80, 260) + 0.004 * laugh * Math.sin((TAU * (t - 220)) / 440),
            hairX: 3.5 * spike(t - 40, 90, 220) + 3.5 * laugh * Math.sin((TAU * (t - 260)) / 220)
        };
    }),
    /** A small start: the jump alone, no laugh. */
    startle: withTrailingHair(600, (t) => ({
        lift: 6 * spike(t, 80, 160),
        lean: 0.008 * spike(t, 80, 200),
        hairX: 2.5 * spike(t - 40, 90, 180)
    }))
} satisfies Record<string, Gesture>;

export type GesturePlayer = {
    /** Start `g` now; a gesture already running is replaced. */
    play: (g: Gesture, nowMs: number) => void;
    /** The running gesture's offsets, or REST_PULSE. */
    sample: (nowMs: number) => Pulse;
};

export function createGesturePlayer(): GesturePlayer {
    let running: { g: Gesture; start: number } | null = null;
    return {
        play(g, now) {
            running = { g, start: now };
        },
        sample(now) {
            if (!running) return REST_PULSE;
            const t = now - running.start;
            if (t >= running.g.ms) {
                running = null;
                return REST_PULSE;
            }
            return running.g.at(t);
        }
    };
}
