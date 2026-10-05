/**
 * The floating direction toggle, registered into the `shell.overlay` seat
 * (a list slot: additive, and click-through until an entry opts into pointer
 * events — which is exactly what this button's own wrapper does).
 *
 * The seat is deliberately outside the frame, so mirroring the shell in
 * `interface` scope cannot move the control.
 *
 * @module dsh-direction/overlay-button
 */

/** Design-token fallbacks, matching the tokens the shipped shell uses. */
const TOKEN = {
  surface: 'var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #ffffff))',
  label: 'var(--dsw-alias-label-primary, #1c1c1e)',
  caption: 'var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary, #86868b))',
  border: 'var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28))',
  accent: 'var(--dsw-alias-state-business-primary, #4c7dff)',
  hover: 'var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06))'
};

/** Stylesheet injected once per document by the overlay module. */
const BUTTON_CSS = `
.dsh-direction-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 45;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 14px 0 12px;
  border: 1px solid ${TOKEN.border};
  border-radius: 20px;
  background: ${TOKEN.surface};
  color: ${TOKEN.label};
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
  transition: transform 120ms ease, background-color 120ms ease, border-color 120ms ease;
}
.dsh-direction-fab:hover {
  background: ${TOKEN.hover};
}
.dsh-direction-fab:active {
  transform: scale(0.97);
}
.dsh-direction-fab:focus-visible {
  outline: 2px solid ${TOKEN.accent};
  outline-offset: 2px;
}
.dsh-direction-fab[data-forced="true"] {
  border-color: ${TOKEN.accent};
  color: ${TOKEN.accent};
}
.dsh-direction-fab__badge {
  min-width: 26px;
  padding: 2px 5px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: ${TOKEN.caption};
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.dsh-direction-fab[data-forced="true"] .dsh-direction-fab__badge {
  background: var(--dsw-alias-state-business-primary, #4c7dff);
  color: #ffffff;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-direction-fab {
    transition: none;
  }
  .dsh-direction-fab:active {
    transform: none;
  }
}
`;

/**
 * Attach the button stylesheet once.
 *
 * @param {Document} document - host document.
 * @param {string} tagId - `data-plugin-css` tag identifying this sheet.
 * @returns {void}
 */
function installButtonStyles(document, tagId) {
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return;
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-direction';
  style.dataset.pluginCss = tagId;
  style.textContent = BUTTON_CSS;
  document.head.appendChild(style);
}

/**
 * The direction glyph as a small inline SVG: a list motif whose leading edge
 * carries an arrow pointing at the reading direction in force. Under `auto` the
 * arrow dissolves into a chevron-in-dots, so the icon states "decided per block"
 * rather than "not decided yet".
 *
 * @param {import('react')} React - the host React instance.
 * @param {'ltr'|'rtl'|null} forced - the forced direction.
 * @returns {import('react').ReactElement} the glyph.
 */
function directionGlyph(React, forced) {
  const arrowPath =
    forced === 'ltr'
      ? 'M1 3.2h7.4M6 1.4 7.8 3.2 6 5'
      : forced === 'rtl'
        ? 'M9.2 3.2H1.8M4.2 1.4 2.4 3.2 4.2 5'
        : 'M1.6 3.2h2.1M9 3.2H6.9M4.6 3.2h1.4';
  const rowStarts = forced === 'rtl' ? [9.2, 6.6, 4.4] : [2.2, 4.8, 7];
  const rowWidths = [7.6, 5.4, 3.1];
  const children = [
    React.createElement('path', {
      key: 'arrow',
      d: arrowPath,
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    })
  ];
  for (let index = 0; index < rowStarts.length; index += 1) {
    children.push(
      React.createElement('rect', {
        key: `row-${index}`,
        x: rowStarts[index],
        y: 6.1 + index * 1.7,
        width: rowWidths[index],
        height: 1.05,
        rx: 0.52,
        fill: 'currentColor',
        opacity: index === 2 ? 0.45 : 0.9
      })
    );
  }
  return React.createElement(
    'svg',
    { width: 18, height: 18, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
    children
  );
}

/**
 * Create the overlay component for one store.
 *
 * @param {object} options - component options.
 * @param {import('react')} options.React - the host React instance.
 * @param {import('./store.js').DirectionStore} options.store - shared store.
 * @param {(key: string, params?: Record<string, string|number>) => string} options.t - translator.
 * @param {Document} options.document - host document.
 * @returns {import('react').FunctionComponent} the registered component.
 */
export function createOverlayButton({ React, store, t, document }) {
  const { useSyncExternalStore } = React;
  installButtonStyles(document, 'dsh-direction/overlay-button.css');

  /**
   * The floating toggle. One click advances the mode cycle; the full state is
   * in the tooltip rather than in the face, so the control stays small.
   *
   * @returns {import('react').ReactElement} the button.
   */
  return function DirectionOverlayButton() {
    const snapshot = useSyncExternalStore(
      (listener) => store.subscribe(listener),
      () => store.getSnapshot(),
      () => store.getSnapshot()
    );
    const { preference, forced } = snapshot;
    const modeLabel = t(`overlay.state.${preference.mode}`);
    const title = t('overlay.title', {
      mode: modeLabel,
      scope: t(`overlay.scope.${preference.scope}`),
      align: t(`overlay.align.${preference.align}`)
    });
    return React.createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-direction-fab',
        'data-mode': preference.mode,
        'data-forced': forced === null ? 'false' : 'true',
        title: `${title} — ${t('overlay.hint')}`,
        'aria-label': `${t('overlay.label')}: ${modeLabel}`,
        onClick: () => {
          store.cycleMode();
        }
      },
      directionGlyph(React, forced),
      React.createElement('span', null, modeLabel),
      forced === null ? null : React.createElement('span', { className: 'dsh-direction-fab__badge' }, preference.mode.toUpperCase())
    );
  };
}

