/**
 * Copy for the dsh-direction client surfaces.
 *
 * The bundled strings are used when the host locale service does not advertise
 * `fa`/`ar`; otherwise the host's own dictionary wins (see client.js). Keeping a
 * local dictionary means the plugin is usable with zero host configuration and
 * with no locale registration side effects.
 *
 * @module dsh-direction/i18n
 */

/** Locale codes that read right-to-left. */
export const RTL_LOCALES = ['fa', 'ar', 'he', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb'];

/**
 * The English dictionary; also the shape every other dictionary must match.
 */
export const en = {
  'overlay.label': 'Text direction',
  'overlay.hint': 'Click to switch: auto, right-to-left, left-to-right',
  'overlay.state.auto': 'Auto',
  'overlay.state.rtl': 'RTL',
  'overlay.state.ltr': 'LTR',
  'overlay.title': 'Text direction: {mode} · scope: {scope} · alignment: {align}',
  'overlay.scope.messages': 'messages',
  'overlay.scope.interface': 'whole interface',
  'overlay.align.auto': 'follow direction',
  'overlay.align.start': 'start edge',
  'overlay.align.justify': 'justify',
  'settings.title': 'Text direction',
  'settings.description':
    'Auto lets every paragraph follow its own first strong character, so Persian and English can sit in the same transcript. Force a direction when the automatic result is wrong.',
  'settings.mode.label': 'Direction',
  'settings.mode.auto': 'Auto',
  'settings.mode.autoHint': 'Per paragraph, from its own content',
  'settings.mode.rtl': 'Right to left',
  'settings.mode.rtlHint': 'Force RTL',
  'settings.mode.ltr': 'Left to right',
  'settings.mode.ltrHint': 'Force LTR',
  'settings.scope.label': 'Applies to',
  'settings.scope.messages': 'Messages only',
  'settings.scope.interface': 'Whole interface',
  'settings.scope.hint':
    'Messages only keeps every panel where it is and directs just the conversation. Whole interface mirrors the shell as well.',
  'settings.align.label': 'Text alignment',
  'settings.align.auto': 'Follow direction',
  'settings.align.start': 'Start edge',
  'settings.align.justify': 'Justify',
  'settings.width.label': 'Conversation width',
  'settings.width.auto': 'Default',
  'settings.width.hint': 'A narrower measure is easier to read in right-to-left text.',
  'settings.reset': 'Reset to defaults'
};

/**
 * The Persian dictionary.
 */
export const fa = {
  'overlay.label': 'جهت متن',
  'overlay.hint': 'برای تغییر کلیک کنید: خودکار، راست‌به‌چپ، چپ‌به‌راست',
  'overlay.state.auto': 'خودکار',
  'overlay.state.rtl': 'راست‌به‌چپ',
  'overlay.state.ltr': 'چپ‌به‌راست',
  'overlay.title': 'جهت متن: {mode} · دامنه: {scope} · ترازبندی: {align}',
  'overlay.scope.messages': 'فقط پیام‌ها',
  'overlay.scope.interface': 'کل رابط',
  'overlay.align.auto': 'پیرو جهت',
  'overlay.align.start': 'لبهٔ شروع',
  'overlay.align.justify': 'تراز دو طرف',
  'settings.title': 'جهت متن',
  'settings.description':
    'حالت خودکار هر پاراگراف را بر اساس نخستین نویسهٔ قوی‌اش می‌چیند، پس فارسی و انگلیسی می‌توانند در یک گفتگو کنار هم بمانند. اگر نتیجهٔ خودکار نادرست بود، جهت را دستی تعیین کنید.',
  'settings.mode.label': 'جهت',
  'settings.mode.auto': 'خودکار',
  'settings.mode.autoHint': 'هر پاراگراف بر اساس محتوای خودش',
  'settings.mode.rtl': 'راست‌به‌چپ',
  'settings.mode.rtlHint': 'اجبار راست‌به‌چپ',
  'settings.mode.ltr': 'چپ‌به‌راست',
  'settings.mode.ltrHint': 'اجبار چپ‌به‌راست',
  'settings.scope.label': 'اعمال روی',
  'settings.scope.messages': 'فقط پیام‌ها',
  'settings.scope.interface': 'کل رابط',
  'settings.scope.hint':
    '«فقط پیام‌ها» همهٔ پنل‌ها را سر جای خود نگه می‌دارد و تنها گفتگو را جهت‌دهی می‌کند. «کل رابط» پوستهٔ برنامه را هم آینه می‌کند.',
  'settings.align.label': 'ترازبندی متن',
  'settings.align.auto': 'پیرو جهت',
  'settings.align.start': 'لبهٔ شروع',
  'settings.align.justify': 'تراز دو طرف',
  'settings.width.label': 'پهنای گفتگو',
  'settings.width.auto': 'پیش‌فرض',
  'settings.width.hint': 'پهنای کمتر برای متن راست‌به‌چپ خواناتر است.',
  'settings.reset': 'بازگشت به پیش‌فرض‌ها'
};

/** Every dictionary the plugin ships, keyed by primary language subtag. */
export const DICTIONARIES = { en, fa };

/**
 * Resolve a raw locale tag onto a shipped dictionary language.
 *
 * @param {unknown} raw - a BCP-47 tag such as `fa-IR`, or anything else.
 * @returns {'en'|'fa'} the dictionary to use.
 */
export function resolveLocale(raw) {
  if (typeof raw !== 'string') return 'en';
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0];
  return Object.prototype.hasOwnProperty.call(DICTIONARIES, primary) ? /** @type {'en'|'fa'} */ (primary) : 'en';
}

/**
 * Build a translator over one language with `{name}` placeholder support.
 *
 * @param {'en'|'fa'} language - dictionary language.
 * @returns {(key: string, params?: Record<string, string|number>) => string} the translator.
 */
export function translator(language) {
  const dictionary = DICTIONARIES[language] ?? en;
  return (key, params) => {
    const template = Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : en[key] ?? key;
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    );
  };
}
