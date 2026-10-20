/**
 * Native desktop notifications for the three major desktop platforms.
 *
 * The Harness Host runs as a plain Node process (the Electron shell only owns
 * the window and the tray), so the shell's own `Notification` API is out of
 * reach from a Host plugin. Each platform therefore gets the notification
 * path its operating system already ships with:
 *
 * - **Windows** — a WinRT toast raised by Windows PowerShell 5.1. Windows
 *   only shows a toast for an identity it can resolve to an installed
 *   application; the desktop shell owns the "DeepSeek Harness" identity, but
 *   the Host is a different process and cannot borrow it, so the toast is
 *   attributed to "Windows PowerShell" and the notification title carries the
 *   application name.
 * - **macOS** — `osascript`'s `display notification`, the only built-in way to
 *   raise a Notification Center banner from a script.
 * - **Linux** — `notify-send` from libnotify, with `zenity --notification` as
 *   a fallback for installations without libnotify.
 *
 * The same Windows script also answers "is the Harness in the foreground?",
 * which lets the plugin stay quiet while the user is already looking at the
 * application. The check costs one `Add-Type` compilation and is folded into
 * the toast script, so a suppressed notification still costs a single process.
 */

import { spawn } from 'node:child_process'

/**
 * AppUserModelID of Windows PowerShell.
 *
 * It is registered on every Windows installation, which is exactly what
 * Windows requires before it shows a toast for a given identity.
 */
const WINDOWS_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

/**
 * The Windows helper.
 *
 * It reads its whole input from environment variables, so no user text ever
 * reaches the PowerShell parser, and it is passed with `-EncodedCommand`,
 * which also keeps the script itself free of quoting hazards.
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
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName('text')
[void]$texts.Item(0).AppendChild($xml.CreateTextNode($env:DSH_NOTIFY_TITLE))
[void]$texts.Item(1).AppendChild($xml.CreateTextNode($env:DSH_NOTIFY_BODY))
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
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
 * @param {string} [options.platform] - the platform to target; defaults to the running one.
 * @param {object} [options.logger] - the plugin logger.
 * @returns {{ describe: () => string, notify: (notification: { title: string, body: string, suppressIfFocused?: boolean }) => Promise<{ delivered: boolean, reason: string }> }}
 *   the notifier.
 */
export function createNotifier(options = {}) {
  const {
    appName = 'DeepSeek Harness',
    appProcessName = appName,
    platform = process.platform,
    logger,
  } = options

  /** Serializes the helper processes so a burst of events cannot fork a storm. */
  let queue = Promise.resolve()

  const describe = () => {
    if (platform === 'win32') return 'Windows toast (Windows PowerShell)'
    if (platform === 'darwin') return 'macOS notification (osascript)'
    if (platform === 'linux') return 'Linux notification (notify-send)'
    return `no native notification support for platform "${platform}"`
  }

  const showWindows = async ({ title, body, suppressIfFocused }) => {
    const env = {
      ...process.env,
      DSH_NOTIFY_TITLE: title,
      DSH_NOTIFY_BODY: body,
      DSH_NOTIFY_APPID: WINDOWS_APP_ID,
      DSH_NOTIFY_FOCUS: suppressIfFocused ? appProcessName : '',
    }
    const arguments_ = ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(WINDOWS_TOAST_SCRIPT)]
    const result = await run('powershell.exe', arguments_, env)
    if (!result.missing) return result
    // PowerShell 7 does not carry the WinRT projection, but it is worth one
    // attempt: a machine with the Windows App SDK installed can serve it.
    return run('pwsh.exe', arguments_, env)
  }

  const showMacos = async ({ title, body }) =>
    run('osascript', ['-e', MACOS_NOTIFY_SCRIPT, title, body])

  const showLinux = async ({ title, body }) => {
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

  return { describe, notify }
}
