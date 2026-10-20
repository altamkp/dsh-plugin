/**
 * Desktop notifications for sessions that need attention.
 *
 * A Harness session is usually left running while the user works in another
 * application, so the moment a session stops working and waits for the user
 * is easy to miss. This plugin watches the live session signals and raises a
 * native desktop notification for the moments that need a person:
 *
 * | Signal | Notification |
 * |---|---|
 * | the agent stopped working | the task is finished |
 * | the agent asked a question | an answer is needed |
 * | the agent needs an approval | a decision is needed |
 * | a step failed | the task broke |
 *
 * Design points worth keeping:
 * - **Completion is an agent fact, not a turn fact.** The agent going idle is
 *   the one moment that means "this session is waiting for you"; a turn can
 *   end while the agent keeps working, and a goal run spans many turns.
 * - **Activity is observed, not assumed.** A session that was already working
 *   when this plugin mounted never reports "running", so completion is keyed
 *   on committed session activity as well: a session that committed anything
 *   since the last idle moment is a session that has something to report.
 * - **A pending question is not a finished task.** While the agent waits for
 *   an answer it is not idle, and if it is idle anyway the question already
 *   produced its own notification, so the completion is dropped instead of
 *   reporting the same session twice.
 * - **Delegated children stay quiet.** A subagent session is internal work of
 *   another session; the session the user is talking to reports for it.
 * - **Delivery never breaks the session.** Everything runs after the fact: a
 *   missing notification helper, a failing toast or a slow machine can no
 *   more disturb a running turn than a slow log write would.
 * - **The plugin stays quiet while the user is looking at the app.** On
 *   Windows the toast helper checks the foreground window and drops a
 *   "task finished" notification when the Harness itself is in front. The
 *   question, approval and error notifications always go out, because those
 *   are the ones a user must not miss.
 * - **A click is part of the notification.** The toast is not only a
 *   message, it also carries the way back to the application: a click on it
 *   brings the Harness to the front. On Windows that means the toast is
 *   raised under an identity the plugin registers for the application and
 *   carries the application's own deep link; on Linux the notification
 *   daemon reports the click and the plugin opens that link; on macOS it
 *   needs `terminal-notifier`, because the plain banner of `osascript`
 *   cannot report a click at all.
 *
 * The plugin carries no dependency and declares no Config schema, so it stays
 * installable as a linked local package. Its options are read from the row's
 * `config` mapping and merged over {@link DEFAULTS}; see the README for the
 * full list.
 */

import { createNotifier } from './notify.js'

/** The session store is the one service this plugin cannot work without. */
export const inject = ['sessions']

/**
 * The default configuration.
 *
 * A row's `config` mapping overrides these values field by field, and the two
 * nested groups are merged key by key, so a user can switch one kind of
 * notification off without restating the rest.
 */
const DEFAULTS = {
  /** Title shown on the desktop notification. */
  appName: 'DeepSeek Harness',
  /**
   * Process name of the foreground window that counts as "the Harness has
   * focus". Only the Windows helper can answer that question.
   */
  appProcessName: 'DeepSeek Harness',
  /**
   * The executable a click on the toast has to launch.
   *
   * Empty means "find it yourself", which works whenever the plugin runs
   * inside the desktop application.
   */
  appPath: '',
  /**
   * Let a click on the toast bring the application to the front.
   */
  clickToFocus: true,
  /** Which kinds of attention produce a notification. */
  events: {
    completed: true,
    question: true,
    approval: true,
    error: true,
  },
  /** Stay quiet about a finished task while the Harness window has focus. */
  suppressWhenFocused: true,
  /** Minimum gap in milliseconds between two notifications of one kind. */
  cooldownMs: 5000,
  /** Also notify for delegated child sessions. */
  includeSubagents: false,
  /** The notification texts, editable for another language. */
  messages: {
    completed: 'Task completed',
    question: 'The agent needs your answer',
    approval: 'The agent needs your approval',
    error: 'The task failed',
  },
}

/**
 * Read one string field.
 *
 * @param {unknown} value - the configured value.
 * @param {string} fallback - the value to use when the configuration is absent or of another type.
 * @returns {string} the effective value.
 */
const text = (value, fallback) => (typeof value === 'string' && value !== '' ? value : fallback)

/**
 * Read one boolean field.
 *
 * @param {unknown} value - the configured value.
 * @param {boolean} fallback - the value to use when the configuration is absent or of another type.
 * @returns {boolean} the effective value.
 */
const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback)

/**
 * Read one numeric field.
 *
 * @param {unknown} value - the configured value.
 * @param {number} fallback - the value to use when the configuration is absent or of another type.
 * @returns {number} the effective value.
 */
const count = (value, fallback) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback

/**
 * Merge one nested group of flags or texts.
 *
 * @param {unknown} value - the configured group.
 * @param {Record<string, boolean>} [flags] - the defaults of a flag group.
 * @param {Record<string, string>} [texts] - the defaults of a text group.
 * @returns {Record<string, boolean> | Record<string, string>} the effective group.
 */
const group = (value, flags, texts) => {
  const source = typeof value === 'object' && value !== null ? value : {}
  const result = {}
  for (const [key, fallback] of Object.entries(flags ?? texts ?? {})) {
    const own = source[key]
    result[key] = texts === undefined ? flag(own, fallback) : text(own, fallback)
  }
  return result
}

/**
 * Read the row's configuration.
 *
 * @param {unknown} raw - the raw row configuration.
 * @returns {typeof DEFAULTS} the effective configuration.
 */
