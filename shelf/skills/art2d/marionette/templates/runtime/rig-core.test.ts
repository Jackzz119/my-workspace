// rig-core.test.ts — behaviour checks for rig-core and rig-director, no test framework needed:
//   node rig-core.test.ts            (Node >= 22.18 runs TypeScript directly)
// Port the cases into the project's test runner when copying the templates.
//
// The one that matters most is the see-through check: while the top pose is not opaque, some pose
// under it must be. Breaking it is what makes a character flicker on a pose change.

import {
    createBlinker,
    createGesturePlayer,
    createSwitcher,
    decodeFlow,
    GESTURES,
    partFrame,
    REST_PULSE
} from './rig-core.ts';
import { createDirector } from './rig-director.ts';

let failures = 0;
const ok = (cond: boolean, msg: string) => {
    if (!cond) {
        failures++;
        console.log('FAIL', msg);
    }
};

// flow decoding mirrors the pipeline's pack_flow (scripts/common.py)
{
    const pack = (d: number) => Math.min(4095, Math.max(0, Math.round(d * 8) + 2048));
    const samples: [number, number][] = [
        [0, 0],
        [-127.5, 3.25],
        [200.125, -255.875],
        [0.125, -0.125]
    ];
    const px = new Uint8ClampedArray(samples.length * 4);
    samples.forEach(([dx, dy], i) => {
        const x = pack(dx);
        const y = pack(dy);
        px.set([x >> 4, ((x & 15) << 4) | (y >> 8), y & 255, 255], i * 4);
    });
    const f = decodeFlow(px, samples.length, 1);
    samples.forEach(([dx, dy], i) =>
        ok(f.dx[i] === dx && f.dy[i] === dy, `flow ${i}: ${f.dx[i]},${f.dy[i]} != ${dx},${dy}`)
    );
}

// switching never shows the scene through the character
{
    const sw = createSwitcher({ morphs: { 'a-b': 'x', 'b-a': 'x' }, slow: (p) => p === 's' });
    const seeThrough = (from: number, to: number, top: string) => {
        for (let t = from; t <= to; t += 4) {
            const fr = sw.frame(t);
            const topAlpha = fr.get(top)?.alpha ?? 0;
            const covered = [...fr].some(([p, v]) => p !== top && v.alpha >= 0.999);
            if (topAlpha < 0.999 && !covered) return t;
        }
        return -1;
    };
    sw.show('a', 0, false);
    sw.show('b', 1000, true);
    ok(sw.morphing(), 'a -> b has fields both ways: it should morph');
    ok(seeThrough(1000, 1500, 'b') === -1, 'see-through during a morph');
    const landed = sw.frame(1500);
    ok(landed.get('b')?.alpha === 1 && !landed.has('a'), 'a morph lands on the new pose only');

    sw.show('c', 2000, true);
    ok(!sw.morphing(), 'b -> c has no field: cover-and-fade');
    ok(seeThrough(2000, 2600, 'c') === -1, 'see-through during cover-and-fade');
    const faded = sw.frame(2600);
    ok(faded.get('c')?.alpha === 1 && !faded.has('b'), 'cover-and-fade settles on the new pose only');

    sw.show('a', 3000, false);
    sw.frame(3000);
    sw.show('b', 4000, true);
    sw.frame(4200);
    sw.show('a', 4210, true); // interrupt the morph halfway
    ok(seeThrough(4210, 4800, 'a') === -1, 'see-through after interrupting a morph');
    const back = sw.frame(4800);
    ok(back.get('a')?.alpha === 1 && !back.has('b'), 'an interrupted morph lands, then the new change runs');

    sw.show(null, 5000, true);
    ok(sw.frame(5300).size === 0, 'nobody there: nothing visible');

    sw.show('a', 6000, false);
    sw.frame(6000);
    sw.show('s', 7000, true);
    ok((sw.frame(7200).get('s')?.alpha ?? 0) < 0.6, 'a slow pose is still fading in at 200 ms');
}

