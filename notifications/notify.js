/**
 * Native desktop notifications for the three major desktop platforms.
 *
 * The Harness Host runs as a plain Node process (the Electron shell only owns
 * the window and the tray), so the shell's own `Notification` API is out of
 * reach from a Host plugin. Each platform therefore gets the notification
 * path its operating system already ships with:
 *
 * - **Windows** — a WinRT toast raised by Windows PowerShell 5.1, shown under
 *   an identity the plugin registers for the application. The toast carries
 *   the application's own deep link, so a click on it opens that link and the
 *   application restores and focuses its window. See {@link ./windows.js}.
 * - **macOS** — `terminal-notifier` when it is installed, because it can open
 *   a link when the notification is clicked, and `osascript`'s
 *   `display notification` otherwise.
 * - **Linux** — a notification posted straight to the notification daemon over
 *   D-Bus, which is the only way to learn that the user clicked it; the
 *   daemon is asked to report the click and the plugin then opens the
 *   application's deep link. `notify-send` is the fallback.
 *
 * The same Windows script also answers "is the Harness in the foreground?",
 * which lets the plugin stay quiet while the user is already looking at the
 * application. The check costs one `Add-Type` compilation and is folded into
 * the toast script, so a suppressed notification still costs a single process.
 */

import { spawn } from 'node:child_process'

import { prepareActivationIdentity, WINDOWS_FALLBACK_APP_ID } from './windows.js'

/**
 * The deep link the application answers.
 *
 * The application registers the link itself and restores and focuses its
 * window when it is opened, which is the shortest way back to it.
 */
const DEEP_LINK = 'dsh://open'

/**
 * The Windows helper.
 *
 * It reads its whole input from environment variables, so no user text ever
 * reaches the PowerShell parser, and it is passed with `-EncodedCommand`,
 * which also keeps the script itself free of quoting hazards.
 *
 * The toast is built as plain XML: the template API cannot express a
 * protocol activation, and the content of a template cannot be loaded back
 * into a document. Every toast carries its own tag, because Windows replaces
 * the previous banner silently when two toasts share one.
 *
 * The focus probe compiles a tiny `user32` binding to read the foreground
 * window's process; when that process is the Harness itself the script exits
 * without showing anything.
 */
const WINDOWS_TOAST_SCRIPT = `$ErrorActionPreference = 'Stop'
$focus = $env:DSH_NOTIFY_FOCUS
if ($focus) {
    Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class DshNotifyFocus{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr hWnd,out uint processId);}'
    $foregroundId = 0
    [void][DshNotifyFocus]::GetWindowThreadProcessId([DshNotifyFocus]::GetForegroundWindow(), [ref]$foregroundId)
    $foregroundName = (Get-Process -Id $foregroundId -ErrorAction SilentlyContinue).ProcessName
    if ($foregroundName -and $foregroundName -eq $focus) {
        Write-Output 'suppressed'
        exit 0
    }
}
$title = [System.Security.SecurityElement]::Escape($env:DSH_NOTIFY_TITLE)
$body = [System.Security.SecurityElement]::Escape($env:DSH_NOTIFY_BODY)
$launch = $env:DSH_NOTIFY_LAUNCH
$activation = ''
if ($launch) { $activation = ' activationType="protocol" launch="' + $launch + '"' }
$xmlText = '<toast' + $activation + '><visual><binding template="ToastGeneric"><text id="1">' + $title + '</text><text id="2">' + $body + '</text></binding></visual></toast>'
$document = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml, ContentType = WindowsRuntime]::new()
$document.LoadXml($xmlText)
$toast = [Windows.UI.Notifications.ToastNotification]::new($document)
$toast.tag = [guid]::NewGuid().ToString('N')
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:DSH_NOTIFY_APPID).Show($toast)
Write-Output 'shown'`

/**
 * AppleScript that shows a Notification Center banner.
 *
 * The title and the body arrive as `argv`, never as script text, so session
 * titles cannot break out of the script.
 */
