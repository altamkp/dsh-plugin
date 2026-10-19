# DSH Default Session Permission

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle that
decides which permission level new sessions start with — and keeps that default in
step with the level you last selected in the chatbox.

- New sessions start on **Full access** (完全权限) by default.
- Change the access level in the Permissions selector (or with `/permission`) and
  that level becomes the default for every session created afterwards.
- The value is stored in your profile's `cordis.patch.yml`, so it survives
  restarts and upgrades.

## How it works

Harness ships `@deepseek-ai/dsh-permission-presets`, which bundles a sandbox mode
with an approval policy into named presets (仅可查看 / 工作区内修改 / 完全权限).
Its `defaultPreset` Config field is what a genuinely fresh session is pinned to.

This bundle does two things:

1. **Seeds** that field to `danger-full-access` by overriding the shipped
   `permission` row in `cordis.patch.yml`.
2. **Records your choices**: `index.js` watches each session's permission events
   and writes the level you settled on back into `defaultPreset` through
   `ctx.configEditor.edit()` — the same supported path the Settings forms use.

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

Copy this directory anywhere and install it through the Harness plugin manager:

```yaml
# in the plugin manager: Install bundle → path to this directory
```

or add it to your profile's `package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@local/default-permission"]
    }
  },
  "dependencies": {
    "@local/default-permission": "link:/path/to/dsh-default-permission"
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
