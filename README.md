# @altamkp/dsh-plugin

altamkp's personal plugin collection for the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The collection is one package with one bundle patch, and every plugin inside it
is a subpath module that carries **its own name and description**:

| Plugin | Entry | What it does |
|---|---|---|
| Conversation width | `@altamkp/dsh-plugin/chat-width` | A **Conversation width** toggle (对话宽度) in Settings → General that stretches the transcript to the full window width instead of wide empty margins |

The collection itself is named "altamkp's plugin" (中文: "altamkp 的插件"); the
plugin manager shows that name on the bundle, and each plugin's own name and
description on the row it mounts.

## Layout

```
dsh-plugin/
├── index.js                      the collection root (no plugin of its own)
├── cordis.patch.yml              the bundle patch: one row per plugin
├── chat-width/
│   ├── index.js                  the Conversation width plugin (Host half)
│   ├── client.js                 its Web page half: the Settings toggle
│   ├── package.json
│   └── icon.svg                  the plugin's own icon
├── locale/
│   ├── en.json                   the collection's name and description
│   ├── zh.json
│   └── chat-width/
│       ├── en.json
│       └── zh.json
└── icon.svg
```

Every plugin follows the same shape, the way `@deepseek-ai/dsh-plugin-manager`
and `@vectorize-io/hindsight-coding-agents` do:

1. The plugin lives in its own folder and is mounted as a subpath row in
   `cordis.patch.yml` (`name: '@altamkp/dsh-plugin/<plugin>'`).
2. `package.json` exports that subpath and its locale directory
   (`"./<plugin>/locale/*.json"`), so the Harness can read the plugin's display
   text without importing the plugin.
3. `locale/<plugin>/<lang>.json` holds the plugin's own `meta.title` and
   `meta.description`; `locale/<lang>.json` holds the collection's.

Adding a plugin means adding a folder, a locale directory, the two export
entries, and one row in the insert list of `cordis.patch.yml`.

## Seeded default permission

Harness ships `@deepseek-ai/dsh-permission-presets`, which bundles a sandbox mode
with an approval policy into named presets (仅可查看 / 工作区内修改 / 完全权限).
Its `defaultPreset` Config field is what a genuinely fresh session is pinned to.
This bundle seeds that field to `danger-full-access` by overriding the shipped
`permission` row in `cordis.patch.yml`, so new sessions start with Full access.

The seed is the only thing this bundle does about permissions: it no longer
records the level you pick in the chatbox, so the level stays exactly what the
seed says until you change the seed itself. See
[Change the seeded default](#change-the-seeded-default) below.

## Conversation width

The Web UI centers the conversation on a fixed-width column, which leaves two
large empty margins on a wide window. This plugin adds a **Conversation width**
row (对话宽度) in **Settings → General**: a toggle that stretches the transcript
and composer to the full conversation-column width. Off (the default) restores
the centered layout.

While enabled, the plugin pins the same custom property the app itself consumes
(`--dsh-chat-user-width` on the conversation body) to the full column width and
re-asserts it whenever the app republishes its own value (mount, resize, edge
drag). The preference is stored in `localStorage["dsh.conversation.fullWidth"]`
and never touches the app's own width preference. The browser half lives in
`chat-width/client.js`; the Host half carries just the row, its locale text and
the icon.

### Where the browser half lives

The Web module roster only resolves *bare package-root* row names, so a browser
half can only reach the page through the collection root. The collection root is
therefore the client carrier: its `dsh.client` declaration points at
`exports["./client"]`, which is `chat-width/client.js`, and the patch mounts
the root as a no-op Host row:

```yaml
- insert:
    - id: chat-width-client
      name: "@altamkp/dsh-plugin"
```

The plugin manager lists that carrier row as a second component of the bundle,
named after the collection itself — it is the collection's own row, not a
separate plugin. The Conversation width row in Settings → General is registered
by that browser half, through the `settings.general.item` slot.

## Install

Add it to your profile's `package.json` and let the Harness fetch it from
GitHub:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@altamkp/dsh-plugin"]
    }
  },
  "dependencies": {
    "@altamkp/dsh-plugin": "github:altamkp/dsh-plugin"
  }
}
```

The `github:` specifier resolves to the default branch's tarball, so the
lockfile pins the exact commit that was installed. Re-running the install
picks up newer commits.

While working on the plugin itself, a local link keeps the installed copy in
step with your working tree instead of the published one:

```json
{
  "dependencies": {
    "@altamkp/dsh-plugin": "link:/path/to/dsh-plugin"
  }
}
```

You can also install it through the Harness plugin manager (Install bundle →
path to this directory). Then restart the Harness, or toggle the bundle off
and on in the plugin manager.

## Change the seeded default

Edit `cordis.patch.yml` and set `defaultPreset` to any configured preset
(`read-only`, `workspace-write` or `danger-full-access`):

```yaml
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    defaultPreset: workspace-write   # ← your starting level
```

Once you change a level in the chatbox, the profile patch pins that value and
shadows this seed. Nothing in this bundle changes that level any more, so the
seed is what every fresh session starts on until you change it here. To go back
to the seed, delete the `- id: permission` block from your profile's
`cordis.patch.yml`.

## Requirements

Harness 0.2.1-rc.2 or newer.

The Conversation width plugin needs the Web page: it registers its row through
the `locale` and `slots` services in the browser, and it degrades on its own
when one of them is missing — a missing locale service only costs the
dictionary, a missing slots service only costs the Settings row.

## License

MIT