const MACOS_NOTIFY_SCRIPT = `on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run`

/**
 * Encode a script for `powershell.exe -EncodedCommand`.
 *
 * Windows PowerShell reads the command as UTF-16LE.
 *
 * @param {string} script - the PowerShell source.
 * @returns {string} the base64 encoded command.
 */
const encodeCommand = (script) => Buffer.from(script, 'utf16le').toString('base64')

/**
 * Quote a value for a GVariant argument.
 *
 * The notification daemon receives the value as GVariant, where a backslash
 * and a single quote have to be doubled, and a literal single quote is
 * written twice as well.
 *
 * @param {string} value - the value to quote.
 * @returns {string} the quoted value.
 */
const gvariant = (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`

/**
 * Run one helper process to completion.
 *
 * @param {string} command - the executable to run.
 * @param {string[]} args - its arguments.
 * @param {Record<string, string>} [env] - the environment of the child.
 * @returns {Promise<{ ok: boolean, code: number | null, stdout: string, stderr: string, missing: boolean }>}
 *   the outcome of the run; `missing` marks an executable that does not exist.
 */
const run = (command, args, env) =>
  new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    let child
    try {
      child = spawn(command, args, {
        // A console window must never flash on screen.
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(env === undefined ? {} : { env }),
      })
    } catch (error) {
      finish({
        ok: false,
        code: null,
        stdout,
        stderr: error instanceof Error ? error.message : String(error),
        missing: error?.code === 'ENOENT',
      })
      return
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      finish({
        ok: false,
        code: null,
        stdout,
        stderr: error instanceof Error ? error.message : String(error),
        missing: error?.code === 'ENOENT',
      })
    })
    child.on('close', (code) => {
      finish({ ok: code === 0, code, stdout, stderr, missing: false })
    })
  })

/**
 * Build the notifier for one platform.
 *
 * @param {object} options
 * @param {string} [options.appName] - the application name shown on the notification.
 * @param {string} [options.appProcessName] - the foreground process that counts as "the app is focused".
 * @param {string} [options.appPath] - the executable of the application.
 * @param {boolean} [options.clickToFocus] - whether a click on the toast has to focus the application.
 * @param {string} [options.platform] - the platform to target; defaults to the running one.
 * @param {object} [options.logger] - the plugin logger.
 * @returns {{ describe: () => string, notify: (notification: { title: string, body: string, suppressIfFocused?: boolean }) => Promise<{ delivered: boolean, reason: string }> }}
 *   the notifier.
 */
export function createNotifier(options = {}) {
  const {
    appName = 'DeepSeek Harness',
    appProcessName = appName,
    appPath,
    clickToFocus = true,
    platform = process.platform,
    logger,
  } = options

  /** Serializes the helper processes so a burst of events cannot fork a storm. */
  let queue = Promise.resolve()

  /**
   * The listener that learns about a click on a Linux notification.
   *
   * The notification daemon reports the click as a signal, and the daemon
   * itself cannot open the application, so the link is opened here.
   */
  let watcher
  const startWatcher = () => {
    if (platform !== 'linux' || watcher !== undefined) return
    let child
    try {
      child = spawn(
        'gdbus',
        [
          'monitor',
          '--session',
          '--dest',
          'org.freedesktop.Notifications',
          '--object-path',
          '/org/freedesktop/Notifications',
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      )
    } catch {
      return
    }
    let buffer = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.includes('ActionInvoked')) continue
        if (!line.includes("'default'")) continue
        void run('xdg-open', [DEEP_LINK])
      }
    })
    child.on('error', () => {
      watcher = undefined
    })
    watcher = child
  }

  /**
   * The identity a Windows toast is raised under, and the link a click on it
   * opens.
   *
   * Registering the identity takes a moment, so it is prepared in the
   * background and awaited by the first notification that needs it.
   */
  let identity
  const identityPromise =
    platform === 'win32' && clickToFocus
      ? prepareActivationIdentity({ appName, appProcessName, appPath, logger })
      : Promise.resolve({
          appId: WINDOWS_FALLBACK_APP_ID,
          launch: '',
          activated: false,
          reason: 'disabled',
        })
  void identityPromise.then((value) => {
    identity = value
  })

  const describe = () => {
    if (platform === 'win32') {
      const suffix = identity?.activated === true ? ', a click focuses the app' : ''
      return `Windows toast (Windows PowerShell)${suffix}`
    }
    if (platform === 'darwin') return 'macOS notification (osascript, terminal-notifier when installed)'
    if (platform === 'linux') return 'Linux notification (notify-send)'
    return `no native notification support for platform "${platform}"`
  }

  const showWindows = async ({ title, body, suppressIfFocused }) => {
    const current = await identityPromise
    const env = {
      ...process.env,
      DSH_NOTIFY_TITLE: title,
      DSH_NOTIFY_BODY: body,
      DSH_NOTIFY_APPID: current.appId,
      DSH_NOTIFY_LAUNCH: current.launch,
      DSH_NOTIFY_FOCUS: suppressIfFocused ? appProcessName : '',
    }
    const arguments_ = ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(WINDOWS_TOAST_SCRIPT)]
    const result = await run('powershell.exe', arguments_, env)
    if (!result.missing) return result
    // PowerShell 7 does not carry the WinRT projection, but it is worth one
    // attempt: a machine with the Windows App SDK installed can serve it.
    return run('pwsh.exe', arguments_, env)
  }

  const showMacos = async ({ title, body }) => {
    // terminal-notifier can open a link when the notification is clicked, and
    // the plain banner of osascript never can.
    const terminal = await run('terminal-notifier', [
      '-title',
      title,
      '-message',
      body,
      '-open',
      DEEP_LINK,
    ])
    if (!terminal.missing) return terminal
    return run('osascript', ['-e', MACOS_NOTIFY_SCRIPT, title, body])
  }

  const showLinux = async ({ title, body }) => {
    // The notification daemon is asked directly, because only that way the
    // click of the user is reported back.
    startWatcher()
    const posted = await run('gdbus', [
      'call',
      '--session',
      '--dest',
      'org.freedesktop.Notifications',
      '--object-path',
      '/org/freedesktop/Notifications',
      '--method',
      'org.freedesktop.Notifications.Notify',
      gvariant(appName),
      'uint32 0',
      "''",
      gvariant(title),
      gvariant(body),
      "['default', '']",
      "{'desktop-entry': <'deepseek-harness'>}",
      'int32 10000',
    ])
    if (!posted.missing) return posted
    const result = await run('notify-send', [`--app-name=${appName}`, title, body])
    if (!result.missing) return result
    // Installations without libnotify still ship zenity on most desktops.
    return run('zenity', ['--notification', `--text=${title}: ${body}`])
  }

  const deliver = async (notification) => {
    const { title, body, suppressIfFocused = false } = notification
    if (platform === 'win32') return showWindows({ title, body, suppressIfFocused })
    if (platform === 'darwin') return showMacos({ title, body })
    if (platform === 'linux') return showLinux({ title, body })
    return { ok: false, code: null, stdout: '', stderr: `unsupported platform "${platform}"`, missing: false }
  }

  const notify = async (notification) => {
    const result = await (queue = queue.then(() => deliver(notification), () => deliver(notification)))
    if (!result.ok) {
      const reason = result.missing
        ? 'no notification helper is installed'
        : result.stderr.trim() || `helper exited with code ${result.code}`
      logger?.warn(`notifications: could not show a desktop notification: ${reason}`)
      return { delivered: false, reason: 'failed' }
    }
    if (result.stdout.includes('suppressed')) return { delivered: false, reason: 'suppressed' }
    return { delivered: true, reason: 'shown' }
  }

  /** Stop the listener, when there is one. */
  const dispose = () => {
    if (watcher === undefined) return
    try {
      watcher.kill()
    } catch {
      // The listener is already gone.
    }
    watcher = undefined
  }

  return { describe, notify, dispose }
}