// a slow pose with fields morphs longer and still never shows through
{
    const sw = createSwitcher({ morphs: { 'a-s': 'x', 's-a': 'x' }, slow: (p) => p === 's' });
    sw.show('a', 0, false);
    sw.frame(0);
    sw.show('s', 1000, true);
    ok(sw.morphing(), 'a -> s has fields: a slow morph');
    let through = -1;
    for (let t = 1000; t <= 2000; t += 4) {
        const fr = sw.frame(t);
        if ((fr.get('s')?.alpha ?? 0) < 0.999 && (fr.get('a')?.alpha ?? 0) < 0.999) through = t;
    }
    ok(through === -1, `see-through during a slow morph at ${through}`);
    const mid = createSwitcher({ morphs: { 'a-s': 'x', 's-a': 'x' }, slow: (p) => p === 's' });
    mid.show('a', 0, false);
    mid.show('s', 0, true);
    ok(mid.morphing() && mid.frame(800).has('a') && !mid.frame(950).has('a'), 'a slow morph lands after 900 ms');
}

// a keyframe step swaps its pictures quickly unless its chain asks for wide (a mouth opening while the
// head stays: nothing moves to carry it in), and the director hands the chain's window to every step
{
    const firstSeen = (window?: 'wide') => {
        const sw = createSwitcher({ morphs: { 'a-b': 'x', 'b-a': 'x' }, slow: () => false });
        sw.show('a', 0, false);
        sw.frame(0);
        sw.show('b', 0, true, window ? { ms: 400, ease: 'linear', window } : { ms: 400, ease: 'linear' });
        for (let t = 0; t <= 400; t += 2) if ((sw.frame(t).get('b')?.alpha ?? 0) > 0) return t;
        return -1;
    };
    ok(firstSeen() > 160, `a quick step shows the new picture only near its middle (${firstSeen()} ms of 400)`);
    ok(firstSeen('wide') <= 110, `a wide step brings it in from a quarter of the way (${firstSeen('wide')} ms of 400)`);
    const mouth = { frames: ['rest', 'open1', 'open2'], stepMs: 400, holdMs: 500, back: true, swap: 'wide' } as const;
    const d = createDirector(
        { statePose: { awake: 'rest' }, reactions: { yawn: { sequence: mouth, priority: 1, in: ['awake'] } } },
        'awake',
        () => 0.5,
        0
    );
    let shown = d.update(0);
    ok(d.react('yawn', 100), 'the yawn plays');
    const windows: (string | undefined)[] = [];
    for (let t = 100; t <= 3000; t += 10) {
        const pose = d.update(t);
        if (pose !== shown) windows.push(d.transition()?.window);
        shown = pose;
    }
    ok(windows.length === 4 && windows.every((w) => w === 'wide'), `every step of a wide chain swaps wide: ${windows}`);
}

// blink rhythm over a simulated minute
{
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const blinker = createBlinker(random, 0);
    let blinks = 0;
    let closedMs = 0;
    let was = false;
    for (let t = 0; t < 60000; t += 10) {
        const closed = blinker.closed(t);
        if (closed) closedMs += 10;
        if (closed && !was) blinks++;
        was = closed;
    }
    ok(blinks >= 9 && blinks <= 22, `blinks per minute: ${blinks}`);
    ok(Math.abs(closedMs / blinks - 140) <= 10, `closed ms per blink: ${closedMs / blinks}`);
}

// gestures: a real jump, no judder, and back to rest exactly
{
    for (const [name, g] of Object.entries(GESTURES)) {
        let peak = 0;
        let jump = 0;
        let prev = g.at(0);
        for (let t = 4; t < g.ms; t += 4) {
            const p = g.at(t);
            peak = Math.max(peak, p.lift);
            jump = Math.max(
                jump,
                Math.abs(p.lift - prev.lift),
                Math.abs(p.hairX - prev.hairX),
                Math.abs(p.hairLag - prev.hairLag)
            );
            prev = p;
        }
        ok(peak > 4, `${name}: the body should visibly jump (peak ${peak.toFixed(1)} px)`);
        ok(jump < 1, `${name}: no judder between 4 ms samples (worst step ${jump.toFixed(2)} px)`);
        ok(Math.abs(g.at(g.ms - 1).lift) < 0.05, `${name}: ends at rest`);
    }
    const rising = GESTURES.flinchLaugh.at(40);
    ok(rising.hairLag > 0, 'hair trails below the body while it rises');
    const player = createGesturePlayer();
    player.play(GESTURES.flinchLaugh, 1000);
    ok(player.sample(1080).lift > 5 && player.sample(2400) === REST_PULSE, 'player runs a gesture and then rests');
}

