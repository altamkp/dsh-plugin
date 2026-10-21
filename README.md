# @altamkp/dsh-plugin

altamkp's personal plugin collection for the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The collection is one package with one bundle patch, and every plugin inside it
is a subpath module that carries **its own name and description**:

| Plugin | Entry | What it does |
|---|---|---|
| Default session permission | `@altamkp/dsh-plugin/default-permission` | New sessions start on **Full access** (完全权限), and the level you last selected in the chatbox becomes the new default |
| Session notifications | `@altamkp/dsh-plugin/notifications` | A native desktop notification on Windows, macOS and Linux when a session needs you |
| Conversation width | `@altamkp/dsh-plugin/chat-width` | A **Conversation width** toggle in Settings → General that stretches the transcript to the full window width instead of wide empty margins |

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
├── notifications/
│   ├── index.js                  the Session notifications plugin
│   ├── notify.js                 the per-platform delivery
│   ├── windows.js                the Windows toast identity and its deep link
│   └── icon.svg                  the plugin's own icon
├── chat-width/
│   ├── index.js                  the Conversation width plugin (Host half)
│   ├── client.js                 its Web page half: the Settings slider
│   └── icon.svg                  the plugin's own icon
├── locale/
│   ├── en.json                   the collection's name and description
│   ├── zh.json
│   ├── default-permission/
│   │   ├── en.json               the plugin's own name and description
│   │   └── zh.json
│   └── notifications/
│       ├── en.json
│       └── zh.json
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

## Session notifications

A Harness session keeps working while you do something else, and the moment it
stops and waits for you is easy to miss. This plugin watches the live session
signals and raises a **native desktop notification** when a session needs you:

| Signal | Notification |
|---|---|
| the agent stopped working | *Task completed* |
| the agent asked a question | *The agent needs your answer* |
| the agent needs an approval | *The agent needs your approval* |
| a step failed | *The task failed* |

The notification carries the session's title, so you know which conversation is
calling.

### How each platform is reached

The Harness Host is a plain Node process, so the desktop shell's own
`Notification` API is not available to a plugin. Every platform therefore uses
the notification path the operating system already ships with:

| Platform | Mechanism | Click brings the app forward? |
|---|---|---|
| Windows | a WinRT toast raised by Windows PowerShell 5.1, shown under an identity the plugin registers for the app | **yes** — the toast carries the app's own deep link, and the app restores and focuses its window when that link is opened |
| macOS | `terminal-notifier` when it is installed, otherwise `osascript`'s `display notification` | only with `terminal-notifier`; the plain banner of `osascript` cannot report a click at all |
| Linux | a notification posted straight to the notification daemon over D-Bus, falling back to `notify-send` | **yes** — the daemon reports the click and the plugin opens the app's deep link |

No helper program is installed and nothing is written outside your profile.

### Clicking the notification

On Windows a toast is shown under an identity, and a click on the toast is
delivered to the application behind that identity. The identity of Windows
PowerShell — the process that raises the toast — has no application behind it,
so a click on such a toast can only ever open a console window, which is why
clicking the toast did nothing at all.

The plugin therefore registers an identity of its own, in the user's own
registry:

```
HKCU\Software\Classes\AppUserModelId\com.altamkp.dsh.notifications
    DisplayName = "DeepSeek Harness"
    IconUri     = the icon of the application
```

The toast is then shown as coming from the application, with the application's
icon, and it carries the application's deep link (`dsh://open`). A click on
the toast opens that link, and the application answers it by restoring its
window when it is minimised and focusing it. Nothing is started a second time
and no console window appears.

The deep link is registered by the application itself when it starts. When it
is missing, the plugin says so in the log and the toast only dismisses on a
click, which is the old behaviour.

On Linux the click is reported by the notification daemon, because that is the
only way to learn about it: the plugin asks the daemon to report the click and
opens the deep link itself. On macOS the plain `osascript` banner cannot report
a click at all — the Notification Center delivers a click to the application
that posted the banner, and a script has no such application — so the plugin
uses `terminal-notifier` when it is installed, and falls back to the banner
otherwise.

### While you are looking at the app

On Windows the toast helper also reads the foreground window. When the Harness
itself is in front, a *finished task* is not announced — you are already looking
at it. A question, an approval and a failure are always announced, because those
are the ones you must not miss. The foreground check is Windows-only; on macOS
and Linux every attention event produces a notification.

### Configuration

The plugin reads the row's `config` mapping in `cordis.patch.yml`. Every field
is optional:

```yaml
- id: notifications
  name: "@altamkp/dsh-plugin/notifications"
  config:
    appName: "DeepSeek Harness"   # the notification title
    appProcessName: "DeepSeek Harness"  # the foreground process that counts as "focused" (Windows)
    appPath: ""                    # the executable of the application; empty means "find it yourself"
    events:
      completed: true             # the task finished
      question: true              # the agent asked a question
      approval: true              # the agent needs an approval
      error: true                 # a step failed
    suppressWhenFocused: true     # stay quiet about a finished task while the app is in front
    clickToFocus: true            # a click on the toast brings the application to the front
    cooldownMs: 5000              # minimum gap between two notifications of one kind
    includeSubagents: false       # also notify for delegated child sessions
    messages:                     # your own notification texts
      completed: "Task completed"
      question: "The agent needs your answer"
      approval: "The agent needs your approval"
      error: "The task failed"
```

A profile-level patch for the row replaces the whole mapping, so restate the
fields you want to keep.

### Details that matter

- **Completion is an agent fact, not a turn fact.** The agent going idle is the
  one moment that means "this session is waiting for you"; a turn can end while
  the agent keeps working, and a goal run spans many turns.
- **Activity is observed, not assumed.** A session that was already working when
  the plugin mounted never reports "running", so completion is also keyed on
  committed session activity.
- **A pending question is not a finished task.** While the agent waits for an
  answer the question already produced its own notification, so the completion is
  dropped instead of reporting the same session twice.
- **Delegated children stay quiet.** A subagent session is internal work of
  another session; the session you are talking to reports for it. Set
  `includeSubagents: true` to hear from them too.
- **Delivery never breaks the session.** The notification happens after the
  fact, so a missing helper or a failing toast cannot disturb a running turn.
- **A click is part of the notification.** The toast is not only a message: it
  carries the way back to the application, so a click brings the Harness to
  the front instead of doing nothing. That is why the plugin registers an
  identity of its own on Windows instead of raising the toast as Windows
  PowerShell.

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
and never touches the app's own width preference. The plugin is Web-page-only
(`dsh.client` in `package.json`) — the Host half carries just the row, its
locale text and the icon.

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

Harness 0.2.1-rc.2 or newer. The permission plugin stays inactive rather than
throwing when `permissionPresets`, `configEditor` or `sessions` are absent; the
notifications plugin needs the `sessions` service and nothing else.

The desktop notification is raised with what the operating system already
ships: Windows PowerShell 5.1 on Windows, `osascript` on macOS and
`notify-send` on Linux. A click that brings the application to the front needs
a little more:

| Platform | Needs | Without it |
|---|---|---|
| Windows | nothing extra; the application registers its own deep link | the toast still arrives, a click only dismisses it |
| macOS | `terminal-notifier` (`brew install terminal-notifier`) | the banner arrives, a click dismisses it |
| Linux | `gdbus` (part of `libglib2.0-bin`, present on GNOME) | the plugin falls back to `notify-send`, a click dismisses it |

## License

MIT
