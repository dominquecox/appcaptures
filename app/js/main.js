// Studio entry point. Imports run the UI; modules execute deferred,
// so the DOM is ready. Served over http (tools/local.sh, Workers) —
// ES modules are blocked on file://, see the #fileWarn banner.
import "./ui.js";
