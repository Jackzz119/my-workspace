// rig-pixi.ts — PixiJS v8 adapter for rig-core: one MeshPlane per pose on the shared canvas.
//
// Everything that decides (opacity, morph, blink, motion) lives in rig-core.ts; this file only loads
// the files and pushes the numbers into meshes. For another engine, rewrite this file and keep the
// core: the mesh must be an evenly spaced grid of gridSize() vertices over the whole canvas, with
// x, y positions you can overwrite every frame.
//
// Before the first pose change, upload every texture to the GPU (pixi.js/prepare): a texture that
// uploads on first use stalls the frame it appears in, which reads as the character vanishing.

import { Assets, Container, MeshPlane, type Texture } from 'pixi.js';
import {
    createBlinker,
    createGesturePlayer,
    createSwitcher,
    decodeFlow,
    decodeWeights,
    deformVertices,
    DEFAULT_MOTION,
    partFrame,
    type BlinkTiming,
    type FlowField,
    type Gesture,
    gridSize,
    type Motion,
    type PartFrame,
    type PoseFrame,
    type RigManifest,
    type Timing,
    type Transition,
    type WeightMap
} from './rig-core';

export type LoadedRig = {
    manifest: RigManifest;
    textures: Record<string, Texture>;
    weights: Record<string, WeightMap>;
    flows: Record<string, FlowField>;
};

/** Decode a small data PNG into its RGBA bytes (never let a loader resample or premultiply it). */
async function readPixels(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob(), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none'
    });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('rig data: no 2d canvas');
    g.drawImage(bitmap, 0, 0);
    return { w: bitmap.width, h: bitmap.height, px: g.getImageData(0, 0, bitmap.width, bitmap.height).data };
}

/** Load a rig from its manifest. A morph field that fails to load only costs that pair its morph. */
export async function loadRig(manifestUrl: string): Promise<LoadedRig> {
    const response = await fetch(manifestUrl);
    if (!response.ok) throw new Error(`${manifestUrl}: ${response.status}`);
    const manifest = (await response.json()) as RigManifest;
    if (manifest.version !== 2 || manifest.flowFormat !== 'rgb12')
        throw new Error(`${manifestUrl}: unsupported rig manifest`);
    const { cols, rows } = gridSize(manifest);
    const frames = Object.values(manifest.poses).flatMap((p) => (p.closed ? [p.open, p.closed] : [p.open]));
    const [textures, weightList, flowList] = await Promise.all([
        Assets.load<Texture>(frames),
        Promise.all(
            Object.entries(manifest.poses)
                .filter(([, p]) => p.idle)
                .map(async ([id, p]) => {
                    const { w, h, px } = await readPixels(p.idle as string);
                    if (w !== cols || h !== rows) throw new Error(`${p.idle}: ${w}x${h}, expected ${cols}x${rows}`);
                    return [id, decodeWeights(px, cols, rows)] as const;
                })
        ),
        Promise.all(
            Object.entries(manifest.morphs).map(async ([key, url]) => {
                try {
                    const { px } = await readPixels(url);
                    return [key, decodeFlow(px, cols, rows)] as const;
                } catch {
                    return null;
                }
            })
        )
    ]);
    const flows = Object.fromEntries(flowList.filter((f) => f !== null));
    // a pair needs both directions; drop the orphan of a half-loaded pair
    for (const key of Object.keys(flows)) {
        const [a, b] = key.split('-');
        if (!flows[`${b}-${a}`]) delete flows[key];
    }
    return { manifest, textures, weights: Object.fromEntries(weightList), flows };
}

export type RigView = {
    /** Pose meshes in canvas px; place and scale this container (manifest.placement if registered). */
    container: Container;
    /** Every texture, for renderer.prepare.upload before the first pose change. */
    textures: Texture[];
    /** Change pose; `transition` is the director's step (a keyframe chain), null for the default morph. */
    show: (pose: string | null, animate: boolean, transition?: Transition | null) => void;
    /**
     * Scene part `name` this frame (manifest `hides` / `holds`): draw it at `alpha`, moved from its place
     * by (dx, dy) canvas px times this container's scale, so the mug leaves the table exactly as it
     * appears in the hand and rides along with the hand while the two swap.
     */
    part: (name: string) => PartFrame;
    /** Play a computed body motion on top of the idle (GESTURES.flinchLaugh on a poke). */
    gesture: (g: Gesture) => void;
    /** Call every frame; `elapsedS` drives the idle loops. */
    update: (elapsedS: number) => void;
    /** Scene light on the character, as a multiply tint. */
    setTint: (tint: number) => void;
    current: () => string | null;
};