// director: priorities, held reactions, states
{
    let seed = 11;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const d = createDirector(
        {
            statePose: { reading: 'reading', away: null },
            reactions: {
                glance: { pose: 'glance', priority: 1, seconds: [2.5, 4], in: ['reading'] },
                poke: { pose: 'poked', priority: 3, seconds: 1.4, in: ['reading'] },
                pat: { pose: 'patted', priority: 4, seconds: 0, in: ['reading'] }
            },
            idle: [{ reaction: 'glance', every: [20, 60], in: ['reading'] }]
        },
        'reading',
        random,
        0
    );
    ok(d.update(1000) === 'reading', 'rests in its state pose');
    ok(d.hold('pat', true, 2000), 'a pat starts');
    ok(!d.react('poke', 2100), 'a poke does not interrupt a held pat');
    ok(d.update(9000) === 'patted', 'a pat lasts while held');
    d.hold('pat', false, 9000);
    ok(d.update(9500) === 'patted' && d.update(9900) === 'reading', 'a pat lingers 0.8 s, then settles');
    d.setState('away', 10000);
    ok(d.update(10001) === null && !d.react('poke', 10002), 'nobody to poke when away');
    d.setState('reading', 11000);
    let glanced = false;
    for (let t = 11000; t < 80000; t += 100) if (d.update(t) === 'glance') glanced = true;
    ok(glanced, 'an idle glance happens within a minute');
}

// keyframe sequences: back to rest first, walked in order as one gesture, atomic, unwound on a state change
{
    const sip = { frames: ['reading', 'k1', 'k2', 'k3'], stepMs: 400, holdMs: 1000, back: true } as const;
    const doze = { frames: ['reading', 'd1', 'd2', 'asleep'], stepMs: 700 } as const;
    const d = createDirector(
        {
            statePose: { reading: 'reading', asleep: 'asleep', away: null },
            enter: { asleep: doze },
            reactions: {
                glance: { pose: 'glance', priority: 1, seconds: 3, in: ['reading'] },
                sip: { sequence: sip, priority: 2, in: ['reading'] },
                poke: { pose: 'poked', priority: 3, seconds: 1.4, in: ['reading'] }
            },
            returnMs: 700
        },
        'reading',
        () => 0.5,
        0
    );
    const seen: string[] = [];
    const track = (from: number, to: number) => {
        for (let t = from; t <= to; t += 10) {
            const p = String(d.update(t));
            if (seen[seen.length - 1] !== p) seen.push(p);
        }
    };
    d.update(0);
    ok(d.react('glance', 100), 'a glance starts');
    track(100, 500);
    ok(d.react('sip', 500), 'a sip starts during the glance (stronger)');
    track(500, 500 + 700 + 3 * 400 + 1000 + 3 * 400 + 100);
    ok(
        seen.join(' ') === 'glance reading k1 k2 k3 k2 k1 reading',
        `the sip goes back to rest first, then out and back in order: ${seen.join(' ')}`
    );
    // eases: the first chain step eases in, the middle is linear, the last eases out
    const eases: string[] = [];
    let last = '';
    for (let t = 5000; t <= 5000 + 3 * 400 + 50; t += 10) {
        if (t === 5000) d.react('sip', t);
        const p = String(d.update(t));
        if (p !== last) {
            eases.push(`${p}:${d.transition()?.ease}:${d.transition()?.ms}`);
            last = p;
        }
    }
    ok(eases.join(' ') === 'k1:in:400 k2:linear:400 k3:out:400', `chain eases: ${eases.join(' ')}`);
    ok(!d.react('poke', 6300) && d.busy(), 'nothing interrupts a running sequence');
    // a state change in the middle (holding k3) walks the sequence back first
    d.update(6300);
    d.setState('away', 6300);
    const back: string[] = [];
    for (let t = 6300; t < 8500; t += 10) {
        const p = String(d.update(t));
        if (back[back.length - 1] !== p) back.push(p);
    }
    ok(back.join(' ') === 'k2 k1 reading null', `unwound before leaving: ${back.join(' ')}`);
    // entering and leaving a keyframed state
    d.setState('reading', 9000);
    d.update(9000);
    d.setState('asleep', 10000);
    const into: string[] = [];
    for (let t = 10000; t < 13000; t += 10) {
        const p = String(d.update(t));
        if (into[into.length - 1] !== p) into.push(p);
    }
    ok(into.join(' ') === 'd1 d2 asleep', `falling asleep walks the frames: ${into.join(' ')}`);
    d.setState('reading', 14000);
    const out: string[] = [];
    for (let t = 14000; t < 17000; t += 10) {
        const p = String(d.update(t));
        if (out[out.length - 1] !== p) out.push(p);
    }
    ok(out.join(' ') === 'd2 d1 reading', `waking walks them back: ${out.join(' ')}`);
}

