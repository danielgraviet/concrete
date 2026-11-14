# Cloud data layer (web version)

The web version keeps notes, folders and `.vault/` app data in the cloud. The
app talks to a vendor-neutral interface; Firebase sits behind it, so it can be
swapped for Postgres later.

```
src/backend/cloud/
  CloudRepository.ts        interface + plain-JSON types (no vendor types)
  AuthProvider.ts           auth interface + FakeAuthProvider
  errors.ts                 NotFoundError, ConflictError, PayloadTooLargeError, PermissionError, InvalidPathError
  paths.ts                  path normalisation, key encoding (shared by implementations)
  contract.ts               shared behaviour tests: runCloudRepositoryContract(name, setup)
  index.ts                  vendor-neutral barrel (does not load Firebase)
  memory/                   InMemoryCloudRepository (tests, signed-out demo)
  firebase/                 the ONLY folder allowed to import `firebase/*`
    config.ts               VITE_FIREBASE_* → lazy initializeApp (+ emulators)
    FirebaseCloudRepository.ts
    FirebaseAuthProvider.ts Google sign-in, ID tokens for the AI proxy
    index.ts                createFirebaseBackend()
  boundary.test.ts          fails if Firebase is imported anywhere else in src/
```

Load Firebase lazily so it stays out of the desktop bundle:

```ts
const { createFirebaseBackend } = await import('./backend/cloud/firebase');
const { repository, auth } = createFirebaseBackend();
```

## Data model (Firestore)

| Path | Fields | Notes |
| --- | --- | --- |
| `users/{uid}/notes/{noteId}` | `path, body, updatedAt, size` | `noteId` is generated and stable, so a rename only updates `path` |
| `users/{uid}/folders/{encPath}` | `path` | Folders you create explicitly, plus parent folders of notes created through the API |
| `users/{uid}/data/{encKey}` | `key, text, updatedAt, parts` | `.vault/srs.json`, `.vault/cards.json`, `.vault/srs-log.jsonl`, ... |
| `users/{uid}/data/{encKey}~{n}` | `key, text, updatedAt, part` | Filled chunks of an append-only log (see below) |
| `shares/{shareId}` | `ownerUid, kind, title, payload, createdAt` | A frozen snapshot. `payload` is a JSON **string** |

- Every timestamp is an ISO-8601 string. Firestore `Timestamp` never crosses the interface.
- `encKey` is `encodeURIComponent(key)` with `. _ ! ~ * ' ( )` also percent-encoded. That keeps document ids to `[A-Za-z0-9%-]` and avoids `/`, `.`, `..` and `__x__`.
- The folder list is the explicit folder docs plus every parent folder of a note.
- Folder rename and delete use a path-range query (`path >= "X/"` and `< "X0"`). Changes are written in `writeBatch` chunks of 450. Each batch is atomic, but the operation as a whole is not, so a crash partway through a 1,000-note folder move leaves it half moved.
- **Append-only logs** (`appendData`) run in a transaction. When the head doc would go past 900 KB, it is saved as `{encKey}~{n}` and a new head starts, so `srs-log.jsonl` can keep growing. `readData` joins the chunks back together. `writeData` / `deleteData` remove the chunks.
- **Shares** store the payload as a JSON string. Firestore cannot hold nested arrays, and a string column maps straight to Postgres `text`/`jsonb`. Anyone can `get` a share by its id, even when signed out. Only the owner can `list` or delete their shares, and shares cannot be updated.
- Large text fields (`notes.body`, `data.text`, `shares.payload`) are not indexed (`firestore.indexes.json`). No composite indexes are needed: `listMyShares` uses an equality filter and sorts on the client.

### Size limit

Firestore caps a document at 1 MiB. The repository rejects writes over **900 KB** (UTF-8 bytes) with
`PayloadTooLargeError`, whose message names the path or key. This applies to notes, `writeData`, a single
`appendData` line, and share payloads.

**Risk:** `.vault/srs.json` (the review state for every card, the per-day stats, and the quiz state) is written whole. Each card adds its id, path, fingerprint and FSRS state, roughly
250–350 bytes, so the file reaches the limit at about 2.5–3.5k cards.
Before heavy users get there, either split it per deck/card (one doc per card, or one doc per 500 cards) or
compress it. The app should catch `PayloadTooLargeError` and warn the user, not silently stop saving.

## Free-tier budget (Spark plan)

Daily quotas: **50k reads, 20k writes, 20k deletes, 1 GiB stored, 10 GiB/month egress.** No Cloud Functions, no Cloud Storage.

What each call costs (every document read or written counts):

| Call | Reads | Writes |
| --- | --- | --- |
| `listTree` | notes + folders (1 per doc) | 0 |
| `watch` | notes + folders on subscribe, then 1 per changed doc | 0 |
| `readNote` | 1 | 0 |
| `writeNote` (existing note) | 1 | 1 |
| `writeNote` / `createNote` (new) | 1 | 1 + parent folders |
| `rename` note | ~4 | 1 + parent folders |
| `rename` / `remove` folder | 3 + docs under it | 1–2 per doc under it |
| `readData` | 1 (+1 per log chunk) | 0 |
| `writeData` / `appendData` | 1 | 1 |
| `exportWorkspace` | every doc | 0 |

Rules for the app adapter:

1. **Debounce autosave by 2–3 s** (and flush on blur or unload). Saving on every keystroke would use up 20k writes a day within minutes of typing.
2. Debounce `.vault/srs.json` saves too. The desktop's 400 ms is fine for disk but too fast here, so aim for about 2 s, plus a flush when the review session ends.
3. On startup, call `listTree` **or** use `watch`'s first snapshot, not both. Each costs one read per note.
4. Keep note bodies cached in memory. Do not call `readNote` again on every tab switch.
5. Do not poll. Use `watch`, which only bills for changes.

About 1,000 notes, opened twice a day with a few hundred saves, uses roughly 3–5k reads and under 1k writes, well inside the free tier.

## Swapping to Postgres (or anything else)

1. Implement `CloudRepository` (for example `postgres/PostgresCloudRepository.ts`, or an HTTP client for your own API). Suggested tables:
   `notes(id uuid pk, ws text, path text, body text, updated_at timestamptz, size int, unique(ws, path))`,
   `folders(ws, path, pk(ws, path))`, `data(ws, key, text, pk(ws, key))` (no chunking needed), and
   `shares(id, owner_ws, kind, title, payload jsonb, created_at)`. A folder rename becomes one
   `UPDATE notes SET path = $to || substr(path, length($from) + 1) WHERE ws = $1 AND path LIKE $from || '/%'`.
2. Make it pass the contract: `runCloudRepositoryContract('Postgres', async () => ({ repo, ws }))`.
3. Implement `AuthProvider` for the new auth system. `getIdToken` is what the AI proxy verifies.
4. Migrate each user with `exportWorkspace(ws)` from Firebase, then call `mkdir` / `writeNote` / `writeData` on the new backend. Re-create shares with `getShare` + `createShare`, or keep share ids by inserting rows directly.
5. Delete `src/backend/cloud/firebase/` and the `firebase` dependency.

## Owner setup

1. Create a project at <https://console.firebase.google.com> (Spark plan, no billing needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.** Under *Settings → Authorized domains*, add your hosting domain (`localhost` is already there).
3. **Build → Firestore Database → Create database**: production mode, and pick a region near your users (it cannot be changed later).
4. **Project settings → General → Your apps → Web app (`</>`)**. Register it and copy the config values.
5. Copy `.env.example` to `.env` and fill in:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=<project>
   VITE_FIREBASE_APP_ID=...
   ```
   These values are public client identifiers, not secrets. The security rules are what protect the data.
6. Install the CLI (`npm i -g firebase-tools`), then `firebase login`, `cp .firebaserc.example .firebaserc`, and set the project id.
7. Deploy the rules and indexes with `firebase deploy --only firestore`.
8. To host the site, build the web bundle into `dist-web/` and run `firebase deploy --only hosting`.

### Local development with emulators (Java 11+ required)

```
firebase emulators:start --only firestore,auth --project demo-concrete
# in .env: VITE_FIREBASE_USE_EMULATOR=true, VITE_FIREBASE_PROJECT_ID=demo-concrete
```

Run the Firebase contract tests (with the real rules) against the emulators:

```
firebase emulators:exec --only firestore,auth --project demo-concrete "npx vitest run src/backend/cloud/firebase"
```

When `FIRESTORE_EMULATOR_HOST` is not set, a plain `npx vitest run` skips these tests.
