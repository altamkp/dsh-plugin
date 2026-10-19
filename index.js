/**
 * Keep the profile-wide default permission preset in step with the level the
 * user last selected in a session's Permissions control.
 *
 * `@deepseek-ai/dsh-permission-presets` pins `defaultPreset` — a volatile
 * Config field — into every genuinely fresh session. This bundle's patch seeds
 * that field to Full access, but the shipped product never writes a chatbox
 * switch back into it, so a user who moves one session to read-only would find
 * the next session back on the seeded value. This plugin closes that gap: each
 * deliberate change is persisted with `ctx.configEditor.edit()`, the same path
 * the Settings forms use, which writes the active profile patch and applies it
 * through the normal Loader path.
 *
 * Design points worth keeping:
 * - Initialization is not a change. A fresh session, a restored seed and every
 *   delegated child append `permission/preset` while being pinned, so a session's
 *   first settled preset only establishes a baseline. Without that, a child of a
 *   read-only parent would silently rewrite the default for everyone.
 * - Only configured presets are written. `custom` is derived from unmatched knob
 *   values and `auto` is a live integration the default schema excludes; neither
 *   is a level a default may name, and neither establishes a baseline, because a
 *   session legitimately reports `custom` in the window before its own pin.
 * - A write is skipped when the profile already pins that value, so switching
 *   back and forth costs nothing.
 * - Writes are attempted from session-event dispatches, never from work started
 *   during this plugin's own mount. The Loader tracks its reconciliation
 *   transaction in an AsyncLocalStorage, and every timer or promise created
 *   inside that transaction inherits it; the config editor rejects a write it
 *   considers nested ("HMR transactions cannot be nested") until the process
 *   reaches a fresh context. A session dispatch is such a context, and it is
 *   where the user's own switch arrives anyway. A refused write stays pending and
 *   is retried from a later dispatch, so a failure during a reload heals itself
 *   instead of being lost.
 * - The newest intent wins: switching twice quickly stores the level the user
 *   ended on, never the one they passed through.
 * - Registrations belong to this context, so unloading the plugin removes them.
 */

/** The plugin row whose `defaultPreset` field this bundle keeps current. */
const TARGET_PACKAGE = '@deepseek-ai/dsh-permission-presets'

/** Log events that can change a session's effective preset. */
const KNOB_EVENTS = new Set(['permission/preset', 'sandbox/mode', 'approval/policy'])

/**
 * Stored on first mount when nothing pins a default yet, so the seeded value
 * becomes a durable profile value instead of depending on the patch layer
 * staying in place. Any configured preset name works.
 */
const SEED_PRESET = 'danger-full-access'

/** Minimum gap between two write attempts, so a refused write cannot spin. */
const RETRY_GATE = 2000

export const inject = ['permissionPresets', 'configEditor', 'sessions']

export function apply(ctx) {
  const presets = ctx.permissionPresets
  const editor = ctx.configEditor

  /** Last settled preset seen for a session: its baseline. */
  const baseline = new WeakMap()

  /** Sessions whose baseline is known; a session reaches one on its first configured preset. */
  const settled = new WeakSet()

  /**
   * Presets a default may name: configured entries, never `custom` or `auto`.
   * The table is fixed for the lifetime of the plugin that owns it, so this is
   * read once.
   */
  const configurable = new Set(
    presets.catalog().defaultOptions.map((option) => option.value),
  )

  /** The newest preset the user asked to remember, if it is not stored yet. */
  let requested

  let inFlight = false
  let lastAttempt = 0

  const describe = (error) => (error instanceof Error ? error.message : String(error))

  /** The addressable Loader row this plugin writes through. */
  const targetEntry = () =>
    editor.entries().find((entry) => entry.options.name === TARGET_PACKAGE)

  /**
   * The value the profile patch itself pins, or undefined when the preset is
   * still only a lower-layer default. Comparing against it keeps writes
   * idempotent, and it is why the bundle patch may keep a static seed: a
   * profile-layer value always wins over one, and storing the seed's own value
   * is correctly treated by the editor as a reset to the inherited config.
   */
  const pinnedValue = () => {
    const row = editor
      .configuration()
      .find((candidate) => candidate.entry.options.name === TARGET_PACKAGE)
    return row?.override?.defaultPreset
  }

  const attempt = async (preset) => {
    try {
      const entry = targetEntry()
      if (entry === undefined)
        throw new Error(`${TARGET_PACKAGE} is not an addressable row in this profile`)
      await editor.edit(entry, (raw) => ({ ...raw, defaultPreset: preset }))
      if (requested === preset) requested = undefined
      ctx.logger.info(`default-permission: default preset is now "${preset}"`)
    } catch (error) {
      // The intent stays pending; a later dispatch retries it.
      ctx.logger.warn(
        `default-permission: could not store the default preset "${preset}": ${describe(error)}`,
      )
    }
  }

  /** Try to store the pending intent, at most once per retry gate. */
  const pump = () => {
    if (requested === undefined || inFlight) return
    const now = Date.now()
    if (now - lastAttempt < RETRY_GATE) return
    lastAttempt = now
    inFlight = true
    void attempt(requested).finally(() => {
      inFlight = false
    })
  }

  /** Remember one preset as the default for future sessions. */
  const remember = (preset) => {
    if (!configurable.has(preset)) {
      ctx.logger.debug(`default-permission: ignoring non-configurable preset "${preset}"`)
      return
    }
    let pinned
    try {
      pinned = pinnedValue()
    } catch (error) {
      ctx.logger.warn(`default-permission: could not read the stored default: ${describe(error)}`)
      return
    }
    if (pinned === preset) {
      if (requested === preset) requested = undefined
      return
    }
    requested = preset
    pump()
  }

  /**
   * Fold one session observation. A session's first configured preset is its
   * baseline; every later difference is a switch the user made in it.
   */
  const observe = (session) => {
    let preset
    try {
      preset = presets.current(session)
    } catch (error) {
      ctx.logger.debug(
        `default-permission: session has no permission state yet: ${describe(error)}`,
      )
      return
    }
    if (!configurable.has(preset)) {
      // `custom` and `auto` are not defaults, and reporting `custom` before a
      // session's own pin must not look like a change from a previous level.
      return
    }
    if (!settled.has(session)) {
      settled.add(session)
      baseline.set(session, preset)
      return
    }
    const previous = baseline.get(session)
    if (previous === preset) return
    baseline.set(session, preset)
    remember(preset)
  }

  // Sessions restored or created before this plugin mounted keep whatever level
  // they already carry; adopting it as a baseline keeps resuming old work from
  // being read as a change.
  for (const session of ctx.sessions.list()) observe(session)

  // Nothing has ever been stored: make the seed durable, so later reads do not
  // depend on the patch layer that supplied it. The write itself happens on the
  // first dispatch, because this mount runs inside a Loader transaction.
  try {
    if (pinnedValue() === undefined) requested = SEED_PRESET
  } catch (error) {
    ctx.logger.warn(`default-permission: could not read the stored default: ${describe(error)}`)
  }

  ctx.on('session/created', (session) => {
    observe(session)
    pump()
  })
  ctx.on('session/event', (session, event) => {
    if (KNOB_EVENTS.has(event.type)) observe(session)
    pump()
  })
}
