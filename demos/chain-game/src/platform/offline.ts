/** Keep production games available offline and local previews on the latest files. */
export async function registerOfflineSupport(): Promise<void> {
  const scope = '/games/chain-game/';
  if (
    !('serviceWorker' in navigator) ||
    !window.isSecureContext ||
    !location.pathname.startsWith(scope)
  )
    return;
  const isLocalPreview = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
    location.hostname,
  );
  try {
    const registration = await navigator.serviceWorker.register(
      `${scope}sw.js`,
      {
        scope,
        ...(isLocalPreview ? { updateViaCache: 'none' as const } : {}),
      },
    );
    // Updating also replaces a previously installed cache-first local worker.
    // The worker takes over requests; the current page and saved run stay intact.
    if (isLocalPreview) await registration.update();
  } catch {
    // Browsers may disable storage or offline support; the current game stays playable.
  }
}
