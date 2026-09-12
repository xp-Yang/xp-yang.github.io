export function InkloopExperience() {
  return (
    <main className="fixed inset-0 z-50 flex h-dvh flex-col bg-[#edf0f2]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 bg-[#050608] px-4 py-3 text-xs text-stone-300 sm:px-6">
        <a href="/works/" className="py-1 hover:text-white">← 所有作品</a>
        <h1 className="text-sm text-white">圈个小世界</h1>
        <a href="/games/inkloop/" className="py-1 text-[#68d8c6] hover:text-white" aria-label="独立打开游戏，iPhone 可添加到主屏幕">独立打开 ↗</a>
      </header>
      <iframe
        src="/games/inkloop/"
        title="圈个小世界：在线试玩"
        className="min-h-0 w-full flex-1 border-0"
        allow="fullscreen; gamepad"
        allowFullScreen
      />
    </main>
  );
}
