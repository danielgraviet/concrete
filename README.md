# Concrete

[![GitHub stars](https://img.shields.io/github/stars/danielgraviet/concrete?style=flat-square)](https://github.com/danielgraviet/concrete/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/danielgraviet/concrete?style=flat-square)](https://github.com/danielgraviet/concrete/network/members)
[![GitHub issues](https://img.shields.io/github/issues/danielgraviet/concrete?style=flat-square)](https://github.com/danielgraviet/concrete/issues)
[![Last commit](https://img.shields.io/github/last-commit/danielgraviet/concrete?style=flat-square)](https://github.com/danielgraviet/concrete/commits/main)
[![macOS](https://img.shields.io/badge/platform-macOS-000000?style=flat-square&logo=apple&logoColor=white)](https://www.apple.com/macos/)

**Concrete is a local-first Markdown workspace for learning STEM subjects.** Write and organize notes as ordinary Markdown files, use AI to work with the material, and turn notes into active practice with generated quizzes.

> Built for students who want their notes, tools, and learning progress in one place.

[Get started](#getting-started) · [Contribute](#contributing) · [Report a bug](https://github.com/danielgraviet/concrete/issues/new) · [Request an idea](https://github.com/danielgraviet/concrete/issues/new)

## What it does

- **STEM notes in Markdown** — a fast editor for notes, math, code, PDFs, and linked topics. Your vault stays on disk and remains portable.
- **Grounded quiz generation** — generate multiple-choice, cloze, and code questions from current notes, then take and grade quizzes inside the app.
- **Tutor mode** — ask about the open note and get explanations grounded in the material you are studying.
- **Agent workflows** — connect a Codex or Claude agent that can inspect and edit vault files, generate learning materials, change themes, and report live progress.
- **Runnable code** — execute supported Python and other snippets in an isolated sandbox while studying. Outputs are shown in the editor and are not saved automatically.
- **Learning progress** — review quiz history, skill trends, streaks, and activity over time.
- **Local activity capture** — agent trajectories are stored as JSONL in `~/Documents/Concrete/agent-trajectories/` for later analysis and potential RL fine-tuning. They are not included in the Markdown vault view.

## Why Concrete?

Most note-taking tools stop at storage, and most AI tools are disconnected from the files and concepts you are trying to learn. Concrete keeps the source material local, makes the learning loop explicit, and treats retrieval practice as part of the workspace rather than a separate destination.

## Getting started

### Requirements

- macOS
- Node.js 20 or newer
- An OpenRouter API key for live quiz generation and tutoring
- Codex or Claude CLI credentials if you want agent workflows

### Run locally

```bash
git clone https://github.com/danielgraviet/concrete.git
cd concrete
npm install
npm run dev
```

Open or create a Markdown vault, then use the quiz controls from a note to generate practice material. API keys and AI settings are managed from Settings; the key stays in the Electron main process.

### Build the desktop app

```bash
npm run build
npm run pack:mac
```

The packaged app is written to `release/`.

## Contributing

Contributions from students, educators, and curious builders are welcome. You do not need to be an expert in Electron or AI to help—documentation, bug reports, UI polish, testing, and small improvements are all valuable.

1. Browse the [open issues](https://github.com/danielgraviet/concrete/issues), or open an issue describing a bug or idea before starting a larger change.
2. Fork the repository and create a focused branch using your initials:

   ```bash
   git checkout -b dg/fix-agent-workflow
   ```

3. Make your change and test it locally with `npm run build`.
4. Open a pull request explaining what changed, why it helps learners, and how you tested it.

Please keep pull requests small and focused when possible. Screenshots or short recordings are especially helpful for UI changes. Never commit API keys, personal vaults, private notes, or generated trajectory data.

### Good first contributions

- Improve onboarding or documentation
- Add or refine keyboard shortcuts
- Fix a small UI issue
- Improve quiz explanations or accessibility
- Add tests around parsing, notes, or learning workflows
- Try the app on a different Mac and report what you find

## Project status

Concrete is an actively developed experimental desktop app. The core note, quiz, tutor, agent, and sandbox workflows are usable, while the learning analytics and trajectory dataset formats are still evolving. Expect APIs, file formats, and UI details to change.

## Community expectations

Be kind, assume good intentions, and make space for beginners. Feedback should be specific and respectful. If you are unsure whether an idea is in scope, open an issue and start a conversation.

## Privacy and safety

Concrete is designed around local Markdown files, but optional AI features send relevant content to the provider you configure. Review your provider's policies before using sensitive material, and do not put secrets or private coursework in prompts or issues.

## License

Concrete is released under the [MIT License](LICENSE). Contributions are welcome under the same license.