export const readConfig = (raw) => {
  const source = typeof raw === 'object' && raw !== null ? raw : {}
  return {
    appName: text(source.appName, DEFAULTS.appName),
    appProcessName: text(source.appProcessName, DEFAULTS.appProcessName),
    appPath: text(source.appPath, DEFAULTS.appPath),
    clickToFocus: flag(source.clickToFocus, DEFAULTS.clickToFocus),
    events: group(source.events, DEFAULTS.events),
    suppressWhenFocused: flag(source.suppressWhenFocused, DEFAULTS.suppressWhenFocused),
    cooldownMs: count(source.cooldownMs, DEFAULTS.cooldownMs),
    includeSubagents: flag(source.includeSubagents, DEFAULTS.includeSubagents),
    messages: group(source.messages, undefined, DEFAULTS.messages),
  }
}

/**
 * Mount the plugin.
 *
 * @param {object} ctx - the plugin context.
 * @param {unknown} config - the row's configuration.
 */
export function apply(ctx, config) {
  const settings = readConfig(config)
  const notifier = createNotifier({
    appName: settings.appName,
    appProcessName: settings.appProcessName,
    appPath: settings.appPath,
    clickToFocus: settings.clickToFocus,
    logger: ctx.logger,
  })

  /** Sessions that reported that they are running. */
  const busy = new Set()

  /** Sessions that committed something since they were last seen idle. */
  const active = new Set()

  /** Sessions whose agent is waiting for the user to answer or to approve. */
  const waiting = new Set()

  /** Last notification time per session and kind, for the cooldown. */
  const notified = new Map()

  ctx.logger.info(`notifications: desktop notifications through ${notifier.describe()}`)

  // The listener that learns about a click has to be stopped with the plugin.
  ctx.on('dispose', () => {
    notifier.dispose()
  })

  const describe = (error) => (error instanceof Error ? error.message : String(error))

  /** The session's current title, when the title service can supply one. */
  const titleOf = (session) => {
    const titles = ctx.get('sessionTitle')
    if (titles === undefined) return undefined
    try {
      return titles.get(session)?.title
    } catch (error) {
      ctx.logger.debug(`notifications: could not read the session title: ${describe(error)}`)
      return undefined
    }
  }

  /**
   * Raise one notification.
   *
   * Nothing here is allowed to escape: a notification is an extra courtesy,
   * never a reason to disturb the session that caused it.
   */
  const announce = (kind, sessionId) => {
    try {
      if (settings.events[kind] !== true) return
      if (sessionId === undefined) return
      const session = ctx.sessions.get(sessionId)
      if (session === undefined) return
      if (!settings.includeSubagents && session.header.origin === 'subagent') return

      const key = `${sessionId} ${kind}`
      const now = Date.now()
      const previous = notified.get(key)
      if (previous !== undefined && now - previous < settings.cooldownMs) return
      notified.set(key, now)

      const message = settings.messages[kind] ?? kind
      const name = titleOf(session)
      const body = name === undefined || name === '' ? message : `${message} · ${name}`

      void notifier
        .notify({
          title: settings.appName,
          body,
          // A finished task is the noisy kind; a question or a failure is not.
          suppressIfFocused: kind === 'completed' && settings.suppressWhenFocused,
        })
        .then((outcome) => {
          if (outcome.delivered) ctx.logger.info(`notifications: ${kind} — ${body}`)
          else if (outcome.reason === 'suppressed')
            ctx.logger.debug(`notifications: ${kind} for ${sessionId} skipped, the app has focus`)
        })
    } catch (error) {
      ctx.logger.warn(`notifications: could not announce "${kind}": ${describe(error)}`)
    }
  }

  /** Remember that a session started working again. */
  const resumed = (sessionId) => {
    busy.add(sessionId)
    active.add(sessionId)
    waiting.delete(sessionId)
  }

  /** Report a session that stopped working. */
  const settled = (sessionId) => {
    const wasBusy = busy.delete(sessionId)
    const wasActive = active.delete(sessionId)
    if (!wasBusy && !wasActive) return
    if (waiting.has(sessionId)) {
      // The question or the approval already reported this session.
      waiting.delete(sessionId)
      return
    }
    announce('completed', sessionId)
  }

  // The agent's own status is the completion signal: "idle" means no driver
  // remains scheduled or active, which is exactly "this session waits for you".
  ctx.on('agent/status', (payload) => {
    const agent = payload?.agent
    if (agent === undefined) return
    if (payload.status === 'running') resumed(agent.id)
    else settled(agent.id)
  })

  // The session registry reports the same transition from its own side. It
  // covers the agents this plugin never saw start, and the cooldown keeps the
  // two reports from turning into two notifications.
  ctx.on('api-session/status', (sessionId, running) => {
    if (running) resumed(sessionId)
    else settled(sessionId)
  })

  // Committed activity proves that a session has something to report even
  // when this plugin mounted while the agent was already working.
  ctx.on('session/event', (session) => {
    active.add(session.id)
  })

  // A question reaches the user through the answerer; the notification is
  // raised while the question is still pending, so it must not wait for the
  // answer to arrive.
  ctx.on('user-questions/request', (request, next) => {
    const sessionId = request?.agent?.id
    if (sessionId !== undefined) {
      waiting.add(sessionId)
      announce('question', sessionId)
    }
    return next()
  })

  ctx.on('approval/request', (request, next) => {
    const sessionId = request?.agent?.id
    if (sessionId !== undefined) {
      waiting.add(sessionId)
      announce('approval', sessionId)
    }
    return next()
  })

  ctx.on('agent/error', (payload) => {
    const sessionId = payload?.agent?.id
    if (sessionId !== undefined) announce('error', sessionId)
  })

  ctx.on('api-session/error', (sessionId) => {
    announce('error', sessionId)
  })
}
