export function PindouExperience() {
  return (
    <main className="fixed inset-0 z-50 flex h-dvh flex-col bg-[#e5e5f3]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 bg-[#050608] px-4 py-3 text-xs text-stone-300 sm:px-6">
        <a href="/works/" className="py-1 hover:text-white">← 所有作品</a>
        <h1 className="text-sm text-white">拼豆狂欢</h1>
        <a href="/games/pindou/" className="py-1 text-[#c5b4ff] hover:text-white" aria-label="独立打开拼豆狂欢，iPhone 可添加到主屏幕">独立打开 ↗</a>
      </header>
      <iframe
        src="/games/pindou/"
        title="拼豆狂欢：在线试玩"
        className="min-h-0 w-full flex-1 border-0"
        allow="fullscreen"
        allowFullScreen
      />
    </main>
  );
}
