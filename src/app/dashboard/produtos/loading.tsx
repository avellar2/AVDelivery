export default function MenuLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando cardápio">
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-zinc-200" />
      </div>

      <div className="flex gap-1 rounded-xl border border-zinc-200 bg-white p-1">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-10 flex-1 animate-pulse rounded-lg bg-zinc-100" />
        ))}
      </div>

      <div className="h-40 animate-pulse rounded-xl border border-zinc-200 bg-white" />
      <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-white" />
    </div>
  );
}
