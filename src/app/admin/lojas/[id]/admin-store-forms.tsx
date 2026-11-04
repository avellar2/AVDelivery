"use client";

import { useActionState, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatCurrency } from "@/lib/utils";
import {
  addStoreOwnerAction,
  type AdminBillingActionState,
  updateStoreAction,
  updateSubscriptionAction,
} from "@/modules/subscriptions/actions";
import type { PlanSummary } from "@/modules/subscriptions/types";

const initialState: AdminBillingActionState = { status: "idle" };

const ACTIONS = [
  { value: "start_trial", label: "Iniciar novo período de teste" },
  { value: "activate", label: "Ativar / regularizar acesso" },
  { value: "grant_grace", label: "Conceder carência" },
  { value: "expire", label: "Expirar acesso imediatamente" },
  { value: "cancel", label: "Cancelar assinatura" },
  { value: "set_exempt", label: "Conceder isenção administrativa" },
  { value: "remove_exempt", label: "Remover isenção (expira o acesso)" },
  { value: "change_plan", label: "Alterar plano" },
];

function Feedback({ state }: { state: AdminBillingActionState }) {
  if (!state.message) {
    return null;
  }

  return <Alert variant={state.status === "success" ? "success" : "error"}>{state.message}</Alert>;
}

export function SubscriptionActionsForm({
  storeId,
  plans,
  requestId,
}: {
  storeId: string;
  plans: PlanSummary[];
  requestId: string;
}) {
  const [state, formAction] = useActionState(updateSubscriptionAction, initialState);
  const [action, setAction] = useState("activate");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const selectedPlan = plans.find((plan) => plan.id === planId) ?? plans[0] ?? null;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="requestId" value={requestId} />

      <Feedback state={state} />

      <FormField label="Ação" htmlFor="action" error={state.fieldErrors?.action?.[0]}>
        <Select
          id="action"
          name="action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        >
          {ACTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Dias (opcional)"
          htmlFor="days"
          error={state.fieldErrors?.days?.[0]}
          hint="Teste: padrão do plano. Ativação: 30. Carência: padrão do plano."
        >
          <Input id="days" name="days" type="number" min={1} max={366} inputMode="numeric" />
        </FormField>

        {action === "change_plan" ? (
          <FormField label="Novo plano" htmlFor="planId" error={state.fieldErrors?.planId?.[0]}>
            <Select
              id="planId"
              name="planId"
              value={planId}
              onChange={(event) => setPlanId(event.target.value)}
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {formatCurrency(plan.priceCents)}/mês
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          <input type="hidden" name="planId" value={selectedPlan?.id ?? ""} />
        )}
      </div>

      <FormField
        label="Motivo"
        htmlFor="reason"
        error={state.fieldErrors?.reason?.[0]}
        hint="Obrigatório. Fica registrado no histórico imutável da assinatura."
      >
        <Textarea
          id="reason"
          name="reason"
          maxLength={500}
          minLength={3}
          required
          placeholder="Ex.: regularização de teste em homologação."
        />
      </FormField>

      <SubmitButton pendingLabel="Registrando...">Aplicar ação</SubmitButton>
    </form>
  );
}

export function StoreAdminForm({
  store,
  requestId,
}: {
  store: {
    id: string;
    name: string;
    description: string | null;
    phone: string | null;
    active: boolean;
  };
  requestId: string;
}) {
  const [state, formAction] = useActionState(updateStoreAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="storeId" value={store.id} />
      <input type="hidden" name="requestId" value={requestId} />

      <Feedback state={state} />

      <FormField label="Nome" htmlFor="storeName" error={state.fieldErrors?.name?.[0]}>
        <Input id="storeName" name="name" defaultValue={store.name} maxLength={120} required />
      </FormField>

      <FormField label="Telefone" htmlFor="storePhone" error={state.fieldErrors?.phone?.[0]}>
        <Input
          id="storePhone"
          name="phone"
          defaultValue={store.phone ?? ""}
          inputMode="tel"
          maxLength={30}
        />
      </FormField>

      <FormField
        label="Descrição"
        htmlFor="storeDescription"
        error={state.fieldErrors?.description?.[0]}
      >
        <Textarea
          id="storeDescription"
          name="description"
          defaultValue={store.description ?? ""}
          maxLength={500}
        />
      </FormField>

      <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <input
          type="checkbox"
          name="active"
          defaultChecked={store.active}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
        />
        <span className="space-y-0.5">
          <span className="block text-sm font-medium text-zinc-800">Loja ativa (cadastro)</span>
          <span className="block text-xs text-zinc-500">
            Desativar oculta a página pública. O histórico e os pedidos existentes são preservados.
          </span>
        </span>
      </label>

      <FormField
        label="Motivo da alteração de status"
        htmlFor="storeReason"
        error={state.fieldErrors?.reason?.[0]}
        hint="Obrigatório apenas quando o status cadastral muda."
      >
        <Input id="storeReason" name="reason" maxLength={500} placeholder="Opcional" />
      </FormField>

      <SubmitButton pendingLabel="Salvando..." variant="secondary">
        Salvar dados administrativos
      </SubmitButton>
    </form>
  );
}

export function AddOwnerForm({ storeId, requestId }: { storeId: string; requestId: string }) {
  const [state, formAction] = useActionState(addStoreOwnerAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="requestId" value={requestId} />

      <Feedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="E-mail da conta existente"
          htmlFor="ownerEmail"
          error={state.fieldErrors?.ownerEmail?.[0]}
        >
          <Input id="ownerEmail" name="ownerEmail" type="email" autoComplete="off" required />
        </FormField>

        <FormField label="Motivo" htmlFor="ownerReason" error={state.fieldErrors?.reason?.[0]}>
          <Input id="ownerReason" name="reason" maxLength={500} minLength={3} required />
        </FormField>
      </div>

      <SubmitButton pendingLabel="Vinculando..." variant="secondary">
        Vincular proprietário
      </SubmitButton>
    </form>
  );
}
