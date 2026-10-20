/**
 * altamkp's plugin collection for the DeepSeek Harness.
 *
 * The collection root carries no plugin of its own. Every plugin in it is a
 * subpath module with its own name and description, so the Harness plugin
 * manager can tell the collection apart from the plugins inside it:
 *
 * | Plugin | Module |
 * |---|---|
 * | Default session permission | `@altamkp/dsh-plugin/default-permission` |
 *
 * The bundle patch (`cordis.patch.yml`) inserts one row per plugin, and each
 * row's display text comes from that plugin's own locale directory
 * (`locale/<plugin>/<lang>.json`).
 */

/** The plugins this collection ships, by their module subpath. */
export const plugins = ['default-permission']
