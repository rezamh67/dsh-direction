/**
 * The **Settings → General** preference row.
 *
 * `settings.general.item` is a list seat whose owner supplies no props at all —
 * no label, no value, no write path — so this row owns its own copy, its own
 * controls and its own persistence, and renders only its internals.
 *
 * The row is deliberately the *long* form of the same controls the overlay
 * button cycles: mode, reach, alignment and the conversation-width override.
 *
 * @module dsh-direction/settings-row
 */

import { ALIGNS, MAX_WIDTH, MODES, MIN_WIDTH, SCOPES, SHIPPED_CONTENT_WIDTH } from './direction.js';

/** Design-token fallbacks for the row chrome. */
const TOKEN = {
  label: 'var(--dsw-alias-label-primary, #1c1c1e)',
  secondary: 'var(--dsw-alias-label-secondary, #6e6e73)',
  caption: 'var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary, #86868b))',
  border: 'var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2))',
  surface: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04))',
  accent: 'var(--dsw-alias-state-business-primary, #4c7dff)',
  hover: 'var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06))'
};

/** Stylesheet injected once per document by this module. */
const ROW_CSS = `
.dsh-direction-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 0;
  border-top: 1px solid ${TOKEN.border};
}
.dsh-direction-row__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.dsh-direction-row__title {
  color: ${TOKEN.label};
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}
.dsh-direction-row__reset {
  flex: none;
  padding: 3px 10px;
  border: 1px solid ${TOKEN.border};
  border-radius: 8px;
  background: transparent;
  color: ${TOKEN.secondary};
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.dsh-direction-row__reset:hover {
  background: ${TOKEN.hover};
  color: ${TOKEN.label};
}
.dsh-direction-row__reset:focus-visible,
.dsh-direction-row__segment:focus-visible,
.dsh-direction-row__range:focus-visible {
  outline: 2px solid ${TOKEN.accent};
  outline-offset: 2px;
}
.dsh-direction-row__description {
  margin: 0;
  color: ${TOKEN.secondary};
  font-size: 12px;
  line-height: 18px;
}
.dsh-direction-row__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dsh-direction-row__fieldLabel {
  color: ${TOKEN.secondary};
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
}
.dsh-direction-row__fieldHint {
  color: ${TOKEN.caption};
  font-size: 11px;
  line-height: 16px;
}
.dsh-direction-row__segments {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border: 1px solid ${TOKEN.border};
  border-radius: 10px;
  background: ${TOKEN.surface};
  width: fit-content;
  max-width: 100%;
  flex-wrap: wrap;
}
.dsh-direction-row__segment {
  padding: 4px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: ${TOKEN.secondary};
  font: inherit;
  font-size: 12.5px;
  line-height: 18px;
  cursor: pointer;
  white-space: nowrap;
}
.dsh-direction-row__segment:hover {
  color: ${TOKEN.label};
}
.dsh-direction-row__segment[aria-pressed="true"] {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: ${TOKEN.label};
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.dsh-direction-row__width {
  display: flex;
  align-items: center;
  gap: 12px;
}
.dsh-direction-row__range {
  flex: 1;
  min-width: 120px;
  max-width: 320px;
  accent-color: ${TOKEN.accent};
}
.dsh-direction-row__value {
  min-width: 92px;
  color: ${TOKEN.secondary};
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.dsh-direction-row[data-disabled="true"] .dsh-direction-row__field[data-needs-forced="true"] {
  opacity: 0.45;
  pointer-events: none;
}
`;

/**
 * Attach the row stylesheet once.
 *
 * @param {Document} document - host document.
 * @param {string} tagId - `data-plugin-css` tag identifying this sheet.
 * @returns {void}
 */
function installRowStyles(document, tagId) {
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return;
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-direction';
  style.dataset.pluginCss = tagId;
  style.textContent = ROW_CSS;
  document.head.appendChild(style);
}

/**
 * A labelled segmented control over one option axis.
 *
 * @param {object} options - control options.
 * @param {import('react')} options.React - the host React instance.
 * @param {string} options.label - visible field label.
 * @param {string} [options.hint] - secondary explanatory line.
 * @param {Array<{ value: string, label: string, title?: string }>} options.options - the choices.
 * @param {string} options.current - the active choice.
 * @param {(value: string) => void} options.onSelect - selection callback.
 * @param {boolean} [options.needsForced] - marks the field as inert under `auto`.
 * @returns {import('react').ReactElement} the field.
 */
