/**
 * The Windows notification identity.
 *
 * A toast is shown under an AppUserModelID, and that identity is also what a
 * click on the toast is delivered to. The identity of Windows PowerShell, the
 * process that raised the toast, has no application behind it, so a click on
 * the toast could only ever open a console window.
 *
 * The plugin therefore registers an identity of its own:
 *
 *   HKCU\Software\Classes\AppUserModelId\com.altamkp.dsh.notifications
 *       DisplayName = the name of the application
 *       IconUri     = the icon of the application
 *
 * The registration is what gives the toast its origin: the toast is shown as
 * coming from the application instead of from Windows PowerShell.
 *
 * A click is handled by a *protocol activation*: the toast carries the
 * application's own deep link, and Windows opens that link. The application
 * answers the link by restoring and focusing its own window, which is exactly
 * what the user expects from a click on the toast.
 */

import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * The AppUserModelID of Windows PowerShell.
 *
 * It is the fallback: it always resolves, so a toast is always shown, but a
 * click on it cannot reach the application.
 */
export const WINDOWS_FALLBACK_APP_ID =
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

/**
 * The AppUserModelID this plugin registers for itself.
 */
export const WINDOWS_ACTIVATION_APP_ID = 'com.altamkp.dsh.notifications'

/**
 * The deep link the desktop application answers.
 *
 * The application registers the link itself and restores and focuses its
 * window when it is opened.
 */
const WINDOWS_DEEP_LINK_SCHEME = 'dsh'

/**
 * The shell helper that registers the identity.
 *
 * The script reads its whole input from environment variables, so no user text
 * ever reaches the PowerShell parser.
 */
const REGISTER_SCRIPT = `$ErrorActionPreference = 'Stop'
$appId = $env:DSH_NOTIFY_APPID
$display = $env:DSH_NOTIFY_DISPLAY
$icon = $env:DSH_NOTIFY_ICON
$scheme = $env:DSH_NOTIFY_SCHEME

$key = 'HKCU:\\Software\\Classes\\AppUserModelId\\' + $appId
if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
New-ItemProperty -Path $key -Name 'DisplayName' -Value $display -PropertyType String -Force | Out-Null
if ($icon) {
    New-ItemProperty -Path $key -Name 'IconUri' -Value $icon -PropertyType String -Force | Out-Null
}

# The deep link only works when the application registered it, which it does
# for itself as soon as it starts.
$command = 'HKCU:\\Software\\Classes\\' + $scheme + '\\shell\\open\\command'
if (Test-Path -LiteralPath $command) { Write-Output 'linked' } else { Write-Output 'plain' }`

/**
 * Run one helper process to completion.
 *
 * @param {string} command - the executable to run.
 * @param {string[]} args - its arguments.
 * @param {Record<string, string>} env - the environment of the child.
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string }>} the outcome.
 */
const run = (command, args, env) =>
  new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
    } catch (error) {
      resolve({ ok: false, stdout, stderr: error instanceof Error ? error.message : String(error) })
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
      resolve({ ok: false, stdout, stderr: error instanceof Error ? error.message : String(error) })
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr })
    })
  })

/**
 * Find the executable of the desktop application.
 *
 * The Host runs as a child of the desktop shell, so its own executable is the
 * Harness itself. A Host that was started on its own, for example to serve
 * the web interface in a browser, has no window to focus and is left alone.
 *
 * @param {object} options
 * @param {string} [options.appPath] - an explicit path to the application.
 * @param {string} options.appProcessName - the process name of the application.
 * @returns {string | undefined} the executable, or undefined when there is none.
 */
export const findApplication = ({ appPath, appProcessName }) => {
  if (typeof appPath === 'string' && appPath !== '') return appPath
  const executable = process.execPath
  if (typeof executable !== 'string' || executable === '') return undefined
  const name = basename(executable, '.exe')
  if (name.toLowerCase() !== appProcessName.toLowerCase()) return undefined
  return executable
}

/**
 * Register the identity the toast is shown under.
 *
 * The work happens once per session and the result is the AppUserModelID the
 * toast carries and the deep link a click on the toast opens.
 *
 * @param {object} options
 * @param {string} options.appName - the name the toast is attributed to.
 * @param {string} options.appProcessName - the process name of the application.
 * @param {string} [options.appPath] - an explicit path to the application.
 * @param {object} [options.logger] - the plugin logger.
 * @returns {Promise<{ appId: string, launch: string, activated: boolean, reason: string }>} the identity.
 */
export const prepareActivationIdentity = async ({
  appName,
  appProcessName,
  appPath,
  logger,
}) => {
  const fallback = {
    appId: WINDOWS_FALLBACK_APP_ID,
    launch: '',
    activated: false,
    reason: 'fallback',
  }

  const target = findApplication({ appPath, appProcessName })
  if (target === undefined) {
    logger?.debug('notifications: no application executable, using the plain toast')
    return { ...fallback, reason: 'no-application' }
  }

  const result = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', REGISTER_SCRIPT],
    {
      ...process.env,
      DSH_NOTIFY_APPID: WINDOWS_ACTIVATION_APP_ID,
      DSH_NOTIFY_DISPLAY: appName,
      DSH_NOTIFY_ICON: target,
      DSH_NOTIFY_SCHEME: WINDOWS_DEEP_LINK_SCHEME,
    },
  )

  if (!result.ok) {
    const reason = result.stderr.trim() || 'the shell helper failed'
    logger?.warn(`notifications: could not register the toast identity: ${reason}`)
    return { ...fallback, reason: 'failed' }
  }

  const linked = result.stdout.includes('linked')
  if (!linked) {
    logger?.warn(
      'notifications: the application does not answer a deep link, a click on the toast only dismisses it',
    )
    return { appId: WINDOWS_ACTIVATION_APP_ID, launch: '', activated: false, reason: 'plain' }
  }

  logger?.info('notifications: a click on the toast brings the application to the front')
  return {
    appId: WINDOWS_ACTIVATION_APP_ID,
    launch: `${WINDOWS_DEEP_LINK_SCHEME}://open`,
    activated: true,
    reason: 'ready',
  }
}
