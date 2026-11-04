"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatCurrency } from "@/lib/utils";
import { createStoreAction, type AdminBillingActionState } from "@/modules/subscriptions/actions";
import type { PlanSummary } from "@/modules/subscriptions/types";

const initialState: AdminBillingActionState = { status: "idle" };

const initialPlans: PlanSummary[] = [];

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function NewStoreForm({
  plans = initialPlans,
  requestId,
}: {
  plans?: PlanSummary[];
  requestId: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(createStoreAction, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");

  useEffect(() => {
    if (state.status === "success" && state.storeId) {
      router.push(`/admin/lojas/${state.storeId}`);
    }
  }, [router, state.status, state.storeId]);

  const selectedPlan = plans.find((plan) => plan.id === planId) ?? plans[0] ?? null;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="requestId" value={requestId} />

      {state.message ? (
        <Alert variant={state.status === "success" ? "success" : "error"}>{state.message}</Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Nome" htmlFor="name" error={state.fieldErrors?.name?.[0]}>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!slugTouched) {
                setSlug(slugify(event.target.value));
              }
            }}
            maxLength={120}
            required
          />
        </FormField>

        <FormField
          label="Identificador público"
          htmlFor="slug"
          error={state.fieldErrors?.slug?.[0]}
          hint="Ex.: burger-do-ze. Usado em /loja/{identificador}; não pode ser alterado nesta etapa."
        >
          <Input
            id="slug"
            name="slug"
            value={slug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value.toLowerCase());
            }}
            minLength={3}
            maxLength={80}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
          />
        </FormField>

        <FormField
          label="Telefone"
          htmlFor="phone"
          error={state.fieldErrors?.phone?.[0]}
          hint="Opcional. Aparece na página pública."
        >
          <Input id="phone" name="phone" inputMode="tel" maxLength={30} />
        </FormField>

        <FormField
          label="E-mail do proprietário"
          htmlFor="ownerEmail"
          error={state.fieldErrors?.ownerEmail?.[0]}
          hint="A conta já precisa existir no Supabase Auth. O cadastro público está desabilitado."
        >
          <Input id="ownerEmail" name="ownerEmail" type="email" autoComplete="off" required />
        </FormField>

        <FormField
          label="Plano"
          htmlFor="planId"
          error={state.fieldErrors?.planId?.[0]}
          hint={
            selectedPlan
              ? `${formatCurrency(selectedPlan.priceCents)}/mês · teste de ${selectedPlan.trialDays} dias · carência de ${selectedPlan.graceDays} dias`
              : "Nenhum plano ativo configurado."
          }
        >
          <Select
            id="planId"
            name="planId"
            required
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
          >
            {plans.length === 0 ? <option value="">Nenhum plano disponível</option> : null}
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} — {formatCurrency(plan.priceCents)}/mês
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField
        label="Descrição"
        htmlFor="description"
        error={state.fieldErrors?.description?.[0]}
      >
        <Textarea
          id="description"
          name="description"
          maxLength={500}
          placeholder="Descrição exibida na página pública."
        />
      </FormField>

      <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <input
          type="checkbox"
          name="startTrial"
          defaultChecked
          className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
        />
        <span className="space-y-0.5">
          <span className="block text-sm font-medium text-zinc-800">Iniciar período de teste</span>
          <span className="block text-xs text-zinc-500">
            Sem marcar, a assinatura é ativada administrativamente por 30 dias, com evento de
            auditoria. Nenhuma cobrança real é gerada nesta etapa.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-5">
        <SubmitButton pendingLabel="Criando...">Criar estabelecimento</SubmitButton>
        <p className="text-xs text-zinc-500">
          Lojas são criadas com status cadastral ativo. Novos pedidos passam a ser bloqueados ao fim
          do teste e da carência.
        </p>
      </div>
    </form>
  );
}
