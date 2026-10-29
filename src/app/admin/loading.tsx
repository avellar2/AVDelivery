export default function AdminLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Carregando administração">
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-zinc-200" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white"
          />
        ))}
      </div>

      <div className="h-72 animate-pulse rounded-xl border border-zinc-200 bg-white" />
    </div>
  );
}
