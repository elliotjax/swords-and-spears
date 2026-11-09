// Checks whether a newer version of the game has been published, and if so
// shows a button that loads it (bypassing the phone's saved copy of the page).

declare const __BUILD_ID__: string;
export const BUILD_ID = __BUILD_ID__;

let shown = false;

export async function checkForUpdate(onBeforeReload: () => void) {
  if (shown || BUILD_ID.startsWith('dev-')) return;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = await res.json();
    if (!build || build === BUILD_ID) return;
    shown = true;
    const btn = document.createElement('button');
    btn.id = 'updateBtn';
    btn.className = 'panel';
    btn.textContent = '✨ New version: tap to update';
    btn.onclick = () => {
      onBeforeReload();
      // a fresh address so the phone can't reuse its saved copy of the page
      location.replace(location.pathname + '?v=' + build);
    };
    document.body.appendChild(btn); // on top of everything, so it also shows in the Battle Lab
  } catch { /* offline: try again later */ }
}
