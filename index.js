/**
 * altamkp's plugin collection for the DeepSeek Harness.
 *
 * The collection root carries no plugin of its own. Every plugin in it is a
 * subpath module with its own name and description, so the Harness plugin
 * manager can tell the collection apart from the plugins inside it:
 *
 * | Plugin | Module |
 * |---|---|
 * | Conversation width | `@altamkp/dsh-plugin/chat-width` |
 *
 * The bundle patch (`cordis.patch.yml`) inserts one row per plugin, and each
 * row's display text comes from that plugin's own locale directory
 * (`locale/<plugin>/<lang>.json`).
 */

/** The plugins this collection ships, by their module subpath. */
export const plugins = ['chat-width']

/**
 * No-op Host half for the collection root. The root is mounted as a Loader
 * row only so its `dsh.client` declaration (the Conversation width browser
 * half, exported as "./client") reaches the Web page; it contributes no Host
 * behavior of its own.
 */
export function apply() {}
