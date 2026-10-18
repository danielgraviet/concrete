# MCP integrations

Concrete keeps MCP transports and server configuration in Electron and exposes narrow, typed operations to the renderer. A provider adapter translates between an MCP provider's configuration and each supported agent SDK. MCP is optional: connection failures are reported before an enabled agent run starts and do not disable other app features.

## Excalidraw

Concrete connects to the official remote server at `https://mcp.excalidraw.com`. Open **Settings → Agent** and use **Check Excalidraw connection** to verify network access and inspect the available tools. You can enable **Excalidraw MCP for agent runs** to make it available by default. In Agent chat, typing `@` offers an Excalidraw MCP suggestion; selecting it visibly marks the request and enables Excalidraw for that run. No local server installation is required.

The chat composer routes ordinary questions to chat and requests with `@agent` or `@excalidraw` to the agent, without a separate mode switch. Type `@` to see tool suggestions in the same composer. For example: “Use @excalidraw to create a diagram of a load balancer.” The agent calls Excalidraw's `read_me` and `create_view` tools, then saves the scene in the preferred Markdown note as an `excalidraw` fenced block. Existing blocks are revised in place. In Concrete, that block opens as an editable Excalidraw canvas and saves its scene JSON back into the note. The scene remains portable Markdown text and can be shared or versioned with the note.

The remote `create_view` tool is an MCP App preview. Agent SDKs do not embed that interactive MCP App in Concrete's chat, so the app's inline editor is the persistent editable surface. If the server is unavailable, the agent run returns a connection error; diagrams already stored in notes remain editable.

Example inline block shape:

````markdown
```excalidraw
{"type":"excalidraw","version":2,"source":"concrete","elements":[],"appState":{},"files":{}}
```
````

## Architecture boundary

```text
React UI (agent settings, Markdown code block editor)
       │ typed preload API
Electron main process
       ├── integration status probe and agent preflight
       └── provider adapter (URL and SDK configuration mapping)
                │ Streamable HTTP
                └── https://mcp.excalidraw.com

Markdown note ── fenced excalidraw JSON ── Excalidraw canvas editor
```

MCP SDK imports, transport setup, and server-specific error handling belong in `electron/integrations/`. Agent SDK configuration mapping belongs in the provider adapter. The renderer must not access `ipcRenderer`, MCP clients, or arbitrary server URLs. Markdown persistence remains owned by the editor and vault layers; the integration does not own note storage.

## Practices for future integrations

1. Keep each provider adapter focused under `electron/integrations/`; add shared contracts only when more than one provider needs them.
2. Expose only named, operation-specific APIs through preload. Validate paths and payloads in Electron main.
3. Make integrations optional and return readable errors for unavailable servers and unsupported operations.
4. Keep provider UI in its own feature module. Do not couple provider code to vault internals.
5. Use an **Adapter** when translating an MCP provider into app or SDK configuration. Add a **Strategy** only when the app chooses between multiple providers or transports, and a **Factory** only when constructing multiple implementations. Avoid a plugin registry until multiple implementations need one.
6. Document server URL, transport, setup, supported operations, failure behavior, and data ownership.

## Troubleshooting

- If **Check Excalidraw connection** fails, verify internet access and retry.
- If the agent does not call Excalidraw tools, check that MCP is enabled and that the selected agent is available.
- An `excalidraw` block with malformed JSON shows an error and the underlying code editor so it can be repaired.
