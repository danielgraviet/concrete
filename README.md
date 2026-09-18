# Concrete

Concrete is a local-first Markdown workspace for learning STEM subjects. Write and organize notes as ordinary Markdown files, use AI to work with the material, and turn notes into active practice with generated quizzes.

The goal is a tight loop:

**Capture → understand → practice → measure progress**

## What it does

- **STEM notes in Markdown** — a fast editor for notes, math, code, PDFs, and linked topics. Your vault stays on disk and remains portable.
- **Grounded quiz generation** — generate multiple-choice, cloze, and code questions from the current notes, then take and grade quizzes inside the app.
- **Tutor mode** — ask about the open note and get explanations grounded in the material you are studying.
- **Agent workflows** — connect a Codex or Claude agent that can inspect and edit vault files, generate learning materials, change themes, and report live progress.
- **Runnable code** — execute supported Python and other snippets in an isolated sandbox while studying. Outputs are shown in the editor and are not saved automatically.
- **Learning progress** — review quiz history, skill trends, streaks, and activity over time.
- **Local activity capture** — agent trajectories are stored as JSONL in `~/Documents/Concrete/agent-trajectories/` for later analysis and potential RL fine-tuning. They are not included in the Markdown vault view.

## Why Concrete?

Most note-taking tools stop at storage, and most AI tools are disconnected from the files and concepts you are trying to learn. Concrete keeps the source material local, makes the learning loop explicit, and treats retrieval practice as part of the workspace rather than a separate destination.

## Getting started

Requirements:

- Node.js 20+
- macOS for the packaged desktop app
- An OpenRouter API key for live quiz generation and tutoring
- Codex or Claude CLI credentials if you want agent workflows

```bash
npm install
npm run dev
```

Open or create a Markdown vault, then use the quiz controls from a note to generate practice material. API keys and AI settings are managed from Settings; the key stays in the Electron main process.

## Build the desktop app

```bash
npm run build
npm run pack:mac
```

The packaged app is written to `release/`.

## Project status

Concrete is an actively developed experimental desktop app. The core note, quiz, tutor, agent, and sandbox workflows are usable, while the learning analytics and trajectory dataset formats are still evolving.

## License

Private project; licensing details have not yet been published.
