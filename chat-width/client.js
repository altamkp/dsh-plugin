/**
 * Conversation width — Web page half.
 *
 * The Harness already stores a transcript width preference in
 * `localStorage["dsh.conversation.contentWidth"]` (px) and applies it as the
 * `--dsh-chat-user-width` custom property on the conversation body whenever
 * the column is measured or an edge handle is dragged. This plugin adds the
 * missing visible control: a slider in Settings → General that reads and
 * writes that same preference, so the built-in drag handles and this setting
 * always agree, plus a Default entry that removes the preference again.
 */

window.__ModuleLoader__.load({
  id: '@altamkp/dsh-plugin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = '@altamkp/dsh-plugin/chat-width';
    /** Same key the shipped conversation width handles persist to. */
    const WIDTH_KEY = 'dsh.conversation.contentWidth';
    /** Matches the app's own floor and edge budget (ConversationWidthControls). */
    const CONTENT_MIN = 640;
    const EDGE_BUDGET = 176;
    const SLIDER_MAX = 2000;
    const SLIDER_STEP = 10;

    const DICT = {
      en: {
        'chatwidth.title': 'Conversation width',
        'chatwidth.desc.default': 'Follows the window (the shipped default). Drag either edge of the transcript, or use this slider, to pin a width.',
        'chatwidth.desc.value': 'The transcript is pinned to {width} px. Drag either edge of the transcript or use this slider to change it.',
        'chatwidth.reset': 'Default',
      },
      zh: {
        'chatwidth.title': '对话宽度',
        'chatwidth.desc.default': '跟随窗口（默认）。拖动对话两侧边缘或使用此滑块可固定宽度。',
        'chatwidth.desc.value': '对话内容固定为 {width} 像素。拖动对话两侧边缘或使用此滑块可调整。',
        'chatwidth.reset': '默认',
      },
    };

    const css = [
      '.akp-cw-row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}',
      '.akp-cw-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}',
      '.akp-cw-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
      '.akp-cw-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}',
      '.akp-cw-control{align-items:center;gap:10px;display:flex;flex:none}',
      '.akp-cw-value{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;min-width:64px;text-align:right;font-variant-numeric:tabular-nums}',
      '.akp-cw-slider{width:180px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.akp-cw-reset{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:28px;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;border:none;padding:0 10px;font-size:12px;line-height:18px}',
      '.akp-cw-reset:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    ].join('\n');

    /** Read the stored preference, or null when absent or corrupt. */
    function readPreference() {
      try {
        const raw = localStorage.getItem(WIDTH_KEY);
        if (raw === null) return null;
        const value = Number(raw);
        return Number.isFinite(value) && value > 0 ? value : null;
      } catch {
        return null;
      }
    }

    /**
     * Apply a preference (or null for default) to every live conversation
     * body — the same property, on the same element, the app itself sets.
     */
    function applyWidth(preference) {
      const carriers = document.querySelectorAll('[style*="--dsh-conversation-column-width"]');
      let applied = false;
      carriers.forEach((el) => {
        const column = Number.parseFloat(el.style.getPropertyValue('--dsh-conversation-column-width'))
          || el.offsetWidth;
        if (preference === null) {
          el.style.removeProperty('--dsh-chat-user-width');
        } else {
          const max = Math.max(CONTENT_MIN, column - EDGE_BUDGET);
          const resolved = Math.min(Math.max(preference, CONTENT_MIN), max);
          el.style.setProperty('--dsh-chat-user-width', `${resolved}px`);
        }
        applied = true;
      });
      // No conversation is mounted (Settings is a separate panel): stage the
      // value on the root so it holds until the app republishes on mount.
      if (preference !== null && !applied) {
        document.documentElement.style.setProperty('--dsh-chat-user-width', `${preference}px`);
      } else {
        document.documentElement.style.removeProperty('--dsh-chat-user-width');
      }
    }

    function WidthRow({ t }) {
      const tr = (key, params) => {
        const lookup = typeof t === 'function' ? t : (k) => DICT.en[k] || k;
        const text = lookup(key) || DICT.en[key] || key;
        if (params && params.width !== undefined) return String(text).replace('{width}', String(params.width));
        return text;
      };
      const [preference, setPreference] = React.useState(readPreference);

      const commit = (value) => {
        try {
          if (value === null) localStorage.removeItem(WIDTH_KEY);
          else localStorage.setItem(WIDTH_KEY, String(value));
        } catch { /* storage unavailable; live preview still works */ }
        setPreference(value);
        applyWidth(value);
      };

      const description = preference === null
        ? tr('chatwidth.desc.default')
        : tr('chatwidth.desc.value', { width: preference });

      return h('div', { className: 'akp-cw-row' },
        h('style', null, css),
        h('div', { className: 'akp-cw-rowText' },
          h('div', { className: 'akp-cw-title' }, tr('chatwidth.title')),
          h('div', { className: 'akp-cw-desc' }, description),
        ),
        h('div', { className: 'akp-cw-control' },
          h('input', {
            type: 'range', className: 'akp-cw-slider',
            min: CONTENT_MIN, max: SLIDER_MAX, step: SLIDER_STEP,
            value: preference === null ? 920 : Math.round(preference),
            'aria-label': tr('chatwidth.title'),
            onChange: (event) => commit(Number(event.target.value)),
          }),
          h('span', { className: 'akp-cw-value' },
            preference === null ? tr('chatwidth.reset') : `${preference}px`),
          h('button', {
            type: 'button', className: 'akp-cw-reset',
            onClick: () => commit(null),
            disabled: preference === null,
          }, tr('chatwidth.reset')),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const undoLocale = ctx.locale.register(NS, { en: DICT.en, zh: DICT.zh });
          const disposeInject = ctx.slots.inject('settings.general.item', () => ctx.slots.register({
            name: 'settings.general.item',
            id: 'chat-width',
            order: 30,
            locale: NS,
          }, WidthRow));
          // Apply a stored preference on (re)load, before any drag happens.
          const stored = readPreference();
          if (stored !== null) applyWidth(stored);
          return () => {
            disposeInject();
            if (typeof undoLocale === 'function') undoLocale();
          };
        }, 'chat-width: settings row');
      },
    };
  },
});
