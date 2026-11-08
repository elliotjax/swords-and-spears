// Small inline SVG icons for the HUD.
const svg = (inner: string, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const IC = {
  food: svg('<path d="M12 22V9" stroke="#2f9d58" stroke-width="2.4"/><path d="M12 13c-4 0-6-3-6-6 3 0 6 2 6 6zM12 11c4 0 6-3 6-6-3 0-6 2-6 6z" fill="#2f9d58"/>'),
  wood: svg('<rect x="2" y="8" width="17" height="8" rx="4" fill="#b07a4c" stroke="#3a3342" stroke-width="1.6"/><ellipse cx="19" cy="12" rx="3" ry="4" fill="#e3c093" stroke="#3a3342" stroke-width="1.6"/>'),
  gold: svg('<circle cx="12" cy="12" r="8.5" fill="#f0b93e" stroke="#b8861a" stroke-width="2"/><circle cx="12" cy="12" r="4.5" stroke="#b8861a" stroke-width="1.6"/>'),
  people: svg('<circle cx="12" cy="7.5" r="4" fill="#262b38"/><path d="M4 21c0-5 3.5-7.5 8-7.5s8 2.5 8 7.5z" fill="#262b38"/>'),
  baby: svg('<circle cx="12" cy="9" r="5.5" fill="#f2c79b" stroke="#3a3342" stroke-width="1.6"/><path d="M6 21c0-3.5 2.7-5.5 6-5.5s6 2 6 5.5z" fill="#4f7fc4"/><path d="M9.5 6.2c1.2-1.6 3.8-1.6 5 0" stroke="#6b4426" stroke-width="1.8"/>'),
  fast: svg('<path d="M3 5l8 7-8 7zM12 5l8 7-8 7z" fill="currentColor"/>', 20),
  addPeople: svg('<circle cx="9" cy="7.5" r="3.6" fill="#262b38"/><path d="M2.5 20c0-4.2 2.9-6.6 6.5-6.6s6.5 2.4 6.5 6.6z" fill="#262b38"/><circle cx="18" cy="8" r="5" fill="#2f9d58"/><path d="M18 5.4v5.2M15.4 8h5.2" stroke="#fff" stroke-width="2"/>', 20),
  swords: svg('<path d="M4 4l10 10M20 4L10 14" stroke="#3a3342" stroke-width="2.6"/><path d="M12 16l-4 4M12 16l4 4" stroke="#8a5c36" stroke-width="2.6"/><path d="M4 4l3 1-2 2zM20 4l-3 1 2 2z" fill="#3a3342"/>', 20),
  town: svg('<path d="M2 12l5-4 5 4v8H2z" fill="#d6453d"/><path d="M11 10l6-5 6 5v10H11z" fill="#b8382f"/><rect x="5" y="15" width="3" height="5" fill="#fff"/><rect x="15.5" y="14" width="3" height="6" fill="#fff"/>', 20),
  unlock: svg('<rect x="5" y="11" width="14" height="10" rx="2" fill="#d9a21e"/><path d="M8 11V8a4 4 0 017.6-1.8" stroke="#d9a21e" stroke-width="2.4"/>', 20),
  idle: svg('<circle cx="12" cy="12" r="8.5" stroke="#d98a1d" stroke-width="2.4"/><path d="M12 7v5l3 2" stroke="#d98a1d" stroke-width="2.4"/>'),
  army: svg('<path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z" fill="#d6453d"/><path d="M12 8v5" stroke="#fff" stroke-width="2.2"/><circle cx="12" cy="16.3" r="1.2" fill="#fff"/>'),
  warn: svg('<path d="M12 3l10 18H2z" fill="#d6453d"/><path d="M12 10v5" stroke="#fff" stroke-width="2.2"/><circle cx="12" cy="18" r="1.2" fill="#fff"/>', 22),
  warnAmber: svg('<path d="M12 3l10 18H2z" fill="#d98a1d"/><path d="M12 10v5" stroke="#fff" stroke-width="2.2"/><circle cx="12" cy="18" r="1.2" fill="#fff"/>', 22),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2" fill="#667086"/><path d="M8 11V8a4 4 0 018 0v3" stroke="#667086" stroke-width="2.4"/>', 14),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>', 16),
  menu: svg('<path d="M5 7h14M5 12h14M5 17h14" stroke="#262b38" stroke-width="2.4"/>', 18),
  build: svg('<path d="M14 6l4 4-9 9-4-4z" fill="currentColor"/><path d="M13 3l8 8" stroke="currentColor" stroke-width="2.6"/>', 22),
  villagers: svg('<circle cx="8.5" cy="8" r="3" fill="currentColor"/><circle cx="16" cy="8" r="3" fill="currentColor"/><path d="M2.5 19c0-4 2.5-6 6-6s6 2 6 6zM11 19c.3-3.7 2.3-6 5-6 3.5 0 5.5 2 5.5 6z" fill="currentColor"/>', 22),
  military: svg('<path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z" fill="currentColor"/>', 22),
  tech: svg('<rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" stroke-width="2.2"/><path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" stroke-width="2.2"/>', 22),
  map: svg('<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" stroke="currentColor" stroke-width="2.2"/><path d="M9 3v15M15 6v15" stroke="currentColor" stroke-width="2.2"/>', 22),
};