export function createRigView(
    rig: LoadedRig,
    random: () => number,
    opts: {
        motion?: Partial<Motion>;
        timing?: Partial<Timing>;
        blink?: Partial<BlinkTiming>;
        /** prefers-reduced-motion: no idle motion, pose changes cut; blinking stays. */
        reducedMotion?: boolean;
    } = {}
): RigView {
    const { manifest } = rig;
    const still = opts.reducedMotion ? { breathPx: 0, leanRad: 0, hairPx: 0 } : {};
    const motion: Motion = { ...DEFAULT_MOTION, pivotY: manifest.canvas.h, ...opts.motion, ...still };
    const { cols, rows } = gridSize(manifest);
    const container = new Container();
    // a pose without a weight map still morphs; it just has no idle motion of its own
    const noWeights: WeightMap = {
        cols,
        rows,
        breath: new Float32Array(cols * rows),
        hair: new Float32Array(cols * rows)
    };
    const meshes = new Map<
        string,
        { mesh: MeshPlane; open: Texture; closed: Texture | null; rest: Float32Array; weights: WeightMap | null }
    >();
    for (const [id, p] of Object.entries(manifest.poses)) {
        const weights = rig.weights[id] ?? null;
        const mesh = new MeshPlane({ texture: rig.textures[p.open], verticesX: cols, verticesY: rows });
        // blinks swap the texture on a canvas of the same size; the grid must stay put
        mesh.autoResize = false;
        mesh.alpha = 0;
        container.addChild(mesh);
        meshes.set(id, {
            mesh,
            open: rig.textures[p.open],
            closed: p.closed ? rig.textures[p.closed] : null,
            rest: Float32Array.from(mesh.geometry.positions),
            weights
        });
    }
    const available = Object.fromEntries(Object.keys(rig.flows).map((k) => [k, k]));
    const switcher = createSwitcher({
        morphs: available,
        slow: (p) => manifest.poses[p]?.slow ?? false,
        narrow: (a, b) => manifest.guided?.includes(`${a}-${b}`) ?? false,
        timing: opts.timing
    });
    const blinker = createBlinker(random, performance.now(), opts.blink);
    const gestures = createGesturePlayer();
    let drawn = new Map<string, PoseFrame>();

    return {
        container,
        textures: [...meshes.values()].flatMap((m) => (m.closed ? [m.open, m.closed] : [m.open])),
        show(pose, animate, transition) {
            const now = performance.now();
            switcher.show(pose, now, animate && !opts.reducedMotion, transition);
            const m = pose ? meshes.get(pose) : undefined;
            if (m) container.setChildIndex(m.mesh, container.children.length - 1);
            blinker.reset(now);
        },
        gesture(g) {
            if (!opts.reducedMotion) gestures.play(g, performance.now());
        },
        update(elapsedS) {
            const now = performance.now();
            const frame = switcher.frame(now);
            drawn = frame;
            const blinkClosed = !switcher.morphing() && blinker.closed(now);
            const pulse = gestures.sample(now);
            for (const [id, m] of meshes) {
                const f = frame.get(id);
                m.mesh.alpha = f?.alpha ?? 0;
                if (!f) continue;
                m.mesh.texture = id === switcher.current() && blinkClosed && m.closed ? m.closed : m.open;
                if (!m.weights && !f.shift) continue;
                const shift = f.shift ? (rig.flows[f.shift.field] ?? null) : null;
                deformVertices(
                    m.rest,
                    m.mesh.geometry.positions,
                    m.weights ?? noWeights,
                    elapsedS,
                    motion,
                    shift,
                    f.shift?.amount ?? 0,
                    pulse
                );
                m.mesh.geometry.getBuffer('aPosition').update();
            }
        },
        setTint(tint) {
            for (const m of meshes.values()) m.mesh.tint = tint;
        },
        part: (name) => partFrame(manifest.poses, drawn, switcher.progress(), switcher.current(), name),
        current: () => switcher.current()
    };
}
