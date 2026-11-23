# Concrete

Write Markdown notes and study them with quizzes and flashcards.

[Open Concrete](https://app.useconcrete.app) · [Download the desktop app](https://github.com/danielgraviet/concrete/releases/latest)

## Web and desktop

- **Web** — Sign in with Google. Concrete saves your notes to your online workspace.
- **Desktop** — Open an existing Markdown folder or start a new one. Your notes stay as regular `.md` files you can edit in any text editor. You can also import an Obsidian vault.

## Study from your notes

- Make a quiz from a note.
- Review flashcards and see which ones are due.
- Check past scores and see how often you’ve studied.

## Run from source

Use Node.js 22. From a checkout of this repository, run:

```sh
npm ci
npm run dev:web
```

The local web app opens in demo mode without cloud settings. Use `npm run dev` to launch the desktop app. Use `npm test` to run the tests.

[Report a bug or suggest a change](https://github.com/danielgraviet/concrete/issues) · [MIT License](LICENSE)
