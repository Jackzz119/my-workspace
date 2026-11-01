// rig-director.ts — decides WHICH pose shows: the pose of the character's real state, overridden for
// a moment by short reactions (a glance up, a poke, a held pat) or played through a keyframe
// sequence (taking a sip: reach, lift, drink, put it back). Pure logic, no clock or randomness of its
// own, so a test can replay a sequence exactly. The view only renders what `update` returns, and asks
// `transition()` how to animate the change.
//
// Rules it enforces:
//   - a reaction never interrupts a stronger one (priority), a repeat extends the running one
//   - reactions only land in the states that allow them (nobody pokes an empty chair)
//   - idle reactions are timed from the last time the character settled back, not wall-clock
//   - every chain's neighbouring frames form one map: whenever the pose changes between two poses the
//     map links (writing -> patted, asleep -> reading), it walks the frames in between one small step
//     at a time instead of morphing straight across
//   - a keyframe sequence always starts from its first frame: from anything else the character first
//     goes there (along the map, or slowly in one move); once running nothing but a state change stops
//     it, and a state change first walks it back to its first frame instead of jumping out of the middle
//   - a held keyframe reaction (a pat) walks in, stays on its last frame while held, and walks out

export type Ease = 'inOut' | 'in' | 'out' | 'linear';

/** When a morph swaps its pictures (rig-core.ts SwapWindow). */
export type SwapWindow = 'wide' | 'narrow' | 'step';

/**
 * How the view animates one pose change: its length and easing, and when the pictures swap if not the
 * view's default (null from `transition()` = the view's default).
 */
export type Transition = { ms: number; ease: Ease; window?: SwapWindow };

/** Keyframes walked one small step at a time; each neighbouring pair needs a morph field. */
export type Sequence<P extends string> = {
    /** In order; frames[0] is the pose the sequence starts from (and returns to when `back`). */
    frames: readonly P[];
    /** Ms per step between neighbouring frames. */
    stepMs: number;
    /**
     * When its steps swap pictures: quick by default (the mesh carries the motion); 'wide' when a step
     * brings in something nothing moves to (a mouth opening while the head stays), which a quick swap pops in.
     */
    swap?: SwapWindow;
    /** Ms held on the last frame before walking back. */
    holdMs?: number;
    /** Walk the frames back after the hold (put the mug down again). */
    back?: boolean;
};

export type Reaction<S extends string, P extends string> = {
    /** A one-pose reaction shows this pose... */
    pose?: P;
    /** ...or, in these states, this one instead (a laugh over the notebook while writing)... */
    poseIn?: Partial<Record<S, P>>;
    /** ...a keyframe reaction plays this instead, start to end (held: to the end, and stays). */
    sequence?: Sequence<P>;
    priority: number;
    /** One-pose reactions: seconds shown, or a [min, max] range drawn each time. Held reactions ignore it while held. */
    seconds?: number | readonly [number, number];
    /** States in which it can happen. */
    in: readonly S[];
};

export type DirectorSpec<S extends string, R extends string, P extends string> = {
    /** The pose each state rests in; null leaves the character out of the scene. */
    statePose: Record<S, P | null>;
    /** States entered through keyframes (falling asleep, putting the book down to write): walked in and out. */
    enter?: Partial<Record<S, Sequence<P>>>;
    reactions: Record<R, Reaction<S, P>>;
    /** Reactions that happen by themselves every [min, max] seconds while in one of `in`. */
    idle?: readonly { reaction: R; every: readonly [number, number]; in: readonly S[] }[];
    /** Ms to go to a sequence's first frame from a pose the chains do not link (default 700). */
    returnMs?: number;
};

export type Director<S extends string, R extends string, P extends string> = {
    /** Switch the real state; a running reaction ends and the idle clocks restart. */
    setState: (state: S, nowMs: number) => void;
    /** A one-shot reaction; false when the state does not allow it or something stronger is playing. */
    react: (kind: R, nowMs: number) => boolean;
    /** A reaction that lasts while held (a pat), then lingers `lingerS` after release. */
    hold: (kind: R, holding: boolean, nowMs: number, lingerS?: number) => boolean;
    /** The pose to show at `nowMs`. */
    update: (nowMs: number) => P | null;
    /** How to animate to the pose `update` returned last; null = the view's default. */
    transition: () => Transition | null;
    /** A keyframe sequence is playing. */
    busy: () => boolean;
    state: () => S;
};

type Step<P extends string> = { pose: P; at: number; t: Transition };
type Plan<R extends string, P extends string> = {
    steps: Step<P>[];
    end: number;
    /** The reaction it plays, if any (a walk between poses has none). */
    kind: R | null;
    /** The reaction's sequence, for walking it back on a state change. */
    seq: Sequence<P> | null;
    /** A held reaction walking in: its last frame stays once the walk ends. */
    held: boolean;
    /** A reaction's keyframes or a state's walk: only a state change cuts in (a walk back to rest gives way). */
    firm: boolean;
};

