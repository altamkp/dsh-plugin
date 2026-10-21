/**
 * Conversation width — Web page half.
 *
 * A Settings → General toggle that lets the transcript use the full
 * conversation-column width instead of the shipped centered default
 * (`--dsh-chat-content-width` clamps it to 680–920 px, which leaves two wide
 * blank margins on a narrow window). While enabled, this plugin pins the same
 * custom property the app itself consumes (`--dsh-chat-user-width`) to the
 * full column width, re-asserting it when the app republishes its own value
 * (mount, resize, drag). Off (the default) removes the override entirely.
 */

window.__ModuleLoader__.load({
  id: '@altamkp/dsh-plugin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = '@altamkp/dsh-plugin/chat-width';
    /** Our own preference key — never touch the app's own width pref. */
    const FULL_KEY = 'dsh.conversation.fullWidth';

    const DICT = {
      en: {
        'chatwidth.title': 'Conversation width',
        'chatwidth.desc': 'Stretch the transcript and composer to the full window width instead of the centered default.',
      },
      zh: {
        'chatwidth.title': '对话宽度',
        'chatwidth.desc': '让对话内容和输入框铺满整个窗口宽度，而不是居中的默认宽度。',
      },
    };

    const css = [
      '.akp-cw-row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}',
      '.akp-cw-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}',
      '.akp-cw-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
      '.akp-cw-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}',
      '.akp-cw-switch{appearance:none;position:relative;width:40px;height:24px;border-radius:12px;background:var(--dsw-alias-bg-module-platform);outline:none;cursor:pointer;transition:background .15s;flex:none;margin:0}',
      '.akp-cw-switch:checked{background:var(--dsw-alias-brand-primary)}',
      '.akp-cw-switch::before{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:9px;background:#fff;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.2)}',
      '.akp-cw-switch:checked::before{transform:translateX(16px)}',
    ].join('\n');

    function readPreference() {
      try {
        return localStorage.getItem(FULL_KEY) === '1';
      } catch {
        return false;
      }
    }

    /** Elements the conversation body publishes its column width on. */
    function carriers() {
      return document.querySelectorAll('[style*="--dsh-conversation-column-width"]');
    }

    function applyFullWidth() {
      carriers().forEach((el) => {
        const column = Number.parseFloat(el.style.getPropertyValue('--dsh-conversation-column-width'))
          || el.offsetWidth;
        if (column > 0) el.style.setProperty('--dsh-chat-user-width', `${column}px`);
      });
    }

    function clearFullWidth() {
      carriers().forEach((el) => el.style.removeProperty('--dsh-chat-user-width'));
    }

    function WidthRow() {
      const tr = (key) => DICT.zh[key] || DICT.en[key] || key;
      const [full, setFull] = React.useState(readPreference);

      // While enabled, keep re-asserting the full width: the app rewrites the
      // inline property on mount, resize, and edge drags.
      React.useEffect(() => {
        if (!full) return undefined;
        applyFullWidth();
        const timer = window.setInterval(applyFullWidth, 800);
        return () => window.clearInterval(timer);
      }, [full]);

      const commit = (value) => {
        try {
          if (value) localStorage.setItem(FULL_KEY, '1');
          else localStorage.removeItem(FULL_KEY);
        } catch { /* storage unavailable; live effect still works */ }
        setFull(value);
        if (value) applyFullWidth();
        else clearFullWidth();
      };

      return h('div', { className: 'akp-cw-row' },
        h('style', null, css),
        h('div', { className: 'akp-cw-rowText' },
          h('div', { className: 'akp-cw-title' }, tr('chatwidth.title')),
          h('div', { className: 'akp-cw-desc' }, tr('chatwidth.desc')),
        ),
        h('input', {
          type: 'checkbox', className: 'akp-cw-switch', role: 'switch',
          checked: full,
          'aria-label': tr('chatwidth.title'),
          onChange: (event) => commit(event.target.checked),
        }),
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
          // Re-assert a stored preference right after load.
          if (readPreference()) applyFullWidth();
          return () => {
            disposeInject();
            if (typeof undoLocale === 'function') undoLocale();
          };
        }, 'chat-width: settings row');
      },
    };
  },
});
