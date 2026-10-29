export default function DashboardLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Carregando painel">
      <div className="space-y-2">
        <div className="h-4 w-28 animate-pulse rounded bg-zinc-200" />
        <div className="h-8 w-64 animate-pulse rounded bg-zinc-200" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-xl border border-zinc-200 bg-white"
          />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-xl border border-zinc-200 bg-white"
          />
        ))}
      </div>
    </div>
  );
}
