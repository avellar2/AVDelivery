"use client";

import { useActionState, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime } from "@/lib/utils";
import {
  generateChargeAction,
  refreshChargeAction,
  type BillingActionState,
} from "@/modules/billing/actions";
import type { BillingConnection, OwnerCheckoutSummary } from "@/modules/billing/types";

const initialState: BillingActionState = { status: "idle" };

function PixCopy({ payload }: { payload: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Pix Copia e Cola</p>
      <textarea
        readOnly
        value={payload}
        rows={4}
        aria-label="Código Pix Copia e Cola"
        className="w-full resize-y rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs break-all text-zinc-700"
      />
      <Button variant="secondary" onClick={copy}>
        {copied ? "Copiado" : "Copiar código Pix"}
      </Button>
    </div>
  );
}

export function ChargeActions({
  connection,
  profileReady,
  requestId,
  externalSubscriptionId,
  externalStatus,
  lastSyncedAt,
  checkout,
}: {
  connection: BillingConnection;
  profileReady: boolean;
  requestId: string;
  externalSubscriptionId: string | null;
  externalStatus: string | null;
  lastSyncedAt: string | null;
  checkout: OwnerCheckoutSummary | null;
}) {
  const [generateState, generateAction] = useActionState(generateChargeAction, initialState);
  const [refreshState, refreshAction] = useActionState(refreshChargeAction, initialState);

  const paymentUrl = generateState.paymentUrl ?? checkout?.paymentUrl ?? null;
  const pixPayload = generateState.pixPayload ?? checkout?.pixPayload ?? null;

  return (
    <div className="space-y-5">
      <Alert variant="warning" title="Ambiente de homologação Sandbox">
        Esta cobrança é criada no Asaas Sandbox e não movimenta dinheiro real. A loja só é liberada
        quando o próprio Asaas confirma o pagamento de uma cobrança verificável. Criar a assinatura
        não significa pagamento confirmado e assinatura Pix não é débito automático: cada ciclo gera
        uma nova cobrança Pix para pagamento.
      </Alert>

      {!connection.configured ? (
        <Alert variant="error" title="Integração Asaas Sandbox não configurada">
          Faltam no ambiente do servidor: {connection.missing.join(", ")}. Nenhuma chave é exibida
          aqui. Enquanto isso, o código permanece testável com mocks e a cobrança fica indisponível.
        </Alert>
      ) : null}

      {checkout?.status === "failed" && checkout.errorMessage ? (
        <Alert variant="error" title="A última tentativa não foi concluída">
          {checkout.errorMessage}
        </Alert>
      ) : null}

      {generateState.message ? (
        <Alert variant={generateState.status === "success" ? "success" : "error"}>
          {generateState.message}
        </Alert>
      ) : null}

      {refreshState.message ? (
        <Alert variant={refreshState.status === "error" ? "error" : "info"}>
          {refreshState.message}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <form action={generateAction}>
          <input type="hidden" name="requestId" value={requestId} />
          <SubmitButton
            pendingLabel="Criando no Sandbox..."
            disabled={!connection.configured || !profileReady}
          >
            Gerar cobrança Pix no Sandbox
          </SubmitButton>
        </form>

        {externalSubscriptionId ? (
          <form action={refreshAction}>
            <input type="hidden" name="requestId" value={requestId} />
            <SubmitButton variant="secondary" pendingLabel="Verificando...">
              Verificar pagamento
            </SubmitButton>
          </form>
        ) : null}
      </div>

      {!profileReady ? (
        <p className="text-sm text-zinc-500">
          Salve os dados de faturamento abaixo antes de gerar a cobrança.
        </p>
      ) : null}

      {externalSubscriptionId ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-zinc-500 uppercase">Assinatura externa</dt>
            <dd className="mt-1 font-mono text-xs break-all text-zinc-700">
              {externalSubscriptionId}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 uppercase">Status no Asaas</dt>
            <dd className="mt-1 text-zinc-700">{externalStatus ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 uppercase">Última verificação</dt>
            <dd className="mt-1 text-zinc-700">
              {lastSyncedAt ? formatDateTime(lastSyncedAt) : "Ainda não verificada"}
            </dd>
          </div>
        </dl>
      ) : null}

      {paymentUrl ? (
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Link de pagamento seguro
          </p>
          <a
            href={paymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium break-all text-orange-700 underline hover:text-orange-800"
          >
            Abrir cobrança no Asaas
          </a>
          <p className="text-xs text-zinc-500">
            O link é hospedado pelo Asaas. O AVDelivery não coleta dados de cartão nesta página.
          </p>
        </div>
      ) : null}

      {pixPayload ? <PixCopy payload={pixPayload} /> : null}

      <p className="text-xs text-zinc-500">
        Repetir o clique não deve criar outra assinatura: a operação é idempotente por loja e
        requisição. Se a confirmação não chegar, use “Verificar pagamento” e consulte a conciliação.
      </p>
    </div>
  );
}