function SegmentedField({ React, label, hint, options, current, onSelect, needsForced = false }) {
  return React.createElement(
    'div',
    { className: 'dsh-direction-row__field', 'data-needs-forced': needsForced ? 'true' : 'false' },
    React.createElement('span', { className: 'dsh-direction-row__fieldLabel' }, label),
    React.createElement(
      'div',
      { className: 'dsh-direction-row__segments', role: 'group', 'aria-label': label },
      options.map((option) =>
        React.createElement(
          'button',
          {
            key: option.value,
            type: 'button',
            className: 'dsh-direction-row__segment',
            'aria-pressed': option.value === current ? 'true' : 'false',
            title: option.title,
            onClick: () => {
              onSelect(option.value);
            }
          },
          option.label
        )
      )
    ),
    hint === undefined ? null : React.createElement('span', { className: 'dsh-direction-row__fieldHint' }, hint)
  );
}

/**
 * Create the General-section row for one store.
 *
 * @param {object} options - component options.
 * @param {import('react')} options.React - the host React instance.
 * @param {import('./store.js').DirectionStore} options.store - shared store.
 * @param {(key: string, params?: Record<string, string|number>) => string} options.t - translator.
 * @param {Document} options.document - host document.
 * @returns {import('react').FunctionComponent} the registered component.
 */
export function createSettingsRow({ React, store, t, document }) {
  const { useSyncExternalStore } = React;
  installRowStyles(document, 'dsh-direction/settings-row.css');

  /**
   * The General-section preference row.
   *
   * @returns {import('react').ReactElement} the row.
   */
  return function DirectionSettingsRow() {
    const snapshot = useSyncExternalStore(
      (listener) => store.subscribe(listener),
      () => store.getSnapshot(),
      () => store.getSnapshot()
    );
    const { preference, forced } = snapshot;
    const widthValue = preference.width === 0 ? SHIPPED_CONTENT_WIDTH : preference.width;

    const modeOptions = MODES.map((mode) => ({
      value: mode,
      label: t(`settings.mode.${mode}`),
      title: t(`settings.mode.${mode}Hint`)
    }));
    const scopeOptions = SCOPES.map((scope) => ({ value: scope, label: t(`settings.scope.${scope}`) }));
    const alignOptions = ALIGNS.map((align) => ({ value: align, label: t(`settings.align.${align}`) }));

    return React.createElement(
      'div',
      {
        className: 'dsh-direction-row',
        'data-disabled': forced === null ? 'true' : 'false'
      },
      React.createElement(
        'div',
        { className: 'dsh-direction-row__head' },
        React.createElement('span', { className: 'dsh-direction-row__title' }, t('settings.title')),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-direction-row__reset',
            onClick: () => {
              store.reset();
            }
          },
          t('settings.reset')
        )
      ),
      React.createElement('p', { className: 'dsh-direction-row__description' }, t('settings.description')),
      SegmentedField({
        React,
        label: t('settings.mode.label'),
        options: modeOptions,
        current: preference.mode,
        onSelect: (value) => {
          store.setMode(/** @type {import('./direction.js').Mode} */ (value));
        }
      }),
      SegmentedField({
        React,
        label: t('settings.scope.label'),
        hint: t('settings.scope.hint'),
        options: scopeOptions,
        current: preference.scope,
        needsForced: true,
        onSelect: (value) => {
          store.update({ scope: /** @type {import('./direction.js').Scope} */ (value) });
        }
      }),
      SegmentedField({
        React,
        label: t('settings.align.label'),
        options: alignOptions,
        current: preference.align,
        onSelect: (value) => {
          store.update({ align: /** @type {import('./direction.js').Align} */ (value) });
        }
      }),
      React.createElement(
        'div',
        { className: 'dsh-direction-row__field' },
        React.createElement('span', { className: 'dsh-direction-row__fieldLabel' }, t('settings.width.label')),
        React.createElement(
          'div',
          { className: 'dsh-direction-row__width' },
          React.createElement('input', {
            className: 'dsh-direction-row__range',
            type: 'range',
            min: MIN_WIDTH === 0 ? 320 : MIN_WIDTH,
            max: MAX_WIDTH,
            step: 4,
            value: widthValue,
            'aria-label': t('settings.width.label'),
            onChange: (event) => {
              const next = Number(event.target.value);
              /* The shipped width is the "no override" value: reaching it by
                 dragging restores DSH's own measure instead of pinning a copy. */
              store.update({ width: next === SHIPPED_CONTENT_WIDTH ? 0 : next });
            }
          }),
          React.createElement(
            'span',
            { className: 'dsh-direction-row__value' },
            preference.width === 0 ? t('settings.width.auto') : `${preference.width} px`
          )
        ),
        React.createElement('span', { className: 'dsh-direction-row__fieldHint' }, t('settings.width.hint'))
      )
    );
  };
}
