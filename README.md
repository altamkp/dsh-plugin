# @altamkp/dsh-plugin

altamkp's personal plugin collection for the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The collection is one package with one bundle patch, and every plugin inside it
is a subpath module that carries **its own name and description**:

| Plugin | Entry | What it does |
|---|---|---|
| Default session permission | `@altamkp/dsh-plugin/default-permission` | New sessions start on **Full access** (完全权限), and the level you last selected in the chatbox becomes the new default |

The collection itself is named "altamkp's plugin" (中文: "altamkp 的插件"); the
plugin manager shows that name on the bundle, and each plugin's own name and
description on the row it mounts.

## Layout

```
dsh-plugin/
├── index.js                      the collection root (no plugin of its own)
├── cordis.patch.yml              the bundle patch: one row per plugin
├── default-permission/
│   └── index.js                  the Default session permission plugin
├── locale/
│   ├── en.json                   the collection's name and description
│   ├── zh.json
│   └── default-permission/
│       ├── en.json               the plugin's own name and description
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

## Default session permission

Harness ships `@deepseek-ai/dsh-permission-presets`, which bundles a sandbox mode
with an approval policy into named presets (仅可查看 / 工作区内修改 / 完全权限).
Its `defaultPreset` Config field is what a genuinely fresh session is pinned to.
This plugin does two things with it:

1. **Seeds** that field to `danger-full-access` by overriding the shipped
   `permission` row in `cordis.patch.yml`, so new sessions start with Full access.
2. **Records your choices**: `default-permission/index.js` watches each session's
   permission events and writes the level you settled on back into
   `defaultPreset` through `ctx.configEditor.edit()` — the same supported path
   the Settings forms use. The value lands in your profile's `cordis.patch.yml`,
   so it survives restarts.

Change the access level in the Permissions selector (or with `/permission`) and
that level becomes the default for every session created afterwards.

### Details that matter

- **Initialization is not a change.** A fresh session, a restored seed and every
  delegated child append a preset while being pinned. A session's *first* settled
  preset only establishes a baseline, so a child of a read-only parent never
  hijacks the global default.
- **`custom` and `auto` are never stored.** Neither is a level a default may
  name; `custom` is also what a session briefly reports before its own pin.
- **Writes happen from session-event dispatches.** The Loader tracks its
  reconciliation transaction in an `AsyncLocalStorage`, so work started during a
  mount or reload inherits that context and `configEditor.edit()` refuses it as
  nested. Session dispatches are outside it — and are where your own switch
  arrives anyway. A refused write stays pending and is retried from a later
  dispatch.
- **Last intent wins**, so switching twice quickly stores the level you ended on.
- Storing a value equal to the inherited one is a reset: the editor removes the
  profile row, handing control back to the bundle's seed.

## Install

Copy this repository anywhere and install it through the Harness plugin manager
(Install bundle → path to this directory), or add it to your profile's
`package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@altamkp/dsh-plugin"]
    }
  },
  "dependencies": {
    "@altamkp/dsh-plugin": "link:/path/to/dsh-plugin"
  }
}
```

Then restart the Harness, or toggle the bundle off and on in the plugin manager.

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
shadows this seed. To go back to the seed, delete the `- id: permission` block
from your profile's `cordis.patch.yml`.

## Requirements

Harness 0.2.1-rc.2 or newer (the `permissionPresets` service and its
`defaultPreset` field). The plugin stays inactive rather than throwing when
`permissionPresets`, `configEditor` or `sessions` are absent.

## License

MIT
