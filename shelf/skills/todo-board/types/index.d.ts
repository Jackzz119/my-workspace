/** The project a session works in: its copy's last state is kept under `key`. */
export type TodoProject = {
    /** The git remote with `/` as `~`, or `local~<folder>`: one per repository. */
    key: string;
    name: string;
    /** The normalized git remote, or null for a folder without one. */
    source: string | null;
};

/** One picture of a todo, a file under ai/board/: `path` as board.md links it. */
export type TodoImage = { path: string; w: number; h: number };

/** One todo as board.md writes it. */
export type TodoItem = {
    id: string;
    text: string;
    images: TodoImage[];
    done: boolean;
    /** When it was written, ISO to the minute; null for a line typed by hand. */
    at: string | null;
    doneAt: string | null;
};

/** How many todos the band reports. */
export type TodoSummary = { open: number; done: number };

declare module 'claude-code' {
    interface PluginState {
        'todo-board': {
            project: Shaped<TodoProject | null>;
            summary: Shaped<TodoSummary | null>;
            /** Why the last sync did not go through, shown on the band. */
            note: string | null;
        };
    }
}