// the chain map: poses the chains link walk the frames between; a held chain walks in, stays, walks out
{
    const write = { frames: ['reading', 'lay', 'writing'], stepMs: 400 } as const;
    const pat = { frames: ['lay', 'patted'], stepMs: 300 } as const;
    const sip = { frames: ['reading', 'k1', 'k2'], stepMs: 400, holdMs: 500, back: true } as const;
    const d = createDirector(
        {
            statePose: { reading: 'reading', writing: 'writing', away: null },
            enter: { writing: write },
            reactions: {
                sip: { sequence: sip, priority: 2, in: ['reading', 'writing'] },
                poke: {
                    pose: 'poked',
                    poseIn: { writing: 'poked-writing' },
                    priority: 3,
                    seconds: 1,
                    in: ['reading', 'writing']
                },
                pat: { sequence: pat, priority: 4, in: ['reading', 'writing'] }
            }
        },
        'reading',
        () => 0.5,
        0
    );
    const seen = (from: number, to: number) => {
        const out: string[] = [];
        for (let t = from; t <= to; t += 10) {
            const p = String(d.update(t));
            if (out[out.length - 1] !== p) out.push(p);
        }
        return out.join(' ');
    };
    d.update(0);
    d.setState('writing', 100);
    const into = seen(100, 1000);
    ok(into === 'lay writing', `starting to write lays the book down first: ${into}`);
    ok(d.hold('pat', true, 1000), 'a pat lands while writing');
    const patIn = seen(1000, 3000);
    ok(patIn === 'lay patted', `the pat walks in through lay and stays while held: ${patIn}`);
    d.hold('pat', false, 3000);
    const patOut = seen(3000, 5000);
    ok(patOut === 'patted lay writing', `released, it lingers and walks back to writing: ${patOut}`);
    ok(d.react('poke', 5000), 'a poke lands while writing');
    const poke = seen(5000, 6500);
    ok(poke === 'poked-writing writing', `a poke while writing laughs over the notebook: ${poke}`);
    ok(d.react('sip', 7000), 'a sip starts while writing');
    const sipping = seen(7000, 10800);
    ok(
        sipping === 'lay reading k1 k2 k1 reading lay writing',
        `a sip while writing goes to its first frame along the map and comes back the same way: ${sipping}`
    );
    ok(d.hold('pat', true, 11000), 'another pat');
    seen(11000, 12000);
    d.setState('reading', 12000);
    const cut = seen(12000, 13500);
    ok(cut === 'lay reading', `a state change walks out of a held pat before settling: ${cut}`);
    ok(d.hold('pat', true, 14000), 'a pat while reading');
    const fromReading = seen(14000, 15000);
    ok(fromReading === 'lay patted', `from reading it is one step down, then the pat: ${fromReading}`);
    d.hold('pat', false, 15000);
    const back = seen(15000, 17000);
    ok(back === 'patted lay reading', `and back up to reading: ${back}`);
    // a pose the map does not know goes back to its state's pose before walking on
    d.update(18000);
    ok(d.react('poke', 18000), 'a poke while reading');
    seen(18000, 18300);
    d.setState('writing', 18300);
    const onward = seen(18300, 20000);
    ok(onward === 'reading lay writing', `from a laugh to writing: home first, then the chain: ${onward}`);
}

