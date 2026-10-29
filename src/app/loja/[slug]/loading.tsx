export default function StoreLoading() {
  return (
    <div className="min-h-screen bg-zinc-50" aria-busy="true" aria-label="Carregando loja">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="h-3 w-24 animate-pulse rounded bg-zinc-200" />
          <div className="h-3 w-36 animate-pulse rounded bg-zinc-200" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="h-24 bg-zinc-100" />
          <div className="space-y-3 px-6 pt-4 pb-6">
            <div className="-mt-12 h-16 w-16 rounded-2xl border-4 border-white bg-zinc-200" />
            <div className="h-6 w-48 animate-pulse rounded bg-zinc-200" />
            <div className="h-3 w-full max-w-md animate-pulse rounded bg-zinc-100" />
          </div>
        </div>

        <div className="h-48 animate-pulse rounded-xl border border-dashed border-zinc-300 bg-white" />
      </main>
    </div>
  );
}
