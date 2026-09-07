/**
 * A script whose only job is to prove a script can load.
 *
 * diag.html loads this twice — once with a crossorigin attribute and once
 * without — to find out whether that attribute is what stops the real bundle on
 * a network that inspects traffic. It has to be a separate file rather than the
 * app bundle itself, because loading the app bundle a second time would mount a
 * second copy of React over the diagnostics page.
 */
window.__diagProbe = (window.__diagProbe || 0) + 1;