// chain easing: in and out meet a linear middle at the same speed
{
    const h = 1e-4;
    const sw = createSwitcher({ morphs: { 'a-b': 'x', 'b-a': 'x' }, slow: () => false });
    sw.show('a', 0, false);
    sw.frame(0);
    sw.show('b', 100, true, { ms: 1000, ease: 'in' });
    const at = (t: number) => sw.frame(100 + t * 1000).get('a')?.shift?.amount ?? NaN;
    const endSpeed = (at(1 - h) - at(1 - 2 * h)) / h;
    ok(Math.abs(endSpeed - 1) < 0.01, `ease-in arrives at linear speed (${endSpeed.toFixed(3)})`);
    ok(at(0.5) < 0.5, 'ease-in is slower than linear at the start');
    ok(sw.frame(1150).get('b')?.alpha === 1, 'a 1000 ms transition lands after 1000 ms');
}

// a scene part the hand picks up: carried along its hold, opaque, gone only once the holding pose arrived
{
    const hold = (dx: number, dy: number): [number, number] => [dx, dy];
    const poses = {
        reach: { open: 'r', slow: false },
        grip: { open: 'g', slow: false, holds: { mug: hold(2, -1) } },
        lift: { open: 'l', slow: false, hides: ['mug'], holds: { mug: hold(0, -70) } },
        drink: { open: 'd', slow: false, hides: ['mug'] },
        wave: { open: 'w', slow: false, hides: ['mug'] }
    };
    const pairs = ['reach-grip', 'grip-lift', 'lift-drink'].flatMap((k) => [k, k.split('-').reverse().join('-')]);
    const sw = createSwitcher({ morphs: Object.fromEntries(pairs.map((k) => [k, 'x'])), slow: () => false });
    const linear = { ms: 400, ease: 'linear' } as const;
    const mug = (t: number) => partFrame(poses, sw.frame(t), sw.progress(), sw.current(), 'mug');
    sw.show('reach', 0, false);
    ok(mug(0).alpha === 1 && mug(0).dx === 0 && mug(0).dy === 0, 'the mug stands on the table');
    sw.show('grip', 100, true, linear);
    const closing = mug(300);
    ok(
        closing.alpha === 1 && closing.dx === 1 && closing.dy === -0.5,
        `closing on the mug nudges it: ${closing.dx},${closing.dy}`
    );
    ok(mug(600).alpha === 1 && mug(600).dx === 2, 'the grip keeps the painted mug on the drawn one');
    sw.show('lift', 1000, true, linear);
    let faintest = 1;
    for (let t = 1000; t < 1000 + 400 * 0.85; t += 4) faintest = Math.min(faintest, mug(t).alpha);
    ok(faintest === 1, 'the painted mug stays opaque while the pictures swap');
    const halfway = mug(1200);
    ok(halfway.dx === 1 && halfway.dy === -35.5, `it rides along the hold: ${halfway.dx},${halfway.dy}`);
    ok(mug(1450).alpha === 0, 'gone once the lift has arrived');
    sw.show('drink', 1500, true, linear);
    ok(mug(1700).alpha === 0, 'both poses hold it in the hand: no painted mug');
    mug(2000);
    sw.show('lift', 2000, true, linear);
    mug(2450);
    sw.show('grip', 2500, true, linear);
    const down = mug(2580);
    ok(down.alpha === 1 && down.dy < -50, `put back: opaque from early on the way down (${down.alpha}, ${down.dy})`);
    mug(2950);
    sw.show('reach', 3000, false);
    mug(3000);
    sw.show('wave', 3100, true);
    ok(Math.abs(mug(3190).alpha - 0.5) < 0.05, 'a pose that hides without holding cross-fades with the part');
}

console.log(failures ? `${failures} failures` : 'all rig-core / rig-director checks passed');
process.exit(failures ? 1 : 0);
