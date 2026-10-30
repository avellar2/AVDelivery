"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState } from "@/lib/action-state";
import { centsToPriceInput } from "@/modules/menu/validation";
import { updateStoreSettingsAction } from "@/modules/stores/actions";
import type { StoreSettingsData } from "@/modules/stores/service";

function Toggle({
  name,
  defaultChecked,
  title,
  description,
}: {
  name: string;
  defaultChecked: boolean;
  title: string;
  description: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-zinc-800">{title}</span>
        <span className="block text-xs text-zinc-500">{description}</span>
      </span>
    </label>
  );
}

export function StoreSettingsForm({
  store,
  canToggleActive,
}: {
  store: StoreSettingsData;
  canToggleActive: boolean;
}) {
  const [state, formAction] = useActionState(updateStoreSettingsAction, initialActionState);

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="storeId" value={store.id} />

      {state.message ? (
        <Alert variant={state.status === "success" ? "success" : "error"}>{state.message}</Alert>
      ) : null}

      <section className="space-y-5">
        <h3 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
          Informações públicas
        </h3>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Nome da loja" htmlFor="name" error={state.fieldErrors?.name?.[0]}>
            <Input
              id="name"
              name="name"
              defaultValue={store.name}
              maxLength={120}
              aria-invalid={Boolean(state.fieldErrors?.name)}
              required
            />
          </FormField>

          <FormField
            label="Identificador público"
            htmlFor="slug"
            hint="Endereço usado em /loja/{identificador}."
          >
            <Input id="slug" name="slug" value={store.slug} readOnly disabled />
          </FormField>
        </div>

        <FormField
          label="Descrição"
          htmlFor="description"
          error={state.fieldErrors?.description?.[0]}
          hint="Até 500 caracteres. Aparece abaixo do nome da loja."
        >
          <Textarea
            id="description"
            name="description"
            defaultValue={store.description ?? ""}
            maxLength={500}
            aria-invalid={Boolean(state.fieldErrors?.description)}
          />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Telefone" htmlFor="phone" error={state.fieldErrors?.phone?.[0]}>
            <Input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={store.phone ?? ""}
              maxLength={30}
              placeholder="(11) 90000-0000"
              aria-invalid={Boolean(state.fieldErrors?.phone)}
            />
          </FormField>

          <FormField
            label="URL do logo"
            htmlFor="logoUrl"
            error={state.fieldErrors?.logoUrl?.[0]}
            hint="Armazenado nesta etapa. A exibição pública será habilitada depois."
          >
            <Input
              id="logoUrl"
              name="logoUrl"
              type="url"
              defaultValue={store.logoUrl ?? ""}
              maxLength={500}
              placeholder="https://exemplo.com/logo.png"
              aria-invalid={Boolean(state.fieldErrors?.logoUrl)}
            />
          </FormField>
        </div>

        {canToggleActive ? (
          <Toggle
            name="active"
            defaultChecked={store.active}
            title="Loja ativa"
            description="Desativar oculta a loja da página pública, mas não apaga nenhum dado."
          />
        ) : null}
      </section>

      <section className="space-y-4 border-t border-zinc-100 pt-6">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
            Pedidos e entrega
          </h3>
          <p className="text-sm text-zinc-500">
            Controla o checkout da página pública. Fechar os pedidos não apaga o histórico.
          </p>
        </div>

        {state.fieldErrors?.fulfillment?.[0] ? (
          <Alert variant="error">{state.fieldErrors.fulfillment[0]}</Alert>
        ) : null}

        <Toggle
          name="acceptingOrders"
          defaultChecked={store.acceptingOrders}
          title="Aceitando novos pedidos"
          description="Quando desligado, os clientes continuam vendo o cardápio, mas não conseguem finalizar o pedido."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            name="deliveryEnabled"
            defaultChecked={store.deliveryEnabled}
            title="Entrega"
            description="O cliente informa o endereço completo e paga a taxa configurada."
          />
          <Toggle
            name="pickupEnabled"
            defaultChecked={store.pickupEnabled}
            title="Retirada no local"
            description="O cliente retira o pedido no estabelecimento, sem taxa de entrega."
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Taxa de entrega (R$)"
            htmlFor="deliveryFeeCents"
            error={state.fieldErrors?.deliveryFeeCents?.[0]}
            hint="Cobrada apenas em pedidos para entrega."
          >
            <Input
              id="deliveryFeeCents"
              name="deliveryFeeCents"
              inputMode="decimal"
              defaultValue={centsToPriceInput(store.deliveryFeeCents)}
              aria-invalid={Boolean(state.fieldErrors?.deliveryFeeCents)}
            />
          </FormField>

          <FormField
            label="Pedido mínimo (R$)"
            htmlFor="minOrderCents"
            error={state.fieldErrors?.minOrderCents?.[0]}
            hint="Calculado sobre os produtos, sem a taxa de entrega. Use 0 para não exigir mínimo."
          >
            <Input
              id="minOrderCents"
              name="minOrderCents"
              inputMode="decimal"
              defaultValue={centsToPriceInput(store.minOrderCents)}
              aria-invalid={Boolean(state.fieldErrors?.minOrderCents)}
            />
          </FormField>
        </div>
      </section>

      <section className="space-y-4 border-t border-zinc-100 pt-6">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Pagamento</h3>
          <p className="text-sm text-zinc-500">
            O pagamento é combinado na entrega ou por Pix manual. Nenhuma cobrança online é feita
            pela plataforma.
          </p>
        </div>

        {state.fieldErrors?.payments?.[0] ? (
          <Alert variant="error">{state.fieldErrors.payments[0]}</Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle
            name="paymentPixEnabled"
            defaultChecked={store.paymentPixEnabled}
            title="Pix manual"
            description="Exibe a chave Pix para o cliente pagar e enviar o comprovante."
          />
          <Toggle
            name="paymentCashEnabled"
            defaultChecked={store.paymentCashEnabled}
            title="Dinheiro"
            description="Pagamento em dinheiro na entrega ou retirada."
          />
          <Toggle
            name="paymentCardOnDeliveryEnabled"
            defaultChecked={store.paymentCardOnDeliveryEnabled}
            title="Cartão na entrega"
            description="Maquininha no momento da entrega ou retirada."
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Chave Pix"
            htmlFor="pixKey"
            error={state.fieldErrors?.pixKey?.[0]}
            hint="CPF/CNPJ, e-mail, telefone ou chave aleatória."
          >
            <Input
              id="pixKey"
              name="pixKey"
              defaultValue={store.pixKey ?? ""}
              maxLength={200}
              aria-invalid={Boolean(state.fieldErrors?.pixKey)}
            />
          </FormField>

          <FormField
            label="Nome do recebedor"
            htmlFor="pixReceiverName"
            error={state.fieldErrors?.pixReceiverName?.[0]}
            hint="Exibido junto à chave Pix para conferência do cliente."
          >
            <Input
              id="pixReceiverName"
              name="pixReceiverName"
              defaultValue={store.pixReceiverName ?? ""}
              maxLength={120}
              aria-invalid={Boolean(state.fieldErrors?.pixReceiverName)}
            />
          </FormField>
        </div>
      </section>

      <div className="flex justify-end border-t border-zinc-100 pt-5">
        <SubmitButton pendingLabel="Salvando...">Salvar alterações</SubmitButton>
      </div>
    </form>
  );
}