// in / linear / out meet with matching speed (derivative 1) so a chain moves as one gesture
const chainEase = (i: number, n: number): Ease => (n === 1 ? 'inOut' : i === 0 ? 'in' : i === n - 1 ? 'out' : 'linear');

// a state change walks the reaction it cuts short back a little faster than it came
const LEAVE_PACE = 0.7;

export function createDirector<S extends string, R extends string, P extends string>(
    spec: DirectorSpec<S, R, P>,
    initial: S,
    random: () => number,
    nowMs: number
): Director<S, R, P> {
    const draw = (v: number | readonly [number, number] | undefined) =>
        v === undefined ? 0 : typeof v === 'number' ? v : v[0] + random() * (v[1] - v[0]);
    const returnMs = spec.returnMs ?? 700;
    let state = initial;
    let active: { kind: R; until: number } | null = null;
    let held = false;
    let plan: Plan<R, P> | null = null;
    let shown: P | null = null;
    let lastT: Transition | null = null;
    const idle = (spec.idle ?? []).map((i) => ({ ...i, next: 0 }));
    const schedule = (now: number) => {
        for (const i of idle) i.next = now + draw(i.every) * 1000;
    };
    schedule(nowMs);

    // the map: every neighbouring pair of every chain, both ways, with that chain's step and swap
    type Edge = { ms: number; swap?: SwapWindow };
    type Hop = { pose: P; ms: number; swap?: SwapWindow };
    const edges = new Map<P, Map<P, Edge>>();
    const link = (a: P, b: P, ms: number, swap?: SwapWindow) => {
        const out = edges.get(a) ?? new Map<P, Edge>();
        const had = out.get(b);
        if (!had || ms < had.ms) out.set(b, { ms, swap });
        edges.set(a, out);
    };
    const chains = [
        ...Object.values<Reaction<S, P>>(spec.reactions).flatMap((r) => (r.sequence ? [r.sequence] : [])),
        ...Object.values<Sequence<P> | undefined>(spec.enter ?? {}).flatMap((s) => (s ? [s] : []))
    ];
    for (const c of chains)
        for (let i = 1; i < c.frames.length; i++) {
            link(c.frames[i - 1], c.frames[i], c.stepMs, c.swap);
            link(c.frames[i], c.frames[i - 1], c.stepMs, c.swap);
        }

    /** The frames after `from` up to `to` along the map (fewest steps), each with its step; null when unlinked. */
    const route = (from: P | null, to: P): Hop[] | null => {
        if (from === null || from === to || !edges.has(from) || !edges.has(to)) return null;
        const prev = new Map<P, P>([[from, from]]);
        const queue: P[] = [from];
        while (queue.length) {
            const at = queue.shift() as P;
            if (at === to) break;
            for (const next of edges.get(at)?.keys() ?? [])
                if (!prev.has(next)) {
                    prev.set(next, at);
                    queue.push(next);
                }
        }
        if (!prev.has(to)) return null;
        const path: Hop[] = [];
        for (let p = to; p !== from; p = prev.get(p) as P) {
            const edge = edges.get(prev.get(p) as P)?.get(p);
            path.unshift({ pose: p, ms: edge?.ms ?? returnMs, swap: edge?.swap });
        }
        return path;
    };

    /** Steps through `path`, each at its own step length times `pace`, eased as one gesture, from `at`. */
    const walk = (path: readonly Hop[], at: number, pace = 1): Step<P>[] => {
        let t = at;
        return path.map((s, i) => {
            const ms = Math.round(s.ms * pace);
            const ease = chainEase(i, path.length);
            const step = { pose: s.pose, at: t, t: s.swap ? { ms, ease, window: s.swap } : { ms, ease } };
            t += ms;
            return step;
        });
    };
    const frames = (poses: readonly P[], ms: number, swap?: SwapWindow): Hop[] =>
        poses.map((pose) => ({ pose, ms, swap }));
    const endOf = (steps: Step<P>[], at: number) =>
        steps.length ? steps[steps.length - 1].at + steps[steps.length - 1].t.ms : at;

    /** Steps from `from` to `to`: along the map when linked, else one slow move. */
    const reach = (from: P | null, to: P, at: number): Step<P>[] => {
        if (from === to) return [];
        const path = route(from, to);
        return path ? walk(path, at) : [{ pose: to, at, t: { ms: returnMs, ease: 'inOut' } }];
    };

    /** A plan that first goes to `seq.frames[0]`, then walks the frames (and, when `full`, holds and walks back). */
    const planSequence = (seq: Sequence<P>, now: number, kind: R | null, full: boolean): Plan<R, P> => {
        const steps = reach(shown, seq.frames[0], now);
        let at = endOf(steps, now);
        const forward = seq.frames.slice(1);
        steps.push(...walk(frames(forward, seq.stepMs, seq.swap), at));
        at += forward.length * seq.stepMs;
        if (full) {
            at += seq.holdMs ?? 0;
            if (seq.back) {
                const back = seq.frames.slice(0, -1).reverse();
                steps.push(...walk(frames(back, seq.stepMs, seq.swap), at));
                at += back.length * seq.stepMs;
            }
        }
        return { steps, end: at, kind, seq, held: !full, firm: true };
    };

    /** The pose a reaction shows while it lasts, in the current state. */
    const reactionPose = (kind: R): P | null => {
        const r = spec.reactions[kind];
        if (r.sequence) return r.sequence.frames[r.sequence.frames.length - 1];
        return r.poseIn?.[state] ?? r.pose ?? spec.statePose[state];
    };

    const start = (kind: R, now: number, holding: boolean) => {
        const r = spec.reactions[kind];
        if (plan?.firm || !r.in.includes(state)) return false;
        if (active && active.until > now && spec.reactions[active.kind].priority > r.priority) return false;
        if (r.sequence) {
            // held again before it let go: it is still there
            if (active?.kind === kind && shown === reactionPose(kind)) return true;
            plan = planSequence(r.sequence, now, kind, !holding);
            active = { kind, until: holding ? Number.POSITIVE_INFINITY : plan.end };
            return true;
        }
        plan = null;
        const ms = draw(r.seconds) * 1000;
        if (active && active.kind === kind) active.until = Math.max(active.until, now + ms);
        else active = { kind, until: now + ms };
        return true;
    };

    function update(now: number): P | null {
        if (plan && now >= plan.end) {
            // a held reaction stays on its last frame; anything else is done
            if (plan.kind !== null && !plan.held) {
                active = null;
                schedule(now);
            }
            plan = null;
        }
        if (plan) {
            const step = [...plan.steps].reverse().find((s) => s.at <= now);
            if (step && step.pose !== shown) {
                shown = step.pose;
                lastT = step.t;
            }
            return shown;
        }
        if (active && !held && now >= active.until) {
            active = null;
            schedule(now);
        }
        if (!active) {
            // the first idle reaction that is due and allowed; the others wait for their turn
            const due = idle.find((i) => i.in.includes(state) && now >= i.next);
            if (due) {
                due.next = now + draw(due.every) * 1000;
                if (start(due.reaction, now, false) && plan) return update(now);
            }
        }
        const pose = active ? reactionPose(active.kind) : spec.statePose[state];
        if (pose !== shown) {
            const path = pose === null ? null : route(shown, pose);
            if (path && path.length > 1) {
                const steps = walk(path, now);
                plan = { steps, end: endOf(steps, now), kind: null, seq: null, held: false, firm: false };
                return update(now);
            }
            shown = pose;
            // one chain step: that chain's own pace
            lastT = path ? { ms: path[0].ms, ease: 'inOut' } : null;
        }
        return pose;
    }

    return {
        setState(next, now) {
            if (next === state) return;
            const home = spec.statePose[state];
            state = next;
            // a reaction cut short walks back to where its keyframes start (the mug goes down first)
            const cut = plan?.seq ?? (active ? spec.reactions[active.kind].sequence : undefined);
            active = null;
            held = false;
            schedule(now);
            const steps: Step<P>[] = [];
            if (cut && shown !== null && cut.frames.includes(shown)) {
                const path = route(shown, cut.frames[0]);
                if (path) steps.push(...walk(path, now, LEAVE_PACE));
            }
            // then on to the new state's pose, along the map when it links them; a reaction pose the map
            // does not know (a laugh) goes back to its own state's pose first, and walks on from there
            const target = spec.statePose[next];
            const from = steps.length ? steps[steps.length - 1].pose : shown;
            if (target !== null) {
                let path = route(from, target);
                const onward = !path && home !== null && from !== home ? route(home, target) : null;
                if (onward && home !== null) {
                    steps.push({ pose: home, at: endOf(steps, now), t: { ms: returnMs, ease: 'inOut' } });
                    path = onward;
                }
                if (path) steps.push(...walk(path, endOf(steps, now)));
            }
            plan = steps.length
                ? { steps, end: endOf(steps, now), kind: null, seq: null, held: false, firm: true }
                : null;
        },
        react(kind, now) {
            return start(kind, now, false);
        },
        hold(kind, holding, now, lingerS = 0.8) {
            if (holding) {
                if (!start(kind, now, true)) return false;
                if (active) active.until = Number.POSITIVE_INFINITY;
                held = true;
                return true;
            }
            held = false;
            if (active?.kind === kind) active.until = now + lingerS * 1000;
            return true;
        },
        update,
        transition: () => lastT,
        busy: () => plan !== null,
        state: () => state
    };
}
