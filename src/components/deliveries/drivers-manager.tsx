"use client";

import { useCallback, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/utils";
import {
  createDriverAction,
  refreshDriversAction,
  updateDriverAction,
} from "@/modules/deliveries/actions";
import type { DriverProfileSummary } from "@/modules/deliveries/types";

type Feedback = { kind: "success" | "error"; message: string } | null;

export function DriversManager({
  storeName,
  initialDrivers,
}: {
  storeName: string;
  initialDrivers: DriverProfileSummary[];
}) {
  const [drivers, setDrivers] = useState<DriverProfileSummary[]>(initialDrivers);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [mode, setMode] = useState<"link" | "invite">("link");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editActive, setEditActive] = useState(true);

  const refresh = useCallback(async () => {
    const result = await refreshDriversAction();

    if (result.ok) {
      setDrivers(result.drivers);
    } else {
      setFeedback({ kind: "error", message: result.message });
    }
  }, []);

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    startTransition(async () => {
      const result = await createDriverAction({ email, name, phone, mode });

      if (result.status === "error") {
        setFeedback({ kind: "error", message: result.message ?? "Não foi possível cadastrar." });
        return;
      }

      setFeedback({ kind: "success", message: result.message ?? "Entregador cadastrado." });
      setEmail("");
      setName("");
      setPhone("");
      await refresh();
    });
  }

  function beginEdit(driver: DriverProfileSummary) {
    setEditingId(driver.id);
    setEditName(driver.displayName);
    setEditPhone(driver.phone ?? "");
    setEditActive(driver.active);
    setFeedback(null);
  }

  function handleUpdate(driver: DriverProfileSummary, active = editActive) {
    setFeedback(null);

    startTransition(async () => {
      const result = await updateDriverAction({
        driverProfileId: driver.id,
        displayName: editingId === driver.id ? editName : driver.displayName,
        phone: editingId === driver.id ? editPhone : (driver.phone ?? ""),
        active,
      });

      if (result.status === "error") {
        setFeedback({ kind: "error", message: result.message ?? "Não foi possível atualizar." });
        return;
      }

      setFeedback({ kind: "success", message: result.message ?? "Entregador atualizado." });
      setEditingId(null);
      await refresh();
    });
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Entregadores</h1>
        <p className="text-sm text-zinc-500">
          {storeName} · {drivers.filter((driver) => driver.active).length} ativos · {drivers.length}{" "}
          cadastrados
        </p>
      </header>

      {feedback ? (
        <Alert variant={feedback.kind === "success" ? "success" : "error"}>
          {feedback.message}
        </Alert>
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-zinc-900">Adicionar entregador</h2>
          <p className="text-sm text-zinc-500">
            Vincule uma conta já criada pelo administrador ou solicite um convite por e-mail. O
            cadastro público de contas permanece desabilitado.
          </p>
        </div>

        <form onSubmit={handleCreate} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-zinc-700">
            <span>E-mail da conta</span>
            <Input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="entregador@exemplo.com"
              autoComplete="off"
            />
          </label>

          <label className="space-y-1 text-sm font-medium text-zinc-700">
            <span>Nome exibido</span>
            <Input
              required
              minLength={2}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome do entregador"
            />
          </label>

          <label className="space-y-1 text-sm font-medium text-zinc-700">
            <span>Telefone (opcional)</span>
            <Input
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(11) 90000-0000"
            />
          </label>

          <label className="space-y-1 text-sm font-medium text-zinc-700">
            <span>Como adicionar</span>
            <Select
              value={mode}
              onChange={(event) => setMode(event.target.value as "link" | "invite")}
            >
              <option value="link">Vincular conta existente</option>
              <option value="invite">Convidar por e-mail</option>
            </Select>
          </label>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Salvando...
                </>
              ) : (
                "Adicionar entregador"
              )}
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-3" aria-label="Entregadores cadastrados">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold text-zinc-900">Equipe de entrega</h2>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => startTransition(refresh)}
          >
            Atualizar
          </Button>
        </div>

        {drivers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-10 text-center">
            <p className="text-sm font-medium text-zinc-700">Nenhum entregador cadastrado</p>
            <p className="mt-1 text-sm text-zinc-500">
              Adicione uma conta acima para começar a atribuir entregas.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {drivers.map((driver) => {
              const editing = editingId === driver.id;

              return (
                <li
                  key={driver.id}
                  className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-zinc-900">
                          {driver.displayName}
                        </p>
                        <Badge variant={driver.active ? "success" : "muted"}>
                          {driver.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      <p className="text-sm text-zinc-500">
                        {driver.phone ?? "Telefone não informado"} · desde{" "}
                        {formatDateTime(driver.createdAt)}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {driver.activeDeliveries} em andamento · {driver.completedDeliveries}{" "}
                        concluídas
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => (editing ? setEditingId(null) : beginEdit(driver))}
                      >
                        {editing ? "Fechar" : "Editar"}
                      </Button>
                      <Button
                        type="button"
                        variant={driver.active ? "danger" : "secondary"}
                        disabled={pending}
                        onClick={() => handleUpdate(driver, !driver.active)}
                      >
                        {driver.active ? "Desativar" : "Reativar"}
                      </Button>
                    </div>
                  </div>

                  {editing ? (
                    <form
                      className="mt-4 grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleUpdate(driver);
                      }}
                    >
                      <label className="space-y-1 text-sm font-medium text-zinc-700">
                        <span>Nome exibido</span>
                        <Input
                          required
                          minLength={2}
                          maxLength={120}
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      </label>
                      <label className="space-y-1 text-sm font-medium text-zinc-700">
                        <span>Telefone</span>
                        <Input
                          inputMode="tel"
                          value={editPhone}
                          onChange={(event) => setEditPhone(event.target.value)}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm text-zinc-700 sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={editActive}
                          onChange={(event) => setEditActive(event.target.checked)}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        Entregador ativo para novas atribuições
                      </label>
                      <div className="sm:col-span-2">
                        <Button type="submit" disabled={pending}>
                          Salvar alterações
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
